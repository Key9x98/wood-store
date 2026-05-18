import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Template, Prisma } from '@prisma/client';
import { TemplateImportService } from './template-import.service';
import { validateManifest } from './template-manifest';
import type {
  ITemplateRepository,
  TemplateCreateData,
  TemplateUpdateData,
  ListOpts,
} from './templates.repository';

/**
 * Integration test for the real furniture template at
 * `templates/furniture/`. Verifies:
 *   - manifest validates against the Ajv schema
 *   - import flow copies it to TEMPLATES_DIR and marks status=ready
 *   - db_dump.sql is present in the final location
 *
 * Uses an in-memory repository and an isolated tmp dir; no MySQL needed.
 */

class InMemoryRepo implements ITemplateRepository {
  rows: Template[] = [];
  private nextId = 1;
  async findById(id: number) { return this.rows.find((r) => r.id === id) ?? null; }
  async findBySlug(slug: string) { return this.rows.find((r) => r.slug === slug) ?? null; }
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
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error(`not_found ${id}`);
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.version !== undefined) r.version = patch.version;
    if (patch.manifest !== undefined) r.manifest = patch.manifest as Prisma.JsonValue;
    if (patch.localPath !== undefined) r.localPath = patch.localPath;
    if (patch.status !== undefined) r.status = patch.status;
    r.updatedAt = new Date();
    return r;
  }
  async delete(id: number) {
    const i = this.rows.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('nf');
    const removed = this.rows[i]!;
    this.rows.splice(i, 1);
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

const TEMPLATE_SOURCE = path.resolve(__dirname, '../../../../templates/furniture');
const tmpRoot = path.join(os.tmpdir(), `cms-test-furniture-${Date.now()}-${process.pid}`);
const stagingDir = path.join(tmpRoot, 'staging');
const templatesDir = path.join(tmpRoot, 'templates');

beforeAll(async () => {
  await fs.mkdir(tmpRoot, { recursive: true });
});
afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('Furniture template — source artefacts', () => {
  it('template.json exists and validates against Ajv schema', async () => {
    const raw = await fs.readFile(path.join(TEMPLATE_SOURCE, 'template.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const r = validateManifest(parsed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.slug).toBe('furniture');
      expect(r.value.name).toBe('Xưởng đồ gỗ');
      expect(r.value.version).toBe('1.0.0');
      expect(r.value.fields).toBeDefined();
      expect((r.value.fields ?? []).length).toBe(10);
      expect((r.value.fields ?? []).map((f) => f.key)).toEqual(
        expect.arrayContaining([
          'shop_name',
          'phone',
          'address',
          'primary_color',
          'logo',
          'hero_image',
        ]),
      );
      expect(r.value.theme?.slug).toBe('ai-builder-furniture');
    }
  });

  it('artefact files exist (theme/, db_dump.sql, preview.png)', async () => {
    for (const rel of ['theme/ai-builder-furniture/style.css', 'theme/ai-builder-furniture/functions.php', 'db_dump.sql', 'preview.png']) {
      const p = path.join(TEMPLATE_SOURCE, rel);
      const exists = await fs.access(p).then(() => true, () => false);
      expect(exists, `missing ${rel}`).toBe(true);
    }
  });

  it('db_dump.sql uses {{SITE_URL}} placeholder (no hardcoded URLs)', async () => {
    const sql = await fs.readFile(path.join(TEMPLATE_SOURCE, 'db_dump.sql'), 'utf8');
    expect(sql).toContain('{{SITE_URL}}');
    // Heuristic: no `http://` or `https://` URLs except in comments / placeholder lines.
    const nonCommentLines = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'));
    const hardcodedUrl = nonCommentLines.find((l) => /https?:\/\/(?!\{)/i.test(l));
    expect(hardcodedUrl ?? '').toBe('');
  });
});

describe('Furniture template — import via TemplateImportService', () => {
  it('imports the real furniture/ folder, status=ready', async () => {
    const repo = new InMemoryRepo();
    const svc = new TemplateImportService(repo, { templatesDir, stagingDir });

    const row = await repo.create({
      slug: 'furniture',
      name: 'placeholder',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });

    const r = await svc.run({
      templateId: row.id,
      slug: 'furniture',
      source: { type: 'local', path: TEMPLATE_SOURCE },
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('ready');
      expect(r.value.name).toBe('Xưởng đồ gỗ');
      expect(r.value.version).toBe('1.0.0');
      expect(r.value.localPath).toBe(path.join(templatesDir, 'furniture'));
    }

    // Final dir has the manifest + db_dump + theme
    const finalDir = path.join(templatesDir, 'furniture');
    for (const rel of ['template.json', 'db_dump.sql', 'theme/ai-builder-furniture/style.css']) {
      expect(
        await fs.access(path.join(finalDir, rel)).then(() => true, () => false),
        `missing in final: ${rel}`,
      ).toBe(true);
    }
  });
});
