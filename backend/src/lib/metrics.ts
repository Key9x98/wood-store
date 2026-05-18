import { Registry, collectDefaultMetrics, Gauge, Counter, Histogram } from 'prom-client';
import { provisionQueue } from '../queues/provision.queue';
import { templateImportQueue } from '../queues/template-import.queue';
import { rollbackQueue } from '../queues/rollback.queue';
import { redis } from './redis';

export const registry = new Registry();

let defaultsRegistered = false;
function ensureDefaults(): void {
  if (defaultsRegistered) return;
  collectDefaultMetrics({ register: registry, prefix: 'cms_' });
  defaultsRegistered = true;
}

const queueDepthGauge = new Gauge({
  name: 'cms_bullmq_jobs',
  help: 'BullMQ jobs per queue / state. Best-effort; 0 when Redis unreachable.',
  labelNames: ['queue', 'state'],
  registers: [registry],
});

export const provisionCounter = new Counter({
  name: 'cms_provision_total',
  help: 'Provision job outcomes. Increment in worker on success / failure.',
  labelNames: ['result'], // 'success' | 'failed' | 'rolled_back'
  registers: [registry],
});

export const provisionDurationSeconds = new Histogram({
  name: 'cms_provision_duration_seconds',
  help: 'Wall-clock duration of provision jobs (start → end), per outcome.',
  labelNames: ['result'],
  buckets: [5, 15, 30, 60, 120, 300, 600, 1800],
  registers: [registry],
});

const QUEUE_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

interface QueueLike {
  getJobCounts: (...states: string[]) => Promise<Record<string, number>>;
}

const QUEUES: Array<{ name: string; q: QueueLike }> = [
  { name: 'provision', q: provisionQueue as unknown as QueueLike },
  { name: 'template-import', q: templateImportQueue as unknown as QueueLike },
  { name: 'rollback', q: rollbackQueue as unknown as QueueLike },
];

const QUEUE_LOOKUP_TIMEOUT_MS = 500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('queue_lookup_timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function setQueueZero(name: string): void {
  for (const state of QUEUE_STATES) {
    queueDepthGauge.set({ queue: name, state }, 0);
  }
}

/**
 * Refresh BullMQ queue gauges. Best-effort:
 *  - Short-circuits to zeros when Redis is not 'ready' (avoids ECONNREFUSED noise + hangs in test).
 *  - Each lookup is bounded by a short timeout so /metrics never blocks.
 *  - Lookups run in parallel so total latency ≈ slowest queue.
 */
export async function refreshQueueMetrics(): Promise<void> {
  if (redis.status !== 'ready') {
    for (const { name } of QUEUES) setQueueZero(name);
    return;
  }
  await Promise.all(
    QUEUES.map(async ({ name, q }) => {
      try {
        const counts = await withTimeout(
          q.getJobCounts(...QUEUE_STATES),
          QUEUE_LOOKUP_TIMEOUT_MS,
        );
        for (const state of QUEUE_STATES) {
          queueDepthGauge.set({ queue: name, state }, Number(counts[state] ?? 0));
        }
      } catch {
        setQueueZero(name);
      }
    }),
  );
}

export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  ensureDefaults();
  await refreshQueueMetrics();
  return { contentType: registry.contentType, body: await registry.metrics() };
}

/** Test helper — reset gauges between tests. */
export function __resetMetricsForTest(): void {
  registry.resetMetrics();
}
