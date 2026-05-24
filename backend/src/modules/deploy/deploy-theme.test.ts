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
    setTemplate: vi.fn().mockResolvedValue(undefined),
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

describe('DeployThemeService.run — deploy-theme', () => {
  it('packages the current theme then installs + activates + flushes', async () => {
    const client = buildClient();
    const deps = buildDeps({}, client);

    const r = await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.switched).toBe(false);
    expect(deps.packageTheme).toHaveBeenCalledWith('/tpl/furniture-basic/theme/furniture-basic');
    expect(client.installTheme).toHaveBeenCalledWith({
      zip_b64: FAKE_ZIP.toString('base64'),
      overwrite: true,
    });
    expect(client.activateTheme).toHaveBeenCalledWith('furniture-basic');
    expect(client.flushCache).toHaveBeenCalledTimes(1);
    // deploy-theme must NOT repoint the site
    expect(deps.sites.setTemplate).not.toHaveBeenCalled();
  });

  it('rejects a site without a plugin secret', async () => {
    const deps = buildDeps({
      sites: {
        findById: vi.fn().mockResolvedValue({
          id: 8, domain: 'x', pluginSecretEnc: null, templateId: 2,
        }),
        setTemplate: vi.fn(),
      },
    });
    const r = await new DeployThemeService(deps).run({ siteId: 8, op: 'deploy-theme' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.site_not_provisioned');
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

describe('DeployThemeService.run — switch-template', () => {
  it('installs the target template theme then repoints the site row', async () => {
    const client = buildClient();
    const deps = buildDeps(
      {
        sites: {
          findById: vi.fn().mockResolvedValue({
            id: 8, domain: 'shop3.com', pluginSecretEnc: 'enc', templateId: 2,
          }),
          setTemplate: vi.fn().mockResolvedValue(undefined),
        },
        templates: {
          findById: vi.fn().mockResolvedValue({
            id: 5, slug: 'furniture-premium', localPath: '/tpl/furniture-premium',
            manifest: { theme: { slug: 'furniture-premium', path: 'theme/furniture-premium' } },
          }),
        },
      },
      client,
    );

    const r = await new DeployThemeService(deps).run({
      siteId: 8, op: 'switch-template', templateId: 5,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.switched).toBe(true);
      expect(r.value.templateId).toBe(5);
    }
    expect(deps.packageTheme).toHaveBeenCalledWith(
      '/tpl/furniture-premium/theme/furniture-premium',
    );
    expect(client.installTheme).toHaveBeenCalledTimes(1);
    // site is repointed to the new template only after the theme is live
    expect(deps.sites.setTemplate).toHaveBeenCalledWith(8, 5);
  });

  it('errors when switch-template has no templateId in the payload', async () => {
    const r = await new DeployThemeService(buildDeps()).run({ siteId: 8, op: 'switch-template' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('deploy.missing_template_id');
  });

  it('does not repoint the site if the plugin install fails', async () => {
    const client = buildClient({
      installTheme: vi.fn().mockRejectedValue(new Error('plugin.error')),
    });
    const deps = buildDeps(
      {
        templates: {
          findById: vi.fn().mockResolvedValue({
            id: 5, slug: 'furniture-premium', localPath: '/tpl/furniture-premium',
            manifest: { theme: { slug: 'furniture-premium', path: 'theme/furniture-premium' } },
          }),
        },
      },
      client,
    );
    const r = await new DeployThemeService(deps).run({
      siteId: 8, op: 'switch-template', templateId: 5,
    });
    expect(r.ok).toBe(false);
    expect(deps.sites.setTemplate).not.toHaveBeenCalled();
  });
});
