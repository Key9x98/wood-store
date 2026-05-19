import { describe, it, expect, vi } from 'vitest';
import { DeployService } from './deploy.service';
import type { DeploySiteLookup, Viewer } from './deploy.service';
import type { IDeployQueue } from '../../queues/deploy.queue';

const buildSites = (over: Partial<DeploySiteLookup> = {}): DeploySiteLookup => ({
  findById: vi.fn().mockResolvedValue({ id: 8, ownerId: 1 }),
  ...over,
});

const buildQueue = (): IDeployQueue => ({
  enqueue: vi.fn().mockResolvedValue({ jobId: 'deploy-1' }),
});

const owner: Viewer = { id: 1, role: 'user' };

describe('DeployService.requestThemeDeploy', () => {
  it('enqueues a deploy-theme job for an owned site', async () => {
    const queue = buildQueue();
    const svc = new DeployService(buildSites(), queue);

    const r = await svc.requestThemeDeploy(8, owner);

    expect(r.ok).toBe(true);
    expect(queue.enqueue).toHaveBeenCalledWith({ siteId: 8, op: 'deploy-theme' });
  });

  it('404s for an unknown site', async () => {
    const svc = new DeployService(
      buildSites({ findById: vi.fn().mockResolvedValue(null) }),
      buildQueue(),
    );
    const r = await svc.requestThemeDeploy(99, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.site_not_found');
  });

  it('forbids a non-owner non-admin', async () => {
    const queue = buildQueue();
    const svc = new DeployService(
      buildSites({ findById: vi.fn().mockResolvedValue({ id: 8, ownerId: 99 }) }),
      queue,
    );
    const r = await svc.requestThemeDeploy(8, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.forbidden');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('lets an admin deploy any site', async () => {
    const svc = new DeployService(
      buildSites({ findById: vi.fn().mockResolvedValue({ id: 8, ownerId: 99 }) }),
      buildQueue(),
    );
    const r = await svc.requestThemeDeploy(8, { id: 1, role: 'admin' });
    expect(r.ok).toBe(true);
  });
});
