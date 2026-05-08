/**
 * Test Bug #2 Fix: approveRequest must require anchorTime for ALL ADJUST_TIME requests
 * 
 * This test verifies that corrupt requests without valid check-in reference
 * cannot be approved (defense-in-depth validation)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Request from '../src/models/Request.js';
import Attendance from '../src/models/Attendance.js';
import bcrypt from 'bcrypt';
import { recentWeekday } from './testDateHelper.js';

let managerToken;
let employeeId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});
    await Attendance.deleteMany({});

    const team = await Team.create({ name: 'Test Team' });
    const passwordHash = await bcrypt.hash('Password123', 10);

    const manager = await User.create({
        employeeCode: 'MGR001',
        name: 'Test Manager',
        email: 'manager@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId: team._id,
        isActive: true
    });

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
        .send({ identifier: 'manager@test.com', password: 'Password123' });
    managerToken = loginRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});
    await Attendance.deleteMany({});
});

beforeEach(async () => {
    await Request.deleteMany({});
    await Attendance.deleteMany({});
});

describe('Bug #2 Fix: Require anchorTime for ALL ADJUST_TIME requests', () => {
    const weekday = recentWeekday(2);

    describe('Corrupt Request Scenarios (Missing Anchor)', () => {
        it('should reject corrupt checkIn-only request (missing requestedCheckInAt + no attendance)', async () => {
            // Create corrupt request directly in DB (bypass createRequest validation)
            const corruptRequest = await Request.create({
                userId: employeeId,
                date: weekday,
                type: 'ADJUST_TIME',
                requestedCheckInAt: null, // ❌ Corrupt: missing checkIn
                requestedCheckOutAt: null,
                reason: 'Corrupt checkIn-only request',
                status: 'PENDING'
            });

            // Attempt to approve (should fail - no anchor)
            const res = await request(app)
                .post(`/api/requests/${corruptRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('missing check-in reference');
        });

        it('should reject corrupt checkOut-only request (missing attendance checkIn)', async () => {
            // Create corrupt request with checkOut but no attendance
            const corruptRequest = await Request.create({
                userId: employeeId,
                date: weekday,
                type: 'ADJUST_TIME',
                requestedCheckInAt: null,
                requestedCheckOutAt: new Date(`${weekday}T17:00:00+07:00`), // checkOut only
                reason: 'Corrupt checkOut-only request',
                status: 'PENDING'
            });

            // No attendance record → anchorTime = null

            // Attempt to approve (should fail - no anchor)
            const res = await request(app)
                .post(`/api/requests/${corruptRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('missing check-in reference');
        });
    });

    describe('Valid Requests (Has Anchor)', () => {
        it('should approve checkIn-only request with valid requestedCheckInAt', async () => {
            // Valid request with checkIn
            const validRequest = await Request.create({
                userId: employeeId,
                date: weekday,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${weekday}T08:00:00+07:00`), // ✅ Has anchor
                requestedCheckOutAt: null,
                reason: 'Valid checkIn-only request',
                status: 'PENDING'
            });

            const res = await request(app)
                .post(`/api/requests/${validRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('APPROVED');
        });

        it('should approve checkOut-only request with existing attendance checkIn', async () => {
            // Create attendance with checkIn
            await Attendance.create({
                userId: employeeId,
                date: weekday,
                checkInAt: new Date(`${weekday}T08:00:00+07:00`) // ✅ Anchor in attendance
            });

            // Request checkOut only
            const validRequest = await Request.create({
                userId: employeeId,
                date: weekday,
                type: 'ADJUST_TIME',
                requestedCheckInAt: null,
                requestedCheckOutAt: new Date(`${weekday}T17:00:00+07:00`),
                reason: 'Valid checkOut-only request',
                status: 'PENDING'
            });

            const res = await request(app)
                .post(`/api/requests/${validRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('APPROVED');
        });

        it('should approve request with both checkIn and checkOut', async () => {
            const validRequest = await Request.create({
                userId: employeeId,
                date: weekday,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${weekday}T08:00:00+07:00`), // ✅ Anchor
                requestedCheckOutAt: new Date(`${weekday}T17:00:00+07:00`),
                reason: 'Valid both fields request',
                status: 'PENDING'
            });

            const res = await request(app)
                .post(`/api/requests/${validRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('APPROVED');
        });
    });

    describe('Rule 2 Now Runs for ALL Requests', () => {
        it('should reject checkIn-only request exceeding submission window', async () => {
            // Create old attendance (9 days ago - exceeds 7-day window)
            const oldDate = recentWeekday(10);

            const validRequest = await Request.create({
                userId: employeeId,
                date: oldDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${oldDate}T08:00:00+07:00`),
                requestedCheckOutAt: null,
                reason: 'Late checkIn-only request',
                status: 'PENDING',
                createdAt: new Date() // Created today (9 days after checkIn)
            });

            const res = await request(app)
                .post(`/api/requests/${validRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('submitted >');
            expect(res.body.message).toContain('after check-in');
        });

        it('should accept checkIn-only request within submission window', async () => {
            // Create recent request (5 days ago - within 7-day window)
            const recentDate = recentWeekday(3);

            const validRequest = await Request.create({
                userId: employeeId,
                date: recentDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${recentDate}T08:00:00+07:00`),
                requestedCheckOutAt: null,
                reason: 'Recent checkIn-only request',
                status: 'PENDING',
                createdAt: new Date() // Created today (within window)
            });

            const res = await request(app)
                .post(`/api/requests/${validRequest._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('APPROVED');
        });
    });
});
