import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export interface ProvisionJobPayload {
  siteId: number;
}

export interface IProvisionQueue {
  enqueue(payload: ProvisionJobPayload): Promise<{ jobId: string }>;
}

export const provisionQueue = new Queue<ProvisionJobPayload>('provision', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const ProvisionQueueAdapter: IProvisionQueue = {
  async enqueue(payload) {
    // BullMQ rejects a custom jobId containing ':' unless it splits into 3 parts.
    const jobId = `site-${payload.siteId}`;
    await provisionQueue.add('provision-site', payload, { jobId });
    return { jobId };
  },
};
