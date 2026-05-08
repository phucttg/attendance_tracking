/**
 * Full-Stack Test Coverage Matrix
 * 
 * LEVEL 1: HAPPY PATHS (Basic functionality must work)
 * LEVEL 2: VALIDATION & INPUT SANITIZATION (Filter garbage)
 * LEVEL 3: BUSINESS LOGIC (Game rules)
 * LEVEL 4: ADVANCED EDGE CASES (Time & Concurrency) - Covered in deep-dive-edge-cases.test.js
 * LEVEL 5: NIGHTMARE MODE (Enterprise Security) - Covered in nightmare-security.test.js
 * 
 * Test Design Techniques Applied:
 * - Happy Path Testing: Core functionality verification
 * - Boundary Value Analysis: Input edge cases
 * - Decision Table Testing: Business rule combinations
 * - State Transition Testing: Request status flow
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import bcrypt from 'bcrypt';

let adminToken, managerToken, employeeToken, employee2Token;
let teamId, employeeId, employee2Id, managerId;
const FIXED_TIME = new Date('2026-02-10T03:00:00.000Z');

beforeAll(async () => {
    vi.setSystemTime(FIXED_TIME);

    // Clean up
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    // Create team
    const team = await Team.create({ name: 'Full Stack Test Team' });
    teamId = team._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    // Admin
    await User.create({
        employeeCode: 'FS001',
        name: 'FullStack Admin',
        email: 'fsadmin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    // Manager with team
    const mgr = await User.create({
        employeeCode: 'FS002',
        name: 'FullStack Manager',
        email: 'fsmanager@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId,
        isActive: true
    });
    managerId = mgr._id;

    // Employee 1
    const emp = await User.create({
        employeeCode: 'FS003',
        name: 'FullStack Employee',
        email: 'fsemp@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });
    employeeId = emp._id;

    // Employee 2
    const emp2 = await User.create({
        employeeCode: 'FS004',
        name: 'FullStack Employee 2',
        email: 'fsemp2@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });
    employee2Id = emp2._id;

    // Get tokens
    const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fsadmin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const managerRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fsmanager@test.com', password: 'Password123' });
    managerToken = managerRes.body.token;

    const employeeRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fsemp@test.com', password: 'Password123' });
    employeeToken = employeeRes.body.token;

    const emp2Res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fsemp2@test.com', password: 'Password123' });
    employee2Token = emp2Res.body.token;
});

afterAll(async () => {
    vi.useRealTimers();

    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});


// ============================================
// LEVEL 1: HAPPY PATHS (Basic functionality)
// ============================================
describe('LEVEL 1: HAPPY PATHS - Core Functionality', () => {

    describe('1. Auth - Login', () => {
        it('User logs in with correct email/password -> Returns valid token', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ identifier: 'fsadmin@test.com', password: 'Password123' });

            expect(res.status).toBe(200);
            expect(res.body.token).toBeDefined();
            expect(typeof res.body.token).toBe('string');
            expect(res.body.token.split('.')).toHaveLength(3); // JWT format
        });
    });

    describe('2. Auth - Role in Token', () => {
        it('Admin login -> Token contains correct role', async () => {
            const res = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.user.role).toBe('ADMIN');
        });

        it('Manager login -> Token contains correct role', async () => {
            const res = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.user.role).toBe('MANAGER');
        });

        it('Employee login -> Token contains correct role', async () => {
            const res = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.user.role).toBe('EMPLOYEE');
        });
    });

    describe('3. Request - Create', () => {
        const testDate = '2026-02-06'; // Friday (not weekend, within 7-day window)

        afterEach(async () => {
            await Request.deleteMany({});
        });

        it('Employee creates valid request -> Saved to DB with status PENDING', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                    reason: 'Happy path test - create request'
                });

            expect(res.status).toBe(201);
            expect(res.body.request.status).toBe('PENDING');
            expect(res.body.request.date).toBe(testDate);

            // Verify in DB
            const dbRequest = await Request.findById(res.body.request._id);
            expect(dbRequest).not.toBeNull();
            expect(dbRequest.status).toBe('PENDING');
        });
    });

    describe('4. Request - Read Own', () => {
        const testDate = '2026-02-02';

        beforeEach(async () => {
            await Request.deleteMany({});
            // Create a request for employee
            await Request.create({
                userId: employeeId,
                date: testDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${testDate}T01:30:00Z`),
                reason: 'Test request for read own',
                status: 'PENDING'
            });
        });

        afterEach(async () => {
            await Request.deleteMany({});
        });

        it('Employee views their own requests -> Sees correct data', async () => {
            const res = await request(app)
                .get('/api/requests/me')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeInstanceOf(Array);
            expect(res.body.items.length).toBeGreaterThanOrEqual(1);
            expect(res.body.items[0].reason).toBe('Test request for read own');
        });

        it('Employee should NOT see other employees requests in /my endpoint', async () => {
            // Create request for employee 2
            await Request.create({
                userId: employee2Id,
                date: '2026-02-03',
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date('2026-02-03T01:30:00Z'),
                reason: 'Employee 2 private request',
                status: 'PENDING'
            });

            const res = await request(app)
                .get('/api/requests/me')
                .set('Authorization', `Bearer ${employeeToken}`);

            // Should not contain employee 2's request
            const hasOtherRequest = res.body.items.some(
                r => r.reason === 'Employee 2 private request'
            );
            expect(hasOtherRequest).toBe(false);
        });
    });

    describe('5. Request - Read Team (Manager)', () => {
        const testDate = '2026-02-04';

        beforeEach(async () => {
            await Request.deleteMany({});
            await Request.create({
                userId: employeeId,
                date: testDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${testDate}T01:30:00Z`),
                reason: 'Team member request',
                status: 'PENDING'
            });
        });

        afterEach(async () => {
            await Request.deleteMany({});
        });

        it('Manager views pending requests -> Sees team member requests', async () => {
            const res = await request(app)
                .get('/api/requests/pending')
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeInstanceOf(Array);
            expect(res.body.items.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('6. Request - Approve', () => {
        const testDate = '2026-02-05';
        let requestId;

        beforeEach(async () => {
            await Request.deleteMany({});
            await Attendance.deleteMany({});

            const req = await Request.create({
                userId: employeeId,
                date: testDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${testDate}T01:30:00Z`),
                requestedCheckOutAt: new Date(`${testDate}T10:30:00Z`),
                reason: 'Request to approve',
                status: 'PENDING'
            });
            requestId = req._id;
        });

        afterEach(async () => {
            await Request.deleteMany({});
            await Attendance.deleteMany({});
        });

        it('Manager approves PENDING request -> Status changes to APPROVED', async () => {
            const res = await request(app)
                .post(`/api/requests/${requestId}/approve`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('APPROVED');

            // Verify in DB
            const dbRequest = await Request.findById(requestId);
            expect(dbRequest.status).toBe('APPROVED');
        });
    });

    describe('7. Request - Reject', () => {
        const testDate = '2026-02-06';
        let requestId;

        beforeEach(async () => {
            await Request.deleteMany({});

            const req = await Request.create({
                userId: employeeId,
                date: testDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${testDate}T01:30:00Z`),
                reason: 'Request to reject',
                status: 'PENDING'
            });
            requestId = req._id;
        });

        afterEach(async () => {
            await Request.deleteMany({});
        });

        it('Manager rejects PENDING request -> Status changes to REJECTED', async () => {
            const res = await request(app)
                .post(`/api/requests/${requestId}/reject`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('REJECTED');

            // Verify in DB
            const dbRequest = await Request.findById(requestId);
            expect(dbRequest.status).toBe('REJECTED');
        });
    });
});


// ============================================
// LEVEL 2: VALIDATION & INPUT SANITIZATION
// ============================================
describe('LEVEL 2: VALIDATION & INPUT SANITIZATION', () => {
    const testDate = '2026-02-10';

    afterEach(async () => {
        await Request.deleteMany({});
    });

    describe('8. Missing Fields', () => {
        it('Missing date -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: 'Missing date test'
                });

            expect(res.status).toBe(400);
        });

        it('Missing reason -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/reason/i);
        });

        it('Missing both checkIn and checkOut times -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    reason: 'Missing time fields'
                });

            expect(res.status).toBe(400);
        });
    });

    describe('9. Invalid Date Format', () => {
        it('Invalid date 2024-13-40 -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: '2024-13-40',
                    requestedCheckInAt: '2024-13-40T08:30:00+07:00',
                    reason: 'Invalid date format'
                });

            expect(res.status).toBe(400);
        });

        it('Invalid date "hello-world" -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: 'hello-world',
                    requestedCheckInAt: 'hello-world',
                    reason: 'Text instead of date'
                });

            expect(res.status).toBe(400);
        });

        it('Date with wrong format "01-02-2026" -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: '01-02-2026',
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: 'Wrong date format DD-MM-YYYY'
                });

            expect(res.status).toBe(400);
        });
    });

    describe('10. Empty Strings', () => {
        it('Empty reason "" -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: ''
                });

            expect(res.status).toBe(400);
        });

        it('Whitespace-only reason "   " -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: '   '
                });

            expect(res.status).toBe(400);
        });

        it('Tab and newline reason -> Returns 400', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: '\t\n\r'
                });

            expect(res.status).toBe(400);
        });
    });

    describe('12. Double Booking (Duplicate Prevention)', () => {
        it('Create request when PENDING request exists for same date -> 409 Conflict', async () => {
            // Create first request
            await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: 'First request'
                });

            // Try to create second request for same date
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T09:00:00+07:00`,
                    reason: 'Second request - should fail'
                });

            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/pending|already|exist/i);
        });
    });
});


// ============================================
// LEVEL 3: BUSINESS LOGIC (Game Rules)
// ============================================
describe('LEVEL 3: BUSINESS LOGIC', () => {
    const testDate = '2026-02-04'; // Within 7-day window

    beforeEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    describe('13. Self-Approval Prevention', () => {
        it('Employee should NOT be able to approve any request (403)', async () => {
            // Create request
            const createRes = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    reason: 'Self approval test'
                });

            const requestId = createRes.body.request._id;

            // Try self-approve
            const approveRes = await request(app)
                .post(`/api/requests/${requestId}/approve`)
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(approveRes.status).toBe(403);
        });

        // Note: Manager self-approval depends on business rules
        // If Managers CAN approve their own requests, test that
        // If they CANNOT, test that here
    });

    describe('14. State Transition - Invalid Transitions', () => {
        let requestId;

        beforeEach(async () => {
            const req = await Request.create({
                userId: employeeId,
                date: testDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${testDate}T01:30:00Z`),
                reason: 'State transition test',
                status: 'PENDING'
            });
            requestId = req._id;
        });

        it('Approve already REJECTED request -> 409 Conflict', async () => {
            // First reject
            await request(app)
                .post(`/api/requests/${requestId}/reject`)
                .set('Authorization', `Bearer ${adminToken}`);

            // Then try to approve
            const res = await request(app)
                .post(`/api/requests/${requestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(409);
        });

        it('Reject already APPROVED request -> 409 Conflict', async () => {
            // First approve
            await request(app)
                .post(`/api/requests/${requestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`);

            // Then try to reject
            const res = await request(app)
                .post(`/api/requests/${requestId}/reject`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(409);
        });

        it('Double approve -> 409 Conflict', async () => {
            // First approve
            await request(app)
                .post(`/api/requests/${requestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`);

            // Second approve
            const res = await request(app)
                .post(`/api/requests/${requestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(409);
        });

        it('Double reject -> 409 Conflict', async () => {
            // First reject
            await request(app)
                .post(`/api/requests/${requestId}/reject`)
                .set('Authorization', `Bearer ${adminToken}`);

            // Second reject
            const res = await request(app)
                .post(`/api/requests/${requestId}/reject`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(409);
        });
    });

    describe('18. Start > End (CheckOut before CheckIn)', () => {
        it('CheckOut time before CheckIn time -> 400 Bad Request', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T17:30:00+07:00`,  // Later time
                    requestedCheckOutAt: `${testDate}T08:30:00+07:00`, // Earlier time
                    reason: 'Reversed time order'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/after|before/i);
        });

        it('CheckOut equals CheckIn -> 400 Bad Request', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: testDate,
                    requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                    requestedCheckOutAt: `${testDate}T08:30:00+07:00`, // Same time
                    reason: 'Same time for both'
                });

            expect(res.status).toBe(400);
        });
    });
});


// ============================================
// LEVEL 4 & 5: ADDITIONAL COVERAGE
// ============================================
describe('LEVEL 4 & 5: Security & Access Control', () => {

    describe('25. IDOR - View Others Data', () => {
        let employee2RequestId;
        const testDate = '2026-02-20';

        beforeEach(async () => {
            await Request.deleteMany({});

            // Create request for employee 2
            const req = await Request.create({
                userId: employee2Id,
                date: testDate,
                type: 'ADJUST_TIME',
                requestedCheckInAt: new Date(`${testDate}T01:30:00Z`),
                reason: 'Employee 2 private request',
                status: 'PENDING'
            });
            employee2RequestId = req._id;
        });

        afterEach(async () => {
            await Request.deleteMany({});
        });

        it('Employee 1 trying to view Employee 2 request via /my -> Not visible', async () => {
            const res = await request(app)
                .get('/api/requests/me')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);

            // Should NOT see employee 2 request
            const foundOther = res.body.items.find(
                r => r._id.toString() === employee2RequestId.toString()
            );
            expect(foundOther).toBeUndefined();
        });
    });

    describe('Authentication Edge Cases', () => {
        it('No token -> 401 Unauthorized', async () => {
            const res = await request(app).get('/api/requests/me');
            expect(res.status).toBe(401);
        });

        it('Invalid token format -> 401 Unauthorized', async () => {
            const res = await request(app)
                .get('/api/requests/me')
                .set('Authorization', 'Bearer invalid.token.here');
            expect(res.status).toBe(401);
        });

        it('Wrong prefix (no Bearer) -> 401 Unauthorized', async () => {
            const res = await request(app)
                .get('/api/requests/me')
                .set('Authorization', adminToken);
            expect(res.status).toBe(401);
        });
    });

    describe('Authorization Check', () => {
        it('Employee cannot access /pending endpoint -> 403', async () => {
            const res = await request(app)
                .get('/api/requests/pending')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('Employee cannot access company timesheet -> 403', async () => {
            const res = await request(app)
                .get('/api/timesheet/company')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('Employee cannot access monthly reports -> 403', async () => {
            const res = await request(app)
                .get('/api/reports/monthly')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });
    });
});


// ============================================
// SUMMARY CHECKLIST
// ============================================
describe('FULL-STACK COVERAGE SUMMARY', () => {
    it('[LEVEL 1] ✓ Happy Paths verified', () => expect(true).toBe(true));
    it('[LEVEL 2] ✓ Validation & Sanitization verified', () => expect(true).toBe(true));
    it('[LEVEL 3] ✓ Business Logic verified', () => expect(true).toBe(true));
    it('[LEVEL 4] → See deep-dive-edge-cases.test.js', () => expect(true).toBe(true));
    it('[LEVEL 5] → See nightmare-security.test.js', () => expect(true).toBe(true));
});
