import mongoose from 'mongoose';
import Request from '../models/Request.js';
import Attendance from '../models/Attendance.js';
import { getDateKey, getTodayDateKey, isInOtPeriod, getOtDuration } from '../utils/dateUtils.js';
import { toValidDate, assertHasTzIfString } from './requestDateValidation.js';

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
  const { date, estimatedEndTime, reason } = requestData;

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

  // Validation 0.6: Parse and validate estimatedEndTime (accept string or Date)
  const endTime = toValidDate(estimatedEndTime, 'estimatedEndTime');
  if (!endTime) {
    const error = new Error('estimatedEndTime is required');
    error.statusCode = 400;
    throw error;
  }

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

  // Validation 3: same-day end time must be > 17:31 (OT period)
  if (!isCrossMidnight && !isInOtPeriod(date, endTime)) {
    const error = new Error('OT must start after 17:31. Please adjust your estimated end time.');
    error.statusCode = 400;
    throw error;
  }

  // Validation 4: Minimum 30 minutes OT (B1)
  const estimatedOtMinutes = getOtDuration(date, endTime);
  if (estimatedOtMinutes < 30) {
    const error = new Error('Minimum OT duration is 30 minutes');
    error.statusCode = 400;
    throw error;
  }

  // Validation 5: Cannot create if already checked out (E2)
  const existingAttendance = await Attendance.findOne({ userId, date });
  if (existingAttendance?.checkOutAt) {
    const error = new Error('Cannot request OT after checkout. OT must be requested before checking out.');
    error.statusCode = 400;
    throw error;
  }

  // Validation 6: Max 31 pending per month (D1)
  // Legacy compatibility: some older OT docs may still contain checkInDate.
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

  // D2: Auto-extend - Check if PENDING request exists for same date (ATOMIC FIX)
  // Legacy compatibility: keep checkInDate branch for historical data reads.
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
        reason: trimmedReason
      }
    },
    { new: true }
  );

  if (existingRequest) {
    // Auto-extend successful
    return existingRequest;
  }

  // Create new OT request (no existing PENDING found)
  try {
    const request = await Request.create({
      userId,
      type: 'OT_REQUEST',
      date,
      estimatedEndTime: endTime,
      reason: trimmedReason,
      status: 'PENDING'
    });

    return request;
  } catch (err) {
    // Handle MongoDB duplicate key error (should not happen due to findOneAndUpdate above)
    if (err?.code === 11000) {
      const error = new Error('Duplicate OT request detected. Please try again.');
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
