/**
 * Test Suite: Admin Force-Checkout Endpoint (Step 7)
 * 
 * POST /api/admin/attendance/:id/force-checkout
 * 
 * Tests cover:
 * - Happy path (valid force checkout)
 * - 8 validation rules
 * - RBAC (ADMIN only)
 * - Not found scenarios
 * - Auth requirements
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import bcrypt from 'bcrypt';

let adminToken, managerToken, employeeToken;
let attendanceId;
let teamId, employeeId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});

    const team = await Team.create({ name: 'Test Team' });
    teamId = team._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    // Admin
    const admin = await User.create({
        employeeCode: 'ADM001',
        name: 'Test Admin',
        email: 'admin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    // Manager
    const manager = await User.create({
        employeeCode: 'MGR001',
        name: 'Test Manager',
        email: 'manager@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId,
        isActive: true
    });

    // Employee
    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'Test Employee',
        email: 'employee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });
    employeeId = employee._id;

    // Get tokens
    const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'admin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const managerRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'manager@test.com', password: 'Password123' });
    managerToken = managerRes.body.token;

    const employeeRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'employee@test.com', password: 'Password123' });
    employeeToken = employeeRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
});

describe('POST /api/admin/attendance/:id/force-checkout', () => {

    describe('✅ Happy Path', () => {
        it('should force checkout with valid checkOutAt', async () => {
            // Create attendance with checkIn only
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30', // Friday
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            attendanceId = attendance._id;

            const res = await request(app)
                .post(`/api/admin/attendance/${attendanceId}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:30:00+07:00'
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Forced checkout successful');
            expect(res.body.attendance).toBeDefined();
            expect(res.body.attendance._id).toBe(attendanceId.toString());
            expect(res.body.attendance.checkOutAt).toBeDefined();

            // Verify in DB
            const updated = await Attendance.findById(attendanceId);
            expect(updated.checkOutAt).toBeDefined();
        });

        it('should return updated attendance with all fields', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-29', // Thursday
                checkInAt: new Date('2026-01-29T09:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-29T18:00:00+07:00'
                });

            expect(res.status).toBe(200);
            expect(res.body.attendance).toMatchObject({
                _id: attendance._id.toString(),
                userId: employeeId.toString(),
                date: '2026-01-29'
            });
            expect(res.body.attendance.checkInAt).toBeDefined();
            expect(res.body.attendance.checkOutAt).toBeDefined();
        });
    });

    describe('❌ Validation Errors (400)', () => {
        it('should reject invalid attendance ID format', async () => {
            const res = await request(app)
                .post('/api/admin/attendance/invalid-id/force-checkout')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Invalid attendance ID format');
        });

        it('should reject missing checkOutAt', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('checkOutAt is required');
        });

        it('should reject invalid checkOutAt date format', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: 'invalid-date'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Invalid checkOutAt date format');
        });

        it('should reject checkOutAt before checkInAt', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T07:00:00+07:00' // Before checkIn
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('checkOutAt must be after checkInAt');
        });

        it('should allow checkOutAt on different date (cross-midnight policy)', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T23:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-31T02:00:00+07:00' // Next day
                });

            // Cross-midnight is now ALLOWED (Policy A: true cross-midnight support)
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Forced checkout successful');
            expect(res.body.attendance.date).toBe('2026-01-30');
            expect(new Date(res.body.attendance.checkOutAt).toISOString()).toBe('2026-01-30T19:00:00.000Z'); // 02:00 GMT+7 = 19:00 UTC prev day
        });

        // Note: This test is skipped because Attendance schema requires checkInAt field
        // In real scenario, attendance records always have checkInAt when created
        it.skip('should reject if no checkInAt exists', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30'
                // No checkInAt
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Cannot force checkout: No check-in recorded');
        });

        it('should reject if already checked out', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00'),
                checkOutAt: new Date('2026-01-30T17:00:00+07:00') // Already has checkOut
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T18:00:00+07:00'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Already checked out');
        });
    });

    describe('🔒 RBAC', () => {
        it('should reject EMPLOYEE role', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(403);
        });

        it('should reject MANAGER role', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${managerToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(403);
        });

        it('should allow ADMIN role', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(200);
        });
    });

    describe('🚫 Not Found (404)', () => {
        it('should return 404 for non-existent attendance ID', async () => {
            const fakeId = new mongoose.Types.ObjectId();

            const res = await request(app)
                .post(`/api/admin/attendance/${fakeId}/force-checkout`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(404);
            expect(res.body.message).toBe('Attendance record not found');
        });
    });

    describe('🔐 Auth', () => {
        it('should require authentication token', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(401);
        });

        it('should reject invalid token', async () => {
            const attendance = await Attendance.create({
                userId: employeeId,
                date: '2026-01-30',
                checkInAt: new Date('2026-01-30T08:00:00+07:00')
            });

            const res = await request(app)
                .post(`/api/admin/attendance/${attendance._id}/force-checkout`)
                .set('Authorization', 'Bearer invalid.token.here')
                .send({
                    checkOutAt: '2026-01-30T17:00:00+07:00'
                });

            expect(res.status).toBe(401);
        });
    });
});
