export const WORK_SCHEDULE_LOCK_REASONS = {
  PAST_DATE: 'PAST_DATE',
  ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
  NON_WORKDAY: 'NON_WORKDAY',
  OUTSIDE_WINDOW: 'OUTSIDE_WINDOW',
  OT_LOCKED: 'OT_LOCKED',
  SCHEDULE_LOCKED: 'SCHEDULE_LOCKED'
};

export const WORK_SCHEDULE_MUTATION_ACTIONS = {
  NONE: 'none',
  UPDATE: 'update',
  DELETE: 'delete',
  REJECT: 'reject'
};

export function resolveScheduleReadonlyState({
  workDate,
  todayKey,
  isWorkday,
  hasCheckedIn,
  isOtLocked
}) {
  let lockedReason = null;
  let isReadOnly = false;

  if (workDate < todayKey) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.PAST_DATE;
  } else if (!isWorkday) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY;
  } else if (hasCheckedIn) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN;
  } else if (isOtLocked) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED;
  }

  return {
    isReadOnly,
    isLocked: isReadOnly,
    lockedReason
  };
}

export function resolveScheduleMutationDecision({
  requestedType,
  existingType,
  isWorkday,
  isPastDate,
  hasCheckedIn,
  isOtLocked
}) {
  if (requestedType === existingType) {
    return {
      action: WORK_SCHEDULE_MUTATION_ACTIONS.NONE,
      reason: null
    };
  }

  if (isPastDate) {
    return {
      action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
      reason: WORK_SCHEDULE_LOCK_REASONS.PAST_DATE
    };
  }

  if (!isWorkday) {
    return {
      action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
      reason: WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY
    };
  }

  if (hasCheckedIn) {
    return {
      action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
      reason: WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN
    };
  }

  if (isOtLocked) {
    return {
      action: WORK_SCHEDULE_MUTATION_ACTIONS.REJECT,
      reason: WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
    };
  }

  return {
    action: requestedType == null
      ? WORK_SCHEDULE_MUTATION_ACTIONS.DELETE
      : WORK_SCHEDULE_MUTATION_ACTIONS.UPDATE,
    reason: null
  };
}

export function resolveRawScheduleTypeValidationReason({
  rawScheduleType,
  normalizedScheduleType
}) {
  if (rawScheduleType != null && normalizedScheduleType == null) {
    return WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
  }

  return null;
}
