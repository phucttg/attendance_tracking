import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import { getTodayActivity } from '../src/services/attendanceService.js';
import { createTimeInGMT7, getTodayDateKey, isWeekend } from '../src/utils/dateUtils.js';

describe('getTodayActivity weekend metrics', () => {
  let userWithAttendanceId;
  let userWithoutAttendanceId;

  beforeAll(async () => {
  });

  afterAll(async () => {
    vi.useRealTimers();
    await Attendance.deleteMany({});
    await User.deleteMany({
      $or: [{ employeeCode: /^TAWK/ }, { email: /^tawk\d+@example\.com$/ }]
    });
    await Team.deleteMany({ name: /^TAWK/ });
  });

  beforeEach(async () => {
    await Attendance.deleteMany({});
    await User.deleteMany({
      $or: [{ employeeCode: /^TAWK/ }, { email: /^tawk\d+@example\.com$/ }]
    });
    await Team.deleteMany({ name: /^TAWK/ });

    // Sunday in GMT+7
    vi.setSystemTime(new Date('2026-03-08T03:00:00.000Z'));

    const team = await Team.create({ name: 'TAWK Team' });

    const userWithAttendance = await User.create({
      employeeCode: 'TAWK001',
      name: 'Weekend Worker',
      email: 'tawk001@example.com',
      passwordHash: 'hash',
      role: 'EMPLOYEE',
      teamId: team._id,
      isActive: true
    });
    userWithAttendanceId = userWithAttendance._id;

    const userWithoutAttendance = await User.create({
      employeeCode: 'TAWK002',
      name: 'No Attendance User',
      email: 'tawk002@example.com',
      passwordHash: 'hash',
      role: 'EMPLOYEE',
      teamId: team._id,
      isActive: true
    });
    userWithoutAttendanceId = userWithoutAttendance._id;

    const todayKey = getTodayDateKey();
    await Attendance.create({
      userId: userWithAttendanceId,
      date: todayKey,
      checkInAt: createTimeInGMT7(todayKey, 8, 0),
      checkOutAt: createTimeInGMT7(todayKey, 11, 0),
      otApproved: false
    });
  });

  it('returns weekend status with computed work/ot metrics for users with attendance', async () => {
    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });

    const item = result.items.find(entry => String(entry.user._id) === String(userWithAttendanceId));
    expect(item).toBeDefined();
    expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(item.computed.workMinutes).toBe(180);
    expect(item.computed.otMinutes).toBe(180);
    expect(item.computed.otMinutes).toBe(item.computed.workMinutes);
  });

  it('returns weekend status with zero metrics for users without attendance', async () => {
    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });

    const item = result.items.find(entry => String(entry.user._id) === String(userWithoutAttendanceId));
    expect(item).toBeDefined();
    expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(item.computed.lateMinutes).toBe(0);
    expect(item.computed.workMinutes).toBe(0);
    expect(item.computed.otMinutes).toBe(0);
    expect(item.attendance).toBeNull();
  });

  // ─── ST: Weekend with checkIn only (incomplete session) ───────

  it('returns zero work/ot for weekend with checkIn but no checkOut', async () => {
    // Remove existing attendance and create incomplete one
    await Attendance.deleteMany({});
    const todayKey = getTodayDateKey();
    await Attendance.create({
      userId: userWithAttendanceId,
      date: todayKey,
      checkInAt: createTimeInGMT7(todayKey, 8, 0),
      // No checkOutAt
      otApproved: false
    });

    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });

    const item = result.items.find(entry => String(entry.user._id) === String(userWithAttendanceId));
    expect(item).toBeDefined();
    expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(item.computed.workMinutes).toBe(0);
    expect(item.computed.otMinutes).toBe(0);
  });

  // ─── EP: Saturday (vs Sunday — both weekend) ─────────────────

  it('returns weekend status for Saturday attendance', async () => {
    // Freeze to Saturday 2026-02-14
    vi.setSystemTime(new Date('2026-02-14T03:00:00.000Z'));

    await Attendance.deleteMany({});
    const todayKey = getTodayDateKey();
    expect(isWeekend(todayKey)).toBe(true);

    await Attendance.create({
      userId: userWithAttendanceId,
      date: todayKey,
      checkInAt: createTimeInGMT7(todayKey, 9, 0),
      checkOutAt: createTimeInGMT7(todayKey, 12, 0),
      otApproved: false
    });

    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });
    const item = result.items.find(entry => String(entry.user._id) === String(userWithAttendanceId));

    expect(item).toBeDefined();
    expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(item.computed.workMinutes).toBe(180);
    expect(item.computed.otMinutes).toBe(180);
  });

  // ─── EP: Weekend lateMinutes always 0 ─────────────────────────

  it('always returns lateMinutes=0 on weekend even with late checkIn', async () => {
    await Attendance.deleteMany({});
    const todayKey = getTodayDateKey();
    await Attendance.create({
      userId: userWithAttendanceId,
      date: todayKey,
      checkInAt: createTimeInGMT7(todayKey, 12, 0), // Very "late" by workday standards
      checkOutAt: createTimeInGMT7(todayKey, 17, 0),
      otApproved: false
    });

    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });
    const item = result.items.find(entry => String(entry.user._id) === String(userWithAttendanceId));

    expect(item).toBeDefined();
    expect(item.computed.lateMinutes).toBe(0);
  });

  // ─── DT: Weekend otMinutes === workMinutes invariant ──────────

  it('ensures otMinutes equals workMinutes on weekend (invariant)', async () => {
    await Attendance.deleteMany({});
    const todayKey = getTodayDateKey();
    await Attendance.create({
      userId: userWithAttendanceId,
      date: todayKey,
      checkInAt: createTimeInGMT7(todayKey, 8, 0),
      checkOutAt: createTimeInGMT7(todayKey, 20, 0),
      otApproved: false
    });

    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });
    const item = result.items.find(entry => String(entry.user._id) === String(userWithAttendanceId));

    expect(item).toBeDefined();
    expect(item.computed.otMinutes).toBe(item.computed.workMinutes);
    expect(item.computed.workMinutes).toBeGreaterThan(0);
  });

  // ─── Contract: Computed response has all 4 fields ─────────────

  it('computed response has all required fields (status, lateMinutes, workMinutes, otMinutes)', async () => {
    const result = await getTodayActivity('company', null, new Set(), { page: 1, limit: 20 });
    const item = result.items.find(entry => String(entry.user._id) === String(userWithAttendanceId));

    expect(item).toBeDefined();
    expect(item.computed).toHaveProperty('status');
    expect(item.computed).toHaveProperty('lateMinutes');
    expect(item.computed).toHaveProperty('workMinutes');
    expect(item.computed).toHaveProperty('otMinutes');
  });

  // ─── EP: Pagination on weekend ────────────────────────────────

  it('paginates correctly on weekend with multiple users', async () => {
    // Create a third user
    const team = await Team.findOne({ name: 'TAWK Team' });
    await User.create({
      employeeCode: 'TAWK003',
      name: 'Extra Weekend User',
      email: 'tawk003@example.com',
      passwordHash: 'hash',
      role: 'EMPLOYEE',
      teamId: team._id,
      isActive: true
    });

    const page1 = await getTodayActivity('company', null, new Set(), { page: 1, limit: 2 });
    expect(page1.items.length).toBeLessThanOrEqual(2);
    expect(page1.pagination.total).toBeGreaterThanOrEqual(3);

    // All items on page 1 should have weekend status
    for (const item of page1.items) {
      expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
    }
  });

  // ─── Holiday (weekday) scenarios ──────────────────────────────

  describe('holiday (weekday) metrics', () => {
    let holidayUserId;
    let noAttendanceUserId;

    beforeEach(async () => {
      await Attendance.deleteMany({});
      await User.deleteMany({
        $or: [{ employeeCode: /^TAHK/ }, { email: /^tahk\d+@example\.com$/ }]
      });
      await Team.deleteMany({ name: /^TAHK/ });

      // Freeze to a Thursday (weekday) 2026-01-01 — New Year
      vi.setSystemTime(new Date('2026-01-01T03:00:00.000Z'));

      const team = await Team.create({ name: 'TAHK Team' });

      const holidayUser = await User.create({
        employeeCode: 'TAHK001',
        name: 'Holiday Worker',
        email: 'tahk001@example.com',
        passwordHash: 'hash',
        role: 'EMPLOYEE',
        teamId: team._id,
        isActive: true
      });
      holidayUserId = holidayUser._id;

      const noAttUser = await User.create({
        employeeCode: 'TAHK002',
        name: 'Holiday No Attendance',
        email: 'tahk002@example.com',
        passwordHash: 'hash',
        role: 'EMPLOYEE',
        teamId: team._id,
        isActive: true
      });
      noAttendanceUserId = noAttUser._id;
    });

    it('returns WEEKEND_OR_HOLIDAY for holiday weekday with attendance', async () => {
      const todayKey = getTodayDateKey();
      const holidayDates = new Set([todayKey]);

      await Attendance.create({
        userId: holidayUserId,
        date: todayKey,
        checkInAt: createTimeInGMT7(todayKey, 9, 0),
        checkOutAt: createTimeInGMT7(todayKey, 17, 0),
        otApproved: false
      });

      const result = await getTodayActivity('company', null, holidayDates, { page: 1, limit: 20 });
      const item = result.items.find(entry => String(entry.user._id) === String(holidayUserId));

      expect(item).toBeDefined();
      expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
      // 09:00→17:00 = 8h, spans lunch → 7h = 420
      expect(item.computed.workMinutes).toBe(420);
      expect(item.computed.otMinutes).toBe(420);
    });

    it('returns WEEKEND_OR_HOLIDAY for holiday weekday without attendance', async () => {
      const todayKey = getTodayDateKey();
      const holidayDates = new Set([todayKey]);

      const result = await getTodayActivity('company', null, holidayDates, { page: 1, limit: 20 });
      const item = result.items.find(entry => String(entry.user._id) === String(noAttendanceUserId));

      expect(item).toBeDefined();
      expect(item.computed.status).toBe('WEEKEND_OR_HOLIDAY');
      expect(item.computed.workMinutes).toBe(0);
      expect(item.computed.otMinutes).toBe(0);
      expect(item.attendance).toBeNull();
    });
  });
});
