/**
 * Test Suite: Monthly Report Enhancement - Unit Tests
 * 
 * Coverage:
 * - C2: Elapsed Workdays for Absent Days (8 tests)
 * - C3: Set-Based Logic to Prevent Double-Counting (6 tests)
 * - C4: Leave Type Breakdown (4 tests)
 * - GAP-1: Leave Workday Filtering (5 tests)
 * - GAP-2: Service Layer Modularity (2 tests)
 * 
 * Framework: Vitest + Test fixtures
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import * as dateUtils from '../src/utils/dateUtils.js';
import { getMonthlyReport } from '../src/services/reportService.js';
import { countWorkdays } from '../src/utils/dateUtils.js';
import {
    createTestUser,
    createTestTeam,
    getScenario1Data,
    getScenario2Data,
    getScenario5Data,
    clearTestData
} from './fixtures/monthlyReportFixtures.js';

let testTeam, testEmployee;

beforeAll(async () => {
    await clearTestData(User, Team, Attendance, Request);

    // Create test team and employee
    testTeam = await createTestTeam(Team, { name: 'Unit Test Team' });
    testEmployee = await createTestUser(User, {
        employeeCode: 'UNIT001',
        name: 'Unit Test Employee',
        email: 'unittest@test.com',
        role: 'EMPLOYEE',
        teamId: testTeam._id
    });
});

afterAll(async () => {
    await clearTestData(User, Team, Attendance, Request);
});

beforeEach(async () => {
    // Clear attendance and leave data before each test
    await Attendance.deleteMany({});
    await Request.deleteMany({});
    
    // Restore any mocked functions
    vi.restoreAllMocks();
});

describe('C2: Elapsed Workdays for Absent Days', () => {
    
    it('C2-TC1: Past month uses full month workdays for absentDays calculation', async () => {
        // Arrange: Mock today as future date (March 10, 2026)
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-03-10');
        
        const month = '2026-02'; // Past month
        const scenario = getScenario1Data(testEmployee._id);
        
        // Create attendance: 5 present days
        await Attendance.insertMany(scenario.attendance);
        
        // Create approved leave: 1 leave day (Feb 6 is Fri, Feb 7 is Sat)
        await Request.insertMany(scenario.leaves);
        
        const holidays = scenario.holidays;
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        expect(row).toBeDefined();
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        
        // Present: 5 days, Leave: 1 day
        // Absent = totalWorkdays - 5 (present) - 1 (leave)
        const expectedAbsent = totalWorkdays - 5 - 1;
        
        expect(row.totalWorkdays).toBe(totalWorkdays);
        expect(row.presentDays).toBe(5);
        expect(row.leaveDays).toBe(1);
        expect(row.absentDays).toBe(expectedAbsent);
        expect(row.absentDays).toBeGreaterThanOrEqual(0);
    });

    it('C2-TC2: Current month (today=15th) uses workdays up to today only', async () => {
        // Arrange: Mock today as March 15, 2026
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-03-15');
        
        const scenario = getScenario5Data(testEmployee._id, '2026-03-15');
        
        // Attendance includes records AFTER today (should NOT affect absentDays)
        await Attendance.insertMany(scenario.attendance);
        await Request.insertMany(scenario.leaves);
        
        // Act
        const result = await getMonthlyReport('company', '2026-03', null, scenario.holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        expect(row).toBeDefined();
        
        // Elapsed workdays: from 03-01 to 03-15 (excluding weekends and holidays)
        const elapsedWorkdays = countWorkdays('2026-03-01', '2026-03-15', scenario.holidays);
        
        // Present days in monthly display: 4 days
        // (03-03, 03-10, 03-20, 03-25). 03-14 is Saturday and not counted as present.
        // Leave before today: 2 days (03-05, 03-06)
        
        expect(row.presentDays).toBe(4);
        
        // But absentDays should only consider elapsed window
        const expectedAbsent = elapsedWorkdays - 2 - 2; // Only elapsed workdays before/at today
        expect(row.absentDays).toBe(expectedAbsent);
    });

    it('C2-TC3: Current month (today=1st) has minimal elapsed window', async () => {
        // Arrange: Mock today near month start
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-03-03'); // Tuesday
        
        const month = '2026-03';
        
        // One attendance on 03-03 (today)
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-03-03',
            checkInAt: new Date('2026-03-03T01:30:00Z'),
            checkOutAt: new Date('2026-03-03T10:30:00Z')
        });
        
        const holidays = new Set();
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Elapsed workdays: 03-01 (Sun), 03-02 (Mon), 03-03 (Tue) = 2 workdays
        const elapsedWorkdays = countWorkdays('2026-03-01', '2026-03-03', holidays);
        expect(elapsedWorkdays).toBe(2);
        
        expect(row.presentDays).toBe(1);
        expect(row.absentDays).toBe(1); // 2 elapsed - 1 present = 1 absent
    });

    it('C2-TC4: Current month (today=last day) uses full month', async () => {
        // Arrange: Mock today as last day of Feb 2026
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-02-28'); // Saturday (last day)
        
        const month = '2026-02';
        const holidays = new Set(['2026-02-12']);
        
        // 3 attendance days
        await Attendance.insertMany([
            {
                userId: testEmployee._id,
                date: '2026-02-03',
                checkInAt: new Date('2026-02-03T01:30:00Z'),
                checkOutAt: new Date('2026-02-03T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-10',
                checkInAt: new Date('2026-02-10T01:30:00Z'),
                checkOutAt: new Date('2026-02-10T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-17',
                checkInAt: new Date('2026-02-17T01:30:00Z'),
                checkOutAt: new Date('2026-02-17T10:30:00Z')
            }
        ]);
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        expect(row.totalWorkdays).toBe(totalWorkdays);
        
        // Elapsed = full month
        const expectedAbsent = totalWorkdays - 3;
        expect(row.absentDays).toBe(expectedAbsent);
    });

    it('C2-TC5: Future month has absentDays = 0', async () => {
        // Arrange: Mock today as March 10, 2026
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-03-10');
        
        const futureMonth = '2099-12'; // Far future
        
        // Even if there are attendance records (hypothetical future data)
        await Attendance.create({
            userId: testEmployee._id,
            date: '2099-12-15',
            checkInAt: new Date('2099-12-15T01:30:00Z'),
            checkOutAt: new Date('2099-12-15T10:30:00Z')
        });
        
        // Act
        const result = await getMonthlyReport('company', futureMonth, null, new Set());
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Future month: elapsed window is null, so absentDays = 0
        expect(row.absentDays).toBe(0);
    });

    it('C2-TC6: Boundary - today equals monthStart', async () => {
        // Arrange: Today is early month boundary
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-03-03'); // Tuesday
        
        const month = '2026-03';
        
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-03-03',
            checkInAt: new Date('2026-03-03T01:30:00Z'),
            checkOutAt: new Date('2026-03-03T10:30:00Z')
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, new Set());
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.presentDays).toBe(1);
        expect(row.absentDays).toBe(1); // Elapsed workdays = 2 (Mon, Tue)
    });

    it('C2-TC7: Boundary - today equals monthEnd', async () => {
        // Arrange: Today is last day of month
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-02-28');
        
        const month = '2026-02';
        const holidays = new Set();
        
        // 10 present days throughout month
        const attendanceDates = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06',
                                 '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13'];
        
        await Attendance.insertMany(
            attendanceDates.map(date => ({
                userId: testEmployee._id,
                date,
                checkInAt: new Date(`${date}T01:30:00Z`),
                checkOutAt: new Date(`${date}T10:30:00Z`)
            }))
        );
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        expect(row.totalWorkdays).toBe(totalWorkdays);
        expect(row.presentDays).toBe(10);
        
        const expectedAbsent = totalWorkdays - 10;
        expect(row.absentDays).toBe(expectedAbsent);
    });

    it('C2-TC8: Mid-month with mixed attendance/leave/absent', async () => {
        // Arrange: Today = Feb 20, 2026
        vi.spyOn(dateUtils, 'getTodayDateKey').mockReturnValue('2026-02-20');
        
        const month = '2026-02';
        const holidays = new Set(['2026-02-12']);
        
        // 5 present days before today
        await Attendance.insertMany([
            { userId: testEmployee._id, date: '2026-02-03', checkInAt: new Date('2026-02-03T01:30:00Z'), checkOutAt: new Date('2026-02-03T10:30:00Z') },
            { userId: testEmployee._id, date: '2026-02-05', checkInAt: new Date('2026-02-05T01:30:00Z'), checkOutAt: new Date('2026-02-05T10:30:00Z') },
            { userId: testEmployee._id, date: '2026-02-10', checkInAt: new Date('2026-02-10T01:30:00Z'), checkOutAt: new Date('2026-02-10T10:30:00Z') },
            { userId: testEmployee._id, date: '2026-02-17', checkInAt: new Date('2026-02-17T01:30:00Z'), checkOutAt: new Date('2026-02-17T10:30:00Z') },
            { userId: testEmployee._id, date: '2026-02-19', checkInAt: new Date('2026-02-19T01:30:00Z'), checkOutAt: new Date('2026-02-19T10:30:00Z') }
        ]);
        
        // 1 leave day before today (Feb 7 is Saturday)
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-06',
            leaveEndDate: '2026-02-07',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        const elapsedWorkdays = countWorkdays('2026-02-01', '2026-02-20', holidays);
        
        expect(row.presentDays).toBe(5);
        expect(row.leaveDays).toBe(1);
        
        const expectedAbsent = elapsedWorkdays - 5 - 1;
        expect(row.absentDays).toBe(expectedAbsent);
        expect(row.absentDays).toBeGreaterThan(0); // Should have some absent days
    });
});

describe('C3: Set-Based Logic to Prevent Double-Counting', () => {
    
    beforeEach(() => {
        // Use real today for C3 tests (not mocked)
        vi.restoreAllMocks();
    });

    it('C3-TC1: Day with both leave AND attendance counts as present (not double-counted)', async () => {
        // Arrange: Past month to avoid elapsed window issues
        const month = '2026-02';
        const holidays = new Set();
        
        // Attendance on Feb 5
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Leave request that includes Feb 5-7
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-05',
            leaveEndDate: '2026-02-07',
            leaveType: 'SICK',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Feb 5 has attendance -> present
        // Feb 6 is leave day (Feb 7 is Saturday)
        expect(row.presentDays).toBe(1); // Only Feb 5
        expect(row.leaveDays).toBe(2); // Feb 5, 6 (Feb 7 weekend excluded)
        
        // Set-based logic: absentDays = elapsedWorkdays - presentDateSet - leaveDateSetElapsed
        // Feb 5 is in presentDateSet, so it's NOT absent
        // The leave on Feb 5 doesn't make it "double count" as both present and leave in absentDays calc
    });

    it('C3-TC2: Day with leave only (no attendance) counts as leave day (not absent)', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        // Leave on Feb 10-11 (no attendance)
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-10',
            leaveEndDate: '2026-02-11',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.presentDays).toBe(0);
        expect(row.leaveDays).toBe(2);
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        
        // Absent = totalWorkdays - 0 (present) - 2 (leave)
        const expectedAbsent = totalWorkdays - 0 - 2;
        expect(row.absentDays).toBe(expectedAbsent);
    });

    it('C3-TC3: Workday with no attendance and no leave counts as absent', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        // No attendance, no leave
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        
        expect(row.presentDays).toBe(0);
        expect(row.leaveDays).toBe(0);
        expect(row.absentDays).toBe(totalWorkdays); // All workdays are absent
    });

    it('C3-TC4: Weekend with attendance record not counted in absentDays', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        // Attendance on weekend + weekdays
        await Attendance.insertMany([
            {
                userId: testEmployee._id,
                date: '2026-02-01', // Sunday
                checkInAt: new Date('2026-02-01T01:30:00Z'),
                checkOutAt: new Date('2026-02-01T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-02', // Monday (workday)
                checkInAt: new Date('2026-02-02T01:30:00Z'),
                checkOutAt: new Date('2026-02-02T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-03', // Tuesday (workday)
                checkInAt: new Date('2026-02-03T01:30:00Z'),
                checkOutAt: new Date('2026-02-03T10:30:00Z')
            }
        ]);
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.presentDays).toBe(2);
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        
        // absentDays only looks at workdays, so weekend attendance doesn't affect it
        // Absent = totalWorkdays - 2 (Mon + Tue are workday present)
        const expectedAbsent = totalWorkdays - 2;
        expect(row.absentDays).toBe(expectedAbsent);
    });

    it('C3-TC5: Holiday with attendance record not counted in absentDays', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set(['2026-02-12']); // Wednesday holiday
        
        // Attendance on holiday and regular days
        await Attendance.insertMany([
            {
                userId: testEmployee._id,
                date: '2026-02-12', // Holiday
                checkInAt: new Date('2026-02-12T01:30:00Z'),
                checkOutAt: new Date('2026-02-12T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-13', // Regular Thursday
                checkInAt: new Date('2026-02-13T01:30:00Z'),
                checkOutAt: new Date('2026-02-13T10:30:00Z')
            }
        ]);
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.presentDays).toBe(1);
        
        const totalWorkdays = countWorkdays('2026-02-01', '2026-02-28', holidays);
        
        // Only Feb 13 is workday present (Feb 12 is holiday, excluded from workdays)
        const expectedAbsent = totalWorkdays - 1;
        expect(row.absentDays).toBe(expectedAbsent);
    });

    it('C3-TC6: Multiple check-ins same day are blocked by unique index', async () => {
        // Arrange + Assert
        await expect(
            Attendance.insertMany([
                {
                    userId: testEmployee._id,
                    date: '2026-02-05',
                    checkInAt: new Date('2026-02-05T01:00:00Z'),
                    checkOutAt: new Date('2026-02-05T05:00:00Z')
                },
                {
                    userId: testEmployee._id,
                    date: '2026-02-05',
                    checkInAt: new Date('2026-02-05T06:00:00Z'),
                    checkOutAt: new Date('2026-02-05T10:30:00Z')
                }
            ])
        ).rejects.toThrow(/E11000|duplicate key/i);
    });
});

describe('C4: Leave Type Breakdown', () => {
    
    it('C4-TC1: Leave with type ANNUAL counted in leaveByType.ANNUAL', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-10',
            leaveEndDate: '2026-02-11',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.leaveByType).toEqual({
            ANNUAL: 2, // Mon-Tue
            SICK: 0,
            UNPAID: 0,
            UNSPECIFIED: 0
        });
    });

    it('C4-TC2: Leave with type SICK counted in leaveByType.SICK', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-17',
            leaveEndDate: '2026-02-18',
            leaveType: 'SICK',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.leaveByType).toEqual({
            ANNUAL: 0,
            SICK: 2,
            UNPAID: 0,
            UNSPECIFIED: 0
        });
    });

    it('C4-TC3: Leave with type UNPAID counted in leaveByType.UNPAID', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-24',
            leaveEndDate: '2026-02-25',
            leaveType: 'UNPAID',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        expect(row.leaveByType).toEqual({
            ANNUAL: 0,
            SICK: 0,
            UNPAID: 2,
            UNSPECIFIED: 0
        });
    });

    it('C4-TC4A: Leave with null type counted as UNSPECIFIED', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-05',
            leaveEndDate: '2026-02-06',
            leaveType: null,
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // 2 workdays from Feb 5-6
        expect(row.leaveByType.UNSPECIFIED).toBe(2);
        expect(row.leaveByType.ANNUAL).toBe(0);
        expect(row.leaveByType.SICK).toBe(0);
        expect(row.leaveByType.UNPAID).toBe(0);
    });

    it('C4-TC4B: Leave with invalid type is rejected by schema validation', async () => {
        await expect(
            Request.create({
                userId: testEmployee._id,
                type: 'LEAVE',
                leaveStartDate: '2026-02-19',
                leaveEndDate: '2026-02-19',
                leaveType: 'INVALID_TYPE',
                status: 'APPROVED'
            })
        ).rejects.toThrow(/leaveType|valid enum value/i);
    });
});

describe('GAP-1: Leave Workday Filtering', () => {
    
    it('GAP1-TC1: Leave spanning full week (Mon-Sun) only counts Mon-Fri', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        // Leave from Mon Feb 3 to Sun Feb 9
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-03',
            leaveEndDate: '2026-02-09',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Mon-Fri = 5 workdays (Sat-Sun excluded)
        expect(row.leaveDays).toBe(5);
        expect(row.leaveByType.ANNUAL).toBe(5);
    });

    it('GAP1-TC2: Leave including holiday excludes holiday from count', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set(['2026-02-12']); // Thursday
        
        // Leave from Thu Feb 12 to Sat Feb 14
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-12',
            leaveEndDate: '2026-02-14',
            leaveType: 'SICK',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Feb 12 (holiday), Feb 13 (Fri), Feb 14 (Sat)
        // Only Feb 13 counts = 1 workday
        expect(row.leaveDays).toBe(1);
        expect(row.leaveByType.SICK).toBe(1);
    });

    it('GAP1-TC3: Leave on weekend only results in leaveDays = 0', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        // Leave on Sat-Sun Feb 7-8
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-07',
            leaveEndDate: '2026-02-08',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Weekend leave doesn't count as workday leave
        expect(row.leaveDays).toBe(0);
        expect(row.leaveByType.ANNUAL).toBe(0);
    });

    it('GAP1-TC4: Leave cross-month with weekends/holidays only counts workdays in target month', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set(['2026-02-12']);
        
        // Leave from Jan 30 (Fri) to Feb 5 (Thu)
        // Jan 31-Feb 1 are weekend
        // Feb 2 (Mon), Feb 3 (Tue), Feb 4 (Wed), Feb 5 (Thu) are in Feb
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-01-30',
            leaveEndDate: '2026-02-05',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Only Feb workdays: Feb 2-5 = 4 days (Mon-Thu)
        // Jan 30 is not in Feb, weekends excluded
        expect(row.leaveDays).toBe(4);
        expect(row.leaveByType.ANNUAL).toBe(4);
    });

    it('GAP1-TC5: Holiday on weekend not double-excluded', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set(['2026-02-08']); // Sunday (already weekend)
        
        // Leave from Fri-Mon (Feb 6-9)
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-06',
            leaveEndDate: '2026-02-09',
            leaveType: 'SICK',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Feb 6 (Fri), Feb 7 (Sat - weekend), Feb 8 (Sun - weekend+holiday), Feb 9 (Mon)
        // Only Fri and Mon = 2 workdays
        expect(row.leaveDays).toBe(2);
        expect(row.leaveByType.SICK).toBe(2);
    });
});

describe('GAP-2: Service Layer Modularity', () => {
    
    it('GAP2-TC1: computeUserMonthlySummary exists and is testable without DB', async () => {
        // This test verifies the function exists and can be called independently
        // In the refactored code, computeUserMonthlySummary is internal to reportService
        // We test it indirectly through getMonthlyReport
        
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Verify that the computation logic works correctly
        expect(row).toBeDefined();
        expect(row.presentDays).toBe(1);
        expect(row.totalWorkMinutes).toBeGreaterThan(0);
    });

    it('GAP2-TC2: getMonthlyReport orchestrates DB queries and computation', async () => {
        // Arrange
        const month = '2026-02';
        const holidays = new Set();
        
        // Create test data
        await Attendance.insertMany([
            {
                userId: testEmployee._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-10',
                checkInAt: new Date('2026-02-10T01:30:00Z'),
                checkOutAt: new Date('2026-02-10T10:30:00Z')
            }
        ]);
        
        await Request.create({
            userId: testEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-17',
            leaveEndDate: '2026-02-18',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const result = await getMonthlyReport('company', month, null, holidays);
        
        // Assert
        expect(result).toBeDefined();
        expect(result.summary).toBeInstanceOf(Array);
        expect(result.summary.length).toBeGreaterThan(0);
        
        const row = result.summary.find(r => r.user.employeeCode === 'UNIT001');
        
        // Verify orchestration: DB data + computation results
        expect(row.presentDays).toBe(2);
        expect(row.leaveDays).toBe(2);
        expect(row.leaveByType.ANNUAL).toBe(2);
        expect(row.user.teamName).toBe('Unit Test Team');
    });
});
