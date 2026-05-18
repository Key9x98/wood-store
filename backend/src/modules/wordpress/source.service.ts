import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type ShellRunner = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface SourceServiceOpts {
  sitesRoot: string;
  /** Pristine WordPress core copied into each new site. */
  wpCoreDir: string;
  /** Shell runner — required for chownToWebUser. */
  runShell?: ShellRunner;
  /** OS user that should own the served site files (e.g. 'www-data'). */
  webUser?: string;
}

/** Theme overlay applied on top of the WordPress core. */
export interface ThemeOverlay {
  /** Absolute path to the theme folder inside the template. */
  srcDir: string;
  /** Theme folder name under wp-content/themes. */
  slug: string;
}

const THEME_SLUG_REGEX = /^[a-z][a-z0-9-]*$/;

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

const isEmptyDir = async (p: string): Promise<boolean> => {
  try {
    const entries = await fs.readdir(p);
    return entries.length === 0;
  } catch {
    return true;
  }
};

export class SourceService {
  constructor(private readonly opts: SourceServiceOpts) {}

  /** Guard: only allow operations within `sitesRoot`. */
  private assertWithinRoot(siteRoot: string): void {
    const normalized = path.resolve(siteRoot);
    const root = path.resolve(this.opts.sitesRoot);
    if (normalized !== root && !normalized.startsWith(root + path.sep)) {
      throw new Error(`source.unsafe_path: ${siteRoot} not under ${root}`);
    }
  }

  /**
   * Build a runnable WordPress install at `siteRoot`: copy the pristine WP
   * core, then overlay the template theme into wp-content/themes. Idempotent —
   * skips if `siteRoot` is already populated.
   */
  async materializeSite(
    siteRoot: string,
    theme?: ThemeOverlay,
  ): Promise<{ siteRoot: string }> {
    this.assertWithinRoot(siteRoot);
    if (theme && !THEME_SLUG_REGEX.test(theme.slug)) {
      throw new Error(`source.invalid_theme_slug: ${theme.slug}`);
    }

    if ((await pathExists(siteRoot)) && !(await isEmptyDir(siteRoot))) {
      return { siteRoot }; // already populated — idempotent skip
    }

    if (!this.opts.wpCoreDir || !(await pathExists(this.opts.wpCoreDir))) {
      throw new Error(
        `source.wp_core_missing: WP_CORE_DIR không tồn tại: ${this.opts.wpCoreDir || '(chưa cấu hình)'}`,
      );
    }

    await fs.mkdir(path.dirname(siteRoot), { recursive: true });
    await fs.cp(this.opts.wpCoreDir, siteRoot, { recursive: true, force: true });

    if (theme && (await pathExists(theme.srcDir))) {
      const dest = path.join(siteRoot, 'wp-content', 'themes', theme.slug);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(theme.srcDir, dest, { recursive: true, force: true });
    }

    return { siteRoot };
  }

  /**
   * Hand site ownership to the web-server user so Apache/PHP can read
   * wp-config.php and WordPress can write wp-content. No-op when not
   * configured (e.g. unit tests). Requires the caller to run as root.
   */
  async chownToWebUser(siteRoot: string): Promise<void> {
    this.assertWithinRoot(siteRoot);
    if (!this.opts.runShell || !this.opts.webUser) return;
    if (typeof process.getuid === 'function' && process.getuid() !== 0) {
      throw new Error(
        'source.not_root: provision worker phải chạy bằng root (sudo) để chown site cho web-user',
      );
    }
    await this.opts.runShell('chown', [
      '-R',
      `${this.opts.webUser}:${this.opts.webUser}`,
      siteRoot,
    ]);
  }

  async removeSite(siteRoot: string): Promise<void> {
    this.assertWithinRoot(siteRoot);
    await fs.rm(siteRoot, { recursive: true, force: true });
  }
}
