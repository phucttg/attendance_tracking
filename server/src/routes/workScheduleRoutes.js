import express from 'express';
import * as workScheduleController from '../controllers/workScheduleController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/me', authenticate, workScheduleController.getMyWorkSchedules);
router.put('/me', authenticate, workScheduleController.putMyWorkSchedules);

router.get(
  '/users/:id',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  workScheduleController.getUserWorkSchedules
);

export default router;
