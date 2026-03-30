import { afterEach, describe, expect, it } from 'vitest';
import {
  computeAttendance,
  computeLateMinutes
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
