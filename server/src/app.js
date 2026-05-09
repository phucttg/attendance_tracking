import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import pinoHttp from 'pino-http';
import authRoutes from './routes/authRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import requestRoutes from './routes/requestRoutes.js';
import timesheetRoutes from './routes/timesheetRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import workScheduleRoutes from './routes/workScheduleRoutes.js';
import {
  globalApiLimiter,
  parseTrustProxy
} from './middlewares/rateLimitMiddleware.js';
import { getRateLimitRedisClient } from './config/redis.js';
import logger from './config/logger.js';

const app = express();

app.set('trust proxy', parseTrustProxy());

// Enable CORS so frontend (different port/domain) can call this API
app.use(cors());

app.use(pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === '/api/health'
  },
  customLogLevel: (req, res) => {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode === 304) return 'silent';
    if (req.method === 'GET') return 'silent';
    return 'info';
  },
  customProps: (req) => ({
    userId: req.user?._id?.toString(),
  }),
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  }
}));

const HEALTH_TIMEOUT_MS = 5000;
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    )
  ]);

// Health check — verifies MongoDB and Redis connectivity (not just process liveness)
app.get('/api/health', async (_req, res) => {
  const checks = {};
  let healthy = true;

  try {
    if (mongoose.connection.readyState === 1) {
      await withTimeout(mongoose.connection.db.admin().ping(), HEALTH_TIMEOUT_MS);
      checks.db = 'ok';
    } else {
      checks.db = 'down';
      healthy = false;
    }
  } catch {
    checks.db = 'down';
    healthy = false;
  }

  const redisClient = getRateLimitRedisClient();
  if (!redisClient) {
    checks.redis = 'not_configured';
  } else {
    try {
      await withTimeout(redisClient.ping(), HEALTH_TIMEOUT_MS);
      checks.redis = 'ok';
    } catch {
      checks.redis = 'down';
      healthy = false;
    }
  }

  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    ...checks,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.use('/api', globalApiLimiter);

// Parse incoming JSON request body automatically
app.use(express.json());

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
