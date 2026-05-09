import pino from 'pino';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
function hasPinoPretty() {
  try { _require.resolve('pino-pretty'); return true; } catch { return false; }
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]'
  },
  ...(process.env.NODE_ENV !== 'production' && hasPinoPretty() && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' }
    }
  })
});

export default logger;
