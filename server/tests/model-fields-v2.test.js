/**
 * Test Suite: Model Fields V2 – Schema Validation
 *
 * Scope: Schema-level validation for new Attendance and Request fields introduced
 *        in Plan V2.1 (Zero-Stuck Forgot Checkout).
 *
 * Techniques: Equivalence Partitioning (EP), Boundary Value Analysis (BVA),
 *             Decision Table Testing
 *
 * ISO 25010: Functional Suitability (Correctness), Maintainability (Changeability)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import Attendance, { ATTENDANCE_CLOSE_SOURCES } from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';

// Helper: create a minimal valid Attendance document (no save)
function makeAttendance(overrides = {}) {
    const userId = new mongoose.Types.ObjectId();
    return new Attendance({
        userId,
        date: '2026-01-15',
        checkInAt: new Date('2026-01-15T01:00:00.000Z'), // 08:00 GMT+7
        ...overrides
    });
}

// Helper: create a minimal valid ADJUST_TIME Request document (no save)
function makeAdjustRequest(overrides = {}) {
    const userId = new mongoose.Types.ObjectId();
    return new Request({
        userId,
        date: '2026-01-15',
        checkInDate: '2026-01-15',
        type: 'ADJUST_TIME',
        reason: 'Test reason',
        requestedCheckInAt: new Date('2026-01-15T01:00:00.000Z'),
        ...overrides
    });
}

beforeAll(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

afterAll(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

// ============================================================================
// ATTENDANCE: closeSource field
// ============================================================================

describe('Attendance.closeSource – EP & BVA', () => {
    /**
     * MF-ATT-001
     * EP: All 4 valid enum values must be accepted.
     */
    it('[MF-ATT-001] accepts all valid closeSource values', async () => {
        for (const source of ATTENDANCE_CLOSE_SOURCES) {
            const att = makeAttendance({
                userId: new mongoose.Types.ObjectId(),
                date: `2026-01-${String(ATTENDANCE_CLOSE_SOURCES.indexOf(source) + 10).padStart(2, '0')}`,
                checkOutAt: new Date('2026-01-15T10:00:00.000Z'),
                closeSource: source
            });
            const err = att.validateSync();
            expect(err, `Expected no error for closeSource=${source}`).toBeUndefined();
        }
    });

    /**
     * MF-ATT-002
     * BVA: An invalid closeSource value must produce a validation error.
     */
    it('[MF-ATT-002] rejects invalid closeSource value', () => {
        const att = makeAttendance({ closeSource: 'INVALID_SOURCE' });
        const err = att.validateSync();
        expect(err).toBeDefined();
        expect(err.errors.closeSource).toBeDefined();
    });

    /**
     * MF-ATT-003
     * EP: When closeSource is not provided, it must default to null.
     */
    it('[MF-ATT-003] closeSource defaults to null when not provided', () => {
        const att = makeAttendance();
        expect(att.closeSource).toBeNull();
    });
});

// ============================================================================
// ATTENDANCE: needsReconciliation field
// ============================================================================

describe('Attendance.needsReconciliation – defaults', () => {
    /**
     * MF-ATT-004
     * EP: Field should default to false.
     */
    it('[MF-ATT-004] needsReconciliation defaults to false', () => {
        const att = makeAttendance();
        expect(att.needsReconciliation).toBe(false);
    });

    it('[MF-ATT-004b] needsReconciliation can be set to true', () => {
        const att = makeAttendance({ needsReconciliation: true });
        const err = att.validateSync();
        expect(err).toBeUndefined();
        expect(att.needsReconciliation).toBe(true);
    });
});

// ============================================================================
// ATTENDANCE: closedByRequestId field
// ============================================================================

describe('Attendance.closedByRequestId – ObjectId ref', () => {
    /**
     * MF-ATT-005
     * EP: Accepts a valid ObjectId.
     */
    it('[MF-ATT-005] closedByRequestId accepts valid ObjectId', () => {
        const reqId = new mongoose.Types.ObjectId();
        const att = makeAttendance({
            checkOutAt: new Date('2026-01-15T10:00:00.000Z'),
            closeSource: 'ADJUST_APPROVAL',
            closedByRequestId: reqId
        });
        const err = att.validateSync();
        expect(err).toBeUndefined();
        expect(att.closedByRequestId.toString()).toBe(reqId.toString());
    });

    it('[MF-ATT-005b] closedByRequestId defaults to null', () => {
        const att = makeAttendance();
        expect(att.closedByRequestId).toBeNull();
    });
});

// ============================================================================
// REQUEST: adjustMode field
// ============================================================================

describe('Request.adjustMode – EP', () => {
    /**
     * MF-REQ-001
     * EP: Both valid adjustMode values must be accepted.
     */
    it('[MF-REQ-001] adjustMode accepts GENERAL', async () => {
        const req = makeAdjustRequest({ adjustMode: 'GENERAL' });
        await expect(req.validate()).resolves.toBeUndefined();
        expect(req.adjustMode).toBe('GENERAL');
    });

    it('[MF-REQ-001b] adjustMode accepts FORGOT_CHECKOUT when targetAttendanceId is provided', async () => {
        const targetId = new mongoose.Types.ObjectId();
        const req = makeAdjustRequest({
            adjustMode: 'FORGOT_CHECKOUT',
            targetAttendanceId: targetId,
            requestedCheckInAt: null,
            requestedCheckOutAt: new Date('2026-01-15T10:00:00.000Z'),
            // date will be synced from checkInDate in pre-validate hook
        });
        // The pre-validate hook should not produce an error for valid FORGOT_CHECKOUT
        await expect(req.validate()).resolves.toBeUndefined();
    });

    /**
     * MF-REQ-002
     * EP: adjustMode defaults to null (pre-validate sets 'GENERAL' for ADJUST_TIME).
     * After pre-validate hook runs, ADJUST_TIME defaults adjustMode to 'GENERAL'.
     */
    it('[MF-REQ-002] adjustMode gets set to GENERAL by pre-validate for ADJUST_TIME', async () => {
        const req = makeAdjustRequest({ adjustMode: undefined });
        await req.validate();
        expect(req.adjustMode).toBe('GENERAL');
    });

    /**
     * MF-REQ-003
     * EP: targetAttendanceId accepts valid ObjectId.
     */
    it('[MF-REQ-003] targetAttendanceId accepts valid ObjectId', () => {
        const targetId = new mongoose.Types.ObjectId();
        const req = makeAdjustRequest({
            adjustMode: 'FORGOT_CHECKOUT',
            targetAttendanceId: targetId,
            requestedCheckInAt: null,
            requestedCheckOutAt: new Date('2026-01-15T10:00:00.000Z')
        });
        expect(req.targetAttendanceId.toString()).toBe(targetId.toString());
    });

    /**
     * MF-REQ-004
     * EP: systemRejectReason accepts a string.
     */
    it('[MF-REQ-004] systemRejectReason stores string value', () => {
        const req = makeAdjustRequest({ systemRejectReason: 'SESSION_ALREADY_RECONCILED' });
        expect(req.systemRejectReason).toBe('SESSION_ALREADY_RECONCILED');
    });

    it('[MF-REQ-004b] systemRejectReason defaults to null', () => {
        const req = makeAdjustRequest();
        expect(req.systemRejectReason).toBeNull();
    });
});

// ============================================================================
// REQUEST: Pre-validate invariant – FORGOT_CHECKOUT without targetAttendanceId
// ============================================================================

describe('Request pre-validate – Decision Table', () => {
    /**
     * MF-REQ-005
     * Decision Table: FORGOT_CHECKOUT without targetAttendanceId → validation error.
     */
    it('[MF-REQ-005] FORGOT_CHECKOUT without targetAttendanceId fails pre-validate', async () => {
        const req = makeAdjustRequest({
            adjustMode: 'FORGOT_CHECKOUT',
            targetAttendanceId: null,
            requestedCheckInAt: null,
            requestedCheckOutAt: new Date('2026-01-15T10:00:00.000Z')
        });
        await expect(req.validate()).rejects.toThrow(/targetAttendanceId/i);
    });

    /**
     * Decision Table: GENERAL (default) with targetAttendanceId → targetAttendanceId gets cleared.
     */
    it('[MF-REQ-005b] GENERAL mode clears targetAttendanceId via pre-validate', async () => {
        const targetId = new mongoose.Types.ObjectId();
        const req = makeAdjustRequest({
            adjustMode: 'GENERAL',
            targetAttendanceId: targetId
        });
        await req.validate();
        // The hook sets targetAttendanceId = null for GENERAL
        expect(req.targetAttendanceId).toBeNull();
    });
});

// ============================================================================
// REQUEST: Unique index – PENDING ADJUST_TIME per (userId, checkInDate)
// ============================================================================

describe('Request unique index – PENDING ADJUST_TIME per (userId, checkInDate)', () => {
    afterEach(async () => {
        await Request.deleteMany({});
    });

    /**
     * MF-IDX-001
     * EP: Inserting two PENDING ADJUST_TIME requests for the same user+checkInDate must fail.
     */
    it('[MF-IDX-001] rejects duplicate PENDING ADJUST_TIME for same (userId, checkInDate)', async () => {
        const userId = new mongoose.Types.ObjectId();
        const baseDoc = {
            userId,
            date: '2026-01-15',
            checkInDate: '2026-01-15',
            type: 'ADJUST_TIME',
            adjustMode: 'GENERAL',
            reason: 'first request',
            requestedCheckInAt: new Date('2026-01-15T01:00:00.000Z'),
            status: 'PENDING'
        };

        await Request.create(baseDoc);

        // Second insert – must violate the partial unique index
        await expect(
            Request.create({ ...baseDoc, reason: 'second request' })
        ).rejects.toMatchObject({ code: 11000 });
    });

    /**
     * EP: Same user+checkInDate but status=APPROVED must NOT be blocked by partial index.
     */
    it('[MF-IDX-001b] allows non-PENDING request on same (userId, checkInDate)', async () => {
        const userId = new mongoose.Types.ObjectId();
        const doc = {
            userId,
            date: '2026-01-15',
            checkInDate: '2026-01-15',
            type: 'ADJUST_TIME',
            adjustMode: 'GENERAL',
            reason: 'approved request',
            requestedCheckInAt: new Date('2026-01-15T01:00:00.000Z'),
            status: 'APPROVED'
        };

        // Two APPROVED docs for same user+checkInDate should be fine
        await Request.create(doc);
        await expect(Request.create({ ...doc })).resolves.toBeDefined();
    });

    /**
     * MF-IDX-001c
     * EP: The FORGOT_CHECKOUT unique index constraint also applies via the same partial index.
     */
    it('[MF-IDX-001c] rejects duplicate PENDING FORGOT_CHECKOUT for same (userId, checkInDate)', async () => {
        const userId = new mongoose.Types.ObjectId();
        const targetId = new mongoose.Types.ObjectId();
        const baseDoc = {
            userId,
            date: '2026-01-15',
            checkInDate: '2026-01-15',
            type: 'ADJUST_TIME',
            adjustMode: 'FORGOT_CHECKOUT',
            targetAttendanceId: targetId,
            reason: 'forgot checkout',
            requestedCheckOutAt: new Date('2026-01-15T11:00:00.000Z'),
            status: 'PENDING'
        };

        await Request.create(baseDoc);

        await expect(
            Request.create({ ...baseDoc, reason: 'duplicate forgot checkout' })
        ).rejects.toMatchObject({ code: 11000 });
    });
});
