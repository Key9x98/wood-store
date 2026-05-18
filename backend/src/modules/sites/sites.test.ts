import { describe, it, expect, vi } from 'vitest';
import type { Site } from '@prisma/client';
import { SiteService } from './sites.service';
import type { ISiteRepository, ITemplateLookup } from './sites.repository';
import type { IProvisionQueue } from '../../queues/provision.queue';
import { CreateSiteSchema } from './sites.schema';

const fakeSite = (over: Partial<Site> = {}): Site => ({
  id: 1,
  domain: 'abc.com',
  status: 'queued',
  templateId: 1,
  ownerId: 1,
  dbName: null,
  dbUser: null,
  dbPasswordEnc: null,
  pluginSecretEnc: null,
  provisionState: {},
  provisionedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const buildRepo = (over: Partial<ISiteRepository> = {}): ISiteRepository => ({
  findById: vi.fn(),
  findByDomain: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  updateStatus: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  ...over,
});

const buildTemplates = (over: Partial<ITemplateLookup> = {}): ITemplateLookup => ({
  findById: vi.fn().mockResolvedValue({ id: 1, status: 'ready' }),
  ...over,
});

const buildQueue = (): IProvisionQueue => ({
  enqueue: vi.fn().mockResolvedValue({ jobId: 'site:1' }),
});

describe('Domain validation (CreateSiteSchema)', () => {
  it.each([
    'abc.com',
    'hello.example.io',
    'a.b.co',
    'sub.domain-with-dash.com',
  ])('accepts %s', (d) => {
    const r = CreateSiteSchema.safeParse({ domain: d, templateId: 1 });
    expect(r.success).toBe(true);
  });

  it.each([
    'abc.com; rm -rf /',
    '-abc.com',
    'abc-.com',
    'abc..com',
    'abc',
    'abc.c',           // single-char TLD
    'http://abc.com',
    'abc.com/',
    '192.168.1.1',     // IP-like; refine rejects all-numeric TLD
    'localhost',
    '',
  ])('rejects %s', (d) => {
    const r = CreateSiteSchema.safeParse({ domain: d, templateId: 1 });
    expect(r.success).toBe(false);
  });

  it('lowercases domain', () => {
    const r = CreateSiteSchema.safeParse({ domain: 'ABC.COM', templateId: 1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.domain).toBe('abc.com');
  });
});

describe('SiteService.create', () => {
  it('creates queued site and enqueues provision job', async () => {
    const created = fakeSite();
    const repo = buildRepo({ create: vi.fn().mockResolvedValue(created) });
    const tpl = buildTemplates();
    const q = buildQueue();
    const svc = new SiteService(repo, tpl, q);

    const r = await svc.create({ domain: 'abc.com', templateId: 1 }, 1);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('queued');
      expect(r.value.domain).toBe('abc.com');
    }
    expect(repo.create).toHaveBeenCalledWith({
      domain: 'abc.com',
      templateId: 1,
      ownerId: 1,
      status: 'queued',
    });
    expect(q.enqueue).toHaveBeenCalledTimes(1);
    expect(q.enqueue).toHaveBeenCalledWith({ siteId: created.id });
  });

  it('rejects duplicate domain with domain_taken', async () => {
    const repo = buildRepo({ findByDomain: vi.fn().mockResolvedValue(fakeSite()) });
    const q = buildQueue();
    const svc = new SiteService(repo, buildTemplates(), q);

    const r = await svc.create({ domain: 'abc.com', templateId: 1 }, 1);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('sites.domain_taken');
    expect(repo.create).not.toHaveBeenCalled();
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it('rejects unknown template with template_not_found', async () => {
    const tpl = buildTemplates({ findById: vi.fn().mockResolvedValue(null) });
    const q = buildQueue();
    const svc = new SiteService(buildRepo(), tpl, q);

    const r = await svc.create({ domain: 'abc.com', templateId: 99 }, 1);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('sites.template_not_found');
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it('rejects non-ready template with template_not_ready', async () => {
    const tpl = buildTemplates({
      findById: vi.fn().mockResolvedValue({ id: 1, status: 'building' }),
    });
    const q = buildQueue();
    const svc = new SiteService(buildRepo(), tpl, q);

    const r = await svc.create({ domain: 'abc.com', templateId: 1 }, 1);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('sites.template_not_ready');
    expect(q.enqueue).not.toHaveBeenCalled();
  });
});

describe('SiteService.findById', () => {
  it('owner can read own site', async () => {
    const s = fakeSite({ ownerId: 5 });
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(s) });
    const svc = new SiteService(repo, buildTemplates(), buildQueue());
    const r = await svc.findById(1, { id: 5, role: 'user' });
    expect(r.ok).toBe(true);
  });

  it('non-owner non-admin gets forbidden', async () => {
    const s = fakeSite({ ownerId: 5 });
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(s) });
    const svc = new SiteService(repo, buildTemplates(), buildQueue());
    const r = await svc.findById(1, { id: 99, role: 'user' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('sites.forbidden');
  });

  it('admin can read any site', async () => {
    const s = fakeSite({ ownerId: 5 });
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(s) });
    const svc = new SiteService(repo, buildTemplates(), buildQueue());
    const r = await svc.findById(1, { id: 99, role: 'admin' });
    expect(r.ok).toBe(true);
  });
});
