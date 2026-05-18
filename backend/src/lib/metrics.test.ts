import { describe, it, expect, beforeEach } from 'vitest';
import { renderMetrics, registry, __resetMetricsForTest } from './metrics';

describe('metrics.renderMetrics', () => {
  beforeEach(() => {
    __resetMetricsForTest();
  });

  it('returns Prometheus text/plain exposition with cms_ default metrics', async () => {
    const { contentType, body } = await renderMetrics();
    expect(contentType).toMatch(/text\/plain/);
    // collectDefaultMetrics ships process_cpu_user_seconds_total etc., prefixed cms_
    expect(body).toMatch(/cms_process_cpu_user_seconds_total/);
  });

  it('includes cms_bullmq_jobs gauge for each known queue', async () => {
    const { body } = await renderMetrics();
    expect(body).toMatch(/cms_bullmq_jobs\{[^}]*queue="provision"[^}]*\}/);
    expect(body).toMatch(/cms_bullmq_jobs\{[^}]*queue="template-import"[^}]*\}/);
    expect(body).toMatch(/cms_bullmq_jobs\{[^}]*queue="rollback"[^}]*\}/);
  });

  it('never throws when Redis is unreachable (sets 0 across states)', async () => {
    // Redis is lazyConnect + unreachable in test → metrics must still render.
    await expect(renderMetrics()).resolves.toBeDefined();
    const metrics = await registry.metrics();
    // 5 states × 3 queues = 15 series, all 0
    const zeros = metrics.match(/cms_bullmq_jobs\{[^}]+\} 0/g) ?? [];
    expect(zeros.length).toBeGreaterThanOrEqual(15);
  });
});
