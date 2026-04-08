import {
  isToday,
  isWeekend,
  getMinutesDiff,
  createTimeInGMT7,
  getDateKey,
  getTodayDateKey
} from './dateUtils.js';
import {
  getLateThresholdForDate,
  getOtThresholdTimeForDate,
  getShiftEndTimeForDate,
  getShiftStartTimeForDate,
  isFlexibleScheduleType,
  isScheduleEnforcedForDate,
  resolveAttendanceScheduleSnapshot
} from './schedulePolicy.js';

/**
 * Normalize dateKey to "YYYY-MM-DD" format in GMT+7.
 * Handles Date, ISO string, and already formatted string.
 *
 * @param {Date|string} date
 * @returns {string}
 */
function normalizeDateKey(date) {
  if (!date) return '';

  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      testDate.getUTCFullYear() !== year ||
      testDate.getUTCMonth() !== month - 1 ||
      testDate.getUTCDate() !== day
    ) {
      return '';
    }
    return date;
  }

  if (typeof date === 'string' && date.includes('T')) {
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) return getDateKey(parsed);

    const maybeDate = date.split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(maybeDate) ? maybeDate : '';
  }

  if (date instanceof Date) {
    return isNaN(date.getTime()) ? '' : getDateKey(date);
  }

  return '';
}

/**
 * Normalize timestamp to Date object.
 *
 * @param {Date|string|number|null|undefined} timestamp
 * @returns {Date|null}
 */
function normalizeTimestamp(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) {
    return isNaN(timestamp.getTime()) ? null : timestamp;
  }
  const parsed = new Date(timestamp);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function computeNoAttendanceStatus(dateKey, leaveDates, options = {}) {
  const todayKey = getTodayDateKey();
  const today = dateKey === todayKey;
  const isFuture = dateKey > todayKey;
  const hasValidScheduleRegistration = !!options.hasValidScheduleRegistration;
  const scheduleEnforced = typeof options.isScheduleEnforcementActive === 'boolean'
    ? options.isScheduleEnforcementActive
    : isScheduleEnforcedForDate(dateKey);

  if (leaveDates.has(dateKey)) {
    return 'LEAVE';
  }

  if (isFuture) {
    return 'UNKNOWN';
  }

  if (!scheduleEnforced) {
    return today ? 'UNKNOWN' : 'ABSENT';
  }

  if (!hasValidScheduleRegistration) {
    return 'UNREGISTERED';
  }

  return today ? 'UNKNOWN' : 'ABSENT';
}

/**
 * Compute all attendance fields.
 * Priority order (workday without attendance): LEAVE > UNREGISTERED > ABSENT > UNKNOWN(today/future)
 *
 * @param {Object} attendance
 * @param {Set<string>} holidayDates
 * @param {Set<string>} leaveDates
 * @param {Object} options
 * @returns {{status: string, lateMinutes: number, workMinutes: number, otMinutes: number}}
 */
export function computeAttendance(attendance, holidayDates = new Set(), leaveDates = new Set(), options = {}) {
  if (!attendance) {
    return { status: 'UNKNOWN', lateMinutes: 0, workMinutes: 0, otMinutes: 0 };
  }

  const {
    date,
    checkInAt,
    checkOutAt,
    otApproved = false,
    otMode = 'CONTINUOUS',
    separatedOtMinutes = 0
  } = attendance;

  const dateKey = normalizeDateKey(date);
  if (!dateKey) {
    return { status: 'UNKNOWN', lateMinutes: 0, workMinutes: 0, otMinutes: 0 };
  }

  const checkIn = normalizeTimestamp(checkInAt);
  const checkOut = normalizeTimestamp(checkOutAt);
  const scheduleSnapshot = resolveAttendanceScheduleSnapshot(attendance);
  const isFlexible = isFlexibleScheduleType(scheduleSnapshot.scheduleType);

  // Priority 1: Weekend/Holiday
  if (isWeekend(dateKey) || holidayDates.has(dateKey)) {
    if (!checkIn && !checkOut) {
      return {
        status: 'WEEKEND_OR_HOLIDAY',
        lateMinutes: 0,
        workMinutes: 0,
        otMinutes: 0
      };
    }

    let workMinutes = 0;
    let otMinutes = 0;
    if (checkIn && checkOut) {
      const weekendMinutes = computeWeekendOtMinutes(dateKey, checkIn, checkOut, scheduleSnapshot);
      workMinutes = weekendMinutes;
      otMinutes = weekendMinutes;
    }

    return {
      status: 'WEEKEND_OR_HOLIDAY',
      lateMinutes: 0,
      workMinutes,
      otMinutes
    };
  }

  // Edge-case: checkout exists but missing checkin
  if (!checkIn && checkOut) {
    return {
      status: 'MISSING_CHECKIN',
      lateMinutes: 0,
      workMinutes: 0,
      otMinutes: 0
    };
  }

  const today = isToday(dateKey);

  // Today + checked in + not checked out
  if (today && checkIn && !checkOut) {
    return {
      status: 'WORKING',
      lateMinutes: isFlexible ? 0 : computeLateMinutes(dateKey, checkIn, scheduleSnapshot),
      workMinutes: 0,
      otMinutes: 0
    };
  }

  // Past + checked in + not checked out
  if (!today && checkIn && !checkOut) {
    return {
      status: 'MISSING_CHECKOUT',
      lateMinutes: isFlexible ? 0 : computeLateMinutes(dateKey, checkIn, scheduleSnapshot),
      workMinutes: 0,
      otMinutes: 0
    };
  }

  // Both check-in and check-out exist
  if (checkIn && checkOut) {
    if (checkOut < checkIn) {
      return {
        status: 'UNKNOWN',
        lateMinutes: 0,
        workMinutes: 0,
        otMinutes: 0
      };
    }

    const lateMinutes = isFlexible ? 0 : computeLateMinutes(dateKey, checkIn, scheduleSnapshot);
    const workMinutes = computeWorkMinutes(
      dateKey,
      checkIn,
      checkOut,
      otApproved,
      otMode,
      scheduleSnapshot
    );
    const otMinutes = isFlexible
      ? 0
      : computeOtMinutes(
        dateKey,
        checkOut,
        otApproved,
        otMode,
        separatedOtMinutes,
        scheduleSnapshot
      );
    const isEarlyLeave = isFlexible ? false : checkIsEarlyLeave(dateKey, checkOut, scheduleSnapshot);

    let status = 'ON_TIME';
    if (!isFlexible) {
      if (lateMinutes > 0 && isEarlyLeave) {
        status = 'LATE_AND_EARLY';
      } else if (lateMinutes > 0) {
        status = 'LATE';
      } else if (isEarlyLeave) {
        status = 'EARLY_LEAVE';
      }
    }

    return {
      status,
      lateMinutes,
      workMinutes,
      otMinutes
    };
  }

  // No check-in/out on workday
  if (!checkIn && !checkOut) {
    const status = computeNoAttendanceStatus(dateKey, leaveDates, options);
    return {
      status,
      lateMinutes: 0,
      workMinutes: 0,
      otMinutes: 0
    };
  }

  return {
    status: 'UNKNOWN',
    lateMinutes: 0,
    workMinutes: 0,
    otMinutes: 0
  };
}

/**
 * Calculate late minutes based on schedule snapshot.
 * Rule: late minutes counted from scheduled start minute, grace only for classification.
 */
export function computeLateMinutes(dateKey, checkInAt, scheduleSnapshot = null) {
  if (!(checkInAt instanceof Date) || isNaN(checkInAt.getTime())) {
    return 0;
  }

  const snapshot = scheduleSnapshot
    ? resolveAttendanceScheduleSnapshot(scheduleSnapshot)
    : resolveAttendanceScheduleSnapshot();

  if (!snapshot.lateTrackingEnabled) {
    return 0;
  }

  const lateThreshold = getLateThresholdForDate(dateKey, snapshot);
  if (!lateThreshold || checkInAt <= lateThreshold) {
    return 0;
  }

  const shiftStart = getShiftStartTimeForDate(dateKey, snapshot);
  if (!shiftStart) {
    return 0;
  }

  return Math.max(0, getMinutesDiff(shiftStart, checkInAt));
}

/**
 * Calculate work minutes with lunch deduction.
 * Fixed-shift workdays count only the in-shift overlap.
 * Time before shift start is ignored and approved OT no longer inflates workMinutes.
 *
 * @param {string} dateKey
 * @param {Date} checkInAt
 * @param {Date} checkOutAt
 * @param {boolean} otApproved
 * @param {'CONTINUOUS'|'SEPARATED'} otMode
 * @param {Object|null} scheduleSnapshot
 * @param {{forceNoShiftCap?: boolean}} options
 * @returns {number}
 */
export function computeWorkMinutes(
  dateKey,
  checkInAt,
  checkOutAt,
  otApproved = false,
  otMode = 'CONTINUOUS',
  scheduleSnapshot = null,
  options = {}
) {
  if (!(checkInAt instanceof Date) || isNaN(checkInAt.getTime())) {
    return 0;
  }
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return 0;
  }
  if (checkOutAt < checkInAt) {
    return 0;
  }

  const snapshot = scheduleSnapshot
    ? resolveAttendanceScheduleSnapshot(scheduleSnapshot)
    : resolveAttendanceScheduleSnapshot();

  const computeMinutesWithLunchDeduction = (windowStart, windowEnd) => {
    if (!(windowStart instanceof Date) || isNaN(windowStart.getTime())) {
      return 0;
    }
    if (!(windowEnd instanceof Date) || isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
      return 0;
    }

    const totalMinutes = getMinutesDiff(windowStart, windowEnd);
    const lunchStart = createTimeInGMT7(dateKey, 12, 0);
    const lunchEnd = createTimeInGMT7(dateKey, 13, 0);
    const spansLunch = windowStart < lunchStart && windowEnd > lunchEnd;

    if (spansLunch) {
      return Math.max(0, totalMinutes - 60);
    }

    return Math.max(0, totalMinutes);
  };

  if (options.forceNoShiftCap || isFlexibleScheduleType(snapshot.scheduleType)) {
    return computeMinutesWithLunchDeduction(checkInAt, checkOutAt);
  }

  const shiftStart = getShiftStartTimeForDate(dateKey, snapshot);
  const shiftEnd = getShiftEndTimeForDate(dateKey, snapshot);
  if (!shiftStart || !shiftEnd) {
    return computeMinutesWithLunchDeduction(checkInAt, checkOutAt);
  }

  const regularStart = checkInAt > shiftStart ? checkInAt : shiftStart;
  const regularEnd = checkOutAt < shiftEnd ? checkOutAt : shiftEnd;
  return computeMinutesWithLunchDeduction(regularStart, regularEnd);
}

/**
 * Calculate approved OT minutes.
 */
export function computeOtMinutes(
  dateKey,
  checkOutAt,
  otApproved = false,
  otMode = 'CONTINUOUS',
  separatedOtMinutes = 0,
  scheduleSnapshot = null
) {
  if (!otApproved) {
    return 0;
  }

  if (otMode === 'SEPARATED') {
    if (!Number.isFinite(Number(separatedOtMinutes))) {
      return 0;
    }
    return Math.max(0, Math.floor(Number(separatedOtMinutes)));
  }

  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return 0;
  }

  const snapshot = scheduleSnapshot
    ? resolveAttendanceScheduleSnapshot(scheduleSnapshot)
    : resolveAttendanceScheduleSnapshot();

  if (isFlexibleScheduleType(snapshot.scheduleType)) {
    return 0;
  }

  const otThreshold = getOtThresholdTimeForDate(dateKey, snapshot.scheduleType);
  if (!otThreshold || checkOutAt <= otThreshold) {
    return 0;
  }

  return Math.max(0, getMinutesDiff(otThreshold, checkOutAt));
}

/**
 * Weekend/holiday OT equals all worked minutes.
 */
export function computeWeekendOtMinutes(dateKey, checkInAt, checkOutAt, scheduleSnapshot = null) {
  return computeWorkMinutes(
    dateKey,
    checkInAt,
    checkOutAt,
    true,
    'CONTINUOUS',
    scheduleSnapshot,
    { forceNoShiftCap: true }
  );
}

/**
 * Compute potential OT (for unapproved OT reporting).
 */
export function computePotentialOtMinutes(dateKey, checkOutAt, scheduleSnapshot = null) {
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return 0;
  }

  const snapshot = scheduleSnapshot
    ? resolveAttendanceScheduleSnapshot(scheduleSnapshot)
    : resolveAttendanceScheduleSnapshot();

  if (isFlexibleScheduleType(snapshot.scheduleType)) {
    return 0;
  }

  const otThreshold = getOtThresholdTimeForDate(dateKey, snapshot.scheduleType);
  if (!otThreshold || checkOutAt <= otThreshold) {
    return 0;
  }

  return Math.max(0, getMinutesDiff(otThreshold, checkOutAt));
}

/**
 * Check early leave based on schedule snapshot.
 */
export function checkIsEarlyLeave(dateKey, checkOutAt, scheduleSnapshot = null) {
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return false;
  }

  const snapshot = scheduleSnapshot
    ? resolveAttendanceScheduleSnapshot(scheduleSnapshot)
    : resolveAttendanceScheduleSnapshot();

  if (!snapshot.earlyLeaveTrackingEnabled) {
    return false;
  }

  const endOfShift = getShiftEndTimeForDate(dateKey, snapshot);
  if (!endOfShift) {
    return false;
  }

  return checkOutAt < endOfShift;
}
