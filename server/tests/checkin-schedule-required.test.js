import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Attendance from '../src/models/Attendance.js';
import Holiday from '../src/models/Holiday.js';
import WorkScheduleRegistration from '../src/models/WorkScheduleRegistration.js';
import { getDateKey, getTodayDateKey, isWeekend } from '../src/utils/dateUtils.js';

let employeeToken;
let employeeId;

const todayKey = () => getTodayDateKey();
const todayIsWeekend = () => isWeekend(todayKey());
const itWorkdayOnly = todayIsWeekend() ? it.skip : it;

beforeAll(async () => {
  await mongoose.connect(
    process.env.MONGO_URI?.replace(/\/[^/]+$/, '/checkin_schedule_required_test_db')
  );

  await User.deleteMany({});
  await Attendance.deleteMany({});
  await Holiday.deleteMany({});
  await WorkScheduleRegistration.deleteMany({});

  const passwordHash = await bcrypt.hash('password123', 10);
  const employee = await User.create({
    employeeCode: 'EMP-SCHEDULE-REQ',
    name: 'Schedule Required Employee',
    email: 'schedule-required-employee@test.com',
    username: 'schedule-required-employee',
    passwordHash,
    role: 'EMPLOYEE',
    startDate: new Date('2024-01-01')
  });

  employeeId = employee._id;

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ identifier: 'schedule-required-employee', password: 'password123' });
  employeeToken = loginRes.body.token;
});

afterAll(async () => {
  await User.deleteMany({});
  await Attendance.deleteMany({});
  await Holiday.deleteMany({});
  await WorkScheduleRegistration.deleteMany({});
  await mongoose.connection.close();
});

beforeEach(async () => {
  await Attendance.deleteMany({});
  await Holiday.deleteMany({});
  await WorkScheduleRegistration.deleteMany({});
});

describe('Mandatory schedule gate for check-in', () => {
  itWorkdayOnly('blocks check-in on workday when today has no schedule', async () => {
    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SCHEDULE_REQUIRED');
    expect(res.body.redirectTo).toBe('/my-schedule');
    expect(res.body.workDate).toBe(todayKey());
  });

  itWorkdayOnly('allows check-in on workday when today schedule exists', async () => {
    await WorkScheduleRegistration.create({
      userId: employeeId,
      workDate: todayKey(),
      scheduleType: 'SHIFT_2'
    });

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.attendance).toBeDefined();
    expect(res.body.attendance.date).toBe(todayKey());
    expect(res.body.attendance.scheduleType).toBe('SHIFT_2');
  });

  it('keeps non-workday bypass (holiday) even when today has no schedule', async () => {
    if (!todayIsWeekend()) {
      await Holiday.create({
        date: todayKey(),
        name: 'Temporary Test Holiday'
      });
    }

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.attendance).toBeDefined();
    expect(res.body.attendance.date).toBe(todayKey());
  });

  it('keeps open-session check precedence over schedule gate', async () => {
    const yesterday = getDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    await Attendance.create({
      userId: employeeId,
      date: yesterday,
      checkInAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      checkOutAt: null
    });

    const res = await request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect([400, 409]).toContain(res.status);
    expect(res.body.code === 'OPEN_SESSION_BLOCKED' || res.body.code === 'OPEN_SESSION_ANOMALY').toBe(true);
  });
});
