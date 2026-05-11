/**
 * Request Management API Layer
 * 
 * Endpoints:
 * - GET /api/requests/me - Get my requests with pagination
 * - GET /api/requests/pending - Get pending requests (Manager/Admin)
 * - POST /api/requests - Create new request
 * - POST /api/requests/:id/approve - Approve request (Manager/Admin)
 * - POST /api/requests/:id/reject - Reject request (Manager/Admin)
 * 
 * @see API_SPEC.md for detailed specifications
 */

import client from './client';

// ============================================
// MY REQUESTS
// ============================================

/**
 * Get my requests with pagination.
 * Roles: EMPLOYEE, MANAGER, ADMIN (own requests only)
 * @param {Object} [params={}] - Query parameters
 * @param {number} [params.page=1] - Page number (min: 1)
 * @param {number} [params.limit=20] - Items per page (max: 100)
 * @param {string} [params.status] - Filter by status (PENDING | APPROVED | REJECTED)
 * @param {Object} [config={}] - Axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { items: Array, pagination: { page, limit, total, totalPages } }
 */
export const getMyRequests = (params = {}, config = {}) =>
    client.get('/requests/me', { ...config, params });

/**
 * Create a new attendance adjustment or leave request.
 * Roles: EMPLOYEE, MANAGER, ADMIN
 * 
 * @param {Object} payload - Request data
 * @param {string} [payload.type='ADJUST_TIME'] - Request type (ADJUST_TIME | LEAVE)
 * 
 * // ADJUST_TIME fields:
 * @param {string} [payload.date] - Date in YYYY-MM-DD format (required if type=ADJUST_TIME)
 * @param {string} [payload.requestedCheckInAt] - ISO timestamp for check-in (optional)
 * @param {string} [payload.requestedCheckOutAt] - ISO timestamp for check-out (optional)
 * 
 * // LEAVE fields:
 * @param {string} [payload.leaveStartDate] - Start date YYYY-MM-DD (required if type=LEAVE)
 * @param {string} [payload.leaveEndDate] - End date YYYY-MM-DD (required if type=LEAVE)
 * 
 * // Common:
 * @param {string} payload.reason - Reason for request (required, max 1000 chars)
 * 
 * @param {Object} [config={}] - Axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { request: Object }
 */
export const createRequest = (payload, config = {}) =>
    client.post('/requests', payload, config);

// ============================================
// PENDING REQUESTS (MANAGER/ADMIN)
// ============================================

/**
 * Get pending requests with pagination (RBAC-aware).
 * - MANAGER: Only requests from users in the same team
 * - ADMIN: All pending requests company-wide
 * @param {Object} [params={}] - Query parameters
 * @param {number} [params.page=1] - Page number (min: 1)
 * @param {number} [params.limit=20] - Items per page (max: 100)
 * @param {Object} [config={}] - Axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { items: Array, pagination: { page, limit, total, totalPages } }
 */
export const getPendingRequests = (params = {}, config = {}) =>
    client.get('/requests/pending', { ...config, params });

/**
 * Get approval history with pagination (RBAC-aware).
 * - MANAGER: Requests from users in the same team
 * - ADMIN: All approved/rejected requests company-wide
 * @param {Object} [params={}] - Query parameters
 * @param {number} [params.page=1] - Page number (min: 1)
 * @param {number} [params.limit=20] - Items per page (max: 100)
 * @param {string} [params.status] - Filter by status (APPROVED | REJECTED)
 * @param {Object} [config={}] - Axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { items: Array, pagination: { page, limit, total, totalPages } }
 */
export const getApprovalHistory = (params = {}, config = {}) =>
    client.get('/requests/history', { ...config, params });

/**
 * Approve a pending request (RBAC-aware).
 * - MANAGER: Can approve requests from users in the same team only
 * - ADMIN: Can approve any request
 * @param {string} requestId - Request's ObjectId
 * @param {Object} [config={}] - Axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { request: Object }
 */
export const approveRequest = (requestId, config = {}) =>
    client.post(`/requests/${requestId}/approve`, {}, config);

/**
 * Reject a pending request (RBAC-aware).
 * - MANAGER: Can reject requests from users in the same team only
 * - ADMIN: Can reject any request
 * @param {string} requestId - Request's ObjectId
 * @param {string|Object|null} [arg2] - rejectReason string OR legacy config object
 * @param {Object} [arg3={}] - Axios config for new signature
 * @returns {Promise} { request: Object }
 */
export const rejectRequest = (requestId, arg2, arg3 = {}) => {
    const isPlainObject = (value) =>
        Object.prototype.toString.call(value) === '[object Object]';

    let rejectReason = null;
    let config = {};

    // New style: rejectRequest(id, 'reason', config)
    if (typeof arg2 === 'string' || arg2 == null) {
        rejectReason = arg2 ?? null;
        config = isPlainObject(arg3) ? arg3 : {};
    }
    // Legacy style: rejectRequest(id, config)
    else if (isPlainObject(arg2)) {
        config = arg2;
    }

    const body = typeof rejectReason === 'string' && rejectReason.trim().length > 0
        ? { rejectReason }
        : {};

    return client.post(`/requests/${requestId}/reject`, body, config);
};

/**
 * Cancel an OT request (DELETE).
 * Only PENDING OT requests can be cancelled.
 * @param {string} requestId - Request ID
 * @param {Object} [config={}] - Axios config
 * @returns {Promise} Success message
 */
export const cancelOtRequest = (requestId, config = {}) =>
    client.delete(`/requests/${requestId}`, config);
