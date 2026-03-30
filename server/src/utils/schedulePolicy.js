import { createTimeInGMT7 } from './dateUtils.js';

export const SCHEDULE_TYPES = ['SHIFT_1', 'SHIFT_2', 'FLEXIBLE'];
export const ATTENDANCE_SCHEDULE_SOURCES = ['REGISTERED', 'LEGACY_BACKFILL'];

const SHIFT_POLICY = {
  SHIFT_1: {
    scheduleType: 'SHIFT_1',
    scheduledStartMinutes: 8 * 60,
    scheduledEndMinutes: 17 * 60 + 30,
    lateGraceMinutes: 5,
    lateTrackingEnabled: true,
    earlyLeaveTrackingEnabled: true,
    otThresholdMinutes: 17 * 60 + 31
  },
  SHIFT_2: {
    scheduleType: 'SHIFT_2',
    scheduledStartMinutes: 9 * 60,
    scheduledEndMinutes: 18 * 60 + 30,
    lateGraceMinutes: 5,
    lateTrackingEnabled: true,
    earlyLeaveTrackingEnabled: true,
    otThresholdMinutes: 18 * 60 + 31
  },
  FLEXIBLE: {
    scheduleType: 'FLEXIBLE',
    scheduledStartMinutes: null,
    scheduledEndMinutes: null,
    lateGraceMinutes: 0,
    lateTrackingEnabled: false,
    earlyLeaveTrackingEnabled: false,
    otThresholdMinutes: null
  }
};

const DEFAULT_LEGACY_SCHEDULE_TYPE = 'SHIFT_1';

const parseDateKey = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
};

export function normalizeScheduleType(rawScheduleType) {
  const value = typeof rawScheduleType === 'string' ? rawScheduleType.trim().toUpperCase() : '';
  return SCHEDULE_TYPES.includes(value) ? value : null;
}

export function isFlexibleScheduleType(scheduleType) {
  return normalizeScheduleType(scheduleType) === 'FLEXIBLE';
}

export function isFixedShiftScheduleType(scheduleType) {
  const normalized = normalizeScheduleType(scheduleType);
  return normalized === 'SHIFT_1' || normalized === 'SHIFT_2';
}

export function getSchedulePolicy(scheduleType) {
  const normalized = normalizeScheduleType(scheduleType) || DEFAULT_LEGACY_SCHEDULE_TYPE;
  return SHIFT_POLICY[normalized];
}

export function buildAttendanceScheduleSnapshot(scheduleType, scheduleSource = 'REGISTERED') {
  const normalizedSource = ATTENDANCE_SCHEDULE_SOURCES.includes(scheduleSource)
    ? scheduleSource
    : 'REGISTERED';
  const policy = getSchedulePolicy(scheduleType);

  return {
    scheduleType: policy.scheduleType,
    scheduledStartMinutes: policy.scheduledStartMinutes,
    scheduledEndMinutes: policy.scheduledEndMinutes,
    lateGraceMinutes: policy.lateGraceMinutes,
    lateTrackingEnabled: policy.lateTrackingEnabled,
    earlyLeaveTrackingEnabled: policy.earlyLeaveTrackingEnabled,
    scheduleSource: normalizedSource
  };
}

export function resolveAttendanceScheduleSnapshot(attendance = null) {
  const normalized = normalizeScheduleType(attendance?.scheduleType);
  const source = ATTENDANCE_SCHEDULE_SOURCES.includes(attendance?.scheduleSource)
    ? attendance.scheduleSource
    : 'LEGACY_BACKFILL';

  if (!normalized) {
    return buildAttendanceScheduleSnapshot(DEFAULT_LEGACY_SCHEDULE_TYPE, source);
  }

  const policy = getSchedulePolicy(normalized);
  return {
    scheduleType: normalized,
    scheduledStartMinutes: Number.isFinite(attendance?.scheduledStartMinutes)
      ? Number(attendance.scheduledStartMinutes)
      : policy.scheduledStartMinutes,
    scheduledEndMinutes: Number.isFinite(attendance?.scheduledEndMinutes)
      ? Number(attendance.scheduledEndMinutes)
      : policy.scheduledEndMinutes,
    lateGraceMinutes: Number.isFinite(attendance?.lateGraceMinutes)
      ? Number(attendance.lateGraceMinutes)
      : policy.lateGraceMinutes,
    lateTrackingEnabled: typeof attendance?.lateTrackingEnabled === 'boolean'
      ? attendance.lateTrackingEnabled
      : policy.lateTrackingEnabled,
    earlyLeaveTrackingEnabled: typeof attendance?.earlyLeaveTrackingEnabled === 'boolean'
      ? attendance.earlyLeaveTrackingEnabled
      : policy.earlyLeaveTrackingEnabled,
    scheduleSource: source
  };
}

export function getScheduleEnforcementStartDate() {
  const raw = process.env.SCHEDULE_ENFORCEMENT_START_DATE;
  if (!raw) return null;

  const value = parseDateKey(raw.trim());
  return value || null;
}

export function isScheduleComplianceEnabled() {
  return Boolean(getScheduleEnforcementStartDate());
}

export function isScheduleEnforcedForDate(dateKey) {
  const normalizedDate = parseDateKey(dateKey);
  const startDate = getScheduleEnforcementStartDate();
  if (!normalizedDate || !startDate) return false;
  return normalizedDate >= startDate;
}

export function getLateThresholdForDate(dateKey, snapshot) {
  if (!snapshot?.lateTrackingEnabled || !Number.isFinite(snapshot?.scheduledStartMinutes)) {
    return null;
  }
  const startMinutes = Number(snapshot.scheduledStartMinutes);
  const grace = Number.isFinite(snapshot.lateGraceMinutes) ? Number(snapshot.lateGraceMinutes) : 0;
  const thresholdMinutes = startMinutes + grace;
  const hours = Math.floor(thresholdMinutes / 60);
  const minutes = thresholdMinutes % 60;
  return createTimeInGMT7(dateKey, hours, minutes);
}

export function getShiftStartTimeForDate(dateKey, snapshot) {
  if (!Number.isFinite(snapshot?.scheduledStartMinutes)) return null;
  const startMinutes = Number(snapshot.scheduledStartMinutes);
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  return createTimeInGMT7(dateKey, hours, minutes);
}

export function getShiftEndTimeForDate(dateKey, snapshot) {
  if (!Number.isFinite(snapshot?.scheduledEndMinutes)) return null;
  const endMinutes = Number(snapshot.scheduledEndMinutes);
  const hours = Math.floor(endMinutes / 60);
  const minutes = endMinutes % 60;
  return createTimeInGMT7(dateKey, hours, minutes);
}

export function getOtThresholdTimeForDate(dateKey, scheduleType) {
  const policy = getSchedulePolicy(scheduleType);
  if (!Number.isFinite(policy.otThresholdMinutes)) return null;
  const hours = Math.floor(policy.otThresholdMinutes / 60);
  const minutes = policy.otThresholdMinutes % 60;
  return createTimeInGMT7(dateKey, hours, minutes);
}

export function getOtThresholdMinutes(scheduleType) {
  return getSchedulePolicy(scheduleType).otThresholdMinutes;
}

export function getEarliestContinuousOtEndMinutes(scheduleType, minimumDurationMinutes = 30) {
  const thresholdMinutes = getOtThresholdMinutes(scheduleType);
  if (!Number.isFinite(thresholdMinutes)) return null;
  return thresholdMinutes + Math.max(0, Number(minimumDurationMinutes) || 0);
}

export function formatMinutesAsTime(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const normalized = Math.max(0, Math.floor(minutes));
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
