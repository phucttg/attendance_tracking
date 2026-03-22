import mongoose from 'mongoose';
import Holiday from '../models/Holiday.js';
import HolidayChangeLog from '../models/HolidayChangeLog.js';
import { getTodayDateKey } from '../utils/dateUtils.js';
import {
    getTransactionOptions,
    isReplicaSetAvailable,
    requiresHolidayMutationTransactions
} from '../config/database.js';

function createHttpError(message, statusCode, expose = statusCode < 500) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.expose = expose;
    return error;
}

function isDuplicateKeyError(error) {
    return error?.code === 11000;
}

export function isValidCalendarDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(dateStr);
}

function sanitizeHoliday(holiday) {
    if (!holiday) return null;
    return {
        _id: holiday._id,
        date: holiday.date,
        name: holiday.name
    };
}

export function isHolidayLocked(dateKey, todayDateKey = getTodayDateKey()) {
    return Boolean(dateKey) && dateKey < todayDateKey;
}

export function serializeHolidayListItem(holiday, todayDateKey = getTodayDateKey()) {
    return {
        ...sanitizeHoliday(holiday),
        isLocked: isHolidayLocked(holiday?.date, todayDateKey)
    };
}

function validateHolidayInput({ date, name }) {
    if (!date) {
        throw createHttpError('Date is required', 400);
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw createHttpError('Date must be in YYYY-MM-DD format', 400);
    }

    if (!isValidCalendarDate(date)) {
        throw createHttpError('Date is not a valid calendar date', 400);
    }

    if (!name || !name.trim()) {
        throw createHttpError('Name is required', 400);
    }

    return {
        date,
        name: name.trim()
    };
}

function validateRangeInput({ startDate, endDate, name }) {
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        throw createHttpError('startDate is required in YYYY-MM-DD format', 400);
    }

    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw createHttpError('endDate is required in YYYY-MM-DD format', 400);
    }

    if (!isValidCalendarDate(startDate)) {
        throw createHttpError('startDate is not a valid calendar date', 400);
    }

    if (!isValidCalendarDate(endDate)) {
        throw createHttpError('endDate is not a valid calendar date', 400);
    }

    if (endDate < startDate) {
        throw createHttpError('endDate must be >= startDate', 400);
    }

    if (!name || !name.trim()) {
        throw createHttpError('Name is required', 400);
    }

    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 30) {
        throw createHttpError('Range cannot exceed 30 days', 400);
    }

    return {
        startDate,
        endDate,
        name: name.trim()
    };
}

function generateRangeDates(startDate, endDate) {
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const dates = [];
    const cursor = new Date(start);

    while (cursor <= end) {
        dates.push(cursor.toISOString().split('T')[0]);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
}

async function computeRangeBuckets(dates, session = null) {
    const query = Holiday.find({ date: { $in: dates } }).select('date -_id').lean();
    const existing = session ? await query.session(session) : await query;
    const existingSet = new Set(existing.map((holiday) => holiday.date));

    const skippedDates = [];
    const candidateDates = [];

    for (const date of dates) {
        if (existingSet.has(date)) {
            skippedDates.push({ date, reason: 'DUPLICATE' });
        } else {
            candidateDates.push(date);
        }
    }

    return {
        skippedDates,
        candidateDates
    };
}

function buildRangeResponse(createdDates, skippedDates) {
    return {
        created: createdDates.length,
        skipped: skippedDates.length,
        dates: createdDates,
        createdDates,
        skippedDates
    };
}

async function createRangeWithTransaction(name, dates) {
    let lastDuplicateRace = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { skippedDates, candidateDates } = await computeRangeBuckets(dates);
        if (candidateDates.length === 0) {
            return buildRangeResponse([], skippedDates);
        }

        const session = await mongoose.startSession();
        try {
            const createdDates = [];
            await session.withTransaction(async () => {
                const docs = candidateDates.map((date) => ({ date, name }));
                const inserted = await Holiday.insertMany(docs, {
                    session,
                    ordered: true
                });
                createdDates.push(...inserted.map((holiday) => holiday.date));
            }, getTransactionOptions());

            return buildRangeResponse(createdDates, skippedDates);
        } catch (error) {
            if (isDuplicateKeyError(error) && attempt === 0) {
                lastDuplicateRace = true;
                continue;
            }

            if (isDuplicateKeyError(error)) {
                throw createHttpError(
                    'Không thể hoàn tất do thay đổi đồng thời hoặc lỗi hệ thống; không có thay đổi nào được lưu',
                    500,
                    true
                );
            }

            throw error;
        } finally {
            await session.endSession();
        }
    }

    if (lastDuplicateRace) {
        throw createHttpError(
            'Không thể hoàn tất do thay đổi đồng thời hoặc lỗi hệ thống; không có thay đổi nào được lưu',
            500,
            true
        );
    }

    throw createHttpError('Internal server error', 500);
}

async function createRangeWithCompensation(name, dates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { skippedDates, candidateDates } = await computeRangeBuckets(dates);
        if (candidateDates.length === 0) {
            return buildRangeResponse([], skippedDates);
        }

        const createdIds = [];
        const createdDates = [];

        try {
            for (const date of candidateDates) {
                const holiday = await Holiday.create({ date, name });
                createdIds.push(holiday._id);
                createdDates.push(holiday.date);
            }

            return buildRangeResponse(createdDates, skippedDates);
        } catch (error) {
            if (createdIds.length > 0) {
                await Holiday.deleteMany({ _id: { $in: createdIds } });
            }

            if (isDuplicateKeyError(error) && attempt === 0) {
                continue;
            }

            if (isDuplicateKeyError(error)) {
                throw createHttpError(
                    'Không thể hoàn tất do thay đổi đồng thời hoặc lỗi hệ thống; không có thay đổi nào được lưu',
                    500,
                    true
                );
            }

            throw createHttpError(
                'Tạo khoảng ngày nghỉ thất bại. Không có thay đổi nào được lưu.',
                500,
                true
            );
        }
    }

    throw createHttpError(
        'Không thể hoàn tất do thay đổi đồng thời hoặc lỗi hệ thống; không có thay đổi nào được lưu',
        500,
        true
    );
}

function ensureHolidayMutationSupported() {
    if (!isReplicaSetAvailable() && requiresHolidayMutationTransactions()) {
        throw createHttpError(
            'Holiday mutations require MongoDB transaction support in this environment',
            500,
            true
        );
    }
}

export async function createHolidayEntry(payload) {
    const data = validateHolidayInput(payload);
    try {
        const holiday = await Holiday.create(data);
        return sanitizeHoliday(holiday);
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw createHttpError('Holiday already exists for this date', 409);
        }

        throw error;
    }
}

export async function createHolidayRangeEntries(payload) {
    const { startDate, endDate, name } = validateRangeInput(payload);
    const dates = generateRangeDates(startDate, endDate);

    ensureHolidayMutationSupported();

    if (isReplicaSetAvailable()) {
        return createRangeWithTransaction(name, dates);
    }

    return createRangeWithCompensation(name, dates);
}

async function deleteHolidayWithTransaction(holidayId, actorUserId) {
    const session = await mongoose.startSession();
    try {
        let deletedHoliday = null;

        await session.withTransaction(async () => {
            const holiday = await Holiday.findById(holidayId).session(session);
            if (!holiday) {
                throw createHttpError('Holiday not found', 404);
            }

            await HolidayChangeLog.create([{
                action: 'DELETE',
                actorUserId,
                holidayId: holiday._id,
                holidayDate: holiday.date,
                holidayName: holiday.name
            }], { session });

            await Holiday.deleteOne({ _id: holiday._id }).session(session);
            deletedHoliday = sanitizeHoliday(holiday);
        }, getTransactionOptions());

        return deletedHoliday;
    } finally {
        await session.endSession();
    }
}

async function deleteHolidayWithCompensation(holidayId, actorUserId) {
    const holiday = await Holiday.findById(holidayId);
    if (!holiday) {
        throw createHttpError('Holiday not found', 404);
    }

    const log = await HolidayChangeLog.create({
        action: 'DELETE',
        actorUserId,
        holidayId: holiday._id,
        holidayDate: holiday.date,
        holidayName: holiday.name
    });

    try {
        const result = await Holiday.deleteOne({ _id: holiday._id });
        if (result.deletedCount !== 1) {
            throw new Error('Failed to delete holiday');
        }
        return sanitizeHoliday(holiday);
    } catch (error) {
        await HolidayChangeLog.deleteOne({ _id: log._id }).catch(() => {});
        throw error;
    }
}

export async function deleteHolidayEntry(holidayId, actorUserId) {
    if (!mongoose.Types.ObjectId.isValid(holidayId)) {
        throw createHttpError('Invalid holiday ID format', 400);
    }

    const existingHoliday = await Holiday.findById(holidayId).select('date').lean();
    if (!existingHoliday) {
        throw createHttpError('Holiday not found', 404);
    }

    if (isHolidayLocked(existingHoliday.date)) {
        throw createHttpError('Holiday đã qua ngày nên đã bị khóa và không thể xóa', 409);
    }

    ensureHolidayMutationSupported();

    if (isReplicaSetAvailable()) {
        return deleteHolidayWithTransaction(holidayId, actorUserId);
    }

    return deleteHolidayWithCompensation(holidayId, actorUserId);
}
