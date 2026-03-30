import mongoose from 'mongoose';
import { SCHEDULE_TYPES } from '../utils/schedulePolicy.js';

const workScheduleRegistrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    workDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    scheduleType: {
      type: String,
      enum: SCHEDULE_TYPES,
      required: true
    },
    lockedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

workScheduleRegistrationSchema.index({ userId: 1, workDate: 1 }, { unique: true });
workScheduleRegistrationSchema.index({ workDate: 1 });

const WorkScheduleRegistration = mongoose.model('WorkScheduleRegistration', workScheduleRegistrationSchema);

export default WorkScheduleRegistration;
