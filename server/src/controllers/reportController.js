import mongoose from 'mongoose';
import * as reportService from '../services/reportService.js';
import * as exportService from '../services/exportService.js';
import { getTodayDateKey } from '../utils/dateUtils.js';
import { getHolidayDatesForMonth } from '../utils/holidayUtils.js';

/**
 * Normalize query param: extract first element if array, trim if string.
 * @param {any} v - query param value
 * @returns {string|undefined}
 */
const pickString = (v) => {
    if (Array.isArray(v)) v = v[0];
    return typeof v === 'string' ? v.trim() : undefined;
};

/**
 * GET /api/reports/monthly?month=YYYY-MM&scope=team|company&teamId?
 * Monthly report with summary per user.
 * RBAC: Manager (team only), Admin (team or company).
 */
export const getMonthlyReport = async (req, res) => {
    try {
        const user = req.user;
        // Normalize query params (handle whitespace + array edge cases)
        let month = pickString(req.query.month);
        let scope = pickString(req.query.scope);
        let teamId = pickString(req.query.teamId);

        // Defense-in-depth: Only Manager/Admin can access reports
        if (!['MANAGER', 'ADMIN'].includes(user.role)) {
            return res.status(403).json({
                message: 'Only Manager and Admin can access reports'
            });
        }

        // Default month to current month if not provided
        if (!month) {
            const today = getTodayDateKey();
            month = today.slice(0, 7); // "YYYY-MM"
        }

        // Validate month format
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({
                message: 'Invalid month format. Expected YYYY-MM (e.g., 2026-01)'
            });
        }

        // Default scope based on role
        if (!scope) {
            scope = user.role === 'ADMIN' ? 'company' : 'team';
        }

        // Validate scope value
        if (!['team', 'company'].includes(scope)) {
            return res.status(400).json({
                message: 'Invalid scope. Expected "team" or "company"'
            });
        }

        // RBAC: Manager can only view team scope
        if (user.role === 'MANAGER') {
            if (scope !== 'team') {
                return res.status(403).json({
                    message: 'Manager can only view team reports'
                });
            }

            // Manager must use their own team
            if (!user.teamId) {
                return res.status(403).json({
                    message: 'Manager must be assigned to a team'
                });
            }

            // Force teamId to manager's team (ignore any provided teamId)
            teamId = user.teamId;
        }

        // RBAC: Admin can view company or specify teamId
        if (user.role === 'ADMIN') {
            if (scope === 'team') {
                if (!teamId) {
                    return res.status(400).json({
                        message: 'Admin must specify teamId for team scope report'
                    });
                }
                // Validate teamId is valid ObjectId
                if (!mongoose.Types.ObjectId.isValid(teamId)) {
                    return res.status(400).json({
                        message: 'Invalid teamId format'
                    });
                }
            } else {
                // Defense-in-depth: ensure teamId is not passed to service for company scope
                teamId = undefined;
            }
        }

        // Fetch holiday dates from database for this month
        const holidayDates = await getHolidayDatesForMonth(month);

        const result = await reportService.getMonthlyReport(scope, month, teamId, holidayDates);

        return res.status(200).json(result);
    } catch (error) {
        const statusCode = error.statusCode || 500;
        // LOG: Internal debugging (not exposed to client)
        if (statusCode >= 500) {
            req.log.error({ err: error }, 'getMonthlyReport error');
        }
        // SECURITY: Don't expose internal error details for 500 errors (OWASP A09)
        const message = statusCode >= 500
            ? 'Failed to fetch monthly report'
            : (error.message || 'Bad request');

        return res.status(statusCode).json({ message });
    }
};

/**
 * GET /api/reports/monthly/export?month=YYYY-MM&scope=team|company&teamId?
 * Export monthly report as Excel file.
 * RBAC: Manager (team only), Admin (team or company).
 */
export const exportMonthlyReport = async (req, res) => {
    try {
        const user = req.user;
        // Normalize query params (handle whitespace + array edge cases)
        let month = pickString(req.query.month);
        let scope = pickString(req.query.scope);
        let teamId = pickString(req.query.teamId);

        // Defense-in-depth: Only Manager/Admin can access reports
        if (!['MANAGER', 'ADMIN'].includes(user.role)) {
            return res.status(403).json({
                message: 'Only Manager and Admin can export reports'
            });
        }

        // Default month to current month if not provided
        if (!month) {
            const today = getTodayDateKey();
            month = today.slice(0, 7);
        }

        // Validate month format
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({
                message: 'Invalid month format. Expected YYYY-MM (e.g., 2026-01)'
            });
        }

        // Default scope based on role
        if (!scope) {
            scope = user.role === 'ADMIN' ? 'company' : 'team';
        }

        // Validate scope value
        if (!['team', 'company'].includes(scope)) {
            return res.status(400).json({
                message: 'Invalid scope. Expected "team" or "company"'
            });
        }

        // RBAC: Manager can only view team scope
        if (user.role === 'MANAGER') {
            if (scope !== 'team') {
                return res.status(403).json({
                    message: 'Manager can only export team reports'
                });
            }

            if (!user.teamId) {
                return res.status(403).json({
                    message: 'Manager must be assigned to a team'
                });
            }

            teamId = user.teamId;
        }

        // RBAC: Admin can view company or specify teamId
        if (user.role === 'ADMIN') {
            if (scope === 'team') {
                if (!teamId) {
                    return res.status(400).json({
                        message: 'Admin must specify teamId for team scope export'
                    });
                }
                if (!mongoose.Types.ObjectId.isValid(teamId)) {
                    return res.status(400).json({
                        message: 'Invalid teamId format'
                    });
                }
            } else {
                // Defense-in-depth: ensure teamId is not passed to service for company scope
                teamId = undefined;
            }
        }

        // Fetch holiday dates from database for this month
        const holidayDates = await getHolidayDatesForMonth(month);

        const buffer = await exportService.generateMonthlyExportExcel(scope, month, teamId, holidayDates);

        // Set response headers for Excel download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=report-${month}-${scope}.xlsx`);
        // SECURITY: Prevent caching of sensitive data
        res.setHeader('Cache-Control', 'no-store');

        return res.send(buffer);
    } catch (error) {
        const statusCode = error.statusCode || 500;
        // LOG: Internal debugging (not exposed to client)
        if (statusCode >= 500) {
            req.log.error({ err: error }, 'exportMonthlyReport error');
        }
        // SECURITY: Don't expose internal error details for 500 errors (OWASP A09)
        const message = statusCode >= 500
            ? 'Failed to export monthly report'
            : (error.message || 'Bad request');

        return res.status(statusCode).json({ message });
    }
};
