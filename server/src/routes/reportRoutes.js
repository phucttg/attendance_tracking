import express from 'express';
import * as reportController from '../controllers/reportController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import {
  reportExportLimiter,
  reportMonthlyLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

// All report routes require authentication

// GET /api/reports/monthly?month=YYYY-MM&scope=team|company&teamId?
// Roles: MANAGER | ADMIN
router.get('/monthly', authenticate, reportMonthlyLimiter, authorize('MANAGER', 'ADMIN'), reportController.getMonthlyReport);

// GET /api/reports/monthly/export?month=YYYY-MM&scope=team|company&teamId?
// Roles: MANAGER | ADMIN
router.get('/monthly/export', authenticate, reportExportLimiter, authorize('MANAGER', 'ADMIN'), reportController.exportMonthlyReport);

export default router;
