import { Queue } from 'bullmq';
import { redis } from '../lib/redis';
import type { StepKey } from '../modules/provision/provision.types';

export interface RollbackJobPayload {
  siteId: number;
  completed: StepKey[];
}

export interface IRollbackQueue {
  enqueue(payload: RollbackJobPayload): Promise<{ jobId: string }>;
}

export const rollbackQueue = new Queue<RollbackJobPayload>('rollback', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 86400, count: 200 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const RollbackQueueAdapter: IRollbackQueue = {
  async enqueue(payload) {
    const jobId = `rollback:${payload.siteId}:${Date.now()}`;
    await rollbackQueue.add('rollback-site', payload, { jobId });
    return { jobId };
  },
};
