import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { DeployJobPayload } from '../../queues/deploy.queue';
import type { IPluginClient, PluginClientContext } from '../wordpress/plugin-client';

/** Zips a theme directory into a Buffer. Injected so the service stays unit-testable. */
export type ThemePackager = (themeDir: string) => Promise<Buffer>;

export type ShellRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface DeploySiteContext {
  findById(id: number): Promise<{
    id: number;
    domain: string;
    pluginSecretEnc: string | null;
    templateId: number;
  } | null>;
  /** Point the site at a different template (after a successful switch). */
  setTemplate(siteId: number, templateId: number): Promise<unknown>;
}

export interface DeployTemplateContext {
  findById(id: number): Promise<{
    id: number;
    slug: string;
    localPath: string;
    manifest: unknown;
  } | null>;
}

export interface DeployThemeDeps {
  sites: DeploySiteContext;
  templates: DeployTemplateContext;
  buildClient: (ctx: PluginClientContext) => IPluginClient;
  decryptSecret: (enc: string) => string;
  packageTheme: ThemePackager;
  /** Fallback base when a template row has no localPath. */
  templatesDir: string;
}

export interface DeploySummary {
  themeSlug: string;
  templateId: number;
  zipBytes: number;
  switched: boolean;
}

interface ThemeRef {
  slug: string;
  path: string;
}

/**
 * Real packager — zips a theme directory with the `zip` CLI so the archive's
 * top-level entry is the theme folder itself (what WP's Theme_Upgrader expects).
 */
export function createThemePackager(runShell: ShellRunner): ThemePackager {
  return async (themeDir: string): Promise<Buffer> => {
    const stat = await fs.stat(themeDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`theme directory not found: ${themeDir}`);
    }
    const zipPath = path.join(
      os.tmpdir(),
      `aib-theme-${path.basename(themeDir)}-${Date.now()}.zip`,
    );
    try {
      await runShell('zip', ['-r', '-q', '-X', zipPath, path.basename(themeDir)], {
        cwd: path.dirname(themeDir),
        timeout: 120_000,
      });
      return await fs.readFile(zipPath);
    } finally {
      await fs.rm(zipPath, { force: true }).catch(() => undefined);
    }
  };
}

/**
 * Pushes a template theme to a site's live WordPress via the ai-builder-plugin.
 *  - op 'deploy-theme'    → (re)installs the site's CURRENT template theme.
 *  - op 'switch-template' → installs a DIFFERENT template's theme, then points
 *                           the site row at it once the theme is actually live.
 */
export class DeployThemeService {
  constructor(private deps: DeployThemeDeps) {}

  async run(payload: DeployJobPayload): Promise<Result<DeploySummary, AppError>> {
    const site = await this.deps.sites.findById(payload.siteId);
    if (!site) return err(new AppError('deploy.site_not_found', 404));
    if (!site.pluginSecretEnc) {
      return err(new AppError('deploy.site_not_provisioned', 409));
    }

    let templateId: number;
    if (payload.op === 'switch-template') {
      if (!payload.templateId) return err(new AppError('deploy.missing_template_id', 400));
      templateId = payload.templateId;
    } else {
      templateId = site.templateId;
    }

    const template = await this.deps.templates.findById(templateId);
    if (!template) return err(new AppError('deploy.template_not_found', 404));

    const theme = this.themeRef(template.manifest);
    if (!theme) return err(new AppError('deploy.theme_not_in_manifest', 422));

    const baseDir =
      template.localPath && template.localPath.length > 0
        ? template.localPath
        : path.join(this.deps.templatesDir, template.slug);
    const themeDir = path.join(baseDir, theme.path);

    let zip: Buffer;
    try {
      zip = await this.deps.packageTheme(themeDir);
    } catch (e) {
      return err(
        new AppError('deploy.package_failed', 500, {
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
    }

    let secret: string;
    try {
      secret = this.deps.decryptSecret(site.pluginSecretEnc);
    } catch {
      return err(new AppError('deploy.secret_decrypt_failed', 500));
    }

    const client = this.deps.buildClient({ domain: site.domain, secret });
    try {
      await client.installTheme({ zip_b64: zip.toString('base64'), overwrite: true });
      await client.activateTheme(theme.slug);
      await client.flushCache();
    } catch (e) {
      return err(
        new AppError('deploy.plugin_install_failed', 502, {
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
    }

    // Only repoint the site row once the new theme is actually live on WordPress.
    const switched = payload.op === 'switch-template' && templateId !== site.templateId;
    if (switched) {
      await this.deps.sites.setTemplate(payload.siteId, templateId);
    }

    return ok({ themeSlug: theme.slug, templateId, zipBytes: zip.length, switched });
  }

  private themeRef(manifest: unknown): ThemeRef | null {
    if (!manifest || typeof manifest !== 'object') return null;
    const theme = (manifest as Record<string, unknown>).theme;
    if (!theme || typeof theme !== 'object') return null;
    const slug = (theme as Record<string, unknown>).slug;
    const themePath = (theme as Record<string, unknown>).path;
    if (typeof slug !== 'string' || typeof themePath !== 'string') return null;
    return { slug, path: themePath };
  }
}
