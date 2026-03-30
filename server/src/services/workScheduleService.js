import mongoose from 'mongoose';
import Attendance from '../models/Attendance.js';
import Request from '../models/Request.js';
import User from '../models/User.js';
import WorkScheduleRegistration from '../models/WorkScheduleRegistration.js';
import { getHolidayDatesForMonth } from '../utils/holidayUtils.js';
import { getDateRange, getTodayDateKey, isWeekend } from '../utils/dateUtils.js';
import { normalizeScheduleType } from '../utils/schedulePolicy.js';
import { getTransactionOptions, isReplicaSetAvailable } from '../config/database.js';

export const WORK_SCHEDULE_WINDOW_DAYS = 7;

export const WORK_SCHEDULE_LOCK_REASONS = {
  PAST_DATE: 'PAST_DATE',
  ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
  NON_WORKDAY: 'NON_WORKDAY',
  OUTSIDE_WINDOW: 'OUTSIDE_WINDOW',
  OT_LOCKED: 'OT_LOCKED',
  SCHEDULE_LOCKED: 'SCHEDULE_LOCKED'
};

const isValidDateKey = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

const addDays = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
};

export function getNormalizedScheduleWindow() {
  const windowStart = getTodayDateKey();
  const windowEnd = addDays(windowStart, WORK_SCHEDULE_WINDOW_DAYS - 1);
  const dates = getDateRange(windowStart, windowEnd);
  return {
    windowStart,
    windowEnd,
    days: WORK_SCHEDULE_WINDOW_DAYS,
    dates
  };
}

async function getHolidaySetForDates(dateKeys) {
  if (!Array.isArray(dateKeys) || dateKeys.length === 0) {
    return new Set();
  }

  const months = Array.from(new Set(dateKeys.map((dateKey) => dateKey.slice(0, 7))));
  const holidaySet = new Set();
  for (const month of months) {
    const monthHolidays = await getHolidayDatesForMonth(month);
    for (const dateKey of monthHolidays) {
      holidaySet.add(dateKey);
    }
  }
  return holidaySet;
}

function buildItem({
  workDate,
  todayKey,
  registration,
  isWorkday,
  isWeekendDay,
  isHolidayDay,
  checkedInDateSet,
  otLockedDateSet
}) {
  const scheduleType = registration?.scheduleType || null;
  const isScheduleLocked = Boolean(isWorkday && scheduleType);
  const isSuppressedByCalendar = !isWorkday && Boolean(registration);
  const isPastDate = workDate < todayKey;
  const isToday = workDate === todayKey;

  let lockedReason = null;
  let isReadOnly = false;

  if (isPastDate) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.PAST_DATE;
  } else if (!isWorkday) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY;
  } else if (isScheduleLocked) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED;
  } else if (isToday && checkedInDateSet.has(workDate)) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN;
  } else if (otLockedDateSet.has(workDate)) {
    isReadOnly = true;
    lockedReason = WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED;
  }

  return {
    workDate,
    scheduleType,
    isWorkday,
    isWeekend: isWeekendDay,
    isHoliday: isHolidayDay,
    isLocked: isScheduleLocked,
    isReadOnly,
    isSuppressedByCalendar,
    lockedReason
  };
}

async function getWindowContext(userId) {
  const window = getNormalizedScheduleWindow();
  const holidaySet = await getHolidaySetForDates(window.dates);

  const [registrations, checkedInAttendances, otRequests] = await Promise.all([
    WorkScheduleRegistration.find({
      userId,
      workDate: { $gte: window.windowStart, $lte: window.windowEnd }
    }).lean(),
    Attendance.find({
      userId,
      date: { $in: window.dates },
      checkInAt: { $ne: null }
    })
      .select('date')
      .lean(),
    Request.find({
      userId,
      type: 'OT_REQUEST',
      status: { $in: ['PENDING', 'APPROVED'] },
      $or: [
        { date: { $gte: window.windowStart, $lte: window.windowEnd } },
        { checkInDate: { $gte: window.windowStart, $lte: window.windowEnd } }
      ]
    })
      .select('date checkInDate')
      .lean()
  ]);

  const registrationMap = new Map(registrations.map((doc) => [doc.workDate, doc]));
  const checkedInDateSet = new Set(checkedInAttendances.map((doc) => doc.date).filter(Boolean));
  const otLockedDateSet = new Set();
  for (const request of otRequests) {
    if (request?.date && window.dates.includes(request.date)) {
      otLockedDateSet.add(request.date);
    } else if (request?.checkInDate && window.dates.includes(request.checkInDate)) {
      otLockedDateSet.add(request.checkInDate);
    }
  }

  return {
    ...window,
    holidaySet,
    registrationMap,
    checkedInDateSet,
    otLockedDateSet
  };
}

function resolveUserIdFromDocument(userDoc) {
  if (!userDoc) return null;
  const raw = userDoc._id || userDoc.id || null;
  return raw ? String(raw) : null;
}

async function assertScheduleReadPermission(targetUserId, requestingUser) {
  const role = requestingUser?.role;
  const requesterId = resolveUserIdFromDocument(requestingUser);
  const targetId = String(targetUserId);

  if (requesterId && requesterId === targetId) {
    return;
  }

  if (role === 'ADMIN') {
    const existingUser = await User.findOne({
      _id: targetUserId,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    })
      .select('_id')
      .lean();
    if (!existingUser) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }
    return;
  }

  if (role === 'MANAGER') {
    if (!requestingUser?.teamId) {
      const error = new Error('Manager must be assigned to a team');
      error.statusCode = 403;
      throw error;
    }
    const allowedUser = await User.findOne({
      _id: targetUserId,
      teamId: requestingUser.teamId,
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    })
      .select('_id')
      .lean();
    if (!allowedUser) {
      const error = new Error('Access denied. You can only view users in your team.');
      error.statusCode = 403;
      throw error;
    }
    return;
  }

  const error = new Error('Insufficient permissions');
  error.statusCode = 403;
  throw error;
}

function normalizePayloadItems(items) {
  if (!Array.isArray(items)) {
    const error = new Error('items must be an array');
    error.statusCode = 400;
    throw error;
  }

  return items.map((rawItem) => ({
    workDate: typeof rawItem?.workDate === 'string' ? rawItem.workDate.trim() : '',
    scheduleType: rawItem?.scheduleType == null ? null : normalizeScheduleType(rawItem.scheduleType)
  }));
}

export async function getMyScheduleWindow(userId) {
  const context = await getWindowContext(userId);
  const items = context.dates.map((workDate) => {
    const isWeekendDay = isWeekend(workDate);
    const isHolidayDay = context.holidaySet.has(workDate);
    const isWorkday = !isWeekendDay && !isHolidayDay;

    return buildItem({
      workDate,
      todayKey: context.windowStart,
      registration: context.registrationMap.get(workDate) || null,
      isWorkday,
      isWeekendDay,
      isHolidayDay,
      checkedInDateSet: context.checkedInDateSet,
      otLockedDateSet: context.otLockedDateSet
    });
  });

  return {
    windowStart: context.windowStart,
    windowEnd: context.windowEnd,
    days: context.days,
    items
  };
}

export async function getUserScheduleWindow(targetUserId, requestingUser) {
  await assertScheduleReadPermission(targetUserId, requestingUser);
  return getMyScheduleWindow(targetUserId);
}

export async function putMyScheduleWindow(userId, payload = {}) {
  const normalizedItems = normalizePayloadItems(payload.items);
  const context = await getWindowContext(userId);
  const errorsByDate = {};

  // Basic shape validation
  if (normalizedItems.length !== context.days) {
    for (const workDate of context.dates) {
      errorsByDate[workDate] = WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
    }
  }

  const payloadMap = new Map();
  for (const item of normalizedItems) {
    if (!isValidDateKey(item.workDate)) {
      errorsByDate[item.workDate || 'INVALID_DATE'] = WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
      continue;
    }
    if (payloadMap.has(item.workDate)) {
      errorsByDate[item.workDate] = WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
      continue;
    }

    const rawScheduleType = payload.items?.find((entry) => entry?.workDate === item.workDate)?.scheduleType;
    if (rawScheduleType != null && item.scheduleType == null) {
      errorsByDate[item.workDate] = WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
      continue;
    }

    payloadMap.set(item.workDate, item.scheduleType);
  }

  for (const payloadDate of payloadMap.keys()) {
    if (!context.dates.includes(payloadDate)) {
      errorsByDate[payloadDate] = WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
    }
  }
  for (const expectedDate of context.dates) {
    if (!payloadMap.has(expectedDate)) {
      errorsByDate[expectedDate] = WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW;
    }
  }

  const operations = [];
  for (const workDate of context.dates) {
    const requestedType = payloadMap.has(workDate) ? payloadMap.get(workDate) : null;
    const existing = context.registrationMap.get(workDate) || null;
    const existingType = existing?.scheduleType || null;
    const isWeekendDay = isWeekend(workDate);
    const isHolidayDay = context.holidaySet.has(workDate);
    const isWorkday = !isWeekendDay && !isHolidayDay;
    const isPastDate = workDate < context.windowStart;
    const isToday = workDate === context.windowStart;
    const hasCheckedIn = context.checkedInDateSet.has(workDate);
    const isOtLocked = context.otLockedDateSet.has(workDate);
    const hasChange = requestedType !== existingType;

    if (!hasChange) {
      continue;
    }

    // Special no-op/non-workday suppression semantics
    if (!isWorkday) {
      const allowsNoopSuppressed = (
        (!existing && requestedType === null) ||
        (existing && requestedType === existingType)
      );
      if (!allowsNoopSuppressed) {
        errorsByDate[workDate] = WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY;
      }
      continue;
    }

    if (isPastDate) {
      errorsByDate[workDate] = WORK_SCHEDULE_LOCK_REASONS.PAST_DATE;
      continue;
    }
    if (isToday && hasCheckedIn) {
      errorsByDate[workDate] = WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN;
      continue;
    }
    if (isOtLocked) {
      errorsByDate[workDate] = WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED;
      continue;
    }
    if (existingType) {
      errorsByDate[workDate] = WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED;
      continue;
    }

    if (requestedType == null) {
      operations.push({
        deleteOne: {
          filter: {
            userId,
            workDate
          }
        }
      });
    } else {
      operations.push({
        updateOne: {
          filter: {
            userId,
            workDate
          },
          update: {
            $set: { scheduleType: requestedType },
            $setOnInsert: { lockedAt: new Date() }
          },
          upsert: true
        }
      });
    }
  }

  if (Object.keys(errorsByDate).length > 0) {
    const error = new Error('Invalid schedule update');
    error.statusCode = 400;
    error.code = 'INVALID_SCHEDULE_WINDOW';
    error.errorsByDate = errorsByDate;
    throw error;
  }

  if (operations.length > 0) {
    if (isReplicaSetAvailable()) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await WorkScheduleRegistration.bulkWrite(operations, { session, ordered: true });
        }, getTransactionOptions());
      } finally {
        await session.endSession();
      }
    } else {
      await WorkScheduleRegistration.bulkWrite(operations, { ordered: true });
    }
  }

  return getMyScheduleWindow(userId);
}

export async function getRegisteredScheduleTypeForDate(userId, workDate) {
  const registration = await WorkScheduleRegistration.findOne({ userId, workDate })
    .select('scheduleType')
    .lean();
  return registration?.scheduleType || null;
}

export async function hasOtLockForDate(userId, workDate) {
  const existing = await Request.exists({
    userId,
    type: 'OT_REQUEST',
    status: { $in: ['PENDING', 'APPROVED'] },
    $or: [{ date: workDate }, { checkInDate: workDate }]
  });
  return Boolean(existing);
}
