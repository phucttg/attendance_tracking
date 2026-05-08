/**
 * Leave Request Feature (C1) - Comprehensive Test Suite
 * 
 * Test Design Techniques Applied (ISTQB Framework):
 * - Equivalence Partitioning: Valid/invalid leave types, date ranges
 * - Boundary Value Analysis: Max 30 days, edge dates, overlap boundaries
 * - Decision Table Testing: LEAVE vs ADJUST_TIME routing, approval logic
 * - State Transition Testing: Request status transitions (PENDING → APPROVED/REJECTED)
 * - Error Guessing: Invalid dates, missing fields, type mismatches
 * 
 * ISO 25010 Quality Characteristics:
 * - Functional Suitability: LEAVE CRUD operations
 * - Security: RBAC enforcement, userId validation
 * - Reliability: Race condition handling, overlap prevention
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Request from '../src/models/Request.js';
import Attendance from '../src/models/Attendance.js';
import Holiday from '../src/models/Holiday.js';
import bcrypt from 'bcrypt';

// ============================================
// Test Setup
// ============================================

let adminToken, managerToken, employeeToken;
let teamId, employeeId, managerId;
const FIXED_TIME = new Date('2026-02-10T03:00:00.000Z');

beforeAll(async () => {
    vi.setSystemTime(FIXED_TIME);

    // Clean up
    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await Holiday.deleteMany({});

    // Create team
    const team = await Team.create({ name: 'Leave Test Team' });
    teamId = team._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    // Admin
    await User.create({
        employeeCode: 'LV001',
        name: 'Leave Admin',
        email: 'leaveadmin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    // Manager with team
    const manager = await User.create({
        employeeCode: 'LV002',
        name: 'Leave Manager',
        email: 'leavemanager@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId,
        isActive: true
    });
    managerId = manager._id;

    // Employee in team
    const employee = await User.create({
        employeeCode: 'LV003',
        name: 'Leave Employee',
        email: 'leaveemployee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });
    employeeId = employee._id;

    // Get tokens
    const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'leaveadmin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const managerRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'leavemanager@test.com', password: 'Password123' });
    managerToken = managerRes.body.token;

    const employeeRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'leaveemployee@test.com', password: 'Password123' });
    employeeToken = employeeRes.body.token;
});

afterAll(async () => {
    vi.useRealTimers();

    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});
    await Attendance.deleteMany({});
    await Holiday.deleteMany({});
});

// ============================================
// CREATE LEAVE REQUEST - Happy Path
// ============================================
describe('POST /api/requests - LEAVE Type - Happy Path', () => {
    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
        await Holiday.deleteMany({});
    });

    it('should create LEAVE request with all fields', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-02-03',
                leaveType: 'ANNUAL',
                reason: 'Vacation trip'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.type).toBe('LEAVE');
        expect(res.body.request.leaveStartDate).toBe('2026-02-01');
        expect(res.body.request.leaveEndDate).toBe('2026-02-03');
        expect(res.body.request.leaveType).toBe('ANNUAL');
        expect(res.body.request.status).toBe('PENDING');
        expect(res.body.request.leaveDaysCount).toBeGreaterThan(0);
    });

    it('should create single-day leave request (startDate === endDate)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-16', // Monday
                leaveEndDate: '2026-02-16',
                leaveType: 'SICK',
                reason: 'Personal health'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.leaveDaysCount).toBe(1);
    });

    it('should create leave without leaveType (optional field)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-20',
                leaveEndDate: '2026-02-20',
                reason: 'Personal matter'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.leaveType).toBeNull();
    });

    it('should correctly count workdays (exclude weekends)', async () => {
        // Feb 9-13, 2026: Mon-Fri = 5 workdays
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-09',
                leaveEndDate: '2026-02-13',
                leaveType: 'ANNUAL',
                reason: 'Week off'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.leaveDaysCount).toBe(5);
    });

    it('should correctly count workdays (exclude holidays)', async () => {
        // Create holiday on Feb 10
        await Holiday.create({ date: '2026-02-10', name: 'Test Holiday' });

        // Feb 9-13, 2026: 5 calendar days - 1 holiday = 4 workdays
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-09',
                leaveEndDate: '2026-02-13',
                leaveType: 'ANNUAL',
                reason: 'Week with holiday'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.leaveDaysCount).toBe(4);
    });

    it('should allow ADMIN to create leave request', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-03-01',
                leaveEndDate: '2026-03-02',
                leaveType: 'ANNUAL',
                reason: 'Admin leave'
            });

        expect(res.status).toBe(201);
    });

    it('should allow MANAGER to create leave request', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-03-05',
                leaveEndDate: '2026-03-06',
                leaveType: 'SICK',
                reason: 'Manager sick day'
            });

        expect(res.status).toBe(201);
    });
});

// ============================================
// CREATE LEAVE REQUEST - Validation Errors
// ============================================
describe('POST /api/requests - LEAVE Type - Validation Errors', () => {
    afterEach(async () => {
        await Request.deleteMany({});
    });

    it('should reject if leaveStartDate > leaveEndDate', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-10',
                leaveEndDate: '2026-02-05',
                leaveType: 'ANNUAL',
                reason: 'Invalid range'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/before or equal/i);
    });

    it('should reject if range exceeds 30 days (boundary: 31 days)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-03-03', // 31 days
                leaveType: 'UNPAID',
                reason: 'Too long'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/30 days/i);
    });

    it('should accept exactly 30 days (boundary: pass)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-03-02', // 30 days exactly
                leaveType: 'UNPAID',
                reason: 'Max leave'
            });

        expect(res.status).toBe(201);
    });

    it('should reject missing leaveStartDate', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveEndDate: '2026-02-10',
                leaveType: 'ANNUAL',
                reason: 'Missing start date'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/leaveStartDate/i);
    });

    it('should reject missing leaveEndDate', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveType: 'ANNUAL',
                reason: 'Missing end date'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/leaveEndDate/i);
    });

    it('should reject missing reason', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-02-03',
                leaveType: 'ANNUAL'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/reason/i);
    });

    it('should reject empty reason', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-02-03',
                leaveType: 'ANNUAL',
                reason: '   '
            });

        expect(res.status).toBe(400);
    });

    it('should reject reason exceeding 1000 characters', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-02-03',
                leaveType: 'ANNUAL',
                reason: 'x'.repeat(1001)
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/1000|characters/i);
    });

    it('should reject invalid leaveType', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-01',
                leaveEndDate: '2026-02-03',
                leaveType: 'INVALID_TYPE',
                reason: 'Testing invalid type'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/ANNUAL|SICK|UNPAID/i);
    });

    it('should reject invalid date format (not YYYY-MM-DD)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '01-02-2026',
                leaveEndDate: '03-02-2026',
                leaveType: 'ANNUAL',
                reason: 'Wrong date format'
            });

        expect(res.status).toBe(400);
    });
});

// ============================================
// CREATE LEAVE REQUEST - Conflict Detection
// ============================================
describe('POST /api/requests - LEAVE Type - Conflict Detection', () => {
    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should reject if attendance exists for ANY date in range', async () => {
        // Create attendance for Feb 10
        await Attendance.create({
            userId: employeeId,
            date: '2026-02-10',
            checkInAt: new Date('2026-02-10T08:30:00+07:00')
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-09',
                leaveEndDate: '2026-02-11',
                leaveType: 'ANNUAL',
                reason: 'Has attendance conflict'
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/checked in|attendance/i);
        expect(res.body.message).toContain('2026-02-10');
    });

    it('should reject overlap with existing APPROVED leave', async () => {
        // Create approved leave Feb 5-10
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-02-05',
            leaveEndDate: '2026-02-10',
            leaveType: 'ANNUAL',
            leaveDaysCount: 4,
            reason: 'Existing approved',
            status: 'APPROVED'
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-08',
                leaveEndDate: '2026-02-12',
                leaveType: 'SICK',
                reason: 'Overlaps approved'
            });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/overlap/i);
        expect(res.body.message).toMatch(/approved/i);
    });

    it('should reject overlap with existing PENDING leave', async () => {
        // Create pending leave Feb 15-20
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-02-15',
            leaveEndDate: '2026-02-20',
            leaveType: 'ANNUAL',
            leaveDaysCount: 4,
            reason: 'Existing pending',
            status: 'PENDING'
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-18',
                leaveEndDate: '2026-02-22',
                leaveType: 'ANNUAL',
                reason: 'Overlaps pending'
            });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/overlap/i);
        expect(res.body.message).toMatch(/pending/i);
    });

    it('should allow leave after existing REJECTED leave', async () => {
        // Create rejected leave Feb 25-27
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-02-25',
            leaveEndDate: '2026-02-27',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Rejected leave',
            status: 'REJECTED'
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-25',
                leaveEndDate: '2026-02-27',
                leaveType: 'SICK',
                reason: 'New leave after rejection'
            });

        expect(res.status).toBe(201);
    });

    it('should detect overlap: new range CONTAINS existing range', async () => {
        // Existing: Feb 10-12
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-03-10',
            leaveEndDate: '2026-03-12',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Small leave',
            status: 'APPROVED'
        });

        // New: Feb 8-15 (contains existing)
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-03-08',
                leaveEndDate: '2026-03-15',
                leaveType: 'ANNUAL',
                reason: 'Big leave containing small'
            });

        expect(res.status).toBe(409);
    });

    it('should detect overlap: new range IS CONTAINED by existing range', async () => {
        // Existing: Feb 1-15
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-04-01',
            leaveEndDate: '2026-04-15',
            leaveType: 'ANNUAL',
            leaveDaysCount: 11,
            reason: 'Big leave',
            status: 'PENDING'
        });

        // New: Feb 8-10 (inside existing)
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-04-08',
                leaveEndDate: '2026-04-10',
                leaveType: 'SICK',
                reason: 'Small leave inside big'
            });

        expect(res.status).toBe(409);
    });

    it('should detect overlap: new ends on existing start (edge)', async () => {
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-05-10',
            leaveEndDate: '2026-05-15',
            leaveType: 'ANNUAL',
            leaveDaysCount: 4,
            reason: 'Existing',
            status: 'APPROVED'
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-05-05',
                leaveEndDate: '2026-05-10', // Ends on existing start
                leaveType: 'ANNUAL',
                reason: 'Edge overlap end'
            });

        expect(res.status).toBe(409);
    });

    it('should detect overlap: new starts on existing end (edge)', async () => {
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-06-01',
            leaveEndDate: '2026-06-05',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Existing',
            status: 'APPROVED'
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-06-05', // Starts on existing end
                leaveEndDate: '2026-06-10',
                leaveType: 'ANNUAL',
                reason: 'Edge overlap start'
            });

        expect(res.status).toBe(409);
    });

    it('should allow adjacent leaves (no overlap)', async () => {
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-07-01',
            leaveEndDate: '2026-07-05',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'First leave',
            status: 'APPROVED'
        });

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-07-06', // Day after existing ends
                leaveEndDate: '2026-07-10',
                leaveType: 'ANNUAL',
                reason: 'Adjacent leave (no overlap)'
            });

        expect(res.status).toBe(201);
    });
});

// ============================================
// APPROVE LEAVE REQUEST
// ============================================
describe('POST /api/requests/:id/approve - LEAVE Type', () => {
    let pendingLeaveId;

    beforeEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});

        // Create pending leave request
        const leaveReq = await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-08-01',
            leaveEndDate: '2026-08-05',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Test leave for approval',
            status: 'PENDING'
        });
        pendingLeaveId = leaveReq._id;
    });

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should approve LEAVE request successfully', async () => {
        const res = await request(app)
            .post(`/api/requests/${pendingLeaveId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('APPROVED');
        expect(res.body.request.approvedBy).toBeDefined();
        expect(res.body.request.approvedAt).toBeDefined();
    });

    it('should NOT create attendance records when approving LEAVE', async () => {
        await request(app)
            .post(`/api/requests/${pendingLeaveId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Verify NO attendance was created for leave dates
        const attendance = await Attendance.findOne({
            userId: employeeId,
            date: { $in: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'] }
        });

        expect(attendance).toBeNull();
    });

    it('should allow manager to approve same-team employee leave', async () => {
        const res = await request(app)
            .post(`/api/requests/${pendingLeaveId}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('APPROVED');
    });

    it('should reject if already approved (409)', async () => {
        // First approve
        await request(app)
            .post(`/api/requests/${pendingLeaveId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Try approve again
        const res = await request(app)
            .post(`/api/requests/${pendingLeaveId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already approved/i);
    });
});

// ============================================
// REJECT LEAVE REQUEST
// ============================================
describe('POST /api/requests/:id/reject - LEAVE Type', () => {
    let pendingLeaveId;

    beforeEach(async () => {
        await Request.deleteMany({});

        const leaveReq = await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-09-01',
            leaveEndDate: '2026-09-03',
            leaveType: 'SICK',
            leaveDaysCount: 3,
            reason: 'Test leave for rejection',
            status: 'PENDING'
        });
        pendingLeaveId = leaveReq._id;
    });

    afterEach(async () => {
        await Request.deleteMany({});
    });

    it('should reject LEAVE request successfully', async () => {
        const res = await request(app)
            .post(`/api/requests/${pendingLeaveId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('REJECTED');
    });

    it('should reject if already rejected (409)', async () => {
        await request(app)
            .post(`/api/requests/${pendingLeaveId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        const res = await request(app)
            .post(`/api/requests/${pendingLeaveId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already rejected/i);
    });

    it('should reject if trying to reject an approved request (409)', async () => {
        await request(app)
            .post(`/api/requests/${pendingLeaveId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        const res = await request(app)
            .post(`/api/requests/${pendingLeaveId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
    });
});

// ============================================
// GET MY REQUESTS - LEAVE Visibility
// ============================================
describe('GET /api/requests/me - LEAVE Requests Visibility', () => {
    beforeAll(async () => {
        await Request.deleteMany({});

        // Create various request types
        await Request.create([
            {
                userId: employeeId,
                type: 'LEAVE',
                leaveStartDate: '2026-10-01',
                leaveEndDate: '2026-10-03',
                leaveType: 'ANNUAL',
                leaveDaysCount: 3,
                reason: 'Test LEAVE 1',
                status: 'PENDING'
            },
            {
                userId: employeeId,
                type: 'LEAVE',
                leaveStartDate: '2026-11-01',
                leaveEndDate: '2026-11-02',
                leaveType: 'SICK',
                leaveDaysCount: 2,
                reason: 'Test LEAVE 2',
                status: 'APPROVED'
            },
            {
                userId: employeeId,
                type: 'ADJUST_TIME',
                date: '2026-10-15',
                requestedCheckInAt: new Date('2026-10-15T08:30:00+07:00'),
                reason: 'Test ADJUST_TIME',
                status: 'PENDING'
            }
        ]);
    });

    afterAll(async () => {
        await Request.deleteMany({});
    });

    it('should return all types of requests including LEAVE', async () => {
        const res = await request(app)
            .get('/api/requests/me')
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items.length).toBe(3);

        const leaveRequests = res.body.items.filter(r => r.type === 'LEAVE');
        const adjustTimeRequests = res.body.items.filter(r => r.type === 'ADJUST_TIME');

        expect(leaveRequests.length).toBe(2);
        expect(adjustTimeRequests.length).toBe(1);
    });

    it('should include LEAVE-specific fields in response', async () => {
        const res = await request(app)
            .get('/api/requests/me')
            .set('Authorization', `Bearer ${employeeToken}`);

        const leaveRequest = res.body.items.find(r => r.type === 'LEAVE' && r.leaveType === 'ANNUAL');

        expect(leaveRequest.leaveStartDate).toBeDefined();
        expect(leaveRequest.leaveEndDate).toBeDefined();
        expect(leaveRequest.leaveType).toBeDefined();
        expect(leaveRequest.leaveDaysCount).toBeDefined();
    });
});

// ============================================
// GET PENDING REQUESTS - LEAVE for Managers
// ============================================
describe('GET /api/requests/pending - LEAVE Requests for Approval', () => {
    beforeAll(async () => {
        await Request.deleteMany({});

        // Create pending leave request
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-12-01',
            leaveEndDate: '2026-12-05',
            leaveType: 'ANNUAL',
            leaveDaysCount: 5,
            reason: 'Pending leave for manager view',
            status: 'PENDING'
        });
    });

    afterAll(async () => {
        await Request.deleteMany({});
    });

    it('should return LEAVE requests in pending list for manager', async () => {
        const res = await request(app)
            .get('/api/requests/pending')
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeGreaterThan(0);

        const leaveRequest = res.body.items.find(r => r.type === 'LEAVE');
        expect(leaveRequest).toBeDefined();
        expect(leaveRequest.leaveStartDate).toBe('2026-12-01');
        expect(leaveRequest.leaveEndDate).toBe('2026-12-05');
    });
});

// ============================================
// PHANTOM DATE - Invalid Calendar Dates for LEAVE
// ============================================
describe('LEAVE - Phantom Date (Invalid Calendar Dates)', () => {
    afterEach(async () => {
        await Request.deleteMany({});
    });

    it('should reject February 30 as leaveStartDate', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-02-30',
                leaveEndDate: '2026-03-02',
                leaveType: 'ANNUAL',
                reason: 'Phantom date test'
            });

        expect(res.status).toBe(400);
    });

    it('should reject February 29 on non-leap year', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2025-02-29', // 2025 is NOT leap year
                leaveEndDate: '2025-03-02',
                leaveType: 'ANNUAL',
                reason: 'Non-leap year test'
            });

        expect(res.status).toBe(400);
    });

    it('should accept February 29 on leap year (2024)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2024-02-28',
                leaveEndDate: '2024-02-29', // 2024 is leap year
                leaveType: 'ANNUAL',
                reason: 'Leap year test'
            });

        expect(res.status).toBe(201);
    });

    it('should reject month 13', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2026-13-01',
                leaveEndDate: '2026-13-05',
                leaveType: 'ANNUAL',
                reason: 'Invalid month test'
            });

        expect(res.status).toBe(400);
    });
});

// ============================================
// RACE CONDITION - Concurrent LEAVE Approvals
// ============================================
describe('LEAVE - Race Condition (Concurrent Approve)', () => {
    let leaveRequestId;

    beforeEach(async () => {
        await Request.deleteMany({});

        const leaveReq = await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2027-01-01',
            leaveEndDate: '2027-01-05',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Race condition test leave',
            status: 'PENDING'
        });
        leaveRequestId = leaveReq._id;
    });

    afterEach(async () => {
        await Request.deleteMany({});
    });

    it('should handle concurrent approve calls (only one succeeds)', async () => {
        const [res1, res2] = await Promise.all([
            request(app)
                .post(`/api/requests/${leaveRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${leaveRequestId}/approve`)
                .set('Authorization', `Bearer ${managerToken}`)
        ]);

        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toContain(200);
        expect(statuses).toContain(409);
    });

    it('should not return 500 on race condition', async () => {
        const results = await Promise.all([
            request(app)
                .post(`/api/requests/${leaveRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${leaveRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${leaveRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`)
        ]);

        results.forEach(res => {
            expect(res.status).not.toBe(500);
        });

        const successCount = results.filter(r => r.status === 200).length;
        expect(successCount).toBe(1);
    });
});

// ============================================
// TYPE ROUTING - LEAVE vs ADJUST_TIME
// ============================================
describe('Request Type Routing - LEAVE vs ADJUST_TIME', () => {
    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should route to LEAVE creation when type=LEAVE', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'LEAVE',
                leaveStartDate: '2027-02-01',
                leaveEndDate: '2027-02-03',
                leaveType: 'ANNUAL',
                reason: 'LEAVE routing test'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.type).toBe('LEAVE');
        expect(res.body.request.date).toBeNull(); // LEAVE doesn't use date field
    });

    it('should route to ADJUST_TIME when type is missing (default)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-02-10',
                requestedCheckInAt: '2026-02-10T08:30:00+07:00',
                reason: 'Default routing test'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.type).toBe('ADJUST_TIME');
    });

    it('should route to ADJUST_TIME when type=ADJUST_TIME', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'ADJUST_TIME',
                date: '2026-02-09',
                requestedCheckInAt: '2026-02-09T08:30:00+07:00',
                reason: 'Explicit ADJUST_TIME test'
            });

        expect(res.status).toBe(201);
        expect(res.body.request.type).toBe('ADJUST_TIME');
    });

    it('should reject invalid type', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                type: 'INVALID_TYPE',
                date: '2027-02-12',
                reason: 'Invalid type test'
            });

        expect(res.status).toBe(400);
    });
});

// ============================================
// SECURITY - Authentication & Authorization
// ============================================
describe('LEAVE - Security (Auth & RBAC)', () => {
    afterEach(async () => {
        await Request.deleteMany({});
    });

    it('should reject unauthenticated request', async () => {
        const res = await request(app)
            .post('/api/requests')
            .send({
                type: 'LEAVE',
                leaveStartDate: '2027-03-01',
                leaveEndDate: '2027-03-03',
                leaveType: 'ANNUAL',
                reason: 'No auth test'
            });

        expect(res.status).toBe(401);
    });

    it('should reject if manager tries to approve different-team leave', async () => {
        // Create different team and employee
        const otherTeam = await Team.create({ name: 'Other Team' });
        const otherEmployee = await User.create({
            employeeCode: 'LV999',
            name: 'Other Employee',
            email: 'other@test.com',
            passwordHash: await bcrypt.hash('Password123', 10),
            role: 'EMPLOYEE',
            teamId: otherTeam._id,
            isActive: true
        });

        const leaveReq = await Request.create({
            userId: otherEmployee._id,
            type: 'LEAVE',
            leaveStartDate: '2027-04-01',
            leaveEndDate: '2027-04-03',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Other team leave',
            status: 'PENDING'
        });

        // Manager from 'Leave Test Team' tries to approve
        const res = await request(app)
            .post(`/api/requests/${leaveReq._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(403);

        // Cleanup
        await User.deleteOne({ _id: otherEmployee._id });
        await Team.deleteOne({ _id: otherTeam._id });
        await Request.deleteOne({ _id: leaveReq._id });
    });

    it('should allow admin to approve any team leave', async () => {
        const leaveReq = await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2027-05-01',
            leaveEndDate: '2027-05-03',
            leaveType: 'SICK',
            leaveDaysCount: 3,
            reason: 'Admin approval test',
            status: 'PENDING'
        });

        const res = await request(app)
            .post(`/api/requests/${leaveReq._id}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('APPROVED');
    });
});
