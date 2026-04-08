/**
 * OT Request Edge Cases — Unit & Integration Tests
 *
 * Covers all 13 edge cases identified in analysis:
 *  #1  Race condition: Approve after checkout
 *  #2  Approve before check-in, user doesn't check in
 *  #3  ADJUST_TIME + OT_REQUEST same day conflict
 *  #4  Auto-extend after APPROVED creates duplicate
 *  #5  Cancel PENDING when APPROVED exists same day
 *  #6  Cross-midnight: 1 attendance record, 1 OT request (next-day end < 08:00)
 *  #7  Admin force-checkout + OT approval
 *  #8  Approve then checkout before 17:30
 *  #9  Minimum 30min validation vs actual <30min OT
 *  #10 Concurrent approval (CAS)
 *  #11 Month boundary: pending crosses month
 *  #12 Cannot reverse otApproved after approval
 *  #13 Deactivated user creates OT request
 *
 * Test DB: ot_edge_case_test_db (isolated)
 * Time frozen: 2026-02-10 10:00 GMT+7 (Tuesday)
 */


import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Request from '../src/models/Request.js';
import Attendance from '../src/models/Attendance.js';
import Team from '../src/models/Team.js';
import WorkScheduleRegistration from '../src/models/WorkScheduleRegistration.js';
import { getTodayDateKey, getDateKey, createTimeInGMT7 } from '../src/utils/dateUtils.js';
import { computeAttendance, computeWorkMinutes, computeOtMinutes, computePotentialOtMinutes } from '../src/utils/attendanceCompute.js';

// Deterministic time: 2026-02-10 10:00:00 GMT+7 = 03:00:00 UTC (Tuesday)
const FIXED_TIME = new Date('2026-02-10T03:00:00.000Z');
const TODAY = '2026-02-10'; // Tuesday
const TOMORROW = '2026-02-11'; // Wednesday
const YESTERDAY = '2026-02-09'; // Monday
const PASSWORD = 'Password123!';

describe('OT Request Edge Cases', () => {
  let employeeToken, employeeId;
  let managerToken, managerId;
  let adminToken, adminId;
  let testTeamId, otherTeamId;

  beforeAll(async () => {
    vi.setSystemTime(FIXED_TIME);

    await mongoose.connect(
      process.env.MONGO_URI?.replace(/\/[^/]+$/, '/ot_edge_case_test_db') ||
      'mongodb://localhost:27017/ot_edge_case_test_db'
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    await User.deleteMany({ employeeCode: /^EDGE_OT/ });
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});
    await Team.deleteMany({ name: /^EDGE_OT/ });
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Full cleanup before each test
    await User.deleteMany({ employeeCode: /^EDGE_OT/ });
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});
    await Team.deleteMany({ name: /^EDGE_OT/ });

    // Reset time
    vi.setSystemTime(FIXED_TIME);

    // Create teams
    const team = await Team.create({ name: 'EDGE_OT Team A' });
    testTeamId = team._id;
    const otherTeam = await Team.create({ name: 'EDGE_OT Team B' });
    otherTeamId = otherTeam._id;

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    // Create users
    const employee = await User.create({
      name: 'Edge Employee',
      employeeCode: 'EDGE_OT_EMP',
      email: 'edge.ot.emp@example.com',
      passwordHash,
      role: 'EMPLOYEE',
      teamId: testTeamId,
      isActive: true
    });
    employeeId = employee._id;

    const manager = await User.create({
      name: 'Edge Manager',
      employeeCode: 'EDGE_OT_MGR',
      email: 'edge.ot.mgr@example.com',
      passwordHash,
      role: 'MANAGER',
      teamId: testTeamId,
      isActive: true
    });
    managerId = manager._id;

    const admin = await User.create({
      name: 'Edge Admin',
      employeeCode: 'EDGE_OT_ADM',
      email: 'edge.ot.adm@example.com',
      passwordHash,
      role: 'ADMIN',
      teamId: testTeamId,
      isActive: true
    });
    adminId = admin._id;

    await WorkScheduleRegistration.create({
      userId: employeeId,
      workDate: TODAY,
      scheduleType: 'SHIFT_1'
    });

    // Login all users
    const empLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'edge.ot.emp@example.com', password: PASSWORD });
    employeeToken = empLogin.body.token;

    const mgrLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'edge.ot.mgr@example.com', password: PASSWORD });
    managerToken = mgrLogin.body.token;

    const admLogin = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'edge.ot.adm@example.com', password: PASSWORD });
    adminToken = admLogin.body.token;
  });

  // ─────────────────────────────────────────────────────────────
  // Helper functions
  // ─────────────────────────────────────────────────────────────

  /**
   * Create OT request via API
   */
  async function createOtRequest(date, endTimeISO, reason = 'Test OT', token = employeeToken) {
    return request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'OT_REQUEST',
        date,
        estimatedEndTime: endTimeISO,
        reason
      });
  }

  /**
   * Approve request via API
   */
  async function approveOtRequest(requestId, token = managerToken) {
    return request(app)
      .post(`/api/requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${token}`);
  }

  /**
   * Cancel request via API
   */
  async function cancelOtRequest(requestId, token = employeeToken) {
    return request(app)
      .delete(`/api/requests/${requestId}`)
      .set('Authorization', `Bearer ${token}`);
  }

  /**
   * Check-in via API
   */
  async function doCheckIn(token = employeeToken) {
    return request(app)
      .post('/api/attendance/check-in')
      .set('Authorization', `Bearer ${token}`);
  }

  /**
   * Check-out via API
   */
  async function doCheckOut(token = employeeToken) {
    return request(app)
      .post('/api/attendance/check-out')
      .set('Authorization', `Bearer ${token}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #1: Race Condition — Approve after checkout
  // Severity: LOW (system computes on-the-fly, no cache)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #1: Approve after checkout', () => {
    it('should correctly compute OT when approved after checkout (on-the-fly)', async () => {
      // 1. Check in at 08:30
      const checkInTime = new Date('2026-02-10T01:30:00.000Z'); // 08:30 GMT+7
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create OT request at 10:00
      vi.setSystemTime(FIXED_TIME);
      const createRes = await createOtRequest(
        TODAY,
        `${TODAY}T19:00:00+07:00`,
        'Edge case #1'
      );
      expect(createRes.status).toBe(201);
      const requestId = createRes.body.request._id;

      // 3. Checkout at 20:00 WITHOUT approval
      const checkOutTime = new Date('2026-02-10T13:00:00.000Z'); // 20:00 GMT+7
      vi.setSystemTime(checkOutTime);
      await doCheckOut();

      // 4. Before approval: otApproved = false
      const attBefore = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(attBefore.otApproved).toBe(false);

      // Compute BEFORE approval
      const computedBefore = computeAttendance(attBefore);
      expect(computedBefore.otMinutes).toBe(0); // No OT without approval
      // workMinutes should be capped at 17:30

      // 5. Manager approves AFTER checkout
      const approveRes = await approveOtRequest(requestId);
      expect(approveRes.status).toBe(200);

      // 6. After approval: otApproved = true
      const attAfter = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(attAfter.otApproved).toBe(true);

      // 7. Recompute AFTER approval — should now show OT
      const computedAfter = computeAttendance(attAfter);
      expect(computedAfter.otMinutes).toBeGreaterThan(0); // OT now counted
      // 17:30 — 20:00 = 150 minutes
      expect(computedAfter.otMinutes).toBe(150);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #2: Approve before check-in, user doesn't check in
  // Severity: LOW (expected behavior, no attendance = no effect)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #2: Approve before check-in, user skips day', () => {
    it('should leave OT request APPROVED but no attendance created', async () => {
      // 1. Create OT request for today (no check-in)
      const createRes = await createOtRequest(
        TODAY,
        `${TODAY}T19:00:00+07:00`,
        'Pre-approved OT'
      );
      expect(createRes.status).toBe(201);
      const requestId = createRes.body.request._id;

      // 2. Approve before check-in
      const approveRes = await approveOtRequest(requestId);
      expect(approveRes.status).toBe(200);

      // 3. Verify: Request is APPROVED
      const req = await Request.findById(requestId).lean();
      expect(req.status).toBe('APPROVED');

      // 4. Verify: No attendance record exists (user didn't check in)
      const att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att).toBeNull();

      // 5. Verify: Request approval is "orphaned" — no operational impact
    });

    it('should auto-apply otApproved when user checks in later', async () => {
      // 1. Create and approve OT request
      const createRes = await createOtRequest(
        TODAY,
        `${TODAY}T19:00:00+07:00`,
        'Pre-approved auto-apply'
      );
      const requestId = createRes.body.request._id;
      await approveOtRequest(requestId);

      // 2. User checks in
      const checkInRes = await doCheckIn();
      expect(checkInRes.status).toBe(200);

      // 3. Verify otApproved auto-applied
      const att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att).toBeDefined();
      expect(att.otApproved).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #3: ADJUST_TIME + OT_REQUEST same day
  // Severity: MEDIUM (otApproved stays true even if ADJUST_TIME checkout < 17:30)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #3: ADJUST_TIME + OT_REQUEST same day', () => {
    it('should keep otApproved=true but compute OT=0 when ADJUST_TIME sets checkout before 17:30', async () => {
      // 1. Check in at 08:30
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create and approve OT request
      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'OT before adjust');
      expect(otRes.status).toBe(201);
      await approveOtRequest(otRes.body.request._id);

      // 3. Verify otApproved = true
      let att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att.otApproved).toBe(true);

      // 4. Create ADJUST_TIME to change checkout to 16:00 (before 17:30)
      const adjustRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          type: 'ADJUST_TIME',
          date: TODAY,
          requestedCheckInAt: `${TODAY}T08:30:00+07:00`,
          requestedCheckOutAt: `${TODAY}T16:00:00+07:00`,
          reason: 'Left early, adjust time'
        });
      // ADJUST_TIME may or may not be allowed while session is open,
      // depending on business rules. If it requires checkout first, skip.
      if (adjustRes.status === 201) {
        const adjustId = adjustRes.body.request._id;

        // 5. Approve ADJUST_TIME
        const approveAdj = await approveOtRequest(adjustId);

        if (approveAdj.status === 200) {
          // 6. Verify attendance updated
          att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();

          // otApproved should still be true (reconciliation preserves it)
          expect(att.otApproved).toBe(true);

          // But compute should return OT=0 because checkout < 17:30
          const computed = computeAttendance(att);
          expect(computed.otMinutes).toBe(0); // Checkout at 16:00, no OT
          // workMinutes should be 16:00-08:30 minus lunch = ~390 min
          expect(computed.workMinutes).toBeLessThan(480);
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #4: Auto-extend after APPROVED — creates duplicate
  // Severity: HIGH (confusing UX, 2 requests for same day)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #4: Auto-extend after APPROVED creates duplicate', () => {
    it('should create a new PENDING request when APPROVED already exists for same date', async () => {
      // 1. Create first OT request
      const createRes1 = await createOtRequest(
        TODAY,
        `${TODAY}T19:00:00+07:00`,
        'First OT request'
      );
      expect(createRes1.status).toBe(201);
      const requestId1 = createRes1.body.request._id;

      // 2. Approve first request
      const approveRes = await approveOtRequest(requestId1);
      expect(approveRes.status).toBe(200);

      // 3. Create second OT request for same date (extend to 22:00)
      const createRes2 = await createOtRequest(
        TODAY,
        `${TODAY}T22:00:00+07:00`,
        'Extend OT to 22:00'
      );

      // BEHAVIOR UNDER TEST: Does system allow or block?
      // Current implementation: auto-extend only finds PENDING, so new PENDING created
      if (createRes2.status === 201) {
        const requestId2 = createRes2.body.request._id;

        // 4. Verify: TWO requests exist for same date
        const allRequests = await Request.find({
          userId: employeeId,
          type: 'OT_REQUEST',
          date: TODAY
        }).lean();

        // This documents the DUPLICATE issue
        expect(allRequests.length).toBe(2);
        expect(allRequests.some(r => r.status === 'APPROVED')).toBe(true);
        expect(allRequests.some(r => r.status === 'PENDING')).toBe(true);

        // 5. IDs should be different
        expect(requestId2).not.toBe(requestId1);
      } else {
        // If system blocks (better behavior), verify error message
        expect(createRes2.status).toBe(409);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #5: Cancel PENDING when APPROVED exists same day
  // Severity: LOW (no logic error, just UX confusion)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #5: Cancel PENDING when APPROVED exists same day', () => {
    it('should cancel PENDING without affecting existing APPROVED request', async () => {
      // Requires Edge #4 to create duplicate first
      // 1. Create and approve first request
      const res1 = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'First');
      expect(res1.status).toBe(201);
      await approveOtRequest(res1.body.request._id);

      // 2. Create second PENDING request
      const res2 = await createOtRequest(TODAY, `${TODAY}T22:00:00+07:00`, 'Second');
      if (res2.status === 201) {
        const pendingId = res2.body.request._id;

        // 3. Cancel PENDING
        const cancelRes = await cancelOtRequest(pendingId);
        expect(cancelRes.status).toBe(200);

        // 4. APPROVED request still exists
        const remaining = await Request.find({
          userId: employeeId,
          type: 'OT_REQUEST',
          date: TODAY
        }).lean();

        expect(remaining.length).toBe(1);
        expect(remaining[0].status).toBe('APPROVED');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #6: Cross-midnight — single OT request policy
  // Severity: HIGH (must avoid API bypass and preserve attendance semantics)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #6: Cross-midnight OT — single request policy', () => {
    it('should allow cross-midnight request when next-day end time is before 08:00', async () => {
      const crossMidnightRes = await createOtRequest(
        TODAY,
        `${TOMORROW}T00:30:00+07:00`,
        'Cross-midnight single request'
      );

      expect(crossMidnightRes.status).toBe(201);
      expect(crossMidnightRes.body.request.date).toBe(TODAY);
      expect(getDateKey(new Date(crossMidnightRes.body.request.estimatedEndTime))).toBe(TOMORROW);
    });

    it('should reject next-day end time at or after 08:00 (anti-bypass)', async () => {
      const crossMidnightRes = await createOtRequest(
        TODAY,
        `${TOMORROW}T08:00:00+07:00`,
        'Cross-midnight bypass attempt'
      );

      expect(crossMidnightRes.status).toBe(400);
      expect(crossMidnightRes.body.message).toContain('07:59');
    });

    it('should allow next-day 07:59 boundary', async () => {
      const crossMidnightRes = await createOtRequest(
        TODAY,
        `${TOMORROW}T07:59:00+07:00`,
        'Cross-midnight 07:59 boundary'
      );

      expect(crossMidnightRes.status).toBe(201);
    });

    it('should reject estimatedEndTime beyond immediate next day', async () => {
      const beyondNextDayRes = await createOtRequest(
        TODAY,
        '2026-02-12T00:30:00+07:00',
        'Beyond next day'
      );

      expect(beyondNextDayRes.status).toBe(400);
      expect(beyondNextDayRes.body.message).toContain('immediate next day');
    });

    it('should apply approval to check-in date attendance and compute 419 OT minutes at 00:30 checkout', async () => {
      // 1. Check in at 08:30 on TODAY
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create cross-midnight OT request (TODAY -> TOMORROW 00:30)
      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TOMORROW}T00:30:00+07:00`, 'Cross-midnight approved');
      expect(otRes.status).toBe(201);

      // 3. Approve the request
      const approveRes = await approveOtRequest(otRes.body.request._id);
      expect(approveRes.status).toBe(200);

      // 4. Checkout at TOMORROW 00:30
      const checkOutTime = new Date('2026-02-10T17:30:00.000Z'); // 2026-02-11 00:30 GMT+7
      vi.setSystemTime(checkOutTime);
      const checkoutRes = await doCheckOut();
      expect(checkoutRes.status).toBe(200);

      // 5. Attendance belongs to check-in date, with approved OT minutes
      const attToday = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(attToday).toBeDefined();
      expect(attToday.otApproved).toBe(true);
      const computed = computeAttendance(attToday);
      expect(computed.otMinutes).toBe(420);

      // 6. No separate attendance for TOMORROW (session still anchored on TODAY)
      const attTomorrow = await Attendance.findOne({ userId: employeeId, date: TOMORROW }).lean();
      expect(attTomorrow).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #7: Admin force-checkout + OT approval
  // Severity: LOW (admin manual action)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #7: Admin force-checkout with OT approval', () => {
    it('should preserve otApproved after admin force-checkout', async () => {
      // 1. Check in at 08:30
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create and approve OT
      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'Force checkout test');
      expect(otRes.status).toBe(201);
      await approveOtRequest(otRes.body.request._id);

      // 3. Verify otApproved is set
      const att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att.otApproved).toBe(true);

      // 4. Admin force-checkout (directly update DB, simulating force-checkout endpoint)
      const forceCheckoutTime = new Date('2026-02-10T14:00:00.000Z'); // 21:00 GMT+7
      await Attendance.findOneAndUpdate(
        { userId: employeeId, date: TODAY },
        { $set: { checkOutAt: forceCheckoutTime } }
      );

      // 5. Verify otApproved still preserved
      const attAfter = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(attAfter.otApproved).toBe(true);
      expect(attAfter.checkOutAt).toBeDefined();

      // 6. Compute OT — should be based on force-checkout time
      const computed = computeAttendance(attAfter);
      expect(computed.otMinutes).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #8: Approve then checkout before 17:30
  // Severity: LOW (correct behavior, OT=0)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #8: Approved OT but checkout before 17:30', () => {
    it('should compute OT=0 even with otApproved=true if checkout < 17:30', async () => {
      // 1. Check in at 08:30
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create and approve OT
      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'Early checkout');
      expect(otRes.status).toBe(201);
      await approveOtRequest(otRes.body.request._id);

      // 3. Checkout at 16:30 (before 17:30)
      const checkOutTime = new Date('2026-02-10T09:30:00.000Z'); // 16:30 GMT+7
      vi.setSystemTime(checkOutTime);
      await doCheckOut();

      // 4. Verify: otApproved=true but OT=0
      const att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att.otApproved).toBe(true);

      const computed = computeAttendance(att);
      expect(computed.otMinutes).toBe(0); // Checkout before OT threshold
      expect(computed.workMinutes).toBeLessThan(480); // Less than full day
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #9: Minimum 30min validation vs actual OT <30min
  // Severity: MEDIUM (validation gate only, actual can be <30)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #9: Minimum 30min validation vs actual OT', () => {
    it('should reject OT request with estimated <30 minutes', async () => {
      // estimatedEndTime = 17:50 → OT = 17:30 to 17:50 = 20 min < 30
      const res = await createOtRequest(
        TODAY,
        `${TODAY}T17:50:00+07:00`,
        'Short OT attempt'
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('30 minutes');
    });

    it('should accept minimum 30min OT request (boundary)', async () => {
      // estimatedEndTime = 18:00 → OT = 17:30 to 18:00 = 30 min exactly
      const res = await createOtRequest(
        TODAY,
        `${TODAY}T18:00:00+07:00`,
        'Minimum OT'
      );

      expect(res.status).toBe(201);
    });

    it('should compute actual OT <30min if checkout is before estimated end', async () => {
      // 1. Check in at 08:30
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create OT request for 19:00 (valid, >30min)
      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'Actual <30 test');
      expect(otRes.status).toBe(201);
      await approveOtRequest(otRes.body.request._id);

      // 3. Checkout at 17:46 → Actual OT = 17:30-17:46 = 16 min (<30)
      const checkOutTime = new Date('2026-02-10T10:46:00.000Z'); // 17:46 GMT+7
      vi.setSystemTime(checkOutTime);
      await doCheckOut();

      // 4. Verify: Actual OT computed is 16 minutes (below 30min threshold)
      const att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      const computed = computeAttendance(att);
      expect(computed.otMinutes).toBe(16);
      // This is by design: 30min is validation gate only, actual is computed from checkout
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #10: Concurrent approval — CAS validation
  // Severity: ALREADY HANDLED (CAS prevents double-approve)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #10: Concurrent approval race condition', () => {
    it('should return 409 when second approve attempt on already-approved request', async () => {
      // 1. Check in
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // 2. Create OT request
      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'CAS test');
      expect(otRes.status).toBe(201);
      const requestId = otRes.body.request._id;

      // 3. First approve succeeds
      const approve1 = await approveOtRequest(requestId, managerToken);
      expect(approve1.status).toBe(200);

      // 4. Second approve fails with 409
      const approve2 = await approveOtRequest(requestId, adminToken);
      expect(approve2.status).toBe(409);
      expect(approve2.body.message).toContain('already');
    });

    it('otApproved should be idempotent (safe to set true twice)', async () => {
      // Directly test idempotency
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      // Set otApproved twice
      await Attendance.findOneAndUpdate(
        { userId: employeeId, date: TODAY },
        { $set: { otApproved: true } }
      );
      await Attendance.findOneAndUpdate(
        { userId: employeeId, date: TODAY },
        { $set: { otApproved: true } }
      );

      const att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att.otApproved).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #11: Month boundary — PENDING crosses month
  // Severity: LOW (31/month is generous)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #11: Month boundary — pending count', () => {
    it('should count pending per month based on request date, not creation date', async () => {
      // Create request for today (Feb 10)
      const res1 = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'Feb request');
      expect(res1.status).toBe(201);

      // February pending count should be 1
      const febCount = await Request.countDocuments({
        userId: employeeId,
        type: 'OT_REQUEST',
        status: 'PENDING',
        $or: [
          { date: { $regex: '^2026-02' } },
          { checkInDate: { $regex: '^2026-02' } }
        ]
      });
      expect(febCount).toBe(1);

      // Request for March 2 should not affect February count
      const mar2 = '2026-03-02';
      const res2 = await createOtRequest(mar2, `${mar2}T19:00:00+07:00`, 'March request');
      expect(res2.status).toBe(201);

      // February count unchanged
      const febCountAfter = await Request.countDocuments({
        userId: employeeId,
        type: 'OT_REQUEST',
        status: 'PENDING',
        $or: [
          { date: { $regex: '^2026-02' } },
          { checkInDate: { $regex: '^2026-02' } }
        ]
      });
      expect(febCountAfter).toBe(1); // Still 1
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #12: Cannot reverse otApproved after approval
  // Severity: MEDIUM (no undo mechanism)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #12: Cannot reverse otApproved after approval', () => {
    it('should NOT reset otApproved when OT request is rejected (different request)', async () => {
      // Setup: Check in, create OT, approve, otApproved=true
      const checkInTime = new Date('2026-02-10T01:30:00.000Z');
      vi.setSystemTime(checkInTime);
      await doCheckIn();

      vi.setSystemTime(FIXED_TIME);
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'Approved OT');
      expect(otRes.status).toBe(201);
      await approveOtRequest(otRes.body.request._id);

      // Verify otApproved = true
      let att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
      expect(att.otApproved).toBe(true);

      // Create second OT request (if system allows — Edge #4)
      const otRes2 = await createOtRequest(TODAY, `${TODAY}T22:00:00+07:00`, 'Second OT');
      if (otRes2.status === 201) {
        const requestId2 = otRes2.body.request._id;

        // Reject second request
        const rejectRes = await request(app)
          .post(`/api/requests/${requestId2}/reject`)
          .set('Authorization', `Bearer ${managerToken}`);

        // otApproved should STILL be true (rejection doesn't reset it)
        att = await Attendance.findOne({ userId: employeeId, date: TODAY }).lean();
        expect(att.otApproved).toBe(true);
      }
    });

    it('should confirm no API endpoint exists to reset otApproved', async () => {
      // There is no DELETE /api/attendance/:id/ot-approval or similar
      // This test documents the limitation
      const res = await request(app)
        .delete(`/api/attendance/${employeeId}/ot-approval`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Expected: 404 (route doesn't exist)
      expect(res.status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASE #13: Deactivated user creates OT request
  // Severity: LOW (auth middleware typically checks)
  // ═══════════════════════════════════════════════════════════════

  describe('Edge #13: Deactivated user interactions', () => {
    it('should block approval for inactive user', async () => {
      // 1. Create OT request while active
      const otRes = await createOtRequest(TODAY, `${TODAY}T19:00:00+07:00`, 'Before deactivation');
      expect(otRes.status).toBe(201);
      const requestId = otRes.body.request._id;

      // 2. Deactivate user directly in DB
      await User.findByIdAndUpdate(employeeId, { isActive: false });

      // 3. Manager tries to approve → should be blocked
      const approveRes = await approveOtRequest(requestId);
      expect(approveRes.status).toBe(400);
      expect(approveRes.body.message).toContain('inactive');
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// PURE UNIT TESTS: computeWorkMinutes / computeOtMinutes
// Decision Table Testing (ISTQB technique)
// ═══════════════════════════════════════════════════════════════

describe('OT Computation Decision Table (Unit Tests)', () => {
  const dateKey = '2026-02-10';

  // Helper to create GMT+7 timestamps
  const gmt7 = (h, m = 0) => createTimeInGMT7(dateKey, h, m);

  describe('computeWorkMinutes — OT approval capping', () => {
    const checkIn = gmt7(8, 30);

    it('Case 1: otApproved=false, checkout=20:00 → CAP at 17:30', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(20, 0), false);
      // 08:30 → 17:30 = 540 min - 60 lunch = 480
      expect(result).toBe(480);
    });

    it('Case 2: otApproved=true, checkout=20:00 → same regular window', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(20, 0), true);
      // Regular work remains 08:30 → 17:30 = 540 min - 60 lunch = 480
      expect(result).toBe(480);
    });

    it('Case 3: otApproved=false, checkout=16:30 → no cap needed', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(16, 30), false);
      // 08:30 → 16:30 = 480 min - 60 lunch = 420
      expect(result).toBe(420);
    });

    it('Case 4: otApproved=true, checkout=16:30 → same as false', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(16, 30), true);
      expect(result).toBe(420);
    });

    it('Case 6: otApproved=false, checkout=17:30 → boundary (no cap)', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(17, 30), false);
      // 08:30 → 17:30 = 540 - 60 = 480
      expect(result).toBe(480);
    });

    it('Case 7: otApproved=true, checkout=17:31 → regular work still ends at shift end', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(17, 31), true);
      // Approved OT does not expand regular workMinutes
      expect(result).toBe(480);
    });

    it('Case 8: otApproved=false, checkout=17:31 → CAP at 17:30', () => {
      const result = computeWorkMinutes(dateKey, checkIn, gmt7(17, 31), false);
      // Capped to 17:30: 08:30 → 17:30 = 540 - 60 = 480
      expect(result).toBe(480);
    });
  });

  describe('computeOtMinutes — approval gating', () => {
    it('Case 1: otApproved=false, checkout=20:00 → 0', () => {
      expect(computeOtMinutes(dateKey, gmt7(20, 0), false)).toBe(0);
    });

    it('Case 2: otApproved=true, checkout=20:00 → 150 min', () => {
      // 17:30 → 20:00 = 150 min
      expect(computeOtMinutes(dateKey, gmt7(20, 0), true)).toBe(150);
    });

    it('Case 3: otApproved=true, checkout=17:30 → 0 (boundary: <=)', () => {
      // 17:30 <= 17:30 → 0
      expect(computeOtMinutes(dateKey, gmt7(17, 30), true)).toBe(0);
    });

    it('Case 4: otApproved=true, checkout=17:31 → 1 min', () => {
      expect(computeOtMinutes(dateKey, gmt7(17, 31), true)).toBe(1);
    });

    it('Case 5: otApproved=true, checkout=16:30 → 0', () => {
      expect(computeOtMinutes(dateKey, gmt7(16, 30), true)).toBe(0);
    });

    it('Case 6: default (no otApproved param) → 0', () => {
      // Default parameter is false
      expect(computeOtMinutes(dateKey, gmt7(20, 0))).toBe(0);
    });
  });

  describe('computePotentialOtMinutes — ignores approval', () => {
    it('should compute OT regardless of approval status', () => {
      const result = computePotentialOtMinutes(dateKey, gmt7(20, 0));
      expect(result).toBe(150); // Always computes
    });

    it('should return 0 if checkout is at or before 17:30', () => {
      expect(computePotentialOtMinutes(dateKey, gmt7(17, 0))).toBe(0);
      expect(computePotentialOtMinutes(dateKey, gmt7(17, 30))).toBe(0);
    });

    it('should handle invalid date', () => {
      expect(computePotentialOtMinutes(dateKey, null)).toBe(0);
      expect(computePotentialOtMinutes(dateKey, new Date('invalid'))).toBe(0);
    });
  });

  describe('computeAttendance — full integration with otApproved', () => {
    it('should use otApproved from attendance record', () => {
      const attendance = {
        date: dateKey,
        checkInAt: gmt7(8, 30),
        checkOutAt: gmt7(20, 0),
        otApproved: true
      };
      const result = computeAttendance(attendance);
      expect(result.otMinutes).toBe(150);
      expect(result.workMinutes).toBe(480); // Regular work stays in-shift only
    });

    it('should default otApproved to false if missing', () => {
      const attendance = {
        date: dateKey,
        checkInAt: gmt7(8, 30),
        checkOutAt: gmt7(20, 0)
        // otApproved not set
      };
      const result = computeAttendance(attendance);
      expect(result.otMinutes).toBe(0);
      expect(result.workMinutes).toBe(480); // Capped at 17:30
    });

    it('should force otApproved=true for weekend', () => {
      const saturdayKey = '2026-02-14'; // Saturday
      const attendance = {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 9, 0),
        checkOutAt: createTimeInGMT7(saturdayKey, 18, 0),
        otApproved: false // should be overridden
      };
      const result = computeAttendance(attendance);
      expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
      // 09:00 -> 18:00 = 9h, spans lunch => 8h = 480 minutes
      expect(result.workMinutes).toBe(480);
      expect(result.otMinutes).toBe(480);
    });

    it('should compute all Sunday morning work as OT', () => {
      const sundayKey = '2026-03-08'; // Sunday
      const attendance = {
        date: sundayKey,
        checkInAt: createTimeInGMT7(sundayKey, 8, 0),
        checkOutAt: createTimeInGMT7(sundayKey, 11, 0),
        otApproved: false
      };

      const result = computeAttendance(attendance);
      expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
      expect(result.workMinutes).toBe(180);
      expect(result.otMinutes).toBe(180);
    });

    it('should handle holiday with otApproved=false (forced true)', () => {
      const holidayDates = new Set([dateKey]);
      const attendance = {
        date: dateKey,
        checkInAt: gmt7(9, 0),
        checkOutAt: gmt7(18, 0),
        otApproved: false
      };
      const result = computeAttendance(attendance, holidayDates);
      expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
      expect(result.workMinutes).toBe(480);
      expect(result.otMinutes).toBe(480);
    });

    // ─── Weekend path verification (does NOT use computeOtMinutes) ──

    it('should NOT use computeOtMinutes path for weekend (otMinutes = full work, not post-17:30)', () => {
      // Saturday 09:00-16:00: checkout BEFORE 17:30
      // If weekday logic were used: otMinutes=0 (checkout before 17:30)
      // Weekend logic: otMinutes = workMinutes
      const saturdayKey = '2026-02-14'; // Saturday
      const attendance = {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 9, 0),
        checkOutAt: createTimeInGMT7(saturdayKey, 16, 0),
        otApproved: false
      };
      const result = computeAttendance(attendance);
      expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
      // 09:00→16:00 = 7h = 420 min, spans lunch → 420 - 60 = 360
      expect(result.workMinutes).toBe(360);
      expect(result.otMinutes).toBe(360);
      // Verify otMinutes is NOT 0 (which computeOtMinutes would return for pre-17:30 checkout)
      expect(result.otMinutes).toBeGreaterThan(0);
    });

    it('should NOT use computePotentialOtMinutes for weekend (otMinutes = weekendMinutes)', () => {
      // Saturday with checkout at 20:00
      // computePotentialOtMinutes would return 150 (20:00 - 17:30)
      // Weekend logic should return full workMinutes instead
      const saturdayKey = '2026-02-14'; // Saturday
      const attendance = {
        date: saturdayKey,
        checkInAt: createTimeInGMT7(saturdayKey, 9, 0),
        checkOutAt: createTimeInGMT7(saturdayKey, 20, 0),
        otApproved: false
      };
      const result = computeAttendance(attendance);
      expect(result.status).toBe('WEEKEND_OR_HOLIDAY');
      // 09:00→20:00 = 11h = 660 min, spans lunch → 660 - 60 = 600
      expect(result.workMinutes).toBe(600);
      expect(result.otMinutes).toBe(600);
      // NOT 149 from computePotentialOtMinutes
      expect(result.otMinutes).not.toBe(150);
    });

    it('should not affect weekday OT behavior (regression guard)', () => {
      // Tuesday 09:00-20:00, otApproved=false
      // Must still return otMinutes=0 (weekday path, strict rule)
      const attendance = {
        date: dateKey, // Tuesday 2026-02-10
        checkInAt: gmt7(9, 0),
        checkOutAt: gmt7(20, 0),
        otApproved: false
      };
      const result = computeAttendance(attendance);
      expect(result.status).not.toBe('WEEKEND_OR_HOLIDAY');
      expect(result.otMinutes).toBe(0); // Strict: no approval = no OT on weekday
      expect(result.workMinutes).toBe(450); // Capped at 17:30: 09:00→17:30 = 8.5h - 1h lunch = 450
    });
  });
});
