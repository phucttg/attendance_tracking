import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from server root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Override MONGO_URI for test database
process.env.MONGO_URI = process.env.MONGO_URI?.replace(/\/[^/]+$/, '/attendance_test_db')
    || 'mongodb://localhost:27017/attendance_test_db';

// Establish a single persistent connection shared across all test files.
// Avoids 44+ connect/close cycles in one process (singleFork: true) that
// degrade the Mongoose connection pool and cause non-deterministic auth failures.
if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
}
