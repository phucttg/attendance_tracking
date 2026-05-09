import User from '../models/User.js';
import mongoose from 'mongoose';
import * as userService from '../services/userService.js';

/**
 * GET /api/users/:id
 * Get user profile by ID for Member Management.
 * 
 * RBAC:
 * - MANAGER: can only access users in same team (Anti-IDOR)
 * - ADMIN: can access any user
 * - EMPLOYEE: blocked (403)
 */
export const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const { role, teamId: requestingUserTeamId } = req.user;

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                message: 'Invalid user ID format'
            });
        }

        // Block Employee role
        if (role === 'EMPLOYEE') {
            return res.status(403).json({
                message: 'Insufficient permissions. Manager or Admin required.'
            });
        }

        // FIX C: Manager without teamId cannot access member management
        if (role === 'MANAGER' && !requestingUserTeamId) {
            return res.status(403).json({
                message: 'Manager must be assigned to a team'
            });
        }

        // Query-level Anti-IDOR (cleaner pattern):
        // - MANAGER: query includes teamId to only fetch same-team users
        // - ADMIN: can access any user
        let targetUser;
        const selectFields = '_id employeeCode name email username role teamId isActive startDate createdAt updatedAt';

        if (role === 'MANAGER') {
            // Manager can only query users in same team (Anti-IDOR at query level)
            targetUser = await User.findOne({
                _id: id,
                teamId: requestingUserTeamId
            })
                .select(selectFields)
                .lean();

            // Not found OR different team => same 403 response (per RULES.md line 126)
            if (!targetUser) {
                return res.status(403).json({
                    message: 'Access denied. You can only view users in your team.'
                });
            }
        } else {
            // Admin can access any user
            targetUser = await User.findById(id)
                .select(selectFields)
                .lean();

            // Not found
            if (!targetUser) {
                return res.status(404).json({
                    message: 'User not found'
                });
            }
        }

        return res.status(200).json({ user: targetUser });
    } catch (error) {
        req.log.error({ err: error }, 'Error fetching user by ID');

        const statusCode = error.statusCode || 500;

        // 4xx returns message, 5xx returns generic (OWASP A09)
        const responseMessage = statusCode < 500
            ? (error.message || 'Request failed')
            : 'Internal server error';

        return res.status(statusCode).json({
            message: responseMessage
        });
    }
};

/**
 * PATCH /api/admin/users/:id
 * Update user basic fields (Admin only).
 *
 * Whitelist: name, email, username, teamId, isActive, startDate
 * Per API_SPEC.md and ROADMAP.md A4.
 */
export const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.user;

        // Admin only guard (endpoint-level RBAC)
        if (role !== 'ADMIN') {
            return res.status(403).json({ message: 'Forbidden. Admin access required.' });
        }

        // Validate ObjectId format (HTTP-level input check)
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID format' });
        }

        const result = await userService.updateUser(id, req.body);
        return res.status(200).json(result);
    } catch (error) {
        // Handle duplicate key error (email/username already exists)
        if (error.code === 11000) {
            return res.status(409).json({ message: 'Email or username already exists' });
        }

        req.log.error({ err: error }, 'Error updating user');

        const statusCode = error.statusCode || 500;
        const responseMessage = statusCode < 500
            ? (error.message || 'Request failed')
            : 'Internal server error';

        return res.status(statusCode).json({ message: responseMessage });
    }
};

/**
 * POST /api/admin/users/:id/reset-password
 * Reset user password (Admin only).
 *
 * Body: { newPassword }
 * - newPassword must be >= 8 characters
 * - bcrypt hash, do NOT log password
 * Per ROADMAP.md A4.
 */
export const resetPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.user;
        const { newPassword } = req.body;

        // Admin only guard (endpoint-level RBAC)
        if (role !== 'ADMIN') {
            return res.status(403).json({ message: 'Forbidden. Admin access required.' });
        }

        // Validate ObjectId format (HTTP-level input check)
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID format' });
        }

        const result = await userService.resetPassword(id, newPassword);
        return res.status(200).json(result);
    } catch (error) {
        req.log.error('Error resetting password: %s', error.message);

        const statusCode = error.statusCode || 500;
        const responseMessage = statusCode < 500
            ? (error.message || 'Request failed')
            : 'Internal server error';

        return res.status(statusCode).json({ message: responseMessage });
    }
};

/**
 * POST /api/admin/users
 * Create new user (Admin only).
 *
 * Required: employeeCode, name, email, password, role
 * Optional: username, teamId, startDate, isActive (default true)
 *
 * Per API_SPEC.md#L338-L353
 */
export const createUser = async (req, res) => {
    try {
        // RBAC: ADMIN only (defense-in-depth, route also has middleware)
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const result = await userService.createUser(req.body);
        return res.status(201).json(result);
    } catch (error) {
        // Handle duplicate key errors (MongoDB 11000)
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(409).json({
                message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
            });
        }

        req.log.error({ err: error }, 'createUser error');

        const statusCode = error.statusCode || 500;
        const responseMessage = statusCode < 500
            ? (error.message || 'Request failed')
            : 'Internal server error';
        return res.status(statusCode).json({ message: responseMessage });
    }
};
/**
 * GET /api/admin/users (UPDATED v2.3)
 * Get paginated users (Admin only).
 * 
 * Query params:
 * - page: number (default 1)
 * - limit: number (default 20, max 100)
 * - search: string (search by name/email/employeeCode)
 * - includeDeleted: boolean (default false)
 * 
 * Response: { items, pagination: { page, limit, total, totalPages } }
 * Per API_SPEC.md L367-400
 */
export const getAllUsers = async (req, res) => {
    try {
        // RBAC: ADMIN only (defense-in-depth)
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Parse query params with defaults
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const search = req.query.search?.trim() || '';
        const includeDeleted = req.query.includeDeleted === 'true';

        // Build query filter
        const filter = {};

        // Soft delete filter: include legacy users without deletedAt field
        // Per RULES.md: { deletedAt: null } alone misses docs where field doesn't exist
        if (!includeDeleted) {
            filter.$and = [
                { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }
            ];
        }

        // Search filter (name, email, or employeeCode)
        if (search) {
            // Must use $and to combine with soft delete filter
            if (!filter.$and) filter.$and = [];
            filter.$and.push({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                    { employeeCode: { $regex: search, $options: 'i' } }
                ]
            });
        }

        // Count total (for pagination)
        const total = await User.countDocuments(filter);
        const totalPages = Math.ceil(total / limit);

        // Fetch paginated results
        const users = await User.find(filter)
            .select('_id employeeCode name email username role teamId isActive startDate deletedAt createdAt updatedAt')
            .sort({ employeeCode: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        return res.status(200).json({
            items: users,
            pagination: {
                page,
                limit,
                total,
                totalPages
            }
        });
    } catch (error) {
        req.log.error({ err: error }, 'getAllUsers error');
        return res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * DELETE /api/admin/users/:id
 * Soft delete user (Admin only).
 *
 * Behavior:
 * - Sets deletedAt = now
 * - Cannot delete yourself
 * - User will be purged after SOFT_DELETE_DAYS (configurable, default 15)
 *
 * Response: { message, restoreDeadline }
 * Per API_SPEC.md#L573-L587
 */
export const softDeleteUser = async (req, res) => {
    try {
        // RBAC: ADMIN only (endpoint-level guard)
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { id } = req.params;

        // Validate ObjectId format (HTTP-level input check)
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID format' });
        }

        const result = await userService.softDeleteUser(id, req.user._id);
        return res.status(200).json(result);
    } catch (error) {
        req.log.error({ err: error }, 'softDeleteUser error');
        const statusCode = error.statusCode || 500;
        const responseMessage = statusCode < 500
            ? (error.message || 'Request failed')
            : 'Internal server error';
        return res.status(statusCode).json({ message: responseMessage });
    }
};

/**
 * POST /api/admin/users/:id/restore
 * Restore soft-deleted user (Admin only).
 *
 * Behavior:
 * - Sets deletedAt = null
 * - Only works if user is soft-deleted and not yet purged
 *
 * Response: { user }
 * Per API_SPEC.md#L589-L604
 */
export const restoreUser = async (req, res) => {
    try {
        // RBAC: ADMIN only (endpoint-level guard)
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const { id } = req.params;

        // Validate ObjectId format (HTTP-level input check)
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid user ID format' });
        }

        const result = await userService.restoreUser(id);
        return res.status(200).json(result);
    } catch (error) {
        req.log.error({ err: error }, 'restoreUser error');
        const statusCode = error.statusCode || 500;
        const responseMessage = statusCode < 500
            ? (error.message || 'Request failed')
            : 'Internal server error';
        return res.status(statusCode).json({ message: responseMessage });
    }
};

/**
 * POST /api/admin/users/purge
 * Permanently delete users past retention period (Admin only).
 *
 * Behavior:
 * - Finds users where deletedAt < (now - SOFT_DELETE_DAYS)
 * - CASCADE: Hard deletes related attendances and requests
 * - Hard deletes the users
 *
 * Response: { purged: number, cascadeDeleted: {...}, details: [...] }
 */
export const purgeDeletedUsers = async (req, res) => {
    try {
        // RBAC: ADMIN only (endpoint-level guard)
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const result = await userService.purgeDeletedUsers();
        return res.status(200).json(result);
    } catch (error) {
        req.log.error({ err: error }, 'purgeDeletedUsers error');
        return res.status(500).json({ message: 'Internal server error' });
    }
};