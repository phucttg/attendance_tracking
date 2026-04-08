import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import { getMonthlyReport } from '../src/services/reportService.js';
import { createTimeInGMT7 } from '../src/utils/dateUtils.js';

describe('Monthly report weekend OT classification', () => {
  let teamId;
  let userId;

  beforeAll(async () => {
    await mongoose.connect(
      process.env.MONGO_URI?.replace(/\/[^/]+$/, '/report_weekend_ot_test_db')
      || 'mongodb://localhost:27017/report_weekend_ot_test_db'
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await User.deleteMany({
      $or: [{ employeeCode: /^WKOT/ }, { email: /^wkot\d+@example\.com$/ }]
    });
    await Team.deleteMany({ name: /^WKOT/ });
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await User.deleteMany({
      $or: [{ employeeCode: /^WKOT/ }, { email: /^wkot\d+@example\.com$/ }]
    });
    await Team.deleteMany({ name: /^WKOT/ });

    // Keep "today" after target month so report uses full month window.
    vi.setSystemTime(new Date('2026-03-20T03:00:00.000Z'));

    const team = await Team.create({ name: 'WKOT Team' });
    teamId = team._id;

    const user = await User.create({
      employeeCode: 'WKOT001',
      name: 'Weekend OT User',
      email: 'wkot001@example.com',
      passwordHash: 'hash',
      role: 'EMPLOYEE',
      teamId,
      isActive: true
    });
    userId = user._id;
  });

  it('classifies weekend OT as approved even when attendance.otApproved=false', async () => {
    const weekendDate = '2026-02-14'; // Saturday

    await Attendance.create({
      userId,
      date: weekendDate,
      checkInAt: createTimeInGMT7(weekendDate, 9, 0),
      checkOutAt: createTimeInGMT7(weekendDate, 18, 0),
      otApproved: false
    });

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.totalWorkMinutes).toBe(480);
    expect(row.approvedOtMinutes).toBe(480);
    expect(row.unapprovedOtMinutes).toBe(0);
    expect(row.totalOtMinutes).toBe(480);
    // Keep presentDays semantics unchanged (workday presence only)
    expect(row.presentDays).toBe(0);
  });

  // ─── EP: Holiday (weekday) OT classification ─────────────────

  it('classifies holiday (weekday) OT as approved', async () => {
    const holidayDate = '2026-02-10'; // Tuesday
    const holidayDates = new Set([holidayDate]);

    await Attendance.create({
      userId,
      date: holidayDate,
      checkInAt: createTimeInGMT7(holidayDate, 8, 0),
      checkOutAt: createTimeInGMT7(holidayDate, 17, 0),
      otApproved: false
    });

    const result = await getMonthlyReport('company', '2026-02', null, holidayDates);
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.approvedOtMinutes).toBe(480); // 8h - 1h lunch = 480
    expect(row.unapprovedOtMinutes).toBe(0);
  });

  // ─── EP: Multiple weekend records aggregation ─────────────────

  it('aggregates OT from multiple weekend records', async () => {
    const sat1 = '2026-02-07'; // Saturday
    const sun1 = '2026-02-08'; // Sunday
    const sat2 = '2026-02-14'; // Saturday

    await Attendance.insertMany([
      {
        userId, date: sat1,
        checkInAt: createTimeInGMT7(sat1, 9, 0),
        checkOutAt: createTimeInGMT7(sat1, 12, 0),
        otApproved: false
      },
      {
        userId, date: sun1,
        checkInAt: createTimeInGMT7(sun1, 8, 0),
        checkOutAt: createTimeInGMT7(sun1, 11, 0),
        otApproved: false
      },
      {
        userId, date: sat2,
        checkInAt: createTimeInGMT7(sat2, 10, 0),
        checkOutAt: createTimeInGMT7(sat2, 14, 0),
        otApproved: false
      }
    ]);

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    // sat1: 9-12 = 180, sun1: 8-11 = 180, sat2: 10-14 = 4h spans lunch → 240 - 60 = 180
    expect(row.approvedOtMinutes).toBe(180 + 180 + 180);
    expect(row.unapprovedOtMinutes).toBe(0);
  });

  // ─── DT: Mixed weekend + weekday approved OT ─────────────────

  it('sums weekend OT + weekday approved OT correctly', async () => {
    const satDate = '2026-02-14'; // Saturday
    const tueDate = '2026-02-10'; // Tuesday

    await Attendance.insertMany([
      {
        userId, date: satDate,
        checkInAt: createTimeInGMT7(satDate, 9, 0),
        checkOutAt: createTimeInGMT7(satDate, 18, 0),
        otApproved: false
      },
      {
        userId, date: tueDate,
        checkInAt: createTimeInGMT7(tueDate, 8, 0),
        checkOutAt: createTimeInGMT7(tueDate, 20, 0),
        otApproved: true
      }
    ]);

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    // Sat: 480 (weekend, auto-approved) + Tue: 150 (20:00 - 17:30, approved OT)
    expect(row.approvedOtMinutes).toBe(480 + 150);
    expect(row.unapprovedOtMinutes).toBe(0);
  });

  // ─── DT: Mixed weekend + weekday unapproved OT ───────────────

  it('splits weekend approved vs weekday unapproved correctly', async () => {
    const satDate = '2026-02-14'; // Saturday
    const wedDate = '2026-02-11'; // Wednesday

    await Attendance.insertMany([
      {
        userId, date: satDate,
        checkInAt: createTimeInGMT7(satDate, 9, 0),
        checkOutAt: createTimeInGMT7(satDate, 18, 0),
        otApproved: false
      },
      {
        userId, date: wedDate,
        checkInAt: createTimeInGMT7(wedDate, 8, 0),
        checkOutAt: createTimeInGMT7(wedDate, 20, 0),
        otApproved: false // NOT approved on weekday
      }
    ]);

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.approvedOtMinutes).toBe(480); // Only weekend
    // Weekday unapproved: computePotentialOtMinutes(Wed, 20:00) = 150
    expect(row.unapprovedOtMinutes).toBe(150);
  });

  // ─── BVA: Weekend with no checkout (incomplete session) ───────

  it('reports zero OT for weekend with checkIn but no checkOut', async () => {
    const satDate = '2026-02-14'; // Saturday

    await Attendance.create({
      userId, date: satDate,
      checkInAt: createTimeInGMT7(satDate, 9, 0),
      // No checkOutAt
      otApproved: false
    });

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.approvedOtMinutes).toBe(0);
    expect(row.totalWorkMinutes).toBe(0);
  });

  // ─── DT: Holiday + weekend overlap (no double count) ──────────

  it('does not double-count OT when holiday falls on weekend', async () => {
    const satHoliday = '2026-02-14'; // Saturday
    const holidayDates = new Set([satHoliday]);

    await Attendance.create({
      userId, date: satHoliday,
      checkInAt: createTimeInGMT7(satHoliday, 9, 0),
      checkOutAt: createTimeInGMT7(satHoliday, 18, 0),
      otApproved: false
    });

    const result = await getMonthlyReport('company', '2026-02', null, holidayDates);
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.approvedOtMinutes).toBe(480); // NOT 960
    expect(row.unapprovedOtMinutes).toBe(0);
  });

  // ─── EP: presentDays not increased for weekend ────────────────

  it('does not count weekend attendance toward presentDays', async () => {
    const sat = '2026-02-07'; // Saturday
    const sun = '2026-02-08'; // Sunday

    await Attendance.insertMany([
      {
        userId, date: sat,
        checkInAt: createTimeInGMT7(sat, 9, 0),
        checkOutAt: createTimeInGMT7(sat, 18, 0),
        otApproved: false
      },
      {
        userId, date: sun,
        checkInAt: createTimeInGMT7(sun, 8, 0),
        checkOutAt: createTimeInGMT7(sun, 15, 0),
        otApproved: false
      }
    ]);

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.presentDays).toBe(0);
  });

  // ─── EP: totalWorkMinutes includes weekend work ───────────────

  it('totalWorkMinutes includes weekend work alongside weekday work', async () => {
    const satDate = '2026-02-14'; // Saturday
    const monDate = '2026-02-09'; // Monday

    await Attendance.insertMany([
      {
        userId, date: satDate,
        checkInAt: createTimeInGMT7(satDate, 9, 0),
        checkOutAt: createTimeInGMT7(satDate, 18, 0),
        otApproved: false
      },
      {
        userId, date: monDate,
        checkInAt: createTimeInGMT7(monDate, 8, 0),
        checkOutAt: createTimeInGMT7(monDate, 17, 30),
        otApproved: false
      }
    ]);

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    // Sat: 480, Mon: 08:00→17:30 = 9.5h - 1h lunch = 510 (capped), but otApproved=false → 510
    expect(row.totalWorkMinutes).toBe(480 + 510);
  });

  // ─── DT: totalOtMinutes === approvedOtMinutes invariant ───────

  it('totalOtMinutes equals approvedOtMinutes (invariant)', async () => {
    const satDate = '2026-02-14'; // Saturday
    const wedDate = '2026-02-11'; // Wednesday (unapproved)

    await Attendance.insertMany([
      {
        userId, date: satDate,
        checkInAt: createTimeInGMT7(satDate, 9, 0),
        checkOutAt: createTimeInGMT7(satDate, 18, 0),
        otApproved: false
      },
      {
        userId, date: wedDate,
        checkInAt: createTimeInGMT7(wedDate, 8, 0),
        checkOutAt: createTimeInGMT7(wedDate, 20, 0),
        otApproved: false
      }
    ]);

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.totalOtMinutes).toBe(row.approvedOtMinutes);
    expect(row.unapprovedOtMinutes).toBeGreaterThan(0); // But not counted in total
  });

  // ─── BVA: Empty month (no attendance) ─────────────────────────

  it('returns all zeros for month with no attendance records', async () => {
    // No attendance seeded
    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.totalWorkMinutes).toBe(0);
    expect(row.approvedOtMinutes).toBe(0);
    expect(row.unapprovedOtMinutes).toBe(0);
    expect(row.totalOtMinutes).toBe(0);
    expect(row.presentDays).toBe(0);
  });

  // ─── DT: Weekend OT + approved leave (cross-type) ────────────

  it('handles weekend OT alongside approved leave correctly', async () => {
    const satDate = '2026-02-14'; // Saturday
    const monDate = '2026-02-09'; // Monday

    await Attendance.create({
      userId, date: satDate,
      checkInAt: createTimeInGMT7(satDate, 9, 0),
      checkOutAt: createTimeInGMT7(satDate, 18, 0),
      otApproved: false
    });

    // Create approved leave for Monday
    await Request.create({
      userId,
      type: 'LEAVE',
      status: 'APPROVED',
      leaveStartDate: monDate,
      leaveEndDate: monDate,
      leaveType: 'ANNUAL'
    });

    const result = await getMonthlyReport('company', '2026-02', null, new Set());
    const row = result.summary.find(item => item.user.employeeCode === 'WKOT001');

    expect(row).toBeDefined();
    expect(row.approvedOtMinutes).toBe(480); // From Saturday
    expect(row.unapprovedOtMinutes).toBe(0);
  });
});
