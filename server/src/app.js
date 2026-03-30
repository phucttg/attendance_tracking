import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import requestRoutes from './routes/requestRoutes.js';
import timesheetRoutes from './routes/timesheetRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import workScheduleRoutes from './routes/workScheduleRoutes.js';

const app = express();

// Enable CORS so frontend (different port/domain) can call this API
app.use(cors());
// Parse incoming JSON request body automatically
app.use(express.json());

// Health check endpoint - used to verify server is alive (useful for deployment/monitoring)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// === API Routes ===
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/timesheet', timesheetRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/work-schedules', workScheduleRoutes);

export default app;
