import { getTodayDateKey } from '../utils/dateUtils.js';
import Holiday from '../models/Holiday.js';
import {
    createHolidayEntry,
    createHolidayRangeEntries,
    deleteHolidayEntry,
    serializeHolidayListItem
} from '../services/holidayService.js';

/**
 * Holiday Controller
 * Per API_SPEC.md#L402-L412
 * 
 * Endpoints:
 * - POST /api/admin/holidays - ADMIN only, create holiday
 * - GET /api/admin/holidays?year=YYYY - ADMIN only, list holidays by year
 */

/**
 * POST /api/admin/holidays
 * ADMIN only - Create new holiday
 * 
 * Request body:
 * - date: "YYYY-MM-DD" [required]
 * - name: string [required]
 * 
 * Response:
 * - 201: { _id, date, name }
 * - 400: Validation error
 * - 403: Access denied (non-ADMIN)
 * - 409: Duplicate date
 */
export async function createHoliday(req, res) {
    try {
        // RBAC: ADMIN only
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const holiday = await createHolidayEntry(req.body);
        return res.status(201).json(holiday);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                message: error.expose === false && error.statusCode >= 500
                    ? 'Internal server error'
                    : error.message
            });
        }
        console.error('createHoliday error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * GET /api/admin/holidays?year=YYYY
 * ADMIN only - Get holidays by year
 * 
 * Query params:
 * - year: YYYY (optional, defaults to current year in GMT+7)
 * 
 * Response:
 * - 200: { items: [{ _id, date, name }] }
 * - 400: Invalid year format
 * - 403: Access denied (non-ADMIN)
 */
export async function getHolidays(req, res) {
    try {
        // RBAC: ADMIN only
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Default to current year in GMT+7 using existing dateUtils
        const todayKey = getTodayDateKey();
        const currentYear = todayKey.substring(0, 4);

        const year = req.query.year || currentYear.toString();

        // Validate year format
        if (!/^\d{4}$/.test(year)) {
            return res.status(400).json({ message: 'Year must be in YYYY format' });
        }

        // Query holidays for the year: date starts with "YYYY-"
        const holidays = await Holiday.find({
            date: { $regex: `^${year}-` }
        })
            .select('_id date name')
            .sort({ date: 1 })
            .lean();

        return res.status(200).json({
            items: holidays.map((holiday) => serializeHolidayListItem(holiday, todayKey))
        });
    } catch (error) {
        console.error('getHolidays error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * POST /api/admin/holidays/range
 * ADMIN only - Create holidays in date range
 * 
 * Request body:
 * - startDate: "YYYY-MM-DD" [required]
 * - endDate: "YYYY-MM-DD" [required, >= startDate]
 * - name: string [required]
 * 
 * Rules (per API_SPEC.md L441-458):
 * - Max range: 30 days
 * - Skip existing dates (no error)
 * 
 * Response:
 * - 201: { created: 5, skipped: 2, dates: ["2026-01-01", ...] }
 * - 400: Validation error
 * - 403: Access denied
 */
export async function createHolidayRange(req, res) {
    try {
        // RBAC: ADMIN only
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const result = await createHolidayRangeEntries(req.body);
        return res.status(201).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                message: error.expose === false && error.statusCode >= 500
                    ? 'Internal server error'
                    : error.message
            });
        }
        console.error('createHolidayRange error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteHoliday(req, res) {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const deleted = await deleteHolidayEntry(req.params.id, req.user._id);
        return res.status(200).json({ deleted });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                message: error.expose === false && error.statusCode >= 500
                    ? 'Internal server error'
                    : error.message
            });
        }

        console.error('deleteHoliday error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
