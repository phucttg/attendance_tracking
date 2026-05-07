import { createClient } from 'redis';

let rateLimitRedisClient = null;
let connectPromise = null;
let warnedMissingRedisUrl = false;
let warnedMemoryInProduction = false;

const normalizeStoreMode = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'redis' || normalized === 'memory' ? normalized : null;
};

export function getRateLimitStoreMode(env = process.env) {
  const configuredMode = normalizeStoreMode(env.RATE_LIMIT_STORE);

  if (configuredMode) {
    if (
      configuredMode === 'memory' &&
      env.NODE_ENV === 'production' &&
      !warnedMemoryInProduction
    ) {
      warnedMemoryInProduction = true;
      console.warn('[rate-limit] RATE_LIMIT_STORE=memory in production; Redis is recommended.');
    }
    return configuredMode;
  }

  return env.NODE_ENV === 'production' ? 'redis' : 'memory';
}

export function getRateLimitRedisClient() {
  const storeMode = getRateLimitStoreMode();
  if (storeMode !== 'redis') {
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (!warnedMissingRedisUrl) {
      warnedMissingRedisUrl = true;
      console.warn('[rate-limit] RATE_LIMIT_STORE=redis but REDIS_URL is not configured; rate limits fail open.');
    }
    return null;
  }

  if (!rateLimitRedisClient) {
    rateLimitRedisClient = createClient({ url: redisUrl });
    rateLimitRedisClient.on('error', (err) => {
      console.warn('[rate-limit] Redis client error; rate limits fail open:', err?.message || err);
    });
  }

  return rateLimitRedisClient;
}

export function initRateLimitRedis() {
  const client = getRateLimitRedisClient();
  if (!client) {
    return null;
  }

  if (client.isOpen) {
    return Promise.resolve(client);
  }

  if (!connectPromise) {
    connectPromise = client.connect()
      .then(() => {
        console.log('[rate-limit] Redis client connected.');
        return client;
      })
      .catch((err) => {
        console.warn('[rate-limit] Redis connection failed; rate limits fail open:', err?.message || err);
        connectPromise = null;
        return null;
      });
  }

  return connectPromise;
}

