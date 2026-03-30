import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Request from '../models/Request.js';
import WorkScheduleRegistration from '../models/WorkScheduleRegistration.js';
import { computeAttendance } from '../utils/attendanceCompute.js';
import { isWeekend, getTodayDateKey, getDateRange } from '../utils/dateUtils.js';
import { isScheduleEnforcedForDate, normalizeScheduleType } from '../utils/schedulePolicy.js';

const STATUS_COLOR_MAP = {
    ON_TIME: 'green',
    LATE: 'red',
    EARLY_LEAVE: 'yellow',
    LATE_AND_EARLY: 'purple', // NEW v2.3: combined late check-in + early leave
    MISSING_CHECKOUT: 'yellow',
    MISSING_CHECKIN: 'orange', // Edge case: checkout without checkin
    WEEKEND_OR_HOLIDAY: 'gray',
    LEAVE: 'cyan', // P1 Fix: Add LEAVE color per RULES.md
    UNREGISTERED: 'orange',
    ABSENT: 'red',
    WORKING: 'blue', // Corrected per RULES.md (was white)
    UNKNOWN: 'white'
};

/**
 * Get timesheet matrix for a specific team.
 * RBAC: Manager sees their team, Admin can specify any teamId.
 * 
 * @param {string} teamId - Team's ObjectId
 * @param {string} month - "YYYY-MM" format
 * @param {Set<string>} holidayDates - Set of holiday dateKeys (optional)
 * @returns {Promise<Object>} { days: number[], rows: Array }
 */
export const getTeamTimesheet = async (teamId, month, holidayDates = new Set()) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        const error = new Error('Invalid month format. Expected YYYY-MM');
        error.statusCode = 400;
        throw error;
    }

    if (!teamId) {
        const error = new Error('Team ID is required');
        error.statusCode = 400;
        throw error;
    }

    const users = await User.find({
        teamId,
        isActive: true,
        $or: [
            { deletedAt: null },
            { deletedAt: { $exists: false } }
        ]
    })
        .select('_id name employeeCode')
        .sort({ employeeCode: 1 })
        .lean();

    return buildTimesheetMatrix(users, month, holidayDates);
};

/**
 * Get timesheet matrix for entire company.
 * RBAC: Admin only.
 * 
 * @param {string} month - "YYYY-MM" format
 * @param {Set<string>} holidayDates - Set of holiday dateKeys (optional)
 * @returns {Promise<Object>} { days: number[], rows: Array }
 */
export const getCompanyTimesheet = async (month, holidayDates = new Set()) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        const error = new Error('Invalid month format. Expected YYYY-MM');
        error.statusCode = 400;
        throw error;
    }

    const users = await User.find({
        isActive: true,
        $or: [
            { deletedAt: null },
            { deletedAt: { $exists: false } }
        ]
    })
        .select('_id name employeeCode')
        .sort({ employeeCode: 1 })
        .lean();

    return buildTimesheetMatrix(users, month, holidayDates);
};

/**
 * Build timesheet matrix for given users and month.
 * Each row = user, each cell = day status with color.
 */
async function buildTimesheetMatrix(users, month, holidayDates) {
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const todayDateKey = getTodayDateKey();

    const userIds = users.map(u => u._id);

    // P0 Fix: Use daysInMonth for consistent date range query
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;

    const attendanceRecords = await Attendance.find({
        userId: { $in: userIds },
        date: { $gte: monthStart, $lte: monthEnd }
    })
        .select(
            'userId date checkInAt checkOutAt otApproved otMode separatedOtMinutes ' +
            'scheduleType scheduledStartMinutes scheduledEndMinutes lateGraceMinutes ' +
            'lateTrackingEnabled earlyLeaveTrackingEnabled scheduleSource'
        )
        .lean();

    const scheduleRegistrations = await WorkScheduleRegistration.find({
        userId: { $in: userIds },
        workDate: { $gte: monthStart, $lte: monthEnd }
    })
        .select('userId workDate scheduleType')
        .lean();

    // Group attendance by "userId_date" for O(1) lookup
    const attendanceMap = new Map();
    for (const record of attendanceRecords) {
        const key = `${String(record.userId)}_${record.date}`;
        attendanceMap.set(key, record);
    }

    const scheduleMap = new Map();
    for (const registration of scheduleRegistrations) {
        const key = `${String(registration.userId)}_${registration.workDate}`;
        scheduleMap.set(key, normalizeScheduleType(registration.scheduleType));
    }

    // Phase 3: Query approved leaves for all users in this month
    const leaveRecords = await Request.find({
        userId: { $in: userIds },
        type: 'LEAVE',
        status: 'APPROVED',
        leaveStartDate: { $lte: monthEnd },
        leaveEndDate: { $gte: monthStart }
    })
        .select('userId leaveStartDate leaveEndDate')
        .lean();

    // Build map of userId -> Set<dateKey> for O(1) leave lookup
    const leaveByUser = new Map();
    for (const leave of leaveRecords) {
        const uid = String(leave.userId);
        if (!leaveByUser.has(uid)) {
            leaveByUser.set(uid, new Set());
        }

        // Expand leave range to individual dates within month
        const leaveDates = getDateRange(leave.leaveStartDate, leave.leaveEndDate);
        for (const dateKey of leaveDates) {
            // Only add dates within this month
            if (dateKey >= monthStart && dateKey <= monthEnd) {
                leaveByUser.get(uid).add(dateKey);
            }
        }
    }

    const rows = users.map(user => {
        // Phase 3: Get leave dates for this user
        const userLeaveDates = leaveByUser.get(String(user._id)) || new Set();

        const cells = days.map(day => {
            const dateKey = `${month}-${String(day).padStart(2, '0')}`;
            const mapKey = `${String(user._id)}_${dateKey}`;
            const attendance = attendanceMap.get(mapKey);
            const registeredScheduleType = scheduleMap.get(mapKey) || null;

            const { status, colorKey, scheduleType } = computeCellStatus(
                dateKey,
                attendance,
                registeredScheduleType,
                holidayDates,
                userLeaveDates,  // Phase 3: Pass per-user leaveDates
                todayDateKey
            );

            return { date: dateKey, status, colorKey, scheduleType };
        });

        return {
            user: {
                _id: user._id,
                name: user.name,
                employeeCode: user.employeeCode
            },
            cells
        };
    });

    return { days, rows };
}

/**
 * Compute status and color for a single cell (one user, one day).
 * Handles: weekend/holiday, leave, absent (no record), and existing attendance.
 * Phase 3: Now accepts leaveDates for LEAVE status detection.
 */
function computeCellStatus(dateKey, attendance, registeredScheduleType, holidayDates, leaveDates, todayDateKey) {
    // Weekend or Holiday check first
    if (isWeekend(dateKey) || holidayDates.has(dateKey)) {
        return {
            status: 'WEEKEND_OR_HOLIDAY',
            colorKey: STATUS_COLOR_MAP.WEEKEND_OR_HOLIDAY,
            scheduleType: null
        };
    }

    const isFutureDate = dateKey > todayDateKey;
    const isTodayDate = dateKey === todayDateKey;
    const scheduleEnforced = isScheduleEnforcedForDate(dateKey);
    const hasValidScheduleRegistration = Boolean(registeredScheduleType);

    // No attendance record
    if (!attendance) {
        // P0 Fix: Check LEAVE before ABSENT (priority order per RULES.md §8.3)
        if (leaveDates && leaveDates.has(dateKey)) {
            return {
                status: 'LEAVE',
                colorKey: STATUS_COLOR_MAP.LEAVE,
                scheduleType: null
            };
        }

        if (isFutureDate) {
            return {
                status: null,
                colorKey: 'white',
                scheduleType: registeredScheduleType
            };
        }

        if (scheduleEnforced) {
            if (!hasValidScheduleRegistration) {
                return {
                    status: 'UNREGISTERED',
                    colorKey: STATUS_COLOR_MAP.UNREGISTERED,
                    scheduleType: null
                };
            }
            if (isTodayDate) {
                return {
                    status: null,
                    colorKey: 'white',
                    scheduleType: registeredScheduleType
                };
            }
            return {
                status: 'ABSENT',
                colorKey: STATUS_COLOR_MAP.ABSENT,
                scheduleType: registeredScheduleType
            };
        }

        if (isTodayDate) {
            return {
                status: null,
                colorKey: 'white',
                scheduleType: registeredScheduleType
            };
        }

        // Legacy past workday with no record -> ABSENT
        return {
            status: 'ABSENT',
            colorKey: STATUS_COLOR_MAP.ABSENT,
            scheduleType: null
        };
    }

    // Has attendance record -> compute using existing utility
    const computed = computeAttendance(
        {
            date: dateKey,
            checkInAt: attendance.checkInAt,
            checkOutAt: attendance.checkOutAt,
            otApproved: !!attendance.otApproved,
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
        leaveDates,
        {
            hasValidScheduleRegistration,
            isScheduleEnforcementActive: scheduleEnforced
        }
    );

    const status = computed.status === 'UNKNOWN' ? null : computed.status;
    const scheduleType = normalizeScheduleType(attendance.scheduleType) || registeredScheduleType || null;

    return {
        status,
        colorKey: STATUS_COLOR_MAP[status] || 'white',
        scheduleType
    };
}
