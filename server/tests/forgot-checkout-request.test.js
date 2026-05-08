/**
 * Test Suite: FORGOT_CHECKOUT Request Creation
 *
 * Scope: Creating ADJUST_TIME requests with adjustMode=FORGOT_CHECKOUT via
 *        POST /api/requests.
 *
 * Techniques:
 *   - Equivalence Partitioning (EP): valid / invalid adjustMode, missing fields
 *   - Boundary Value Analysis (BVA): session length limit, submission window limit
 *   - Security: cross-user targetAttendanceId ownership
 *   - Race Condition: duplicate concurrent requests
 *
 * ISO 25010: Functional Suitability, Security, Reliability
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import { createTimeInGMT7, getDateKey } from '../src/utils/dateUtils.js';
import { daysAgoKey } from './testDateHelper.js';
import { getCheckoutGraceHours, getAdjustRequestMaxDays } from '../src/utils/graceConfig.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGMT7Time(dateKey, h, m) {
    return createTimeInGMT7(dateKey, h, m);
}

/**
 * Seed a properly auto-closed session for the given user + date.
 * Returns the attendance document.
 */
async function seedAutoClosedSession(userId, dateKey) {
    const checkInAt = buildGMT7Time(dateKey, 9, 0);
    const [y, mo, d] = dateKey.split('-').map(Number);
    const nextDayKey = new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0)).toISOString().slice(0, 10);
    const checkOutAt = buildGMT7Time(nextDayKey, 0, 0);

    return Attendance.create({
        userId,
        date: dateKey,
        checkInAt,
        checkOutAt,
        closeSource: 'SYSTEM_AUTO_MIDNIGHT',
        needsReconciliation: true
    });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let employeeToken;
let employeeId;
let otherEmployeeToken;
let otherEmployeeId;

const GRACE_HOURS = getCheckoutGraceHours();
const MAX_DAYS = getAdjustRequestMaxDays();

beforeAll(async () => {
    await User.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'FC Employee',
        email: 'fc_employee@test.com',
        username: 'fc_employee',
        passwordHash,
        role: 'EMPLOYEE',
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    employeeId = employee._id;

    const other = await User.create({
        employeeCode: 'EMP002',
        name: 'Other Employee',
        email: 'other_fc@test.com',
        username: 'other_fc',
        passwordHash,
        role: 'EMPLOYEE',
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    otherEmployeeId = other._id;

    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fc_employee@test.com', password: 'Password123' });
    employeeToken = loginRes.body.token;

    const otherLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'other_fc@test.com', password: 'Password123' });
    otherEmployeeToken = otherLoginRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

// ============================================================================
// VALIDATION: Missing / invalid fields
// ============================================================================

describe('FC-VAL: Input validation (EP)', () => {
    /**
     * FC-VAL-001
     * EP: adjustMode=FORGOT_CHECKOUT without targetAttendanceId → 400.
     */
    it('[FC-VAL-001] FORGOT_CHECKOUT without targetAttendanceId returns 400', async () => {
        const dateKey = daysAgoKey(1);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                requestedCheckOutAt: buildGMT7Time(dateKey, 17, 30).toISOString(),
                reason: 'forgot to checkout'
            });

        expect(res.status).toBe(400);
    });

    /**
     * FC-VAL-002
     * EP: FORGOT_CHECKOUT without requestedCheckOutAt → 400.
     */
    it('[FC-VAL-002] FORGOT_CHECKOUT without requestedCheckOutAt returns 400', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                reason: 'forgot to checkout'
                // requestedCheckOutAt intentionally omitted
            });

        expect(res.status).toBe(400);
    });

    /**
     * FC-VAL-003
     * EP: FORGOT_CHECKOUT with requestedCheckInAt → 400 (not allowed).
     */
    it('[FC-VAL-003] FORGOT_CHECKOUT with requestedCheckInAt returns 400', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                requestedCheckInAt: buildGMT7Time(dateKey, 9, 0).toISOString(),
                requestedCheckOutAt: buildGMT7Time(dateKey, 17, 30).toISOString(),
                reason: 'forgot to checkout'
            });

        expect(res.status).toBe(400);
    });

    /**
     * FC-VAL-004
     * BVA: requestedCheckOutAt <= checkInAt of target session → 400.
     */
    it('[FC-VAL-004] requestedCheckOutAt before target checkInAt returns 400', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        // checkInAt is 09:00; requestedCheckOutAt is before that
        const checkOutBefore = buildGMT7Time(dateKey, 8, 0);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                requestedCheckOutAt: checkOutBefore.toISOString(),
                reason: 'forgot to checkout'
            });

        expect(res.status).toBe(400);
    });

    /**
     * FC-VAL-005
     * BVA: requestedCheckOutAt - checkInAt > CHECKOUT_GRACE_HOURS → 400.
     */
    it('[FC-VAL-005] session length exceeding grace hours returns 400', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        // checkInAt is 09:00 GMT+7; add graceHours + 1 min to exceed limit
        const overLimitCheckOut = new Date(
            buildGMT7Time(dateKey, 9, 0).getTime() + (GRACE_HOURS + 1) * 60 * 60 * 1000
        );

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                requestedCheckOutAt: overLimitCheckOut.toISOString(),
                reason: 'forgot to checkout'
            });

        expect(res.status).toBe(400);
    });

    /**
     * FC-VAL-006
     * BVA: Submission > ADJUST_REQUEST_MAX_DAYS after checkIn → 400.
     */
    it('[FC-VAL-006] submission beyond max days after checkIn returns 400', async () => {
        const oldDate = daysAgoKey(MAX_DAYS + 2); // clearly outside window
        const att = await seedAutoClosedSession(employeeId, oldDate);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: oldDate,
                targetAttendanceId: att._id.toString(),
                requestedCheckOutAt: buildGMT7Time(oldDate, 17, 30).toISOString(),
                reason: 'forgot to checkout'
            });

        expect(res.status).toBe(400);
    });

    /**
     * FC-VAL-007
     * EP: Already has PENDING ADJUST_TIME for same checkInDate → 409.
     */
    it('[FC-VAL-007] duplicate PENDING FORGOT_CHECKOUT for same session returns 409', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        const payload = {
            type: 'ADJUST_TIME',
            adjustMode: 'FORGOT_CHECKOUT',
            date: dateKey,
            targetAttendanceId: att._id.toString(),
            requestedCheckOutAt: buildGMT7Time(dateKey, 17, 30).toISOString(),
            reason: 'forgot to checkout'
        };

        const first = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send(payload);
        expect(first.status).toBe(201);

        const second = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send(payload);
        expect(second.status).toBe(409);
    });

    /**
     * FC-VAL-008
     * Security: targetAttendanceId belonging to another user → 404/400/403.
     */
    it('[FC-VAL-008] targetAttendanceId of another user returns 4xx', async () => {
        const dateKey = daysAgoKey(1);
        // seed for OTHER employee
        const otherAtt = await seedAutoClosedSession(otherEmployeeId, dateKey);

        // employee tries to create request pointing to other's session
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: otherAtt._id.toString(),
                requestedCheckOutAt: buildGMT7Time(dateKey, 17, 30).toISOString(),
                reason: 'malicious cross-user attempt'
            });

        expect([400, 403, 404]).toContain(res.status);
    });

    /**
     * FC-VAL-009
     * EP: targetAttendanceId pointing to session NOT auto-closed
     *     (closeSource ≠ SYSTEM_AUTO_MIDNIGHT) → 400.
     */
    it('[FC-VAL-009] target session not auto-closed (USER_CHECKOUT) returns 400', async () => {
        const dateKey = daysAgoKey(1);

        // Session closed manually by user – NOT auto-closed
        const att = await Attendance.create({
            userId: employeeId,
            date: dateKey,
            checkInAt: buildGMT7Time(dateKey, 9, 0),
            checkOutAt: buildGMT7Time(dateKey, 17, 30),
            closeSource: 'USER_CHECKOUT',
            needsReconciliation: false
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                requestedCheckOutAt: buildGMT7Time(dateKey, 17, 0).toISOString(),
                reason: 'not actually forgot checkout'
            });

        expect(res.status).toBe(400);
    });
});

// ============================================================================
// HAPPY PATH: Successful FORGOT_CHECKOUT request creation
// ============================================================================

describe('FC-HAPPY: Successful request creation (EP)', () => {
    /**
     * FC-HAPPY-001
     * EP: Valid FORGOT_CHECKOUT request created with correct fields.
     */
    it('[FC-HAPPY-001] creates FORGOT_CHECKOUT request with correct field values', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        const checkOutAt = buildGMT7Time(dateKey, 17, 30);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                requestedCheckOutAt: checkOutAt.toISOString(),
                reason: 'forgot to checkout'
            });

        expect(res.status).toBe(201);
        const created = res.body.request ?? res.body;
        expect(created.adjustMode).toBe('FORGOT_CHECKOUT');
        expect(created.targetAttendanceId).toBe(att._id.toString());
        expect(created.status).toBe('PENDING');
        expect(created.type).toBe('ADJUST_TIME');
    });

    /**
     * FC-HAPPY-002
     * EP: Request date field syncs to target attendance's date.
     */
    it('[FC-HAPPY-002] created request date matches target attendance date', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                adjustMode: 'FORGOT_CHECKOUT',
                date: dateKey,
                targetAttendanceId: att._id.toString(),
                requestedCheckOutAt: buildGMT7Time(dateKey, 17, 30).toISOString(),
                reason: 'forgot to checkout date check'
            });

        expect(res.status).toBe(201);
        const created = res.body.request ?? res.body;
        expect(created.date ?? created.checkInDate).toBe(dateKey);
    });
});

// ============================================================================
// RACE CONDITION / DUPLICATE
// ============================================================================

describe('FC-DUP: Race condition guard via unique index', () => {
    /**
     * FC-DUP-001
     * Race Condition: Two concurrent duplicate requests → unique index rejects second (E11000 → 409).
     */
    it('[FC-DUP-001] concurrent duplicate requests: only first succeeds', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);

        const payload = {
            type: 'ADJUST_TIME',
            adjustMode: 'FORGOT_CHECKOUT',
            date: dateKey,
            targetAttendanceId: att._id.toString(),
            requestedCheckOutAt: buildGMT7Time(dateKey, 17, 30).toISOString(),
            reason: 'concurrent test'
        };

        // Fire both requests simultaneously
        const [r1, r2] = await Promise.all([
            request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send(payload),
            request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send(payload)
        ]);

        const statuses = [r1.status, r2.status].sort();
        // One must succeed (201), the other must fail (409)
        expect(statuses).toEqual([201, 409]);
    });
});
