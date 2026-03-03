import Attendance from '../models/Attendance.js';
import { createTimeInGMT7, getDateKey } from '../utils/dateUtils.js';

const ONE_MINUTE_MS = 60 * 1000;

let schedulerStarted = false;
let schedulerTimer = null;

const getNextDateKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  return nextDate.toISOString().slice(0, 10);
};

const buildMidnightCheckout = (dateKey, checkInAt) => {
  const nextDateKey = getNextDateKey(dateKey);
  let checkOutAt = createTimeInGMT7(nextDateKey, 0, 0);

  // Guard against corrupted checkInAt that is after midnight.
  if (checkInAt && checkOutAt <= checkInAt) {
    checkOutAt = new Date(checkInAt.getTime() + ONE_MINUTE_MS);
  }

  return checkOutAt;
};

export const autoCloseOpenSessionsBeforeToday = async ({ now = new Date(), reason = 'scheduled' } = {}) => {
  const todayKey = getDateKey(now);
  if (!todayKey) {
    return { processed: 0, closed: 0, reason };
  }

  const sessions = await Attendance.find({
    checkInAt: { $exists: true, $ne: null },
    checkOutAt: null,
    date: { $lt: todayKey }
  })
    .select('_id date checkInAt')
    .lean();

  if (sessions.length === 0) {
    return { processed: 0, closed: 0, reason };
  }

  const ops = sessions.map((session) => ({
    updateOne: {
      filter: { _id: session._id, checkOutAt: null },
      update: {
        $set: {
          checkOutAt: buildMidnightCheckout(session.date, session.checkInAt),
          closeSource: 'SYSTEM_AUTO_MIDNIGHT',
          closedByRequestId: null,
          needsReconciliation: true
        }
      }
    }
  }));

  const result = await Attendance.bulkWrite(ops, { ordered: false });
  const closed = result?.modifiedCount ?? result?.nModified ?? 0;

  return {
    processed: sessions.length,
    closed,
    reason
  };
};

const getMsUntilNextMidnight = (now = new Date()) => {
  const todayKey = getDateKey(now);
  if (!todayKey) {
    return ONE_MINUTE_MS;
  }
  const nextDateKey = getNextDateKey(todayKey);
  const nextMidnight = createTimeInGMT7(nextDateKey, 0, 0);
  return Math.max(ONE_MINUTE_MS, nextMidnight.getTime() - now.getTime());
};

const scheduleNextRun = () => {
  const delayMs = getMsUntilNextMidnight(new Date());

  schedulerTimer = setTimeout(async () => {
    try {
      const result = await autoCloseOpenSessionsBeforeToday({ reason: 'scheduled' });
      if (result.closed > 0) {
        console.log(`[auto-close] Closed ${result.closed}/${result.processed} overdue sessions`);
      }
    } catch (error) {
      console.error('[auto-close] Scheduled run failed:', error.message);
    } finally {
      scheduleNextRun();
    }
  }, delayMs);

  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref();
  }
};

export const startAutoCloseScheduler = () => {
  if (schedulerStarted) {
    return;
  }
  schedulerStarted = true;
  scheduleNextRun();
};

export const runAutoCloseCatchupOnStartup = async () => {
  try {
    const result = await autoCloseOpenSessionsBeforeToday({ reason: 'startup-catchup' });
    if (result.closed > 0) {
      console.log(`[auto-close] Startup catch-up closed ${result.closed}/${result.processed} overdue sessions`);
    }
    return result;
  } catch (error) {
    console.error('[auto-close] Startup catch-up failed:', error.message);
    return { processed: 0, closed: 0, reason: 'startup-catchup' };
  }
};

