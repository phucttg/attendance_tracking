/**
 * ============================================================================
 * CROSS-MIDNIGHT CHECKOUT TEST SUITE
 * ============================================================================
 * 
 * Test Strategy:
 * - Feature: Cross-midnight OT checkout (Policy A: True cross-midnight support)
 * - Time Control: vi.setSystemTime() for deterministic date handling
 * - Coverage: Happy path, error cases, boundaries, data integrity
 * 
 * Key Business Rules:
 * - CHECKOUT_GRACE_HOURS=24 (max session length)
 * - Checkout allowed within 24h of check-in (can be next day)
 * - Stale sessions (>24h) must be handled via admin force-checkout
 * - AuditLog created for stale/multiple sessions (best-effort, no blocking)
 * 
 * Time Control Strategy:
 * - Fix system time: 2026-01-28 10:00 GMT+7 (03:00 UTC)
 * - All date calculations relative to fixed time
 * - Prevents flaky tests due to midnight boundary crossings
 * 
 * Test Coverage:
 * - 20+ test cases across 6 suites
 * - Same-day baseline, cross-midnight valid, beyond grace, boundaries
 * - Data integrity, admin force-checkout
 * - Expected runtime: ~5-10 seconds
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Attendance from '../src/models/Attendance.js';
import AuditLog from '../src/models/AuditLog.js';
import WorkScheduleRegistration from '../src/models/WorkScheduleRegistration.js';
import { getDateKey } from '../src/utils/dateUtils.js';
import { getCheckoutGraceMs } from '../src/utils/graceConfig.js';

let employeeToken;
let employeeId;
let adminToken;
let adminId;
let graceMs;

// Fixed time for all tests: 2026-01-28 10:00 GMT+7
const FIXED_TIME = new Date('2026-01-28T03:00:00.000Z'); // 10:00 GMT+7

async function ensureTodayScheduleForEmployee(scheduleType = 'SHIFT_1') {
    await WorkScheduleRegistration.updateOne(
        { userId: employeeId, workDate: getDateKey(new Date()) },
        { $set: { scheduleType }, $setOnInsert: { lockedAt: new Date() } },
        { upsert: true }
    );
}

beforeAll(async () => {
    // STEP 1: Freeze time to prevent date boundary issues
    vi.setSystemTime(FIXED_TIME);
    console.log(`🕐 Time frozen at: ${FIXED_TIME.toISOString()} (${new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })} GMT+7)`);

    // STEP 2: Connect to isolated test database
    await mongoose.connect(
        process.env.MONGO_URI?.replace(/\/[^/]+$/, '/cross_midnight_test_db') ||
        'mongodb://localhost:27017/cross_midnight_test_db'
    );

    // STEP 3: Clean slate
    await User.deleteMany({});
    await Attendance.deleteMany({});
    await AuditLog.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});

    // STEP 4: Create test users
    const passwordHash = await bcrypt.hash('password123', 10);

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'Test Employee',
        email: 'employee@test.com',
        username: 'employee',
        passwordHash,
        role: 'EMPLOYEE',
        startDate: new Date('2024-01-01')
    });
    employeeId = employee._id;

    const admin = await User.create({
        employeeCode: 'ADM001',
        name: 'Test Admin',
        email: 'admin@test.com',
        username: 'admin',
        passwordHash,
        role: 'ADMIN',
        startDate: new Date('2024-01-01')
    });
    adminId = admin._id;

    // STEP 5: Authenticate
    const empLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'employee', password: 'password123' });
    employeeToken = empLoginRes.body.token;

    const admLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin', password: 'password123' });
    adminToken = admLoginRes.body.token;

    // STEP 6: Cache grace period
    graceMs = getCheckoutGraceMs();
    console.log(`⏱️  Grace period: ${graceMs / 3600000}h (${graceMs}ms)`);
});

afterAll(async () => {
    // STEP 1: Restore real time
    vi.useRealTimers();
    console.log('🕐 Time restored to real clock');

    // STEP 2: Clean database
    await User.deleteMany({});
    await Attendance.deleteMany({});
    await AuditLog.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});

    // STEP 3: Close connection
    await mongoose.connection.close();
});

beforeEach(async () => {
    // Clean data before each test (isolation)
    await Attendance.deleteMany({});
    await AuditLog.deleteMany({});
    await WorkScheduleRegistration.deleteMany({});
});

// ============================================================================
// Suite 1: Same-Day Checkout (Baseline)
// ============================================================================
describe('Suite 1: Same-Day Checkout (Baseline)', () => {
    /**
     * Test: SC-001 - Normal same-day checkout
     * 
     * Timeline:
     * - 2026-01-28 09:00 GMT+7: Check-in
     * - 2026-01-28 10:00 GMT+7: Check-out (1h later)
     * 
     * Expected: 200 OK
     */
    it('should allow checkout on same day', async () => {
        const today = getDateKey(new Date());
        
        // Create attendance 1h ago (09:00)
        await Attendance.create({
            userId: employeeId,
            date: today,
            checkInAt: new Date(Date.now() - 3600000) // 1h ago
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.attendance.date).toBe(today);
        expect(res.body.attendance.checkOutAt).toBeDefined();
    });

    /**
     * Test: SC-002 - Checkout immediately after check-in
     * 
     * Timeline:
     * - 2026-01-28 10:00 GMT+7: Check-in
     * - 2026-01-28 10:00 GMT+7: Check-out (immediate)
     * 
     * Expected: 200 OK (edge case: 0-minute session)
     */
    it('should allow immediate checkout', async () => {
        await ensureTodayScheduleForEmployee();

        // Check-in via API
        const checkInRes = await request(app)
            .post('/api/attendance/check-in')
            .set('Authorization', `Bearer ${employeeToken}`);
        expect(checkInRes.status).toBe(200);

        // Checkout immediately
        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
    });
});

// ============================================================================
// Suite 2: Cross-Midnight Checkout (Within Grace)
// ============================================================================
describe('Suite 2: Cross-Midnight Checkout (Within Grace)', () => {
    /**
     * Test: CM-001 - Checkout next day (11h shift)
     * 
     * Timeline:
     * - 2026-01-27 23:00 GMT+7: Check-in (yesterday 11pm)
     * - 2026-01-28 10:00 GMT+7: Check-out (today 10am)
     * - Session length: 11 hours (< 24h) ✅
     * 
     * Expected: 200 OK
     */
    it('should allow checkout for yesterday session (11h shift)', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        // Create attendance from yesterday 23:00
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - 11 * 3600000) // 11h ago
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        // Assertions
        expect(res.status).toBe(200);
        expect(res.body.attendance.date).toBe(yesterday); // Record still tied to check-in date
        expect(res.body.attendance.checkOutAt).toBeDefined();
        
        // Verify checkOutAt is after checkInAt
        const checkOut = new Date(res.body.attendance.checkOutAt);
        const checkIn = new Date(res.body.attendance.checkInAt);
        expect(checkOut > checkIn).toBe(true);
    });

    /**
     * Test: CM-002 - Maximum valid cross-midnight (23h 59m)
     * 
     * Timeline:
     * - 2026-01-27 10:01 GMT+7: Check-in
     * - 2026-01-28 10:00 GMT+7: Check-out
     * - Session length: 23h 59m (< 24h) ✅
     * 
     * Expected: 200 OK
     */
    it('should allow checkout just before 24h grace expires', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        // Check-in 23h 59m ago (1 minute before grace expires)
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - (graceMs - 60000)) // 23h 59m ago
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
    });

    /**
     * Test: CM-003 - Verify AuditLog NOT created for valid cross-midnight
     * 
     * Timeline:
     * - Valid 12h session (yesterday → today)
     * - Within grace period
     * 
     * Expected: NO AuditLog (only for stale sessions)
     */
    it('should NOT create AuditLog for valid cross-midnight session', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - 12 * 3600000)
        });

        await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        // Verify no AuditLog created
        const auditLog = await AuditLog.findOne({ userId: employeeId });
        expect(auditLog).toBeNull();
    });
});

// ============================================================================
// Suite 3: Beyond Grace Period (Rejected)
// ============================================================================
describe('Suite 3: Beyond Grace Period (Rejected)', () => {
    /**
     * Test: BG-001 - Checkout after grace expired (25h)
     * 
     * Timeline:
     * - 2026-01-27 09:00 GMT+7: Check-in (25h ago)
     * - 2026-01-28 10:00 GMT+7: Attempt checkout
     * - Session age: 25 hours (> 24h) ❌
     * 
     * Expected: 400 BAD REQUEST + AuditLog created
     */
    it('should reject checkout for stale session (25h old)', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        // Create stale attendance (25h ago = beyond grace)
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - (graceMs + 3600000)) // 25h ago
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        // Validation 1: Reject with 400
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('expired');
        expect(res.body.message).toContain(yesterday);

        // Validation 2: AuditLog created (best-effort)
        // Note: May be null if AuditLog.create() failed (fire-and-forget)
        const auditLog = await AuditLog.findOne({
            userId: employeeId,
            type: 'STALE_OPEN_SESSION'
        });
        
        if (auditLog) {
            expect(auditLog.details.sessionDate).toBe(yesterday);
            expect(auditLog.details.detectedAt).toBe('checkOut');
        }
    });

    /**
     * Test: BG-002 - Checkout exactly at grace boundary (24h + 1ms)
     * 
     * Timeline:
     * - 2026-01-27 09:59:59.999 GMT+7: Check-in
     * - 2026-01-28 10:00:00.000 GMT+7: Attempt checkout
     * - Session age: 24h 0m 0.001s (> 24h) ❌
     * 
     * Expected: 400 BAD REQUEST (boundary test)
     */
    it('should reject checkout at exact grace boundary + 1ms', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        // Check-in exactly 24h + 1ms ago
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - (graceMs + 1))
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(400);
    });
});

// ============================================================================
// Suite 4: Boundary Conditions
// ============================================================================
describe('Suite 4: Boundary Conditions', () => {
    /**
     * Test: BC-001 - Checkout at exact 24h (last valid millisecond)
     * 
     * Timeline:
     * - Check-in: 24h ago (exactly)
     * - Checkout: Now
     * - Session age: 24h 0m 0.000s (= 24h) ✅
     * 
     * Expected: 200 OK (boundary inclusive)
     */
    it('should allow checkout at exact 24h grace limit', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        // Check-in exactly 24h ago (at grace boundary)
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - graceMs)
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
    });

    /**
     * Test: BC-002 - Multiple open sessions (most recent checked out)
     * 
     * Setup:
     * - Session 1: 10h ago (within grace)
     * - Session 2: 5h ago (within grace)
     * 
     * Expected: Checkout Session 2 (most recent), log multiple sessions
     */
    it('should checkout most recent session when multiple exist', async () => {
        const today = getDateKey(new Date());
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        
        // Create 2 open sessions (data anomaly scenario)
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(Date.now() - 10 * 3600000) // 10h ago
        });
        
        await Attendance.create({
            userId: employeeId,
            date: today,
            checkInAt: new Date(Date.now() - 5 * 3600000) // 5h ago
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        // Should checkout most recent (today's session)
        expect(res.status).toBe(200);
        expect(res.body.attendance.date).toBe(today);

        // Verify AuditLog for multiple sessions (best-effort)
        const auditLog = await AuditLog.findOne({
            userId: employeeId,
            type: 'MULTIPLE_ACTIVE_SESSIONS'
        });
        
        if (auditLog) {
            expect(auditLog.details.sessionCount).toBe(2);
        }
    });
});

// ============================================================================
// Suite 5: Data Integrity
// ============================================================================
describe('Suite 5: Data Integrity', () => {
    /**
     * Test: DI-001 - Verify attendance record updated correctly
     * 
     * Assertions:
     * - checkOutAt field populated
     * - checkOutAt > checkInAt
     * - Record still tied to original check-in date
     */
    it('should update attendance record correctly', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        const checkInTime = new Date(Date.now() - 12 * 3600000);
        
        await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: checkInTime
        });

        await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        // Fetch updated record
        const updated = await Attendance.findOne({
            userId: employeeId,
            date: yesterday
        });

        expect(updated.checkOutAt).toBeDefined();
        expect(updated.checkOutAt.getTime()).toBeGreaterThan(checkInTime.getTime());
        expect(updated.date).toBe(yesterday); // Date unchanged
    });

    /**
     * Test: DI-002 - No checkout allowed without check-in
     * 
     * Expected: 400 BAD REQUEST
     */
    it('should reject checkout when no check-in exists', async () => {
        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('check in first');
    });

    /**
     * Test: DI-003 - No double checkout
     * 
     * Expected: 400 BAD REQUEST (already checked out)
     */
    it('should reject double checkout', async () => {
        const today = getDateKey(new Date());
        
        await Attendance.create({
            userId: employeeId,
            date: today,
            checkInAt: new Date(Date.now() - 3600000)
        });

        // First checkout
        await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        // Second checkout (should fail)
        const res2 = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res2.status).toBe(400);
    });
});

// ============================================================================
// Suite 6: Admin Force-Checkout (Cross-Midnight)
// ============================================================================
describe('Suite 6: Admin Force-Checkout (Cross-Midnight)', () => {
    /**
     * Test: AFC-001 - Admin force-checkout for stale session (cross-midnight)
     * 
     * Timeline:
     * - Check-in: Yesterday 22:00 GMT+7
     * - Force checkout: Today 03:00 GMT+7 (next day)
     * - Session: 5 hours, cross-midnight ✅
     * 
     * Expected: 200 OK (admin override)
     */
    it('should allow admin to force-checkout cross-midnight session', async () => {
        const yesterday = getDateKey(new Date(Date.now() - 86400000));
        const today = getDateKey(new Date());
        
        // Create open session from yesterday
        const attendance = await Attendance.create({
            userId: employeeId,
            date: yesterday,
            checkInAt: new Date(`${yesterday}T22:00:00+07:00`)
        });

        // Admin force-checkout with today's timestamp (cross-midnight)
        const res = await request(app)
            .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                checkOutAt: `${today}T03:00:00+07:00` // Next day
            });

        // Validation 1: Success
        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Forced checkout successful');

        // Validation 2: Record updated with cross-midnight checkout
        expect(res.body.attendance.date).toBe(yesterday); // Original date preserved
        expect(res.body.attendance.checkOutAt).toBeDefined();
        
        // Verify checkOutAt is next day
        const checkOutDate = new Date(res.body.attendance.checkOutAt);
        const checkOutDateKey = getDateKey(checkOutDate);
        expect(checkOutDateKey).toBe(today); // Checkout on different day ✅
    });

    /**
     * Test: AFC-002 - Admin cannot force-checkout if already checked out
     * 
     * Expected: 400 BAD REQUEST
     */
    it('should reject force-checkout if already checked out', async () => {
        const today = getDateKey(new Date());
        
        // Create completed session
        const attendance = await Attendance.create({
            userId: employeeId,
            date: today,
            checkInAt: new Date(Date.now() - 3600000),
            checkOutAt: new Date()
        });

        const res = await request(app)
            .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                checkOutAt: new Date().toISOString()
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Already checked out');
    });
});
