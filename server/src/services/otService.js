import mongoose from 'mongoose';
import Request, { OT_MODES } from '../models/Request.js';
import Attendance from '../models/Attendance.js';
import WorkScheduleRegistration from '../models/WorkScheduleRegistration.js';
import {
  getDateKey,
  getSeparatedOtDuration,
  getTodayDateKey,
  isWeekend
} from '../utils/dateUtils.js';
import { toValidDate, assertHasTzIfString } from './requestDateValidation.js';
import { getHolidayDatesForMonth } from '../utils/holidayUtils.js';
import {
  formatMinutesAsTime,
  getEarliestContinuousOtEndMinutes,
  getOtThresholdMinutes,
  getOtThresholdTimeForDate,
  isFlexibleScheduleType,
  normalizeScheduleType
} from '../utils/schedulePolicy.js';

const BUSINESS_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;
const OT_CROSS_MIDNIGHT_CUTOFF = '08:00';

const getNextDateKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  return nextDate.toISOString().slice(0, 10);
};

const getTimeKeyInGmt7 = (date) => {
  const shifted = new Date(date.getTime() + BUSINESS_TZ_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const resolveEffectiveScheduleType = async (userId, date, attendanceRecord = null) => {
  const attendanceType = normalizeScheduleType(attendanceRecord?.scheduleType);
  if (attendanceType) {
    return attendanceType;
  }

  const registration = await WorkScheduleRegistration.findOne({
    userId,
    workDate: date
  })
    .select('scheduleType')
    .lean();

  const registrationType = normalizeScheduleType(registration?.scheduleType);
  return registrationType || 'SHIFT_1';
};

const isWorkdayDate = async (dateKey) => {
  if (isWeekend(dateKey)) {
    return false;
  }
  const holidayDates = await getHolidayDatesForMonth(dateKey.slice(0, 7));
  return !holidayDates.has(dateKey);
};

/**
 * Create OT request with comprehensive validation
 *
 * Business Rules:
 * - E1: Advance notice allowed (today or future)
 * - E2: No retroactive (no past dates)
 * - B1: Minimum 30 minutes OT
 * - D1: Max 31 pending per month
 * - D2: Auto-extend if PENDING exists for same date
 * - I1: Cross-midnight uses 1 request (next-day end time only in 00:00-07:59)
 *
 * @param {string} userId - User's ObjectId
 * @param {Object} requestData - { date, estimatedEndTime, reason }
 * @returns {Promise<Object>} Created or updated request
 */
export const createOtRequest = async (userId, requestData) => {
  const {
    date,
    estimatedEndTime,
    reason,
    otMode: rawOtMode = 'CONTINUOUS',
    otStartTime
  } = requestData;
  const otMode = rawOtMode || 'CONTINUOUS';

  // Validation 0: userId must be valid ObjectId (defensive)
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid userId');
    error.statusCode = 400;
    throw error;
  }

  // Validation 0.5: date format must be valid (defensive)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error('Invalid date format. Expected YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  // Validation 0.6: estimatedEndTime timezone (if string)
  assertHasTzIfString(estimatedEndTime, 'estimatedEndTime');
  if (otMode === 'SEPARATED') {
    assertHasTzIfString(otStartTime, 'otStartTime');
  }

  // Validation 0.6: Parse and validate estimatedEndTime (accept string or Date)
  const endTime = toValidDate(estimatedEndTime, 'estimatedEndTime');
  if (!endTime) {
    const error = new Error('estimatedEndTime is required');
    error.statusCode = 400;
    throw error;
  }

  if (!OT_MODES.includes(otMode)) {
    const error = new Error('otMode must be CONTINUOUS or SEPARATED');
    error.statusCode = 400;
    throw error;
  }

  const startTime = otMode === 'SEPARATED'
    ? toValidDate(otStartTime, 'otStartTime')
    : null;

  // Validation 0.7: reason must not be empty (defensive)
  const trimmedReason = (reason ?? '').trim();
  if (!trimmedReason) {
    const error = new Error('Reason is required');
    error.statusCode = 400;
    throw error;
  }

  // Validation 0.8: reason length limit (consistent with ADJUST_TIME/LEAVE)
  const MAX_REASON_LENGTH = 1000;
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    const error = new Error(`Reason must be ${MAX_REASON_LENGTH} characters or less`);
    error.statusCode = 400;
    throw error;
  }

  // Validation 1: Date must be today or future (E1, E2)
  const todayKey = getTodayDateKey();
  if (date < todayKey) {
    const error = new Error('Cannot create OT request for past dates');
    error.statusCode = 400;
    throw error;
  }

  // C1: separated OT only supports today's date.
  if (otMode === 'SEPARATED' && date !== todayKey) {
    const error = new Error('SEPARATED OT chỉ hỗ trợ cho ngày hiện tại (GMT+7)');
    error.statusCode = 400;
    throw error;
  }

  // ========== P1-2 FIX START ==========
  // Validation 1.5: Same-day retroactive check (STRICT policy)
  // Policy: OT must be requested BEFORE the estimated end time
  // Rationale: Prevent retroactive OT recording abuse
  if (date === todayKey) {
    const now = Date.now();
    if (endTime.getTime() <= now) {
      const error = new Error(
        'Cannot create OT request for past time. OT must be requested before the estimated end time.\n' +
        `Current time: ${new Date(now).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false })} (GMT+7)\n` +
        `Requested time: ${endTime.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false })} (GMT+7)\n` +
        'If you forgot to request, please contact your manager.'
      );
      error.statusCode = 400;
      throw error;
    }
  }
  // ========== P1-2 FIX END ==========

  // Validation 2: estimatedEndTime must be on request date or next day only
  const estimatedDateKey = getDateKey(endTime);
  const nextDateKey = getNextDateKey(date);
  const isCrossMidnight = estimatedDateKey === nextDateKey;

  if (estimatedDateKey !== date && !isCrossMidnight) {
    const error = new Error('estimatedEndTime must be on request date or the immediate next day');
    error.statusCode = 400;
    throw error;
  }

  // Validation 2.1: next-day end time must be before 08:00 (anti-bypass)
  if (isCrossMidnight) {
    const endTimeKey = getTimeKeyInGmt7(endTime);
    if (endTimeKey >= OT_CROSS_MIDNIGHT_CUTOFF) {
      const error = new Error('Cross-midnight OT only supports next-day end time from 00:00 to 07:59 (GMT+7)');
      error.statusCode = 400;
      throw error;
    }
  }

  // Mode-specific validations before auto-extend/update.
  const existingAttendance = await Attendance.findOne({ userId, date })
    .select(
      'checkInAt checkOutAt scheduleType scheduledStartMinutes scheduledEndMinutes ' +
      'lateGraceMinutes lateTrackingEnabled earlyLeaveTrackingEnabled scheduleSource'
    )
    .lean();
  const effectiveScheduleType = await resolveEffectiveScheduleType(userId, date, existingAttendance);
  const thresholdTime = getOtThresholdTimeForDate(date, effectiveScheduleType)
    || getOtThresholdTimeForDate(date, 'SHIFT_1');
  const thresholdMinutes = getOtThresholdMinutes(effectiveScheduleType)
    ?? getOtThresholdMinutes('SHIFT_1')
    ?? (17 * 60 + 31);
  const thresholdLabel = formatMinutesAsTime(thresholdMinutes) || '17:31';
  const earliestContinuousEndMinutes = getEarliestContinuousOtEndMinutes(effectiveScheduleType, 30) ?? (18 * 60 + 1);
  const earliestContinuousEndLabel = formatMinutesAsTime(earliestContinuousEndMinutes) || '18:01';
  const isWorkday = await isWorkdayDate(date);

  if (isWorkday && isFlexibleScheduleType(effectiveScheduleType)) {
    const error = new Error('Không thể tạo OT cho lịch Linh hoạt vào ngày làm việc');
    error.statusCode = 400;
    throw error;
  }

  if (otMode === 'CONTINUOUS') {
    // Validation 3: same-day end time must be > shift OT threshold
    if (!isCrossMidnight && (!thresholdTime || endTime <= thresholdTime)) {
      const error = new Error(`OT must start after ${thresholdLabel}. Please adjust your estimated end time.`);
      error.statusCode = 400;
      throw error;
    }

    // Validation 4: Minimum 30 minutes OT (B1) from shift threshold
    const estimatedOtMinutes = thresholdTime
      ? Math.floor((endTime.getTime() - thresholdTime.getTime()) / (1000 * 60))
      : 0;
    if (estimatedOtMinutes < 30) {
      const error = new Error(
        `Minimum OT duration is 30 minutes (earliest valid end: ${earliestContinuousEndLabel})`
      );
      error.statusCode = 400;
      throw error;
    }

    // Legacy continuous rule: request must be before checkout.
    if (existingAttendance?.checkOutAt) {
      const error = new Error('Cannot request OT after checkout. OT must be requested before checking out.');
      error.statusCode = 400;
      throw error;
    }
  } else {
    // SEPARATED validations
    if (!startTime) {
      const error = new Error('otStartTime is required for SEPARATED OT');
      error.statusCode = 400;
      throw error;
    }

    const startDateKey = getDateKey(startTime);
    const startIsCrossMidnight = startDateKey === nextDateKey;
    if (startDateKey !== date && !startIsCrossMidnight) {
      const error = new Error('otStartTime must be on request date or the immediate next day');
      error.statusCode = 400;
      throw error;
    }

    if (startIsCrossMidnight) {
      const startTimeKey = getTimeKeyInGmt7(startTime);
      if (startTimeKey >= OT_CROSS_MIDNIGHT_CUTOFF) {
        const error = new Error('Cross-midnight OT start time must be from 00:00 to 07:59 (GMT+7)');
        error.statusCode = 400;
        throw error;
      }
    }

    if (!thresholdTime || startTime <= thresholdTime) {
      const error = new Error(`otStartTime must be after ${thresholdLabel} (GMT+7)`);
      error.statusCode = 400;
      throw error;
    }

    if (endTime <= startTime) {
      const error = new Error('estimatedEndTime must be after otStartTime');
      error.statusCode = 400;
      throw error;
    }

    const separatedMinutes = getSeparatedOtDuration(startTime, endTime);
    if (separatedMinutes < 30) {
      const error = new Error('Minimum OT duration is 30 minutes');
      error.statusCode = 400;
      throw error;
    }

    if (!existingAttendance?.checkInAt || !existingAttendance?.checkOutAt) {
      const error = new Error('Phải hoàn tất ca chính (check-in + check-out) trước khi đăng ký OT tách rời');
      error.statusCode = 400;
      throw error;
    }

    if (startTime <= new Date(existingAttendance.checkOutAt)) {
      const error = new Error('otStartTime phải sau thời điểm check-out ca chính');
      error.statusCode = 400;
      throw error;
    }
  }

  // Max pending per month (D1)
  const month = date.substring(0, 7);
  const pendingCount = await Request.countDocuments({
    userId,
    type: 'OT_REQUEST',
    status: 'PENDING',
    $or: [
      { date: { $regex: `^${month}` } },
      { checkInDate: { $regex: `^${month}` } }
    ]
  });

  if (pendingCount >= 31) {
    const error = new Error('Maximum 31 pending OT requests per month reached');
    error.statusCode = 400;
    throw error;
  }

  // D2: Auto-extend - Check if PENDING request exists for same date.
  const existingRequest = await Request.findOneAndUpdate(
    {
      userId,
      type: 'OT_REQUEST',
      status: 'PENDING',
      $or: [{ date }, { checkInDate: date }]
    },
    {
      $set: {
        estimatedEndTime: endTime,
        reason: trimmedReason,
        otMode,
        otStartTime: otMode === 'SEPARATED' ? startTime : null,
        isOtSlotActive: true
      }
    },
    { new: true }
  );

  if (existingRequest) {
    // Auto-extend successful
    return existingRequest;
  }

  if (otMode === 'CONTINUOUS') {
    const alreadyCheckedOut = await Attendance.exists({
      userId,
      date,
      checkOutAt: { $ne: null }
    });
    if (alreadyCheckedOut) {
      const error = new Error('Cannot request OT after checkout. OT must be requested before checking out.');
      error.statusCode = 400;
      throw error;
    }
  }

  // Slot guard: block if approved active OT exists on same day.
  const approvedSlot = await Request.exists({
    userId,
    type: 'OT_REQUEST',
    status: 'APPROVED',
    $or: [{ date }, { checkInDate: date }],
    isOtSlotActive: true
  });
  if (approvedSlot) {
    const error = new Error('Chỉ được có tối đa 1 phiên OT mỗi ngày');
    error.statusCode = 409;
    throw error;
  }

  // Create new OT request (no existing PENDING found)
  try {
    const request = await Request.create({
      userId,
      type: 'OT_REQUEST',
      date,
      estimatedEndTime: endTime,
      otMode,
      otStartTime: otMode === 'SEPARATED' ? startTime : null,
      isOtSlotActive: true,
      reason: trimmedReason,
      status: 'PENDING'
    });

    return request;
  } catch (err) {
    // Handle MongoDB duplicate key error (should not happen due to findOneAndUpdate above)
    if (err?.code === 11000) {
      const error = new Error('Chỉ được có tối đa 1 phiên OT mỗi ngày');
      error.statusCode = 409;
      throw error;
    }
    throw err;
  }
};

/**
 * Cancel OT request (C2: only if PENDING)
 *
 * @param {string} userId - User's ObjectId (for ownership check)
 * @param {string} requestId - Request's ObjectId
 * @returns {Promise<Object>} Success message
 */
export const cancelOtRequest = async (userId, requestId) => {
  // Validation 0: userId must be valid ObjectId (defensive)
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid userId');
    error.statusCode = 400;
    throw error;
  }

  // Validation 1: requestId must be valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(requestId)) {
    const error = new Error('Invalid request ID');
    error.statusCode = 400;
    throw error;
  }

  // Find PENDING OT request owned by user
  const request = await Request.findOne({
    _id: requestId,
    userId,
    type: 'OT_REQUEST',
    status: 'PENDING'
  });

  if (!request) {
    const error = new Error('OT request not found or already processed');
    error.statusCode = 404;
    throw error;
  }

  // Delete the request
  await Request.deleteOne({ _id: requestId });

  return {
    message: 'OT request cancelled successfully',
    requestId
  };
};
