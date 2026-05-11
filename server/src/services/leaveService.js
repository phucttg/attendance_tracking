import mongoose from 'mongoose';
import Request from '../models/Request.js';
import Attendance from '../models/Attendance.js';
import Holiday from '../models/Holiday.js';
import { getDateRange, countWorkdays } from '../utils/dateUtils.js';

/**
 * Create a LEAVE request.
 * Validates:
 * - leaveStartDate <= leaveEndDate
 * - Max range: 30 days
 * - No attendance exists for ANY date in range
 * - No overlap with existing APPROVED or PENDING leave
 *
 * Known Limitation (MVP): Small race condition window between findOne() and create().
 * Two concurrent LEAVE requests could both pass overlap check and create overlapping leaves.
 * Probability is very low; acceptable for MVP. Cannot use unique index for range overlap.
 *
 * @param {string} userId - User's ObjectId
 * @param {string} leaveStartDate - "YYYY-MM-DD"
 * @param {string} leaveEndDate - "YYYY-MM-DD"
 * @param {string|null} leaveType - Legacy optional value from old clients; new UI sends null.
 * @param {string} reason - Reason for leave
 * @returns {Promise<Object>} Created request with leaveDaysCount
 */
export const createLeaveRequest = async (userId, leaveStartDate, leaveEndDate, leaveType, reason) => {
  // Validation 0: userId must be valid ObjectId (P1 defensive fix)
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid userId');
    error.statusCode = 400;
    throw error;
  }

  // Validation 1: Date format
  if (!leaveStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(leaveStartDate)) {
    const error = new Error('Invalid leaveStartDate format. Expected YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  if (!leaveEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(leaveEndDate)) {
    const error = new Error('Invalid leaveEndDate format. Expected YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  // Validation 2: startDate <= endDate
  if (leaveStartDate > leaveEndDate) {
    const error = new Error('leaveStartDate must be before or equal to leaveEndDate');
    error.statusCode = 400;
    throw error;
  }

  // Validation 3: Max range 30 days
  const allDates = getDateRange(leaveStartDate, leaveEndDate);
  if (allDates.length > 30) {
    const error = new Error('Leave range cannot exceed 30 days');
    error.statusCode = 400;
    throw error;
  }

  // Validation 4: Reason required and length limit
  // Bug #1 Fix: Use nullish coalescing + trim for consistency
  const trimmedReason = (reason ?? '').trim();

  if (!trimmedReason) {
    const error = new Error('Reason is required');
    error.statusCode = 400;
    throw error;
  }

  const MAX_REASON_LENGTH = 1000;
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    const error = new Error(`Reason must be ${MAX_REASON_LENGTH} characters or less`);
    error.statusCode = 400;
    throw error;
  }

  // Validation 5: legacy leaveType must be valid enum or null
  if (leaveType && !['ANNUAL', 'SICK', 'UNPAID'].includes(leaveType)) {
    const error = new Error('leaveType must be ANNUAL, SICK, or UNPAID');
    error.statusCode = 400;
    throw error;
  }

  // Validation 6: Check no attendance exists for any date in range
  const existingAttendance = await Attendance.findOne({
    userId,
    date: { $in: allDates }
  }).select('date').lean();

  if (existingAttendance) {
    const error = new Error(`Already checked in for ${existingAttendance.date}. Cannot request leave for dates with attendance. Use ADJUST_TIME instead.`);
    error.statusCode = 400;
    throw error;
  }

  // Validation 7: Check no overlap with existing APPROVED or PENDING leave
  // P0 Fix: Simplified overlap check covers all cases (including "new contains existing")
  // Overlap when: existingStart <= newEnd AND existingEnd >= newStart
  const existingLeave = await Request.findOne({
    userId,
    type: 'LEAVE',
    status: { $in: ['APPROVED', 'PENDING'] },
    leaveStartDate: { $lte: leaveEndDate },      // Existing starts before/on new end
    leaveEndDate: { $gte: leaveStartDate }       // Existing ends after/on new start
  }).select('leaveStartDate leaveEndDate status').lean();

  if (existingLeave) {
    const statusText = existingLeave.status === 'APPROVED' ? 'approved' : 'pending';
    const error = new Error(`Leave overlaps with existing ${statusText} leave (${existingLeave.leaveStartDate} to ${existingLeave.leaveEndDate})`);
    error.statusCode = 409;
    throw error;
  }

  // Calculate workdays (exclude weekends + holidays)
  // P1 Fix: Query holidays for exact date range (optimized from full-year query)
  const holidays = await Holiday.find({
    date: { $gte: leaveStartDate, $lte: leaveEndDate }
  }).select('date -_id').lean();

  const holidayDates = new Set(holidays.map(h => h.date));
  const leaveDaysCount = countWorkdays(leaveStartDate, leaveEndDate, holidayDates);

  // Create request
  try {
    const request = await Request.create({
      userId,
      type: 'LEAVE',
      date: null, // LEAVE doesn't use date field
      leaveStartDate,
      leaveEndDate,
      leaveType: leaveType || null,
      leaveDaysCount,
      reason: trimmedReason,
      status: 'PENDING'
    });

    return request;
  } catch (err) {
    // Handle any MongoDB errors
    throw err;
  }
};

/**
 * Get all approved leave dates for a user in a month.
 * Used by controllers to pass leaveDates to computeAttendance.
 *
 * @param {string} userId - User's ObjectId
 * @param {string} monthStr - "YYYY-MM"
 * @returns {Promise<Set<string>>} Set of "YYYY-MM-DD" dates
 */
export const getApprovedLeaveDates = async (userId, monthStr) => {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    return new Set(); // Return empty set for invalid month (defensive)
  }

  // Calculate month boundaries
  const [year, month] = monthStr.split('-').map(Number);
  const monthStart = `${monthStr}-01`;

  // Calculate next month start (handles year boundary)
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  // Query APPROVED LEAVE requests that overlap with this month
  const leaveRequests = await Request.find({
    userId,
    type: 'LEAVE',
    status: 'APPROVED',
    $or: [
      // Leave starts within month
      { leaveStartDate: { $gte: monthStart, $lt: nextMonthStart } },
      // Leave ends within month
      { leaveEndDate: { $gte: monthStart, $lt: nextMonthStart } },
      // Leave spans entire month
      { leaveStartDate: { $lt: monthStart }, leaveEndDate: { $gte: nextMonthStart } }
    ]
  }).select('leaveStartDate leaveEndDate').lean();

  // Expand ranges to individual dates and filter to month
  const leaveDates = new Set();

  for (const leave of leaveRequests) {
    const allDates = getDateRange(leave.leaveStartDate, leave.leaveEndDate);

    for (const dateKey of allDates) {
      // Only include dates within the requested month
      if (dateKey >= monthStart && dateKey < nextMonthStart) {
        leaveDates.add(dateKey);
      }
    }
  }

  return leaveDates;
};
