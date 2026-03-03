import { isToday, isWeekend, getMinutesDiff, createTimeInGMT7, getDateKey } from './dateUtils.js';

/**
 * Normalize dateKey to "YYYY-MM-DD" format in GMT+7.
 * Handles: Date object, ISO string, or already formatted string.
 * @param {Date|string} date - Date to normalize
 * @returns {string} "YYYY-MM-DD" format in GMT+7
 */
function normalizeDateKey(date) {
  if (!date) return '';
  // If already "YYYY-MM-DD" format (10 chars, has dashes)
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // P2 Fix (Issue #7): Validate calendar date (reject 2026-13-99, 2026-02-30, etc.)
    // Even if format is correct, the date might not exist in calendar
    const [year, month, day] = date.split('-').map(Number);
    const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (testDate.getUTCFullYear() !== year ||
        testDate.getUTCMonth() !== month - 1 ||
        testDate.getUTCDate() !== day) {
      return '';  // Invalid calendar date (auto-rolled by Date constructor)
    }
    return date;
  }
  // If ISO string like "2026-01-22T01:45:00.000Z"
  // Fix A: Convert to Date first for proper GMT+7 boundary detection
  // Example: "2026-01-21T18:30:00.000Z" in GMT+7 is 01:30 Jan 22, not Jan 21
  if (typeof date === 'string' && date.includes('T')) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) return getDateKey(d);
    // Invalid ISO: try to extract YYYY-MM-DD prefix, validate format
    const maybe = date.split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(maybe)) {
      return '';
    }
    // P2 Fix (Issue #7): Validate calendar date (reject 2026-13-99, 2026-02-30, etc.)
    const [year, month, day] = maybe.split('-').map(Number);
    const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (testDate.getUTCFullYear() !== year ||
        testDate.getUTCMonth() !== month - 1 ||
        testDate.getUTCDate() !== day) {
      return '';  // Invalid calendar date (auto-rolled by Date constructor)
    }
    return maybe;
  }
  // If Date object - use getDateKey for proper GMT+7 conversion
  // Fix B: toISOString() returns UTC which can shift the date boundary
  if (date instanceof Date) {
    // P2 Fix (Issue #1): Guard against Invalid Date to prevent "Invalid Date" string return
    return isNaN(date.getTime()) ? '' : getDateKey(date);
  }
  // Fallback: return empty string to fail-safe (won't match any dateKey)
  // Prevents garbage strings like "1234567890" or "Tue Jan 27" from being used
  return '';
}

/**
 * Normalize timestamp to Date object for consistent comparisons.
 * @param {Date|string|number} timestamp - Timestamp to normalize
 * @returns {Date|null} Date object or null if invalid
 */
function normalizeTimestamp(timestamp) {
  if (!timestamp) return null;
  // P1 Fix (Bug #2): Check Invalid Date objects before returning
  if (timestamp instanceof Date) {
    return isNaN(timestamp.getTime()) ? null : timestamp;
  }
  // String or number -> convert to Date
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Compute all attendance fields (status, lateMinutes, workMinutes, otMinutes).
 * Phase 3: Now called for both existing records AND synthetic empty records (for ABSENT/LEAVE detection).
 * Priority per RULES.md §8.3: WEEKEND_OR_HOLIDAY > LEAVE > attendance-based statuses > ABSENT
 * 
 * Phase 2.1 (OT_REQUEST): Added otApproved parameter for OT approval-based calculation
 * 
 * @param {Object} attendance - { date, checkInAt, checkOutAt, otApproved }
 * @param {Set<string>} holidayDates - Set of "YYYY-MM-DD" holiday dates (optional)
 * @param {Set<string>} leaveDates - Set of "YYYY-MM-DD" approved leave dates (optional, Phase 3)
 * @returns {Object} { status, lateMinutes, workMinutes, otMinutes }
 */
export function computeAttendance(attendance, holidayDates = new Set(), leaveDates = new Set()) {
  // Fix A: Guard against null/undefined attendance to prevent destructuring crash
  if (!attendance) {
    return { status: 'UNKNOWN', lateMinutes: 0, workMinutes: 0, otMinutes: 0 };
  }

  const { date, checkInAt, checkOutAt, otApproved = false } = attendance;

  // Fix #2: Normalize date to "YYYY-MM-DD" format for consistent lookups
  const dateKey = normalizeDateKey(date);

  // P1 Guard: Empty dateKey means invalid date input - fail safely
  // Prevents isWeekend('')/isToday('') from returning wrong results
  if (!dateKey) {
    return { status: 'UNKNOWN', lateMinutes: 0, workMinutes: 0, otMinutes: 0 };
  }

  // Fix #1: Normalize timestamps to Date objects for consistent comparisons
  const checkIn = normalizeTimestamp(checkInAt);
  const checkOut = normalizeTimestamp(checkOutAt);

  // Priority 1: Weekend/Holiday - Compute metrics if attendance exists
  // No check-in/check-out = normal holiday behavior
  // Has check-in/check-out = Compute OT metrics (no "late" concept on weekends/holidays)
  if (isWeekend(dateKey) || holidayDates.has(dateKey)) {
    // No attendance = normal weekend/holiday
    if (!checkIn && !checkOut) {
      return {
        status: 'WEEKEND_OR_HOLIDAY',
        lateMinutes: 0,
        workMinutes: 0,
        otMinutes: 0
      };
    }

    // Has check-in/check-out = Compute OT metrics
    let workMinutes = 0;
    let otMinutes = 0;

    if (checkIn && checkOut) {
      // Weekend/holiday OT doesn't need approval (F1 requirement):
      // all worked minutes are treated as OT minutes.
      const weekendMinutes = computeWeekendOtMinutes(dateKey, checkIn, checkOut);
      workMinutes = weekendMinutes;
      otMinutes = weekendMinutes;
    }
    // If checkIn but no checkOut (working now), keep 0 until checkout completes

    return {
      status: 'WEEKEND_OR_HOLIDAY',
      lateMinutes: 0,  // Never late on weekend/holiday
      workMinutes,
      otMinutes
    };
  }

  // Priority 2: LEAVE (workdays only, no attendance record)
  // If user has approved leave and no check-in/out, status = LEAVE
  // If attendance exists on leave day, compute normally (override scenario)
  if (leaveDates.has(dateKey) && !checkIn && !checkOut) {
    return {
      status: 'LEAVE',
      lateMinutes: 0,
      workMinutes: 0,
      otMinutes: 0
    };
  }

  const today = isToday(dateKey);

  // Fix #7: Has checkOut but no checkIn → MISSING_CHECKIN (edge case: forgot to check in)
  if (!checkIn && checkOut) {
    return {
      status: 'MISSING_CHECKIN',
      lateMinutes: 0,
      workMinutes: 0,
      otMinutes: 0
    };
  }

  // Today + checked in + not checked out = WORKING (workday only, weekend/holiday handled above)
  if (today && checkIn && !checkOut) {
    return {
      status: 'WORKING',
      lateMinutes: computeLateMinutes(dateKey, checkIn),
      workMinutes: 0,
      otMinutes: 0
    };
  }

  // Past day + checked in + not checked out = MISSING_CHECKOUT
  if (!today && checkIn && !checkOut) {
    return {
      status: 'MISSING_CHECKOUT',
      lateMinutes: computeLateMinutes(dateKey, checkIn),
      workMinutes: 0,
      otMinutes: 0
    };
  }

  // Both checkIn and checkOut exist
  if (checkIn && checkOut) {
    // P2 Fix (Issue #5): Guard against reversed times (bad data) to prevent misclassification
    // If checkOut < checkIn, this is data corruption - return safe default instead of wrong status
    if (checkOut < checkIn) {
      return {
        status: 'UNKNOWN',
        lateMinutes: 0,
        workMinutes: 0,
        otMinutes: 0
      };
    }
    
    const lateMinutes = computeLateMinutes(dateKey, checkIn);
    const workMinutes = computeWorkMinutes(dateKey, checkIn, checkOut, otApproved);
    const otMinutes = computeOtMinutes(dateKey, checkOut, otApproved);
    const isEarlyLeave = checkIsEarlyLeave(dateKey, checkOut);

    // Priority: LATE_AND_EARLY (Purple) > LATE (Red) > EARLY_LEAVE (Yellow) > ON_TIME (Green)
    // Per RULES.md v2.3 §3.3: LATE_AND_EARLY is highest severity
    let status = 'ON_TIME';

    if (lateMinutes > 0 && isEarlyLeave) {
      status = 'LATE_AND_EARLY'; // Purple - NEW v2.3: both late AND early leave
    } else if (lateMinutes > 0) {
      status = 'LATE'; // Red - most severe single violation
    } else if (isEarlyLeave) {
      status = 'EARLY_LEAVE'; // Yellow - less severe
    }

    return {
      status,
      lateMinutes,
      workMinutes,
      otMinutes
    };
  }

  // P0 Fix: Past workday with no attendance and no leave = ABSENT
  // This handles synthetic records for days that have passed
  if (!today && !checkIn && !checkOut) {
    return {
      status: 'ABSENT',
      lateMinutes: 0,
      workMinutes: 0,
      otMinutes: 0
    };
  }

  // Fallback: Today with no attendance yet (normal state before check-in)
  // Or unexpected data combinations
  return {
    status: 'UNKNOWN',
    lateMinutes: 0,
    workMinutes: 0,
    otMinutes: 0
  };
}

/**
 * Calculate late minutes if check-in after 08:45 GMT+7.
 * Rule: ON_TIME if <= 08:45, LATE if >= 08:46
 */
export function computeLateMinutes(dateKey, checkInAt) {
  // P2 Fix (Bug #5): Guard against Invalid Date to prevent NaN/unpredictable comparison
  if (!(checkInAt instanceof Date) || isNaN(checkInAt.getTime())) {
    return 0;
  }
  
  const lateThreshold = createTimeInGMT7(dateKey, 8, 45); // 08:45 GMT+7

  if (checkInAt <= lateThreshold) {
    return 0;
  }

  return getMinutesDiff(lateThreshold, checkInAt);
}

/**
 * Calculate work minutes from check-in to check-out, with lunch deduction.
 * Rule: Deduct 60 mins if checkIn < 12:00 AND checkOut > 13:00 (span lunch window)
 * Fix #3 & #4: Clamp to 0 to prevent negative minutes from bad data
 * 
 * Phase 2.1 (OT_REQUEST): Added otApproved parameter
 * - If otApproved = false: Cap checkout at 17:30 (STRICT rule A1)
 * - If otApproved = true: Use actual checkout time
 * 
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} checkInAt - Check-in timestamp
 * @param {Date} checkOutAt - Check-out timestamp
 * @param {boolean} otApproved - Whether OT is approved (default: false)
 * @returns {number} Work minutes (excluding lunch)
 */
export function computeWorkMinutes(dateKey, checkInAt, checkOutAt, otApproved = false) {
  // P2 Fix (Bug #6): Guard against Invalid Date to prevent NaN in calculations
  if (!(checkInAt instanceof Date) || isNaN(checkInAt.getTime()) ||
      !(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return 0;
  }
  
  // Fix #3: Guard against checkOut before checkIn (bad data)
  if (checkOutAt < checkInAt) {
    return 0;
  }

  let effectiveCheckOut = checkOutAt;
  
  // STRICT (A1): If no OT approval, cap checkout at 17:30
  if (!otApproved) {
    const endOfShift = createTimeInGMT7(dateKey, 17, 30);
    if (checkOutAt > endOfShift) {
      effectiveCheckOut = endOfShift;  // Cap at end of shift
    }
  }

  // Calculate work minutes using effectiveCheckOut
  const totalMinutes = getMinutesDiff(checkInAt, effectiveCheckOut);

  // Check if work interval spans lunch window (12:00-13:00 GMT+7)
  const lunchStart = createTimeInGMT7(dateKey, 12, 0);
  const lunchEnd = createTimeInGMT7(dateKey, 13, 0);

  const spansLunch = checkInAt < lunchStart && effectiveCheckOut > lunchEnd;

  if (spansLunch) {
    // Fix #4: Clamp to 0 to prevent negative when totalMinutes < 60
    return Math.max(0, totalMinutes - 60);
  }

  return Math.max(0, totalMinutes);
}

/**
 * Calculate overtime minutes if check-out after 17:31 GMT+7.
 * Rule: OT = minutes after 17:31 if checkOutAt > 17:31
 * 
 * Phase 2.1 (OT_REQUEST): Added otApproved parameter
 * - If otApproved = false: Return 0 (STRICT rule - no approval = no OT)
 * - If otApproved = true: Calculate OT minutes after 17:31
 * 
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} checkOutAt - Check-out timestamp
 * @param {boolean} otApproved - Whether OT is approved (default: false)
 * @returns {number} OT minutes after 17:31
 */
export function computeOtMinutes(dateKey, checkOutAt, otApproved = false) {
  // STRICT: Only calculate OT if approved
  if (!otApproved) {
    return 0;
  }
  
  // P2 Fix (Bug #5): Guard against Invalid Date to prevent NaN/unpredictable comparison
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return 0;
  }
  
  const otThreshold = createTimeInGMT7(dateKey, 17, 31); // 17:31 GMT+7

  if (checkOutAt <= otThreshold) {
    return 0;
  }

  return getMinutesDiff(otThreshold, checkOutAt);
}

/**
 * Calculate OT minutes for weekend/holiday attendance.
 * Rule: Weekend/Holiday OT equals all worked minutes (including lunch rule).
 *
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} checkInAt - Check-in timestamp
 * @param {Date} checkOutAt - Check-out timestamp
 * @returns {number} OT minutes on weekend/holiday
 */
export function computeWeekendOtMinutes(dateKey, checkInAt, checkOutAt) {
  // Reuse computeWorkMinutes to keep lunch/guard logic in one place.
  return computeWorkMinutes(dateKey, checkInAt, checkOutAt, true);
}

/**
 * Calculate potential OT minutes if user had approval.
 * Used for reporting unapproved OT (H2 requirement).
 * 
 * This function calculates what the OT would be regardless of approval status,
 * useful for tracking missed OT opportunities or showing users what they could have earned.
 * 
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} checkOutAt - Check-out timestamp
 * @returns {number} Potential OT minutes after 17:31
 */
export function computePotentialOtMinutes(dateKey, checkOutAt) {
  // P1 Fix (Issue #1): Guard against invalid Date input (report layer may pass null/string/Invalid Date)
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return 0;
  }
  
  const otThreshold = createTimeInGMT7(dateKey, 17, 31);
  
  if (checkOutAt <= otThreshold) {
    return 0;
  }
  
  return getMinutesDiff(otThreshold, checkOutAt);
}

/**
 * Check if check-out is before 17:30 GMT+7 (early leave).
 * Rule: EARLY_LEAVE if checkOutAt < 17:30
 */
export function checkIsEarlyLeave(dateKey, checkOutAt) {
  // P2 Fix (Issue #5): Guard against invalid Date to prevent silent misclassification
  // (e.g., checkOut < checkIn from bad data, or Invalid Date objects)
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return false;  // Can't determine, assume not early leave (safe default)
  }
  
  const endOfShift = createTimeInGMT7(dateKey, 17, 30); // 17:30 GMT+7
  return checkOutAt < endOfShift;
}
