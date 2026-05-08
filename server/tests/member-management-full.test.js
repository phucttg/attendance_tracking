/**
 * Member Management APIs - Full Coverage Tests
 * 
 * Endpoints Tested:
 * - GET /api/teams (A1 - Teams Directory)
 * - GET /api/attendance/today (A2 - Today Activity)
 * - GET /api/users/:id (A3 - User Detail)
 * - GET /api/attendance/user/:id (A3 - User Attendance History)
 * - PATCH /api/admin/users/:id (A4 - Update User)
 * - POST /api/admin/users/:id/reset-password (A4 - Reset Password)
 * 
 * Test Design Techniques:
 * - Happy Path Testing: Core functionality verification
 * - RBAC Testing: Role-based access control validation
 * - Anti-IDOR Testing: Cross-team access prevention
 * - Input Validation: Field format and whitelist validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import bcrypt from 'bcrypt';

let adminToken, managerToken, manager2Token, employeeToken, managerNoTeamToken;
let team1Id, team2Id, employeeId, employee2Id, managerId, manager2Id, adminId;

beforeAll(async () => {
    // Clean up
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});

    // Create teams
    const team1 = await Team.create({ name: 'Member Mgmt Team 1' });
    const team2 = await Team.create({ name: 'Member Mgmt Team 2' });
    team1Id = team1._id;
    team2Id = team2._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    // Admin
    const admin = await User.create({
        employeeCode: 'MM001',
        name: 'MM Admin',
        email: 'mmadmin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });
    adminId = admin._id;

    // Manager Team 1
    const mgr = await User.create({
        employeeCode: 'MM002',
        name: 'MM Manager',
        email: 'mmmanager@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId: team1Id,
        isActive: true
    });
    managerId = mgr._id;

    // Manager Team 2 (for cross-team tests)
    const mgr2 = await User.create({
        employeeCode: 'MM003',
        name: 'MM Manager 2',
        email: 'mmmanager2@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId: team2Id,
        isActive: true
    });
    manager2Id = mgr2._id;

    // Manager WITHOUT team
    await User.create({
        employeeCode: 'MM004',
        name: 'MM Manager No Team',
        email: 'mmmanagernoteam@test.com',
        passwordHash,
        role: 'MANAGER',
        isActive: true
    });

    // Employee Team 1
    const emp = await User.create({
        employeeCode: 'MM005',
        name: 'MM Employee',
        email: 'mmemployee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId: team1Id,
        isActive: true,
        startDate: new Date('2025-01-01')
    });
    employeeId = emp._id;

    // Employee Team 2 (for cross-team tests)
    const emp2 = await User.create({
        employeeCode: 'MM006',
        name: 'MM Employee 2',
        email: 'mmemployee2@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId: team2Id,
        isActive: true
    });
    employee2Id = emp2._id;

    // Get tokens
    const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'mmadmin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const managerRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'mmmanager@test.com', password: 'Password123' });
    managerToken = managerRes.body.token;

    const manager2Res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'mmmanager2@test.com', password: 'Password123' });
    manager2Token = manager2Res.body.token;

    const managerNoTeamRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'mmmanagernoteam@test.com', password: 'Password123' });
    managerNoTeamToken = managerNoTeamRes.body.token;

    const employeeRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'mmemployee@test.com', password: 'Password123' });
    employeeToken = employeeRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
});


// ============================================
// A1: TEAMS DIRECTORY - GET /api/teams
// ============================================
describe('A1: Teams Directory - GET /api/teams', () => {

    describe('Happy Paths', () => {
        it('ADMIN can get all teams', async () => {
            const res = await request(app)
                .get('/api/teams')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeInstanceOf(Array);
            expect(res.body.items.length).toBeGreaterThanOrEqual(2);
        });

        it('MANAGER can get all teams', async () => {
            const res = await request(app)
                .get('/api/teams')
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeInstanceOf(Array);
        });

        it('EMPLOYEE can get all teams', async () => {
            const res = await request(app)
                .get('/api/teams')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(200);
            expect(res.body.items).toBeInstanceOf(Array);
        });

        it('Response shape: { items: [{ _id, name }] }', async () => {
            const res = await request(app)
                .get('/api/teams')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.body.items[0]).toHaveProperty('_id');
            expect(res.body.items[0]).toHaveProperty('name');
        });
    });

    describe('Authentication', () => {
        it('No token -> 401', async () => {
            const res = await request(app).get('/api/teams');
            expect(res.status).toBe(401);
        });
    });
});


// ============================================
// A2: TODAY ACTIVITY - GET /api/attendance/today
// ============================================
describe('A2: Today Activity - GET /api/attendance/today', () => {

    describe('RBAC - Role-Based Access', () => {
        it('ADMIN scope=company -> 200', async () => {
            const res = await request(app)
                .get('/api/attendance/today?scope=company')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('date');
            expect(res.body).toHaveProperty('items');
        });

        it('ADMIN scope=team with teamId -> 200', async () => {
            const res = await request(app)
                .get(`/api/attendance/today?scope=team&teamId=${team1Id}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });

        it('MANAGER scope=team (forced) -> 200', async () => {
            const res = await request(app)
                .get('/api/attendance/today')
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
        });

        it('MANAGER with scope=company -> silently forced to team (200)', async () => {
            // Code forces scope='team' for manager, doesn't reject
            const res = await request(app)
                .get('/api/attendance/today?scope=company')
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
        });

        it('EMPLOYEE -> 403', async () => {
            const res = await request(app)
                .get('/api/attendance/today')
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('MANAGER without team -> 403', async () => {
            const res = await request(app)
                .get('/api/attendance/today')
                .set('Authorization', `Bearer ${managerNoTeamToken}`);

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('team');
        });
    });

    describe('Input Validation', () => {
        it('Invalid scope value -> 400', async () => {
            const res = await request(app)
                .get('/api/attendance/today?scope=invalid')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });

        it('Admin scope=team without teamId -> 400', async () => {
            const res = await request(app)
                .get('/api/attendance/today?scope=team')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });

        it('Invalid teamId format -> 400', async () => {
            const res = await request(app)
                .get('/api/attendance/today?scope=team&teamId=invalid')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });
    });
});


// ============================================
// A3: USER DETAIL - GET /api/users/:id
// ============================================
describe('A3: User Detail - GET /api/users/:id', () => {

    describe('RBAC - Role-Based Access', () => {
        it('ADMIN can access any user', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body.user).toHaveProperty('_id');
            expect(res.body.user).toHaveProperty('name');
            expect(res.body.user).not.toHaveProperty('passwordHash');
        });

        it('MANAGER can access same-team user', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
        });

        it('EMPLOYEE -> 403', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });

        it('MANAGER without team -> 403', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${managerNoTeamToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('Anti-IDOR - Cross-Team Access Prevention', () => {
        it('Manager Team 1 accessing Team 2 user -> 403', async () => {
            const res = await request(app)
                .get(`/api/users/${employee2Id}`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('team');
        });

        it('Manager Team 2 accessing Team 1 user -> 403', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${manager2Token}`);

            expect(res.status).toBe(403);
        });
    });

    describe('Response Sanitization', () => {
        it('Response should NOT contain passwordHash', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.body.user).not.toHaveProperty('passwordHash');
            expect(res.body.user).not.toHaveProperty('__v');
        });

        it('Response contains whitelist fields', async () => {
            const res = await request(app)
                .get(`/api/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            const user = res.body.user;
            expect(user).toHaveProperty('_id');
            expect(user).toHaveProperty('employeeCode');
            expect(user).toHaveProperty('name');
            expect(user).toHaveProperty('email');
            expect(user).toHaveProperty('role');
            expect(user).toHaveProperty('isActive');
        });
    });

    describe('Input Validation', () => {
        it('Invalid ObjectId format -> 400', async () => {
            const res = await request(app)
                .get('/api/users/invalid-id')
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });

        it('Non-existent user (Admin) -> 404', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app)
                .get(`/api/users/${fakeId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(404);
        });
    });
});


// ============================================
// A3: USER ATTENDANCE HISTORY - GET /api/attendance/user/:id
// ============================================
describe('A3: User Attendance History - GET /api/attendance/user/:id', () => {

    beforeAll(async () => {
        // Create some attendance records
        const today = new Date().toISOString().split('T')[0];
        await Attendance.create({
            userId: employeeId,
            date: today,
            checkInAt: new Date(`${today}T01:30:00Z`)
        });
    });

    describe('RBAC - Role-Based Access', () => {
        it('ADMIN can access any user attendance', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('items');
        });

        it('MANAGER can access same-team user attendance', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employeeId}`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(200);
        });

        it('EMPLOYEE -> 403', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employeeId}`)
                .set('Authorization', `Bearer ${employeeToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('Anti-IDOR - Cross-Team Access Prevention', () => {
        it('Manager accessing other-team user attendance -> 403', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employee2Id}`)
                .set('Authorization', `Bearer ${managerToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('Month Validation', () => {
        it('Valid month format (YYYY-MM) -> 200', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employeeId}?month=2026-01`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });

        it('Invalid month format -> 400', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employeeId}?month=2026-1`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(400);
        });

        it('Empty month -> defaults to current month (200)', async () => {
            const res = await request(app)
                .get(`/api/attendance/user/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`);

            expect(res.status).toBe(200);
        });
    });
});


// ============================================
// A4: UPDATE USER - PATCH /api/admin/users/:id
// ============================================
describe('A4: Update User - PATCH /api/admin/users/:id', () => {

    describe('RBAC - Admin Only', () => {
        it('ADMIN can update user', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ name: 'Updated Name' });

            expect(res.status).toBe(200);
            expect(res.body.user.name).toBe('Updated Name');
        });

        it('MANAGER -> 403', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${managerToken}`)
                .send({ name: 'Should Fail' });

            expect(res.status).toBe(403);
        });

        it('EMPLOYEE -> 403', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({ name: 'Should Fail' });

            expect(res.status).toBe(403);
        });
    });

    describe('Whitelist Fields', () => {
        it('Update allowed fields (name, email, isActive)', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'New Name',
                    email: 'newemail@test.com',
                    isActive: false
                });

            expect(res.status).toBe(200);
            expect(res.body.user.name).toBe('New Name');
            expect(res.body.user.email).toBe('newemail@test.com');
            expect(res.body.user.isActive).toBe(false);

            // Restore
            await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ email: 'mmemployee@test.com', isActive: true });
        });

        it('Update teamId', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ teamId: team2Id.toString() });

            expect(res.status).toBe(200);
            expect(res.body.user.teamId.toString()).toBe(team2Id.toString());

            // Restore
            await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ teamId: team1Id.toString() });
        });

        it('Update startDate (ISO format)', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ startDate: '2025-06-01' });

            expect(res.status).toBe(200);
        });

        it('Non-whitelist field (role) should NOT update', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ role: 'ADMIN', name: 'Test Role' });

            expect(res.status).toBe(200);
            // Role should NOT change
            expect(res.body.user.role).toBe('EMPLOYEE');
        });
    });

    describe('Input Validation', () => {
        it('teamId = null -> 400', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ teamId: null });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('null');
        });

        it('startDate = null -> 400', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ startDate: null });

            expect(res.status).toBe(400);
        });

        it('Invalid teamId format -> 400', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ teamId: 'invalid' });

            expect(res.status).toBe(400);
        });

        it('Invalid startDate format -> 400', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ startDate: 'not-a-date' });

            expect(res.status).toBe(400);
        });

        it('No valid fields to update -> 400', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('Duplicate Key Handling', () => {
        it('Duplicate email -> 409', async () => {
            const res = await request(app)
                .patch(`/api/admin/users/${employeeId}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ email: 'mmadmin@test.com' }); // Admin's email

            expect(res.status).toBe(409);
        });
    });
});


// ============================================
// A4: RESET PASSWORD - POST /api/admin/users/:id/reset-password
// ============================================
describe('A4: Reset Password - POST /api/admin/users/:id/reset-password', () => {

    describe('RBAC - Admin Only', () => {
        it('ADMIN can reset password -> 200', async () => {
            const res = await request(app)
                .post(`/api/admin/users/${employeeId}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ newPassword: 'NewPassword123' });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Password updated');
        });

        it('User can login with new password', async () => {
            await request(app)
                .post(`/api/admin/users/${employeeId}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ newPassword: 'ResetTest123' });

            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ identifier: 'mmemployee@test.com', password: 'ResetTest123' });

            expect(loginRes.status).toBe(200);
            expect(loginRes.body.token).toBeDefined();

            // Restore original password
            await request(app)
                .post(`/api/admin/users/${employeeId}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ newPassword: 'Password123' });
        });

        it('MANAGER -> 403', async () => {
            const res = await request(app)
                .post(`/api/admin/users/${employeeId}/reset-password`)
                .set('Authorization', `Bearer ${managerToken}`)
                .send({ newPassword: 'NewPassword123' });

            expect(res.status).toBe(403);
        });
    });

    describe('Password Validation', () => {
        it('Password < 8 characters -> 400', async () => {
            const res = await request(app)
                .post(`/api/admin/users/${employeeId}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ newPassword: 'short' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('8');
        });

        it('Missing newPassword -> 400', async () => {
            const res = await request(app)
                .post(`/api/admin/users/${employeeId}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('Input Validation', () => {
        it('Non-existent user -> 404', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            const res = await request(app)
                .post(`/api/admin/users/${fakeId}/reset-password`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ newPassword: 'NewPassword123' });

            expect(res.status).toBe(404);
        });

        it('Invalid ObjectId format -> 400', async () => {
            const res = await request(app)
                .post('/api/admin/users/invalid-id/reset-password')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ newPassword: 'NewPassword123' });

            expect(res.status).toBe(400);
        });
    });
});
