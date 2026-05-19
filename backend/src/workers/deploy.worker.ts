import { Worker } from 'bullmq';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { deployThemeService } from '../modules/deploy/deploy.module';
import { deployCounter } from '../lib/metrics';

const JobSchema = z.object({
  siteId: z.number().int().positive(),
  op: z.enum(['deploy-theme']),
});

const worker = new Worker(
  'deploy',
  async (job) => {
    const data = JobSchema.parse(job.data);
    const log = logger.child({ jobId: job.id, siteId: data.siteId, op: data.op });
    log.info('deploy job picked up');

    const r = await deployThemeService.run(data);
    if (!r.ok) {
      deployCounter.inc({ result: 'failed' });
      log.error({ code: r.error.code, detail: r.error.detail }, 'deploy failed');
      // Throw so BullMQ retries — run() is idempotent (install overwrites).
      throw new Error(r.error.code);
    }
    deployCounter.inc({ result: 'success' });
    log.info({ summary: r.value }, 'deploy job complete');
  },
  {
    connection: redis,
    concurrency: 2,
    lockDuration: 10 * 60_000,
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'deploy_job_failed');
});

const shutdown = async (sig: string): Promise<void> => {
  logger.info({ sig }, 'deploy worker shutting down');
  await worker.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

logger.info('deploy worker started');
