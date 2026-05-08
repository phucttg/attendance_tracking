/**
 * Test Suite: FORGOT_CHECKOUT Approval Flow & Reconciliation Effect
 *
 * Scope: Approving and rejecting ADJUST_TIME / FORGOT_CHECKOUT requests via
 *        POST /api/requests/:id/approve and POST /api/requests/:id/reject.
 *        Verifies the attendance record is reconciled correctly on approval.
 *
 * Techniques:
 *   - State Transition (ST): PENDING → APPROVED/REJECTED, attendance reconciliation
 *   - Equivalence Partitioning (EP): approved/rejected outcomes, field values
 *   - Race Condition: already-reconciled attendance before approve
 *   - RBAC: MANAGER (same team / other team), ADMIN
 *
 * ISO 25010: Functional Suitability, Security, Reliability
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import { createTimeInGMT7, getDateKey } from '../src/utils/dateUtils.js';
import { daysAgoKey } from './testDateHelper.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGMT7Time(dateKey, h, m) {
    return createTimeInGMT7(dateKey, h, m);
}

/**
 * Seed an auto-closed session (what the auto-close service produces).
 */
async function seedAutoClosedSession(userId, dateKey) {
    const checkInAt = buildGMT7Time(dateKey, 9, 0);
    const [y, mo, d] = dateKey.split('-').map(Number);
    const nextDayKey = new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0)).toISOString().slice(0, 10);
    const checkOutAt = buildGMT7Time(nextDayKey, 0, 0);

    return Attendance.create({
        userId,
        date: dateKey,
        checkInAt,
        checkOutAt,
        closeSource: 'SYSTEM_AUTO_MIDNIGHT',
        needsReconciliation: true
    });
}

/**
 * Create a PENDING FORGOT_CHECKOUT request in the DB directly (skip HTTP validation).
 */
async function seedForgotCheckoutRequest(userId, dateKey, attendanceId, checkOutAt) {
    return Request.create({
        userId,
        date: dateKey,
        checkInDate: dateKey,
        type: 'ADJUST_TIME',
        adjustMode: 'FORGOT_CHECKOUT',
        targetAttendanceId: attendanceId,
        requestedCheckOutAt: checkOutAt,
        reason: 'Forgot to check out',
        status: 'PENDING'
    });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let employeeToken;
let employeeId;
let managerToken;
let managerId;
let adminToken;
let otherManagerToken;
let otherManagerId;
let teamId;
let otherTeamId;

beforeAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});

    const passwordHash = await bcrypt.hash('Password123', 10);

    const team = await Team.create({ name: 'Team Alpha' });
    teamId = team._id;

    const otherTeam = await Team.create({ name: 'Team Beta' });
    otherTeamId = otherTeam._id;

    const employee = await User.create({
        employeeCode: 'EMP001',
        name: 'FA Employee',
        email: 'fa_employee@test.com',
        username: 'fa_employee',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    employeeId = employee._id;

    const manager = await User.create({
        employeeCode: 'MGR001',
        name: 'FA Manager',
        email: 'fa_manager@test.com',
        username: 'fa_manager',
        passwordHash,
        role: 'MANAGER',
        teamId,
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    managerId = manager._id;

    const otherManager = await User.create({
        employeeCode: 'MGR002',
        name: 'Other Manager',
        email: 'other_manager@test.com',
        username: 'other_manager',
        passwordHash,
        role: 'MANAGER',
        teamId: otherTeamId,
        isActive: true,
        startDate: new Date('2024-01-01')
    });
    otherManagerId = otherManager._id;

    await User.create({
        employeeCode: 'ADM001',
        name: 'FA Admin',
        email: 'fa_admin@test.com',
        username: 'fa_admin',
        passwordHash,
        role: 'ADMIN',
        isActive: true,
        startDate: new Date('2024-01-01')
    });

    const empLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fa_employee@test.com', password: 'Password123' });
    employeeToken = empLogin.body.token;

    const mgrLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fa_manager@test.com', password: 'Password123' });
    managerToken = mgrLogin.body.token;

    const otherMgrLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'other_manager@test.com', password: 'Password123' });
    otherManagerToken = otherMgrLogin.body.token;

    const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'fa_admin@test.com', password: 'Password123' });
    adminToken = adminLogin.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

// ============================================================================
// FA-HAPPY: Successful approval and reconciliation
// ============================================================================

describe('FA-HAPPY: Approval happy path (State Transition)', () => {
    /**
     * FA-HAPPY-001
     * ST: Approve FORGOT_CHECKOUT → attendance checkOutAt updated to requestedCheckOutAt.
     */
    it('[FA-HAPPY-001] approval updates attendance checkOutAt to requestedCheckOutAt', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const desiredCheckOut = buildGMT7Time(dateKey, 17, 30);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, desiredCheckOut
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);

        const updatedAtt = await Attendance.findById(att._id).lean();
        expect(updatedAtt.checkOutAt).not.toBeNull();
        expect(new Date(updatedAtt.checkOutAt).getTime()).toBe(desiredCheckOut.getTime());
    });

    /**
     * FA-HAPPY-002
     * ST: After approval → needsReconciliation = false on attendance.
     */
    it('[FA-HAPPY-002] approval sets needsReconciliation = false on attendance', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        const updatedAtt = await Attendance.findById(att._id).lean();
        expect(updatedAtt.needsReconciliation).toBe(false);
    });

    /**
     * FA-HAPPY-003
     * EP: After approval → closeSource = 'ADJUST_APPROVAL' on attendance.
     */
    it('[FA-HAPPY-003] approval sets closeSource = ADJUST_APPROVAL on attendance', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        const updatedAtt = await Attendance.findById(att._id).lean();
        expect(updatedAtt.closeSource).toBe('ADJUST_APPROVAL');
    });

    /**
     * FA-HAPPY-004
     * EP: After approval → closedByRequestId = approved request's _id.
     */
    it('[FA-HAPPY-004] approval sets closedByRequestId to the request _id', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        const updatedAtt = await Attendance.findById(att._id).lean();
        expect(updatedAtt.closedByRequestId).not.toBeNull();
        expect(updatedAtt.closedByRequestId.toString()).toBe(req._id.toString());
    });

    /**
     * FA-HAPPY: Request status transitions to APPROVED.
     */
    it('[FA-HAPPY-005] approved request has status = APPROVED', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        const updatedReq = await Request.findById(req._id).lean();
        expect(updatedReq.status).toBe('APPROVED');
    });
});

// ============================================================================
// FA-RACE: Race condition protection
// ============================================================================

describe('FA-RACE: Race condition tests', () => {
    /**
     * FA-RACE-001
     * DT: Attendance already reconciled (needsReconciliation=false) before approve
     *     → approve fails with systemRejectReason set / 409.
     */
    it('[FA-RACE-001] approving when attendance already reconciled returns error', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        // Simulate: attendance was reconciled by another flow BEFORE this approval
        await Attendance.findByIdAndUpdate(att._id, {
            $set: {
                closeSource: 'ADJUST_APPROVAL',
                needsReconciliation: false
            }
        });

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        // Must not return 200; either 409 (conflict) or the request gets auto-rejected
        expect([400, 409]).toContain(res.status);
    });

    /**
     * FA-RACE-002
     * Race Condition: Two approvers try to approve same request concurrently
     *                 → only one succeeds (409 for the second).
     */
    it('[FA-RACE-002] concurrent approvals: only first succeeds', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        // Both manager and admin try to approve simultaneously
        const [r1, r2] = await Promise.all([
            request(app)
                .post(`/api/requests/${req._id}/approve`)
                .set('Authorization', `Bearer ${managerToken}`),
            request(app)
                .post(`/api/requests/${req._id}/approve`)
                .set('Authorization', `Bearer ${adminToken}`)
        ]);

        const statuses = [r1.status, r2.status].sort();
        // One must succeed (200), the other must fail (409)
        expect(statuses).toEqual([200, 409]);
    });
});

// ============================================================================
// FA-RBAC: Role-based access control
// ============================================================================

describe('FA-RBAC: Manager and Admin approval RBAC', () => {
    /**
     * FA-RBAC-001
     * RBAC: MANAGER approves FORGOT_CHECKOUT for own team member → success.
     */
    it('[FA-RBAC-001] MANAGER can approve request from own team member', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
    });

    /**
     * FA-RBAC-002
     * RBAC: MANAGER from OTHER team attempts to approve → 403.
     */
    it('[FA-RBAC-002] MANAGER from different team cannot approve request', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${otherManagerToken}`);

        expect(res.status).toBe(403);
    });

    /**
     * FA-RBAC-003
     * RBAC: ADMIN approves request for any user → success.
     */
    it('[FA-RBAC-003] ADMIN can approve FORGOT_CHECKOUT for any user', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
    });

    /**
     * RBAC: EMPLOYEE cannot approve own request → 403.
     */
    it('[FA-RBAC-EMP] EMPLOYEE cannot approve requests', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/approve`)
            .set('Authorization', `Bearer ${employeeToken}`);

        expect(res.status).toBe(403);
    });
});

// ============================================================================
// FA-REJECT: Rejection leaves attendance unchanged
// ============================================================================

describe('FA-REJECT: Rejection does not modify attendance', () => {
    /**
     * FA-REJECT-001
     * ST: Reject FORGOT_CHECKOUT → attendance unchanged, needsReconciliation stays true.
     */
    it('[FA-REJECT-001] rejected request leaves attendance needsReconciliation=true', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const originalCheckOut = att.checkOutAt;

        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        const res = await request(app)
            .post(`/api/requests/${req._id}/reject`)
            .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);

        const updatedAtt = await Attendance.findById(att._id).lean();
        // checkOutAt must still be the midnight auto-close value (unchanged)
        expect(updatedAtt.checkOutAt.getTime()).toBe(new Date(originalCheckOut).getTime());
        // closeSource must still be SYSTEM_AUTO_MIDNIGHT (not changed by rejection)
        expect(updatedAtt.closeSource).toBe('SYSTEM_AUTO_MIDNIGHT');
        // needsReconciliation must remain true
        expect(updatedAtt.needsReconciliation).toBe(true);
    });

    /**
     * ST: Rejected request status = REJECTED.
     */
    it('[FA-REJECT-002] rejected request has status = REJECTED', async () => {
        const dateKey = daysAgoKey(1);
        const att = await seedAutoClosedSession(employeeId, dateKey);
        const req = await seedForgotCheckoutRequest(
            employeeId, dateKey, att._id, buildGMT7Time(dateKey, 17, 30)
        );

        await request(app)
            .post(`/api/requests/${req._id}/reject`)
            .set('Authorization', `Bearer ${managerToken}`);

        const updatedReq = await Request.findById(req._id).lean();
        expect(updatedReq.status).toBe('REJECTED');
    });
});
