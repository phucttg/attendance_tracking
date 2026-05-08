import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import { countWorkdays } from '../src/utils/dateUtils.js';

let adminToken;
let teamId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    const team = await Team.create({ name: 'Report Enhanced Team' });
    teamId = team._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    await User.create({
        employeeCode: 'REP001',
        name: 'Report Admin',
        email: 'report-admin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    const employee = await User.create({
        employeeCode: 'REP002',
        name: 'Report Employee',
        email: 'report-employee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });

    // Workdays with mixed statuses
    await Attendance.create([
        {
            userId: employee._id,
            date: '2026-02-03',
            checkInAt: new Date('2026-02-03T01:30:00Z'), // 08:30 GMT+7, default SHIFT_1 late 30m
            checkOutAt: new Date('2026-02-03T10:30:00Z') // 17:30 GMT+7
        },
        {
            userId: employee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T02:00:00Z'), // 09:00 GMT+7, default SHIFT_1 late 60m
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        },
        {
            userId: employee._id,
            date: '2026-02-06',
            checkInAt: new Date('2026-02-06T01:30:00Z'), // 08:30 GMT+7, default SHIFT_1 late 30m
            checkOutAt: new Date('2026-02-06T10:00:00Z') // 17:00 GMT+7 (early leave)
        },
        {
            userId: employee._id,
            date: '2026-02-10',
            checkInAt: new Date('2026-02-10T02:10:00Z'), // 09:10 GMT+7, default SHIFT_1 late 70m
            checkOutAt: new Date('2026-02-10T10:00:00Z') // 17:00 GMT+7 (early leave)
        }
    ]);

    // Approved leave with cross-month overlap
    await Request.create([
        {
            userId: employee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-01-28',
            leaveEndDate: '2026-02-03',
            leaveType: 'SICK',
            status: 'APPROVED'
        },
        {
            userId: employee._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-12',
            leaveEndDate: '2026-02-12',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        }
    ]);

    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'report-admin@test.com', password: 'Password123' });
    adminToken = loginRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

describe('Monthly Report Enhanced Summary', () => {
    it('returns newly added fields with expected values', async () => {
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${teamId}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.summary)).toBe(true);

        const row = res.body.summary.find((item) => item?.user?.employeeCode === 'REP002');
        expect(row).toBeDefined();

        expect(row.user.teamName).toBe('Report Enhanced Team');
        expect(row.totalWorkdays).toBe(countWorkdays('2026-02-01', '2026-02-28', new Set()));
        expect(row.presentDays).toBe(4);
        expect(row.leaveDays).toBe(3); // 2026-02-02, 2026-02-03, 2026-02-12
        expect(row.leaveByType).toEqual({
            ANNUAL: 1,
            SICK: 2,
            UNPAID: 0,
            UNSPECIFIED: 0
        });
        expect(row.totalLateCount).toBe(4);
        expect(row.totalLateMinutes).toBe(190);
        expect(row.earlyLeaveCount).toBe(2);
        expect(Array.isArray(row.lateDetails)).toBe(true);
        expect(row.lateDetails.length).toBe(4);
    });

    it('computes absentDays using elapsed workdays set-difference', async () => {
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${teamId}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const row = res.body.summary.find((item) => item?.user?.employeeCode === 'REP002');
        expect(row).toBeDefined();

        // Union(workday leave, present) = {02,03,05,06,10,12} => 6 days
        const expectedAbsent = row.totalWorkdays - 6;
        expect(row.absentDays).toBe(expectedAbsent);
        expect(row.absentDays).toBeGreaterThanOrEqual(0);
    });

    it('returns sorted lateDetails with required fields and GMT+7 time formatting', async () => {
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${teamId}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const row = res.body.summary.find((item) => item?.user?.employeeCode === 'REP002');
        expect(row).toBeDefined();

        expect(row.lateDetails[0]).toEqual({
            date: '2026-02-03',
            checkInTime: '08:30',
            lateMinutes: 30
        });
        expect(row.lateDetails[1]).toEqual({
            date: '2026-02-05',
            checkInTime: '09:00',
            lateMinutes: 60
        });
        expect(row.lateDetails[2]).toEqual({
            date: '2026-02-06',
            checkInTime: '08:30',
            lateMinutes: 30
        });
        expect(row.lateDetails[3]).toEqual({
            date: '2026-02-10',
            checkInTime: '09:10',
            lateMinutes: 70
        });
    });

    it('future month should have absentDays = 0', async () => {
        const futureMonth = '2099-01';
        const res = await request(app)
            .get(`/api/reports/monthly?month=${futureMonth}&scope=team&teamId=${teamId}`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        const row = res.body.summary.find((item) => item?.user?.employeeCode === 'REP002');
        expect(row).toBeDefined();
        expect(row.absentDays).toBe(0);
    });
});
