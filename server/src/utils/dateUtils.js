const TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Get current date in GMT+7 as "YYYY-MM-DD" string.
 * Used for check-in/out to ensure consistent dateKey across the app.
 */
export function getTodayDateKey() {
  const now = new Date();
  return getDateKey(now);
}

/**
 * Convert any Date to "YYYY-MM-DD" string in GMT+7 timezone.
 * Critical: ensures date boundaries respect GMT+7, not server's local time.
 */
export function getDateKey(date) {
  // P2 Fix (Issue #1): Guard against Invalid Date to prevent RangeError crash
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';  // Return empty string for invalid dates (consistent with normalizeDateKey)
  }
  
  const dateStr = date.toLocaleDateString('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return dateStr;
}

/**
 * Check if a dateKey matches today in GMT+7.
 * Used to distinguish WORKING (today) vs MISSING_CHECKOUT (past day).
 */
export function isToday(dateKey) {
  return dateKey === getTodayDateKey();
}

/**
 * Check if dateKey falls on weekend (Saturday or Sunday).
 * Used for status computation: weekend days should show WEEKEND, not ABSENT.
 */
export function isWeekend(dateKey) {
  // Split dateKey and create Date in GMT+7 explicitly
  const [year, month, day] = dateKey.split('-').map(Number);

  // Create date at noon GMT+7 to avoid timezone edge cases
  // Noon ensures we're safely in the middle of the target day
  const date = new Date(Date.UTC(year, month - 1, day, 12 - 7, 0, 0));

  const dayOfWeek = date.getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Get hour and minute components of a Date in GMT+7.
 * Used for: late check, early leave, fixed-shift OT start, lunch (12:00-13:00).
 */
export function getTimeInGMT7(date) {
  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });

  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Format Date to "HH:mm" in GMT+7.
 * Returns empty string for invalid inputs.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatTimeGMT7(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }

  const { hours, minutes } = getTimeInGMT7(date);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Calculate minutes difference between two Dates.
 * Used for: workMinutes, lateMinutes, otMinutes calculations.
 */
export function getMinutesDiff(startDate, endDate) {
  return Math.floor((endDate - startDate) / (1000 * 60));
}

/**
 * Create a UTC Date representing a specific time on a given dateKey in GMT+7.
 * Used for computing reference times such as shift start/end, lunch, and OT start.
 * Returns a Date object (UTC timestamp) that represents the moment "dateKey HH:mm GMT+7".
 */
export function createTimeInGMT7(dateKey, hours, minutes) {
  const [year, month, day] = dateKey.split('-').map(Number);

  // Subtract 7 hours from GMT+7 to get UTC equivalent
  const dateInGMT7 = new Date(Date.UTC(year, month - 1, day, hours - 7, minutes));

  return dateInGMT7;
}

/**
 * Get all dates in a range as array of "YYYY-MM-DD" strings (inclusive).
 * Used for expanding leave date ranges.
 * 
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate - "YYYY-MM-DD"
 * @returns {string[]} Array of date strings
 */
export function getDateRange(startDate, endDate) {
  // Defensive validation: ensure valid format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`Invalid startDate format: "${startDate}". Expected YYYY-MM-DD`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`Invalid endDate format: "${endDate}". Expected YYYY-MM-DD`);
  }

  // Defensive validation: ensure logical ordering
  if (startDate > endDate) {
    throw new Error(`startDate (${startDate}) must be <= endDate (${endDate})`);
  }

  const dates = [];
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

  // Defensive validation: ensure calendar validity (e.g., reject 2026-02-30)
  // JavaScript Date auto-rolls invalid dates (Feb 30 → Mar 2), so we check if it changed
  const testStart = new Date(Date.UTC(startYear, startMonth - 1, startDay, 12, 0, 0));
  if (testStart.getUTCFullYear() !== startYear ||
    testStart.getUTCMonth() !== startMonth - 1 ||
    testStart.getUTCDate() !== startDay) {
    const error = new Error(`Invalid calendar date: ${startDate} (does not exist in calendar)`);
    error.statusCode = 400;
    throw error;
  }

  const testEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay, 12, 0, 0));
  if (testEnd.getUTCFullYear() !== endYear ||
    testEnd.getUTCMonth() !== endMonth - 1 ||
    testEnd.getUTCDate() !== endDay) {
    const error = new Error(`Invalid calendar date: ${endDate} (does not exist in calendar)`);
    error.statusCode = 400;
    throw error;
  }

  // Create Date objects at noon GMT+7 to avoid timezone edge cases
  const current = new Date(Date.UTC(startYear, startMonth - 1, startDay, 12 - 7, 0, 0));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay, 12 - 7, 0, 0));

  while (current <= end) {
    const dateKey = getDateKey(current);
    dates.push(dateKey);

    // Move to next day
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Count workdays between two dates (inclusive), excluding weekends and holidays.
 * Used for calculating leaveDaysCount.
 * 
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate - "YYYY-MM-DD"
 * @param {Set<string>} holidayDates - Set of "YYYY-MM-DD" holiday dates
 * @returns {number} Count of workdays
 */
export function countWorkdays(startDate, endDate, holidayDates = new Set()) {
  const allDates = getDateRange(startDate, endDate);

  let workdayCount = 0;
  for (const dateKey of allDates) {
    // Skip weekends and holidays
    if (!isWeekend(dateKey) && !holidayDates.has(dateKey)) {
      workdayCount++;
    }
  }

  return workdayCount;
}

/**
 * Check if time is after the default fixed-shift OT threshold (17:30 GMT+7)
 * Used for OT request validation
 * 
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} time - Time to check
 * @returns {boolean} True if time > 17:30
 */
export function isInOtPeriod(dateKey, time) {
  // P2 Fix: Guard against invalid dateKey to prevent crash in createTimeInGMT7()
  if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return false;
  }
  // P2 Fix (Issue #4): Guard against Invalid Date to prevent unpredictable comparison
  if (!(time instanceof Date) || isNaN(time.getTime())) {
    return false;
  }
  
  const otThreshold = createTimeInGMT7(dateKey, 17, 30);
  return time > otThreshold;
}

/**
 * Check if checkout exceeds end of shift (17:30 GMT+7)
 * Used for unapproved OT tracking
 * 
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} checkOutAt - Checkout timestamp
 * @returns {boolean} True if checkout > 17:30
 */
export function isAfterShiftEnd(dateKey, checkOutAt) {
  // P2 Fix: Guard against invalid dateKey to prevent crash in createTimeInGMT7()
  if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return false;
  }
  // P2 Fix (Issue #4): Guard against Invalid Date to prevent unpredictable comparison
  if (!(checkOutAt instanceof Date) || isNaN(checkOutAt.getTime())) {
    return false;
  }
  
  const endOfShift = createTimeInGMT7(dateKey, 17, 30);
  return checkOutAt > endOfShift;
}

/**
 * Calculate minutes between OT threshold and time
 * Used for minimum validation (30 minutes)
 * 
 * @param {string} dateKey - Date in "YYYY-MM-DD" format
 * @param {Date} estimatedEndTime - Estimated end time
 * @returns {number} Minutes from 17:30 to estimatedEndTime
 */
export function getOtDuration(dateKey, estimatedEndTime) {
  // P2 Fix: Guard against invalid dateKey to prevent NaN from createTimeInGMT7()
  if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return 0;
  }
  // P2 Fix (Issue #3): Guard against Invalid Date to prevent NaN in OT calculations
  if (!(estimatedEndTime instanceof Date) || isNaN(estimatedEndTime.getTime())) {
    return 0;
  }
  
  const otThreshold = createTimeInGMT7(dateKey, 17, 30);
  return getMinutesDiff(otThreshold, estimatedEndTime);
}

/**
 * Calculate separated OT duration in minutes.
 *
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {number}
 */
export function getSeparatedOtDuration(startTime, endTime) {
  if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
    return 0;
  }
  if (!(endTime instanceof Date) || isNaN(endTime.getTime())) {
    return 0;
  }
  if (endTime <= startTime) {
    return 0;
  }
  return getMinutesDiff(startTime, endTime);
}

/**
 * Build OT preview payload for UI rendering.
 *
 * @param {string} dateKey
 * @param {'CONTINUOUS'|'SEPARATED'|null|undefined} otMode
 * @param {Date|null} otStartTime
 * @param {Date|null} estimatedEndTime
 * @returns {{mode: 'CONTINUOUS'|'SEPARATED', startTime: Date|null, endTime: Date|null, minutes: number}}
 */
export function buildOtPreview(dateKey, otMode, otStartTime, estimatedEndTime) {
  const mode = otMode === 'SEPARATED' ? 'SEPARATED' : 'CONTINUOUS';
  const endTime = (estimatedEndTime instanceof Date && !isNaN(estimatedEndTime.getTime()))
    ? estimatedEndTime
    : null;

  const continuousStart = (
    dateKey &&
    typeof dateKey === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
  ) ? createTimeInGMT7(dateKey, 17, 30) : null;

  const separatedStart = (otStartTime instanceof Date && !isNaN(otStartTime.getTime()))
    ? otStartTime
    : null;

  const startTime = mode === 'SEPARATED' ? separatedStart : continuousStart;
  const minutes = (startTime && endTime && endTime > startTime)
    ? getMinutesDiff(startTime, endTime)
    : 0;

  return {
    mode,
    startTime,
    endTime,
    minutes
  };
}
