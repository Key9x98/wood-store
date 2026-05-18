import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Template, Prisma } from '@prisma/client';
import { ok, err, type Result } from '../../lib/result';
import { run } from '../../lib/shell';
import type { TemplateImportJobPayload } from '../../queues/template-import.queue';
import type { ITemplateRepository } from './templates.repository';
import { validateManifest, type TemplateManifest } from './template-manifest';

export interface ImportOpts {
  templatesDir: string;
  stagingDir: string;
}

export interface ImportError {
  code:
    | 'manifest_missing'
    | 'manifest_invalid_json'
    | 'manifest_invalid_schema'
    | 'slug_mismatch'
    | 'materialize_failed'
    | 'move_failed';
  details?: string[];
}

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

export class TemplateImportService {
  constructor(
    private repo: ITemplateRepository,
    private opts: ImportOpts,
  ) {}

  async run(payload: TemplateImportJobPayload): Promise<Result<Template, ImportError>> {
    const existing = await this.repo.findById(payload.templateId);
    if (existing && existing.status !== 'building') {
      // Caller (service) should have set status='building' before enqueue. If not, set it now.
      await this.repo.update(payload.templateId, { status: 'building' });
    }

    let stagingPath: string | null = null;
    try {
      stagingPath = await this.materialize(payload);
      const manifest = await this.loadAndValidateManifest(stagingPath);
      if (manifest.slug !== payload.slug) {
        throw { code: 'slug_mismatch', details: [`payload=${payload.slug}`, `manifest=${manifest.slug}`] } satisfies ImportError;
      }

      const finalPath = path.join(this.opts.templatesDir, payload.slug);
      await this.moveToFinal(stagingPath, finalPath);
      stagingPath = null;

      const updated = await this.repo.update(payload.templateId, {
        name: manifest.name,
        version: manifest.version,
        manifest: manifest as unknown as Prisma.InputJsonValue,
        localPath: finalPath,
        status: 'ready',
      });
      return ok(updated);
    } catch (e) {
      await this.repo.update(payload.templateId, { status: 'failed' }).catch(() => undefined);
      if (stagingPath) {
        await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (isImportError(e)) return err(e);
      return err({ code: 'materialize_failed', details: [String(e instanceof Error ? e.message : e)] });
    }
  }

  private async materialize(payload: TemplateImportJobPayload): Promise<string> {
    await fs.mkdir(this.opts.stagingDir, { recursive: true });
    const stagingPath = path.join(
      this.opts.stagingDir,
      `${payload.slug}-${Date.now()}-${randomBytes(4).toString('hex')}`,
    );

    switch (payload.source.type) {
      case 'local': {
        const srcStat = await fs.stat(payload.source.path).catch(() => null);
        if (!srcStat || !srcStat.isDirectory()) {
          throw new Error(`local source not a directory: ${payload.source.path}`);
        }
        await fs.cp(payload.source.path, stagingPath, { recursive: true, force: true });
        break;
      }
      case 'git': {
        await run('git', [
          'clone',
          '--depth=1',
          '--branch',
          payload.source.ref,
          payload.source.repo,
          stagingPath,
        ]);
        break;
      }
      case 'zip': {
        await fs.mkdir(stagingPath, { recursive: true });
        await run('unzip', ['-q', payload.source.path, '-d', stagingPath]);
        break;
      }
    }
    return stagingPath;
  }

  private async loadAndValidateManifest(stagingPath: string): Promise<TemplateManifest> {
    const manifestPath = path.join(stagingPath, 'template.json');
    if (!(await pathExists(manifestPath))) {
      throw { code: 'manifest_missing', details: [manifestPath] } satisfies ImportError;
    }
    const raw = await fs.readFile(manifestPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw {
        code: 'manifest_invalid_json',
        details: [e instanceof Error ? e.message : String(e)],
      } satisfies ImportError;
    }
    const v = validateManifest(parsed);
    if (!v.ok) {
      throw { code: 'manifest_invalid_schema', details: v.error } satisfies ImportError;
    }
    return v.value;
  }

  private async moveToFinal(stagingPath: string, finalPath: string): Promise<void> {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    if (await pathExists(finalPath)) {
      await fs.rm(finalPath, { recursive: true, force: true });
    }
    try {
      await fs.rename(stagingPath, finalPath);
    } catch (e) {
      // Cross-device fallback
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        await fs.cp(stagingPath, finalPath, { recursive: true, force: true });
        await fs.rm(stagingPath, { recursive: true, force: true });
      } else {
        throw { code: 'move_failed', details: [String(e instanceof Error ? e.message : e)] } satisfies ImportError;
      }
    }
  }
}

function isImportError(e: unknown): e is ImportError {
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code: unknown }).code === 'string';
}
