import mongoose from 'mongoose';
import * as workScheduleService from '../services/workScheduleService.js';

const pickString = (value) => {
  if (Array.isArray(value)) return pickString(value[0]);
  return typeof value === 'string' ? value.trim() : undefined;
};

/**
 * GET /api/work-schedules/me?start=YYYY-MM-DD&days=7
 * Note: start/days are accepted for compatibility but always normalized server-side.
 */
export const getMyWorkSchedules = async (req, res) => {
  try {
    // Accepted but intentionally ignored in phase 1 normalization policy.
    pickString(req.query.start);
    pickString(req.query.days);

    const result = await workScheduleService.getMyScheduleWindow(req.user._id);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode < 500
      ? (error.message || 'Failed to fetch work schedules')
      : 'Failed to fetch work schedules';
    return res.status(statusCode).json({ message });
  }
};

/**
 * GET /api/work-schedules/users/:id?start=YYYY-MM-DD&days=7
 * MANAGER/ADMIN read-only access to member schedules.
 */
export const getUserWorkSchedules = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }

    // Accepted but intentionally ignored in phase 1 normalization policy.
    pickString(req.query.start);
    pickString(req.query.days);

    const result = await workScheduleService.getUserScheduleWindow(id, req.user);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode < 500
      ? (error.message || 'Failed to fetch work schedules')
      : 'Failed to fetch work schedules';
    return res.status(statusCode).json({ message });
  }
};

/**
 * PUT /api/work-schedules/me
 * Full-replace (atomic) 7-day window update.
 */
export const putMyWorkSchedules = async (req, res) => {
  try {
    const result = await workScheduleService.putMyScheduleWindow(req.user._id, req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode < 500 && error.code === 'INVALID_SCHEDULE_WINDOW') {
      return res.status(statusCode).json({
        message: error.message || 'Invalid schedule update',
        code: error.code,
        errorsByDate: error.errorsByDate || {}
      });
    }
    const message = statusCode < 500
      ? (error.message || 'Failed to update work schedules')
      : 'Failed to update work schedules';
    return res.status(statusCode).json({ message });
  }
};
