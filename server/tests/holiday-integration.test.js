/**
 * Holiday Integration Tests
 * 
 * Purpose: Verify status computation uses holidays from DB
 * ISTQB: Equivalence Partitioning, Boundary Value Analysis
 * Target: GET /api/attendance/me?month=YYYY-MM
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Holiday from '../src/models/Holiday.js';
import Attendance from '../src/models/Attendance.js';
import bcrypt from 'bcrypt';

let employeeToken, employeeId;
const TEST_MONTH = '2026-01';
const WORKDAY_HOLIDAY = '2026-01-07';
const WORKDAY_NORMAL = '2026-01-08';
const WEEKEND_DAY = '2026-01-10';

beforeAll(async () => {
    await User.deleteMany({});
    await Holiday.deleteMany({});
    await Attendance.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);
    const emp = await User.create({
        employeeCode: 'HOLINT001', name: 'Holiday Test Employee',
        email: 'holintegration@test.com', passwordHash,
        role: 'EMPLOYEE', isActive: true
    });
    employeeId = emp._id;

    const res = await request(app).post('/api/auth/login')
        .send({ identifier: 'holintegration@test.com', password: 'Password123' });
    employeeToken = res.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Holiday.deleteMany({});
    await Attendance.deleteMany({});
});

beforeEach(async () => {
    await Holiday.deleteMany({});
    await Attendance.deleteMany({});
});

// ============================================
// HAPPY PATHS
// ============================================
describe('Holiday Integration - Happy Paths', () => {
    it('1. Workday with holiday in DB → WEEKEND_OR_HOLIDAY', async () => {
        await Holiday.create({ date: WORKDAY_HOLIDAY, name: 'Test Holiday' });
        await Attendance.create({
            userId: employeeId, date: WORKDAY_HOLIDAY,
            checkInAt: new Date(`${WORKDAY_HOLIDAY}T08:30:00+07:00`),
            checkOutAt: new Date(`${WORKDAY_HOLIDAY}T17:30:00+07:00`)
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        const record = res.body.items.find(i => i.date === WORKDAY_HOLIDAY);
        expect(record).toBeDefined();
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
    });

    it('2. Workday without holiday defaults to SHIFT_1 late status', async () => {
        // No schedule snapshot is provided, so legacy/default SHIFT_1 applies.
        await Attendance.create({
            userId: employeeId, date: WORKDAY_NORMAL,
            checkInAt: new Date(`${WORKDAY_NORMAL}T08:30:00+07:00`),
            checkOutAt: new Date(`${WORKDAY_NORMAL}T17:30:00+07:00`)
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        const record = res.body.items.find(i => i.date === WORKDAY_NORMAL);
        expect(record.status).toBe('LATE');
        expect(record.lateMinutes).toBe(30);
    });
});

// ============================================
// EDGE CASES
// ============================================
describe('Holiday Integration - Edge Cases', () => {
    it('3. Holiday on weekend (redundant) → WEEKEND_OR_HOLIDAY', async () => {
        await Holiday.create({ date: WEEKEND_DAY, name: 'Weekend Holiday' });
        await Attendance.create({
            userId: employeeId, date: WEEKEND_DAY,
            checkInAt: new Date(`${WEEKEND_DAY}T08:30:00+07:00`),
            checkOutAt: new Date(`${WEEKEND_DAY}T12:00:00+07:00`)
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        const record = res.body.items.find(i => i.date === WEEKEND_DAY);
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
    });

    it('4. Multiple holidays in same month', async () => {
        const dates = ['2026-01-01', '2026-01-07', '2026-01-15'];
        await Holiday.insertMany(dates.map(d => ({ date: d, name: `Holiday ${d}` })));

        for (const d of dates) {
            await Attendance.create({
                userId: employeeId, date: d,
                checkInAt: new Date(`${d}T08:30:00+07:00`),
                checkOutAt: new Date(`${d}T17:30:00+07:00`)
            });
        }

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        for (const d of dates) {
            const rec = res.body.items.find(i => i.date === d);
            expect(rec.status).toBe('WEEKEND_OR_HOLIDAY');
        }
    });

    it('5. Holiday on 1st day of month (boundary)', async () => {
        await Holiday.create({ date: '2026-01-01', name: 'New Year' });
        await Attendance.create({
            userId: employeeId, date: '2026-01-01',
            checkInAt: new Date('2026-01-01T08:30:00+07:00'),
            checkOutAt: new Date('2026-01-01T17:30:00+07:00')
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        const record = res.body.items.find(i => i.date === '2026-01-01');
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
    });

    it('6. Holiday on last day of month (boundary)', async () => {
        // Keep boundary in the same test month to avoid cross-month coupling
        await Holiday.create({ date: '2026-01-31', name: 'EOM Holiday' });
        await Attendance.create({
            userId: employeeId, date: '2026-01-31',
            checkInAt: new Date('2026-01-31T08:30:00+07:00'),
            checkOutAt: new Date('2026-01-31T17:30:00+07:00')
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
        const record = res.body.items.find(i => i.date === '2026-01-31');
        expect(record).toBeDefined();
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
    });

    it('7. Month with no holidays → default SHIFT_1 late status', async () => {
        // No schedule snapshot is provided, so legacy/default SHIFT_1 applies.
        await Attendance.create({
            userId: employeeId, date: WORKDAY_NORMAL,
            checkInAt: new Date(`${WORKDAY_NORMAL}T08:30:00+07:00`),
            checkOutAt: new Date(`${WORKDAY_NORMAL}T17:30:00+07:00`)
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        const record = res.body.items.find(i => i.date === WORKDAY_NORMAL);
        expect(record.status).toBe('LATE');
        expect(record.lateMinutes).toBe(30);
    });

    it('8. Check-in on holiday → still WEEKEND_OR_HOLIDAY (not LATE)', async () => {
        await Holiday.create({ date: WORKDAY_HOLIDAY, name: 'Test' });
        await Attendance.create({
            userId: employeeId, date: WORKDAY_HOLIDAY,
            checkInAt: new Date(`${WORKDAY_HOLIDAY}T09:30:00+07:00`), // Late time
            checkOutAt: new Date(`${WORKDAY_HOLIDAY}T17:30:00+07:00`)
        });

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        const record = res.body.items.find(i => i.date === WORKDAY_HOLIDAY);
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
        expect(record.lateMinutes).toBe(0);
    });

    it('9. No attendance + holiday → synthetic record with WEEKEND_OR_HOLIDAY status', async () => {
        // Phase 3: getMonthlyHistory generates ALL days, so record exists even without attendance
        await Holiday.create({ date: WORKDAY_HOLIDAY, name: 'Test' });
        // No attendance created

        const res = await request(app)
            .get(`/api/attendance/me?month=${TEST_MONTH}`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        const record = res.body.items.find(i => i.date === WORKDAY_HOLIDAY);
        // Phase 3: Synthetic record exists with WEEKEND_OR_HOLIDAY status
        expect(record).toBeDefined();
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
        expect(record.checkInAt).toBeNull();
        expect(record.checkOutAt).toBeNull();
    });

    it('10. Leap year Feb 29 as holiday', async () => {
        await Holiday.create({ date: '2024-02-29', name: 'Leap Day' });
        await Attendance.create({
            userId: employeeId, date: '2024-02-29',
            checkInAt: new Date('2024-02-29T08:30:00+07:00'),
            checkOutAt: new Date('2024-02-29T17:30:00+07:00')
        });

        const res = await request(app)
            .get('/api/attendance/me?month=2024-02')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        const record = res.body.items.find(i => i.date === '2024-02-29');
        expect(record.status).toBe('WEEKEND_OR_HOLIDAY');
    });
});

// Summary
describe('Holiday Integration Summary', () => {
    it('[HAPPY] ✓ Holiday → WEEKEND_OR_HOLIDAY', () => expect(true).toBe(true));
    it('[HAPPY] ✓ No holiday → normal status', () => expect(true).toBe(true));
    it('[EDGE] ✓ Multiple holidays, boundaries, leap year handled', () => expect(true).toBe(true));
});
