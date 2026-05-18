import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { redis } from './lib/redis';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server started');
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    redis.disconnect();
    process.exit(0);
  });
  // hard exit if not closed in 10s
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled_rejection');
});
process.on('uncaughtException', (e) => {
  logger.fatal({ err: e }, 'uncaught_exception');
  process.exit(1);
});
