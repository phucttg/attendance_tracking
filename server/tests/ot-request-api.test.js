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

    it('Should reject OT request for past date', async () => {
      const yesterday = '2026-02-09';
      
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
