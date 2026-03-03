import * as attendanceService from '../services/attendanceService.js';
import { getTodayDateKey, getDateKey } from '../utils/dateUtils.js';
import mongoose from 'mongoose';
import { getHolidayDatesForMonth } from '../utils/holidayUtils.js';
import { parsePaginationParams } from '../utils/pagination.js';

/**
 * POST /api/attendance/check-in
 * Check in for today (GMT+7)
 */
export const checkIn = async (req, res) => {
  try {
    const userId = req.user._id;

    const attendance = await attendanceService.checkIn(userId);

    return res.status(200).json({
      attendance
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode < 500 && error?.payload) {
      return res.status(statusCode).json({
        message: error.message || 'Failed to check in',
        code: error.code || null,
        ...error.payload
      });
    }
    // OWASP A09: Don't expose internal error details for 5xx errors
    const message = statusCode < 500
      ? (error.message || 'Failed to check in')
      : 'Failed to check in';
    return res.status(statusCode).json({ message });
  }
};

/**
 * GET /api/attendance/open-session
 * Return open-session + forgot-checkout reconciliation context for current user.
 */
export const getOpenSession = async (req, res) => {
  try {
    const userId = req.user._id;
    const context = await attendanceService.getOpenSessionContext(userId);
    return res.status(200).json(context);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode < 500
      ? (error.message || 'Failed to fetch open session context')
      : 'Failed to fetch open session context';
    return res.status(statusCode).json({ message });
  }
};

/**
 * POST /api/attendance/check-out
 * Check out for today (GMT+7)
 */
export const checkOut = async (req, res) => {
  try {
    const userId = req.user._id;

    const attendance = await attendanceService.checkOut(userId);

    return res.status(200).json({
      attendance
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    // OWASP A09: Don't expose internal error details for 5xx errors
    const message = statusCode < 500
      ? (error.message || 'Failed to check out')
      : 'Failed to check out';
    return res.status(statusCode).json({ message });
  }
};

/**
 * GET /api/attendance/me?month=YYYY-MM
 * Get monthly attendance history with computed fields
 */
export const getMyAttendance = async (req, res) => {
  try {
    const userId = req.user._id;

    // Normalize query param (handle whitespace + array edge cases)
    let month = req.query.month;
    if (Array.isArray(month)) month = month[0];
    month = typeof month === 'string' ? month.trim() : undefined;

    if (!month) {
      const today = getTodayDateKey();
      month = today.substring(0, 7); // Extract "YYYY-MM"
    }

    // Validate month format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        message: 'Invalid month format. Expected YYYY-MM (e.g., 2026-01)'
      });
    }

    // Fetch holidays from database for this month
    const holidayDates = await getHolidayDatesForMonth(month);

    // Phase 3: Fetch approved leave dates for this user in this month
    const { getApprovedLeaveDates } = await import('../services/requestService.js');
    const leaveDates = await getApprovedLeaveDates(userId, month);

    const items = await attendanceService.getMonthlyHistory(userId, month, holidayDates, leaveDates);

    return res.status(200).json({
      items
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    // OWASP A09: Don't expose internal error details for 5xx errors
    const message = statusCode < 500
      ? (error.message || 'Failed to fetch attendance history')
      : 'Failed to fetch attendance history';
    return res.status(statusCode).json({ message });
  }
};

/**
 * GET /api/attendance/today?scope=team|company&teamId?
 * Get today's activity for Member Management.
 * 
 * RBAC:
 * - MANAGER: scope=team only (teamId ignored, uses token.user.teamId)
 * - ADMIN: scope=company (all users) OR scope=team (requires teamId)
 */export const getTodayAttendance = async (req, res) => {
  try {
    const { role, teamId: userTeamId } = req.user;
    // Normalize query params (handle whitespace + array edge cases)
    let scope = req.query.scope;
    let teamId = req.query.teamId;
    if (Array.isArray(scope)) scope = scope[0];
    if (Array.isArray(teamId)) teamId = teamId[0];
    scope = typeof scope === 'string' ? scope.trim() : undefined;
    teamId = typeof teamId === 'string' ? teamId.trim() : undefined;

    // RBAC: Manager can only view team scope
    if (role === 'MANAGER') {
      scope = 'team'; // Force team scope for manager
      teamId = userTeamId; // Use manager's own team

      if (!teamId) {
        return res.status(403).json({
          message: 'Manager must be assigned to a team to view team activity'
        });
      }
    }
    // Admin validation
    else if (role === 'ADMIN') {
      // FIX #1: Scope invalid → 400 (not fallback to company)
      if (!scope) {
        scope = 'company'; // Default to company if not provided
      } else if (!['team', 'company'].includes(scope)) {
        return res.status(400).json({
          message: 'Invalid scope. Must be "team" or "company"'
        });
      }

      if (scope === 'team') {
        // FIX #2: Validate teamId is provided and is valid ObjectId
        if (!teamId) {
          return res.status(400).json({
            message: 'Admin must specify teamId for team scope'
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
    // Employee not allowed
    else {
      return res.status(403).json({
        message: 'Insufficient permissions. Manager or Admin required.'
      });
    }

    // Parse pagination params (v2.5)
    const { page, limit } = parsePaginationParams(req.query);

    // Fetch holidays for current month (GMT+7)
    const today = getTodayDateKey();
    const holidayDates = await getHolidayDatesForMonth(today.substring(0, 7));

    const result = await attendanceService.getTodayActivity(scope, teamId, holidayDates, { page, limit });

    return res.status(200).json(result);
  } catch (error) {
    // OWASP A05/A09: Verbose logging in dev, generic in prod
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error fetching today activity:', error);
    } else {
      console.error('Error fetching today activity');
    }

    const statusCode = error.statusCode || 500;

    // FIX #4: 4xx returns message, 5xx returns generic (OWASP A09)
    const responseMessage = statusCode < 500
      ? (error.message || 'Request failed')
      : 'Internal server error';

    return res.status(statusCode).json({
      message: responseMessage
    });
  }
};

/**
 * GET /api/attendance/user/:id?month=YYYY-MM
 * Get monthly attendance history for a specific user (Member Management).
 *
 * RBAC:
 * - MANAGER: can only access users in same team (Anti-IDOR, returns 403)
 * - ADMIN: can access any user
 * - EMPLOYEE: blocked (403)
 */
export const getAttendanceByUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId format (HTTP-level input check)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: 'Invalid user ID format'
      });
    }

    // Normalize query param (handle whitespace + array edge cases)
    let month = req.query.month;
    if (Array.isArray(month)) month = month[0];
    month = typeof month === 'string' ? month.trim() : undefined;

    const items = await attendanceService.getAttendanceByUserId(id, month, req.user);

    return res.status(200).json({ items });
  } catch (error) {
    // OWASP A05/A09: Verbose logging in dev, generic in prod
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error fetching user attendance history:', error);
    } else {
      console.error('Error fetching user attendance history');
    }

    const statusCode = error.statusCode || 500;
    const responseMessage = statusCode < 500
      ? (error.message || 'Request failed')
      : 'Internal server error';

    return res.status(statusCode).json({
      message: responseMessage
    });
  }
};

/**
 * POST /api/admin/attendance/:id/force-checkout
 * Admin-only: Force close stale open session with custom checkout time
 *
 * RBAC: ADMIN only
 * Purpose: Data correction, cleanup, forgot-to-checkout scenarios
 */
export const forceCheckout = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkOutAt } = req.body;

    // RBAC: ADMIN only (endpoint-level guard)
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        message: 'Insufficient permissions. Admin required.'
      });
    }

    // Validate ObjectId format (HTTP-level input check)
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: 'Invalid attendance ID format'
      });
    }

    // Validate checkOutAt present (HTTP-level input check)
    if (!checkOutAt) {
      return res.status(400).json({
        message: 'checkOutAt is required'
      });
    }

    // Validate checkOutAt is a parseable date (HTTP-level input check)
    const checkOutDate = new Date(checkOutAt);
    if (isNaN(checkOutDate.getTime())) {
      return res.status(400).json({
        message: 'Invalid checkOutAt date format. Use ISO 8601 (e.g., 2026-01-30T17:00:00+07:00)'
      });
    }

    const attendance = await attendanceService.forceCheckoutAttendance(id, checkOutDate);

    return res.status(200).json({
      message: 'Forced checkout successful',
      attendance
    });
  } catch (error) {
    // OWASP A05/A09: Verbose logging in dev, generic in prod
    if (process.env.NODE_ENV !== 'production') {
      console.error('Error forcing checkout:', error);
    } else {
      console.error('Error forcing checkout');
    }

    const statusCode = error.statusCode || 500;
    const responseMessage = statusCode < 500
      ? (error.message || 'Request failed')
      : 'Internal server error';

    return res.status(statusCode).json({
      message: responseMessage
    });
  }
};

/**
 * GET /api/admin/attendance/open-sessions?status=all|open|reconciliation&limit=100
 * Admin queue for open sessions and pending reconciliation sessions.
 */
export const getAdminOpenSessions = async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        message: 'Insufficient permissions. Admin required.'
      });
    }

    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 100;

    const items = await attendanceService.getAdminOpenSessionsQueue({ status, limit });
    return res.status(200).json({ items });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode < 500
      ? (error.message || 'Failed to fetch open sessions queue')
      : 'Internal server error';
    return res.status(statusCode).json({ message });
  }
};
