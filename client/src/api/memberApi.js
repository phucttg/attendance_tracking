/**
 * Member Management API Layer
 * 
 * Endpoints:
 * - GET /api/teams - Teams directory
 * - GET /api/attendance/today - Today activity (scope, teamId)
 * - GET /api/users/:id - User detail
 * - GET /api/attendance/user/:id - User attendance history
 * - PATCH /api/admin/users/:id - Update user (Admin only)
 * - POST /api/admin/users/:id/reset-password - Reset password (Admin only)
 * 
 * @see API_SPEC.md for detailed specifications
 */

import client from './client';

// ============================================
// TEAMS DIRECTORY
// ============================================

/**
 * Get all teams.
 * Roles: EMPLOYEE | MANAGER | ADMIN
 * @param {Object} [config] - Optional axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { items: [{ _id, name }] }
 */
export const getTeams = (config) => client.get('/teams', config);


// ============================================
// TODAY ACTIVITY
// ============================================

/**
 * Get today's attendance for team/company with pagination support.
 * Roles: MANAGER | ADMIN
 * 
 * Behavior:
 * - MANAGER: scope forced to 'team', uses token.teamId (teamId param ignored)
 * - ADMIN: scope='company' (all users) OR scope='team' (requires teamId)
 * 
 * @param {Object} params - Query parameters
 * @param {string} params.scope - 'company' | 'team'
 * @param {string} [params.teamId] - Required when scope='team' for Admin
 * @param {number} [params.page=1] - Page number (v2.5+)
 * @param {number} [params.limit=20] - Items per page, max 100 (v2.5+)
 * @param {Object} [config] - Optional axios config (e.g., { signal } for AbortController)
 * @returns {Promise} { 
 *   date: "YYYY-MM-DD", 
 *   items: [{ 
 *     user: { _id, employeeCode, name, email, ... },
 *     attendance: { date, checkInAt, checkOutAt } | null,
 *     computed: { status, lateMinutes, workMinutes, otMinutes }
 *   }],
 *   pagination: { page, limit, total, totalPages } 
 * }
 */
export const getTodayAttendance = (params = {}, config = {}) =>
    client.get('/attendance/today', { ...config, params });


// ============================================
// USER DETAIL
// ============================================

/**
 * Get user by ID.
 * Roles: MANAGER (same-team) | ADMIN
 * @param {string} id - User ID
 * @returns {Promise} { user: { _id, employeeCode, name, email, ... } }
 */
export const getUserById = (id) => client.get(`/users/${id}`);


// ============================================
// USER ATTENDANCE HISTORY
// ============================================

/**
 * Get attendance history for a user by month.
 * Roles: MANAGER (same-team) | ADMIN
 * @param {string} id - User ID
 * @param {string} [month] - Month in YYYY-MM format (defaults to current month)
 * @returns {Promise} { items: [{ date, checkInAt, checkOutAt, status, ... }] }
 */
export const getUserAttendance = (id, month) =>
    client.get(`/attendance/user/${id}`, { params: { month } });


// ============================================
// ADMIN: UPDATE USER
// ============================================

/**
 * Update user profile (Admin only).
 * Allowed fields: name, email, username, teamId, isActive, startDate
 * @param {string} id - User ID
 * @param {Object} data - Fields to update (whitelist enforced server-side)
 * @returns {Promise} { user: { ... updated user } }
 */
export const updateUser = (id, data) =>
    client.patch(`/admin/users/${id}`, data);


// ============================================
// ADMIN: RESET PASSWORD
// ============================================

/**
 * Reset user password (Admin only).
 * @param {string} id - User ID
 * @param {string} newPassword - New password (min 8 characters)
 * @returns {Promise} { message: 'Password updated' }
 */
export const resetPassword = (id, newPassword) =>
    client.post(`/admin/users/${id}/reset-password`, { newPassword });

// ============================================
// WORK SCHEDULES
// ============================================

/**
 * Get my normalized 7-day work schedule window.
 * start/days are accepted by server but normalized to today+6.
 */
export const getMyWorkSchedules = (params = {}, config = {}) =>
    client.get('/work-schedules/me', { ...config, params });

/**
 * Full-replace update for my 7-day window.
 * Body: { items: [{ workDate, scheduleType|null }] }
 */
export const putMyWorkSchedules = (items, config = {}) =>
    client.put('/work-schedules/me', { items }, config);

/**
 * Manager/Admin read-only schedule window for a user.
 */
export const getUserWorkSchedules = (id, params = {}, config = {}) =>
    client.get(`/work-schedules/users/${id}`, { ...config, params });
