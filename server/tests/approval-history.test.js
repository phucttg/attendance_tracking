import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Request from '../src/models/Request.js';

let adminToken;
let managerToken;
let noTeamManagerToken;
let teamAId;
let teamBId;
let managerAId;
let employeeAId;
let inactiveEmployeeAId;
let employeeBId;

beforeAll(async () => {
    vi.setSystemTime(new Date('2026-03-04T03:00:00.000Z'));

    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});

    const [teamA, teamB] = await Team.create([
        { name: 'Approval Team A' },
        { name: 'Approval Team B' }
    ]);
    teamAId = teamA._id;
    teamBId = teamB._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    const [admin, managerA, noTeamManager, employeeA, inactiveEmployeeA, employeeB] = await User.create([
        {
            employeeCode: 'APH001',
            name: 'Approval Admin',
            email: 'approval.admin@test.com',
            passwordHash,
            role: 'ADMIN',
            isActive: true
        },
        {
            employeeCode: 'APH002',
            name: 'Approval Manager A',
            email: 'approval.manager.a@test.com',
            passwordHash,
            role: 'MANAGER',
            teamId: teamAId,
            isActive: true
        },
        {
            employeeCode: 'APH003',
            name: 'No Team Manager',
            email: 'approval.manager.noteam@test.com',
            passwordHash,
            role: 'MANAGER',
            isActive: true
        },
        {
            employeeCode: 'APH004',
            name: 'Approval Employee A',
            email: 'approval.employee.a@test.com',
            passwordHash,
            role: 'EMPLOYEE',
            teamId: teamAId,
            isActive: true
        },
        {
            employeeCode: 'APH005',
            name: 'Inactive Employee A',
            email: 'approval.employee.inactive@test.com',
            passwordHash,
            role: 'EMPLOYEE',
            teamId: teamAId,
            isActive: false
        },
        {
            employeeCode: 'APH006',
            name: 'Approval Employee B',
            email: 'approval.employee.b@test.com',
            passwordHash,
            role: 'EMPLOYEE',
            teamId: teamBId,
            isActive: true
        }
    ]);

    managerAId = managerA._id;
    employeeAId = employeeA._id;
    inactiveEmployeeAId = inactiveEmployeeA._id;
    employeeBId = employeeB._id;

    const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: admin.email, password: 'Password123' });
    adminToken = adminLogin.body.token;

    const managerLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: managerA.email, password: 'Password123' });
    managerToken = managerLogin.body.token;

    const noTeamManagerLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: noTeamManager.email, password: 'Password123' });
    noTeamManagerToken = noTeamManagerLogin.body.token;
});

afterAll(async () => {
    vi.useRealTimers();
    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});
});

beforeEach(async () => {
    await Request.deleteMany({});
});

describe('POST /api/requests/:id/reject - rejectReason compatibility', () => {
    it('reject without body should still work and keep rejectReason null', async () => {
        const pending = await Request.create({
            userId: employeeAId,
            type: 'ADJUST_TIME',
            date: '2026-03-04',
            requestedCheckInAt: new Date('2026-03-04T08:30:00+07:00'),
            reason: 'Pending request',
            status: 'PENDING'
        });

        const res = await request(app)
            .post(`/api/requests/${pending._id}/reject`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('REJECTED');

        const updated = await Request.findById(pending._id).lean();
        expect(updated.rejectReason).toBeNull();
    });

    it('reject with rejectReason should trim and persist', async () => {
        const pending = await Request.create({
            userId: employeeAId,
            type: 'ADJUST_TIME',
            date: '2026-03-04',
            requestedCheckInAt: new Date('2026-03-04T08:30:00+07:00'),
            reason: 'Pending request',
            status: 'PENDING'
        });

        const res = await request(app)
            .post(`/api/requests/${pending._id}/reject`)
            .set('Authorization', `Bearer ${managerToken}`)
            .send({ rejectReason: '  Missing evidence  ' });

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('REJECTED');
        expect(res.body.request.rejectReason).toBe('Missing evidence');

        const updated = await Request.findById(pending._id).lean();
        expect(updated.rejectReason).toBe('Missing evidence');
    });

    it('reject with invalid rejectReason should return 400', async () => {
        const pending = await Request.create({
            userId: employeeAId,
            type: 'ADJUST_TIME',
            date: '2026-03-04',
            requestedCheckInAt: new Date('2026-03-04T08:30:00+07:00'),
            reason: 'Pending request',
            status: 'PENDING'
        });

        const res = await request(app)
            .post(`/api/requests/${pending._id}/reject`)
            .set('Authorization', `Bearer ${managerToken}`)
            .send({ rejectReason: 12345 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/rejectReason/i);
    });
});

describe('GET /api/requests/history', () => {
    beforeEach(async () => {
        await Request.create([
            {
                userId: employeeAId,
                type: 'ADJUST_TIME',
                date: '2026-03-01',
                requestedCheckInAt: new Date('2026-03-01T08:30:00+07:00'),
                reason: 'Approved in team A',
                status: 'APPROVED',
                approvedBy: managerAId,
                approvedAt: new Date('2026-03-04T09:00:00+07:00')
            },
            {
                userId: inactiveEmployeeAId,
                type: 'LEAVE',
                leaveStartDate: '2026-03-02',
                leaveEndDate: '2026-03-02',
                leaveType: 'SICK',
                leaveDaysCount: 1,
                reason: 'Rejected inactive user',
                status: 'REJECTED',
                approvedBy: managerAId,
                approvedAt: new Date('2026-03-04T10:00:00+07:00')
            },
            {
                userId: employeeBId,
                type: 'ADJUST_TIME',
                date: '2026-03-03',
                requestedCheckInAt: new Date('2026-03-03T08:30:00+07:00'),
                reason: 'Approved in team B',
                status: 'APPROVED',
                approvedBy: managerAId,
                approvedAt: new Date('2026-03-04T11:00:00+07:00')
            },
            {
                userId: employeeAId,
                type: 'ADJUST_TIME',
                date: '2026-03-04',
                requestedCheckInAt: new Date('2026-03-04T08:30:00+07:00'),
                reason: 'Still pending',
                status: 'PENDING'
            }
        ]);
    });

    it('manager should only see approved/rejected requests in own team, including inactive users', async () => {
        const res = await request(app)
            .get('/api/requests/history')
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(2);

        const statuses = res.body.items.map((item) => item.status);
        expect(statuses.every((status) => status === 'APPROVED' || status === 'REJECTED')).toBe(true);

        const userIds = res.body.items.map((item) => String(item.userId?._id));
        expect(userIds).toContain(String(employeeAId));
        expect(userIds).toContain(String(inactiveEmployeeAId));
        expect(userIds).not.toContain(String(employeeBId));

        // Sorted by approvedAt desc
        expect(new Date(res.body.items[0].approvedAt).getTime())
            .toBeGreaterThanOrEqual(new Date(res.body.items[1].approvedAt).getTime());
    });

    it('manager status filter should only return requested status', async () => {
        const res = await request(app)
            .get('/api/requests/history?status=APPROVED')
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].status).toBe('APPROVED');
        expect(String(res.body.items[0].userId?._id)).toBe(String(employeeAId));
    });

    it('manager without team should be forbidden', async () => {
        const res = await request(app)
            .get('/api/requests/history')
            .set('Authorization', `Bearer ${noTeamManagerToken}`);

        expect(res.status).toBe(403);
    });

    it('admin should see history across teams', async () => {
        const res = await request(app)
            .get('/api/requests/history')
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(3);
    });
});
