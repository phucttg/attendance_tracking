import { Router } from 'express';
import * as authController from '../controllers/authController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import {
  authReadLimiter,
  loginIdentifierLimiter,
  loginIpLimiter,
  managerAdminReadLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = Router();

router.post('/login', loginIpLimiter, loginIdentifierLimiter, authController.login);
router.get('/me', authenticate, authReadLimiter, authController.getMe);

// Test route - Admin only
router.get('/admin-test', authenticate, managerAdminReadLimiter, authorize('ADMIN'), (req, res) => {
  res.json({ message: 'Welcome Admin! You have access.' });
});

export default router;
