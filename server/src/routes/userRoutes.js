import express from 'express';
import { getUserById } from '../controllers/userController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { managerAdminReadLimiter } from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

/**
 * @route GET /api/users/:id
 * @desc Get user profile by ID (Member Management)
 * @access Protected (MANAGER: same-team only, ADMIN: any user)
 */
router.get('/:id', authenticate, managerAdminReadLimiter, getUserById);

export default router;
