import { describe, it, expect } from 'vitest';
import { computeAttendance, computeWeekendOtMinutes } from '../src/utils/attendanceCompute.js';
import { createTimeInGMT7 } from '../src/utils/dateUtils.js';

describe('computeWeekendOtMinutes', () => {
  it('returns 180 for Sunday 08:00-11:00', () => {
    const dateKey = '2026-03-08'; // Sunday
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 11, 0)
    );

    expect(result).toBe(180);
  });

  it('returns 480 for Saturday 08:00-17:00 (spans lunch)', () => {
    const dateKey = '2026-02-14'; // Saturday
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 17, 0)
    );

    expect(result).toBe(480);
  });

  it('returns 210 for 08:00-11:30', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 11, 30)
    );

    expect(result).toBe(210);
  });

  it('returns 660 for 08:00-20:00 (spans lunch)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 20, 0)
    );

    expect(result).toBe(660);
  });

  it('returns 300 for 13:00-18:00', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 13, 0),
      createTimeInGMT7(dateKey, 18, 0)
    );

    expect(result).toBe(300);
  });

  it('returns 60 for 11:30-13:30 (spans lunch boundary)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 11, 30),
      createTimeInGMT7(dateKey, 13, 30)
    );

    expect(result).toBe(60);
  });

  it('returns 60 for 12:30-13:30 (inside lunch window, no deduction)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 12, 30),
      createTimeInGMT7(dateKey, 13, 30)
    );

    expect(result).toBe(60);
  });

  it('returns 0 for invalid dates', () => {
    expect(computeWeekendOtMinutes('2026-03-08', null, null)).toBe(0);
    expect(computeWeekendOtMinutes('2026-03-08', new Date('invalid'), new Date())).toBe(0);
    expect(computeWeekendOtMinutes('2026-03-08', new Date(), new Date('invalid'))).toBe(0);
  });

  it('returns 0 when checkout is before checkin', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 11, 0),
      createTimeInGMT7(dateKey, 8, 0)
    );

    expect(result).toBe(0);
  });

  it('returns 5 for 08:00-08:05', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 8, 5)
    );

    expect(result).toBe(5);
  });

  // ─── BVA: Lunch window boundary cases ─────────────────────────

  it('returns 60 for exactly 12:00-13:00 (exact lunch window)', () => {
    const dateKey = '2026-03-08'; // Sunday
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 12, 0),
      createTimeInGMT7(dateKey, 13, 0)
    );
    // checkIn NOT < 12:00 (equal), so no lunch deduction → 60
    expect(result).toBe(60);
  });

  it('returns 180 for 12:00-15:00 (start at lunch start boundary)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 12, 0),
      createTimeInGMT7(dateKey, 15, 0)
    );
    // checkIn NOT < 12:00 (equal), no lunch deduction → 180
    expect(result).toBe(180);
  });

  it('returns 240 for 09:00-13:00 (end at lunch end boundary)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 9, 0),
      createTimeInGMT7(dateKey, 13, 0)
    );
    // checkOut NOT > 13:00 (equal), no lunch deduction → 240
    expect(result).toBe(240);
  });

  it('returns 90 for 11:00-12:30 (start before lunch, end during lunch)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 11, 0),
      createTimeInGMT7(dateKey, 12, 30)
    );
    // checkIn < 12:00 but checkOut NOT > 13:00, no deduction → 90
    expect(result).toBe(90);
  });

  it('returns 90 for 12:30-14:00 (start during lunch, end after lunch)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 12, 30),
      createTimeInGMT7(dateKey, 14, 0)
    );
    // checkIn NOT < 12:00, no deduction → 90
    expect(result).toBe(90);
  });

  // ─── EP: Unusual time ranges ──────────────────────────────────

  it('returns 360 for 00:00-06:00 (early morning / midnight shift)', () => {
    const dateKey = '2026-03-08'; // Sunday
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 0, 0),
      createTimeInGMT7(dateKey, 6, 0)
    );
    expect(result).toBe(360);
  });

  // ─── BVA: Degenerate durations ────────────────────────────────

  it('returns 0 for same checkin/checkout time (zero duration)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 8, 0)
    );
    expect(result).toBe(0);
  });

  it('returns 1 for 08:00-08:01 (1-minute shift)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 8, 1)
    );
    expect(result).toBe(1);
  });

  it('returns 899 for 08:00-23:59 (end-of-day checkout)', () => {
    const dateKey = '2026-03-08';
    const result = computeWeekendOtMinutes(
      dateKey,
      createTimeInGMT7(dateKey, 8, 0),
      createTimeInGMT7(dateKey, 23, 59)
    );
    // 08:00→23:59 = 959 min, spans lunch → 959 - 60 = 899
    expect(result).toBe(899);
  });
});

describe('computeAttendance weekend/holiday OT behavior', () => {
  it('treats all holiday work time as OT', () => {
    const holidayKey = '2026-01-01'; // Thursday
    const holidayDates = new Set([holidayKey]);

    const result = computeAttendance(
      {
        date: holidayKey,
        checkInAt: createTimeInGMT7(holidayKey, 8, 0),
        checkOutAt: createTimeInGMT7(holidayKey, 11, 0),
        otApproved: false
      },
      holidayDates
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.workMinutes).toBe(180);
    expect(result.otMinutes).toBe(180);
  });

  // ─── EP: Weekend without attendance ───────────────────────────

  it('returns WEEKEND_OR_HOLIDAY with zero metrics when no attendance on Saturday', () => {
    const saturdayKey = '2026-02-14'; // Saturday
    const result = computeAttendance(
      { date: saturdayKey, checkInAt: null, checkOutAt: null, otApproved: false }
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.workMinutes).toBe(0);
    expect(result.otMinutes).toBe(0);
    expect(result.lateMinutes).toBe(0);
  });

  // ─── ST: Weekend with checkIn only (incomplete session) ───────

  it('returns zero work/ot when weekend has checkIn but no checkOut', () => {
    const sundayKey = '2026-03-08'; // Sunday
    const result = computeAttendance(
      {
        date: sundayKey,
        checkInAt: createTimeInGMT7(sundayKey, 8, 0),
        checkOutAt: null,
        otApproved: false
      }
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.workMinutes).toBe(0);
    expect(result.otMinutes).toBe(0);
  });

  // ─── DT: otApproved flag is irrelevant on weekend ─────────────

  it('ignores otApproved=true on weekend (same result as false)', () => {
    const saturdayKey = '2026-02-14'; // Saturday
    const result = computeAttendance(
      {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 8, 0),
        checkOutAt: createTimeInGMT7(saturdayKey, 17, 0),
        otApproved: true
      }
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.workMinutes).toBe(480);
    expect(result.otMinutes).toBe(480);
  });

  // ─── EP: Weekday holiday (not weekend) ────────────────────────

  it('treats weekday holiday as WEEKEND_OR_HOLIDAY with full OT', () => {
    const thursdayHoliday = '2026-01-01'; // Thursday — New Year
    const holidayDates = new Set([thursdayHoliday]);

    const result = computeAttendance(
      {
        date: thursdayHoliday,
        checkInAt: createTimeInGMT7(thursdayHoliday, 9, 0),
        checkOutAt: createTimeInGMT7(thursdayHoliday, 18, 0),
        otApproved: false
      },
      holidayDates
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    // 09:00→18:00 = 9h, spans lunch → 8h = 480
    expect(result.workMinutes).toBe(480);
    expect(result.otMinutes).toBe(480);
  });

  // ─── DT: Holiday + weekend overlap ────────────────────────────

  it('handles holiday falling on a Saturday (dual flag, no double count)', () => {
    const saturdayHoliday = '2026-02-14'; // Saturday
    const holidayDates = new Set([saturdayHoliday]);

    const result = computeAttendance(
      {
        date: saturdayHoliday,
        checkInAt: createTimeInGMT7(saturdayHoliday, 8, 0),
        checkOutAt: createTimeInGMT7(saturdayHoliday, 12, 0),
        otApproved: false
      },
      holidayDates
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.workMinutes).toBe(240);
    expect(result.otMinutes).toBe(240);
  });

  // ─── ST: Weekend priority over leave ──────────────────────────

  it('weekend takes priority over leave date (WEEKEND_OR_HOLIDAY > LEAVE)', () => {
    const saturdayKey = '2026-02-14'; // Saturday
    const leaveDates = new Set([saturdayKey]);

    const result = computeAttendance(
      {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 9, 0),
        checkOutAt: createTimeInGMT7(saturdayKey, 17, 0),
        otApproved: false
      },
      new Set(), // no holidays
      leaveDates
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.workMinutes).toBe(420); // 9-17 = 8h, spans lunch → 7h = 420
    expect(result.otMinutes).toBe(420);
  });

  // ─── EP: Never late on weekend ────────────────────────────────

  it('never reports lateMinutes on weekend even with late checkIn', () => {
    const saturdayKey = '2026-02-14'; // Saturday
    const result = computeAttendance(
      {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 10, 0), // "late" by workday standards
        checkOutAt: createTimeInGMT7(saturdayKey, 17, 0),
        otApproved: false
      }
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    expect(result.lateMinutes).toBe(0);
  });

  // ─── EP: Max day weekend ──────────────────────────────────────

  it('computes full day weekend spanning lunch (07:00-22:00)', () => {
    const saturdayKey = '2026-02-14'; // Saturday
    const result = computeAttendance(
      {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 7, 0),
        checkOutAt: createTimeInGMT7(saturdayKey, 22, 0),
        otApproved: false
      }
    );

    expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
    // 07:00→22:00 = 15h = 900 min, spans lunch → 900 - 60 = 840
    expect(result.workMinutes).toBe(840);
    expect(result.otMinutes).toBe(840);
  });

  // ─── DT: Holiday with empty holidayDates set ──────────────────

  it('treats weekday as normal when holidayDates set is empty', () => {
    const thursdayKey = '2026-01-01'; // Thursday — but not in holidayDates
    const result = computeAttendance(
      {
        date: thursdayKey,
        checkInAt: createTimeInGMT7(thursdayKey, 8, 30),
        checkOutAt: createTimeInGMT7(thursdayKey, 17, 30),
        otApproved: false
      },
      new Set() // empty — Jan 1 NOT marked as holiday
    );

    // Should behave as normal workday, NOT as WEEKEND_OR_HOLIDAY
    expect(result.status).not.toBe('WEEKEND_OR_HOLIDAY');
    expect(result.otMinutes).toBe(0); // No OT approval, no weekend/holiday
  });
});
