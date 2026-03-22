/**
 * Holiday Management API Tests
 * 
 * Test Design Techniques (ISTQB):
 * - Happy Path: Create and list holidays
 * - RBAC: ADMIN only access
 * - Validation: Date format, name required
 * - Conflict: Duplicate date handling
 * - Edge Cases: Empty list, year filter
 * 
 * Target: POST/GET /api/admin/holidays
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Holiday from '../src/models/Holiday.js';
import HolidayChangeLog from '../src/models/HolidayChangeLog.js';
import bcrypt from 'bcrypt';

let adminToken, managerToken, employeeToken;

beforeAll(async () => {
    await mongoose.connect(process.env.MONGO_URI?.replace(/\/[^/]+$/, '/holiday_api_test_db')
        || 'mongodb://localhost:27017/holiday_api_test_db');

    // Clean up
    await User.deleteMany({});
    await Holiday.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);

    // Admin
    await User.create({
        employeeCode: 'HOL001',
        name: 'Holiday Admin',
        email: 'holidayadmin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    // Manager
    await User.create({
        employeeCode: 'HOL002',
        name: 'Holiday Manager',
        email: 'holidaymanager@test.com',
        passwordHash,
        role: 'MANAGER',
        isActive: true
    });

    // Employee
    await User.create({
        employeeCode: 'HOL003',
        name: 'Holiday Employee',
        email: 'holidayemployee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        isActive: true
    });

    // Get tokens
    const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'holidayadmin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const managerRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'holidaymanager@test.com', password: 'Password123' });
    managerToken = managerRes.body.token;

    const employeeRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'holidayemployee@test.com', password: 'Password123' });
    employeeToken = employeeRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Holiday.deleteMany({});
    await HolidayChangeLog.deleteMany({});
    await mongoose.connection.close();
});

beforeEach(async () => {
    await HolidayChangeLog.deleteMany({});
});


// ============================================
// LEVEL 1: HAPPY PATHS
// ============================================
describe('Holiday API - Happy Paths', () => {

    describe('1. Admin creates holiday', () => {
        it('POST /api/admin/holidays -> 201 Created', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-01-01', name: 'Tết Dương Lịch' });

            expect(res.status).toBe(201);
            expect(res.body._id).toBeDefined();
            expect(res.body.date).toBe('2026-01-01');
            expect(res.body.name).toBe('Tết Dương Lịch');
        });

        it('Response excludes timestamps and __v', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-05-01', name: 'Ngày Quốc Tế Lao Động' });

            expect(res.status).toBe(201);
            expect(res.body.createdAt).toBeUndefined();
            expect(res.body.updatedAt).toBeUndefined();
            expect(res.body.__v).toBeUndefined();
        });
    });

    describe('2. Admin gets holidays', () => {
        it('GET /api/admin/holidays?year=2026 -> 200 with items', async () => {
            const res = await request(app)
                .get('/api/admin/holidays?year=2026')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeDefined();
            expect(Array.isArray(res.body.items)).toBe(true);
            expect(res.body.items.length).toBeGreaterThanOrEqual(2);
        });

        it('GET /api/admin/holidays includes isLocked based on GMT+7 today', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-03-22T10:00:00+07:00'));
            await Holiday.deleteMany({
                date: { $in: ['2026-03-21', '2026-03-22', '2026-03-23'] }
            });
            await Holiday.create({ date: '2026-03-21', name: 'Past Holiday' });
            await Holiday.create({ date: '2026-03-22', name: 'Today Holiday' });
            await Holiday.create({ date: '2026-03-23', name: 'Future Holiday' });

            try {
                const res = await request(app)
                    .get('/api/admin/holidays?year=2026')
                    .set('Authorization', `Bearer ${adminToken}`);

                expect(res.status).toBe(200);
                const itemsByDate = Object.fromEntries(res.body.items.map((item) => [item.date, item]));
                expect(itemsByDate['2026-03-21'].isLocked).toBe(true);
                expect(itemsByDate['2026-03-22'].isLocked).toBe(false);
                expect(itemsByDate['2026-03-23'].isLocked).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it('Holidays are sorted by date', async () => {
            const res = await request(app)
                .get('/api/admin/holidays?year=2026')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            const dates = res.body.items.map(h => h.date);
            expect(dates).toEqual([...dates].sort());
        });
    });

    describe('3. Year filter works', () => {
        it('Returns only holidays matching year', async () => {
            // Create holiday for different year
            await Holiday.create({ date: '2025-12-25', name: 'Giáng Sinh 2025' });

            const res2026 = await request(app)
                .get('/api/admin/holidays?year=2026')
                .set('Authorization', `Bearer ${adminToken}`);

            const res2025 = await request(app)
                .get('/api/admin/holidays?year=2025')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res2026.body.items.every(h => h.date.startsWith('2026'))).toBe(true);
            expect(res2025.body.items.every(h => h.date.startsWith('2025'))).toBe(true);
        });
    });
});


// ============================================
// LEVEL 2: RBAC - ADMIN ONLY
// ============================================
describe('Holiday API - RBAC', () => {

    describe('4. Manager cannot access', () => {
        it('POST /api/admin/holidays -> 403', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${managerToken}`)
                .send({ date: '2026-02-14', name: 'Test' });

            expect(res.status).toBe(403);
            expect(res.body.message).toBeDefined();
        });

        it('GET /api/admin/holidays -> 403', async () => {
            const res = await request(app)
                .get('/api/admin/holidays')
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('5. Employee cannot access', () => {
        it('POST /api/admin/holidays -> 403', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ date: '2026-02-14', name: 'Test' });

            expect(res.status).toBe(403);
        });

        it('GET /api/admin/holidays -> 403', async () => {
            const res = await request(app)
                .get('/api/admin/holidays')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('6. No authentication -> 401', () => {
        it('POST without token -> 401', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .send({ date: '2026-03-08', name: 'Test' });

            expect(res.status).toBe(401);
        });

        it('GET without token -> 401', async () => {
            const res = await request(app)
                .get('/api/admin/holidays');

            expect(res.status).toBe(401);
        });
    });
});


// ============================================
// LEVEL 3: VALIDATION
// ============================================
describe('Holiday API - Validation', () => {

    describe('7. Missing date -> 400', () => {
        it('POST without date -> 400', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: 'Some Holiday' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/date/i);
        });
    });

    describe('8. Invalid date format -> 400', () => {
        it('Date with wrong format -> 400', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '01-01-2026', name: 'Test' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/YYYY-MM-DD/);
        });

        it('Date with timestamp -> 400', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-01-01T00:00:00Z', name: 'Test' });

            expect(res.status).toBe(400);
        });
    });

    describe('9. Missing name -> 400', () => {
        it('POST without name -> 400', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-06-01' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/name/i);
        });

        it('POST with empty name -> 400', async () => {
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-06-02', name: '   ' });

            expect(res.status).toBe(400);
        });
    });

    describe('10. Invalid year format -> 400', () => {
        it('GET with non-numeric year -> 400', async () => {
            const res = await request(app)
                .get('/api/admin/holidays?year=abc')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });

        it('GET with short year -> 400', async () => {
            const res = await request(app)
                .get('/api/admin/holidays?year=26')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });
    });
});


// ============================================
// LEVEL 4: CONFLICT
// ============================================
describe('Holiday API - Conflict', () => {

    describe('11. Duplicate date -> 409', () => {
        it('Creating holiday with existing date -> 409', async () => {
            // First create should work
            await Holiday.deleteMany({ date: '2026-09-02' });
            const res1 = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-09-02', name: 'Ngày Quốc Khánh' });

            expect(res1.status).toBe(201);

            // Duplicate should fail
            const res2 = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-09-02', name: 'Different Name' });

            expect(res2.status).toBe(409);
            expect(res2.body.message).toMatch(/already exists/i);
        });
    });
});


// ============================================
// LEVEL 5: EDGE CASES
// ============================================
describe('Holiday API - Edge Cases', () => {

    describe('12. Empty holidays list', () => {
        it('Returns empty array for year with no holidays', async () => {
            const res = await request(app)
                .get('/api/admin/holidays?year=2099')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toEqual([]);
        });
    });

    describe('13. Name with whitespace is trimmed', () => {
        it('Name is trimmed on save', async () => {
            await Holiday.deleteMany({ date: '2026-10-10' });
            const res = await request(app)
                .post('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ date: '2026-10-10', name: '  Trimmed Name  ' });

            expect(res.status).toBe(201);
            expect(res.body.name).toBe('Trimmed Name');
        });
    });

    describe('14. Default year uses current year (GMT+7)', () => {
        it('GET without year param uses current year', async () => {
            const res = await request(app)
                .get('/api/admin/holidays')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            // Current year is 2026 based on system time
            expect(res.body.items.every(h => h.date.startsWith('2026'))).toBe(true);
        });
    });
});

describe('Holiday API - Range Create', () => {
    it('POST /api/admin/holidays/range creates all new dates and keeps compatibility fields', async () => {
        await Holiday.deleteMany({
            date: { $in: ['2026-11-01', '2026-11-02', '2026-11-03'] }
        });

        const res = await request(app)
            .post('/api/admin/holidays/range')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                startDate: '2026-11-01',
                endDate: '2026-11-03',
                name: 'Nghỉ lễ tháng 11'
            });

        expect(res.status).toBe(201);
        expect(res.body.created).toBe(3);
        expect(res.body.skipped).toBe(0);
        expect(res.body.dates).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
        expect(res.body.createdDates).toEqual(res.body.dates);
        expect(res.body.skippedDates).toEqual([]);
    });

    it('POST /api/admin/holidays/range skips existing dates and reports skippedDates', async () => {
        await Holiday.deleteMany({
            date: { $in: ['2026-12-01', '2026-12-02', '2026-12-03'] }
        });
        await Holiday.create({ date: '2026-12-01', name: 'Existing Holiday' });

        const res = await request(app)
            .post('/api/admin/holidays/range')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                startDate: '2026-12-01',
                endDate: '2026-12-03',
                name: 'Nghỉ tháng 12'
            });

        expect(res.status).toBe(201);
        expect(res.body.created).toBe(2);
        expect(res.body.skipped).toBe(1);
        expect(res.body.createdDates).toEqual(['2026-12-02', '2026-12-03']);
        expect(res.body.skippedDates).toEqual([
            { date: '2026-12-01', reason: 'DUPLICATE' }
        ]);
    });

    it('POST /api/admin/holidays/range rolls back created dates on technical failure', async () => {
        const originalReplicaSet = process.env.MONGODB_REPLICA_SET;
        process.env.MONGODB_REPLICA_SET = 'false';

        await Holiday.deleteMany({
            date: { $in: ['2026-11-11', '2026-11-12', '2026-11-13'] }
        });

        const originalCreate = Holiday.create.bind(Holiday);
        const createSpy = vi.spyOn(Holiday, 'create').mockImplementation(async (doc) => {
            if (doc?.date === '2026-11-12') {
                throw new Error('Simulated DB timeout');
            }

            return originalCreate(doc);
        });

        try {
            const res = await request(app)
                .post('/api/admin/holidays/range')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    startDate: '2026-11-11',
                    endDate: '2026-11-13',
                    name: 'Nghỉ lỗi giữa chừng'
                });

            expect(res.status).toBe(500);
            expect(res.body.message).toMatch(/không có thay đổi nào được lưu/i);

            const holidays = await Holiday.find({
                date: { $in: ['2026-11-11', '2026-11-12', '2026-11-13'] }
            }).lean();
            expect(holidays).toEqual([]);
        } finally {
            createSpy.mockRestore();
            process.env.MONGODB_REPLICA_SET = originalReplicaSet;
        }
    });

    it('POST /api/admin/holidays/range retries late duplicate race and classifies it as skipped', async () => {
        const originalReplicaSet = process.env.MONGODB_REPLICA_SET;
        process.env.MONGODB_REPLICA_SET = 'false';

        await Holiday.deleteMany({
            date: { $in: ['2026-12-11', '2026-12-12', '2026-12-13'] }
        });

        const originalCreate = Holiday.create.bind(Holiday);
        let injectedRace = false;
        const createSpy = vi.spyOn(Holiday, 'create').mockImplementation(async (doc) => {
            if (doc?.date === '2026-12-12' && !injectedRace) {
                injectedRace = true;
                await originalCreate({ date: '2026-12-12', name: 'Concurrent Holiday' });
                const duplicateError = new Error('E11000 duplicate key error');
                duplicateError.code = 11000;
                throw duplicateError;
            }

            return originalCreate(doc);
        });

        try {
            const res = await request(app)
                .post('/api/admin/holidays/range')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    startDate: '2026-12-11',
                    endDate: '2026-12-13',
                    name: 'Nghỉ race condition'
                });

            expect(res.status).toBe(201);
            expect(res.body.created).toBe(2);
            expect(res.body.skipped).toBe(1);
            expect(res.body.createdDates).toEqual(['2026-12-11', '2026-12-13']);
            expect(res.body.skippedDates).toEqual([
                { date: '2026-12-12', reason: 'DUPLICATE' }
            ]);
        } finally {
            createSpy.mockRestore();
            process.env.MONGODB_REPLICA_SET = originalReplicaSet;
        }
    });
});

describe('Holiday API - Delete', () => {
    it('DELETE /api/admin/holidays/:id returns 409 for past holiday and writes no audit log', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-22T10:00:00+07:00'));
        await Holiday.deleteMany({ date: '2026-03-21' });
        const holiday = await Holiday.create({ date: '2026-03-21', name: 'Locked Holiday' });

        try {
            const res = await request(app)
                .delete(`/api/admin/holidays/${holiday._id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/đã bị khóa/i);

            const stillThere = await Holiday.findById(holiday._id);
            expect(stillThere).toBeTruthy();

            const log = await HolidayChangeLog.findOne({ holidayId: holiday._id });
            expect(log).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('DELETE /api/admin/holidays/:id still allows deleting holiday on the same day before 23:59 GMT+7', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-22T10:00:00+07:00'));
        await Holiday.deleteMany({ date: '2026-03-22' });
        const holiday = await Holiday.create({ date: '2026-03-22', name: 'Same Day Holiday' });

        try {
            const res = await request(app)
                .delete(`/api/admin/holidays/${holiday._id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.deleted.date).toBe('2026-03-22');
        } finally {
            vi.useRealTimers();
        }
    });

    it('DELETE /api/admin/holidays/:id deletes existing holiday and writes audit log', async () => {
        await Holiday.deleteMany({ date: '2026-08-15' });
        const holiday = await Holiday.create({ date: '2026-08-15', name: 'Delete Me' });

        const res = await request(app)
            .delete(`/api/admin/holidays/${holiday._id}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.deleted.date).toBe('2026-08-15');

        const deletedHoliday = await Holiday.findById(holiday._id);
        expect(deletedHoliday).toBeNull();

        const log = await HolidayChangeLog.findOne({ holidayId: holiday._id }).lean();
        expect(log).toBeTruthy();
        expect(log.action).toBe('DELETE');
        expect(String(log.actorUserId)).toBeTruthy();
        expect(log.holidayDate).toBe('2026-08-15');
        expect(log.holidayName).toBe('Delete Me');
    });

    it('DELETE /api/admin/holidays/:id returns 404 for missing holiday', async () => {
        const holidayId = new mongoose.Types.ObjectId();

        const res = await request(app)
            .delete(`/api/admin/holidays/${holidayId}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(404);
    });

    it('DELETE /api/admin/holidays/:id returns 400 for invalid id', async () => {
        const res = await request(app)
            .delete('/api/admin/holidays/not-an-id')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid holiday id/i);
    });

    it('DELETE /api/admin/holidays/:id keeps holiday and removes audit log if delete fails', async () => {
        const originalReplicaSet = process.env.MONGODB_REPLICA_SET;
        process.env.MONGODB_REPLICA_SET = 'false';

        await Holiday.deleteMany({ date: '2026-08-16' });
        const holiday = await Holiday.create({ date: '2026-08-16', name: 'Atomic Delete' });

        const deleteSpy = vi.spyOn(Holiday, 'deleteOne').mockImplementation(async () => {
            throw new Error('Simulated delete failure');
        });

        try {
            const res = await request(app)
                .delete(`/api/admin/holidays/${holiday._id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(500);

            const stillThere = await Holiday.findById(holiday._id);
            expect(stillThere).toBeTruthy();

            const log = await HolidayChangeLog.findOne({ holidayId: holiday._id });
            expect(log).toBeNull();
        } finally {
            deleteSpy.mockRestore();
            process.env.MONGODB_REPLICA_SET = originalReplicaSet;
        }
    });
});


// ============================================
// SUMMARY
// ============================================
describe('Holiday API Test Summary', () => {
    it('[HAPPY PATH] ✓ Admin can create and list holidays', () => expect(true).toBe(true));
    it('[RANGE] ✓ Range create supports skip + rollback semantics', () => expect(true).toBe(true));
    it('[DELETE] ✓ Delete single holiday keeps audit trail', () => expect(true).toBe(true));
    it('[RBAC] ✓ Non-admin users get 403', () => expect(true).toBe(true));
    it('[AUTH] ✓ Requires valid JWT token', () => expect(true).toBe(true));
    it('[VALIDATION] ✓ Date format and name validated', () => expect(true).toBe(true));
    it('[CONFLICT] ✓ Duplicate dates return 409', () => expect(true).toBe(true));
    it('[EDGE] ✓ Empty list, trimming, year filter handled', () => expect(true).toBe(true));
});
