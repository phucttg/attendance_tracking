/**
 * Test Suite: Legacy closeSource Backward Compatibility
 *
 * Scope: Records created before the Plan V2.1 fields exist (closeSource = null,
 *        needsReconciliation = false/missing) must continue to work with all
 *        read/write flows.
 *
 * Techniques: Equivalence Partitioning (EP)
 *
 * ISO 25010: Maintainability (Changeability), Functional Suitability (Correctness)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Attendance from '../src/models/Attendance.js';
import { daysAgoKey } from './testDateHelper.js';

let employeeToken;
let employeeId;

beforeAll(async () => {
    await User.deleteMany({});
    await Attendance.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'Legacy Employee',
        email: 'legacy@test.com',
        username: 'legacy_employee',
        passwordHash,
        role: 'EMPLOYEE',
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    employeeId = employee._id;

    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'legacy@test.com', password: 'Password123' });
    employeeToken = loginRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Attendance.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
});

// ============================================================================
// LEGACY READ: Records without closeSource must be returned normally
// ============================================================================

describe('Legacy closeSource = null – Read flows', () => {
    /**
     * LG-READ-001
     * EP: An Attendance record with closeSource=null (legacy) must be returned
     *     by GET /api/attendance/me without error.
     */
    it('[LG-READ-001] GET /api/attendance/me returns legacy null-closeSource record', async () => {
        const month = '2026-01';
        // Insert a fully closed legacy record directly into DB (bypassing service)
        await Attendance.create({
            userId: employeeId,
            date: '2026-01-10',
            checkInAt: new Date('2026-01-10T01:00:00.000Z'),
            checkOutAt: new Date('2026-01-10T10:30:00.000Z'),
            closeSource: null,   // legacy: field did not exist before
            needsReconciliation: false
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${month}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        const items = res.body.items ?? res.body.attendance ?? [];
        const record = items.find(r => r.date === '2026-01-10');
        expect(record).toBeDefined();
        // Should compute a meaningful status (PRESENT / ON_TIME / etc.) without crashing
        expect(record.status).toBeTruthy();
    });

    /**
     * LG-READ-002
     * EP: Monthly history that contains a mix of null and valid closeSource records
     *     must return all records with correct statuses and no crashes.
     */
    it('[LG-READ-002] Monthly history handles mix of null and valid closeSource', async () => {
        const month = '2026-01';
        await Attendance.insertMany([
            {
                userId: employeeId,
                date: '2026-01-07',
                checkInAt: new Date('2026-01-07T01:00:00.000Z'),
                checkOutAt: new Date('2026-01-07T10:30:00.000Z'),
                closeSource: null  // legacy null
            },
            {
                userId: employeeId,
                date: '2026-01-08',
                checkInAt: new Date('2026-01-08T01:00:00.000Z'),
                checkOutAt: new Date('2026-01-08T10:30:00.000Z'),
                closeSource: 'USER_CHECKOUT'  // new field value
            },
            {
                userId: employeeId,
                date: '2026-01-09',
                checkInAt: new Date('2026-01-09T01:00:00.000Z'),
                checkOutAt: new Date('2026-01-09T10:30:00.000Z'),
                closeSource: 'ADMIN_FORCE'  // new field value
            }
        ]);

        const res = await request(app)
            .get(`/api/attendance/me?month=${month}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        const records = res.body.items ?? res.body.attendance ?? [];

        const dates = ['2026-01-07', '2026-01-08', '2026-01-09'];
        for (const d of dates) {
            const rec = records.find(r => r.date === d);
            expect(rec, `Expected record for ${d}`).toBeDefined();
            expect(rec.status).toBeTruthy();
        }
    });
});

// ============================================================================
// LEGACY WRITE: New checkout sets closeSource = 'USER_CHECKOUT'
// ============================================================================

describe('New write flows set closeSource correctly', () => {
    /**
     * LG-WRITE-001
     * EP: A normal user checkout via POST /api/attendance/check-out must set
     *     closeSource = 'USER_CHECKOUT' on the attendance record.
     */
    it('[LG-WRITE-001] user checkout sets closeSource = USER_CHECKOUT', async () => {
        // Insert open session for today
        const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        await Attendance.create({
            userId: employeeId,
            date: todayKey,
            checkInAt: new Date()
        });

        const res = await request(app)
            .post('/api/attendance/check-out')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);

        const updated = await Attendance.findOne({ userId: employeeId, date: todayKey }).lean();
        expect(updated).toBeDefined();
        expect(updated.closeSource).toBe('USER_CHECKOUT');
        expect(updated.checkOutAt).toBeTruthy();
        expect(updated.needsReconciliation).toBe(false);
    });
});

// ============================================================================
// LEGACY MIX: Admin force-checkout in new code sets ADMIN_FORCE
// ============================================================================

describe('Admin force-checkout sets closeSource = ADMIN_FORCE', () => {
    let adminToken;

    beforeAll(async () => {
        const passwordHash = await bcrypt.hash('AdminPass1', 10);
        await User.create({
            employeeCode: 'ADM001',
            name: 'Admin User',
            email: 'admin_legacy@test.com',
            username: 'admin_legacy',
            passwordHash,
            role: 'ADMIN',
            isActive: true,
            startDate: new Date('2024-01-01')
        });
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ identifier: 'admin_legacy@test.com', password: 'AdminPass1' });
        adminToken = loginRes.body.token;
    });

    afterAll(async () => {
        await User.deleteOne({ email: 'admin_legacy@test.com' });
    });

    /**
     * LG-WRITE-002
     * EP: Admin force-checkout on new code must set closeSource = 'ADMIN_FORCE'.
     */
    it('[LG-WRITE-002] admin force-checkout sets closeSource = ADMIN_FORCE', async () => {
        const checkInAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
        const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        const att = await Attendance.create({
            userId: employeeId,
            date: todayKey,
            checkInAt
        });

        const res = await request(app)
            .post(`/api/admin/attendance/${att._id}/force-checkout`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ checkOutAt: new Date().toISOString() });

        expect(res.status).toBe(200);

        const updated = await Attendance.findById(att._id).lean();
        expect(updated.closeSource).toBe('ADMIN_FORCE');
        expect(updated.checkOutAt).toBeTruthy();
    });
});

// ============================================================================
// LEGACY MIX: Open-session endpoint handles legacy null closeSource
// ============================================================================

describe('open-session endpoint handles legacy records', () => {
    /**
     * LG-MIX-001
     * EP: GET /api/attendance/open-session must not crash when attendance records
     *     have closeSource = null (legacy format).
     */
    it('[LG-MIX-001] open-session works when legacy null-closeSource record exists', async () => {
        // Insert a legacy closed record (closeSource=null, not open)
        const pastDate = daysAgoKey(5);
        await Attendance.create({
            userId: employeeId,
            date: pastDate,
            checkInAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            checkOutAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
            closeSource: null,
            needsReconciliation: false
        });

        const res = await request(app)
            .get('/api/attendance/open-session')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        // No open session (the legacy one is closed)
        expect(res.body.openSession).toBeNull();
        // Legacy closed record with needsReconciliation=false should NOT appear in needsReconciliation list
        expect(res.body.needsReconciliation).toEqual([]);
    });
});
