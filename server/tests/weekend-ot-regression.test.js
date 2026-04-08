/**
 * Weekday OT Regression Guard — Unit Tests
 *
 * Test Design: Change-Related Testing (ISTQB — Regression)
 * ISO 25010: Functional Suitability — Correctness
 * Priority: HIGH
 *
 * Purpose: Verify that weekend/holiday OT changes do NOT affect
 * existing weekday OT behavior. Guards against regression in:
 *   - computeAttendance weekday path (otApproved flag)
 *   - computeWorkMinutes fixed-shift overlap behavior
 *   - computeOtMinutes strict approval requirement
 *   - computePotentialOtMinutes (always computes)
 *
 * All tests are pure unit — no DB, no mocking timers.
 */

import { describe, it, expect } from 'vitest';
import {
  computeAttendance,
  computeWorkMinutes,
  computeOtMinutes,
  computePotentialOtMinutes
} from '../src/utils/attendanceCompute.js';
import { createTimeInGMT7 } from '../src/utils/dateUtils.js';

// Tuesday 2026-02-10 (weekday, not holiday, not weekend)
const WEEKDAY = '2026-02-10';
const gmt7 = (h, m) => createTimeInGMT7(WEEKDAY, h, m);

describe('Weekday OT regression guard — no behavior change', () => {

  // ─── Group 1: computeAttendance weekday path ──────────────────

  describe('computeAttendance weekday with otApproved=true', () => {
    it('returns regular work and OT minutes without overlap when approved', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(8, 0),
        checkOutAt: gmt7(20, 0),
        otApproved: true
      });

      expect(result.status).not.toBe('WEEKEND_OR_HOLIDAY');
      // 20:00 - 17:30 = 150 min OT
      expect(result.otMinutes).toBe(150);
      // 08:00→17:30 = 9.5h - 1h lunch = 510 regular minutes
      expect(result.workMinutes).toBe(510);
    });
  });

  describe('computeAttendance weekday with otApproved=false', () => {
    it('returns 0 OT minutes when not approved (strict rule)', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(8, 0),
        checkOutAt: gmt7(20, 0),
        otApproved: false
      });

      expect(result.status).not.toBe('WEEKEND_OR_HOLIDAY');
      expect(result.otMinutes).toBe(0);
      // Regular window stays within the shift end
      expect(result.workMinutes).toBe(510);
    });
  });

  describe('computeAttendance weekday checkout before 17:30', () => {
    it('returns 0 OT and EARLY_LEAVE status', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(8, 0),
        checkOutAt: gmt7(16, 0),
        otApproved: false
      });

      expect(result.status).toBe('EARLY_LEAVE');
      expect(result.otMinutes).toBe(0);
    });
  });

  describe('computeAttendance weekday late + OT approved', () => {
    it('returns correct lateMinutes and otMinutes combined', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(9, 30),  // 45 min late (after 08:45)
        checkOutAt: gmt7(20, 0),
        otApproved: true
      });

      expect(result.status).toBe('LATE');
      expect(result.lateMinutes).toBe(90);
      // 20:00 - 17:30 = 150 min OT
      expect(result.otMinutes).toBe(150);
      // 09:30→17:30 = 8h - 1h lunch = 420 regular minutes
      expect(result.workMinutes).toBe(420);
    });
  });

  // ─── Group 2: computeWorkMinutes cap behavior ────────────────

  describe('computeWorkMinutes fixed-shift overlap', () => {
    it('keeps regular work within the shift when otApproved=false', () => {
      const result = computeWorkMinutes(WEEKDAY, gmt7(8, 0), gmt7(20, 0), false);
      // 08:00→17:30 = 9.5h = 570 min, spans lunch → 570 - 60 = 510
      expect(result).toBe(510);
    });

    it('keeps the same regular work even when otApproved=true', () => {
      const result = computeWorkMinutes(WEEKDAY, gmt7(8, 0), gmt7(20, 0), true);
      // Approved OT no longer expands workMinutes
      expect(result).toBe(510);
    });

    it('ignores pre-shift time on fixed-shift workdays', () => {
      const result = computeWorkMinutes(WEEKDAY, gmt7(1, 34), gmt7(17, 34), false);
      expect(result).toBe(510);
    });
  });

  // ─── Group 3: computeOtMinutes strict rule ────────────────────

  describe('computeOtMinutes strict approval requirement', () => {
    it('returns 0 when otApproved=false even with late checkout', () => {
      const result = computeOtMinutes(WEEKDAY, gmt7(20, 0), false);
      expect(result).toBe(0);
    });

    it('returns minutes from 17:30 when otApproved=true', () => {
      const result = computeOtMinutes(WEEKDAY, gmt7(20, 0), true);
      // 20:00 - 17:30 = 150
      expect(result).toBe(150);
    });

    it('returns 0 when checkout is before 17:30 even with approval', () => {
      const result = computeOtMinutes(WEEKDAY, gmt7(17, 0), true);
      expect(result).toBe(0);
    });
  });

  // ─── Group 4: computePotentialOtMinutes (always computes) ─────

  describe('computePotentialOtMinutes ignores approval flag', () => {
    it('returns OT regardless of approval status', () => {
      const result = computePotentialOtMinutes(WEEKDAY, gmt7(20, 0));
      // 20:00 - 17:30 = 150
      expect(result).toBe(150);
    });

    it('returns 0 if checkout is at or before 17:30', () => {
      expect(computePotentialOtMinutes(WEEKDAY, gmt7(17, 0))).toBe(0);
      expect(computePotentialOtMinutes(WEEKDAY, gmt7(17, 30))).toBe(0);
    });
  });

  // ─── Group 5: Status classification regression ────────────────

  describe('weekday status classification unchanged', () => {
    it('ON_TIME for checkIn <= 08:05 and checkOut >= 17:30', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(8, 5),
        checkOutAt: gmt7(17, 30),
        otApproved: false
      });
      expect(result.status).toBe('ON_TIME');
    });

    it('LATE for checkIn > 08:05', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(8, 6),
        checkOutAt: gmt7(17, 30),
        otApproved: false
      });
      expect(result.status).toBe('LATE');
      expect(result.lateMinutes).toBe(6);
    });

    it('LATE_AND_EARLY for late checkIn + early checkOut', () => {
      const result = computeAttendance({
        date: WEEKDAY,
        checkInAt: gmt7(8, 6),
        checkOutAt: gmt7(16, 0),
        otApproved: false
      });
      expect(result.status).toBe('LATE_AND_EARLY');
    });
  });
});
