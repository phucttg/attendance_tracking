import { afterEach, describe, expect, it } from 'vitest';
import {
  computeAttendance,
  computeLateMinutes,
  computeOtMinutes,
  computeWorkMinutes
} from '../src/utils/attendanceCompute.js';
import { createTimeInGMT7 } from '../src/utils/dateUtils.js';
import {
  buildAttendanceScheduleSnapshot,
  isScheduleComplianceEnabled,
  isScheduleEnforcedForDate
} from '../src/utils/schedulePolicy.js';

const ORIGINAL_ENFORCEMENT = process.env.SCHEDULE_ENFORCEMENT_START_DATE;

afterEach(() => {
  if (ORIGINAL_ENFORCEMENT == null) {
    delete process.env.SCHEDULE_ENFORCEMENT_START_DATE;
  } else {
    process.env.SCHEDULE_ENFORCEMENT_START_DATE = ORIGINAL_ENFORCEMENT;
  }
});

describe('schedule policy + computeAttendance', () => {
  it('SHIFT_1 late boundary: 08:05 => 0, 08:06 => 6', () => {
    const dateKey = '2026-03-25';
    const shift1 = buildAttendanceScheduleSnapshot('SHIFT_1', 'REGISTERED');

    expect(
      computeLateMinutes(dateKey, createTimeInGMT7(dateKey, 8, 5), shift1)
    ).toBe(0);
    expect(
      computeLateMinutes(dateKey, createTimeInGMT7(dateKey, 8, 6), shift1)
    ).toBe(6);
  });

  it('SHIFT_2 late boundary: 09:05 => 0, 09:06 => 6', () => {
    const dateKey = '2026-03-25';
    const shift2 = buildAttendanceScheduleSnapshot('SHIFT_2', 'REGISTERED');

    expect(
      computeLateMinutes(dateKey, createTimeInGMT7(dateKey, 9, 5), shift2)
    ).toBe(0);
    expect(
      computeLateMinutes(dateKey, createTimeInGMT7(dateKey, 9, 6), shift2)
    ).toBe(6);
  });

  it('FLEXIBLE workday: no late, no early, no OT, keeps actual work minutes with lunch deduction', () => {
    const dateKey = '2026-03-25'; // Wednesday
    const result = computeAttendance({
      date: dateKey,
      checkInAt: createTimeInGMT7(dateKey, 8, 30),
      checkOutAt: createTimeInGMT7(dateKey, 18, 0),
      otApproved: true,
      scheduleType: 'FLEXIBLE',
      ...buildAttendanceScheduleSnapshot('FLEXIBLE', 'REGISTERED')
    });

    expect(result.status).toBe('ON_TIME');
    expect(result.lateMinutes).toBe(0);
    expect(result.otMinutes).toBe(0);
    // 08:30 -> 18:00 = 570 mins, spans lunch => 510
    expect(result.workMinutes).toBe(510);
  });

  it('SHIFT_1: ignores pre-shift time and keeps regular work inside the shift window', () => {
    const dateKey = '2026-04-07';
    const shift1 = buildAttendanceScheduleSnapshot('SHIFT_1', 'REGISTERED');

    const result = computeAttendance({
      date: dateKey,
      checkInAt: createTimeInGMT7(dateKey, 1, 34),
      checkOutAt: createTimeInGMT7(dateKey, 17, 34),
      otApproved: false,
      ...shift1
    });

    expect(result.status).toBe('ON_TIME');
    expect(result.lateMinutes).toBe(0);
    expect(result.workMinutes).toBe(510);
    expect(result.otMinutes).toBe(0);
  });

  it('SHIFT_1: cross-midnight approved OT keeps regular work and OT separate', () => {
    const dateKey = '2026-04-10';
    const shift1 = buildAttendanceScheduleSnapshot('SHIFT_1', 'REGISTERED');

    const result = computeAttendance({
      date: dateKey,
      checkInAt: createTimeInGMT7(dateKey, 8, 38),
      checkOutAt: createTimeInGMT7('2026-04-11', 7, 40),
      otApproved: true,
      ...shift1
    });

    expect(result.status).toBe('LATE');
    expect(result.lateMinutes).toBe(38);
    expect(result.workMinutes).toBe(472);
    expect(result.otMinutes).toBe(850);
  });

  it('SHIFT_2: fixed-shift OT starts at 18:30 and regular work stays in shift', () => {
    const dateKey = '2026-04-10';
    const shift2 = buildAttendanceScheduleSnapshot('SHIFT_2', 'REGISTERED');

    expect(
      computeWorkMinutes(
        dateKey,
        createTimeInGMT7(dateKey, 9, 38),
        createTimeInGMT7('2026-04-11', 7, 40),
        true,
        'CONTINUOUS',
        shift2
      )
    ).toBe(472);
    expect(
      computeOtMinutes(
        dateKey,
        createTimeInGMT7('2026-04-11', 7, 40),
        true,
        'CONTINUOUS',
        0,
        shift2
      )
    ).toBe(790);
  });

  it('SHIFT_1: checkout before shift start yields no regular work and no OT', () => {
    const dateKey = '2026-04-15';
    const shift1 = buildAttendanceScheduleSnapshot('SHIFT_1', 'REGISTERED');

    expect(
      computeWorkMinutes(
        dateKey,
        createTimeInGMT7(dateKey, 1, 34),
        createTimeInGMT7(dateKey, 7, 40),
        false,
        'CONTINUOUS',
        shift1
      )
    ).toBe(0);
    expect(
      computeOtMinutes(
        dateKey,
        createTimeInGMT7(dateKey, 7, 40),
        true,
        'CONTINUOUS',
        0,
        shift1
      )
    ).toBe(0);
  });

  it('enforcement config: missing env means compliance OFF', () => {
    delete process.env.SCHEDULE_ENFORCEMENT_START_DATE;
    expect(isScheduleComplianceEnabled()).toBe(false);
    expect(isScheduleEnforcedForDate('2026-03-25')).toBe(false);
  });

  it('enforcement config: applies from start date inclusive', () => {
    process.env.SCHEDULE_ENFORCEMENT_START_DATE = '2026-03-25';
    expect(isScheduleComplianceEnabled()).toBe(true);
    expect(isScheduleEnforcedForDate('2026-03-24')).toBe(false);
    expect(isScheduleEnforcedForDate('2026-03-25')).toBe(true);
    expect(isScheduleEnforcedForDate('2026-03-26')).toBe(true);
  });
});
