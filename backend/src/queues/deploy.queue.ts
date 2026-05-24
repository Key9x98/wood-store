import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export type DeployOp = 'deploy-theme' | 'switch-template';

export interface DeployJobPayload {
  siteId: number;
  op: DeployOp;
  /** Target template — required when op is 'switch-template'. */
  templateId?: number;
}

export interface IDeployQueue {
  enqueue(payload: DeployJobPayload): Promise<{ jobId: string }>;
}

export const deployQueue = new Queue<DeployJobPayload>('deploy', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const DeployQueueAdapter: IDeployQueue = {
  async enqueue(payload) {
    // No custom jobId — each deploy request is its own job. Re-running is safe:
    // theme install overwrites, activate + flush are idempotent.
    const job = await deployQueue.add(`deploy-${payload.op}`, payload);
    return { jobId: String(job.id) };
  },
};
