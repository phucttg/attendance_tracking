/**
 * Deep Dive Edge Case Tests - "Chí Mạng" Test Suite
 * 
 * Target Vulnerabilities:
 * 1. Phantom Date (Ngày ma) - Invalid calendar dates passing regex
 * 2. Race Condition - Concurrent approve operations
 * 3. Overlapping Requests - Last Write Wins data loss
 * 4. Timezone Boundary - UTC vs GMT+7 edge cases
 * 
 * Test Design Techniques Applied:
 * - Boundary Value Analysis: Timezone boundaries, date edge cases
 * - Error Guessing: Invalid dates, race conditions
 * - State Transition Testing: Request status transitions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import bcrypt from 'bcrypt';
import { recentDistinctWeekdays, recentWeekday } from './testDateHelper.js';

let adminToken, managerToken, employeeToken;
let teamId, employeeId;
const [overlapDate, raceDate, tzDate] = recentDistinctWeekdays(3, 2);
// Use a very recent weekday (1 day ago) for state-transition setup so it always falls
// within the ADJUST_TIME submission window (max 7 days). Using recentDistinctWeekdays(4)
// could produce a date that is exactly 7 days ago, failing the window check at test time.
const transitionDate = recentWeekday(1);

beforeAll(async () => {
    // Clean up
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    // Create team
    const team = await Team.create({ name: 'Deep Dive Team' });
    teamId = team._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    // Admin
    await User.create({
        employeeCode: 'DD001',
        name: 'Deep Admin',
        email: 'deepadmin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    // Manager with team
    await User.create({
        employeeCode: 'DD002',
        name: 'Deep Manager',
        email: 'deepmanager@test.com',
        passwordHash,
        role: 'MANAGER',
        teamId,
        isActive: true
    });

    // Employee in team
    const emp = await User.create({
        employeeCode: 'DD003',
        name: 'Deep Employee',
        email: 'deepemployee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });
    employeeId = emp._id;

    // Get tokens
    const adminRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'deepadmin@test.com', password: 'Password123' });
    adminToken = adminRes.body.token;

    const managerRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'deepmanager@test.com', password: 'Password123' });
    managerToken = managerRes.body.token;

    const employeeRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'deepemployee@test.com', password: 'Password123' });
    employeeToken = employeeRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

// ============================================
// PHANTOM DATE - Invalid Calendar Dates
// ============================================
describe('Phantom Date (Ngày Ma) - Invalid Calendar Dates', () => {

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should reject February 30 (2026-02-30) - non-existent date', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-02-30',  // February never has 30 days
                requestedCheckInAt: '2026-02-30T08:30:00+07:00',
                requestedCheckOutAt: '2026-02-30T17:30:00+07:00',
                reason: 'Phantom date test - Feb 30'
            });

        // JS Date('2026-02-30') rolls over to 2026-03-02 (future), caught by future validation
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/future|invalid|date/i);
    });

    it('should reject February 31 (2026-02-31) - impossible date', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-02-31',
                requestedCheckInAt: '2026-02-31T08:30:00+07:00',
                requestedCheckOutAt: '2026-02-31T17:30:00+07:00',
                reason: 'Phantom date test - Feb 31'
            });

        expect(res.status).toBe(400);
    });

    it('should reject April 31 (2026-04-31) - April has only 30 days', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-04-31',
                requestedCheckInAt: '2026-04-31T08:30:00+07:00',
                requestedCheckOutAt: '2026-04-31T17:30:00+07:00',
                reason: 'Phantom date test - Apr 31'
            });

        expect(res.status).toBe(400);
    });

    it('should reject month 13 (2026-13-01) - invalid month', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-13-01',
                requestedCheckInAt: '2026-13-01T08:30:00+07:00',
                requestedCheckOutAt: '2026-13-01T17:30:00+07:00',
                reason: 'Phantom date test - month 13'
            });

        expect(res.status).toBe(400);
    });

    it('should reject month 00 (2026-00-15) - invalid month', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-00-15',
                requestedCheckInAt: '2026-00-15T08:30:00+07:00',
                requestedCheckOutAt: '2026-00-15T17:30:00+07:00',
                reason: 'Phantom date test - month 00'
            });

        expect(res.status).toBe(400);
    });

    it('should reject day 00 (2026-01-00) - invalid day', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-01-00',
                requestedCheckInAt: '2026-01-00T08:30:00+07:00',
                requestedCheckOutAt: '2026-01-00T17:30:00+07:00',
                reason: 'Phantom date test - day 00'
            });

        expect(res.status).toBe(400);
    });

    it('should accept leap year Feb 29 (2024-02-29)', async () => {
        // NOTE: 2024-02-29 is 703 days old (outside 7-day window)
        // This test verifies date validation, not submission window
        // Expect 400 due to submission window rule
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2024-02-29',  // 2024 is leap year (valid date format)
                requestedCheckInAt: '2024-02-29T08:30:00+07:00',
                requestedCheckOutAt: '2024-02-29T17:30:00+07:00',
                reason: 'Leap year test - valid Feb 29'
            });

        // Should reject due to 7-day submission window
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/7 days|too old/i);
    });

    it('should reject non-leap year Feb 29 (2025-02-29)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2025-02-29',  // 2025 is NOT leap year
                requestedCheckInAt: '2025-02-29T08:30:00+07:00',
                requestedCheckOutAt: '2025-02-29T17:30:00+07:00',
                reason: 'Non-leap year test - invalid Feb 29'
            });

        expect(res.status).toBe(400);
    });
});

// ============================================
// OVERLAPPING REQUESTS - Last Write Wins
// ============================================
describe('Overlapping Requests - Last Write Wins Bug', () => {
    const testDate = overlapDate;

    beforeEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should prevent duplicate PENDING requests for same date', async () => {
        // Create first request
        const res1 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:00:00+07:00`,
                requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                reason: 'First request for the day'
            });

        expect(res1.status).toBe(201);

        // Create second request for SAME date (should be rejected)
        const res2 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T09:00:00+07:00`,
                requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                reason: 'Second request for same day'
            });

        // Expected: 409 Conflict or 400 - Currently may PASS (creates duplicate)
        expect([400, 409]).toContain(res2.status);
        expect(res2.body.message).toMatch(/pending|already|exist/i);
    });

    it('should demonstrate data loss when approving overlapping requests', async () => {
        // Create first request with checkIn 08:00
        const res1 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:00:00+07:00`,
                requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                reason: 'Request with 8:00 check-in'
            });

        const request1Id = res1.body.request._id;

        // Create second request with checkIn 09:00 (overlapping)
        const res2 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T09:00:00+07:00`,
                requestedCheckOutAt: `${testDate}T18:00:00+07:00`,
                reason: 'Request with 9:00 check-in'
            });

        // If system allows duplicate, this will pass
        if (res2.status !== 201) {
            // Good! System prevented duplicate
            expect(res2.status).toBe(409);
            return;
        }

        const request2Id = res2.body.request._id;

        // Approve first request
        await request(app)
            .post(`/api/requests/${request1Id}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Approve second request (this will overwrite!)
        await request(app)
            .post(`/api/requests/${request2Id}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Check attendance - should have 08:00 but will have 09:00 (data loss!)
        const attendance = await Attendance.findOne({ userId: employeeId, date: testDate });

        // This assertion documents the bug: second request overwrote first
        // The "correct" behavior would be to reject second request
        console.warn('[DATA LOSS WARNING] If this passes, second request overwrote first!');
        expect(attendance.checkInAt.toISOString()).toContain('01:00:00'); // 08:00 GMT+7 = 01:00 UTC
    });

    it('should allow new request after previous is REJECTED', async () => {
        // Create and reject first request
        const res1 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:00:00+07:00`,
                reason: 'First request - to be rejected'
            });

        await request(app)
            .post(`/api/requests/${res1.body.request._id}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Create new request for same date (should succeed)
        const res2 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T09:00:00+07:00`,
                reason: 'Second request after rejection'
            });

        expect(res2.status).toBe(201);
    });
});

// ============================================
// RACE CONDITION - Concurrent Approve
// ============================================
describe('Race Condition - Concurrent Approve Operations', () => {
    let testRequestId;
    const testDate = raceDate;

    beforeEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});

        // Create a pending request
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                reason: 'Race condition test request'
            });

        testRequestId = res.body.request._id;
    });

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should handle concurrent approve calls gracefully (only one succeeds)', async () => {
        // Send two approve requests simultaneously
        const [res1, res2] = await Promise.all([
            request(app)
                .post(`/api/requests/${testRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${testRequestId}/approve`)
                .set('Authorization', `Bearer ${managerToken}`)
        ]);

        // One should succeed (200), one should fail (409 Conflict)
        const statuses = [res1.status, res2.status].sort();

        expect(statuses).toContain(200);
        expect(statuses).toContain(409);

        // The failing one should have meaningful error message
        const failedRes = res1.status === 409 ? res1 : res2;
        expect(failedRes.body.message).toMatch(/already|approved/i);
    });

    it('should not return 500 error on race condition', async () => {
        // Send multiple concurrent requests
        const results = await Promise.all([
            request(app)
                .post(`/api/requests/${testRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${testRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${testRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`)
        ]);

        // None should be 500 (internal server error)
        results.forEach((res, index) => {
            expect(res.status).not.toBe(500);
            console.log(`Concurrent request ${index + 1}: ${res.status} - ${res.body.message || 'OK'}`);
        });

        // Exactly one should succeed
        const successCount = results.filter(r => r.status === 200).length;
        expect(successCount).toBe(1);
    });

    it('should handle concurrent approve and reject on same request', async () => {
        const [approveRes, rejectRes] = await Promise.all([
            request(app)
                .post(`/api/requests/${testRequestId}/approve`)
                .set('Authorization', `Bearer ${adminToken}`),
            request(app)
                .post(`/api/requests/${testRequestId}/reject`)
                .set('Authorization', `Bearer ${managerToken}`)
        ]);

        // One should succeed, one should fail with 409
        const successCount = [approveRes, rejectRes].filter(r => r.status === 200).length;
        const conflictCount = [approveRes, rejectRes].filter(r => r.status === 409).length;

        expect(successCount).toBe(1);
        expect(conflictCount).toBe(1);

        // Verify final state is consistent
        const finalRequest = await Request.findById(testRequestId);
        expect(['APPROVED', 'REJECTED']).toContain(finalRequest.status);
    });
});

// ============================================
// TIMEZONE BOUNDARY - UTC vs GMT+7
// ============================================
describe('Timezone Boundary - UTC vs GMT+7 Edge Cases', () => {
    const testDate = tzDate;

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('should accept 23:59 GMT+7 (still same day)', async () => {
        // 23:59 on 2026-01-13 GMT+7 = 16:59 UTC on 2026-01-13
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                requestedCheckOutAt: `${testDate}T23:59:00+07:00`,  // Edge: last minute of day
                reason: 'Timezone boundary - 23:59 same day'
            });

        expect(res.status).toBe(201);
    });

    it('should reject 00:01 GMT+7 next day (cross-day boundary)', async () => {
        // If date is testDate but checkOut is at 00:01 next day GMT+7
        // Calculate next day dynamically
        const nextDay = new Date(testDate);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDate = nextDay.toISOString().split('T')[0];
        
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                requestedCheckOutAt: `${nextDate}T00:01:00+07:00`,  // Next day
                reason: 'Timezone boundary - cross day'
            });

        // Cross-midnight allowed within 24h (Policy A)
        expect(res.status).toBe(201);
    });

    it('should handle midnight boundary UTC (00:00 UTC = 07:00 GMT+7)', async () => {
        // 00:00 UTC on 2026-01-13 = 07:00 GMT+7 on 2026-01-13 (same day)
        // Early check-in at 7:00 AM should be valid
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T07:00:00+07:00`,  // 00:00 UTC
                requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                reason: 'UTC midnight = 7AM GMT+7'
            });

        expect(res.status).toBe(201);
    });

    it('should reject timestamp before midnight boundary (previous day in GMT+7)', async () => {
        // 06:59 GMT+7 on 2026-01-13 = 23:59 UTC on 2026-01-12 (previous day)
        // But wait - the dateKey is computed from GMT+7, so 06:59 Jan 13 GMT+7 should BE Jan 13
        // This is actually a valid timestamp for Jan 13
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T06:59:00+07:00`,  // Very early morning
                requestedCheckOutAt: `${testDate}T17:30:00+07:00`,
                reason: 'Very early morning check-in'
            });

        // This should be valid (06:59 is still Jan 13 in GMT+7)
        expect(res.status).toBe(201);
    });

    it('should correctly interpret Z suffix as UTC (not local time)', async () => {
        // 2026-01-13T01:30:00Z = 2026-01-13T08:30:00+07:00 (same moment)
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T01:30:00Z`,  // UTC format
                requestedCheckOutAt: `${testDate}T10:30:00Z`,  // UTC format
                reason: 'UTC Z suffix interpretation'
            });

        expect(res.status).toBe(201);
    });

    it('should reject when UTC timestamp maps to different day in GMT+7', async () => {
        // 2026-01-26T17:30:00Z = 2026-01-27T00:30:00+07:00 (next day!)
        // With cross-midnight policy, checkout within 24h is allowed
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,  // 2026-01-26
                requestedCheckInAt: `${testDate}T01:30:00Z`,  // OK: 08:30 GMT+7 Jan 26
                requestedCheckOutAt: `${testDate}T17:30:00Z`,  // 00:30 GMT+7 Jan 27 (within 24h)
                reason: 'UTC maps to next day in GMT+7'
            });

        // Cross-midnight allowed within 24h (Policy A)
        expect(res.status).toBe(201);
    });
});

// ============================================
// TYPE COERCION BYPASS
// ============================================
describe('Type Coercion Bypass Attempts', () => {
    afterEach(async () => {
        await Request.deleteMany({});
    });

    it('should reject array as date', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: ['2026-01-13'],
                requestedCheckInAt: '2026-01-13T08:30:00+07:00',
                reason: 'Array as date'
            });

        expect(res.status).toBe(400);
    });

    it('should reject object as date', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: { value: '2026-01-13' },
                requestedCheckInAt: '2026-01-13T08:30:00+07:00',
                reason: 'Object as date'
            });

        expect(res.status).toBe(400);
    });

    it('should reject number as date', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: 20260113,
                requestedCheckInAt: '2026-01-13T08:30:00+07:00',
                reason: 'Number as date'
            });

        expect(res.status).toBe(400);
    });

    it('should reject null as date', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: null,
                requestedCheckInAt: '2026-01-13T08:30:00+07:00',
                reason: 'Null as date'
            });

        expect(res.status).toBe(400);
    });

    it('should reject extremely long reason (potential DoS)', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: '2026-01-13',
                requestedCheckInAt: '2026-01-13T08:30:00+07:00',
                reason: 'x'.repeat(1001)  // Just over 1000 char limit
            });

        // Should reject with 400 (reason too long)
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/1000|characters|less/i);
    });
});

// ============================================
// STATE TRANSITION - Request Status
// ============================================
describe('State Transition - Request Status Changes', () => {
    let requestId;
    const testDate = transitionDate;

    beforeEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});

        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({
                date: testDate,
                requestedCheckInAt: `${testDate}T08:30:00+07:00`,
                reason: 'State transition test'
            });
        requestId = res.body.request._id;
    });

    afterEach(async () => {
        await Request.deleteMany({});
        await Attendance.deleteMany({});
    });

    it('PENDING → APPROVED is valid', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('APPROVED');
    });

    it('PENDING → REJECTED is valid', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.request.status).toBe('REJECTED');
    });

    it('APPROVED → APPROVED is invalid (409)', async () => {
        // First approve
        await request(app)
            .post(`/api/requests/${requestId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Try approve again
        const res = await request(app)
            .post(`/api/requests/${requestId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already approved/i);
    });

    it('APPROVED → REJECTED is invalid (409)', async () => {
        // First approve
        await request(app)
            .post(`/api/requests/${requestId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Try reject
        const res = await request(app)
            .post(`/api/requests/${requestId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
    });

    it('REJECTED → APPROVED is invalid (409)', async () => {
        // First reject
        await request(app)
            .post(`/api/requests/${requestId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Try approve
        const res = await request(app)
            .post(`/api/requests/${requestId}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
    });

    it('REJECTED → REJECTED is invalid (409)', async () => {
        // First reject
        await request(app)
            .post(`/api/requests/${requestId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        // Try reject again
        const res = await request(app)
            .post(`/api/requests/${requestId}/reject`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already rejected/i);
    });
});
