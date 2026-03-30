import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import Request from '../models/Request.js';
import WorkScheduleRegistration from '../models/WorkScheduleRegistration.js';
import { getDateRange, getTodayDateKey, isWeekend } from '../utils/dateUtils.js';
import { computeAttendance } from '../utils/attendanceCompute.js';
import { clampPage } from '../utils/pagination.js';
import { getAdjustRequestMaxDays, getAdjustRequestMaxMs, getCheckoutGraceMs } from '../utils/graceConfig.js';
import { getHolidayDatesForMonth } from '../utils/holidayUtils.js';
import {
  buildAttendanceScheduleSnapshot,
  isScheduleEnforcedForDate,
  normalizeScheduleType
} from '../utils/schedulePolicy.js';

const isWorkdayDate = (dateKey, holidayDates = new Set()) =>
  !isWeekend(dateKey) && !holidayDates.has(dateKey);

const toComputedStatus = (status) => (status === 'UNKNOWN' ? null : status);

const resolveAttendanceScheduleType = (attendanceRecord, registeredScheduleType = null) => {
  const snapshotType = normalizeScheduleType(attendanceRecord?.scheduleType);
  if (snapshotType) return snapshotType;
  const registeredType = normalizeScheduleType(registeredScheduleType);
  return registeredType || null;
};

/**
 * Check-in: Create today's attendance with checkInAt timestamp.
 * Cross-midnight OT: Block if ANY open session exists (not just today).
 * Logs stale sessions (outside grace period) to AuditLog for admin review.
 * 
 * @param {string} userId - User's ObjectId
 * @returns {Promise<Object>} Attendance record
 */
export const checkIn = async (userId) => {
  const dateKey = getTodayDateKey();
  const graceMs = getCheckoutGraceMs();
  const earliestAllowed = new Date(Date.now() - graceMs);

  // Check for ANY open session (cross-midnight OT: not limited to today)
  // Load up to 2 to detect anomalies (multiple open sessions) without scanning all docs.
  const openSessions = await Attendance.find({
    userId,
    checkInAt: { $exists: true, $ne: null },
    checkOutAt: null
  }).sort({ checkInAt: 1 }).limit(2).select('_id date checkInAt').lean();

  const openSession = openSessions[0] || null;

  if (openSession) {
    // Log if stale (outside grace period)
    if (openSession.checkInAt < earliestAllowed) {
      // Best-effort logging: Don't block check-in if AuditLog fails
      AuditLog.create({
        type: 'STALE_OPEN_SESSION',
        userId,
        details: {
          sessionDate: openSession.date,
          checkInAt: openSession.checkInAt,
          detectedAt: 'checkIn'
        }
      }).catch(() => {});
    }

    const isAnomaly = openSessions.length > 1;
    const openSessionCount = isAnomaly
      ? await Attendance.countDocuments({
        userId,
        checkInAt: { $exists: true, $ne: null },
        checkOutAt: null
      })
      : openSessions.length;

    if (isAnomaly) {
      AuditLog.create({
        type: 'MULTIPLE_ACTIVE_SESSIONS',
        userId,
        details: {
          sessionCount: openSessionCount,
          sessions: openSessions
        }
      }).catch(() => {});
    }

    // Block check-in when open sessions still exist.
    // Guardrail: needsReconciliation must NEVER block check-in by itself.
    const error = new Error(
      `You have an open session from ${openSession.date}. Please checkout first.`
    );
    error.statusCode = isAnomaly ? 409 : 400;
    error.code = isAnomaly ? 'OPEN_SESSION_ANOMALY' : 'OPEN_SESSION_BLOCKED';
    error.payload = {
      openSession: {
        id: String(openSession._id),
        date: openSession.date,
        checkInAt: openSession.checkInAt
      },
      openSessionCount,
      resolutionPath: isAnomaly
        ? 'CONTACT_ADMIN_FORCE_CHECKOUT'
        : 'CHECKOUT_CURRENT_SESSION'
    };
    throw error;
  }

  const holidayDates = await getHolidayDatesForMonth(dateKey.slice(0, 7));
  const isTodayWorkday = isWorkdayDate(dateKey, holidayDates);

  const registration = await WorkScheduleRegistration.findOne({
    userId,
    workDate: dateKey
  }).select('scheduleType').lean();

  if (isTodayWorkday && !registration?.scheduleType) {
    const error = new Error('Schedule is required before check-in');
    error.statusCode = 400;
    error.code = 'SCHEDULE_REQUIRED';
    error.payload = {
      redirectTo: '/my-schedule',
      workDate: dateKey
    };
    throw error;
  }

  const attendanceSnapshot = (isTodayWorkday && registration?.scheduleType)
    ? buildAttendanceScheduleSnapshot(registration.scheduleType, 'REGISTERED')
    : buildAttendanceScheduleSnapshot('SHIFT_1', 'LEGACY_BACKFILL');

  // Create today's attendance (rely on unique constraint for duplicate detection)
  let attendance;
  try {
    attendance = await Attendance.create({
      userId,
      date: dateKey,
      checkInAt: new Date(),
      ...attendanceSnapshot
    });
  } catch (err) {
    // Unique constraint violation: user already checked in today
    if (err?.code === 11000) {
      const error = new Error('Already checked in');
      error.statusCode = 400;
      throw error;
    }
    throw err;
  }

  // Phase 2.1 (OT_REQUEST): Auto-apply approved OT if exists
  // Handles case where OT request was approved BEFORE check-in
  // P1 Fix: Use $or to support legacy data (date vs checkInDate field)
  const approvedOt = await Request.findOne({
    userId,
    type: 'OT_REQUEST',
    status: 'APPROVED',
    $or: [{ date: dateKey }, { checkInDate: dateKey }]
  })
    .select('otMode otStartTime estimatedEndTime')
    .sort({ approvedAt: -1, updatedAt: -1, createdAt: -1 })
    .lean();

  const approvedOtMode = approvedOt?.otMode === 'SEPARATED' ? 'SEPARATED' : 'CONTINUOUS';

  // Auto-apply only continuous OT at check-in path.
  if (approvedOt && approvedOtMode === 'CONTINUOUS') {
    attendance = await Attendance.findByIdAndUpdate(
      attendance._id,
      {
        $set: {
          otApproved: true,
          otMode: 'CONTINUOUS',
          separatedOtMinutes: null
        }
      },
      { new: true }
    );
  }

  return {
    userId: attendance.userId,
    date: attendance.date,
    checkInAt: attendance.checkInAt,
    checkOutAt: attendance.checkOutAt,
    scheduleType: attendance.scheduleType || null,
    otApproved: !!attendance.otApproved,
    otMode: attendance.otMode || null,
    separatedOtMinutes: attendance.separatedOtMinutes ?? null
  };
};


/**
 * Check-out: Update attendance with checkOutAt timestamp.
 * Cross-midnight OT: Supports checkout of sessions from previous days (within grace period).
 * Business rules:
 * - Must check-in first
 * - Session must be within grace period (default 24h)
 * - If ANY stale session exists, log and block (prevents stuck state)
 * - Multiple open sessions are logged to AuditLog
 * - Most recent non-stale session is checked out
 * 
 * @param {string} userId - User's ObjectId
 * @returns {Promise<Object>} Attendance record
 */
export const checkOut = async (userId) => {
  const graceMs = getCheckoutGraceMs();
  const earliestAllowed = new Date(Date.now() - graceMs);

  // Load ALL open sessions (no grace filter) - single query
  // Sort by newest first to checkout most recent
  // Defense: Limit to 200 sessions to prevent OOM if data corruption occurs
  const openSessions = await Attendance.find({
    userId,
    checkInAt: { $exists: true, $ne: null },
    checkOutAt: null
  }).select('_id date checkInAt').sort({ checkInAt: -1 }).limit(200).lean();

  // No open sessions at all
  if (openSessions.length === 0) {
    const error = new Error('Must check in first');
    error.statusCode = 400;
    throw error;
  }

  // Log if multiple open sessions exist (data anomaly)
  // Count ALL open sessions (not just active)
  if (openSessions.length > 1) {
    // Best-effort logging: Don't block checkout if AuditLog fails
    AuditLog.create({
      type: 'MULTIPLE_ACTIVE_SESSIONS',
      userId,
      details: {
        sessionCount: openSessions.length,
        sessions: openSessions.slice(0, 100) // Cap to prevent bloat
      }
    }).catch(() => {});
  }

  // Check if ANY stale session exists
  // Policy: Block checkout if stale exists to prevent stuck state
  const staleSession = openSessions.find(s => s.checkInAt < earliestAllowed);
  if (staleSession) {
    // Best-effort logging: Don't block checkout if AuditLog fails
    AuditLog.create({
      type: 'STALE_OPEN_SESSION',
      userId,
      details: {
        sessionDate: staleSession.date,
        checkInAt: staleSession.checkInAt,
        detectedAt: 'checkOut'
      }
    }).catch(() => {});

    const error = new Error(
      `Session from ${staleSession.date} expired. Contact admin.`
    );
    error.statusCode = 400;
    throw error;
  }

  // Checkout most recent session (atomic update by _id)
  const targetSession = openSessions[0]; // Already sorted newest first
  const updated = await Attendance.findOneAndUpdate(
    { _id: targetSession._id, checkOutAt: null },
    {
      $set: {
        checkOutAt: new Date(),
        closeSource: 'USER_CHECKOUT',
        closedByRequestId: null,
        needsReconciliation: false
      }
    },
    { new: true, runValidators: true }
  );

  // Race condition: someone else checked out this session
  if (!updated) {
    const error = new Error('Already checked out');
    error.statusCode = 400;
    throw error;
  }

  return {
    userId: updated.userId,
    date: updated.date,
    checkInAt: updated.checkInAt,
    checkOutAt: updated.checkOutAt,
    scheduleType: updated.scheduleType || null
  };
};

/**
 * Get monthly attendance history for a user with computed fields.
 * Returns ALL days in the month (1-31) with status computed for each day.
 * Phase 3: Generates full month to show LEAVE/ABSENT for days without attendance records.
 * 
 * @param {string} userId - User's ObjectId
 * @param {string} month - "YYYY-MM" format (e.g., "2026-01")
 * @param {Set<string>} holidayDates - Set of holiday dateKeys (optional)
 * @param {Set<string>} leaveDates - Set of approved leave dateKeys (optional, Phase 3)
 * @returns {Promise<Array>} Array of ALL days in month with computed fields
 */
export const getMonthlyHistory = async (userId, month, holidayDates = new Set(), leaveDates = new Set()) => {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const error = new Error('Invalid month format. Expected YYYY-MM');
    error.statusCode = 400;
    throw error;
  }

  // Generate all days in month (1-31 or fewer for shorter months)
  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  // P1 Fix: Don't generate future dates in current month (RULES.md §3.2: future → status null)
  // Only show days up to today to avoid showing ABSENT for future dates
  const todayKey = getTodayDateKey();
  const isCurrentMonth = todayKey.startsWith(month);
  const endDay = isCurrentMonth
    ? Math.min(Number(todayKey.slice(8, 10)), daysInMonth)
    : daysInMonth;

  const allDates = Array.from({ length: endDay }, (_, i) =>
    `${month}-${String(i + 1).padStart(2, '0')}`
  );

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(endDay).padStart(2, '0')}`;

  // Fetch existing attendance records for the month
  const records = await Attendance.find({
    userId,
    date: { $regex: `^${month}` }
  })
  .select(
    'date checkInAt checkOutAt otApproved otMode separatedOtMinutes ' +
    'scheduleType scheduledStartMinutes scheduledEndMinutes lateGraceMinutes ' +
    'lateTrackingEnabled earlyLeaveTrackingEnabled scheduleSource'
  )
  .lean();

  const registrations = await WorkScheduleRegistration.find({
    userId,
    workDate: { $gte: monthStart, $lte: monthEnd }
  })
    .select('workDate scheduleType')
    .lean();

  // Build attendance lookup map for O(1) access
  const attendanceMap = new Map(records.map(r => [r.date, r]));
  const registrationMap = new Map(registrations.map((item) => [item.workDate, item]));

  // Process ALL days in month (including days without attendance records)
  return allDates.map(dateKey => {
    const registration = registrationMap.get(dateKey) || null;
    const isWorkday = isWorkdayDate(dateKey, holidayDates);
    const hasValidScheduleRegistration = Boolean(isWorkday && registration?.scheduleType);

    // Get existing record or create synthetic empty record
    const record = attendanceMap.get(dateKey) || {
      date: dateKey,
      checkInAt: null,
      checkOutAt: null,
      otApproved: false,
      otMode: null,
      separatedOtMinutes: null,
      scheduleType: null
    };

    // Compute status for this day (handles LEAVE, ABSENT, WEEKEND_OR_HOLIDAY, etc.)
    const computed = computeAttendance(
      {
        date: record.date,
        checkInAt: record.checkInAt,
        checkOutAt: record.checkOutAt,
        otApproved: record.otApproved,
        otMode: record.otMode,
        separatedOtMinutes: record.separatedOtMinutes,
        scheduleType: record.scheduleType,
        scheduledStartMinutes: record.scheduledStartMinutes,
        scheduledEndMinutes: record.scheduledEndMinutes,
        lateGraceMinutes: record.lateGraceMinutes,
        lateTrackingEnabled: record.lateTrackingEnabled,
        earlyLeaveTrackingEnabled: record.earlyLeaveTrackingEnabled,
        scheduleSource: record.scheduleSource
      },
      holidayDates,
      leaveDates,
      {
        hasValidScheduleRegistration,
        isScheduleEnforcementActive: isScheduleEnforcedForDate(dateKey)
      }
    );

    const scheduleType = isWorkday
      ? resolveAttendanceScheduleType(record, registration?.scheduleType || null)
      : null;

    return {
      date: record.date,
      checkInAt: record.checkInAt,
      checkOutAt: record.checkOutAt,
      scheduleType,
      status: toComputedStatus(computed.status),
      lateMinutes: computed.lateMinutes,
      workMinutes: computed.workMinutes,
      otMinutes: computed.otMinutes,
      otApproved: !!record.otApproved,
      otMode: record.otMode || null,
      separatedOtMinutes: record.separatedOtMinutes ?? null
    };
  });
};

/**
 * Get today's activity for multiple users (Member Management).
 * Performance: N+1 safe - Query users -> Query attendances -> Map in memory.
 * 
 * Status Logic (RULES.md Priority):
 * 1. WEEKEND_OR_HOLIDAY if today is weekend/holiday
 * 2. null if no attendance record
 * 3. WORKING/LATE/ON_TIME if record exists
 * 
 * @param {string} scope - 'team' or 'company'
 * @param {string|null} teamId - Required if scope is 'team'
 * @param {Set<string>} holidayDates - Set of holiday dateKeys
 * @param {Object} pagination - { page, limit } from controller (v2.5)
 * @returns {Promise<Object>} { date, items, pagination }
 */

export const getTodayActivity = async (scope, teamId, holidayDates = new Set(), pagination = {}) => {
  const todayKey = getTodayDateKey();
  const { page = 1, limit = 20 } = pagination;

  // Validate scope (consistent with reportService pattern)
  if (!scope || !['team', 'company'].includes(scope)) {
    const error = new Error('Invalid scope. Expected "team" or "company"');
    error.statusCode = 400;
    throw error;
  }

  // Step 1: Build user query based on scope (active + soft delete filter)
  // Use $or to handle legacy users without deletedAt field (consistent with requestService)
  const userQuery = {
    isActive: true,
    $or: [
      { deletedAt: null },
      { deletedAt: { $exists: false } }
    ]
  };
  if (scope === 'team') {
    if (!teamId) {
      const error = new Error('Team ID is required for team scope');
      error.statusCode = 400;
      throw error;
    }
    userQuery.teamId = teamId;
  }

  // Step 2: Count total FIRST (v2.5 pagination)
  const total = await User.countDocuments(userQuery);

  if (total === 0) {
    return {
      date: todayKey,
      items: [],
      pagination: { page: 1, limit, total: 0, totalPages: 0 }
    };
  }

  // Step 3: Clamp page and calculate skip (v2.5)
  const { page: clampedPage, totalPages, skip } = clampPage(page, total, limit);

  // Step 4: Query users with pagination
  const users = await User.find(userQuery)
    .select('_id employeeCode name email username startDate role teamId isActive')
    .sort({ employeeCode: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Step 2: Query today's attendance (N+1 safe)
  const userIds = users.map(u => u._id);
  const attendanceRecords = await Attendance.find({
    userId: { $in: userIds },
    date: todayKey
  })
    .select(
      'userId date checkInAt checkOutAt otApproved otMode separatedOtMinutes ' +
      'scheduleType scheduledStartMinutes scheduledEndMinutes lateGraceMinutes ' +
      'lateTrackingEnabled earlyLeaveTrackingEnabled scheduleSource'
    )
    .lean();

  const todayRegistrations = await WorkScheduleRegistration.find({
    userId: { $in: userIds },
    workDate: todayKey
  })
    .select('userId scheduleType')
    .lean();

  // Step 3: Map attendance to user in memory
  const attendanceMap = new Map();
  for (const record of attendanceRecords) {
    attendanceMap.set(String(record.userId), record);
  }

  const scheduleMap = new Map();
  for (const registration of todayRegistrations) {
    scheduleMap.set(String(registration.userId), registration.scheduleType || null);
  }

  const isTodayWorkday = isWorkdayDate(todayKey, holidayDates);
  const isTodayScheduleEnforced = isScheduleEnforcedForDate(todayKey);

  // Step 4: Compute status for each user
  const items = users.map(user => {
    const attendance = attendanceMap.get(String(user._id)) || null;
    const registeredScheduleType = scheduleMap.get(String(user._id)) || null;
    const hasValidScheduleRegistration = Boolean(isTodayWorkday && registeredScheduleType);
    const isTodayWeekendOrHoliday = !isTodayWorkday;

    // Compute status following RULES.md priority
    let status = null;
    let lateMinutes = 0;
    let workMinutes = 0;
    let otMinutes = 0;

    // No attendance record:
    // - weekend/holiday => WEEKEND_OR_HOLIDAY
    // - workday => null (NOT ABSENT for today)
    if (!attendance) {
      const computed = computeAttendance(
        {
          date: todayKey,
          checkInAt: null,
          checkOutAt: null
        },
        holidayDates,
        new Set(),
        {
          hasValidScheduleRegistration,
          isScheduleEnforcementActive: isTodayScheduleEnforced
        }
      );
      status = toComputedStatus(computed.status);
    } else {
      // Has attendance record: always compute to include work/OT metrics
      const computed = computeAttendance(
        { 
          date: todayKey, 
          checkInAt: attendance.checkInAt, 
          checkOutAt: attendance.checkOutAt,
          otApproved: attendance.otApproved,
          otMode: attendance.otMode,
          separatedOtMinutes: attendance.separatedOtMinutes,
          scheduleType: attendance.scheduleType,
          scheduledStartMinutes: attendance.scheduledStartMinutes,
          scheduledEndMinutes: attendance.scheduledEndMinutes,
          lateGraceMinutes: attendance.lateGraceMinutes,
          lateTrackingEnabled: attendance.lateTrackingEnabled,
          earlyLeaveTrackingEnabled: attendance.earlyLeaveTrackingEnabled,
          scheduleSource: attendance.scheduleSource
        },
        holidayDates,
        new Set(),  // today view doesn't show LEAVE
        {
          hasValidScheduleRegistration,
          isScheduleEnforcementActive: isTodayScheduleEnforced
        }
      );
      status = toComputedStatus(computed.status);
      lateMinutes = computed.lateMinutes;
      workMinutes = computed.workMinutes;
      otMinutes = computed.otMinutes;
    }

    const scheduleType = isTodayWorkday
      ? resolveAttendanceScheduleType(attendance, registeredScheduleType)
      : null;

    return {
      user: {
        _id: user._id,
        employeeCode: user.employeeCode,
        name: user.name,
        email: user.email,
        username: user.username,
        startDate: user.startDate,
        role: user.role,
        teamId: user.teamId,
        isActive: user.isActive
      },
      attendance: attendance ? {
        date: attendance.date,
        checkInAt: attendance.checkInAt,
        checkOutAt: attendance.checkOutAt
      } : null,
      scheduleType,
      computed: {
        status,
        lateMinutes,
        workMinutes,
        otMinutes
      }
    };
  });

  return {
    date: todayKey,
    items,
    pagination: {
      page: clampedPage,
      limit,
      total,
      totalPages
    }
  };
};


/**
 * Get monthly attendance history for a specific user (Member Management).
 * Handles RBAC/Anti-IDOR authorization, month normalization, holiday + leave fetching,
 * and delegates to getMonthlyHistory.
 *
 * @param {string} targetUserId - The user whose attendance is being fetched (validated ObjectId string)
 * @param {string|undefined} month - "YYYY-MM" string (raw from query, may be undefined)
 * @param {Object} requestingUser - req.user ({ role, teamId, _id })
 * @returns {Promise<Array>} Array of attendance day items
 */
export const getAttendanceByUserId = async (targetUserId, month, requestingUser) => {
  const { role, teamId: requestingUserTeamId } = requestingUser;

  // Block Employee role
  if (role === 'EMPLOYEE') {
    const error = new Error('Insufficient permissions. Manager or Admin required.');
    error.statusCode = 403;
    throw error;
  }

  // Manager without teamId cannot access member management
  if (role === 'MANAGER' && !requestingUserTeamId) {
    const error = new Error('Manager must be assigned to a team');
    error.statusCode = 403;
    throw error;
  }

  // Normalize month (handle whitespace + array handled by controller before call)
  if (!month) {
    const today = getTodayDateKey();
    month = today.substring(0, 7);
  } else if (!/^\d{4}-\d{2}$/.test(month)) {
    const error = new Error('Invalid month format. Expected YYYY-MM (e.g., 2026-01)');
    error.statusCode = 400;
    throw error;
  }

  // Query-level Anti-IDOR:
  // - MANAGER: verify target user is in same team
  // - ADMIN: can access any user (but not soft-deleted)
  let targetUser;

  if (role === 'MANAGER') {
    targetUser = await User.findOne({
      _id: targetUserId,
      teamId: requestingUserTeamId,
      deletedAt: null
    })
      .select('_id')
      .lean();

    if (!targetUser) {
      const error = new Error('Access denied. You can only view users in your team.');
      error.statusCode = 403;
      throw error;
    }
  } else {
    targetUser = await User.findOne({
      _id: targetUserId,
      deletedAt: null
    })
      .select('_id')
      .lean();

    if (!targetUser) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
  }

  // Fetch holidays for the month
  const holidayDates = await getHolidayDatesForMonth(month);

  // Fetch approved leave dates for this user in this month
  const { getApprovedLeaveDates } = await import('./requestService.js');
  const leaveDates = await getApprovedLeaveDates(targetUserId, month);

  return getMonthlyHistory(targetUserId, month, holidayDates, leaveDates);
};

/**
 * Force-close a stale open attendance session (Admin correction workflow).
 * Handles attendance lookup, all business validations, and persists the checkout.
 *
 * @param {string} attendanceId - Validated ObjectId string of the Attendance record
 * @param {Date} checkOutDate - Parsed, valid Date object for the forced checkout time
 * @returns {Promise<Object>} Sanitized attendance record
 */
export const forceCheckoutAttendance = async (attendanceId, checkOutDate) => {
  const attendance = await Attendance.findById(attendanceId);

  if (!attendance) {
    const error = new Error('Attendance record not found');
    error.statusCode = 404;
    throw error;
  }

  if (!attendance.checkInAt) {
    const error = new Error('Cannot force checkout: No check-in recorded');
    error.statusCode = 400;
    throw error;
  }

  if (attendance.checkOutAt) {
    const error = new Error('Already checked out. Use PATCH if you need to modify existing checkout.');
    error.statusCode = 400;
    throw error;
  }

  if (checkOutDate <= new Date(attendance.checkInAt)) {
    const error = new Error('checkOutAt must be after checkInAt');
    error.statusCode = 400;
    throw error;
  }

  // Perform forced checkout
  attendance.checkOutAt = checkOutDate;
  attendance.closeSource = 'ADMIN_FORCE';
  attendance.closedByRequestId = null;
  attendance.needsReconciliation = false;
  await attendance.save();

  return {
    _id: attendance._id,
    userId: attendance.userId,
    date: attendance.date,
    checkInAt: attendance.checkInAt,
    checkOutAt: attendance.checkOutAt,
    scheduleType: attendance.scheduleType || null
  };
};

/**
 * Get check-in blocking and reconciliation context for the current user.
 * Used by UI to decide whether to show "forgot checkout" path without trial-and-error.
 *
 * @param {string} userId - Current user id
 * @returns {Promise<Object>} Open session / reconciliation context
 */
export const getOpenSessionContext = async (userId) => {
  const adjustWindowMs = getAdjustRequestMaxMs();
  const adjustWindowDays = getAdjustRequestMaxDays();
  const escalationMs = 4 * 60 * 60 * 1000; // 4 working hours (Phase A data signal only)
  const now = Date.now();

  const openSessions = await Attendance.find({
    userId,
    checkInAt: { $exists: true, $ne: null },
    checkOutAt: null
  })
    .sort({ checkInAt: 1 })
    .limit(20)
    .select('_id date checkInAt checkOutAt')
    .lean();

  const openSession = openSessions[0] || null;

  const needsReconciliation = await Attendance.find({
    userId,
    closeSource: 'SYSTEM_AUTO_MIDNIGHT',
    needsReconciliation: true
  })
    .sort({ date: -1, updatedAt: -1 })
    .limit(20)
    .select('_id date checkInAt checkOutAt closeSource needsReconciliation updatedAt')
    .lean();

  const reconciliationItems = [];
  for (const session of needsReconciliation) {
    const pendingReq = await Request.findOne({
      userId,
      type: 'ADJUST_TIME',
      adjustMode: 'FORGOT_CHECKOUT',
      targetAttendanceId: session._id,
      status: 'PENDING'
    }).select('_id createdAt').lean();

    const checkInAtMs = session.checkInAt ? new Date(session.checkInAt).getTime() : 0;
    const submitDeadline = checkInAtMs ? new Date(checkInAtMs + adjustWindowMs) : null;

    reconciliationItems.push({
      attendanceId: String(session._id),
      date: session.date,
      checkInAt: session.checkInAt,
      checkOutAt: session.checkOutAt,
      submitDeadline,
      adjustWindowDays,
      isOverdue: submitDeadline ? now > submitDeadline.getTime() : false,
      pendingRequestId: pendingReq?._id ? String(pendingReq._id) : null,
      pendingRequestCreatedAt: pendingReq?.createdAt || null,
      isEscalated: pendingReq?.createdAt
        ? (now - new Date(pendingReq.createdAt).getTime()) > escalationMs
        : false
    });
  }

  return {
    openSessionCount: openSessions.length,
    hasAnomaly: openSessions.length > 1,
    openSession: openSession
      ? {
        attendanceId: String(openSession._id),
        date: openSession.date,
        checkInAt: openSession.checkInAt
      }
      : null,
    needsReconciliationCount: reconciliationItems.length,
    needsReconciliation: reconciliationItems
  };
};

/**
 * Admin queue for open sessions and pending forgot-checkout reconciliations.
 *
 * @param {Object} options - Query options
 * @param {string} options.status - all | open | reconciliation
 * @param {number} options.limit - Max items to return
 * @returns {Promise<Array>} Queue items
 */
export const getAdminOpenSessionsQueue = async (options = {}) => {
  const adjustWindowMs = getAdjustRequestMaxMs();
  const escalationMs = 4 * 60 * 60 * 1000; // 4 working hours (Phase A data signal only)
  const now = Date.now();
  const status = typeof options.status === 'string'
    ? options.status.trim().toLowerCase()
    : 'all';
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(500, options.limit)) : 100;

  let filter;
  if (status === 'open') {
    filter = { checkOutAt: null };
  } else if (status === 'reconciliation') {
    filter = { needsReconciliation: true };
  } else {
    filter = {
      $or: [
        { checkOutAt: null },
        { needsReconciliation: true }
      ]
    };
  }

  const records = await Attendance.find(filter)
    .sort({ date: 1, checkInAt: 1 })
    .limit(limit)
    .select('_id userId date checkInAt checkOutAt closeSource needsReconciliation closedByRequestId updatedAt')
    .populate('userId', 'name employeeCode email role teamId')
    .lean();

  const items = await Promise.all(records.map(async (record) => {
    const checkInAtMs = record.checkInAt ? new Date(record.checkInAt).getTime() : 0;
    const submitDeadline = checkInAtMs ? new Date(checkInAtMs + adjustWindowMs) : null;
    const pendingReq = record.needsReconciliation
      ? await Request.findOne({
        userId: record.userId?._id || record.userId,
        type: 'ADJUST_TIME',
        adjustMode: 'FORGOT_CHECKOUT',
        targetAttendanceId: record._id,
        status: 'PENDING'
      }).select('_id createdAt').lean()
      : null;

    const isEscalated = pendingReq?.createdAt
      ? (now - new Date(pendingReq.createdAt).getTime()) > escalationMs
      : false;

    const queueStatus = record.checkOutAt == null
      ? 'OPEN'
      : (record.needsReconciliation
        ? (isEscalated ? 'ESCALATED' : 'PENDING_RECONCILIATION')
        : 'CLOSED');

    return {
      attendanceId: String(record._id),
      user: record.userId || null,
      date: record.date,
      checkInAt: record.checkInAt,
      checkOutAt: record.checkOutAt,
      closeSource: record.closeSource || 'LEGACY',
      needsReconciliation: !!record.needsReconciliation,
      closedByRequestId: record.closedByRequestId ? String(record.closedByRequestId) : null,
      queueStatus,
      submitDeadline,
      isOverdue: submitDeadline ? now > submitDeadline.getTime() : false,
      pendingRequestId: pendingReq?._id ? String(pendingReq._id) : null,
      pendingRequestCreatedAt: pendingReq?.createdAt || null,
      isEscalated,
      updatedAt: record.updatedAt
    };
  }));

  return items;
};
