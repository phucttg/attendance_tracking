/**
 * Admin Management API Layer
 * 
 * Endpoints:
 * - GET /api/admin/holidays?year=YYYY - List holidays by year
 * - POST /api/admin/holidays - Create holiday
 * - POST /api/admin/users - Create user
 * 
 * @see API_SPEC.md for detailed specifications
 */

import client from './client';

// ============================================
// HOLIDAYS MANAGEMENT
// ============================================

/**
 * Get holidays by year.
 * Roles: ADMIN only
 * @param {string} [year] - Year in YYYY format (defaults to current year GMT+7)
 * @param {Object} [config] - Optional axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { items: [{ _id, date, name }] }
 */
export const getHolidays = (year, config) =>
    client.get('/admin/holidays', { ...config, params: { year } });

/**
 * Create a new holiday.
 * Roles: ADMIN only
 * @param {Object} data - Holiday data
 * @param {string} data.date - Date in YYYY-MM-DD format
 * @param {string} data.name - Holiday name
 * @returns {Promise} { _id, date, name }
 */
export const createHoliday = (data) =>
    client.post('/admin/holidays', data);

/**
 * Create holidays in date range.
 * Roles: ADMIN only
 * @param {Object} data - Range data
 * @param {string} data.startDate - Start date YYYY-MM-DD
 * @param {string} data.endDate - End date YYYY-MM-DD
 * @param {string} data.name - Holiday name for all dates
 * @returns {Promise} { created, skipped, dates, createdDates, skippedDates }
 */
export const createHolidayRange = (data) =>
    client.post('/admin/holidays/range', data);

/**
 * Delete a single holiday by id.
 * Roles: ADMIN only
 * @param {string} holidayId - Holiday ObjectId
 * @returns {Promise} { deleted: { _id, date, name } }
 */
export const deleteHoliday = (holidayId) =>
    client.delete(`/admin/holidays/${holidayId}`);


// ============================================
// USER MANAGEMENT
// ============================================

/**
 * Create a new user.
 * Roles: ADMIN only
 * 
 * @param {Object} data - User data
 * @param {string} data.employeeCode - Required, unique
 * @param {string} data.name - Required
 * @param {string} data.email - Required, unique
 * @param {string} data.password - Required, min 8 characters
 * @param {string} data.role - Required: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
 * @param {string} [data.username] - Optional, unique
 * @param {string} [data.teamId] - Optional, ObjectId
 * @param {string} [data.startDate] - Optional, ISO date string
 * @param {boolean} [data.isActive] - Optional, default true
 * @returns {Promise} { user: { _id, employeeCode, name, email, ... } }
 */
export const createUser = (data) =>
    client.post('/admin/users', data);

/**
 * Get paginated users list.
 * Roles: ADMIN only
 * @param {Object} params - Query parameters
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.limit=20] - Items per page (max 100)
 * @param {string} [params.search] - Search by name/email/employeeCode
 * @param {boolean} [params.includeDeleted=false] - Include soft-deleted users
 * @param {Object} [config] - Optional axios config
 * @returns {Promise} { items: [...], pagination: { page, limit, total, totalPages } }
 */
export const getAdminUsers = (params, config) =>
    client.get('/admin/users', { ...config, params });

// ============================================
// SOFT DELETE & RESTORE
// ============================================
/**
 * Soft delete a user (sets deletedAt).
 * Roles: ADMIN only
 * @param {string} userId - User ID to delete
 * @returns {Promise} { message, restoreDeadline }
 */
export const softDeleteUser = (userId) =>
    client.delete(`/admin/users/${userId}`);

/**
 * Restore a soft-deleted user.
 * Roles: ADMIN only
 * @param {string} userId - User ID to restore
 * @returns {Promise} { user }
 */
export const restoreUser = (userId) =>
    client.post(`/admin/users/${userId}/restore`);

/**
 * Purge all users past retention period.
 * Roles: ADMIN only
 * @returns {Promise} { purged, cascadeDeleted, details }
 */
export const purgeDeletedUsers = () =>
    client.post('/admin/users/purge');

/**
 * Get admin queue of open sessions and pending reconciliation sessions.
 * Roles: ADMIN only
 *
 * @param {Object} [params] - Query params
 * @param {string} [params.status] - all | open | reconciliation
 * @param {number} [params.limit=100] - Max items to return
 * @param {Object} [config] - Optional axios config
 * @returns {Promise} { items: [...] }
 */
export const getAdminOpenSessions = (params, config) =>
    client.get('/admin/attendance/open-sessions', { ...config, params });
