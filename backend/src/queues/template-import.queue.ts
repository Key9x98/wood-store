import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export interface TemplateImportJobPayload {
  templateId: number;
  slug: string;
  /** Path to the uploaded .zip on disk (written by TemplateService.startImport). */
  zipPath: string;
}

export interface ITemplateImportQueue {
  enqueue(payload: TemplateImportJobPayload): Promise<{ jobId: string }>;
}

export const templateImportQueue = new Queue<TemplateImportJobPayload>('template-import', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86400, count: 200 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const TemplateImportQueueAdapter: ITemplateImportQueue = {
  async enqueue(payload) {
    const jobId = `tpl-import:${payload.slug}:${payload.templateId}`;
    await templateImportQueue.add('import', payload, { jobId });
    return { jobId };
  },
};
