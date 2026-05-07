import express from 'express';
import * as requestController from '../controllers/requestController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';
import {
  authReadLimiter,
  managerAdminReadLimiter,
  requestMutationLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

// All request routes require authentication
// Employee, Manager, Admin can create and view their own requests
router.post('/', authenticate, requestMutationLimiter, requestController.createRequest);
router.get('/me', authenticate, authReadLimiter, requestController.getMyRequests);

// Only Manager and Admin can view pending requests and approve/reject
router.get('/pending', authenticate, managerAdminReadLimiter, authorize('MANAGER', 'ADMIN'), requestController.getPendingRequests);
router.get('/history', authenticate, managerAdminReadLimiter, authorize('MANAGER', 'ADMIN'), requestController.getApprovalHistory);
router.post('/:id/approve', authenticate, requestMutationLimiter, authorize('MANAGER', 'ADMIN'), requestController.approveRequest);
router.post('/:id/reject', authenticate, requestMutationLimiter, authorize('MANAGER', 'ADMIN'), requestController.rejectRequest);

// DELETE /api/requests/:id - Cancel OT request (authenticated users only, own requests)
router.delete('/:id', authenticate, requestMutationLimiter, requestController.cancelRequest);

export default router;
