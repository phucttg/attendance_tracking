// Load environment variables from .env file FIRST (before any other imports use them)
import 'dotenv/config';
import app from './app.js';
import connectDB, { disconnectDB } from './config/db.js';
import { initRateLimitRedis, disconnectRedis } from './config/redis.js';
import { runAutoCloseCatchupOnStartup, startAutoCloseScheduler } from './services/autoCloseService.js';
import logger from './config/logger.js';

const PORT = process.env.PORT;

if (!PORT) {
  logger.error('PORT is not defined in .env');
  process.exit(1);
}

let server;
let isShuttingDown = false;

const shutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received, closing gracefully');

  server.close(async () => {
    try {
      await disconnectDB();
      await disconnectRedis();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Shutdown timed out after 15 s, forcing exit');
    process.exit(1);
  }, 15_000).unref();
};

connectDB()
  .then(async () => {
    initRateLimitRedis();
    await runAutoCloseCatchupOnStartup();
    startAutoCloseScheduler();

    server = app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to connect DB');
    process.exit(1);
  });
