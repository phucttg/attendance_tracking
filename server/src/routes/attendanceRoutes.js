import express from 'express';
import * as attendanceController from '../controllers/attendanceController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import {
  authReadLimiter,
  managerAdminReadLimiter,
  userMutationLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

// All attendance routes require authentication
// Roles: EMPLOYEE, MANAGER, ADMIN (all authenticated users can access)

router.post('/check-in', authenticate, userMutationLimiter, attendanceController.checkIn);
router.post('/check-out', authenticate, userMutationLimiter, attendanceController.checkOut);
router.get('/me', authenticate, authReadLimiter, attendanceController.getMyAttendance);
router.get('/open-session', authenticate, authReadLimiter, attendanceController.getOpenSession);

// Member Management: Today activity (Manager/Admin only)
router.get('/today', authenticate, managerAdminReadLimiter, attendanceController.getTodayAttendance);

// Member Management: User attendance history (Manager/Admin only)
router.get('/user/:id', authenticate, managerAdminReadLimiter, attendanceController.getAttendanceByUser);

export default router;
