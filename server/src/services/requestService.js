import mongoose from 'mongoose';
import Request from '../models/Request.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import WorkScheduleRegistration from '../models/WorkScheduleRegistration.js';
import {
  buildOtPreview,
  getDateKey,
  getSeparatedOtDuration,
  isWeekend
} from '../utils/dateUtils.js';
import { getHolidayDatesForMonth } from '../utils/holidayUtils.js';
import {
  getCheckoutGraceMs, getCheckoutGraceHours,
  getAdjustRequestMaxMs, getAdjustRequestMaxDays
} from '../utils/graceConfig.js';
import { 
  isReplicaSetAvailable, 
  getTransactionOptions 
} from '../config/database.js';
import { createAdjustTimeRequest } from './adjustTimeService.js';
import { createLeaveRequest, getApprovedLeaveDates } from './leaveService.js';
import { createOtRequest, cancelOtRequest } from './otService.js';
import {
  formatMinutesAsTime,
  getEarliestContinuousOtEndMinutes,
  getOtThresholdMinutes,
  getOtThresholdTimeForDate,
  isFlexibleScheduleType,
  normalizeScheduleType
} from '../utils/schedulePolicy.js';

/**
 * Router function: Create request of any type
 * Delegates to type-specific handlers based on requestData.type
 * 
 * @param {string} userId - User's ObjectId
 * @param {Object} requestData - Request data with type field
 * @returns {Promise<Object>} Created request
 */
export const createRequest = async (userId, requestData) => {
  const { type } = requestData;
  
  // Route to specific handler based on type
  if (type === 'OT_REQUEST') {
    return await createOtRequest(userId, requestData);
  }
  
  if (type === 'LEAVE') {
    // Extract LEAVE-specific fields
    const { leaveStartDate, leaveEndDate, leaveType, reason } = requestData;
    return await createLeaveRequest(userId, leaveStartDate, leaveEndDate, leaveType, reason);
  }
  
  // Default: ADJUST_TIME
  const {
    date,
    requestedCheckInAt,
    requestedCheckOutAt,
    reason,
    adjustMode,
    targetAttendanceId
  } = requestData;

  return await createAdjustTimeRequest(
    userId,
    date,
    requestedCheckInAt,
    requestedCheckOutAt,
    reason,
    { adjustMode, targetAttendanceId }
  );
};

/**
 * Get all requests for a specific user with pagination.
 * Returns only items - use countMyRequests for total count.
 * 
 * @param {string} userId - User's ObjectId
 * @param {Object} options - { skip, limit, status }
 * @returns {Promise<Array>} Array of request items
 */
export const getMyRequests = async (userId, options = {}) => {
  const { skip = 0, limit = 20, status } = options;

  // Build filter
  const filter = { userId };

  // Optional status filter (PENDING, APPROVED, REJECTED)
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
    filter.status = status.toUpperCase();
  }

  // Query items only (count is done separately by countMyRequests)
  const items = await Request.find(filter)
    .populate('approvedBy', 'name employeeCode')
    .sort({ createdAt: -1 })  // Newest first
    .skip(skip)
    .limit(limit)
    .lean();

  return items.map(attachOtPreview);
};

/**
 * Count requests for a user (without fetching items).
 * Used for pagination to get total count efficiently.
 * 
 * @param {string} userId - User's ObjectId
 * @param {Object} options - { status }
 * @returns {Promise<number>} Total count
 */
export const countMyRequests = async (userId, options = {}) => {
  const { status } = options;

  // Build filter
  const filter = { userId };

  // Optional status filter (PENDING, APPROVED, REJECTED)
  if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status.toUpperCase())) {
    filter.status = status.toUpperCase();
  }

  return Request.countDocuments(filter);
};

/**
 * Build RBAC filter for pending requests.
 * Shared by both count and query functions.
 * 
 * @param {Object} user - Current user (req.user)
 * @returns {Promise<Object>} MongoDB query filter
 */
const buildPendingFilter = async (user) => {
  const filter = { status: 'PENDING' };

  // RBAC: Manager only sees team members' requests
  if (user.role === 'MANAGER') {
    if (!user.teamId) {
      const error = new Error('Manager must be assigned to a team');
      error.statusCode = 403;
      throw error;
    }

    // Find all users in the same team (exclude soft-deleted and inactive users)
    // PATCH: Use $or to handle legacy users without deletedAt field (pre-migration)
    // Fix #4: Also exclude deactivated users
    // Fix #6: Add legacy fallback for isActive field (pre-migration users)
    const teamMembers = await User.find({
      teamId: user.teamId,
      $and: [
        {
          // Active users OR legacy users without isActive field (treat as active)
          $or: [
            { isActive: true },
            { isActive: { $exists: false } }
          ]
        },
        {
          // Not soft-deleted OR legacy users without deletedAt field
          $or: [
            { deletedAt: null },
            { deletedAt: { $exists: false } }
          ]
        }
      ]
    }).select('_id');
    const teamMemberIds = teamMembers.map(member => member._id);

    filter.userId = { $in: teamMemberIds };
  }

  // ADMIN sees all pending requests (no additional filter)
  return filter;
};

/**
 * Build RBAC filter for approval history.
 * Shared by both count and query functions.
 *
 * History includes APPROVED + REJECTED requests only.
 * Manager scope is based on current team membership and intentionally keeps
 * inactive/soft-deleted users for audit visibility.
 *
 * @param {Object} user - Current user (req.user)
 * @param {Object} options - { status }
 * @returns {Promise<Object>} MongoDB query filter
 */
const buildHistoryFilter = async (user, options = {}) => {
  const { status } = options;

  const normalizedStatus = status?.toUpperCase();
  const statuses = ['APPROVED', 'REJECTED'];
  const filter = {
    status: normalizedStatus && statuses.includes(normalizedStatus)
      ? normalizedStatus
      : { $in: statuses }
  };

  // RBAC: Manager only sees team members' requests
  if (user.role === 'MANAGER') {
    if (!user.teamId) {
      const error = new Error('Manager must be assigned to a team');
      error.statusCode = 403;
      throw error;
    }

    // Keep full audit trail: no isActive/deletedAt filtering for history scope.
    const teamMembers = await User.find({ teamId: user.teamId }).select('_id');
    const teamMemberIds = teamMembers.map(member => member._id);
    filter.userId = { $in: teamMemberIds };
  }

  // ADMIN sees all history requests (no additional filter)
  return filter;
};

const attachOtPreview = (requestDoc) => {
  if (!requestDoc || requestDoc.type !== 'OT_REQUEST') {
    return requestDoc;
  }

  const dateKey = requestDoc.date || requestDoc.checkInDate || null;
  requestDoc.otPreview = buildOtPreview(
    dateKey,
    requestDoc.otMode,
    requestDoc.otStartTime || null,
    requestDoc.estimatedEndTime || null
  );
  return requestDoc;
};

const resolveEffectiveOtScheduleType = async (userId, dateKey, attendance, session) => {
  const attendanceType = normalizeScheduleType(attendance?.scheduleType);
  if (attendanceType) {
    return attendanceType;
  }

  const query = WorkScheduleRegistration.findOne({
    userId,
    workDate: dateKey
  }).select('scheduleType');
  const registration = session ? await query.session(session).lean() : await query.lean();

  const registrationType = normalizeScheduleType(registration?.scheduleType);
  return registrationType || 'SHIFT_1';
};

const isWorkdayForDate = async (dateKey) => {
  if (isWeekend(dateKey)) {
    return false;
  }
  const holidays = await getHolidayDatesForMonth(dateKey.slice(0, 7));
  return !holidays.has(dateKey);
};

/**
 * Count pending requests with RBAC scope enforcement.
 * Used for pagination total count.
 * 
 * @param {Object} user - Current user (req.user)
 * @returns {Promise<number>} Total count
 */
export const countPendingRequests = async (user) => {
  const filter = await buildPendingFilter(user);
  return Request.countDocuments(filter);
};

/**
 * Get pending requests with RBAC scope enforcement and pagination.
 * MANAGER: Only requests from users in the same team
 * ADMIN: All pending requests company-wide
 * 
 * @param {Object} user - Current user (req.user)
 * @param {Object} options - { skip, limit }
 * @returns {Promise<Array>} Array of pending requests
 */
export const getPendingRequests = async (user, options = {}) => {
  const { skip = 0, limit = 20 } = options;

  const filter = await buildPendingFilter(user);

  const requests = await Request.find(filter)
    .populate('userId', 'name employeeCode email teamId')
    .sort({ createdAt: -1 })  // Newest first (consistent with employee view)
    .skip(skip)
    .limit(limit)
    .lean();

  // Enrich OT requests with real attendance check-in/check-out from Attendance collection.
  const otRequests = requests.filter((req) => req?.type === 'OT_REQUEST');
  if (otRequests.length === 0) {
    return requests.map(attachOtPreview);
  }

  const seen = new Set();
  const lookupPairs = [];

  for (const otReq of otRequests) {
    const rawUserId = otReq?.userId?._id || otReq?.userId || null;
    const userId = rawUserId ? String(rawUserId) : '';
    // Legacy fallback: some old OT docs may still use checkInDate.
    const dateKey = otReq?.date || otReq?.checkInDate || null;

    if (!userId || !dateKey) {
      otReq.attendance = null;
      continue;
    }

    const dedupeKey = `${userId}|${dateKey}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    lookupPairs.push({ userId: rawUserId, date: dateKey });
  }

  // Guard: avoid querying Attendance with {$or: []}.
  if (lookupPairs.length === 0) {
    for (const otReq of otRequests) {
      if (otReq.attendance === undefined) {
        otReq.attendance = null;
      }
    }
    return requests.map(attachOtPreview);
  }

  const attendances = await Attendance.find({ $or: lookupPairs })
    .select('userId date checkInAt checkOutAt')
    .lean();

  const attendanceMap = new Map();
  for (const att of attendances) {
    const mapKey = `${String(att.userId)}|${att.date}`;
    attendanceMap.set(mapKey, {
      checkInAt: att.checkInAt ?? null,
      checkOutAt: att.checkOutAt ?? null
    });
  }

  for (const otReq of otRequests) {
    if (otReq.attendance === null) {
      continue;
    }

    const rawUserId = otReq?.userId?._id || otReq?.userId || null;
    const userId = rawUserId ? String(rawUserId) : '';
    const dateKey = otReq?.date || otReq?.checkInDate || null;

    if (!userId || !dateKey) {
      otReq.attendance = null;
      continue;
    }

    const mapKey = `${userId}|${dateKey}`;
    otReq.attendance = attendanceMap.get(mapKey) || null;
  }

  return requests.map(attachOtPreview);
};

/**
 * Count approval history with RBAC scope enforcement.
 * Used for pagination total count.
 *
 * @param {Object} user - Current user (req.user)
 * @param {Object} options - { status }
 * @returns {Promise<number>} Total count
 */
export const countApprovalHistory = async (user, options = {}) => {
  const filter = await buildHistoryFilter(user, options);
  return Request.countDocuments(filter);
};

/**
 * Get approval history with RBAC scope enforcement and pagination.
 * MANAGER: requests from users in same team (including inactive/deleted users)
 * ADMIN: all approved/rejected requests company-wide
 *
 * @param {Object} user - Current user (req.user)
 * @param {Object} options - { skip, limit, status }
 * @returns {Promise<Array>} Array of history requests
 */
export const getApprovalHistory = async (user, options = {}) => {
  const { skip = 0, limit = 20, status } = options;
  const filter = await buildHistoryFilter(user, { status });

  const requests = await Request.find(filter)
    .populate('userId', 'name employeeCode email teamId')
    .populate('approvedBy', 'name employeeCode')
    .sort({ approvedAt: -1, updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return requests.map(attachOtPreview);
};

const autoRejectWithSystemReason = async (requestId, approverId, systemRejectReason, session = null) => {
  const query = Request.findOneAndUpdate(
    {
      _id: requestId,
      status: 'PENDING'
    },
    {
      $set: {
        status: 'REJECTED',
        approvedBy: approverId,
        approvedAt: new Date(),
        systemRejectReason
      }
    },
    { new: true }
  );

  return session ? await query.session(session) : await query;
};

/**
 * Core approval logic (extracted for transaction/non-transaction paths)
 * 
 * This function contains the business logic for approving a request.
 * It is transaction-agnostic and can be called with or without a session.
 * 
 * @param {string} requestId - Request's ObjectId
 * @param {Object} approver - Approver user object (req.user)
 * @param {Object|null} session - MongoDB session for transaction (null for standalone)
 * @returns {Promise<Object>} Updated request
 */
async function approveRequestCore(requestId, approver, session) {
  // STEP 1: Fetch request (with or without session)
  // Fix #5: Populate isActive and deletedAt to validate user status
  const query = Request.findById(requestId).populate('userId', 'teamId isActive deletedAt');
  const existingRequest = session ? await query.session(session) : await query;

  if (!existingRequest) {
    const error = new Error('Request not found');
    error.statusCode = 404;
    throw error;
  }

  // Fix #5: Validate user is active and not deleted
  if (!existingRequest.userId) {
    const error = new Error('Request user not found');
    error.statusCode = 400;
    throw error;
  }
  
  // Fix #7: Use explicit false check to support legacy users without isActive field
  // (!undefined === true) would incorrectly block legacy users, use (=== false) instead
  if (existingRequest.userId.isActive === false) {
    const error = new Error('Cannot approve request for inactive user');
    error.statusCode = 400;
    throw error;
  }
  
  if (existingRequest.userId.deletedAt) {
    const error = new Error('Cannot approve request for deleted user');
    error.statusCode = 400;
    throw error;
  }

  // STEP 2: RBAC check (before atomic update)
  if (approver.role === 'MANAGER') {
    if (!approver.teamId) {
      const error = new Error('Manager must be assigned to a team');
      error.statusCode = 403;
      throw error;
    }

    if (!existingRequest.userId.teamId) {
      const error = new Error('Request user is not assigned to any team');
      error.statusCode = 403;
      throw error;
    }

    if (!approver.teamId.equals(existingRequest.userId.teamId)) {
      const error = new Error('You can only approve requests from your team');
      error.statusCode = 403;
      throw error;
    }
  }

  // OT_REQUEST invariant / re-validation.
  if (existingRequest.type === 'OT_REQUEST') {
    const otMode = existingRequest.otMode === 'SEPARATED' ? 'SEPARATED' : 'CONTINUOUS';
    const attendanceQuery = Attendance.findOne({
      userId: existingRequest.userId._id,
      date: existingRequest.date
    }).select(
      'checkInAt checkOutAt otApproved scheduleType scheduledStartMinutes scheduledEndMinutes ' +
      'lateGraceMinutes lateTrackingEnabled earlyLeaveTrackingEnabled scheduleSource'
    ).lean();
    const attendance = session ? await attendanceQuery.session(session) : await attendanceQuery;
    const effectiveScheduleType = await resolveEffectiveOtScheduleType(
      existingRequest.userId._id,
      existingRequest.date,
      attendance,
      session
    );
    const isWorkday = await isWorkdayForDate(existingRequest.date);
    if (isWorkday && isFlexibleScheduleType(effectiveScheduleType)) {
      const error = new Error('Cannot approve OT for FLEXIBLE schedule on workday');
      error.statusCode = 400;
      throw error;
    }

    const thresholdTime = getOtThresholdTimeForDate(existingRequest.date, effectiveScheduleType)
      || getOtThresholdTimeForDate(existingRequest.date, 'SHIFT_1');
    const thresholdMinutes = getOtThresholdMinutes(effectiveScheduleType)
      ?? getOtThresholdMinutes('SHIFT_1')
      ?? (17 * 60 + 30);
    const thresholdLabel = formatMinutesAsTime(thresholdMinutes) || '17:30';
    const earliestContinuousEndMinutes = getEarliestContinuousOtEndMinutes(effectiveScheduleType, 30)
      ?? (18 * 60);
    const earliestContinuousEndLabel = formatMinutesAsTime(earliestContinuousEndMinutes) || '18:00';

    if (otMode === 'CONTINUOUS') {
      const estimatedEndTime = existingRequest.estimatedEndTime
        ? new Date(existingRequest.estimatedEndTime)
        : null;
      if (!estimatedEndTime || isNaN(estimatedEndTime.getTime())) {
        const error = new Error('Cannot approve OT: invalid estimatedEndTime');
        error.statusCode = 400;
        throw error;
      }

      const requestDateKey = existingRequest.date;
      const nextDateKey = (() => {
        const [year, month, day] = requestDateKey.split('-').map(Number);
        const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
        return nextDate.toISOString().slice(0, 10);
      })();
      const endDateKey = getDateKey(estimatedEndTime);
      const isCrossMidnight = endDateKey === nextDateKey;

      if (!isCrossMidnight && thresholdTime && estimatedEndTime < thresholdTime) {
        const error = new Error(`Cannot approve OT: estimatedEndTime cannot be before ${thresholdLabel} (GMT+7)`);
        error.statusCode = 400;
        throw error;
      }

      const estimatedMinutesFromThreshold = thresholdTime
        ? Math.floor((estimatedEndTime.getTime() - thresholdTime.getTime()) / (1000 * 60))
        : 0;
      if (estimatedMinutesFromThreshold < 30) {
        const error = new Error(
          `Cannot approve OT: minimum duration is 30 minutes (earliest valid end: ${earliestContinuousEndLabel})`
        );
        error.statusCode = 400;
        throw error;
      }

      // Legacy invariant: request must be submitted/updated before checkout.
      // Allow approval when there is no attendance yet (future/pre-checkin)
      // or attendance exists but checkout has not happened.
      if (attendance?.checkOutAt) {
        const requestEffectiveTime = new Date(existingRequest.updatedAt || existingRequest.createdAt);
        const checkoutTime = new Date(attendance.checkOutAt);
        if (requestEffectiveTime > checkoutTime) {
          const error = new Error('Cannot request OT after checkout. OT must be requested before checking out.');
          error.statusCode = 400;
          throw error;
        }
      }
    } else {
      // C2: SEPARATED re-validation at approval time.
      if (!attendance?.checkInAt || !attendance?.checkOutAt) {
        const error = new Error('Cannot approve separated OT: main shift attendance is incomplete');
        error.statusCode = 400;
        throw error;
      }

      if (!existingRequest.otStartTime || !existingRequest.estimatedEndTime) {
        const error = new Error('Cannot approve separated OT: missing otStartTime or estimatedEndTime');
        error.statusCode = 400;
        throw error;
      }

      const otStartTime = new Date(existingRequest.otStartTime);
      const estimatedEndTime = new Date(existingRequest.estimatedEndTime);
      if (isNaN(otStartTime.getTime()) || isNaN(estimatedEndTime.getTime())) {
        const error = new Error('Cannot approve separated OT: invalid OT time range');
        error.statusCode = 400;
        throw error;
      }

      if (!thresholdTime || otStartTime < thresholdTime) {
        const error = new Error(`Cannot approve separated OT: otStartTime must be at or after ${thresholdLabel} (GMT+7)`);
        error.statusCode = 400;
        throw error;
      }

      if (otStartTime <= new Date(attendance.checkOutAt)) {
        const error = new Error('Cannot approve separated OT: otStartTime must be after shift check-out');
        error.statusCode = 400;
        throw error;
      }

      if (estimatedEndTime <= otStartTime) {
        const error = new Error('Cannot approve separated OT: estimatedEndTime must be after otStartTime');
        error.statusCode = 400;
        throw error;
      }

      const separatedMinutes = getSeparatedOtDuration(otStartTime, estimatedEndTime);
      if (separatedMinutes < 30) {
        const error = new Error('Cannot approve separated OT: minimum duration is 30 minutes');
        error.statusCode = 400;
        throw error;
      }

      const nextDateKey = (() => {
        const [year, month, day] = existingRequest.date.split('-').map(Number);
        const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
        return nextDate.toISOString().slice(0, 10);
      })();
      const endDateKey = getDateKey(estimatedEndTime);
      if (endDateKey === nextDateKey) {
        const endHourMinute = new Date(estimatedEndTime.getTime() + (7 * 60 * 60 * 1000));
        const endTotalMinutes = endHourMinute.getUTCHours() * 60 + endHourMinute.getUTCMinutes();
        if (endTotalMinutes >= 8 * 60) {
          const error = new Error('Cannot approve separated OT: next-day end time must be before 08:00 (GMT+7)');
          error.statusCode = 400;
          throw error;
        }
      }

      const startDateKey = getDateKey(otStartTime);
      if (startDateKey !== existingRequest.date && startDateKey !== nextDateKey) {
        const error = new Error('Cannot approve separated OT: otStartTime must be on request date or immediate next day');
        error.statusCode = 400;
        throw error;
      }

      const endDateAllowed = endDateKey === existingRequest.date || endDateKey === nextDateKey;
      if (!endDateAllowed) {
        const error = new Error('Cannot approve separated OT: estimatedEndTime must be on request date or immediate next day');
        error.statusCode = 400;
        throw error;
      }

      if (startDateKey === nextDateKey) {
        const startHourMinute = new Date(otStartTime.getTime() + (7 * 60 * 60 * 1000));
        const startTotalMinutes = startHourMinute.getUTCHours() * 60 + startHourMinute.getUTCMinutes();
        if (startTotalMinutes >= 8 * 60) {
          const error = new Error('Cannot approve separated OT: next-day start time must be before 08:00 (GMT+7)');
          error.statusCode = 400;
          throw error;
        }
      }
    }
  }

  // STEP 3: Revalidate ADJUST_TIME requests (defense-in-depth)
  if (existingRequest.type === 'ADJUST_TIME') {
    const isForgotCheckout = existingRequest.adjustMode === 'FORGOT_CHECKOUT';
    let targetAttendance = null;

    if (isForgotCheckout) {
      if (!existingRequest.targetAttendanceId || !mongoose.Types.ObjectId.isValid(existingRequest.targetAttendanceId)) {
        const error = new Error('Cannot approve: invalid targetAttendanceId');
        error.statusCode = 400;
        throw error;
      }

      const targetQuery = Attendance.findOne({
        _id: existingRequest.targetAttendanceId,
        userId: existingRequest.userId._id
      }).select('_id date checkInAt checkOutAt closeSource needsReconciliation').lean();

      targetAttendance = session ? await targetQuery.session(session) : await targetQuery;

      if (!targetAttendance) {
        const error = new Error('Cannot approve: target attendance session not found');
        error.statusCode = 400;
        throw error;
      }

      if (targetAttendance.date !== existingRequest.date) {
        const error = new Error('Cannot approve: request.date must match target attendance date');
        error.statusCode = 400;
        throw error;
      }

      if (!targetAttendance.checkInAt) {
        const error = new Error('Cannot approve: missing check-in reference');
        error.statusCode = 400;
        throw error;
      }

      if (!existingRequest.requestedCheckOutAt) {
        const error = new Error('Cannot approve: requestedCheckOutAt is required for FORGOT_CHECKOUT');
        error.statusCode = 400;
        throw error;
      }

      if (existingRequest.requestedCheckInAt) {
        const error = new Error('Cannot approve: FORGOT_CHECKOUT does not accept requestedCheckInAt');
        error.statusCode = 400;
        throw error;
      }

      if (!targetAttendance.checkOutAt) {
        const error = new Error('Cannot approve: target session is still open');
        error.statusCode = 400;
        throw error;
      }

      if (targetAttendance.closeSource !== 'SYSTEM_AUTO_MIDNIGHT' || !targetAttendance.needsReconciliation) {
        await autoRejectWithSystemReason(
          requestId,
          approver._id,
          'SESSION_ALREADY_RECONCILED',
          session
        );
        const error = new Error('Cannot approve: target session already reconciled or not auto-closed');
        error.statusCode = 409;
        throw error;
      }
    }

    // Validate checkIn is on request.date
    if (existingRequest.requestedCheckInAt) {
      const checkInDateKey = getDateKey(new Date(existingRequest.requestedCheckInAt));
      if (checkInDateKey !== existingRequest.date) {
        const error = new Error('requestedCheckInAt must be on the same date as request date (GMT+7)');
        error.statusCode = 400;
        throw error;
      }
    }

    // Load grace config
    const sessionGraceMs = getCheckoutGraceMs();
    const sessionGraceHours = getCheckoutGraceHours();
    const submitMaxMs = getAdjustRequestMaxMs();
    const submitMaxDays = getAdjustRequestMaxDays();

    // Determine anchor time (needed for both Rule 1 and Rule 2)
    let anchorTime = null;
    if (isForgotCheckout) {
      anchorTime = new Date(targetAttendance.checkInAt);
    } else if (existingRequest.requestedCheckInAt) {
      anchorTime = new Date(existingRequest.requestedCheckInAt);
    } else {
      // Fetch attendance (with or without session)
      // P1-3 Fix: Only match if checkInAt exists and not null
      const attQuery = Attendance.findOne({
        userId: existingRequest.userId._id,
        date: existingRequest.date,
        checkInAt: { $exists: true, $ne: null }
      }).select('checkInAt').lean();
      
      const att = session ? await attQuery.session(session) : await attQuery;
      anchorTime = att?.checkInAt ? new Date(att.checkInAt) : null;
    }

    // Require anchor for ALL ADJUST_TIME requests (defense-in-depth)
    if (!anchorTime) {
      const error = new Error('Cannot approve: missing check-in reference');
      error.statusCode = 400;
      throw error;
    }

    // Rule 2: Submission window validation
    const requestCreated = new Date(existingRequest.createdAt);
    const submissionDelay = requestCreated - anchorTime;
    if (submissionDelay > submitMaxMs) {
      const error = new Error(
        `Request invalid: submitted >${submitMaxDays}d after check-in`
      );
      error.statusCode = 400;
      throw error;
    }

    // Rule 1: Session length (checkOut only)
    if (existingRequest.requestedCheckOutAt) {
      const checkOut = new Date(existingRequest.requestedCheckOutAt);
      const sessionLength = checkOut - anchorTime;
      
      if (sessionLength > sessionGraceMs) {
        const error = new Error(
          `Request invalid: session exceeds ${sessionGraceHours}h limit`
        );
        error.statusCode = 400;
        throw error;
      }

      if (checkOut <= anchorTime) {
        const error = new Error('Request invalid: checkOut must be after check-in');
        error.statusCode = 400;
        throw error;
      }
    }
  }

  // STEP 4: Atomic update Request status
  const approvalSet = {
    status: 'APPROVED',
    approvedBy: approver._id,
    approvedAt: new Date()
  };
  if (existingRequest.type === 'OT_REQUEST') {
    approvalSet.isOtSlotActive = true;
  }

  const updateQuery = Request.findOneAndUpdate(
    {
      _id: requestId,
      status: 'PENDING'
    },
    {
      $set: approvalSet
    },
    { new: true }
  ).populate('userId', 'teamId');

  const updatedRequest = session ? await updateQuery.session(session) : await updateQuery;

  // Race condition check (status already changed)
  if (!updatedRequest) {
    const checkQuery = Request.findById(requestId);
    const currentRequest = session ? await checkQuery.session(session) : await checkQuery;

    // Standalone path can fail after status update but before attendance update.
    // Best effort repair keeps behavior (409) while making retry safe.
    if (currentRequest?.status === 'APPROVED' && currentRequest?.type === 'ADJUST_TIME') {
      await updateAttendanceFromRequest(currentRequest, session, { repairMode: true }).catch(() => {});
    }

    const currentStatus = currentRequest ? currentRequest.status.toLowerCase() : 'unknown';
    const error = new Error(`Request already ${currentStatus}`);
    error.statusCode = 409;
    throw error;
  }

  // STEP 5: Type-specific post-approval updates
  
  // OT_REQUEST: Set mode-aware OT snapshot on attendance
  if (updatedRequest.type === 'OT_REQUEST') {
    const otMode = updatedRequest.otMode === 'SEPARATED' ? 'SEPARATED' : 'CONTINUOUS';
    const separatedOtMinutes = otMode === 'SEPARATED'
      ? getSeparatedOtDuration(new Date(updatedRequest.otStartTime), new Date(updatedRequest.estimatedEndTime))
      : null;

    const otQuery = Attendance.findOneAndUpdate(
      { 
        userId: updatedRequest.userId._id,
        date: updatedRequest.date 
      },
      { 
        $set: {
          otApproved: true,
          otMode,
          separatedOtMinutes
        }
      },
      { upsert: false }
    );
    
    if (session) {
      await otQuery.session(session);
    } else {
      await otQuery;
    }
  }
  
  // ADJUST_TIME: Update/create attendance
  if (updatedRequest.type === 'ADJUST_TIME') {
    const isForgotCheckout = updatedRequest.adjustMode === 'FORGOT_CHECKOUT';

    if (!isForgotCheckout) {
      const requestDate = updatedRequest.date;
      const month = requestDate.substring(0, 7);
      const holidayDates = await getHolidayDatesForMonth(month, session);

      if (isWeekend(requestDate) || holidayDates.has(requestDate)) {
        const error = new Error('Cannot approve time adjustment request for weekend/holiday');
        error.statusCode = 400;
        throw error;
      }
    }

    // Call refactored function with session
    await updateAttendanceFromRequest(updatedRequest, session);
  }

  return updatedRequest;
}

/**
 * Approve a request (transaction-safe wrapper)
 * P0-1 Fix: Support both replica set (with transactions) and standalone MongoDB.
 * 
 * RBAC: MANAGER can only approve requests from users in the same team.
 *       ADMIN can approve any request across the company.
 * 
 * @param {string} requestId - Request's ObjectId
 * @param {Object} approver - Approver user object (req.user)
 * @returns {Promise<Object>} Updated request
 */
export const approveRequest = async (requestId, approver) => {
  // Validate request ID format
  if (!mongoose.Types.ObjectId.isValid(requestId)) {
    const error = new Error('Invalid request ID');
    error.statusCode = 400;
    throw error;
  }

  // PATH A: Replica Set → Use transaction for atomicity
  if (isReplicaSetAvailable()) {
    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        return await approveRequestCore(requestId, approver, session);
      }, getTransactionOptions());
      return result;
    } finally {
      await session.endSession();
    }
  }
  
  // PATH B: Standalone → Direct execution (no transaction)
  else {
    return await approveRequestCore(requestId, approver, null);
  }
};

/**
 * Core rejection logic (extracted for transaction/non-transaction paths)
 * 
 * This function contains the business logic for rejecting a request.
 * It is transaction-agnostic and can be called with or without a session.
 * 
 * @param {string} requestId - Request's ObjectId
 * @param {Object} rejector - Rejector user object (req.user)
 * @param {string|null} rejectReason - Optional manager-provided reject reason
 * @param {Object|null} session - MongoDB session for transaction (null for standalone)
 * @returns {Promise<Object>} Updated request
 */
async function rejectRequestCore(requestId, rejector, rejectReason, session) {
  // STEP 1: Fetch request (with or without session)
  // Fix #5: Populate isActive and deletedAt to validate user status
  const query = Request.findById(requestId).populate('userId', 'teamId isActive deletedAt');
  const existingRequest = session ? await query.session(session) : await query;

  if (!existingRequest) {
    const error = new Error('Request not found');
    error.statusCode = 404;
    throw error;
  }

  // Fix #5: Validate user is active and not deleted
  if (!existingRequest.userId) {
    const error = new Error('Request user not found');
    error.statusCode = 400;
    throw error;
  }
  
  // Fix #7: Use explicit false check to support legacy users without isActive field
  // (!undefined === true) would incorrectly block legacy users, use (=== false) instead
  if (existingRequest.userId.isActive === false) {
    const error = new Error('Cannot reject request for inactive user');
    error.statusCode = 400;
    throw error;
  }
  
  if (existingRequest.userId.deletedAt) {
    const error = new Error('Cannot reject request for deleted user');
    error.statusCode = 400;
    throw error;
  }

  // STEP 2: RBAC check
  if (rejector.role === 'MANAGER') {
    if (!rejector.teamId) {
      const error = new Error('Manager must be assigned to a team');
      error.statusCode = 403;
      throw error;
    }

    if (!existingRequest.userId.teamId) {
      const error = new Error('Request user is not assigned to any team');
      error.statusCode = 403;
      throw error;
    }

    if (!rejector.teamId.equals(existingRequest.userId.teamId)) {
      const error = new Error('You can only reject requests from your team');
      error.statusCode = 403;
      throw error;
    }
  }

  // STEP 3: Atomic update
  const setFields = {
    status: 'REJECTED',
    approvedBy: rejector._id,
    approvedAt: new Date(),
    rejectReason: rejectReason ?? null
  };
  if (existingRequest.type === 'OT_REQUEST') {
    setFields.isOtSlotActive = false;
  }

  const updateQuery = Request.findOneAndUpdate(
    {
      _id: requestId,
      status: 'PENDING'
    },
    {
      $set: setFields
    },
    { new: true }
  ).populate('userId', 'name employeeCode email teamId');

  const updatedRequest = session ? await updateQuery.session(session) : await updateQuery;

  if (!updatedRequest) {
    const checkQuery = Request.findById(requestId);
    const currentRequest = session ? await checkQuery.session(session) : await checkQuery;
    const currentStatus = currentRequest ? currentRequest.status.toLowerCase() : 'unknown';
    const error = new Error(`Request already ${currentStatus}`);
    error.statusCode = 409;
    throw error;
  }

  return updatedRequest;
}

/**
 * Reject a request (transaction-safe wrapper)
 * P0-1 Fix: Support both replica set (with transactions) and standalone MongoDB.
 * 
 * RBAC: MANAGER can only reject requests from users in the same team.
 *       ADMIN can reject any request across the company.
 * 
 * @param {string} requestId - Request's ObjectId
 * @param {Object} rejector - Rejector user object (req.user)
 * @param {string|null} rejectReason - Optional manager-provided reject reason
 * @returns {Promise<Object>} Updated request
 */
export const rejectRequest = async (requestId, rejector, rejectReason = null) => {
  // Validate request ID format
  if (!mongoose.Types.ObjectId.isValid(requestId)) {
    const error = new Error('Invalid request ID');
    error.statusCode = 400;
    throw error;
  }

  // PATH A: Replica Set → Use transaction
  if (isReplicaSetAvailable()) {
    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        return await rejectRequestCore(requestId, rejector, rejectReason, session);
      }, getTransactionOptions());
      return result;
    } finally {
      await session.endSession();
    }
  }
  
  // PATH B: Standalone → Direct execution
  else {
    return await rejectRequestCore(requestId, rejector, rejectReason, null);
  }
};

/**
 * Update or create attendance record based on approved request.
 * P0-1 Fix: Added session parameter for transaction support.
 * Uses findOneAndUpdate with upsert to handle both create and update atomically.
 * Only updates the time fields that were requested.
 * 
 * Phase 2.1 (OT_REQUEST): Reconciles OT approval when upserting attendance.
 * Prevents bug: OT approved before check-in → ADJUST_TIME creates attendance → otApproved lost.
 * 
 * @param {Object} request - Approved request object
 * @param {Object} session - Mongoose session for transaction (optional)
 */
async function updateAttendanceFromRequest(request, session = null, options = {}) {
  const { userId, date, requestedCheckInAt, requestedCheckOutAt, adjustMode, targetAttendanceId } = request;
  const { repairMode = false } = options;

  // Extract ObjectId safely (handle both populated and non-populated userId)
  const userObjectId = userId?._id ?? userId;
  const isForgotCheckout = adjustMode === 'FORGOT_CHECKOUT';

  if (isForgotCheckout) {
    if (!targetAttendanceId || !mongoose.Types.ObjectId.isValid(targetAttendanceId)) {
      const error = new Error('Cannot reconcile attendance: invalid targetAttendanceId');
      error.statusCode = 400;
      throw error;
    }

    if (!requestedCheckOutAt) {
      const error = new Error('Cannot reconcile attendance: missing requestedCheckOutAt');
      error.statusCode = 400;
      throw error;
    }

    const filter = {
      _id: targetAttendanceId,
      userId: userObjectId,
      date,
      checkInAt: { $exists: true, $ne: null }
    };

    if (!repairMode) {
      filter.needsReconciliation = true;
      filter.closeSource = 'SYSTEM_AUTO_MIDNIGHT';
    }

    const update = {
      $set: {
        checkOutAt: requestedCheckOutAt,
        closeSource: 'ADJUST_APPROVAL',
        closedByRequestId: request._id ?? null,
        needsReconciliation: false
      }
    };

    const forgotQuery = Attendance.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true
    });

    const forgotUpdated = session ? await forgotQuery.session(session) : await forgotQuery;
    if (!forgotUpdated && !repairMode) {
      const currentQuery = Attendance.findOne({ _id: targetAttendanceId })
        .select('checkOutAt needsReconciliation closeSource')
        .lean();
      const current = session ? await currentQuery.session(session) : await currentQuery;
      const requestedMs = new Date(requestedCheckOutAt).getTime();
      const currentMs = current?.checkOutAt ? new Date(current.checkOutAt).getTime() : NaN;

      if (current && !current.needsReconciliation && current.closeSource === 'ADJUST_APPROVAL' && currentMs === requestedMs) {
        return;
      }

      const error = new Error('Target attendance session already reconciled or changed');
      error.statusCode = 409;
      throw error;
    }

    return;
  }

  const updateFields = {};

  if (requestedCheckInAt) {
    updateFields.checkInAt = requestedCheckInAt;
  }

  if (requestedCheckOutAt) {
    updateFields.checkOutAt = requestedCheckOutAt;
    updateFields.closeSource = 'ADJUST_APPROVAL';
    updateFields.closedByRequestId = request._id ?? null;
    updateFields.needsReconciliation = false;
  }

  // Rehydrate OT approval snapshot when attendance is recreated/updated.
  const otQuery = Request.findOne({
    userId: userObjectId,
    type: 'OT_REQUEST',
    status: 'APPROVED',
    $or: [{ date }, { checkInDate: date }]
  })
    .select('otMode otStartTime estimatedEndTime')
    .sort({ approvedAt: -1, updatedAt: -1, createdAt: -1 })
    .lean();
  
  const approvedOt = session ? await otQuery.session(session) : await otQuery;

  if (approvedOt) {
    updateFields.otApproved = true;
    const approvedOtMode = approvedOt.otMode === 'SEPARATED' ? 'SEPARATED' : 'CONTINUOUS';
    updateFields.otMode = approvedOtMode;
    updateFields.separatedOtMinutes = approvedOtMode === 'SEPARATED'
      ? getSeparatedOtDuration(new Date(approvedOt.otStartTime), new Date(approvedOt.estimatedEndTime))
      : null;
  } else {
    updateFields.otApproved = false;
    updateFields.otMode = null;
    updateFields.separatedOtMinutes = null;
  }

  // Defensive check: cannot create new attendance without checkInAt
  // (validation in createRequest should prevent this, but guard here for safety)
  const existsQuery = Attendance.exists({ 
    userId: userObjectId, 
    date 
  });
  
  const exists = session ? await existsQuery.session(session) : await existsQuery;

  if (!exists && !requestedCheckInAt) {
    const error = new Error('Cannot create attendance without check-in time');
    error.statusCode = 400;
    throw error;
  }

  // Atomic upsert: create if not exists, update if exists
  const upsertOptions = { 
    upsert: true, 
    new: true, 
    runValidators: true
  };
  
  // P1-1 Fix: Conditionally add session only if it exists
  if (session) {
    upsertOptions.session = session;
  }
  
  await Attendance.findOneAndUpdate(
    { userId: userObjectId, date },
    {
      $set: updateFields,
      $setOnInsert: {
        userId: userObjectId,
        date
      }
    },
    upsertOptions
  );
}

// ---------------------------------------------------------------------------
// Compatibility re-exports (domain functions moved to dedicated service modules)
// All call sites (requestController.js, attendanceController.js etc.) remain
// valid without any import changes.
// ---------------------------------------------------------------------------
export { createAdjustTimeRequest } from './adjustTimeService.js';
export { createLeaveRequest, getApprovedLeaveDates } from './leaveService.js';
export { createOtRequest, cancelOtRequest } from './otService.js';
