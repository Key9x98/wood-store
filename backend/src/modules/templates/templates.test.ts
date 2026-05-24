import { describe, it, expect, vi, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Template } from '@prisma/client';
import { TemplateService } from './templates.service';
import type { ITemplateRepository } from './templates.repository';
import type { ITemplateImportQueue } from '../../queues/template-import.queue';
import { ImportTemplateSchema, TemplateSlugSchema } from './templates.schema';
import { validateManifest } from './template-manifest';

const stagingDir = path.join(os.tmpdir(), `cms-test-tpl-svc-${Date.now()}-${process.pid}`);
afterAll(async () => {
  await fs.rm(stagingDir, { recursive: true, force: true });
});

const ZIP_B64 = Buffer.from('PK fake zip bytes').toString('base64');

const fakeTpl = (over: Partial<Template> = {}): Template => ({
  id: 1,
  slug: 'restaurant',
  name: 'Restaurant',
  version: '1.0.0',
  manifest: {},
  localPath: '/var/www/html/codebase/wp-content/themes/restaurant',
  status: 'ready',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const buildRepo = (over: Partial<ITemplateRepository> = {}): ITemplateRepository => ({
  findById: vi.fn(),
  findBySlug: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue(fakeTpl({ status: 'building' })),
  update: vi.fn().mockResolvedValue(fakeTpl({ status: 'building' })),
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
  it.each(['-abc', '1abc', 'A', 'a_b', '', 'a'])('rejects %s', (s) => {
    expect(TemplateSlugSchema.safeParse(s).success).toBe(false);
  });
});

describe('Manifest validator', () => {
  it('accepts minimal valid manifest', () => {
    expect(validateManifest({ slug: 'restaurant', name: 'Restaurant', version: '1.0.0' }).ok).toBe(true);
  });
  it('rejects missing required field', () => {
    const r = validateManifest({ slug: 'restaurant', name: 'Restaurant' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.some((e) => e.includes('version'))).toBe(true);
  });
  it('rejects bad version', () => {
    expect(validateManifest({ slug: 'ok', name: 'X', version: 'not-semver' }).ok).toBe(false);
  });
});

describe('ImportTemplateSchema', () => {
  it('accepts slug + base64 zip', () => {
    expect(ImportTemplateSchema.safeParse({ slug: 'restaurant', zipBase64: ZIP_B64 }).success).toBe(true);
  });
  it('rejects a missing zip', () => {
    expect(ImportTemplateSchema.safeParse({ slug: 'restaurant' }).success).toBe(false);
  });
  it('rejects an empty zip string', () => {
    expect(ImportTemplateSchema.safeParse({ slug: 'restaurant', zipBase64: '' }).success).toBe(false);
  });
  it('rejects an invalid slug', () => {
    expect(ImportTemplateSchema.safeParse({ slug: '-bad', zipBase64: ZIP_B64 }).success).toBe(false);
  });
});

describe('TemplateService.startImport', () => {
  it('creates a row, writes the zip and enqueues for a new slug', async () => {
    const created = fakeTpl({ status: 'building' });
    const repo = buildRepo({
      findBySlug: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    });
    const q = buildQueue();
    const svc = new TemplateService(repo, q, stagingDir);

    const r = await svc.startImport({ slug: 'restaurant', zipBase64: ZIP_B64 });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.templateId).toBe(created.id);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(q.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: created.id, slug: 'restaurant', zipPath: expect.any(String) }),
    );
  });

  it('re-import of an existing slug updates it (status→building) and re-enqueues', async () => {
    const existing = fakeTpl({ status: 'ready' });
    const repo = buildRepo({
      findBySlug: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({ ...existing, status: 'building' }),
    });
    const q = buildQueue();
    const svc = new TemplateService(repo, q, stagingDir);

    const r = await svc.startImport({ slug: 'restaurant', zipBase64: ZIP_B64 });

    expect(r.ok).toBe(true);
    expect(repo.update).toHaveBeenCalledWith(existing.id, { status: 'building' });
    expect(repo.create).not.toHaveBeenCalled();
    expect(q.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty (zero-byte) zip', async () => {
    const svc = new TemplateService(buildRepo(), buildQueue(), stagingDir);
    const r = await svc.startImport({ slug: 'restaurant', zipBase64: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('templates.invalid_zip');
  });
});

describe('TemplateService.list', () => {
  it('non-admin always sees only ready', async () => {
    const repo = buildRepo();
    await new TemplateService(repo, buildQueue(), stagingDir).list(
      { limit: 20, offset: 0, status: 'failed' },
      'user',
    );
    expect(repo.list).toHaveBeenCalledWith({ limit: 20, offset: 0, status: 'ready' });
  });
  it('admin can filter by status', async () => {
    const repo = buildRepo();
    await new TemplateService(repo, buildQueue(), stagingDir).list(
      { limit: 20, offset: 0, status: 'failed' },
      'admin',
    );
    expect(repo.list).toHaveBeenCalledWith({ limit: 20, offset: 0, status: 'failed' });
  });
});
