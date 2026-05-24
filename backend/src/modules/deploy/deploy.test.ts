import { describe, it, expect, vi } from 'vitest';
import { DeployService } from './deploy.service';
import type { DeploySiteLookup, DeployTemplateLookup, Viewer } from './deploy.service';
import type { IDeployQueue } from '../../queues/deploy.queue';

const buildSites = (over: Partial<DeploySiteLookup> = {}): DeploySiteLookup => ({
  findById: vi.fn().mockResolvedValue({ id: 8, ownerId: 1 }),
  ...over,
});

const buildTemplates = (over: Partial<DeployTemplateLookup> = {}): DeployTemplateLookup => ({
  findById: vi.fn().mockResolvedValue({ id: 3, status: 'ready' }),
  ...over,
});

const buildQueue = (): IDeployQueue => ({
  enqueue: vi.fn().mockResolvedValue({ jobId: 'deploy-1' }),
});

const owner: Viewer = { id: 1, role: 'user' };

describe('DeployService.requestThemeDeploy', () => {
  it('enqueues a deploy-theme job for an owned site', async () => {
    const queue = buildQueue();
    const svc = new DeployService(buildSites(), buildTemplates(), queue);
    const r = await svc.requestThemeDeploy(8, owner);
    expect(r.ok).toBe(true);
    expect(queue.enqueue).toHaveBeenCalledWith({ siteId: 8, op: 'deploy-theme' });
  });

  it('404s for an unknown site', async () => {
    const svc = new DeployService(
      buildSites({ findById: vi.fn().mockResolvedValue(null) }),
      buildTemplates(),
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
      buildTemplates(),
      queue,
    );
    const r = await svc.requestThemeDeploy(8, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.forbidden');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('DeployService.requestSwitchTemplate', () => {
  it('enqueues a switch-template job with the target template', async () => {
    const queue = buildQueue();
    const svc = new DeployService(buildSites(), buildTemplates(), queue);
    const r = await svc.requestSwitchTemplate(8, 3, owner);
    expect(r.ok).toBe(true);
    expect(queue.enqueue).toHaveBeenCalledWith({ siteId: 8, op: 'switch-template', templateId: 3 });
  });

  it('404s for an unknown target template', async () => {
    const svc = new DeployService(
      buildSites(),
      buildTemplates({ findById: vi.fn().mockResolvedValue(null) }),
      buildQueue(),
    );
    const r = await svc.requestSwitchTemplate(8, 99, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.template_not_found');
  });

  it('rejects a target template that is not ready', async () => {
    const queue = buildQueue();
    const svc = new DeployService(
      buildSites(),
      buildTemplates({ findById: vi.fn().mockResolvedValue({ id: 3, status: 'building' }) }),
      queue,
    );
    const r = await svc.requestSwitchTemplate(8, 3, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.template_not_ready');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('forbids a non-owner non-admin', async () => {
    const svc = new DeployService(
      buildSites({ findById: vi.fn().mockResolvedValue({ id: 8, ownerId: 99 }) }),
      buildTemplates(),
      buildQueue(),
    );
    const r = await svc.requestSwitchTemplate(8, 3, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.forbidden');
  });
});
