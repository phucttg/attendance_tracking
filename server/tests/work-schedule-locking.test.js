import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import WorkScheduleRegistration from '../src/models/WorkScheduleRegistration.js';
import {
  WORK_SCHEDULE_LOCK_REASONS,
  getNormalizedScheduleWindow,
  putMyScheduleWindow
} from '../src/services/workScheduleService.js';
import { isWeekend } from '../src/utils/dateUtils.js';

const getPayloadItems = (dates, overrides = {}) =>
  dates.map((workDate) => ({
    workDate,
    scheduleType: Object.prototype.hasOwnProperty.call(overrides, workDate)
      ? overrides[workDate]
      : null
  }));

let employeeId;

beforeAll(async () => {
  await mongoose.connect(
    process.env.MONGO_URI?.replace(/\/[^/]+$/, '/work_schedule_locking_test_db')
  );

  await User.deleteMany({});
  await WorkScheduleRegistration.deleteMany({});

  const employee = await User.create({
    employeeCode: 'EMP-SCHEDULE-LOCK',
    name: 'Schedule Lock Employee',
    email: 'schedule-lock-employee@test.com',
    username: 'schedule-lock-employee',
    passwordHash: 'hashed-password',
    role: 'EMPLOYEE',
    startDate: new Date('2024-01-01')
  });
  employeeId = employee._id;
});

afterAll(async () => {
  await User.deleteMany({});
  await WorkScheduleRegistration.deleteMany({});
  await mongoose.connection.close();
});

beforeEach(async () => {
  await WorkScheduleRegistration.deleteMany({});
});

describe('Work schedule locking', () => {
  it('marks selected workday as locked after submit', async () => {
    const window = getNormalizedScheduleWindow();
    const targetDate = window.dates.find((dateKey) => !isWeekend(dateKey)) || window.dates[0];

    const saved = await putMyScheduleWindow(employeeId, {
      items: getPayloadItems(window.dates, { [targetDate]: 'SHIFT_1' })
    });

    const targetItem = saved.items.find((item) => item.workDate === targetDate);
    expect(targetItem).toBeDefined();
    expect(targetItem.scheduleType).toBe('SHIFT_1');
    expect(targetItem.isLocked).toBe(true);
    expect(targetItem.isReadOnly).toBe(true);
    expect(targetItem.lockedReason).toBe(WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED);
  });

  it('rejects updates when trying to change a locked schedule day', async () => {
    const window = getNormalizedScheduleWindow();
    const targetDate = window.dates.find((dateKey) => !isWeekend(dateKey)) || window.dates[0];

    await putMyScheduleWindow(employeeId, {
      items: getPayloadItems(window.dates, { [targetDate]: 'SHIFT_1' })
    });

    await expect(
      putMyScheduleWindow(employeeId, {
        items: getPayloadItems(window.dates, { [targetDate]: 'SHIFT_2' })
      })
    ).rejects.toMatchObject({
      code: 'INVALID_SCHEDULE_WINDOW',
      errorsByDate: {
        [targetDate]: WORK_SCHEDULE_LOCK_REASONS.SCHEDULE_LOCKED
      }
    });
  });
});
