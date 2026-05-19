import { describe, it, expect, vi } from 'vitest';
import { DeployThemeService } from './deploy-theme.service';
import type { DeployThemeDeps } from './deploy-theme.service';
import type { IPluginClient } from '../wordpress/plugin-client';

const buildClient = (over: Partial<IPluginClient> = {}): IPluginClient => ({
  health: vi.fn().mockResolvedValue(undefined),
  uploadMedia: vi.fn(),
  upsertProduct: vi.fn(),
  deleteProduct: vi.fn(),
  flushCache: vi.fn().mockResolvedValue(undefined),
  installTheme: vi.fn().mockResolvedValue({ slug: 'furniture-basic' }),
  activateTheme: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const FAKE_ZIP = Buffer.from('PK-fake-zip-bytes');

const buildDeps = (
  over: Partial<DeployThemeDeps> = {},
  client: IPluginClient = buildClient(),
): DeployThemeDeps => ({
  sites: {
    findById: vi.fn().mockResolvedValue({
      id: 8, domain: 'shop3.com', pluginSecretEnc: 'enc-secret', templateId: 2,
    }),
  },
  templates: {
    findById: vi.fn().mockResolvedValue({
      id: 2, slug: 'furniture-basic', localPath: '/tpl/furniture-basic',
      manifest: { theme: { slug: 'furniture-basic', path: 'theme/furniture-basic' } },
    }),
  },
  buildClient: () => client,
  decryptSecret: (s) => s,
  packageTheme: vi.fn().mockResolvedValue(FAKE_ZIP),
  templatesDir: '/tpl',
  ...over,
});

describe('DeployThemeService.run', () => {
  it('packages the theme then installs + activates + flushes via the plugin', async () => {
    const client = buildClient();
    const deps = buildDeps({}, client);

    const r = await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });

    expect(r.ok).toBe(true);
    expect(deps.packageTheme).toHaveBeenCalledWith(
      '/tpl/furniture-basic/theme/furniture-basic',
    );
    expect(client.installTheme).toHaveBeenCalledWith({
      zip_b64: FAKE_ZIP.toString('base64'),
      overwrite: true,
    });
    expect(client.activateTheme).toHaveBeenCalledWith('furniture-basic');
    expect(client.flushCache).toHaveBeenCalledTimes(1);
  });

  it('falls back to templatesDir/<slug> when localPath is empty', async () => {
    const deps = buildDeps({
      templates: {
        findById: vi.fn().mockResolvedValue({
          id: 2, slug: 'furniture-basic', localPath: '',
          manifest: { theme: { slug: 'furniture-basic', path: 'theme/furniture-basic' } },
        }),
      },
    });
    await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });
    expect(deps.packageTheme).toHaveBeenCalledWith(
      '/tpl/furniture-basic/theme/furniture-basic',
    );
  });

  it('rejects a site without a plugin secret', async () => {
    const deps = buildDeps({
      sites: {
        findById: vi.fn().mockResolvedValue({
          id: 8, domain: 'x', pluginSecretEnc: null, templateId: 2,
        }),
      },
    });
    const r = await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.site_not_provisioned');
  });

  it('errors when the manifest declares no theme', async () => {
    const deps = buildDeps({
      templates: {
        findById: vi.fn().mockResolvedValue({
          id: 2, slug: 'x', localPath: '/tpl/x', manifest: {},
        }),
      },
    });
    const r = await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.theme_not_in_manifest');
  });

  it('surfaces a packaging failure as deploy.package_failed', async () => {
    const deps = buildDeps({
      packageTheme: vi.fn().mockRejectedValue(new Error('theme directory not found')),
    });
    const r = await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.package_failed');
  });

  it('surfaces a plugin install failure as deploy.plugin_install_failed', async () => {
    const client = buildClient({
      installTheme: vi.fn().mockRejectedValue(new Error('plugin.error: themes.install_failed')),
    });
    const r = await new DeployThemeService(buildDeps({}, client)).run({
      siteId: 8, op: 'deploy-theme',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.plugin_install_failed');
  });
});
