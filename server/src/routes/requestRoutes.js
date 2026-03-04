import express from 'express';
import * as requestController from '../controllers/requestController.js';
import { authenticate, authorize } from '../middlewares/authMiddleware.js';

const router = express.Router();

// All request routes require authentication
// Employee, Manager, Admin can create and view their own requests
router.post('/', authenticate, requestController.createRequest);
router.get('/me', authenticate, requestController.getMyRequests);

// Only Manager and Admin can view pending requests and approve/reject
router.get('/pending', authenticate, authorize('MANAGER', 'ADMIN'), requestController.getPendingRequests);
router.get('/history', authenticate, authorize('MANAGER', 'ADMIN'), requestController.getApprovalHistory);
router.post('/:id/approve', authenticate, authorize('MANAGER', 'ADMIN'), requestController.approveRequest);
router.post('/:id/reject', authenticate, authorize('MANAGER', 'ADMIN'), requestController.rejectRequest);

// DELETE /api/requests/:id - Cancel OT request (authenticated users only, own requests)
router.delete('/:id', authenticate, requestController.cancelRequest);

export default router;
