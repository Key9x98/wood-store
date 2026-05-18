import { Worker } from 'bullmq';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { provisionOrchestrator } from '../modules/provision/provision.module';
import { provisionCounter, provisionDurationSeconds } from '../lib/metrics';

const JobSchema = z.object({ siteId: z.number().int().positive() });

const worker = new Worker(
  'provision',
  async (job) => {
    const data = JobSchema.parse(job.data);
    const log = logger.child({ jobId: job.id, siteId: data.siteId });
    log.info('provision job picked up');
    const stop = provisionDurationSeconds.startTimer();
    try {
      await provisionOrchestrator.run(data.siteId);
      provisionCounter.inc({ result: 'success' });
      stop({ result: 'success' });
      log.info('provision job complete');
    } catch (err) {
      provisionCounter.inc({ result: 'failed' });
      stop({ result: 'failed' });
      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 2,
    lockDuration: 10 * 60_000,
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'provision_job_failed');
});

const shutdown = async (sig: string): Promise<void> => {
  logger.info({ sig }, 'provision worker shutting down');
  await worker.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

logger.info('provision worker started');
