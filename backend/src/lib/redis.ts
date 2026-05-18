import IORedis from 'ioredis';
import { env } from '../config/env';

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (e: Error) => {
  // Avoid circular import with logger here; consumers can attach handlers if needed.
  console.error('[redis] error', e.message);
});

export type RedisClient = typeof redis;
