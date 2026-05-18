---
name: create-queue-worker
description: Viết một BullMQ worker mới (idempotent, có retry, graceful shutdown). Dùng khi user nói "tạo worker", "viết job BullMQ", "thêm queue mới" hoặc xử lý bug worker stalled/duplicate. Đọc docs/queue-workers.md trước.
---

# Skill: Create Queue Worker

## 1. Trước khi code

Trả lời 4 câu hỏi:

1. **Trigger**: ai enqueue job này?
2. **Payload**: schema gì? Có siteId/templateId?
3. **Idempotency key**: trùng job thì BullMQ skip kiểu gì? (`jobId`)
4. **Compensation**: nếu fail nửa chừng, undo ra sao?

Nếu trả lời được 4 câu → code. Nếu không → hỏi user.

## 2. Skeleton worker

```ts
// src/workers/<name>.worker.ts
import { Worker } from 'bullmq';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { run } from '../lib/shell';
import { withMetrics } from '../lib/metrics';

const JobSchema = z.object({
  // ... payload
});

const worker = new Worker(
  '<queue-name>',
  withMetrics(async (job) => {
    const data = JobSchema.parse(job.data);
    const log = logger.child({ jobId: job.id, queue: job.queueName });
    log.info({ data }, 'start');

    // 1. Idempotency check
    // 2. Execute
    // 3. Persist result + mark step done

    log.info('done');
  }),
  {
    connection: redis,
    concurrency: 2,
    lockDuration: 60_000,
  }
);

worker.on('failed',  (job, err) => logger.error({ jobId: job?.id, err }, 'failed'));
worker.on('stalled', (jobId)    => logger.warn({ jobId }, 'stalled'));

process.on('SIGTERM', async () => {
  logger.info('SIGTERM — closing worker');
  await worker.close();
  process.exit(0);
});
```

## 3. Idempotent patterns

### Pattern A — Step state in DB

```ts
const site = await sitesRepo.findById(siteId);
if (site.provision_state.steps.H?.done) return;
const result = await doIt();
await sitesRepo.markStepDone(siteId, 'H', result);
```

### Pattern B — External resource exists check

```ts
const existing = await dnsProvider.findRecord(domain);
if (existing) return existing;
return dnsProvider.create(domain, ip);
```

### Pattern C — Unique constraint catch

```ts
try {
  await db.x.create({ data });
} catch (e) {
  if (isUniqueViolation(e)) return db.x.findUnique({ where: { uniqueKey } });
  throw e;
}
```

## 4. Enqueue side

```ts
// src/queues/<name>.queue.ts
import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export const xQueue = new Queue('<queue-name>', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 7 * 86400 },
  },
});

export const enqueueX = (data: XPayload) =>
  xQueue.add('x', data, { jobId: `x:${data.siteId}` });
```

## 5. Shell exec từ worker

```ts
import { run } from '../lib/shell';

// ✅ args array
await run('certbot', ['certonly', '--nginx', '-d', domain, '--non-interactive', ...]);

// ❌ NEVER
await exec(`certbot certonly -d ${domain}`);
```

Domain phải qua validate regex trước.

## 6. Long-running step

Step > 30s phải:
- Tăng `lockDuration` ở worker (5 phút).
- Gọi `await job.updateProgress({ step: 'X', percent: N })` định kỳ để BullMQ renew lock.

## 7. Cross-queue orchestration

Tránh worker A chờ worker B finish. Pattern khuyên dùng:

```ts
// Worker A xong → enqueue B → return.
await xQueue.add('next', { siteId });

// Hoặc dùng FlowProducer cho graph job (xem docs/queue-workers.md mục 9).
```

## 8. Graceful shutdown

CRITICAL: Mọi worker phải xử lý SIGTERM/SIGINT để tránh job giữa chừng mất state.

```ts
const shutdown = async (sig: string) => {
  logger.info({ sig }, 'shutting down');
  await worker.close();   // BullMQ chờ job hiện tại xong
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

## 9. Test

```ts
// vitest integration với testcontainers Redis
it('worker is idempotent', async () => {
  const q = new Queue('test', { connection: redis });
  await q.add('x', { siteId: 1 }, { jobId: 'x:1' });
  await q.add('x', { siteId: 1 }, { jobId: 'x:1' });   // dup
  await waitJobFinish(q, 'x:1');
  expect(handlerSpy).toHaveBeenCalledTimes(1);
});
```

## 10. Anti-pattern thường gặp

❌ Worker `await fetch(...)` không timeout → stalled, lock expire, job pick lại bởi worker khác → double execute.

❌ Quên `removeOnComplete` → Redis memory đầy.

❌ `concurrency: 100` cho job gọi shell → process spawn ngàn nhánh, OOM.

❌ Rethrow lỗi từ Zod parse → retry vô ích, dump bằng `removeOnFail: false`.

❌ `setInterval` trong worker để poll thay vì BullMQ delay → memory leak khi job re-run.
