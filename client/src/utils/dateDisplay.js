/**
 * Shared client-side date display and computation helpers.
 * Extracted from CreateRequestForm.jsx and MyRequestsTable.jsx.
 */

/**
 * Add days to a date string (timezone-safe, pure string manipulation).
 * Handles month/year boundaries correctly.
 * Returns null if input is invalid.
 *
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {number} days - Number of days to add
 * @returns {string|null} Resulting date in YYYY-MM-DD format or null
 */
export const addDaysToDate = (dateStr, days) => {
    // Defensive: validate input format
    if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return null;
    }

    const [year, month, day] = dateStr.split('-').map(Number);

    // Defensive: check for NaN after parsing
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
        return null;
    }

    // Defensive: validate date ranges
    if (month < 1 || month > 12 || day < 1 || day > 31 || !Number.isInteger(days)) {
        return null;
    }

    const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
    if (isNaN(shifted.getTime())) {
        return null;
    }

    return shifted.toISOString().slice(0, 10);
};

/**
 * Detect if checkout time is cross-midnight (checkout < checkin means next day).
 * Only applies when BOTH times are provided.
 *
 * @param {string} checkInTime - Time string in HH:mm format
 * @param {string} checkOutTime - Time string in HH:mm format
 * @returns {boolean}
 */
export const isCrossMidnightCheckout = (checkInTime, checkOutTime) => {
    if (!checkInTime || !checkOutTime) return false;
    // String comparison: "02:00" < "22:00" = true → cross-midnight
    return checkOutTime < checkInTime;
};

/**
 * Format next day date for hint display (DD/MM/YYYY).
 *
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Formatted date string or empty string on invalid input
 */
export const getNextDayDisplay = (dateStr) => {
    if (!dateStr) return '';
    const nextDay = addDaysToDate(dateStr, 1);
    if (!nextDay) return ''; // Handle invalid input
    const [year, month, day] = nextDay.split('-');
    return `${day}/${month}/${year}`;
};

/**
 * Build ISO timestamp from date + time (GMT+7).
 * Supports cross-midnight by adding days to the date.
 *
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} timeStr - Time in HH:mm format
 * @param {number} [addDays=0] - Days to add (for cross-midnight checkout)
 * @returns {string|null} ISO timestamp string or null
 */
export const buildIsoTimestamp = (dateStr, timeStr, addDays = 0) => {
    if (!dateStr || !timeStr) return null;

    let targetDate = dateStr;
    if (addDays > 0) {
        targetDate = addDaysToDate(dateStr, addDays);
        if (!targetDate) return null; // Handle invalid date arithmetic
    }

    const hhmm = timeStr.slice(0, 5);
    return `${targetDate}T${hhmm}:00+07:00`;
};

/**
 * Extract date string (YYYY-MM-DD) in VN timezone (GMT+7).
 * Always parses input as Date object to handle UTC strings correctly.
 *
 * CRITICAL: Mongoose serializes Date fields to UTC ISO strings with Z suffix.
 * String slicing would give wrong date for VN times 00:00-06:59 (UTC -7 hours).
 * Example: "2026-02-09T18:00:00.000Z" is 01:00 VN on 2026-02-10, not 2026-02-09.
 *
 * @param {string|Date} dateValue - ISO string or Date object
 * @returns {string|null} Date in YYYY-MM-DD format or null
 */
export const getVnDateString = (dateValue) => {
    if (!dateValue) return null;

    // Always parse as Date to handle all string formats (UTC Z, +07:00, no timezone)
    // en-CA locale gives YYYY-MM-DD format directly
    try {
        return new Date(dateValue).toLocaleDateString('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
        });
    } catch (err) {
        console.warn('Failed to format date in VN timezone:', dateValue, err);
        return null;
    }
};

/**
 * Derive actual OT date vs persisted anchor date for request/approval UIs.
 * Carry-over SEPARATED OT stores the anchor day in request.date while the
 * actual OT session date is inferred from otStartTime in GMT+7.
 *
 * @param {Object} request
 * @returns {{ anchorDate: string|null, actualDate: string|null, isSeparatedCarryOver: boolean }}
 */
export const getOtRequestDateMeta = (request) => {
    const anchorDate = request?.date || request?.checkInDate || null;
    if (!request || request.type !== 'OT_REQUEST') {
        return {
            anchorDate,
            actualDate: anchorDate,
            isSeparatedCarryOver: false,
        };
    }

    const previewStart = request?.otPreview?.startTime || null;
    const rawStart = request?.otStartTime || null;
    const actualDate =
        request?.otMode === 'SEPARATED'
            ? getVnDateString(previewStart || rawStart || request?.estimatedEndTime) || anchorDate
            : anchorDate;

    const isSeparatedCarryOver = Boolean(
        request?.otMode === 'SEPARATED' &&
        anchorDate &&
        actualDate &&
        actualDate !== anchorDate
    );

    return {
        anchorDate,
        actualDate,
        isSeparatedCarryOver,
    };
};
