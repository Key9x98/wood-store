import { describe, it, expect, vi } from 'vitest';
import type { Template } from '@prisma/client';
import { TemplateService } from './templates.service';
import type { ITemplateRepository } from './templates.repository';
import type { ITemplateImportQueue } from '../../queues/template-import.queue';
import { ImportTemplateSchema, TemplateSlugSchema } from './templates.schema';
import { validateManifest } from './template-manifest';

const fakeTpl = (over: Partial<Template> = {}): Template => ({
  id: 1,
  slug: 'restaurant',
  name: 'Restaurant',
  version: '1.0.0',
  manifest: {},
  localPath: '/var/lib/cms/templates/restaurant',
  status: 'ready',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const buildRepo = (over: Partial<ITemplateRepository> = {}): ITemplateRepository => ({
  findById: vi.fn(),
  findBySlug: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  ...over,
});

const buildQueue = (): ITemplateImportQueue => ({
  enqueue: vi.fn().mockResolvedValue({ jobId: 'tpl-import:fake' }),
});

describe('Slug schema', () => {
  it.each(['restaurant', 'a-b', 'a1', 'agency-pro-v2'])('accepts %s', (s) => {
    expect(TemplateSlugSchema.safeParse(s).success).toBe(true);
  });
  // 'ab--' is accepted by the docs-mandated regex (^[a-z][a-z0-9-]*$).
  // If we want to forbid trailing dash, tighten regex in schema + test.
  it.each(['-abc', '1abc', 'A', 'a_b', '', 'a'])('rejects %s', (s) => {
    expect(TemplateSlugSchema.safeParse(s).success).toBe(false);
  });
});

describe('Manifest validator', () => {
  it('accepts minimal valid manifest', () => {
    const r = validateManifest({ slug: 'restaurant', name: 'Restaurant', version: '1.0.0' });
    expect(r.ok).toBe(true);
  });

  it('rejects missing required field', () => {
    const r = validateManifest({ slug: 'restaurant', name: 'Restaurant' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.some((e) => e.includes('version'))).toBe(true);
  });

  it('rejects bad slug pattern', () => {
    const r = validateManifest({ slug: '-bad', name: 'X', version: '1.0.0' });
    expect(r.ok).toBe(false);
  });

  it('rejects bad version', () => {
    const r = validateManifest({ slug: 'ok', name: 'X', version: 'not-semver' });
    expect(r.ok).toBe(false);
  });

  it('rejects fields[].key bad pattern', () => {
    const r = validateManifest({
      slug: 'ok',
      name: 'X',
      version: '1.0.0',
      fields: [{ key: 'Bad Key', label: 'l', type: 'string' }],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts rich manifest with fields and theme', () => {
    const r = validateManifest({
      slug: 'agency',
      name: 'Agency',
      version: '2.1.0-rc.1',
      theme: { slug: 'agency-theme', path: 'theme/' },
      fields: [
        { key: 'business_name', label: 'Name', type: 'string', required: true },
        { key: 'primary_color', label: 'Color', type: 'color', default: '#000' },
      ],
    });
    expect(r.ok).toBe(true);
  });
});

describe('ImportTemplateSchema', () => {
  it('parses local source', () => {
    const r = ImportTemplateSchema.safeParse({
      slug: 'restaurant',
      source: { type: 'local', path: '/tmp/x' },
    });
    expect(r.success).toBe(true);
  });

  it('parses git source with default ref', () => {
    const r = ImportTemplateSchema.safeParse({
      slug: 'restaurant',
      source: { type: 'git', repo: 'git@github.com:org/repo.git' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toMatchObject({ ref: 'main' });
  });

  it('rejects unknown source type', () => {
    const r = ImportTemplateSchema.safeParse({
      slug: 'restaurant',
      source: { type: 'ftp', path: '/x' },
    });
    expect(r.success).toBe(false);
  });
});

describe('TemplateService.startImport', () => {
  it('creates row + enqueues for new slug', async () => {
    const created = fakeTpl({ status: 'building' });
    const repo = buildRepo({
      findBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    });
    const q = buildQueue();
    const svc = new TemplateService(repo, q);

    const r = await svc.startImport({
      slug: 'restaurant',
      source: { type: 'local', path: '/tmp/x' },
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.templateId).toBe(created.id);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(q.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: created.id, slug: 'restaurant' }),
    );
  });

  it('rejects re-import of ready slug with already_exists', async () => {
    const repo = buildRepo({ findBySlug: vi.fn().mockResolvedValue(fakeTpl({ status: 'ready' })) });
    const q = buildQueue();
    const svc = new TemplateService(repo, q);
    const r = await svc.startImport({
      slug: 'restaurant',
      source: { type: 'local', path: '/tmp/x' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('templates.already_exists');
    expect(q.enqueue).not.toHaveBeenCalled();
  });

  it('re-runs for failed slug (updates status to building)', async () => {
    const existing = fakeTpl({ status: 'failed' });
    const repo = buildRepo({
      findBySlug: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({ ...existing, status: 'building' }),
    });
    const q = buildQueue();
    const svc = new TemplateService(repo, q);
    const r = await svc.startImport({
      slug: 'restaurant',
      source: { type: 'local', path: '/tmp/x' },
    });
    expect(r.ok).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(existing.id, { status: 'building' });
    expect(q.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('TemplateService.list', () => {
  it('non-admin always sees only ready', async () => {
    const repo = buildRepo();
    const svc = new TemplateService(repo, buildQueue());
    await svc.list({ limit: 20, offset: 0, status: 'failed' }, 'user');
    expect(repo.list).toHaveBeenCalledWith({ limit: 20, offset: 0, status: 'ready' });
  });
  it('admin can filter by status', async () => {
    const repo = buildRepo();
    const svc = new TemplateService(repo, buildQueue());
    await svc.list({ limit: 20, offset: 0, status: 'failed' }, 'admin');
    expect(repo.list).toHaveBeenCalledWith({ limit: 20, offset: 0, status: 'failed' });
  });
});
