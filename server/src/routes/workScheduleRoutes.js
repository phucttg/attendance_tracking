import express from 'express';
import * as workScheduleController from '../controllers/workScheduleController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import {
  authReadLimiter,
  managerAdminReadLimiter,
  userMutationLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

router.get('/me', authenticate, authReadLimiter, workScheduleController.getMyWorkSchedules);
router.put('/me', authenticate, userMutationLimiter, workScheduleController.putMyWorkSchedules);

router.get(
  '/users/:id',
  authenticate,
  managerAdminReadLimiter,
  authorize('MANAGER', 'ADMIN'),
  workScheduleController.getUserWorkSchedules
);

export default router;
