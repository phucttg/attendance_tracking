import 'dotenv/config';
import mongoose from 'mongoose';
import Attendance from '../src/models/Attendance.js';
import { getMongoConnectionUri, getConnectionOptions } from '../src/config/database.js';
import { buildAttendanceScheduleSnapshot } from '../src/utils/schedulePolicy.js';

async function run() {
  const uri = getMongoConnectionUri();
  if (!uri) {
    throw new Error('MONGO_URI (or MONGODB_URI) is required');
  }

  await mongoose.connect(uri, getConnectionOptions());

  const legacySnapshot = buildAttendanceScheduleSnapshot('SHIFT_1', 'LEGACY_BACKFILL');

  const filter = {
    $or: [
      { scheduleType: { $exists: false } },
      { scheduledStartMinutes: { $exists: false } },
      { scheduledEndMinutes: { $exists: false } },
      { lateGraceMinutes: { $exists: false } },
      { lateTrackingEnabled: { $exists: false } },
      { earlyLeaveTrackingEnabled: { $exists: false } },
      { scheduleSource: { $exists: false } }
    ]
  };

  const result = await Attendance.updateMany(
    filter,
    {
      $set: {
        scheduleType: legacySnapshot.scheduleType,
        scheduledStartMinutes: legacySnapshot.scheduledStartMinutes,
        scheduledEndMinutes: legacySnapshot.scheduledEndMinutes,
        lateGraceMinutes: legacySnapshot.lateGraceMinutes,
        lateTrackingEnabled: legacySnapshot.lateTrackingEnabled,
        earlyLeaveTrackingEnabled: legacySnapshot.earlyLeaveTrackingEnabled,
        scheduleSource: legacySnapshot.scheduleSource
      }
    }
  );

  console.log(`Matched: ${result.matchedCount}`);
  console.log(`Modified: ${result.modifiedCount}`);

  await mongoose.connection.close();
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Backfill failed:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  });
