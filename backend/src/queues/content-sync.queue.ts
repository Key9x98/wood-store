import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export type ContentSyncOp = 'upsert' | 'delete' | 'full-resync';

export interface ContentSyncJobPayload {
  siteId: number;
  op: ContentSyncOp;
  /** Required for 'upsert' and 'delete'; ignored for 'full-resync'. */
  productId?: number;
}

export interface IContentSyncQueue {
  enqueue(payload: ContentSyncJobPayload): Promise<{ jobId: string }>;
}

export const contentSyncQueue = new Queue<ContentSyncJobPayload>('content-sync', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const ContentSyncQueueAdapter: IContentSyncQueue = {
  async enqueue(payload) {
    // No custom jobId on purpose: every content edit must produce its own sync
    // job. A stable jobId would let BullMQ silently drop a later edit while an
    // earlier job for the same site is still queued. Idempotency is guaranteed
    // downstream instead — the plugin upserts products by slug and media is
    // deduped by url hash, so re-running a job never double-writes.
    const job = await contentSyncQueue.add(`content-sync-${payload.op}`, payload);
    return { jobId: String(job.id) };
  },
};
