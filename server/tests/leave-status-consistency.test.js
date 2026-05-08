/**
 * Test: getAttendanceByUser leaveDates Fix Verification
 * 
 * Ensures Manager viewing employee attendance shows LEAVE status
 * instead of ABSENT when employee has approved leave.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import Holiday from '../src/models/Holiday.js';
import bcrypt from 'bcrypt';

let managerToken, adminToken;
let teamId, employeeId, managerId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
    await Holiday.deleteMany({});

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
    managerId = manager._id;

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
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
    await Holiday.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
    await Holiday.deleteMany({});
});

describe('BUG FIX: getAttendanceByUser leaveDates consistency', () => {

    it('should show LEAVE status when employee has approved leave (Manager view)', async () => {
        // Create approved LEAVE request for Jan 13-15, 2026 (Mon-Wed, all workdays)
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-01-13',
            leaveEndDate: '2026-01-15',
            leaveType: 'ANNUAL',
            leaveDaysCount: 3,
            reason: 'Vacation',
            status: 'APPROVED',
            approvedBy: managerId,
            approvedAt: new Date('2026-01-12T10:00:00+07:00')
        });

        // No attendance records for Jan 13-15 (employee on leave)
        // Manager views employee's January attendance
        const res = await request(app)
            .get(`/api/attendance/user/${employeeId}?month=2026-01`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.items).toBeDefined();

        // Find Jan 13, 14, 15 in results (all workdays)
        const jan13 = res.body.items.find(item => item.date === '2026-01-13');
        const jan14 = res.body.items.find(item => item.date === '2026-01-14');
        const jan15 = res.body.items.find(item => item.date === '2026-01-15');

        // All should show LEAVE status (not ABSENT)
        expect(jan13).toBeDefined();
        expect(jan13.status).toBe('LEAVE');

        expect(jan14).toBeDefined();
        expect(jan14.status).toBe('LEAVE');

        expect(jan15).toBeDefined();
        expect(jan15.status).toBe('LEAVE');
    });

    it('should show ABSENT for non-leave days without attendance', async () => {
        // No leave request for Jan 20
        // No attendance record for Jan 20

        const res = await request(app)
            .get(`/api/attendance/user/${employeeId}?month=2026-01`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);

        const jan20 = res.body.items.find(item => item.date === '2026-01-20');
        expect(jan20).toBeDefined();
        expect(jan20.status).toBe('ABSENT'); // No leave, no attendance = ABSENT
    });

    it('should show LEAVE for Admin view as well (consistency)', async () => {
        // Create approved leave
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-01-22',
            leaveEndDate: '2026-01-22',
            leaveType: 'SICK',
            leaveDaysCount: 1,
            reason: 'Doctor appointment',
            status: 'APPROVED',
            approvedBy: managerId,
            approvedAt: new Date('2026-01-21T10:00:00+07:00')
        });

        // Admin views employee's January attendance
        const res = await request(app)
            .get(`/api/attendance/user/${employeeId}?month=2026-01`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);

        const jan22 = res.body.items.find(item => item.date === '2026-01-22');
        expect(jan22).toBeDefined();
        expect(jan22.status).toBe('LEAVE');
    });

    it('should match getMyAttendance behavior (employee self-view)', async () => {
        // Create approved leave for current employee
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-01-23',
            leaveEndDate: '2026-01-24',
            leaveType: 'ANNUAL',
            leaveDaysCount: 2,
            reason: 'Personal leave',
            status: 'APPROVED',
            approvedBy: managerId,
            approvedAt: new Date('2026-01-22T10:00:00+07:00')
        });

        // Login as employee
        const empRes = await request(app)
            .post('/api/auth/login')
            .send({ identifier: 'employee@test.com', password: 'Password123' });
        const empToken = empRes.body.token;

        // Employee views their own attendance
        const selfRes = await request(app)
            .get('/api/attendance/me?month=2026-01')
            .set('Authorization', `Bearer ${empToken}`);

        // Manager views employee's attendance
        const managerRes = await request(app)
            .get(`/api/attendance/user/${employeeId}?month=2026-01`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(selfRes.status).toBe(200);
        expect(managerRes.status).toBe(200);

        // Both should show same LEAVE status for Jan 23-24
        const selfJan23 = selfRes.body.items.find(item => item.date === '2026-01-23');
        const managerJan23 = managerRes.body.items.find(item => item.date === '2026-01-23');

        expect(selfJan23.status).toBe('LEAVE');
        expect(managerJan23.status).toBe('LEAVE');
        expect(selfJan23.status).toBe(managerJan23.status); // ✅ Consistency
    });

    it('should not show LEAVE for PENDING leave requests', async () => {
        // Create PENDING (not approved) leave request
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-01-27',
            leaveEndDate: '2026-01-27',
            leaveType: 'ANNUAL',
            leaveDaysCount: 1,
            reason: 'Pending leave',
            status: 'PENDING' // Not approved yet
        });

        const res = await request(app)
            .get(`/api/attendance/user/${employeeId}?month=2026-01`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);

        const jan27 = res.body.items.find(item => item.date === '2026-01-27');
        expect(jan27).toBeDefined();
        expect(jan27.status).toBe('ABSENT'); // PENDING leave = still ABSENT
    });

    it('should not show LEAVE for REJECTED leave requests', async () => {
        // Create REJECTED leave request
        await Request.create({
            userId: employeeId,
            type: 'LEAVE',
            leaveStartDate: '2026-01-28',
            leaveEndDate: '2026-01-28',
            leaveType: 'ANNUAL',
            leaveDaysCount: 1,
            reason: 'Rejected leave',
            status: 'REJECTED',
            approvedBy: managerId,
            approvedAt: new Date('2026-01-27T10:00:00+07:00')
        });

        const res = await request(app)
            .get(`/api/attendance/user/${employeeId}?month=2026-01`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);

        const jan28 = res.body.items.find(item => item.date === '2026-01-28');
        expect(jan28).toBeDefined();
        expect(jan28.status).toBe('ABSENT'); // REJECTED leave = still ABSENT
    });
});
