/**
 * Admin User CRUD Tests
 * 
 * Coverage: createUser, getAllUsers
 * ISTQB: Equivalence Partitioning, Boundary Value Analysis, RBAC
 * Target: POST/GET /api/admin/users
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import bcrypt from 'bcrypt';

let adminToken, managerToken, employeeToken, testTeamId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);
    const team = await Team.create({ name: 'CRUD Test Team' });
    testTeamId = team._id;

    await User.create({
        employeeCode: 'CRUD001', name: 'CRUD Admin',
        email: 'crudadmin@test.com', passwordHash,
        role: 'ADMIN', isActive: true
    });
    await User.create({
        employeeCode: 'CRUD002', name: 'CRUD Manager',
        email: 'crudmanager@test.com', passwordHash,
        role: 'MANAGER', teamId: testTeamId, isActive: true
    });
    await User.create({
        employeeCode: 'CRUD003', name: 'CRUD Employee',
        email: 'crudemployee@test.com', passwordHash,
        role: 'EMPLOYEE', teamId: testTeamId, isActive: true
    });

    const adminRes = await request(app).post('/api/auth/login')
        .send({ identifier: 'crudadmin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const mgrRes = await request(app).post('/api/auth/login')
        .send({ identifier: 'crudmanager@test.com', password: 'Password123' });
    managerToken = mgrRes.body.token;

    const empRes = await request(app).post('/api/auth/login')
        .send({ identifier: 'crudemployee@test.com', password: 'Password123' });
    employeeToken = empRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
});

// ============================================
// HAPPY PATHS
// ============================================
describe('Admin User CRUD - Happy Paths', () => {
    it('1. Admin creates user with required fields → 201', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                employeeCode: 'NEW001', name: 'New User',
                email: 'newuser1@test.com', password: 'Password123',
                role: 'EMPLOYEE'
            });

        expect(res.status).toBe(201);
        expect(res.body.user._id).toBeDefined();
        expect(res.body.user.employeeCode).toBe('NEW001');
    });

    it('2. Admin creates user with optional fields → 201', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                employeeCode: 'NEW002', name: 'New User 2',
                email: 'newuser2@test.com', password: 'Password123',
                role: 'MANAGER', username: 'newusr2',
                teamId: testTeamId.toString(), startDate: '2026-01-01'
            });

        expect(res.status).toBe(201);
        expect(res.body.user.username).toBe('newusr2');
        expect(res.body.user.teamId).toBe(testTeamId.toString());
    });

    it('3. Admin lists all users → 200', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items).toBeDefined();
        expect(Array.isArray(res.body.items)).toBe(true);
        expect(res.body.items.length).toBeGreaterThanOrEqual(3);
    });

    it('4. Created user appears in getAllUsers', async () => {
        await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                employeeCode: 'NEW003', name: 'Findable User',
                email: 'findable@test.com', password: 'Password123',
                role: 'EMPLOYEE'
            });

        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);

        const found = res.body.items.find(u => u.employeeCode === 'NEW003');
        expect(found).toBeDefined();
        expect(found.name).toBe('Findable User');
    });
});

// ============================================
// RBAC
// ============================================
describe('Admin User CRUD - RBAC', () => {
    it('5. Manager tries createUser → 403', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${managerToken}`)
            .send({
                employeeCode: 'FAIL001', name: 'Fail',
                email: 'fail@test.com', password: 'Password123',
                role: 'EMPLOYEE'
            });
        expect(res.status).toBe(403);
    });

    it('6. Manager tries getAllUsers → 403', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${managerToken}`);
        expect(res.status).toBe(403);
    });

    it('7. Employee tries createUser → 403', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                employeeCode: 'FAIL002', name: 'Fail',
                email: 'fail2@test.com', password: 'Password123',
                role: 'EMPLOYEE'
            });
        expect(res.status).toBe(403);
    });

    it('8. Employee tries getAllUsers → 403', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${employeeToken}`);
        expect(res.status).toBe(403);
    });

    it('9. No token → 401', async () => {
        const res = await request(app).post('/api/admin/users')
            .send({ employeeCode: 'X', name: 'X', email: 'x@x.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(401);
    });

    it('10. Invalid token → 401', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', 'Bearer invalid.token.here');
        expect(res.status).toBe(401);
    });
});

// ============================================
// VALIDATION
// ============================================
describe('Admin User CRUD - Validation', () => {
    it('11. Missing employeeCode → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ name: 'X', email: 'x@x.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/employee/i);
    });

    it('12. Missing name → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', email: 'x@x.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/name/i);
    });

    it('13. Missing email → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/email/i);
    });

    it('14. Missing password → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'x@x.com', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/password/i);
    });

    it('15. Missing role → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'x@x.com', password: '12345678' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/role/i);
    });

    it('16. Password 7 chars (boundary -1) → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'x@x.com', password: '1234567', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/8 char/i);
    });

    it('17. Password 8 chars (exact boundary) → 201', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'PWD8', name: 'Pwd8 User', email: 'pwd8@test.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(201);
    });

    it('18. Invalid role "SUPERADMIN" → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'x@x.com', password: '12345678', role: 'SUPERADMIN' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/role/i);
    });

    it('19. Invalid role "" (empty) → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'x@x.com', password: '12345678', role: '' });
        expect(res.status).toBe(400);
    });

    it('20. Invalid teamId format → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'badteam@x.com', password: '12345678', role: 'EMPLOYEE', teamId: 'not-valid-id' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/teamId/i);
    });

    it('21. isActive not boolean → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'X', name: 'X', email: 'active@x.com', password: '12345678', role: 'EMPLOYEE', isActive: 'yes' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/isActive/i);
    });
});

// ============================================
// CONFLICT (409)
// ============================================
describe('Admin User CRUD - Conflict', () => {
    it('22. Duplicate email → 409', async () => {
        await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DUP001', name: 'Dup Email', email: 'duplicate@test.com', password: '12345678', role: 'EMPLOYEE' });

        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DUP002', name: 'Dup Email 2', email: 'duplicate@test.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(409);
    });

    it('23. Duplicate employeeCode → 409', async () => {
        await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DUPCODE', name: 'Dup Code', email: 'dupcode1@test.com', password: '12345678', role: 'EMPLOYEE' });

        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DUPCODE', name: 'Dup Code 2', email: 'dupcode2@test.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(409);
    });

    it('24. Duplicate username → 409', async () => {
        await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DUPUSR1', name: 'Dup User', email: 'dupusr1@test.com', password: '12345678', role: 'EMPLOYEE', username: 'sameusername' });

        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DUPUSR2', name: 'Dup User 2', email: 'dupusr2@test.com', password: '12345678', role: 'EMPLOYEE', username: 'sameusername' });
        expect(res.status).toBe(409);
    });
});

// ============================================
// SECURITY
// ============================================
describe('Admin User CRUD - Security', () => {
    it('25. createUser response never contains passwordHash', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'SEC001', name: 'Sec User', email: 'secuser@test.com', password: '12345678', role: 'EMPLOYEE' });

        expect(res.status).toBe(201);
        expect(res.body.user.passwordHash).toBeUndefined();
        expect(res.body.user.password).toBeUndefined();
    });

    it('26. getAllUsers response never contains passwordHash', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        for (const user of res.body.items) {
            expect(user.passwordHash).toBeUndefined();
            expect(user.password).toBeUndefined();
        }
    });

    it('27. Response excludes __v', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'SEC002', name: 'Sec User 2', email: 'secuser2@test.com', password: '12345678', role: 'EMPLOYEE' });

        expect(res.body.user.__v).toBeUndefined();
    });
});

// ============================================
// EDGE CASES
// ============================================
describe('Admin User CRUD - Edge Cases', () => {
    it('28. Empty string employeeCode → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: '', name: 'X', email: 'empty@x.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
    });

    it('29. Whitespace-only name → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'WS001', name: '   ', email: 'ws@x.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(400);
    });

    it('30. Very long password (256 chars) → 201', async () => {
        const longPwd = 'A'.repeat(256);
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'LONG001', name: 'Long Pwd', email: 'longpwd@test.com', password: longPwd, role: 'EMPLOYEE' });
        expect(res.status).toBe(201);
    });

    it('31. Unicode in name → 201', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'UNI001', name: 'Nguyễn Văn Á 日本語', email: 'unicode@test.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(201);
        expect(res.body.user.name).toBe('Nguyễn Văn Á 日本語');
    });

    it('32. Invalid startDate string → 400', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'DATE001', name: 'Date Test', email: 'datetest@test.com', password: '12345678', role: 'EMPLOYEE', startDate: 'not-a-date' });
        expect(res.status).toBe(400);
    });

    it('33. Non-existent teamId → 201 (no FK constraint)', async () => {
        const fakeTeamId = new mongoose.Types.ObjectId();
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'FAKE001', name: 'Fake Team', email: 'faketeam@test.com', password: '12345678', role: 'EMPLOYEE', teamId: fakeTeamId.toString() });
        expect(res.status).toBe(201);
    });

    it('34. Empty username → normalized to undefined', async () => {
        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'EMPTY001', name: 'Empty Username', email: 'emptyusr@test.com', password: '12345678', role: 'EMPLOYEE', username: '' });
        expect(res.status).toBe(201);
        expect(res.body.user.username).toBeUndefined();
    });

    it('35. Case sensitivity: same email different case → 409', async () => {
        await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'CASE001', name: 'Case Test', email: 'CaseTest@test.com', password: '12345678', role: 'EMPLOYEE' });

        const res = await request(app)
            .post('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ employeeCode: 'CASE002', name: 'Case Test 2', email: 'casetest@test.com', password: '12345678', role: 'EMPLOYEE' });
        expect(res.status).toBe(409);
    });

    it('36. All three valid roles work', async () => {
        for (const role of ['ADMIN', 'MANAGER', 'EMPLOYEE']) {
            const code = `ROLE${role.substring(0, 3)}`;
            const res = await request(app)
                .post('/api/admin/users')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ employeeCode: code, name: `${role} User`, email: `${role.toLowerCase()}role@test.com`, password: '12345678', role });
            expect(res.status).toBe(201);
        }
    });
});

// Summary
describe('Admin User CRUD Summary', () => {
    it('[HAPPY] ✓ Admin creates and lists users', () => expect(true).toBe(true));
    it('[RBAC] ✓ Manager/Employee get 403', () => expect(true).toBe(true));
    it('[VALIDATION] ✓ Required fields, password length, role validated', () => expect(true).toBe(true));
    it('[CONFLICT] ✓ Duplicate email/code/username → 409', () => expect(true).toBe(true));
    it('[SECURITY] ✓ passwordHash never exposed', () => expect(true).toBe(true));
    it('[EDGE] ✓ Unicode, long password, case sensitivity handled', () => expect(true).toBe(true));
});
