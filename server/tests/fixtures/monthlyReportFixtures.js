/**
 * Monthly Report Test Fixtures
 * 
 * Provides reusable factory functions for generating test data:
 * - Users (Admin, Manager, Employee)
 * - Teams
 * - Attendance records
 * - Leave requests
 * - Holiday sets
 * - Pre-built scenario datasets
 */

import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

/**
 * Create test user with specified role and team
 */
export async function createTestUser(User, { employeeCode, name, email, role, teamId = null }) {
    const passwordHash = await bcrypt.hash('Password123', 10);
    
    return await User.create({
        employeeCode,
        name,
        email,
        passwordHash,
        role,
        teamId,
        isActive: true
    });
}

/**
 * Create test team
 */
export async function createTestTeam(Team, { name }) {
    return await Team.create({ name });
}

/**
 * Create attendance record
 * @param {Date|string} checkInAt - ISO string or Date object (GMT+7 aware)
 * @param {Date|string} checkOutAt - ISO string or Date object (GMT+7 aware)
 */
export function createAttendanceRecord(userId, date, checkInAt, checkOutAt = null, otApproved = false) {
    return {
        userId,
        date,
        checkInAt: typeof checkInAt === 'string' ? new Date(checkInAt) : checkInAt,
        checkOutAt: checkOutAt ? (typeof checkOutAt === 'string' ? new Date(checkOutAt) : checkOutAt) : null,
        otApproved
    };
}

/**
 * Create leave request
 */
export function createLeaveRequest(userId, startDate, endDate, status = 'APPROVED') {
    return {
        userId,
        type: 'LEAVE',
        leaveStartDate: startDate,
        leaveEndDate: endDate,
        status
    };
}

/**
 * Create holiday set from array of date strings
 */
export function createHolidaySet(holidays = []) {
    return new Set(holidays);
}

/**
 * Scenario Dataset 1: Basic Calculation Validation
 * Purpose: Validate basic summary calculations (C2, C3)
 * 
 * Past month (Feb 2026) with mixed attendance
 */
export function getScenario1Data(employeeId) {
    const month = '2026-02';
    
    const attendance = [
        createAttendanceRecord(employeeId, '2026-02-03', '2026-02-03T01:30:00Z', '2026-02-03T10:30:00Z'), // Mon, 08:30-17:30 GMT+7
        createAttendanceRecord(employeeId, '2026-02-04', '2026-02-04T01:30:00Z', '2026-02-04T10:30:00Z'), // Tue
        createAttendanceRecord(employeeId, '2026-02-05', '2026-02-05T02:00:00Z', '2026-02-05T10:30:00Z'), // Wed, late 15m
        createAttendanceRecord(employeeId, '2026-02-10', '2026-02-10T01:30:00Z', '2026-02-10T10:00:00Z'), // Mon, early leave
        createAttendanceRecord(employeeId, '2026-02-11', '2026-02-11T01:30:00Z', '2026-02-11T10:30:00Z'), // Tue
    ];
    
    const leaves = [
        createLeaveRequest(employeeId, '2026-02-06', '2026-02-07'), // Thu-Fri
    ];
    
    const holidays = createHolidaySet(['2026-02-12']); // Wed holiday
    
    return { month, attendance, leaves, holidays };
}

/**
 * Scenario Dataset 2: Leave Edge Cases
 * Purpose: Validate GAP-1 (leave workday filtering), N2 (overlap clipping)
 * 
 * Cross-month leave with weekends and holidays
 */
export function getScenario2Data(employeeId) {
    const month = '2026-02';
    
    const attendance = [
        createAttendanceRecord(employeeId, '2026-02-03', '2026-02-03T01:30:00Z', '2026-02-03T10:30:00Z'),
    ];
    
    const leaves = [
        // Leave spanning Jan 28 (Wed) -> Feb 3 (Tue)
        // Jan 31-Feb 1 are weekend, Feb 2 (Mon) is in month
        createLeaveRequest(employeeId, '2026-01-28', '2026-02-03'),
        
        // Weekend-only leave (should count as 0 workdays)
        createLeaveRequest(employeeId, '2026-02-07', '2026-02-08'), // Sat-Sun
        
        // Leave including holiday
        createLeaveRequest(employeeId, '2026-02-12', '2026-02-13'), // Wed (holiday) + Thu
        
        createLeaveRequest(employeeId, '2026-02-20', '2026-02-20'), // Thu
    ];
    
    const holidays = createHolidaySet(['2026-02-12']); // Wed
    
    return { month, attendance, leaves, holidays };
}

/**
 * Scenario Dataset 3: Late Details Sorting
 * Purpose: Validate C5 (deterministic sorting)
 * 
 * Multiple late check-ins in same month
 */
export function getScenario3Data(employeeId) {
    const month = '2026-02';
    
    const attendance = [
        // Different dates, unsorted order
        createAttendanceRecord(employeeId, '2026-02-10', '2026-02-10T02:10:00Z', '2026-02-10T10:30:00Z'), // 09:10 GMT+7, late 25m
        createAttendanceRecord(employeeId, '2026-02-05', '2026-02-05T02:00:00Z', '2026-02-05T10:30:00Z'), // 09:00 GMT+7, late 15m
        createAttendanceRecord(employeeId, '2026-02-17', '2026-02-17T02:05:00Z', '2026-02-17T10:30:00Z'), // 09:05 GMT+7, late 20m

        // Keep unique userId+date (attendance schema unique index)
        createAttendanceRecord(employeeId, '2026-02-20', '2026-02-20T02:00:00Z', '2026-02-20T10:30:00Z'), // 09:00 GMT+7, late 15m
        createAttendanceRecord(employeeId, '2026-02-24', '2026-02-24T02:30:00Z', '2026-02-24T11:00:00Z'), // 09:30 GMT+7, late 45m
    ];
    
    const leaves = [];
    const holidays = createHolidaySet([]);
    
    return { month, attendance, leaves, holidays };
}

/**
 * Scenario Dataset 4: Admin Team Scope
 * Purpose: Validate C1 (team selector, teamId requirement)
 * 
 * Multiple teams with different users
 */
export async function getScenario4Users(User, Team) {
    const team1 = await createTestTeam(Team, { name: 'Engineering Team' });
    const team2 = await createTestTeam(Team, { name: 'Sales Team' });
    
    const admin = await createTestUser(User, {
        employeeCode: 'ADM001',
        name: 'Admin User',
        email: 'admin-scenario4@test.com',
        role: 'ADMIN'
    });
    
    const manager1 = await createTestUser(User, {
        employeeCode: 'MGR001',
        name: 'Manager Team 1',
        email: 'manager1-scenario4@test.com',
        role: 'MANAGER',
        teamId: team1._id
    });
    
    const emp1 = await createTestUser(User, {
        employeeCode: 'EMP001',
        name: 'Employee Team 1',
        email: 'emp1-scenario4@test.com',
        role: 'EMPLOYEE',
        teamId: team1._id
    });
    
    const emp2 = await createTestUser(User, {
        employeeCode: 'EMP002',
        name: 'Employee Team 2',
        email: 'emp2-scenario4@test.com',
        role: 'EMPLOYEE',
        teamId: team2._id
    });
    
    return { admin, manager1, emp1, emp2, team1, team2 };
}

/**
 * Scenario Dataset 5: Current Month Elapsed Logic
 * Purpose: Validate C2 (elapsed window boundary)
 * 
 * Today = mid-month (e.g., 15th), attendance both before and after today
 */
export function getScenario5Data(employeeId, todayDate = '2026-03-15') {
    const month = '2026-03';
    
    const attendance = [
        // Before today
        createAttendanceRecord(employeeId, '2026-03-03', '2026-03-03T01:30:00Z', '2026-03-03T10:30:00Z'), // Mon
        createAttendanceRecord(employeeId, '2026-03-10', '2026-03-10T01:30:00Z', '2026-03-10T10:30:00Z'), // Mon
        createAttendanceRecord(employeeId, '2026-03-14', '2026-03-14T01:30:00Z', '2026-03-14T10:30:00Z'), // Sat
        
        // After today (should NOT affect absentDays calculation)
        createAttendanceRecord(employeeId, '2026-03-20', '2026-03-20T01:30:00Z', '2026-03-20T10:30:00Z'), // Thu (future)
        createAttendanceRecord(employeeId, '2026-03-25', '2026-03-25T01:30:00Z', '2026-03-25T10:30:00Z'), // Tue (future)
    ];
    
    const leaves = [
        createLeaveRequest(employeeId, '2026-03-05', '2026-03-06'), // Wed-Thu before today
    ];
    
    const holidays = createHolidaySet(['2026-03-08']); // Sun (weekend holiday, shouldn't affect)
    
    return { month, attendance, leaves, holidays, todayDate };
}

/**
 * Scenario Dataset 6: Empty/Edge Teams
 * Purpose: Validate GAP-3 (subtitle fallback)
 * 
 * Team with no users, team with 1 user
 */
export async function getScenario6Teams(Team, User) {
    const emptyTeam = await createTestTeam(Team, { name: 'Empty Team' });
    
    const oneUserTeam = await createTestTeam(Team, { name: 'One User Team' });
    const employee = await createTestUser(User, {
        employeeCode: 'EMP999',
        name: 'Solo Employee',
        email: 'solo@test.com',
        role: 'EMPLOYEE',
        teamId: oneUserTeam._id
    });
    
    return { emptyTeam, oneUserTeam, employee };
}

/**
 * Login helper to get auth token
 */
export async function loginUser(app, request, email, password = 'Password123') {
    const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: email, password });
    
    return res.body.token;
}

/**
 * Clear all test data
 */
export async function clearTestData(User, Team, Attendance, Request) {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
}
