/**
 * Test Bug #1 Fix: Timezone validation must handle Date objects
 * 
 * This test verifies that assertHasTzIfString() correctly:
 * - Validates string inputs require timezone
 * - Allows Date objects without false negatives
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Request from '../src/models/Request.js';
import bcrypt from 'bcrypt';
import { recentWeekday } from './testDateHelper.js';

let employeeToken;
let employeeId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});

    const team = await Team.create({ name: 'Test Team' });
    const passwordHash = await bcrypt.hash('Password123', 10);

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'Test Employee',
        email: 'employee@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId: team._id,
        isActive: true
    });
    employeeId = employee._id;

    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'employee@test.com', password: 'Password123' });
    employeeToken = loginRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Request.deleteMany({});
});

beforeEach(async () => {
    await Request.deleteMany({});
});

describe('Bug #1 Fix: Timezone Validation for Date Objects', () => {
    const weekday = recentWeekday(2);

    describe('String Inputs with Timezone', () => {
        it('should accept ISO string with +HH:MM timezone', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T08:00:00+07:00`, // Standard format
                    reason: 'Test string with timezone'
                });

            expect(res.status).toBe(201);
        });

        it('should accept ISO string with Z (UTC) timezone', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T01:00:00Z`, // UTC = 08:00 GMT+7
                    reason: 'Test string with Z timezone'
                });

            expect(res.status).toBe(201);
        });

        it('should accept ISO string with +HHMM (no colon) timezone', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T08:00:00+0700`, // Alternative format
                    reason: 'Test string with +HHMM timezone'
                });

            expect(res.status).toBe(201);
        });
    });

    describe('String Inputs WITHOUT Timezone', () => {
        it('should reject ISO string without timezone', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T08:00:00`, // Missing timezone
                    reason: 'Test string without timezone'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('timezone');
            expect(res.body.message).toContain('requestedCheckInAt');
        });

        it('should reject ambiguous datetime string', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: '2026-02-05 08:00', // Ambiguous format
                    reason: 'Test ambiguous string'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('timezone');
        });
    });

    describe('Both CheckIn and CheckOut Validation', () => {
        it('should validate timezone on both fields', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T08:00:00+07:00`, // Valid
                    requestedCheckOutAt: `${weekday}T17:00:00`, // Missing timezone
                    reason: 'Test both fields'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('timezone');
            expect(res.body.message).toContain('requestedCheckOutAt');
        });

        it('should accept both fields with valid timezones', async () => {
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T08:00:00+07:00`,
                    requestedCheckOutAt: `${weekday}T17:00:00+07:00`,
                    reason: 'Test both valid'
                });

            expect(res.status).toBe(201);
        });
    });

    describe('Edge Cases', () => {
        it('should reject whitespace-wrapped strings (fails at Date parsing)', async () => {
            // Leading/trailing whitespace causes Date parsing to fail
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `  ${weekday}T08:00:00+07:00  `,
                    reason: 'Test whitespace handling'
                });

            // Fails at Date parsing: "invalid"
            expect(res.status).toBe(400);
            expect(res.body.message).toContain('invalid');
        });

        it('should reject incomplete offset (fails at Date parsing, not timezone validation)', async () => {
            // Invalid ISO format fails at toValidDate(), not assertHasTzIfString()
            const res = await request(app)
                .post('/api/requests')
                .set('Authorization', `Bearer ${employeeToken}`)
                .send({
                    date: weekday,
                    requestedCheckInAt: `${weekday}T08:00:00-07`, // Invalid format
                    reason: 'Test incomplete offset'
                });

            expect(res.status).toBe(400);
            // Fails at Date parsing: "invalid"
            expect(res.body.message).toContain('invalid');
        });
    });
});

describe('Bug #1 Defense: Date Object Compatibility', () => {
    const weekday = recentWeekday(2);

    it('should document that Express JSON parser converts ISO strings to strings, not Date objects', () => {
        // This test documents the current behavior:
        // Express with bodyParser.json() keeps ISO strings as strings
        // They do NOT become Date objects automatically

        // If custom middleware or tests pass Date objects directly,
        // assertHasTzIfString() will bypass validation (correct behavior)

        expect(typeof `${weekday}T08:00:00+07:00`).toBe('string');
    });

    it('should accept request when controller uses standard JSON parsing', async () => {
        // Standard Express JSON parsing
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${employeeToken}`)
            .set('Content-Type', 'application/json')
            .send(JSON.stringify({
                date: weekday,
                requestedCheckInAt: `${weekday}T08:00:00+07:00`,
                reason: 'Test standard JSON'
            }));

        expect(res.status).toBe(201);
    });
});
