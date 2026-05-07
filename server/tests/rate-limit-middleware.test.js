import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  adminRouteRateLimitKey,
  authenticatedUserRateLimitKey,
  createRawRateLimiter,
  ipRateLimitKey,
  loginIdentifierRateLimitKey
} from '../src/middlewares/rateLimitMiddleware.js';

const makeLimiter = (overrides = {}) => createRawRateLimiter({
  identifier: overrides.identifier || 'test-limiter',
  prefix: overrides.prefix || 'rl:test:',
  windowMs: overrides.windowMs || 60_000,
  limit: overrides.limit || 1,
  keyGenerator: overrides.keyGenerator || ipRateLimitKey,
  skipSuccessfulRequests: overrides.skipSuccessfulRequests || false,
  forceMemoryStore: true
});

const attachUser = (req, res, next) => {
  req.user = {
    _id: req.header('x-user-id') || 'user-1',
    role: req.header('x-user-role') || 'EMPLOYEE'
  };
  next();
};

describe('rate limit middleware', () => {
  it('does not limit health when the global limiter is mounted after it', async () => {
    const app = express();
    app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));
    app.use('/api', makeLimiter({ identifier: 'global-test', prefix: 'rl:test-global:', limit: 1 }));
    app.get('/api/data', (req, res) => res.status(200).json({ ok: true }));

    await request(app).get('/api/data').expect(200);
    await request(app).get('/api/data').expect(429);

    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/health').expect(200);
  });

  it('returns 429 with JSON retryAfter and Retry-After header', async () => {
    const app = express();
    app.get('/limited', makeLimiter({ identifier: 'json-429', prefix: 'rl:test-json:', limit: 1 }), (req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/limited').expect(200);
    const res = await request(app).get('/limited').expect(429);

    expect(res.body.message).toBe('Too many requests. Please try again later.');
    expect(Number.isFinite(res.body.retryAfter)).toBe(true);
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBe(res.body.retryAfter);
  });

  it('limits failed logins by normalized hashed identifier', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/login',
      makeLimiter({
        identifier: 'login-id-test',
        prefix: 'rl:test-login-id:',
        limit: 2,
        keyGenerator: loginIdentifierRateLimitKey,
        skipSuccessfulRequests: true
      }),
      (req, res) => {
        res.status(401).json({ message: 'Invalid credentials' });
      }
    );

    await request(app).post('/login').send({ identifier: ' User@Example.com ' }).expect(401);
    await request(app).post('/login').send({ identifier: 'user@example.com' }).expect(401);
    await request(app).post('/login').send({ identifier: 'USER@example.COM' }).expect(429);
  });

  it('does not consume failed-login quota for successful login responses', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/login',
      makeLimiter({
        identifier: 'login-success-test',
        prefix: 'rl:test-login-success:',
        limit: 1,
        keyGenerator: loginIdentifierRateLimitKey,
        skipSuccessfulRequests: true
      }),
      (req, res) => {
        if (req.body?.password === 'ok') {
          return res.status(200).json({ token: 'token' });
        }
        return res.status(401).json({ message: 'Invalid credentials' });
      }
    );

    await request(app).post('/login').send({ identifier: 'user@example.com', password: 'ok' }).expect(200);
    await request(app).post('/login').send({ identifier: 'user@example.com', password: 'bad' }).expect(401);
    await request(app).post('/login').send({ identifier: 'user@example.com', password: 'bad' }).expect(429);
  });

  it('isolates auth-read quota by user ID', async () => {
    const app = express();
    app.use(attachUser);
    app.get(
      '/me',
      makeLimiter({
        identifier: 'auth-read-test',
        prefix: 'rl:test-auth-read:',
        limit: 1,
        keyGenerator: authenticatedUserRateLimitKey
      }),
      (req, res) => res.status(200).json({ ok: true })
    );

    await request(app).get('/me').set('x-user-id', 'user-1').expect(200);
    await request(app).get('/me').set('x-user-id', 'user-1').expect(429);
    await request(app).get('/me').set('x-user-id', 'user-2').expect(200);
  });

  it('keeps manager/admin read quota separate from auth-read quota', async () => {
    const app = express();
    app.use(attachUser);
    app.get(
      '/me',
      makeLimiter({
        identifier: 'auth-read-separate',
        prefix: 'rl:test-auth-read-separate:',
        limit: 1,
        keyGenerator: authenticatedUserRateLimitKey
      }),
      (req, res) => res.status(200).json({ ok: true })
    );
    app.get(
      '/manager',
      makeLimiter({
        identifier: 'manager-read-separate',
        prefix: 'rl:test-manager-read-separate:',
        limit: 1,
        keyGenerator: authenticatedUserRateLimitKey
      }),
      (req, res) => res.status(200).json({ ok: true })
    );

    await request(app).get('/me').set('x-user-id', 'user-1').expect(200);
    await request(app).get('/manager').set('x-user-id', 'user-1').expect(200);
    await request(app).get('/manager').set('x-user-id', 'user-1').expect(429);
  });

  it('uses a stricter admin mutation bucket than normal admin mutations', async () => {
    const app = express();
    app.use(attachUser);
    app.post(
      '/admin/normal',
      makeLimiter({
        identifier: 'admin-normal-test',
        prefix: 'rl:test-admin-normal:',
        limit: 2,
        keyGenerator: adminRouteRateLimitKey
      }),
      (req, res) => res.status(200).json({ ok: true })
    );
    app.post(
      '/admin/strict',
      makeLimiter({
        identifier: 'admin-strict-test',
        prefix: 'rl:test-admin-strict:',
        limit: 1,
        keyGenerator: adminRouteRateLimitKey
      }),
      (req, res) => res.status(200).json({ ok: true })
    );

    await request(app).post('/admin/normal').set('x-user-id', 'admin-1').set('x-user-role', 'ADMIN').expect(200);
    await request(app).post('/admin/normal').set('x-user-id', 'admin-1').set('x-user-role', 'ADMIN').expect(200);
    await request(app).post('/admin/normal').set('x-user-id', 'admin-1').set('x-user-role', 'ADMIN').expect(429);

    await request(app).post('/admin/strict').set('x-user-id', 'admin-1').set('x-user-role', 'ADMIN').expect(200);
    await request(app).post('/admin/strict').set('x-user-id', 'admin-1').set('x-user-role', 'ADMIN').expect(429);
  });
});

