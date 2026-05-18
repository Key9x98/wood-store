import { Worker } from 'bullmq';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { provisionOrchestrator } from '../modules/provision/provision.module';
import { STEP_KEYS } from '../modules/provision/provision.types';
import { provisionCounter } from '../lib/metrics';

const JobSchema = z.object({
  siteId: z.number().int().positive(),
  completed: z.array(z.enum(STEP_KEYS)),
});

const worker = new Worker(
  'rollback',
  async (job) => {
    const data = JobSchema.parse(job.data);
    const log = logger.child({ jobId: job.id, siteId: data.siteId });
    log.info({ steps: data.completed }, 'rollback job picked up');
    await provisionOrchestrator.rollback(data.siteId, data.completed);
    provisionCounter.inc({ result: 'rolled_back' });
    log.info('rollback job complete');
  },
  {
    connection: redis,
    concurrency: 1,
    lockDuration: 10 * 60_000,
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'rollback_job_failed');
});

const shutdown = async (sig: string): Promise<void> => {
  logger.info({ sig }, 'rollback worker shutting down');
  await worker.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

logger.info('rollback worker started');
