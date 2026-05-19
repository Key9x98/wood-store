import { Worker } from 'bullmq';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { contentSyncService } from '../modules/content/content.module';
import { contentSyncCounter } from '../lib/metrics';

const JobSchema = z.object({
  siteId: z.number().int().positive(),
  op: z.enum(['upsert', 'delete', 'full-resync']),
  productId: z.number().int().positive().optional(),
});

const worker = new Worker(
  'content-sync',
  async (job) => {
    const data = JobSchema.parse(job.data);
    const log = logger.child({ jobId: job.id, siteId: data.siteId, op: data.op });
    log.info('content-sync job picked up');

    const r = await contentSyncService.run(data);
    if (!r.ok) {
      contentSyncCounter.inc({ result: 'failed' });
      log.error({ code: r.error.code, detail: r.error.detail }, 'content-sync failed');
      // Throw so BullMQ retries — run() is idempotent (plugin upserts by slug).
      throw new Error(r.error.code);
    }
    contentSyncCounter.inc({ result: 'success' });
    log.info({ summary: r.value }, 'content-sync job complete');
  },
  {
    connection: redis,
    concurrency: 3,
    lockDuration: 10 * 60_000,
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'content_sync_job_failed');
});

const shutdown = async (sig: string): Promise<void> => {
  logger.info({ sig }, 'content-sync worker shutting down');
  await worker.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

logger.info('content-sync worker started');
