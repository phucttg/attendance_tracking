import crypto from 'crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import {
  getRateLimitRedisClient,
  getRateLimitStoreMode,
  initRateLimitRedis
} from '../config/redis.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

const MESSAGE = 'Too many requests. Please try again later.';

const passThrough = (req, res, next) => next();

let warnedRedisStoreUnavailable = false;

export function isRateLimitEnabled(env = process.env) {
  if (env.NODE_ENV === 'test') {
    return false;
  }

  return env.RATE_LIMIT_ENABLED !== 'false';
}

export function parseTrustProxy(value = process.env.TRUST_PROXY) {
  const parsed = Number.parseInt(value ?? '0', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export function hashLoginIdentifier(identifier) {
  return crypto
    .createHash('sha256')
    .update(String(identifier || '').trim().toLowerCase())
    .digest('hex');
}

export function ipRateLimitKey(req) {
  return ipKeyGenerator(req.ip);
}

export function loginIdentifierRateLimitKey(req) {
  return `${ipRateLimitKey(req)}:${hashLoginIdentifier(req.body?.identifier)}`;
}

export function authenticatedUserRateLimitKey(req) {
  if (req.user?._id) {
    return `user:${String(req.user._id)}`;
  }

  return `ip:${ipRateLimitKey(req)}`;
}

export function adminRouteRateLimitKey(req) {
  const role = req.user?.role || 'anonymous';
  const id = req.user?._id ? String(req.user._id) : ipRateLimitKey(req);
  return `admin-route:${role}:${id}`;
}

function getRetryAfterSeconds(req, windowMs) {
  const resetTime = req.rateLimit?.resetTime;
  const resetMs = resetTime instanceof Date
    ? resetTime.getTime()
    : Number(resetTime);

  if (Number.isFinite(resetMs)) {
    return Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  }

  return Math.max(1, Math.ceil(windowMs / 1000));
}

function createHandler(windowMs) {
  return (req, res) => {
    const retryAfter = getRetryAfterSeconds(req, windowMs);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      message: MESSAGE,
      retryAfter
    });
  };
}

function createRedisStore(prefix) {
  if (getRateLimitStoreMode() !== 'redis') {
    return undefined;
  }

  const client = getRateLimitRedisClient();
  if (!client) {
    if (!warnedRedisStoreUnavailable) {
      warnedRedisStoreUnavailable = true;
      console.warn('[rate-limit] Redis store unavailable; limiters fail open.');
    }
    return null;
  }

  initRateLimitRedis();

  return new RedisStore({
    prefix,
    sendCommand: (...args) => client.sendCommand(args)
  });
}

export function createRawRateLimiter({
  identifier,
  prefix,
  windowMs,
  limit,
  keyGenerator,
  skipSuccessfulRequests = false,
  forceMemoryStore = false
}) {
  const store = forceMemoryStore ? undefined : createRedisStore(prefix);

  if (store === null) {
    return passThrough;
  }

  return rateLimit({
    windowMs,
    limit,
    identifier,
    keyGenerator,
    skip: (req) => req.method === 'OPTIONS',
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: createHandler(windowMs),
    passOnStoreError: true,
    ...(store ? { store } : {})
  });
}

function createAppRateLimiter(config) {
  if (!isRateLimitEnabled()) {
    return passThrough;
  }

  return createRawRateLimiter(config);
}

export const globalApiLimiter = createAppRateLimiter({
  identifier: 'global-api',
  prefix: 'rl:global:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 1000,
  keyGenerator: ipRateLimitKey
});

export const loginIpLimiter = createAppRateLimiter({
  identifier: 'login-ip',
  prefix: 'rl:login-ip:',
  windowMs: 5 * ONE_MINUTE_MS,
  limit: 30,
  keyGenerator: ipRateLimitKey,
  skipSuccessfulRequests: true
});

export const loginIdentifierLimiter = createAppRateLimiter({
  identifier: 'login-identifier',
  prefix: 'rl:login-id:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 5,
  keyGenerator: loginIdentifierRateLimitKey,
  skipSuccessfulRequests: true
});

export const authReadLimiter = createAppRateLimiter({
  identifier: 'auth-read',
  prefix: 'rl:auth-read:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 300,
  keyGenerator: authenticatedUserRateLimitKey
});

export const userMutationLimiter = createAppRateLimiter({
  identifier: 'user-mutation',
  prefix: 'rl:user-mutation:',
  windowMs: ONE_MINUTE_MS,
  limit: 20,
  keyGenerator: authenticatedUserRateLimitKey
});

export const requestMutationLimiter = createAppRateLimiter({
  identifier: 'request-mutation',
  prefix: 'rl:request-mutation:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 60,
  keyGenerator: authenticatedUserRateLimitKey
});

export const managerAdminReadLimiter = createAppRateLimiter({
  identifier: 'manager-admin-read',
  prefix: 'rl:manager-admin-read:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 120,
  keyGenerator: authenticatedUserRateLimitKey
});

export const reportMonthlyLimiter = createAppRateLimiter({
  identifier: 'report-monthly',
  prefix: 'rl:report-monthly:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 60,
  keyGenerator: authenticatedUserRateLimitKey
});

export const timesheetCompanyLimiter = createAppRateLimiter({
  identifier: 'timesheet-company',
  prefix: 'rl:timesheet-company:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 20,
  keyGenerator: authenticatedUserRateLimitKey
});

export const reportExportLimiter = createAppRateLimiter({
  identifier: 'report-export',
  prefix: 'rl:report-export:',
  windowMs: ONE_HOUR_MS,
  limit: 10,
  keyGenerator: authenticatedUserRateLimitKey
});

export const adminReadLimiter = createAppRateLimiter({
  identifier: 'admin-read',
  prefix: 'rl:admin-read:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 120,
  keyGenerator: adminRouteRateLimitKey
});

export const adminMutationLimiter = createAppRateLimiter({
  identifier: 'admin-mutation',
  prefix: 'rl:admin-mutation:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 60,
  keyGenerator: adminRouteRateLimitKey
});

export const adminStrictMutationLimiter = createAppRateLimiter({
  identifier: 'admin-strict-mutation',
  prefix: 'rl:admin-strict-mutation:',
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 10,
  keyGenerator: adminRouteRateLimitKey
});
