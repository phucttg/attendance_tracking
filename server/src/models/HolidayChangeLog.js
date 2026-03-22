import mongoose from 'mongoose';

const HOLIDAY_CHANGE_ACTIONS = ['DELETE'];

const holidayChangeLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            enum: HOLIDAY_CHANGE_ACTIONS
        },
        actorUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        holidayId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Holiday',
            required: true
        },
        holidayDate: {
            type: String,
            required: true,
            validate: {
                validator: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
                message: 'holidayDate must be in YYYY-MM-DD format'
            }
        },
        holidayName: {
            type: String,
            required: true,
            trim: true
        }
    },
    {
        timestamps: {
            createdAt: true,
            updatedAt: false
        }
    }
);

holidayChangeLogSchema.index({ actorUserId: 1, createdAt: -1 });
holidayChangeLogSchema.index({ holidayDate: 1, createdAt: -1 });

export { HOLIDAY_CHANGE_ACTIONS };
export default mongoose.model('HolidayChangeLog', holidayChangeLogSchema);
