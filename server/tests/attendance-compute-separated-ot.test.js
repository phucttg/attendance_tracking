import { describe, it, expect } from 'vitest';
import {
  computeAttendance,
  computeOtMinutes,
  computeWorkMinutes
} from '../src/utils/attendanceCompute.js';
import { createTimeInGMT7 } from '../src/utils/dateUtils.js';

describe('attendance compute - separated OT', () => {
  it('caps work minutes at 17:30 for separated mode even when otApproved=true', () => {
    const dateKey = '2026-03-04';
    const checkIn = createTimeInGMT7(dateKey, 8, 0);
    const checkOut = createTimeInGMT7(dateKey, 20, 0);

    const minutes = computeWorkMinutes(dateKey, checkIn, checkOut, true, 'SEPARATED');

    // 08:00 -> 17:30 = 570 mins, minus 60 lunch = 510
    expect(minutes).toBe(510);
  });

  it('returns separatedOtMinutes for approved separated OT', () => {
    const dateKey = '2026-03-04';
    const checkOut = createTimeInGMT7(dateKey, 17, 30);

    const minutes = computeOtMinutes(dateKey, checkOut, true, 'SEPARATED', 180);
    expect(minutes).toBe(180);
  });

  it('computeAttendance uses separated snapshot input correctly', () => {
    const dateKey = '2026-03-04';
    const result = computeAttendance({
      date: dateKey,
      checkInAt: createTimeInGMT7(dateKey, 8, 0),
      checkOutAt: createTimeInGMT7(dateKey, 20, 0),
      otApproved: true,
      otMode: 'SEPARATED',
      separatedOtMinutes: 180
    });

    expect(result.status).toBe('ON_TIME');
    expect(result.workMinutes).toBe(510);
    expect(result.otMinutes).toBe(180);
  });
});
