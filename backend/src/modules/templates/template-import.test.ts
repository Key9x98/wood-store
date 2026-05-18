import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Template, Prisma } from '@prisma/client';
import { TemplateImportService } from './template-import.service';
import type { ITemplateRepository, TemplateCreateData, TemplateUpdateData, ListOpts } from './templates.repository';

/**
 * Integration-ish test:
 *   - Real filesystem (in os.tmpdir())
 *   - Real Ajv manifest validation
 *   - Real fs.cp / fs.rename
 *   - In-memory repository (so we don't need MySQL)
 *
 * Verifies the full TemplateImportService.run flow as the worker would invoke it.
 */

class InMemoryRepo implements ITemplateRepository {
  rows: Template[] = [];
  private nextId = 1;

  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findBySlug(slug: string) {
    return this.rows.find((r) => r.slug === slug) ?? null;
  }
  async create(data: TemplateCreateData) {
    const row: Template = {
      id: this.nextId++,
      slug: data.slug,
      name: data.name,
      version: data.version,
      manifest: data.manifest as Prisma.JsonValue,
      localPath: data.localPath,
      status: data.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(id: number, patch: TemplateUpdateData) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`not_found: ${id}`);
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.version !== undefined) row.version = patch.version;
    if (patch.manifest !== undefined) row.manifest = patch.manifest as Prisma.JsonValue;
    if (patch.localPath !== undefined) row.localPath = patch.localPath;
    if (patch.status !== undefined) row.status = patch.status;
    row.updatedAt = new Date();
    return row;
  }
  async delete(id: number) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error(`not_found: ${id}`);
    const removed = this.rows[idx]!;
    this.rows.splice(idx, 1);
    return removed;
  }
  async list(opts: ListOpts) {
    return this.rows
      .filter((r) => !opts.status || r.status === opts.status)
      .slice(opts.offset, opts.offset + opts.limit);
  }
  async count(opts: Pick<ListOpts, 'status'>) {
    return this.rows.filter((r) => !opts.status || r.status === opts.status).length;
  }
}

const testRoot = path.join(os.tmpdir(), `cms-test-templates-${Date.now()}-${process.pid}`);
const fakeSourceDir = path.join(testRoot, 'fake-template-src');
const stagingDir = path.join(testRoot, 'staging');
const templatesDir = path.join(testRoot, 'templates');

const writeValidFake = async (slug = 'fake-template') => {
  await fs.mkdir(fakeSourceDir, { recursive: true });
  await fs.writeFile(
    path.join(fakeSourceDir, 'template.json'),
    JSON.stringify({
      slug,
      name: 'Fake Template',
      version: '0.1.0',
      theme: { slug: 'fake-theme', path: 'theme/' },
      fields: [{ key: 'shop_name', label: 'Tên xưởng', type: 'string', required: true }],
    }),
  );
  await fs.mkdir(path.join(fakeSourceDir, 'theme'), { recursive: true });
  await fs.writeFile(path.join(fakeSourceDir, 'theme', 'index.php'), '<?php // fake');
  await fs.writeFile(path.join(fakeSourceDir, 'preview.png'), 'PNG-bytes-stub');
};

const cleanFakeSrc = async () => {
  await fs.rm(fakeSourceDir, { recursive: true, force: true });
};

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});

afterAll(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('TemplateImportService (integration, real fs)', () => {
  it('imports a local fake template and marks status=ready', async () => {
    await writeValidFake('fake-template');
    const repo = new InMemoryRepo();
    const svc = new TemplateImportService(repo, { templatesDir, stagingDir });

    // simulate what TemplateService.startImport does first
    const row = await repo.create({
      slug: 'fake-template',
      name: 'fake-template',
      version: '0.0.0',
      manifest: { __placeholder: true },
      localPath: '',
      status: 'building',
    });

    const r = await svc.run({
      templateId: row.id,
      slug: 'fake-template',
      source: { type: 'local', path: fakeSourceDir },
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('ready');
      expect(r.value.name).toBe('Fake Template');
      expect(r.value.version).toBe('0.1.0');
      expect(r.value.localPath).toBe(path.join(templatesDir, 'fake-template'));
    }

    // DB side: only 1 row, status=ready
    expect(repo.rows.length).toBe(1);
    expect(repo.rows[0]?.status).toBe('ready');
    expect(repo.rows[0]?.slug).toBe('fake-template');

    // Filesystem side: final dir has template.json
    const finalManifest = path.join(templatesDir, 'fake-template', 'template.json');
    const exists = await fs.access(finalManifest).then(() => true, () => false);
    expect(exists).toBe(true);

    await cleanFakeSrc();
    await fs.rm(path.join(templatesDir, 'fake-template'), { recursive: true, force: true });
  });

  it('is idempotent — re-running overwrites final dir, status stays ready', async () => {
    await writeValidFake('fake-template-2');
    const repo = new InMemoryRepo();
    const svc = new TemplateImportService(repo, { templatesDir, stagingDir });
    const row = await repo.create({
      slug: 'fake-template-2',
      name: 'placeholder',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });

    const r1 = await svc.run({
      templateId: row.id,
      slug: 'fake-template-2',
      source: { type: 'local', path: fakeSourceDir },
    });
    expect(r1.ok).toBe(true);

    // simulate retry — set status back to building (what service.startImport does)
    await repo.update(row.id, { status: 'building' });

    const r2 = await svc.run({
      templateId: row.id,
      slug: 'fake-template-2',
      source: { type: 'local', path: fakeSourceDir },
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.status).toBe('ready');

    expect(repo.rows.length).toBe(1);
    await cleanFakeSrc();
    await fs.rm(path.join(templatesDir, 'fake-template-2'), { recursive: true, force: true });
  });

  it('marks failed when manifest is missing', async () => {
    await fs.mkdir(fakeSourceDir, { recursive: true });
    await fs.writeFile(path.join(fakeSourceDir, 'theme.txt'), 'no manifest here');
    const repo = new InMemoryRepo();
    const svc = new TemplateImportService(repo, { templatesDir, stagingDir });
    const row = await repo.create({
      slug: 'bad1',
      name: 'placeholder',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });

    const r = await svc.run({
      templateId: row.id,
      slug: 'bad1',
      source: { type: 'local', path: fakeSourceDir },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('manifest_missing');
    expect(repo.rows[0]?.status).toBe('failed');
    await cleanFakeSrc();
  });

  it('marks failed when manifest schema invalid', async () => {
    await fs.mkdir(fakeSourceDir, { recursive: true });
    await fs.writeFile(
      path.join(fakeSourceDir, 'template.json'),
      JSON.stringify({ slug: 'ok', name: 'X' }), // missing version
    );
    const repo = new InMemoryRepo();
    const svc = new TemplateImportService(repo, { templatesDir, stagingDir });
    const row = await repo.create({
      slug: 'bad2',
      name: 'placeholder',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });

    const r = await svc.run({
      templateId: row.id,
      slug: 'bad2',
      source: { type: 'local', path: fakeSourceDir },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('manifest_invalid_schema');
    expect(repo.rows[0]?.status).toBe('failed');
    await cleanFakeSrc();
  });

  it('marks failed when payload slug ≠ manifest slug', async () => {
    await writeValidFake('manifest-says-foo');
    const repo = new InMemoryRepo();
    const svc = new TemplateImportService(repo, { templatesDir, stagingDir });
    const row = await repo.create({
      slug: 'bar-from-payload',
      name: 'placeholder',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });

    const r = await svc.run({
      templateId: row.id,
      slug: 'bar-from-payload',
      source: { type: 'local', path: fakeSourceDir },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('slug_mismatch');
    expect(repo.rows[0]?.status).toBe('failed');
    await cleanFakeSrc();
  });
});
