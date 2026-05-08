/**
 * Test Suite: Auto-Close Service
 *
 * Scope: Unit + integration tests for autoCloseOpenSessionsBeforeToday(),
 *        startAutoCloseScheduler(), and runAutoCloseCatchupOnStartup().
 *
 * Techniques:
 *   - Equivalence Partitioning (EP): open/closed session states, multi-user runs
 *   - Boundary Value Analysis (BVA): today's sessions not closed, 23:59 check-in
 *   - State Transition: idempotency (running twice)
 *   - Error Guessing: corrupted checkInAt, startup catch-up with errors
 *
 * ISO 25010: Functional Suitability, Reliability, Performance Efficiency
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Attendance from '../src/models/Attendance.js';
import {
    autoCloseOpenSessionsBeforeToday,
    runAutoCloseCatchupOnStartup,
    startAutoCloseScheduler
} from '../src/services/autoCloseService.js';
import { getDateKey, createTimeInGMT7 } from '../src/utils/dateUtils.js';
import { daysAgoKey } from './testDateHelper.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a UTC Date for HH:mm on a given YYYY-MM-DD in GMT+7.
 * e.g. buildGMT7Time('2026-01-15', 23, 59) → represents 23:59 GMT+7 on 2026-01-15
 */
function buildGMT7Time(dateKey, h, m) {
    return createTimeInGMT7(dateKey, h, m);
}

/**
 * Get today's date key in GMT+7.
 */
function todayKey() {
    return getDateKey(new Date());
}

/**
 * Get yesterday's date key in GMT+7.
 */
function yesterdayKey() {
    return daysAgoKey(1);
}

/**
 * Get a date key N days ago in GMT+7.
 */
function dateKeyNDaysAgo(n) {
    return daysAgoKey(n);
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
    await Attendance.deleteMany({});
});

afterAll(async () => {
    await Attendance.deleteMany({});
});

beforeEach(async () => {
    await Attendance.deleteMany({});
});

// ============================================================================
// FUNCTIONAL: autoCloseOpenSessionsBeforeToday
// ============================================================================

describe('autoCloseOpenSessionsBeforeToday – Functional (EP)', () => {
    /**
     * AC-FUNC-001
     * EP: Open session from yesterday → auto-close sets checkOutAt = today 00:00 GMT+7.
     */
    it('[AC-FUNC-001] closes open session from yesterday with midnight checkOutAt', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0) // 09:00 GMT+7 yesterday
        });

        const result = await autoCloseOpenSessionsBeforeToday();
        expect(result.processed).toBe(1);
        expect(result.closed).toBe(1);

        const updated = await Attendance.findOne({ userId, date: yKey }).lean();
        expect(updated.checkOutAt).not.toBeNull();

        // checkOutAt should be midnight GMT+7 of today's date (i.e., 17:00 UTC = 00:00 GMT+7)
        const expectedMidnight = buildGMT7Time(todayKey(), 0, 0);
        expect(updated.checkOutAt.getTime()).toBe(expectedMidnight.getTime());
    });

    /**
     * AC-FUNC-002
     * EP: Open session from 5 days ago → auto-close sets checkOutAt = dayAfterCheckIn 00:00 GMT+7.
     */
    it('[AC-FUNC-002] closes open session from 5 days ago with correct midnight', async () => {
        const oldDate = dateKeyNDaysAgo(5);
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId,
            date: oldDate,
            checkInAt: buildGMT7Time(oldDate, 10, 0) // 10:00 GMT+7 5 days ago
        });

        const result = await autoCloseOpenSessionsBeforeToday();
        expect(result.processed).toBe(1);
        expect(result.closed).toBe(1);

        const updated = await Attendance.findOne({ userId, date: oldDate }).lean();
        expect(updated.checkOutAt).not.toBeNull();

        // Get next day's midnight
        const [y, mo, d] = oldDate.split('-').map(Number);
        const nextDayDate = new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0));
        const nextDayKey = nextDayDate.toISOString().slice(0, 10);
        const expectedMidnight = buildGMT7Time(nextDayKey, 0, 0);

        expect(updated.checkOutAt.getTime()).toBe(expectedMidnight.getTime());
    });

    /**
     * AC-FUNC-003
     * EP: Multiple users with open sessions → all closed in a single bulk run.
     */
    it('[AC-FUNC-003] closes open sessions for multiple users in one run', async () => {
        const yKey = yesterdayKey();
        const users = [
            new mongoose.Types.ObjectId(),
            new mongoose.Types.ObjectId(),
            new mongoose.Types.ObjectId()
        ];

        for (const userId of users) {
            await Attendance.create({
                userId,
                date: yKey,
                checkInAt: buildGMT7Time(yKey, 8, 30)
            });
        }

        const result = await autoCloseOpenSessionsBeforeToday();
        expect(result.processed).toBe(3);
        expect(result.closed).toBe(3);

        for (const userId of users) {
            const updated = await Attendance.findOne({ userId, date: yKey }).lean();
            expect(updated.checkOutAt).not.toBeNull();
        }
    });

    /**
     * AC-FUNC-004
     * EP: No open sessions → returns { processed: 0, closed: 0 }.
     */
    it('[AC-FUNC-004] returns zero counts when no open sessions exist', async () => {
        const result = await autoCloseOpenSessionsBeforeToday();
        expect(result.processed).toBe(0);
        expect(result.closed).toBe(0);
    });

    /**
     * AC-FUNC-005
     * BVA: Today's open session (not yet midnight) → must NOT be closed.
     */
    it('[AC-FUNC-005] does NOT close open session from today', async () => {
        const today = todayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId,
            date: today,
            checkInAt: new Date()
        });

        const result = await autoCloseOpenSessionsBeforeToday();
        expect(result.processed).toBe(0);
        expect(result.closed).toBe(0);

        // Session must still be open
        const att = await Attendance.findOne({ userId, date: today }).lean();
        expect(att.checkOutAt).toBeNull();
    });

    /**
     * AC-FUNC-005b
     * EP: Already-closed session from yesterday → NOT processed (checkOutAt != null).
     */
    it('[AC-FUNC-005b] skips already-closed sessions from past days', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId,
            date: yKey,
            checkInAt: buildGMT7Time(yKey, 9, 0),
            checkOutAt: buildGMT7Time(yKey, 17, 30),
            closeSource: 'USER_CHECKOUT'
        });

        const result = await autoCloseOpenSessionsBeforeToday();
        expect(result.processed).toBe(0);
        expect(result.closed).toBe(0);
    });
});

// ============================================================================
// FIELD VALUES: After auto-close
// ============================================================================

describe('autoCloseOpenSessionsBeforeToday – Field values after close', () => {
    /**
     * AC-FIELD-001
     * EP: After auto-close: closeSource = 'SYSTEM_AUTO_MIDNIGHT'.
     */
    it('[AC-FIELD-001] sets closeSource = SYSTEM_AUTO_MIDNIGHT', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({ userId, date: yKey, checkInAt: buildGMT7Time(yKey, 9, 0) });
        await autoCloseOpenSessionsBeforeToday();

        const updated = await Attendance.findOne({ userId }).lean();
        expect(updated.closeSource).toBe('SYSTEM_AUTO_MIDNIGHT');
    });

    /**
     * AC-FIELD-002
     * EP: After auto-close: needsReconciliation = true.
     */
    it('[AC-FIELD-002] sets needsReconciliation = true', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({ userId, date: yKey, checkInAt: buildGMT7Time(yKey, 9, 0) });
        await autoCloseOpenSessionsBeforeToday();

        const updated = await Attendance.findOne({ userId }).lean();
        expect(updated.needsReconciliation).toBe(true);
    });

    /**
     * AC-FIELD-003
     * EP: After auto-close: closedByRequestId = null.
     */
    it('[AC-FIELD-003] sets closedByRequestId = null', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({ userId, date: yKey, checkInAt: buildGMT7Time(yKey, 9, 0) });
        await autoCloseOpenSessionsBeforeToday();

        const updated = await Attendance.findOne({ userId }).lean();
        expect(updated.closedByRequestId).toBeNull();
    });
});

// ============================================================================
// BVA / ERROR GUESSING
// ============================================================================

describe('autoCloseOpenSessionsBeforeToday – BVA & Error guessing', () => {
    /**
     * AC-BVA-001
     * BVA: checkIn at 23:59 GMT+7 → checkout midnight next day (1 minute gap).
     *      Resulting session must satisfy checkOutAt > checkInAt.
     */
    it('[AC-BVA-001] check-in at 23:59 yields checkout 1 min later (midnight guard)', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();
        const checkInAt = buildGMT7Time(yKey, 23, 59); // 23:59 GMT+7 = 16:59 UTC

        await Attendance.create({ userId, date: yKey, checkInAt });
        await autoCloseOpenSessionsBeforeToday();

        const updated = await Attendance.findOne({ userId }).lean();
        expect(updated.checkOutAt).not.toBeNull();
        expect(updated.checkOutAt.getTime()).toBeGreaterThan(updated.checkInAt.getTime());
    });

    /**
     * AC-BVA-002
     * Error Guessing: Corrupted checkInAt (set to after midnight) → guard adds 1 minute
     *                 so checkOutAt > checkInAt invariant holds.
     */
    it('[AC-BVA-002] corrupted checkInAt after midnight still produces valid checkOutAt', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();
        // Simulate corrupted: checkInAt is at D+1 00:30 which is AFTER the computed midnight
        const [y, mo, d] = yKey.split('-').map(Number);
        const corruptedCheckIn = new Date(Date.UTC(y, mo - 1, d + 1, 17 + 1, 30, 0)); // 00:30 D+1 next day UTC+7

        // Direct DB insert to bypass schema validator
        await Attendance.collection.insertOne({
            userId,
            date: yKey,
            checkInAt: corruptedCheckIn,
            checkOutAt: null,
            closeSource: null,
            needsReconciliation: false,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await autoCloseOpenSessionsBeforeToday();

        const updated = await Attendance.findOne({ userId, date: yKey }).lean();
        expect(updated.checkOutAt).not.toBeNull();
        // Guard: checkOutAt must be strictly after checkInAt
        expect(updated.checkOutAt.getTime()).toBeGreaterThan(updated.checkInAt.getTime());
    });
});

// ============================================================================
// IDEMPOTENCY
// ============================================================================

describe('autoCloseOpenSessionsBeforeToday – Idempotency (State Transition)', () => {
    /**
     * AC-IDEM-001
     * ST: Run auto-close twice → second run returns { processed: 0 } (idempotent).
     */
    it('[AC-IDEM-001] running twice is idempotent – second run finds nothing to close', async () => {
        const yKey = yesterdayKey();
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({ userId, date: yKey, checkInAt: buildGMT7Time(yKey, 9, 0) });

        // First run: closes the session
        const run1 = await autoCloseOpenSessionsBeforeToday();
        expect(run1.closed).toBe(1);

        // Second run: nothing to close
        const run2 = await autoCloseOpenSessionsBeforeToday();
        expect(run2.processed).toBe(0);
        expect(run2.closed).toBe(0);

        // Verify the record was not touched again
        const updated = await Attendance.findOne({ userId }).lean();
        expect(updated.closeSource).toBe('SYSTEM_AUTO_MIDNIGHT');
        expect(updated.needsReconciliation).toBe(true);
    });
});

// ============================================================================
// STARTUP CATCH-UP: runAutoCloseCatchupOnStartup
// ============================================================================

describe('runAutoCloseCatchupOnStartup', () => {
    /**
     * AC-CATCH-001
     * EP: Catch-up closes sessions missed during downtime.
     */
    it('[AC-CATCH-001] startup catch-up closes overdue sessions', async () => {
        const older = dateKeyNDaysAgo(3);
        const userId = new mongoose.Types.ObjectId();

        await Attendance.create({
            userId,
            date: older,
            checkInAt: buildGMT7Time(older, 9, 0)
        });

        const result = await runAutoCloseCatchupOnStartup();
        expect(result.processed).toBeGreaterThanOrEqual(1);
        expect(result.closed).toBeGreaterThanOrEqual(1);
        expect(result.reason).toBe('startup-catchup');

        const updated = await Attendance.findOne({ userId, date: older }).lean();
        expect(updated.checkOutAt).not.toBeNull();
        expect(updated.closeSource).toBe('SYSTEM_AUTO_MIDNIGHT');
        expect(updated.needsReconciliation).toBe(true);
    });

    /**
     * AC-CATCH-002
     * EP: Catch-up with no overdue sessions → returns { processed: 0 }.
     */
    it('[AC-CATCH-002] startup catch-up with no overdue sessions returns zero counts', async () => {
        const result = await runAutoCloseCatchupOnStartup();
        expect(result.processed).toBe(0);
        expect(result.closed).toBe(0);
        expect(result.reason).toBe('startup-catchup');
    });

    /**
     * AC-CATCH-003
     * Error Guessing: The public wrapper must never re-throw even when the DB fails.
     *                 Simulated by calling with no collections available.
     */
    it('[AC-CATCH-003] startup catch-up returns safe default on error without crashing', async () => {
        // Drop the collection temporarily to force an error
        const collection = Attendance.collection;

        // Mock by temporarily using a bad query that throws
        const origFind = Attendance.find.bind(Attendance);
        let callCount = 0;
        Attendance.find = (filter) => {
            callCount += 1;
            if (callCount === 1) {
                throw new Error('Simulated DB error');
            }
            return origFind(filter);
        };

        let result;
        try {
            result = await runAutoCloseCatchupOnStartup();
        } finally {
            Attendance.find = origFind; // Restore
        }

        // Must not throw and must return safe default
        expect(result).toBeDefined();
        expect(result.processed).toBe(0);
        expect(result.closed).toBe(0);
        expect(result.reason).toBe('startup-catchup');
    });
});

// ============================================================================
// SCHEDULER: startAutoCloseScheduler guard flag
// ============================================================================

describe('startAutoCloseScheduler – Guard flag (Error Guessing)', () => {
    /**
     * AC-SCHED-001
     * Error Guessing: Calling startAutoCloseScheduler() twice must not start
     *                 a second timer (guard flag prevents re-entry).
     *
     * Note: We cannot easily inspect the timer count directly, but we can
     *       verify the function does not throw and returns gracefully the
     *       second time (the guard returns early without scheduling again).
     */
    it('[AC-SCHED-001] startAutoCloseScheduler() is safe to call multiple times', () => {
        // Should not throw on first or second call
        expect(() => startAutoCloseScheduler()).not.toThrow();
        expect(() => startAutoCloseScheduler()).not.toThrow();
    });
});
