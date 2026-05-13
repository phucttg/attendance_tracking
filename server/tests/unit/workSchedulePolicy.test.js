import { describe, it, expect } from 'vitest';
import {
  resolveRawScheduleTypeValidationReason,
  resolveScheduleMutationDecision,
  resolveScheduleReadonlyState,
  WORK_SCHEDULE_LOCK_REASONS,
  WORK_SCHEDULE_MUTATION_ACTIONS
} from '../../src/services/workSchedulePolicy.js';

const TODAY = '2099-03-02';
const FUTURE = '2099-03-03';
const PAST = '2099-03-01';

const editableReadonlyInput = {
  workDate: FUTURE,
  todayKey: TODAY,
  isWorkday: true,
  hasCheckedIn: false,
  isOtLocked: false
};

const editableMutationInput = {
  requestedType: 'SHIFT_2',
  existingType: 'SHIFT_1',
  isWorkday: true,
  isPastDate: false,
  hasCheckedIn: false,
  isOtLocked: false
};

describe('work schedule policy unit tests', () => {
  describe('resolveScheduleReadonlyState', () => {
    it('returns editable state for future workdays with a saved schedule and no real data', () => {
      expect(resolveScheduleReadonlyState(editableReadonlyInput)).toEqual({
        isReadOnly: false,
        isLocked: false,
        lockedReason: null
      });
    });

    it('returns editable state for today before check-in', () => {
      expect(resolveScheduleReadonlyState({
        ...editableReadonlyInput,
        workDate: TODAY
      })).toEqual({
        isReadOnly: false,
        isLocked: false,
        lockedReason: null
      });
    });

    it('locks checked-in workdays regardless of whether the date is today or future', () => {
      for (const workDate of [TODAY, FUTURE]) {
        expect(resolveScheduleReadonlyState({
          ...editableReadonlyInput,
          workDate,
          hasCheckedIn: true
        })).toMatchObject({
          isReadOnly: true,
          isLocked: true,
          lockedReason: WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN
        });
      }
    });

    it('locks workdays with OT when no check-in exists', () => {
      expect(resolveScheduleReadonlyState({
        ...editableReadonlyInput,
        isOtLocked: true
      })).toMatchObject({
        isReadOnly: true,
        isLocked: true,
        lockedReason: WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
      });
    });

    it('uses priority order PAST_DATE -> NON_WORKDAY -> ALREADY_CHECKED_IN -> OT_LOCKED', () => {
      expect(resolveScheduleReadonlyState({
        workDate: PAST,
        todayKey: TODAY,
        isWorkday: false,
        hasCheckedIn: true,
        isOtLocked: true
      }).lockedReason).toBe(WORK_SCHEDULE_LOCK_REASONS.PAST_DATE);

      expect(resolveScheduleReadonlyState({
        ...editableReadonlyInput,
        isWorkday: false,
        hasCheckedIn: true,
        isOtLocked: true
      }).lockedReason).toBe(WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY);

      expect(resolveScheduleReadonlyState({
        ...editableReadonlyInput,
        hasCheckedIn: true,
        isOtLocked: true
      }).lockedReason).toBe(WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN);
    });

    it('never emits SCHEDULE_LOCKED across readonly states', () => {
      const cases = [
        editableReadonlyInput,
        { ...editableReadonlyInput, workDate: PAST },
        { ...editableReadonlyInput, isWorkday: false },
        { ...editableReadonlyInput, hasCheckedIn: true },
        { ...editableReadonlyInput, isOtLocked: true }
      ];

      expect(cases.map((input) => resolveScheduleReadonlyState(input).lockedReason))
        .not.toContain(WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED);
    });
  });

  describe('resolveScheduleMutationDecision', () => {
    it.each([
      ['SHIFT_1 to SHIFT_2', 'SHIFT_2', 'SHIFT_1'],
      ['SHIFT_2 to FLEXIBLE', 'FLEXIBLE', 'SHIFT_2'],
      ['null to SHIFT_1', 'SHIFT_1', null],
      ['null to SHIFT_2', 'SHIFT_2', null],
      ['null to FLEXIBLE', 'FLEXIBLE', null],
    ])('allows update for editable valid transition: %s', (_label, requestedType, existingType) => {
      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        requestedType,
        existingType
      })).toEqual({
        action: WORK_SCHEDULE_MUTATION_ACTIONS.UPDATE,
        reason: null
      });
    });

    it('allows editable saved schedules to be deleted', () => {
      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        requestedType: null,
        existingType: 'SHIFT_1'
      })).toEqual({
        action: WORK_SCHEDULE_MUTATION_ACTIONS.DELETE,
        reason: null
      });
    });

    it('returns none for no-op same value even when the row would otherwise be locked', () => {
      expect(resolveScheduleMutationDecision({
        requestedType: 'SHIFT_1',
        existingType: 'SHIFT_1',
        isWorkday: false,
        isPastDate: true,
        hasCheckedIn: true,
        isOtLocked: true
      })).toEqual({
        action: WORK_SCHEDULE_MUTATION_ACTIONS.NONE,
        reason: null
      });
    });

    it('rejects changed non-workdays with NON_WORKDAY', () => {
      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        isWorkday: false
      })).toEqual({
        action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
        reason: WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY
      });
    });

    it('rejects checked-in workdays with ALREADY_CHECKED_IN regardless of date position', () => {
      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        hasCheckedIn: true
      })).toEqual({
        action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
        reason: WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN
      });
    });

    it('rejects OT-locked editable-date changes with OT_LOCKED', () => {
      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        isOtLocked: true
      })).toEqual({
        action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
        reason: WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
      });
    });

    it('uses priority order PAST_DATE -> NON_WORKDAY -> ALREADY_CHECKED_IN -> OT_LOCKED', () => {
      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        isPastDate: true,
        isWorkday: false,
        hasCheckedIn: true,
        isOtLocked: true
      }).reason).toBe(WORK_SCHEDULE_LOCK_REASONS.PAST_DATE);

      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        isWorkday: false,
        hasCheckedIn: true,
        isOtLocked: true
      }).reason).toBe(WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY);

      expect(resolveScheduleMutationDecision({
        ...editableMutationInput,
        hasCheckedIn: true,
        isOtLocked: true
      }).reason).toBe(WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN);
    });

    it('never rejects with SCHEDULE_LOCKED across mutation decisions', () => {
      const cases = [
        editableMutationInput,
        { ...editableMutationInput, requestedType: null },
        { ...editableMutationInput, isWorkday: false },
        { ...editableMutationInput, isPastDate: true },
        { ...editableMutationInput, hasCheckedIn: true },
        { ...editableMutationInput, isOtLocked: true }
      ];

      expect(cases.map((input) => resolveScheduleMutationDecision(input).reason))
        .not.toContain(WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED);
    });
  });

  describe('resolveRawScheduleTypeValidationReason', () => {
    it('rejects non-null raw schedule types that normalize to null', () => {
      expect(resolveRawScheduleTypeValidationReason({
        rawScheduleType: 'INVALID_SHIFT',
        normalizedScheduleType: null
      })).toBe(WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW);
    });

    it.each(['SHIFT_1', 'SHIFT_2', 'FLEXIBLE', null])(
      'accepts valid normalized schedule type %s',
      (scheduleType) => {
        expect(resolveRawScheduleTypeValidationReason({
          rawScheduleType: scheduleType,
          normalizedScheduleType: scheduleType
        })).toBeNull();
      }
    );
  });
});
