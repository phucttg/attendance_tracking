import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Request from '../src/models/Request.js';
import Attendance from '../src/models/Attendance.js';
import Team from '../src/models/Team.js';
import WorkScheduleRegistration from '../src/models/WorkScheduleRegistration.js';
import bcrypt from 'bcrypt';
import { getTodayDateKey } from '../src/utils/dateUtils.js';

describe('OT Request API Integration', () => {
  const FIXED_TIME = new Date('2026-02-10T03:00:00.000Z');
  const TODAY = '2026-02-10';
  const PREVIOUS_DAY = '2026-02-09';
  const TOMORROW = '2026-02-11';
  const DAY_AFTER_TOMORROW = '2026-02-12';
  let employeeToken;
  let employeeId;
  let managerToken;
  let managerId;
  let testTeamId;

  beforeAll(async () => {
    vi.setSystemTime(FIXED_TIME);

    // Connect to test database
    await mongoose.connect(
      process.env.MONGO_URI?.replace(/\/[^/]+$/, '/ot_request_test') || 
      'mongodb://localhost:27017/ot_request_test'
    );
  });

  afterAll(async () => {
    vi.useRealTimers();

    // Clean up and disconnect
    await User.deleteMany({ employeeCode: /^TEST_OT/ });
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});
    await Team.deleteMany({ name: /^TEST_OT/ });
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await User.deleteMany({ employeeCode: /^TEST_OT/ });
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});
    await Team.deleteMany({ name: /^TEST_OT/ });
    vi.setSystemTime(FIXED_TIME);

    // Create test team
    const team = await Team.create({ name: 'TEST_OT Team' });
    testTeamId = team._id;

    // Create test users directly in DB (faster than API calls)
    const passwordHash = await bcrypt.hash('Password123!', 10);
    
    const employee = await User.create({
      name: 'Test Employee OT',
      employeeCode: 'TEST_OT_EMP',
      email: 'test.ot.emp@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      teamId: testTeamId,  // Assign to team
      isActive: true
    });
    employeeId = employee._id;

    await WorkScheduleRegistration.create({
      userId: employeeId,
      workDate: getTodayDateKey(),
      scheduleType: 'SHIFT_1'
    });

    const manager = await User.create({
      name: 'Test Manager OT',
      employeeCode: 'TEST_OT_MGR',
      email: 'test.ot.mgr@example.com',
      passwordHash,
      role: 'MANAGER',
      teamId: testTeamId,  // Assign to same team
      isActive: true
    });
    managerId = manager._id;

    // Login employee
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'test.ot.emp@example.com',
        password: 'Password123!'
      });
    employeeToken = loginRes.body.token;

    // Login manager
    const mgrLoginRes = await request(app)
      .post('/api/auth/login')
      .send({
        identifier: 'test.ot.mgr@example.com',
        password: 'Password123!'
      });
    managerToken = mgrLoginRes.body.token;
  });

  async function createSeparatedOtReq(
    date = TOMORROW,
    startTime = `${TOMORROW}T01:30:00+07:00`,
    endTime = `${TOMORROW}T05:00:00+07:00`,
    reason = 'Separated pre-register test'
  ) {
    return request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        type: 'OT_REQUEST',
        date,
        otMode: 'SEPARATED',
        otStartTime: startTime,
        estimatedEndTime: endTime,
        reason
      });
  }

  async function createContinuousOtReq(
    date = TODAY,
    endTime = `${TODAY}T19:00:00+07:00`,
    reason = 'Continuous OT',
    extra = {}
  ) {
    return request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        type: 'OT_REQUEST',
        date,
        otMode: 'CONTINUOUS',
        estimatedEndTime: endTime,
        reason,
        ...extra
      });
  }

  async function createFlexibleContinuousOtReq(
    date = PREVIOUS_DAY,
    startTime = `${PREVIOUS_DAY}T18:00:00+07:00`,
    endTime = `${PREVIOUS_DAY}T20:00:00+07:00`,
    reason = 'Flexible continuous OT'
  ) {
    return request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        type: 'OT_REQUEST',
        date,
        otMode: 'CONTINUOUS',
        otStartTime: startTime,
        estimatedEndTime: endTime,
        reason
      });
  }

  async function seedCompletedAttendance({
    date = TODAY,
    checkInAt = `${date}T08:00:00+07:00`,
    checkOutAt = `${date}T17:30:00+07:00`,
    scheduleType = 'SHIFT_1'
  } = {}) {
    return Attendance.create({
      userId: employeeId,
      date,
      checkInAt: new Date(checkInAt),
      checkOutAt: new Date(checkOutAt),
      scheduleType
    });
  }

  describe('POST /api/requests (OT_REQUEST)', () => {
    it('Should create OT request successfully', async () => {
      const today = getTodayDateKey();
      
      const res = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: today,
          estimatedEndTime: `${today}T19:00:00+07:00`,  // 19:00 = after shift end for fixed shifts
          reason: 'Need to finish urgent project deployment'
        });

      expect(res.status).toBe(201);
      expect(res.body.request).toBeDefined();
      expect(res.body.request.type).toBe('OT_REQUEST');
      expect(res.body.request.status).toBe('PENDING');
      expect(res.body.request.date).toBe(today);
    });

    it('Should reject OT request without required fields', async () => {
      const today = getTodayDateKey();
      
      const res = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: today
          // Missing estimatedEndTime and reason
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('Should reject OT request for past date outside the current month', async () => {
      const yesterday = '2026-01-31';
      
      const res = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: yesterday,
          estimatedEndTime: `${yesterday}T19:00:00+07:00`,
          reason: 'Test retroactive OT'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('past');
    });

    it('Should create fixed-shift continuous OT for a past day in the current month and normalize estimatedEndTime to actual checkout', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        checkOutAt: `${PREVIOUS_DAY}T20:30:00+07:00`,
        scheduleType: 'SHIFT_1'
      });

      const res = await createContinuousOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T19:00:00+07:00`,
        'Fixed-shift past continuous OT'
      );

      expect(res.status).toBe(201);
      expect(res.body.request.otMode).toBe('CONTINUOUS');
      expect(res.body.request.date).toBe(PREVIOUS_DAY);
      expect(new Date(res.body.request.estimatedEndTime).toISOString()).toBe('2026-02-09T13:30:00.000Z');
      expect(res.body.request.otStartTime).toBeNull();
    });

    it('Should reject fixed-shift continuous OT for a past day when attendance is incomplete', async () => {
      await Attendance.create({
        userId: employeeId,
        date: PREVIOUS_DAY,
        checkInAt: new Date(`${PREVIOUS_DAY}T08:00:00+07:00`),
        scheduleType: 'SHIFT_1'
      });

      const res = await createContinuousOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T20:00:00+07:00`,
        'Incomplete fixed past continuous'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('attendance đã hoàn tất');
    });

    it('Should reject fixed-shift continuous OT for a past day when checkout has less than 30 minutes OT', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        checkOutAt: `${PREVIOUS_DAY}T17:45:00+07:00`,
        scheduleType: 'SHIFT_1'
      });

      const res = await createContinuousOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T20:00:00+07:00`,
        'Too short fixed past continuous'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('30 minutes');
    });

    it('Should reject fixed-shift continuous OT for a past day when actual checkout is after 08:00 next day', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        checkOutAt: `${TODAY}T08:30:00+07:00`,
        scheduleType: 'SHIFT_1'
      });

      const res = await createContinuousOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T19:00:00+07:00`,
        'Checkout too late next day'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('08:00');
    });

    it('Should create flexible continuous OT for a past day in the current month when attendance is completed', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        checkOutAt: `${PREVIOUS_DAY}T20:30:00+07:00`,
        scheduleType: 'FLEXIBLE'
      });

      const res = await createFlexibleContinuousOtReq();

      expect(res.status).toBe(201);
      expect(res.body.request.otMode).toBe('CONTINUOUS');
      expect(res.body.request.date).toBe(PREVIOUS_DAY);
      expect(new Date(res.body.request.otStartTime).toISOString()).toBe('2026-02-09T11:00:00.000Z');
      expect(new Date(res.body.request.estimatedEndTime).toISOString()).toBe('2026-02-09T13:00:00.000Z');
    });

    it('Should reject flexible continuous OT for a past day when otStartTime is missing', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        scheduleType: 'FLEXIBLE'
      });

      const res = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: PREVIOUS_DAY,
          otMode: 'CONTINUOUS',
          estimatedEndTime: `${PREVIOUS_DAY}T20:00:00+07:00`,
          reason: 'Missing flexible start time'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('otStartTime');
    });

    it('Should create flexible separated OT for a past day in the current month when attendance is completed', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        scheduleType: 'FLEXIBLE'
      });

      const res = await createSeparatedOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T19:00:00+07:00`,
        `${PREVIOUS_DAY}T21:00:00+07:00`,
        'Flexible separated past OT'
      );

      expect(res.status).toBe(201);
      expect(res.body.request.otMode).toBe('SEPARATED');
      expect(res.body.request.date).toBe(PREVIOUS_DAY);
    });

    it('Should create fixed-shift separated OT for a past day in the current month when attendance is completed', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        checkOutAt: `${PREVIOUS_DAY}T18:10:00+07:00`,
        scheduleType: 'SHIFT_1'
      });

      const res = await createSeparatedOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T19:00:00+07:00`,
        `${PREVIOUS_DAY}T21:00:00+07:00`,
        'Fixed separated past OT'
      );

      expect(res.status).toBe(201);
      expect(res.body.request.otMode).toBe('SEPARATED');
      expect(res.body.request.date).toBe(PREVIOUS_DAY);
    });

    it('Should reject fixed-shift separated OT for a past day when start time is not after actual checkout', async () => {
      await seedCompletedAttendance({
        date: PREVIOUS_DAY,
        checkOutAt: `${PREVIOUS_DAY}T18:10:00+07:00`,
        scheduleType: 'SHIFT_1'
      });

      const res = await createSeparatedOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T18:05:00+07:00`,
        `${PREVIOUS_DAY}T20:00:00+07:00`,
        'Start before fixed past checkout'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('check-out');
    });

    it('Should reject flexible separated OT for a past day when attendance is incomplete', async () => {
      await Attendance.create({
        userId: employeeId,
        date: PREVIOUS_DAY,
        checkInAt: new Date(`${PREVIOUS_DAY}T08:00:00+07:00`),
        scheduleType: 'FLEXIBLE'
      });

      const res = await createSeparatedOtReq(
        PREVIOUS_DAY,
        `${PREVIOUS_DAY}T19:00:00+07:00`,
        `${PREVIOUS_DAY}T21:00:00+07:00`,
        'Incomplete flexible separated'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('hoàn tất');
    });

    it('Should create separated pre-register request for tomorrow and persist anchor date as today', async () => {
      await seedCompletedAttendance();
      vi.setSystemTime(new Date('2026-02-10T16:00:00.000Z')); // 23:00 GMT+7

      const res = await createSeparatedOtReq();

      expect(res.status).toBe(201);
      expect(res.body.request.otMode).toBe('SEPARATED');
      expect(res.body.request.date).toBe(TODAY);
      expect(new Date(res.body.request.otStartTime).toISOString()).toBe('2026-02-10T18:30:00.000Z');
      expect(new Date(res.body.request.estimatedEndTime).toISOString()).toBe('2026-02-10T22:00:00.000Z');
    });

    it('Should reject separated pre-register request for a date later than tomorrow', async () => {
      await seedCompletedAttendance();
      vi.setSystemTime(new Date('2026-02-10T16:00:00.000Z'));

      const res = await createSeparatedOtReq(
        DAY_AFTER_TOMORROW,
        `${DAY_AFTER_TOMORROW}T01:30:00+07:00`,
        `${DAY_AFTER_TOMORROW}T05:00:00+07:00`,
        'Too far in advance'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ngày mai');
    });

    it('Should reject separated pre-register request when only one time is in 00:00-07:59', async () => {
      await seedCompletedAttendance();
      vi.setSystemTime(new Date('2026-02-10T16:00:00.000Z'));

      const res = await createSeparatedOtReq(
        TOMORROW,
        `${TOMORROW}T01:30:00+07:00`,
        `${TOMORROW}T08:00:00+07:00`,
        'Partial early-morning range'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('00:00-07:59');
    });

    it('Should reject separated request when estimatedEndTime is not after otStartTime', async () => {
      await seedCompletedAttendance();
      vi.setSystemTime(new Date('2026-02-10T16:00:00.000Z'));

      const res = await createSeparatedOtReq(
        TOMORROW,
        `${TOMORROW}T05:00:00+07:00`,
        `${TOMORROW}T04:00:00+07:00`,
        'End before start'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('after otStartTime');
    });

    it('Should reject separated request shorter than 30 minutes', async () => {
      await seedCompletedAttendance();
      vi.setSystemTime(new Date('2026-02-10T16:00:00.000Z'));

      const res = await createSeparatedOtReq(
        TOMORROW,
        `${TOMORROW}T01:30:00+07:00`,
        `${TOMORROW}T01:45:00+07:00`,
        'Too short'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('30 minutes');
    });
  });

  describe('DELETE /api/requests/:id', () => {
    it('Should cancel PENDING OT request', async () => {
      const today = getTodayDateKey();
      
      // Create OT request
      const createRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: today,
          estimatedEndTime: `${today}T19:00:00+07:00`,
          reason: 'Test cancellation'
        });

      // Debug: log response if request creation failed
      if (!createRes.body.request) {
        console.log('Create OT request failed:', createRes.status, createRes.body);
      }

      expect(createRes.status).toBe(201);
      const requestId = createRes.body.request._id;

      // Cancel the request
      const cancelRes = await request(app)
        .delete(`/api/requests/${requestId}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      console.log('Cancel response:', cancelRes.status, cancelRes.body);
      console.log('Request ID:', requestId);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.message).toContain('cancelled');

      // Verify request is deleted
      const checkRes = await request(app)
        .get('/api/requests/me')
        .set('Authorization', `Bearer ${employeeToken}`);

      const requests = checkRes.body.items || checkRes.body.data?.items;
      expect(requests.length).toBe(0);
    });

    it('Should not cancel already APPROVED OT request', async () => {
      const today = getTodayDateKey();
      
      // Create OT request
      const createRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: today,
          estimatedEndTime: `${today}T19:00:00+07:00`,
          reason: 'Test approval block'
        });

      const requestId = createRes.body.request._id;

      // Approve the request (as manager)
      await request(app)
        .post(`/api/requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`);

      // Try to cancel
      const cancelRes = await request(app)
        .delete(`/api/requests/${requestId}`)
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(cancelRes.status).toBe(404);
      expect(cancelRes.body.message).toContain('not found or already processed');
    });
  });

  describe('OT Approval Workflow', () => {
    it('Should set otApproved flag when OT request is approved', async () => {
      const today = getTodayDateKey();
      
      // Check-in first
      await request(app)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${employeeToken}`);

      // Create OT request
      const createRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: today,
          estimatedEndTime: `${today}T19:00:00+07:00`,
          reason: 'Test OT approval'
        });

      const requestId = createRes.body.request._id;

      // Approve the request
      const approveRes = await request(app)
        .post(`/api/requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`);

      // Verify attendance has otApproved flag
      const attendance = await Attendance.findOne({
        userId: employeeId,
        date: today
      });

      expect(attendance).toBeDefined();
      expect(attendance.otApproved).toBe(true);
    });

    it('Should auto-apply otApproved on check-in if pre-approved', async () => {
      const today = getTodayDateKey();
      
      // Create OT request (no check-in yet)
      const createRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'OT_REQUEST',
          date: today,
          estimatedEndTime: `${today}T19:00:00+07:00`,
          reason: 'Test pre-approval'
        });

      const requestId = createRes.body.request._id;

      // Approve the request (before check-in)
      await request(app)
        .post(`/api/requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${managerToken}`);

      // Now check-in
      const checkInRes = await request(app)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${employeeToken}`);

      // Verify otApproved is auto-applied (check response or query DB)
      if (checkInRes.body.otApproved !== undefined) {
        expect(checkInRes.body.otApproved).toBe(true);
      } else {
        // Fallback: query attendance directly
        const attendance = await Attendance.findOne({
          userId: employeeId,
          date: today
        });
        expect(attendance.otApproved).toBe(true);
      }
    });
  });
});
