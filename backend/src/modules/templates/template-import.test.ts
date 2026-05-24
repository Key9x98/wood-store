import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Template, Prisma } from '@prisma/client';
import { TemplateImportService } from './template-import.service';
import type {
  ITemplateRepository,
  TemplateCreateData,
  TemplateUpdateData,
  ListOpts,
} from './templates.repository';

/**
 * Integration test — real fs + real git with a local bare repo as the remote
 * (so `git push` works without credentials). Verifies the import flow:
 * unzip → place theme into codebase/wp-content/themes/<slug> → commit + push.
 */

const exec = promisify(execFile);

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

const tmpRoot = path.join(os.tmpdir(), `cms-test-import-${Date.now()}-${process.pid}`);
const stagingDir = path.join(tmpRoot, 'staging');
const remoteDir = path.join(tmpRoot, 'remote.git');
const codebaseDir = path.join(tmpRoot, 'codebase');
const GIT_BRANCH = 'main';

const fileExists = (p: string) => fs.access(p).then(() => true, () => false);

/** Build a .zip containing a WordPress theme folder (`the-theme/`). */
async function makeThemeZip(zipPath: string, version = '2.3.0', withStyle = true): Promise<void> {
  const src = await fs.mkdtemp(path.join(tmpRoot, 'tsrc-'));
  await fs.mkdir(path.join(src, 'the-theme'));
  if (withStyle) {
    await fs.writeFile(
      path.join(src, 'the-theme', 'style.css'),
      `/*\nTheme Name: Imported Theme\nVersion: ${version}\n*/\nbody{}\n`,
    );
  }
  await fs.writeFile(path.join(src, 'the-theme', 'index.php'), '<?php // theme');
  await fs.rm(zipPath, { force: true });
  await exec('zip', ['-r', '-q', zipPath, 'the-theme'], { cwd: src });
  await fs.rm(src, { recursive: true, force: true });
}

function makeService(repo: InMemoryRepo): TemplateImportService {
  return new TemplateImportService(repo, {
    stagingDir,
    codebaseDir,
    gitUrl: remoteDir,
    gitBranch: GIT_BRANCH,
  });
}

beforeAll(async () => {
  await fs.mkdir(stagingDir, { recursive: true });
  await exec('git', ['init', '--bare', remoteDir]);
  await exec('git', ['clone', remoteDir, codebaseDir]); // codebase = empty clone
});
afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('TemplateImportService (real fs + git)', () => {
  it('imports a theme zip into the codebase and pushes it to the remote', async () => {
    const repo = new InMemoryRepo();
    const row = await repo.create({
      slug: 'furniture-x',
      name: 'furniture-x',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });
    const zip = path.join(tmpRoot, 'up1.zip');
    await makeThemeZip(zip);

    const r = await makeService(repo).run({
      templateId: row.id,
      slug: 'furniture-x',
      zipPath: zip,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('ready');
      expect(r.value.name).toBe('Imported Theme'); // from style.css header
      expect(r.value.version).toBe('2.3.0');
      expect(r.value.localPath).toBe(path.join(codebaseDir, 'wp-content/themes/furniture-x'));
    }
    // theme landed in the codebase working tree
    expect(
      await fileExists(path.join(codebaseDir, 'wp-content/themes/furniture-x/style.css')),
    ).toBe(true);
    // commit reached the remote on the configured branch
    const log = await exec('git', ['--git-dir', remoteDir, 'log', '--oneline', GIT_BRANCH]);
    expect(log.stdout).toContain('furniture-x');
    // uploaded zip cleaned up
    expect(await fileExists(zip)).toBe(false);
  });

  it('fails with theme_invalid when the zip has no style.css', async () => {
    const repo = new InMemoryRepo();
    const row = await repo.create({
      slug: 'bad-theme',
      name: 'bad-theme',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });
    const zip = path.join(tmpRoot, 'up2.zip');
    await makeThemeZip(zip, '1.0.0', false); // no style.css

    const r = await makeService(repo).run({
      templateId: row.id,
      slug: 'bad-theme',
      zipPath: zip,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('theme_invalid');
    expect(repo.rows[0]?.status).toBe('failed');
  });

  it('re-importing the same slug updates the theme (idempotent)', async () => {
    const repo = new InMemoryRepo();
    const row = await repo.create({
      slug: 'furniture-z',
      name: 'furniture-z',
      version: '0.0.0',
      manifest: {},
      localPath: '',
      status: 'building',
    });

    const z1 = path.join(tmpRoot, 'z1.zip');
    await makeThemeZip(z1, '1.0.0');
    const r1 = await makeService(repo).run({ templateId: row.id, slug: 'furniture-z', zipPath: z1 });
    expect(r1.ok).toBe(true);

    await repo.update(row.id, { status: 'building' }); // what startImport does on retry
    const z2 = path.join(tmpRoot, 'z2.zip');
    await makeThemeZip(z2, '4.5.0');
    const r2 = await makeService(repo).run({ templateId: row.id, slug: 'furniture-z', zipPath: z2 });

    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.status).toBe('ready');
      expect(r2.value.version).toBe('4.5.0'); // updated
    }
    expect(repo.rows.length).toBe(1);
  });
});
