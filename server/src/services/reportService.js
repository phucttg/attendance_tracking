import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Request from '../models/Request.js';
import { computeAttendance, computePotentialOtMinutes } from '../utils/attendanceCompute.js';
import {
    countWorkdays,
    formatTimeGMT7,
    getDateRange,
    getTodayDateKey,
    isWeekend
} from '../utils/dateUtils.js';

const PRESENT_STATUSES = new Set([
    'ON_TIME',
    'LATE',
    'EARLY_LEAVE',
    'LATE_AND_EARLY',
    'WORKING',
    'MISSING_CHECKOUT'
]);

const EARLY_LEAVE_STATUSES = new Set(['EARLY_LEAVE', 'LATE_AND_EARLY']);
const DEFAULT_LEAVE_TYPE = 'UNSPECIFIED';

function getMonthBoundaries(month) {
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    return { monthStart, monthEnd };
}

function getElapsedWindow(monthStart, monthEnd) {
    const todayKey = getTodayDateKey();

    if (todayKey < monthStart) {
        return null; // Future month
    }
    if (todayKey > monthEnd) {
        return { start: monthStart, end: monthEnd };
    }

    return { start: monthStart, end: todayKey };
}

function isWorkday(dateKey, holidayDates) {
    return !isWeekend(dateKey) && !holidayDates.has(dateKey);
}

function buildWorkdaySet(startDate, endDate, holidayDates) {
    const set = new Set();
    if (!startDate || !endDate || startDate > endDate) {
        return set;
    }

    for (const dateKey of getDateRange(startDate, endDate)) {
        if (isWorkday(dateKey, holidayDates)) {
            set.add(dateKey);
        }
    }

    return set;
}

function normalizeLeaveType(rawType) {
    if (rawType === 'ANNUAL' || rawType === 'SICK' || rawType === 'UNPAID') {
        return rawType;
    }
    return DEFAULT_LEAVE_TYPE;
}

function createEmptyLeaveAggregate() {
    return {
        leaveDateSetFull: new Set(),
        leaveDateSetElapsedWorkday: new Set(),
        leaveTypeByDate: new Map()
    };
}

function getLeaveByTypeCounts(leaveTypeByDate) {
    const leaveByType = {
        ANNUAL: 0,
        SICK: 0,
        UNPAID: 0,
        UNSPECIFIED: 0
    };

    for (const leaveType of leaveTypeByDate.values()) {
        leaveByType[leaveType] += 1;
    }

    return leaveByType;
}

function computeAbsentDays(elapsedWorkdaySet, presentDateSet, leaveDateSetElapsedWorkday) {
    let absentDays = 0;

    for (const dateKey of elapsedWorkdaySet) {
        if (!presentDateSet.has(dateKey) && !leaveDateSetElapsedWorkday.has(dateKey)) {
            absentDays += 1;
        }
    }

    return absentDays;
}

function addLeaveDatesToAggregate(targetSet, leaveStart, leaveEnd, leaveType, holidayDates, leaveTypeByDate = null) {
    if (!leaveStart || !leaveEnd || leaveStart > leaveEnd) {
        return;
    }

    for (const dateKey of getDateRange(leaveStart, leaveEnd)) {
        if (!isWorkday(dateKey, holidayDates)) {
            continue;
        }

        targetSet.add(dateKey);
        if (leaveTypeByDate && !leaveTypeByDate.has(dateKey)) {
            leaveTypeByDate.set(dateKey, leaveType);
        }
    }
}

function intersectRange(rangeStart, rangeEnd, clipStart, clipEnd) {
    if (!rangeStart || !rangeEnd || !clipStart || !clipEnd) {
        return null;
    }

    const start = rangeStart > clipStart ? rangeStart : clipStart;
    const end = rangeEnd < clipEnd ? rangeEnd : clipEnd;
    return start <= end ? { start, end } : null;
}

/**
 * Get monthly report with summary per user.
 * RBAC: Manager (team only), Admin (team or company).
 * 
 * @param {string} scope - 'team' or 'company'
 * @param {string} month - "YYYY-MM" format
 * @param {string} teamId - Required if scope is 'team'
 * @param {Set<string>} holidayDates - Set of holiday dateKeys (optional)
 * @returns {Promise<Object>} { summary: Array }
 */
export const getMonthlyReport = async (scope, month, teamId, holidayDates = new Set()) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        const error = new Error('Invalid month format. Expected YYYY-MM');
        error.statusCode = 400;
        throw error;
    }

    if (!scope || !['team', 'company'].includes(scope)) {
        const error = new Error('Invalid scope. Expected "team" or "company"');
        error.statusCode = 400;
        throw error;
    }

    if (scope === 'team' && !teamId) {
        const error = new Error('Team ID is required for team scope');
        error.statusCode = 400;
        throw error;
    }

    // Query users based on scope
    // PATCH: Use $or to handle legacy users without deletedAt field (consistent with attendanceService)
    const baseQuery = {
        isActive: true,
        $or: [
            { deletedAt: null },              // Migrated users (not deleted)
            { deletedAt: { $exists: false } }  // Legacy users (no field yet)
        ]
    };
    const userQuery = scope === 'team'
        ? { ...baseQuery, teamId }
        : baseQuery;

    const users = await User.find(userQuery)
        .select('_id name employeeCode teamId')
        .populate('teamId', 'name')
        .sort({ employeeCode: 1 })
        .lean();

    if (users.length === 0) {
        return { summary: [] };
    }

    const { monthStart, monthEnd } = getMonthBoundaries(month);
    const elapsedWindow = getElapsedWindow(monthStart, monthEnd);
    const elapsedWorkdaySet = elapsedWindow
        ? buildWorkdaySet(elapsedWindow.start, elapsedWindow.end, holidayDates)
        : new Set();
    const totalWorkdays = countWorkdays(monthStart, monthEnd, holidayDates);

    const userIds = users.map(u => u._id);
    const attendanceRecords = await Attendance.find({
        userId: { $in: userIds },
        date: { $gte: monthStart, $lte: monthEnd }
    })
        .select('userId date checkInAt checkOutAt otApproved')
        .sort({ date: 1, checkInAt: 1 })
        .lean();

    const leaveRecords = await Request.find({
        userId: { $in: userIds },
        type: 'LEAVE',
        status: 'APPROVED',
        leaveStartDate: { $lte: monthEnd },
        leaveEndDate: { $gte: monthStart }
    })
        .select('userId leaveType leaveStartDate leaveEndDate')
        .sort({ leaveStartDate: 1, leaveEndDate: 1, _id: 1 })
        .lean();

    // Group attendance by userId for efficient processing
    const attendanceByUser = new Map();
    for (const record of attendanceRecords) {
        const key = String(record.userId);
        if (!attendanceByUser.has(key)) {
            attendanceByUser.set(key, []);
        }
        attendanceByUser.get(key).push(record);
    }

    const leaveByUser = new Map();
    for (const leaveRecord of leaveRecords) {
        const key = String(leaveRecord.userId);
        if (!leaveByUser.has(key)) {
            leaveByUser.set(key, createEmptyLeaveAggregate());
        }

        const leaveAggregate = leaveByUser.get(key);
        const leaveType = normalizeLeaveType(leaveRecord.leaveType);
        const fullMonthRange = intersectRange(
            leaveRecord.leaveStartDate,
            leaveRecord.leaveEndDate,
            monthStart,
            monthEnd
        );

        if (fullMonthRange) {
            addLeaveDatesToAggregate(
                leaveAggregate.leaveDateSetFull,
                fullMonthRange.start,
                fullMonthRange.end,
                leaveType,
                holidayDates,
                leaveAggregate.leaveTypeByDate
            );
        }

        if (elapsedWindow && fullMonthRange) {
            const elapsedRange = intersectRange(
                fullMonthRange.start,
                fullMonthRange.end,
                elapsedWindow.start,
                elapsedWindow.end
            );

            if (elapsedRange) {
                addLeaveDatesToAggregate(
                    leaveAggregate.leaveDateSetElapsedWorkday,
                    elapsedRange.start,
                    elapsedRange.end,
                    leaveType,
                    holidayDates,
                    null
                );
            }
        }
    }

    // Compute summary for each user
    const summary = users.map(user => {
        const userKey = String(user._id);
        const userRecords = attendanceByUser.get(userKey) || [];
        const computed = computeUserMonthlySummary(userRecords, holidayDates);
        const leaveAggregate = leaveByUser.get(userKey) || createEmptyLeaveAggregate();
        const leaveByType = getLeaveByTypeCounts(leaveAggregate.leaveTypeByDate);
        const leaveDays = leaveAggregate.leaveDateSetFull.size;
        const absentDays = computeAbsentDays(
            elapsedWorkdaySet,
            computed.presentDateSet,
            leaveAggregate.leaveDateSetElapsedWorkday
        );
        const teamName = user?.teamId && typeof user.teamId === 'object'
            ? (user.teamId.name || null)
            : null;

        return {
            user: {
                _id: user._id,
                name: user.name,
                employeeCode: user.employeeCode,
                teamName
            },
            totalWorkdays,
            presentDays: computed.presentDays,
            absentDays,
            leaveDays,
            leaveByType,
            totalWorkMinutes: computed.totalWorkMinutes,
            totalLateCount: computed.totalLateCount,
            totalLateMinutes: computed.totalLateMinutes,
            lateDetails: computed.lateDetails,
            earlyLeaveCount: computed.earlyLeaveCount,
            totalOtMinutes: computed.totalOtMinutes,
            approvedOtMinutes: computed.approvedOtMinutes,
            unapprovedOtMinutes: computed.unapprovedOtMinutes
        };
    });

    return { summary };
};

/**
 * Compute monthly summary for a single user from their attendance records.
 * H2 Requirement: Track approved OT vs unapproved OT separately.
 */
function computeUserMonthlySummary(records, holidayDates) {
    let totalWorkMinutes = 0;
    let totalLateCount = 0;
    let totalLateMinutes = 0;
    let earlyLeaveCount = 0;
    let approvedOtMinutes = 0;
    let unapprovedOtMinutes = 0;
    const presentDateSet = new Set();
    const lateDetails = [];

    for (const record of records) {
        const computed = computeAttendance(
            {
                date: record.date,
                checkInAt: record.checkInAt,
                checkOutAt: record.checkOutAt,
                otApproved: record.otApproved
            },
            holidayDates,
            new Set()  // Phase 3: Pass empty leaveDates (aggregates don't count leave days)
        );

        totalWorkMinutes += computed.workMinutes || 0;

        if (PRESENT_STATUSES.has(computed.status)) {
            presentDateSet.add(record.date);
        }

        // Count late by lateMinutes, not status
        // This ensures WORKING and MISSING_CHECKOUT records are counted if late
        if (computed.lateMinutes > 0) {
            totalLateCount += 1;
            totalLateMinutes += computed.lateMinutes || 0;
            lateDetails.push({
                date: record.date,
                checkInTime: formatTimeGMT7(record.checkInAt),
                lateMinutes: computed.lateMinutes
            });
        }

        if (EARLY_LEAVE_STATUSES.has(computed.status)) {
            earlyLeaveCount += 1;
        }

        // H2: Track Approved vs Unapproved OT
        // Weekend/holiday attendance does not require explicit OT approval.
        if (record.otApproved || isWeekend(record.date) || holidayDates.has(record.date)) {
            // Approved: use computed OT (already > 0 because otApproved = true)
            approvedOtMinutes += computed.otMinutes || 0;
        } else {
            // Unapproved: calculate potential OT (what they WOULD have earned)
            // Defensive: Require valid check-in to prevent counting bad data
            if (record.checkOutAt && record.checkInAt) {
                const potentialOt = computePotentialOtMinutes(record.date, record.checkOutAt);
                unapprovedOtMinutes += potentialOt;
            }
        }
    }

    // Total OT = only approved OT counts
    const totalOtMinutes = approvedOtMinutes;
    lateDetails.sort((a, b) =>
        a.date.localeCompare(b.date) || a.checkInTime.localeCompare(b.checkInTime)
    );

    return {
        presentDateSet,
        presentDays: presentDateSet.size,
        totalWorkMinutes,
        totalLateCount,
        totalLateMinutes,
        lateDetails,
        earlyLeaveCount,
        totalOtMinutes,
        approvedOtMinutes,
        unapprovedOtMinutes
    };
}
