# Queue & Workers (BullMQ)

## 1. Nguyên tắc

1. **Idempotent**: mỗi job có thể chạy lại N lần, kết quả = chạy 1 lần.
2. **Atomic state**: mỗi step ghi state vào DB trước khi sang step sau.
3. **No-op skip**: bắt đầu mỗi step kiểm tra "đã làm chưa".
4. **Compensating actions ở queue riêng**: rollback không inline.
5. **Timeout cụ thể** cho mỗi gọi shell/HTTP (mặc định 60s).

## 2. Queue list

| Queue | Purpose | Concurrency | Attempts |
|---|---|---|---|
| `provision` | tạo site end-to-end | 2 | 3 |
| `dns` | sub-job DNS | 4 | 5 |
| `ssl` | certbot | 1 | 3 (long backoff) |
| `deploy` | code/theme deploy | 2 | 3 |
| `ai` | content gen | 4 | 2 |
| `rollback` | undo lỗi | 1 | 3 |
| `template-import` | import template artifact | 1 | 2 |

## 3. Job payload schema (Zod)

Mọi payload validate Zod ở entry worker:

```ts
const ProvisionJobSchema = z.object({
  siteId: z.number().int().positive(),
});

new Worker('provision', async (job) => {
  const data = ProvisionJobSchema.parse(job.data);
  // ...
});
```

Job xấu (schema fail) → throw, mark failed, không retry.

## 4. Step tracking pattern

```ts
type ProvisionState = {
  steps: Record<'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H'|'I'|'J', {
    done: boolean;
    at?: string;
    artefact?: Record<string, unknown>;  // ví dụ { recordId: 'cf_xxx' }
  }>;
};

async function runStep<K extends keyof ProvisionState['steps']>(
  siteId: number,
  key: K,
  fn: () => Promise<NonNullable<ProvisionState['steps'][K]['artefact']>>,
) {
  const site = await sitesRepo.findById(siteId);
  if (site.provision_state.steps[key]?.done) return;
  const artefact = await fn();
  await sitesRepo.markStepDone(siteId, key, artefact);
}
```

Worker chính:
```ts
await runStep(siteId, 'B', () => dnsService.createRecord(domain));
await runStep(siteId, 'C', () => sourceService.materializeSite(domain, template));
// ...
```

## 5. Retry & backoff

```ts
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 }, // 5s, 25s, 125s
}
```

SSL queue dùng backoff dài hơn (5m, 15m, 45m) vì rate-limit LE.

DNS queue dùng linear 2s vì provider lỗi tạm là chuyện thường.

## 6. Unique job key

```ts
provisionQueue.add('provision-site', { siteId }, {
  jobId: `site:${siteId}`,   // BullMQ reject duplicate jobId
});
```

User bấm "Provision" 2 lần → chỉ 1 job chạy.

## 7. Worker lifecycle

```ts
const worker = new Worker('provision', handler, opts);

worker.on('completed', (job) => log.info({ jobId: job.id }, 'completed'));
worker.on('failed',    (job, err) => log.error({ jobId: job?.id, err }, 'failed'));
worker.on('stalled',   (jobId) => log.warn({ jobId }, 'stalled'));

process.on('SIGTERM', async () => {
  log.info('SIGTERM, closing worker');
  await worker.close();
  process.exit(0);
});
```

Graceful shutdown CỰC kỳ quan trọng để job đang chạy không bị mất.

## 8. Stalled job

`lockDuration` (mặc định 30s) ngắn hơn step → worker phải `job.updateProgress()` định kỳ:

```ts
await job.updateProgress({ step: 'C', percent: 30 });
```

Hoặc tăng `lockDuration: 5 * 60_000` nếu step dài (clone repo lớn).

## 9. Cross-queue orchestration

Tránh worker A enqueue queue B rồi `await` job B finish — dễ deadlock.

Pattern khuyên dùng: **Flow** (BullMQ FlowProducer):

```ts
import { FlowProducer } from 'bullmq';
const flow = new FlowProducer({ connection: redis });

await flow.add({
  name: 'provision-site',
  queueName: 'provision',
  data: { siteId },
  children: [
    { name: 'dns',  queueName: 'dns',  data: { siteId } },
    { name: 'ssl',  queueName: 'ssl',  data: { siteId }, opts: { delay: 60_000 } },
  ],
});
```

Hoặc đơn giản: worker A finish → emit event → API tự enqueue tiếp.

## 10. Dead Letter handling

Job failed sau hết retries:
- BullMQ lưu trong "failed" set.
- Job admin UI (Bull Board) cho phép xem và requeue thủ công.
- Auto: hook `failed` event → INSERT `dead_letters` table + alert Slack.

## 11. Monitoring

Expose metrics qua `bullmq-prometheus` hoặc tự code:

```ts
app.get('/metrics', async (req, res) => {
  const queues = [provisionQueue, dnsQueue, sslQueue];
  const lines = [];
  for (const q of queues) {
    const counts = await q.getJobCounts('wait', 'active', 'completed', 'failed', 'delayed');
    for (const [state, n] of Object.entries(counts)) {
      lines.push(`bullmq_jobs{queue="${q.name}",state="${state}"} ${n}`);
    }
  }
  res.type('text/plain').send(lines.join('\n'));
});
```

Grafana alert: queue depth > 100 trong 5 phút → page on-call.

## 12. Test recipe

```ts
// vitest integration test
import { Queue, Worker } from 'bullmq';
import { redis } from './test-helpers';

it('runs provision idempotently', async () => {
  const q = new Queue('test-provision', { connection: redis });
  const handlerSpy = vi.fn().mockResolvedValue(undefined);
  const w = new Worker('test-provision', handlerSpy, { connection: redis, concurrency: 1 });

  await q.add('p', { siteId: 1 }, { jobId: 'site:1' });
  await q.add('p', { siteId: 1 }, { jobId: 'site:1' });  // duplicate

  await waitForJobCompletion(q, 'site:1');
  expect(handlerSpy).toHaveBeenCalledTimes(1);
  await w.close(); await q.close();
});
```
