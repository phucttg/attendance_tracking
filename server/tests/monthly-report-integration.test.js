/**
 * Test Suite: Monthly Report Integration Tests
 * 
 * Coverage:
 * - C1: Admin Team Scope Validation (5 tests)
 * - Full API endpoint testing with MongoDB
 * - End-to-end data flow validation
 * 
 * Framework: Vitest + Supertest + MongoDB
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import {
    createTestUser,
    createTestTeam,
    loginUser,
    clearTestData
} from './fixtures/monthlyReportFixtures.js';

const parseBinaryBody = (res, callback) => {
    res.setEncoding('binary');
    let data = '';
    res.on('data', chunk => {
        data += chunk;
    });
    res.on('end', () => {
        callback(null, Buffer.from(data, 'binary'));
    });
};

let adminToken, managerToken, employeeToken;
let admin, manager, employee1, employee2;
let team1, team2;

beforeAll(async () => {
    await mongoose.connect(
        process.env.MONGO_URI?.replace(/\/[^/]+$/, '/monthly_report_integration_test_db')
        || 'mongodb://localhost:27017/monthly_report_integration_test_db'
    );

    await clearTestData(User, Team, Attendance, Request);

    // Create teams
    team1 = await createTestTeam(Team, { name: 'Engineering Team' });
    team2 = await createTestTeam(Team, { name: 'Sales Team' });

    // Create users
    admin = await createTestUser(User, {
        employeeCode: 'ADM001',
        name: 'Admin User',
        email: 'admin-integration@test.com',
        role: 'ADMIN'
    });

    manager = await createTestUser(User, {
        employeeCode: 'MGR001',
        name: 'Manager User',
        email: 'manager-integration@test.com',
        role: 'MANAGER',
        teamId: team1._id
    });

    employee1 = await createTestUser(User, {
        employeeCode: 'EMP001',
        name: 'Employee Team 1',
        email: 'emp1-integration@test.com',
        role: 'EMPLOYEE',
        teamId: team1._id
    });

    employee2 = await createTestUser(User, {
        employeeCode: 'EMP002',
        name: 'Employee Team 2',
        email: 'emp2-integration@test.com',
        role: 'EMPLOYEE',
        teamId: team2._id
    });

    // Login to get tokens
    adminToken = await loginUser(app, request, 'admin-integration@test.com');
    managerToken = await loginUser(app, request, 'manager-integration@test.com');
    employeeToken = await loginUser(app, request, 'emp1-integration@test.com');
});

afterAll(async () => {
    await clearTestData(User, Team, Attendance, Request);
    await mongoose.connection.close();
});

beforeEach(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

describe('C1: Admin Team Scope Validation', () => {
    
    it('C1-TC1: Admin requests team scope without teamId returns 400', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=team')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('message');
        expect(res.body.message.toLowerCase()).toContain('teamid');
    });

    it('C1-TC2: Admin requests team scope with valid teamId returns 200 with filtered data', async () => {
        // Arrange: Create attendance for both teams
        await Attendance.insertMany([
            {
                userId: employee1._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            },
            {
                userId: employee2._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            }
        ]);
        
        // Act: Request team1 data only
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${team1._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('summary');
        expect(Array.isArray(res.body.summary)).toBe(true);
        
        // Should only contain users from team1
        const employeeCodes = res.body.summary.map(r => r.user.employeeCode);
        
        // team1 has: manager (MGR001) and employee1 (EMP001)
        expect(employeeCodes).toContain('MGR001');
        expect(employeeCodes).toContain('EMP001');
        
        // Should NOT contain employee2 from team2
        expect(employeeCodes).not.toContain('EMP002');
    });

    it('C1-TC3: Admin requests company scope without teamId returns 200 with all users', async () => {
        // Arrange
        await Attendance.insertMany([
            {
                userId: employee1._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            },
            {
                userId: employee2._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            }
        ]);
        
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=company')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.body.summary).toBeDefined();
        
        const employeeCodes = res.body.summary.map(r => r.user.employeeCode);
        
        // Should contain users from all teams
        expect(employeeCodes).toContain('EMP001'); // Team 1
        expect(employeeCodes).toContain('EMP002'); // Team 2
        expect(employeeCodes).toContain('MGR001'); // Team 1
        
        // Admin might or might not appear depending on business logic
        // (Admin typically doesn't have attendance records)
    });

    it('C1-TC4: Admin requests team scope with invalid teamId format returns 400', async () => {
        // Act: Use invalid ObjectId format
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=team&teamId=invalid-id')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('message');
        expect(res.body.message).toContain('Invalid teamId format');
    });

    it('C1-TC5: Manager requests team scope inherits teamId from user profile', async () => {
        // Arrange: Manager belongs to team1
        await Attendance.create({
            userId: employee1._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act: Manager requests without explicit teamId (should use their own team)
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=team')
            .set('Authorization', `Bearer ${managerToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.body.summary).toBeDefined();
        
        const employeeCodes = res.body.summary.map(r => r.user.employeeCode);
        
        // Should see own team (team1) only
        expect(employeeCodes).toContain('EMP001'); // Team 1
        expect(employeeCodes).not.toContain('EMP002'); // Team 2 (should not see)
    });

    it('C1-TC5.1: Employee requests own team scope returns 403', async () => {
        // Arrange
        await Attendance.create({
            userId: employee1._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act: Employee requests their own team
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=team')
            .set('Authorization', `Bearer ${employeeToken}`);
        
        // Assert
        expect(res.status).toBe(403);
        expect(res.body).toHaveProperty('message');
        expect(res.body.message).toContain('Insufficient permissions');
    });
});

describe('C1: Additional Validation Tests', () => {
    
    it('should apply default month when month parameter is missing', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?scope=company')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('summary');
        expect(Array.isArray(res.body.summary)).toBe(true);
    });

    it('should reject invalid month format', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?month=invalid-month&scope=company')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Invalid month format');
    });

    it('should apply default scope when scope parameter is missing', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('summary');
        expect(Array.isArray(res.body.summary)).toBe(true);
    });

    it('should reject invalid scope value', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=invalid')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('Invalid scope');
    });

    it('should require authentication', async () => {
        // Act: Request without token
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=company');
        
        // Assert
        expect(res.status).toBe(401);
    });

    it('should reject invalid token', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly?month=2026-02&scope=company')
            .set('Authorization', 'Bearer invalid.token.here');
        
        // Assert
        expect(res.status).toBe(401);
    });
});

describe('Integration: Full Data Flow Validation', () => {
    
    it('should correctly aggregate data from multiple sources', async () => {
        // Arrange: Create comprehensive test data
        await Attendance.insertMany([
            {
                userId: employee1._id,
                date: '2026-02-03',
                checkInAt: new Date('2026-02-03T01:30:00Z'), // Default SHIFT_1: 08:30 GMT+7, late 30m
                checkOutAt: new Date('2026-02-03T10:30:00Z')
            },
            {
                userId: employee1._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T02:00:00Z'), // Default SHIFT_1: 09:00 GMT+7, late 60m
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            },
            {
                userId: employee1._id,
                date: '2026-02-10',
                checkInAt: new Date('2026-02-10T01:30:00Z'), // Default SHIFT_1: 08:30 GMT+7, late 30m
                checkOutAt: new Date('2026-02-10T10:00:00Z') // Early leave
            }
        ]);
        
        await Request.create({
            userId: employee1._id,
            type: 'LEAVE',
            leaveStartDate: '2026-02-12',
            leaveEndDate: '2026-02-13',
            leaveType: 'ANNUAL',
            status: 'APPROVED'
        });
        
        // Act
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${team1._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        
        const row = res.body.summary.find(r => r.user.employeeCode === 'EMP001');
        expect(row).toBeDefined();
        
        // Validate all fields
        expect(row.presentDays).toBe(3);
        expect(row.leaveDays).toBe(2);
        expect(row.totalLateCount).toBe(3);
        expect(row.totalLateMinutes).toBe(120);
        expect(row.earlyLeaveCount).toBe(1);
        expect(row.leaveByType.ANNUAL).toBe(2);
        expect(row.lateDetails).toHaveLength(3);
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
            date: '2026-02-10',
            checkInTime: '08:30',
            lateMinutes: 30
        });
        expect(row.user.teamName).toBe('Engineering Team');
    });

    it('should handle users with no attendance/leave data', async () => {
        // Act: Request report with no data
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${team1._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        
        const rows = res.body.summary;
        expect(rows.length).toBeGreaterThan(0); // Should still return users
        
        // Check employee1 with no data
        const row = rows.find(r => r.user.employeeCode === 'EMP001');
        if (row) {
            expect(row.presentDays).toBe(0);
            expect(row.leaveDays).toBe(0);
            expect(row.totalLateCount).toBe(0);
            expect(row.lateDetails).toHaveLength(0);
        }
    });

    it('should handle cross-month leave correctly', async () => {
        // Arrange: Leave spanning Jan-Feb
        await Request.create({
            userId: employee1._id,
            type: 'LEAVE',
            leaveStartDate: '2026-01-30', // Friday in January
            leaveEndDate: '2026-02-05', // Thursday in February
            leaveType: 'SICK',
            status: 'APPROVED'
        });
        
        // Act
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${team1._id}`)
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(200);
        
        const row = res.body.summary.find(r => r.user.employeeCode === 'EMP001');
        
        // Should only count Feb workdays: Feb 2 (Mon), 3 (Tue), 4 (Wed), 5 (Thu) = 4 days
        expect(row.leaveDays).toBe(4);
        expect(row.leaveByType.SICK).toBe(4);
    });

    it('should handle holidays correctly', async () => {
        // Arrange: Attendance on holiday
        await Attendance.create({
            userId: employee1._id,
            date: '2026-02-12', // Assuming this is a holiday
            checkInAt: new Date('2026-02-12T01:30:00Z'),
            checkOutAt: new Date('2026-02-12T10:30:00Z')
        });
        
        const holidays = new Set(['2026-02-12']);
        
        // Act
        const res = await request(app)
            .get(`/api/reports/monthly?month=2026-02&scope=team&teamId=${team1._id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .query({ holidays: JSON.stringify(Array.from(holidays)) }); // If API supports holiday param
        
        // Assert
        expect(res.status).toBe(200);
        
        const row = res.body.summary.find(r => r.user.employeeCode === 'EMP001');
        
        // Holiday attendance should count as present day (for display)
        // But NOT affect absentDays calculation (holidays excluded from workdays)
        expect(row.presentDays).toBe(1);
    });
});

describe('Integration: Export Endpoint', () => {
    
    it('should generate Excel export with team scope', async () => {
        // Arrange
        await Attendance.create({
            userId: employee1._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act
        const res = await request(app)
            .get(`/api/reports/monthly/export?month=2026-02&scope=team&teamId=${team1._id}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .buffer(true)
            .parse(parseBinaryBody);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(res.headers['content-disposition']).toContain('report-2026-02-team.xlsx');
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0); // Excel file buffer
    });

    it('should generate Excel export with company scope', async () => {
        // Arrange
        await Attendance.insertMany([
            {
                userId: employee1._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            },
            {
                userId: employee2._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T01:30:00Z'),
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            }
        ]);
        
        // Act
        const res = await request(app)
            .get('/api/reports/monthly/export?month=2026-02&scope=company')
            .set('Authorization', `Bearer ${adminToken}`)
            .buffer(true)
            .parse(parseBinaryBody);
        
        // Assert
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('spreadsheet');
        expect(Buffer.isBuffer(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
    });

    it('should reject export request without teamId for team scope', async () => {
        // Act
        const res = await request(app)
            .get('/api/reports/monthly/export?month=2026-02&scope=team')
            .set('Authorization', `Bearer ${adminToken}`);
        
        // Assert
        expect(res.status).toBe(400);
        expect(res.body.message.toLowerCase()).toContain('teamid');
    });
});
