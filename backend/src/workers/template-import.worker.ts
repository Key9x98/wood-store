import { Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { templateImportService } from '../modules/templates/templates.module';
import type { TemplateImportJobPayload } from '../queues/template-import.queue';

const worker = new Worker<TemplateImportJobPayload>(
  'template-import',
  async (job) => {
    const log = logger.child({
      jobId: job.id,
      templateId: job.data.templateId,
      slug: job.data.slug,
    });
    log.info({ source: job.data.source.type }, 'import start');

    const r = await templateImportService.run(job.data);
    if (!r.ok) {
      log.error({ error: r.error }, 'import failed');
      throw new Error(`${r.error.code}: ${(r.error.details ?? []).join(', ')}`);
    }

    log.info({ templateId: r.value.id }, 'import done');
  },
  {
    connection: redis,
    concurrency: 1,
    lockDuration: 10 * 60_000,
  },
);

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'job_failed');
});

const shutdown = async (sig: string): Promise<void> => {
  logger.info({ sig }, 'template-import worker shutting down');
  await worker.close();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

logger.info('template-import worker started');
