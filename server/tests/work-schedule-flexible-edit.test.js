import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import User from '../src/models/User.js';
import WorkScheduleRegistration from '../src/models/WorkScheduleRegistration.js';
import {
  getMyScheduleWindow,
  getNormalizedScheduleWindow,
  putMyScheduleWindow,
  WORK_SCHEDULE_LOCK_REASONS
} from '../src/services/workScheduleService.js';
import { isWeekend } from '../src/utils/dateUtils.js';

const testEmailPattern = /@work-schedule-flex\.test$/;
let userSequence = 0;

const cleanupWorkScheduleFlexData = async () => {
  const users = await User.find({ email: testEmailPattern }).select('_id').lean();
  const userIds = users.map((user) => user._id);

  await Request.deleteMany({ userId: { $in: userIds } });
  await Attendance.deleteMany({ userId: { $in: userIds } });
  await WorkScheduleRegistration.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ email: testEmailPattern });
};

async function createEmployee() {
  userSequence += 1;
  return User.create({
    employeeCode: `WSFLEX${String(userSequence).padStart(4, '0')}`,
    name: `Work Schedule Flex ${userSequence}`,
    email: `employee-${userSequence}@work-schedule-flex.test`,
    username: `work-schedule-flex-${userSequence}`,
    passwordHash: 'unused-password-hash',
    role: 'EMPLOYEE',
    isActive: true,
    deletedAt: null
  });
}

function getWindowTestDates() {
  const window = getNormalizedScheduleWindow();
  const workdays = window.dates.filter((dateKey) => !isWeekend(dateKey));
  const futureWorkdays = workdays.filter((dateKey) => dateKey > window.windowStart);
  const weekend = window.dates.find((dateKey) => isWeekend(dateKey));

  if (workdays.length < 3 || futureWorkdays.length < 2 || !weekend) {
    throw new Error('The 7-day schedule window did not provide enough test dates');
  }

  return {
    ...window,
    todayWorkday: !isWeekend(window.windowStart) ? window.windowStart : workdays[0],
    futureWorkday: futureWorkdays[0],
    anotherFutureWorkday: futureWorkdays[1],
    weekend
  };
}

function buildPayload(windowDates, overrides = {}) {
  return {
    items: windowDates.map((workDate) => ({
      workDate,
      scheduleType: Object.prototype.hasOwnProperty.call(overrides, workDate)
        ? overrides[workDate]
        : null
    }))
  };
}

function expectInvalidScheduleForDate(promise, workDate, reason) {
  return expect(promise).rejects.toMatchObject({
    code: 'INVALID_SCHEDULE_WINDOW',
    errorsByDate: {
      [workDate]: reason
    }
  });
}

async function createRegistration(userId, workDate, scheduleType = 'SHIFT_1') {
  return WorkScheduleRegistration.create({
    userId,
    workDate,
    scheduleType
  });
}

async function createAttendance(userId, workDate) {
  return Attendance.create({
    userId,
    date: workDate,
    checkInAt: new Date(`${workDate}T08:00:00+07:00`)
  });
}

async function createContinuousOtRequest(userId, workDate, status = 'PENDING') {
  return Request.create({
    userId,
    date: workDate,
    type: 'OT_REQUEST',
    status,
    estimatedEndTime: new Date(`${workDate}T19:00:00+07:00`),
    reason: 'work-schedule-flex OT'
  });
}

describe('work schedule flexible editing', () => {
  beforeEach(async () => {
    await cleanupWorkScheduleFlexData();
  });

  afterEach(async () => {
    await cleanupWorkScheduleFlexData();
  });

  it('allows a future saved schedule to change from SHIFT_1 to SHIFT_2', async () => {
    const user = await createEmployee();
    const { dates, futureWorkday } = getWindowTestDates();

    await createRegistration(user._id, futureWorkday, 'SHIFT_1');

    const result = await putMyScheduleWindow(
      user._id,
      buildPayload(dates, { [futureWorkday]: 'SHIFT_2' })
    );

    const item = result.items.find((entry) => entry.workDate === futureWorkday);
    expect(item).toMatchObject({
      scheduleType: 'SHIFT_2',
      isReadOnly: false,
      isLocked: false,
      lockedReason: null
    });

    await expect(
      WorkScheduleRegistration.findOne({ userId: user._id, workDate: futureWorkday }).lean()
    ).resolves.toMatchObject({ scheduleType: 'SHIFT_2' });
  });

  it('allows the current workday schedule to change to FLEXIBLE before check-in', async () => {
    const user = await createEmployee();
    const { dates, todayWorkday } = getWindowTestDates();

    await createRegistration(user._id, todayWorkday, 'SHIFT_1');

    const result = await putMyScheduleWindow(
      user._id,
      buildPayload(dates, { [todayWorkday]: 'FLEXIBLE' })
    );

    const item = result.items.find((entry) => entry.workDate === todayWorkday);
    expect(item).toMatchObject({
      scheduleType: 'FLEXIBLE',
      isReadOnly: false,
      isLocked: false,
      lockedReason: null
    });
  });

  it('allows an editable saved schedule to be cleared back to null', async () => {
    const user = await createEmployee();
    const { dates, futureWorkday } = getWindowTestDates();

    await createRegistration(user._id, futureWorkday, 'SHIFT_1');

    const result = await putMyScheduleWindow(user._id, buildPayload(dates));

    const item = result.items.find((entry) => entry.workDate === futureWorkday);
    expect(item.scheduleType).toBeNull();
    expect(item.isReadOnly).toBe(false);
    await expect(
      WorkScheduleRegistration.findOne({ userId: user._id, workDate: futureWorkday }).lean()
    ).resolves.toBeNull();
  });

  it('rejects schedule changes for any date in the window that already has check-in data', async () => {
    const user = await createEmployee();
    const { dates, futureWorkday } = getWindowTestDates();

    await createRegistration(user._id, futureWorkday, 'SHIFT_1');
    await createAttendance(user._id, futureWorkday);

    await expectInvalidScheduleForDate(
      putMyScheduleWindow(user._id, buildPayload(dates, { [futureWorkday]: 'SHIFT_2' })),
      futureWorkday,
      WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN
    );

    const window = await getMyScheduleWindow(user._id);
    expect(window.items.find((entry) => entry.workDate === futureWorkday)).toMatchObject({
      isReadOnly: true,
      isLocked: true,
      lockedReason: WORK_SCHEDULE_LOCK_REASONS.ALREADY_CHECKED_IN
    });
  });

  it('locks an existing schedule when pending or approved OT exists for that date', async () => {
    const user = await createEmployee();
    const { dates, futureWorkday } = getWindowTestDates();

    await createRegistration(user._id, futureWorkday, 'SHIFT_1');
    await createContinuousOtRequest(user._id, futureWorkday, 'PENDING');

    const window = await getMyScheduleWindow(user._id);
    expect(window.items.find((entry) => entry.workDate === futureWorkday)).toMatchObject({
      isReadOnly: true,
      isLocked: true,
      lockedReason: WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
    });

    await expectInvalidScheduleForDate(
      putMyScheduleWindow(user._id, buildPayload(dates, { [futureWorkday]: 'SHIFT_2' })),
      futureWorkday,
      WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
    );
  });

  it('allows first schedule set with continuous OT, then locks later changes by OT_LOCKED', async () => {
    const user = await createEmployee();
    const { dates, futureWorkday } = getWindowTestDates();

    await createContinuousOtRequest(user._id, futureWorkday, 'APPROVED');

    const firstSave = await putMyScheduleWindow(
      user._id,
      buildPayload(dates, { [futureWorkday]: 'SHIFT_1' })
    );
    expect(firstSave.items.find((entry) => entry.workDate === futureWorkday)).toMatchObject({
      scheduleType: 'SHIFT_1',
      isReadOnly: true,
      isLocked: true,
      lockedReason: WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
    });

    await expectInvalidScheduleForDate(
      putMyScheduleWindow(user._id, buildPayload(dates, { [futureWorkday]: 'SHIFT_2' })),
      futureWorkday,
      WORK_SCHEDULE_LOCK_REASONS.OT_LOCKED
    );
  });

  it('rejects changes on weekend or holiday dates with NON_WORKDAY', async () => {
    const user = await createEmployee();
    const { dates, weekend } = getWindowTestDates();

    await expectInvalidScheduleForDate(
      putMyScheduleWindow(user._id, buildPayload(dates, { [weekend]: 'SHIFT_1' })),
      weekend,
      WORK_SCHEDULE_LOCK_REASONS.NON_WORKDAY
    );
  });

  it('keeps invalid schedule type rejection and never returns SCHEDULE_LOCKED', async () => {
    const user = await createEmployee();
    const { dates, futureWorkday, anotherFutureWorkday } = getWindowTestDates();

    await createRegistration(user._id, anotherFutureWorkday, 'SHIFT_1');

    await expectInvalidScheduleForDate(
      putMyScheduleWindow(user._id, buildPayload(dates, { [futureWorkday]: 'INVALID_SHIFT' })),
      futureWorkday,
      WORK_SCHEDULE_LOCK_REASONS.OUTSIDE_WINDOW
    );

    const result = await putMyScheduleWindow(
      user._id,
      buildPayload(dates, { [anotherFutureWorkday]: 'SHIFT_2' })
    );

    expect(result.items.map((item) => item.lockedReason)).not.toContain(
      WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED
    );
  });
});
