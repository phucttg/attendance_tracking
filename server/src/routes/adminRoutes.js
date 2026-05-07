import express from 'express';
import * as userController from '../controllers/userController.js';
import * as holidayController from '../controllers/holidayController.js';
import * as attendanceController from '../controllers/attendanceController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import {
  adminMutationLimiter,
  adminReadLimiter,
  adminStrictMutationLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

// Admin Management APIs (ADMIN only)
// Per ROADMAP.md A4 and API_SPEC.md

// User Management (ADMIN only)
// Per API_SPEC.md#L338-L372
router.post('/users', authenticate, adminMutationLimiter, userController.createUser);
router.get('/users', authenticate, adminReadLimiter, userController.getAllUsers);

// POST /api/admin/users/purge - Purge soft-deleted users past retention period
// IMPORTANT: Must be BEFORE :id routes to avoid 'purge' being treated as an ID
router.post('/users/purge', authenticate, adminStrictMutationLimiter, userController.purgeDeletedUsers);

// PATCH /api/admin/users/:id - Update user basic fields
router.patch('/users/:id', authenticate, adminMutationLimiter, userController.updateUser);

// POST /api/admin/users/:id/reset-password - Reset user password
router.post('/users/:id/reset-password', authenticate, adminStrictMutationLimiter, userController.resetPassword);

// DELETE /api/admin/users/:id - Soft delete user
router.delete('/users/:id', authenticate, adminStrictMutationLimiter, userController.softDeleteUser);

// POST /api/admin/users/:id/restore - Restore soft-deleted user
router.post('/users/:id/restore', authenticate, adminMutationLimiter, userController.restoreUser);


// Holiday Management (ADMIN only)
// Per API_SPEC.md#L402-L412
router.post('/holidays', authenticate, adminMutationLimiter, holidayController.createHoliday);
router.get('/holidays', authenticate, adminReadLimiter, holidayController.getHolidays);
router.post('/holidays/range', authenticate, adminStrictMutationLimiter, holidayController.createHolidayRange);
router.delete('/holidays/:id', authenticate, adminMutationLimiter, holidayController.deleteHoliday);

// Attendance Management (ADMIN only)
// Force checkout for stale open sessions
router.post('/attendance/:id/force-checkout', authenticate, adminStrictMutationLimiter, attendanceController.forceCheckout);
router.get('/attendance/open-sessions', authenticate, adminReadLimiter, attendanceController.getAdminOpenSessions);

export default router;
