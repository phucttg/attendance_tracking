/**
 * Test Step 5: createRequest 2-Rule Validation
 * Tests for cross-midnight OT feature validation rules:
 * - Rule 1: Session length (checkOut - checkIn ≤ CHECKOUT_GRACE_HOURS)
 * - Rule 2: Submission window (now - checkIn ≤ ADJUST_REQUEST_MAX_DAYS)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import bcrypt from 'bcrypt';

let employeeToken;
let employeeId;
const FIXED_TIME = new Date('2026-02-10T03:00:00.000Z');

beforeAll(async () => {
    vi.setSystemTime(FIXED_TIME);

    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    const team = await Team.create({ name: 'Test Team' });
    const passwordHash = await bcrypt.hash('Password123', 10);

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'Test Employee',
        email: 'employee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId: team._id,
        isActive: true
    });
    employeeId = employee._id;

    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'employee@test.com', password: 'Password123' });
    employeeToken = loginRes.body.token;
});

afterAll(async () => {
    vi.useRealTimers();

    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

describe('Step 5: createRequest 2-Rule Validation', () => {
    // Use specific weekday dates to avoid weekend validation failures
    // Current date: 2026-02-10 (Monday)
    // Safe dates within 7-day window:
    // 2026-02-04 = Wednesday (6 days ago)
    // 2026-02-05 = Thursday (5 days ago)
    // 2026-02-06 = Friday (4 days ago)
    const thursday = '2026-02-05';
    const friday = '2026-02-06';
    const saturday = '2026-02-07';

    describe('Rule 1: Session Length Validation', () => {
        it('should accept cross-midnight request within 24h grace period', async () => {
            // Create attendance: checked in Thursday 8 PM
            await Attendance.create({
                userId: employeeId,
                date: thursday,
                checkInAt: new Date(`${thursday}T20:00:00+07:00`)
            });

            // Request checkout for Friday 4 AM (8 hours later, within 24h)
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: thursday,
                    requestedCheckOutAt: `${friday}T04:00:00+07:00`,
                    reason: 'Cross-midnight OT work'
                });

            expect(res.status).toBe(201);
            expect(res.body.request.requestedCheckOutAt).toBeTruthy();
        });

        it('should reject request exceeding 24h session length', async () => {
            const threeDaysAgo = '2026-02-04'; // Monday

            // Create attendance: checked in 3 days ago
            await Attendance.create({
                userId: employeeId,
                date: threeDaysAgo,
                checkInAt: new Date(`${threeDaysAgo}T08:00:00+07:00`)
            });

            // Request checkout for Friday (72+ hours later)
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: threeDaysAgo,
                    requestedCheckOutAt: `${friday}T10:00:00+07:00`,
                    reason: 'Very long session'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('exceeds');
            expect(res.body.message).toContain('24');
        });

        it('should validate session length when both checkIn and checkOut provided', async () => {
            const twoDaysAgo = '2026-02-05'; // Tuesday

            // Both times provided, session > 24h
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: twoDaysAgo,
                    requestedCheckInAt: `${twoDaysAgo}T08:00:00+07:00`,
                    requestedCheckOutAt: `${friday}T10:00:00+07:00`, // 50 hours later
                    reason: 'Test session length'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('exceeds');
        });
    });

    describe('Rule 2: Submission Window Validation', () => {
        it('should reject request submitted >7 days after check-in', async () => {
            const eightDaysAgo = '2026-01-30'; // Wednesday 8 days ago

            // Create attendance: checked in 8 days ago
            await Attendance.create({
                userId: employeeId,
                date: eightDaysAgo,
                checkInAt: new Date(`${eightDaysAgo}T08:00:00+07:00`)
            });

            // Request checkout now (submitting 8 days after check-in)
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: eightDaysAgo,
                    requestedCheckOutAt: `${eightDaysAgo}T17:00:00+07:00`,
                    reason: 'Late submission'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('days');
            expect(res.body.message).toContain('check-in');
        });

        it('should accept request within 7-day submission window', async () => {
            // Test runs on 2026-02-01, so 6 days ago = 2026-02-04 (Monday)
            const sixDaysAgo = '2026-02-04';

            // Create attendance: checked in 6 days ago
            await Attendance.create({
                userId: employeeId,
                date: sixDaysAgo,
                checkInAt: new Date(`${sixDaysAgo}T08:00:00+07:00`)
            });

            // Request checkout (within 7 days from checkIn to now)
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: sixDaysAgo,
                    requestedCheckOutAt: `${sixDaysAgo}T17:00:00+07:00`,
                    reason: 'Within submission window'
                });

            expect(res.status).toBe(201);
        });
    });

    describe('Anchor Time Determination', () => {
        it('should use provided checkIn as anchor when both times provided', async () => {
            // Both checkIn and checkOut provided (within 24h grace)
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: thursday,
                    requestedCheckInAt: `${thursday}T20:00:00+07:00`,
                    requestedCheckOutAt: `${friday}T02:00:00+07:00`, // 6 hours later
                    reason: 'Cross-midnight with both times'
                });

            expect(res.status).toBe(201);
        });

        it('should use existing checkIn as anchor when only checkOut provided', async () => {
            // Create attendance with checkIn
            await Attendance.create({
                userId: employeeId,
                date: thursday,
                checkInAt: new Date(`${thursday}T20:00:00+07:00`)
            });

            // Only checkOut provided
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: thursday,
                    requestedCheckOutAt: `${friday}T02:00:00+07:00`,
                    reason: 'Only checkout provided'
                });

            expect(res.status).toBe(201);
        });

        it('should error when no anchor available (no checkIn)', async () => {
            // No existing attendance, only checkOut provided
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: thursday,
                    requestedCheckOutAt: `${friday}T02:00:00+07:00`,
                    reason: 'No anchor'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('check-in');
        });
    });
});
