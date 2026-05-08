/**
 * Test Suite: Open-Session Endpoints
 *
 * Scope:
 *   - GET /api/attendance/open-session         (user scope)
 *   - GET /api/admin/attendance/open-sessions  (admin scope)
 *
 * Techniques:
 *   - Equivalence Partitioning (EP): open / auto-closed / reconciled / empty states
 *   - Security / RBAC: employee cannot access admin endpoint; cross-user isolation
 *
 * ISO 25010: Functional Suitability, Security
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGMT7Time(dateKey, h, m) {
    return createTimeInGMT7(dateKey, h, m);
}

function todayKey() {
    return getDateKey(new Date());
}

/**
 * Seed an auto-closed Attendance row for a given userId + date.
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
let adminToken;

beforeAll(async () => {
    await User.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'OS Employee',
        email: 'os_employee@test.com',
        username: 'os_employee',
        passwordHash,
        role: 'EMPLOYEE',
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    employeeId = employee._id;

    await User.create({
        employeeCode: 'ADM001',
        name: 'OS Admin',
        email: 'os_admin@test.com',
        username: 'os_admin',
        passwordHash,
        role: 'ADMIN',
        isActive: true,
        startDate: new Date('2024-01-01')
    });

    const empLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'os_employee@test.com', password: 'Password123' });
    employeeToken = empLogin.body.token;

    const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'os_admin@test.com', password: 'Password123' });
    adminToken = adminLogin.body.token;
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
// OS-USER: GET /api/attendance/open-session (employee scope)
// ============================================================================

describe('GET /api/attendance/open-session – Employee scope (EP)', () => {
    /**
     * OS-USER-001
     * EP: No open or pending-reconcile sessions → openSession null, needsReconciliation empty.
     */
    it('[OS-USER-001] empty state returns null openSession and empty reconciliation list', async () => {
        const res = await request(app)
            .get('/api/attendance/open-session')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.openSession).toBeNull();
        expect(res.body.needsReconciliation).toEqual([]);
    });

    /**
     * OS-USER-002
     * EP: Has open session (checkOutAt = null) → returned in openSession field.
     */
    it('[OS-USER-002] active open session is returned in openSession field', async () => {
        const today = todayKey();
        await Attendance.create({
            userId: employeeId,
            date: today,
            checkInAt: new Date()
        });

        const res = await request(app)
            .get('/api/attendance/open-session')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.openSession).not.toBeNull();
        expect(res.body.openSession.date).toBe(today);
        expect(res.body.openSession.attendanceId ?? res.body.openSession.id).toBeTruthy();
    });

    /**
     * OS-USER-003
     * EP: Has auto-closed session with needsReconciliation=true →
     *     returned in needsReconciliation list.
     */
    it('[OS-USER-003] auto-closed session with needsReconciliation=true appears in reconciliation list', async () => {
        const yKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, yKey);

        const res = await request(app)
            .get('/api/attendance/open-session')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.openSession).toBeNull();
        expect(res.body.needsReconciliation).toHaveLength(1);

        const item = res.body.needsReconciliation[0];
        expect(item.attendanceId).toBe(att._id.toString());
        expect(item.date).toBe(yKey);
    });

    /**
     * OS-USER-004
     * EP: Reconciled session (needsReconciliation=false) → NOT in response.
     */
    it('[OS-USER-004] already-reconciled session does NOT appear in needsReconciliation', async () => {
        const yKey = daysAgoKey(1);
        await Attendance.create({
            userId: employeeId,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0),
            checkOutAt: buildGMT7Time(yKey, 17, 30),
            closeSource: 'ADJUST_APPROVAL',
            needsReconciliation: false
        });

        const res = await request(app)
            .get('/api/attendance/open-session')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.openSession).toBeNull();
        expect(res.body.needsReconciliation).toEqual([]);
    });

    /**
     * OS-RBAC-002
     * Security: User can only see own data via /open-session (isolation).
     * Another user's open session must not appear.
     */
    it('[OS-RBAC-002] user sees only their own sessions', async () => {
        const otherUserId = new mongoose.Types.ObjectId();
        const yKey = daysAgoKey(1);

        // Create open session for another user
        await Attendance.create({
            userId: otherUserId,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0)
        });

        const res = await request(app)
            .get('/api/attendance/open-session')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        // Employee sees no data (the open session belongs to another user)
        expect(res.body.openSession).toBeNull();
        expect(res.body.needsReconciliation).toEqual([]);
    });
});

// ============================================================================
// OS-ADMIN: GET /api/admin/attendance/open-sessions (admin scope)
// ============================================================================

describe('GET /api/admin/attendance/open-sessions – Admin scope (EP)', () => {
    /**
     * OS-ADMIN-001
     * EP: Admin can see open sessions for all users.
     */
    it('[OS-ADMIN-001] admin sees open sessions from all users', async () => {
        const users = [
            new mongoose.Types.ObjectId(),
            new mongoose.Types.ObjectId()
        ];

        for (let i = 0; i < users.length; i++) {
            const dateKey = daysAgoKey(i + 1);
            await Attendance.create({
                userId: users[i],
                date: dateKey,
                checkInAt: buildGMT7Time(dateKey, 9, 0)
            });
        }

        const res = await request(app)
            .get('/api/admin/attendance/open-sessions')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const items = res.body.items ?? res.body;
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * OS-ADMIN-002a
     * EP: Filter status=open returns only open sessions.
     */
    it('[OS-ADMIN-002a] status=open returns only truly open sessions', async () => {
        const yKey = daysAgoKey(1);
        const openUser = new mongoose.Types.ObjectId();
        const closedUser = new mongoose.Types.ObjectId();

        // Open session
        await Attendance.create({
            userId: openUser,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0)
        });

        // Closed reconciliation session
        await seedAutoClosedSession(closedUser, yKey);

        const res = await request(app)
            .get('/api/admin/attendance/open-sessions?status=open')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const items = res.body.items ?? res.body;
        expect(Array.isArray(items)).toBe(true);

        // Every returned item must be an open session
        for (const item of items) {
            expect(item.checkOutAt).toBeNull();
        }
    });

    /**
     * OS-ADMIN-002b
     * EP: Filter status=reconciliation returns only sessions needing reconciliation.
     */
    it('[OS-ADMIN-002b] status=reconciliation returns only pending-reconciliation sessions', async () => {
        const yKey = daysAgoKey(1);
        const openUser = new mongoose.Types.ObjectId();
        const reconUser = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId: openUser,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0)
        });
        await seedAutoClosedSession(reconUser, yKey);

        const res = await request(app)
            .get('/api/admin/attendance/open-sessions?status=reconciliation')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const items = res.body.items ?? res.body;
        expect(Array.isArray(items)).toBe(true);

        // Every returned item must have needsReconciliation = true
        for (const item of items) {
            expect(item.needsReconciliation).toBe(true);
        }
    });

    /**
     * OS-ADMIN-002c
     * EP: Filter status=all returns both open AND reconciliation sessions.
     */
    it('[OS-ADMIN-002c] status=all returns both open and reconciliation sessions', async () => {
        const yKey = daysAgoKey(1);
        const openUser = new mongoose.Types.ObjectId();
        const reconUser = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId: openUser,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0)
        });
        await seedAutoClosedSession(reconUser, yKey);

        const res = await request(app)
            .get('/api/admin/attendance/open-sessions?status=all')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const items = res.body.items ?? res.body;
        expect(items.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * OS-ADMIN-003
     * EP: limit query parameter is respected.
     */
    it('[OS-ADMIN-003] limit query parameter restricts results', async () => {
        // Seed 5 open sessions across distinct users
        for (let i = 1; i <= 5; i++) {
            const userId = new mongoose.Types.ObjectId();
            const dateKey = daysAgoKey(i);
            await Attendance.create({
                userId,
                date: dateKey,
                checkInAt: buildGMT7Time(dateKey, 9, 0)
            });
        }

        const res = await request(app)
            .get('/api/admin/attendance/open-sessions?status=open&limit=2')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const items = res.body.items ?? res.body;
        expect(Array.isArray(items)).toBe(true);
        expect(items.length).toBeLessThanOrEqual(2);
    });
});

// ============================================================================
// OS-RBAC: Role-based access control
// ============================================================================

describe('RBAC on open-session endpoints', () => {
    /**
     * OS-RBAC-001
     * RBAC: EMPLOYEE cannot access GET /api/admin/attendance/open-sessions → 403.
     */
    it('[OS-RBAC-001] employee cannot access admin open-sessions endpoint', async () => {
        const res = await request(app)
            .get('/api/admin/attendance/open-sessions')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(403);
    });

    /**
     * Security: Unauthenticated request → 401.
     */
    it('[OS-RBAC-AUTH] unauthenticated request returns 401', async () => {
        const res = await request(app)
            .get('/api/attendance/open-session');

        expect(res.status).toBe(401);
    });
});
