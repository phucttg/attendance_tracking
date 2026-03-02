import * as requestService from '../services/requestService.js';
import { parsePaginationParams, clampPage, buildPaginatedResponse } from '../utils/pagination.js';

/**
 * POST /api/requests
 * Create a new attendance adjustment request (ADJUST_TIME or LEAVE)
 * 
 * Body (ADJUST_TIME):
 * - type: "ADJUST_TIME" (default)
 * - date: "YYYY-MM-DD" (required)
 * - requestedCheckInAt: ISO string (optional)
 * - requestedCheckOutAt: ISO string (optional)
 * - reason: string (required)
 * 
 * Body (LEAVE):
 * - type: "LEAVE"
 * - leaveStartDate: "YYYY-MM-DD" (required)
 * - leaveEndDate: "YYYY-MM-DD" (required)
 * - leaveType: "ANNUAL" | "SICK" | "UNPAID" (optional)
 * - reason: string (required)
 */
export const createRequest = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      type = 'ADJUST_TIME',  // Default for backwards compatibility
      date, 
      requestedCheckInAt, 
      requestedCheckOutAt,
      leaveStartDate,
      leaveEndDate,
      leaveType,
      estimatedEndTime,
      reason 
    } = req.body;

    // Validate type enum (fail-fast)
    if (type && !['ADJUST_TIME', 'LEAVE', 'OT_REQUEST'].includes(type)) {
      return res.status(400).json({ 
        message: 'Invalid request type. Must be ADJUST_TIME, LEAVE, or OT_REQUEST' 
      });
    }

    // Validate reason (common for all types)
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ message: 'Reason is required' });
    }

    let request;
    
    if (type === 'OT_REQUEST') {
      // Validate OT_REQUEST-specific fields
      if (!date || !estimatedEndTime) {
        return res.status(400).json({ 
          message: 'date and estimatedEndTime are required for OT requests' 
        });
      }
      
      request = await requestService.createOtRequest(userId, {
        date,
        estimatedEndTime,
        reason
      });
    } else if (type === 'LEAVE') {
      // Validate LEAVE-specific fields
      if (!leaveStartDate || !leaveEndDate) {
        return res.status(400).json({ 
          message: 'leaveStartDate and leaveEndDate are required for LEAVE requests' 
        });
      }
      
      request = await requestService.createLeaveRequest(
        userId, 
        leaveStartDate, 
        leaveEndDate, 
        leaveType || null, 
        reason
      );
    } else {
      // Validate ADJUST_TIME-specific fields
      if (!date || typeof date !== 'string') {
        return res.status(400).json({ 
          message: 'date is required for ADJUST_TIME requests' 
        });
      }
      
      request = await requestService.createRequest(userId, {
        type: 'ADJUST_TIME',
        date,
        requestedCheckInAt: requestedCheckInAt || null,
        requestedCheckOutAt: requestedCheckOutAt || null,
        reason
      });
    }

    return res.status(201).json({ request });
  } catch (error) {
    const statusCode = error.statusCode || (error?.name === 'ValidationError' ? 400 : 500);
    return res.status(statusCode).json({
      message: error.message || 'Failed to create request'
    });
  }
};

/**
 * GET /api/requests/me
 * Get all requests for the current user with pagination
 */
export const getMyRequests = async (req, res) => {
  try {
    const userId = req.user._id;

    // Step 1: Parse pagination params (no skip yet - skip depends on total)
    const { page, limit } = parsePaginationParams(req.query);

    // Optional status filter from query (normalize and validate)
    const status = req.query.status?.trim().toUpperCase() || null;
    if (status && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ 
        message: 'Invalid status. Must be PENDING, APPROVED, or REJECTED' 
      });
    }

    // Step 2: Get total count ONLY (optimized - 1 DB call instead of querying items)
    const total = await requestService.countMyRequests(userId, { status });

    // Step 3: Clamp page to valid range and calculate skip
    const { page: clampedPage, skip } = clampPage(page, total, limit);

    // Step 4: Query items with CLAMPED skip (1 DB call - no redundant count)
    const items = await requestService.getMyRequests(userId, {
      skip,
      limit,
      status
    });

    // Step 5: Build response with clamped page
    return res.status(200).json(
      buildPaginatedResponse(items, total, clampedPage, limit)
    );
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'Failed to fetch requests'
    });
  }
};

/**
 * GET /api/requests/pending
 * Get pending requests (Manager: team only, Admin: company-wide) with pagination
 */
export const getPendingRequests = async (req, res) => {
  try {
    const user = req.user;

    // Step 1: Parse pagination params
    const { page, limit } = parsePaginationParams(req.query);

    // Step 2: Get total count (1 DB call)
    const total = await requestService.countPendingRequests(user);

    // Step 3: Clamp page to valid range and calculate skip
    const { page: clampedPage, skip } = clampPage(page, total, limit);

    // Step 4: Query items with CLAMPED skip (1 DB call)
    const items = await requestService.getPendingRequests(user, {
      skip,
      limit
    });

    // Step 5: Build paginated response
    return res.status(200).json(
      buildPaginatedResponse(items, total, clampedPage, limit)
    );
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'Failed to fetch pending requests'
    });
  }
};

/**
 * POST /api/requests/:id/approve
 * Approve a request and update attendance
 */
export const approveRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    const approver = req.user;

    if (!requestId) {
      return res.status(400).json({ message: 'Request ID is required' });
    }

    const request = await requestService.approveRequest(requestId, approver);

    return res.status(200).json({
      request
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'Failed to approve request'
    });
  }
};

/**
 * POST /api/requests/:id/reject
 * Reject a request
 */
export const rejectRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    const approver = req.user;

    if (!requestId) {
      return res.status(400).json({ message: 'Request ID is required' });
    }

    const request = await requestService.rejectRequest(requestId, approver);

    return res.status(200).json({
      request
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'Failed to reject request'
    });
  }
};

/**
 * DELETE /api/requests/:id
 * Cancel OT request (only PENDING, owner only)
 * 
 * Roles: EMPLOYEE | MANAGER | ADMIN (own requests only)
 */
export const cancelRequest = async (req, res) => {
  try {
    const userId = req.user._id;
    const requestId = req.params.id;
    
    if (!requestId) {
      return res.status(400).json({ message: 'Request ID is required' });
    }
    
    // Call service (handles ownership check + PENDING status check)
    // Note: service expects (userId, requestId) order
    const result = await requestService.cancelOtRequest(userId, requestId);
    
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ 
      message: error.message || 'Failed to cancel request' 
    });
  }
};
