import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Template, Prisma } from '@prisma/client';
import { ok, err, type Result } from '../../lib/result';
import { run } from '../../lib/shell';
import type { TemplateImportJobPayload } from '../../queues/template-import.queue';
import type { ITemplateRepository } from './templates.repository';

export interface ImportOpts {
  /** Scratch dir for unzipping uploads. */
  stagingDir: string;
  /** Local clone of the codebase repo (wood-store-frontend). */
  codebaseDir: string;
  /** Codebase git remote — used to clone CODEBASE_DIR if it does not exist. */
  gitUrl: string;
  /** Branch to commit + push the theme onto. */
  gitBranch: string;
}

export interface ImportError {
  code:
    | 'unzip_failed'
    | 'theme_invalid'
    | 'codebase_unavailable'
    | 'git_push_failed'
    | 'import_failed';
  details?: string[];
}

const GIT_TIMEOUT = 5 * 60_000;

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isImportError(e: unknown): e is ImportError {
  return typeof e === 'object' && e !== null && 'code' in e &&
    typeof (e as { code: unknown }).code === 'string';
}

/**
 * Imports a WordPress theme (uploaded .zip) into the codebase git repo:
 * unzip → place under <codebase>/wp-content/themes/<slug> → commit + push →
 * register the template row. Themes are the source of truth in the repo.
 */
export class TemplateImportService {
  constructor(
    private repo: ITemplateRepository,
    private opts: ImportOpts,
  ) {}

  async run(payload: TemplateImportJobPayload): Promise<Result<Template, ImportError>> {
    const { templateId, slug, zipPath } = payload;
    const existing = await this.repo.findById(templateId);
    if (existing && existing.status !== 'building') {
      await this.repo.update(templateId, { status: 'building' });
    }

    let stagingPath: string | null = null;
    try {
      stagingPath = await this.unzip(zipPath, slug);
      const themeRoot = await this.detectThemeRoot(stagingPath);
      const header = await this.parseThemeHeader(path.join(themeRoot, 'style.css'));

      await this.ensureCodebase();
      const themeDest = await this.placeTheme(themeRoot, slug);
      await this.gitPublish(slug);

      const manifest = {
        slug,
        name: header.name ?? slug,
        version: header.version ?? '1.0.0',
        theme: { slug, path: '.' },
        source: { type: 'codebase-git', repo: this.opts.gitUrl, branch: this.opts.gitBranch },
      };
      const updated = await this.repo.update(templateId, {
        name: manifest.name,
        version: manifest.version,
        manifest: manifest as unknown as Prisma.InputJsonValue,
        localPath: themeDest,
        status: 'ready',
      });
      return ok(updated);
    } catch (e) {
      await this.repo.update(templateId, { status: 'failed' }).catch(() => undefined);
      return err(isImportError(e) ? e : { code: 'import_failed', details: [msg(e)] });
    } finally {
      if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(zipPath, { force: true }).catch(() => undefined);
    }
  }

  private async unzip(zipPath: string, slug: string): Promise<string> {
    await fs.mkdir(this.opts.stagingDir, { recursive: true });
    const dest = path.join(
      this.opts.stagingDir,
      `import-${slug}-${Date.now()}-${randomBytes(4).toString('hex')}`,
    );
    await fs.mkdir(dest, { recursive: true });
    try {
      await run('unzip', ['-q', '-o', zipPath, '-d', dest], { timeout: 120_000 });
    } catch (e) {
      throw { code: 'unzip_failed', details: [msg(e)] } satisfies ImportError;
    }
    return dest;
  }

  /** A WordPress theme is the directory containing `style.css`. */
  private async detectThemeRoot(dir: string): Promise<string> {
    if (await pathExists(path.join(dir, 'style.css'))) return dir;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === '__MACOSX' || !e.isDirectory()) continue;
      if (await pathExists(path.join(dir, e.name, 'style.css'))) {
        return path.join(dir, e.name);
      }
    }
    throw {
      code: 'theme_invalid',
      details: ['no style.css found — the zip must contain a WordPress theme'],
    } satisfies ImportError;
  }

  /** Read Theme Name + Version from the theme's style.css header block. */
  private async parseThemeHeader(
    styleCssPath: string,
  ): Promise<{ name?: string; version?: string }> {
    const css = await fs.readFile(styleCssPath, 'utf8').catch(() => '');
    const grab = (field: string): string | undefined => {
      const m = new RegExp(`^[\\t /*#@]*${field}\\s*:\\s*(.+)$`, 'im').exec(css);
      const v = m?.[1]?.trim();
      return v && v.length > 0 ? v : undefined;
    };
    return { name: grab('Theme Name'), version: grab('Version') };
  }

  /** Clone the codebase repo if CODEBASE_DIR is not already a git working tree. */
  private async ensureCodebase(): Promise<void> {
    if (await pathExists(path.join(this.opts.codebaseDir, '.git'))) return;
    if (!this.opts.gitUrl) {
      throw {
        code: 'codebase_unavailable',
        details: ['GIT_URLS is not configured and the codebase clone is missing'],
      } satisfies ImportError;
    }
    try {
      await fs.mkdir(path.dirname(this.opts.codebaseDir), { recursive: true });
      await run(
        'git',
        ['clone', '--branch', this.opts.gitBranch, this.opts.gitUrl, this.opts.codebaseDir],
        { timeout: GIT_TIMEOUT },
      );
    } catch (e) {
      throw { code: 'codebase_unavailable', details: [msg(e)] } satisfies ImportError;
    }
  }

  /** Replace <codebase>/wp-content/themes/<slug> with the imported theme. */
  private async placeTheme(themeRoot: string, slug: string): Promise<string> {
    const themesDir = path.join(this.opts.codebaseDir, 'wp-content', 'themes');
    await fs.mkdir(themesDir, { recursive: true });
    const dest = path.join(themesDir, slug);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(themeRoot, dest, { recursive: true });
    return dest;
  }

  /** git add + commit (if changed) + push the theme to the codebase remote. */
  private async gitPublish(slug: string): Promise<void> {
    const cwd = this.opts.codebaseDir;
    const rel = `wp-content/themes/${slug}`;
    try {
      await run('git', ['-C', cwd, 'add', rel], { timeout: 60_000 });
      const status = await run('git', ['-C', cwd, 'status', '--porcelain', rel], {
        timeout: 30_000,
      });
      if (status.stdout.trim() !== '') {
        await run(
          'git',
          [
            '-C', cwd,
            '-c', 'user.name=AI Builder CMS',
            '-c', 'user.email=cms@ai-builder.local',
            'commit', '-m', `template: import theme ${slug}`,
          ],
          { timeout: 60_000 },
        );
      }
      await run('git', ['-C', cwd, 'push', 'origin', `HEAD:${this.opts.gitBranch}`], {
        timeout: GIT_TIMEOUT,
      });
    } catch (e) {
      throw { code: 'git_push_failed', details: [msg(e)] } satisfies ImportError;
    }
  }
}
