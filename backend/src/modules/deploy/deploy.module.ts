import { env } from '../../config/env';
import { decrypt } from '../../lib/crypto';
import { run } from '../../lib/shell';
import { siteRepository } from '../sites/sites.module';
import { templateRepository } from '../templates/templates.module';
import { createPluginClient } from '../wordpress/plugin-client';
import { DeployQueueAdapter } from '../../queues/deploy.queue';
import { DeployService } from './deploy.service';
import { DeployThemeService, createThemePackager } from './deploy-theme.service';

// siteRepository / templateRepository structurally satisfy the narrow lookups.
export const deployService = new DeployService(siteRepository, DeployQueueAdapter);

export const deployThemeService = new DeployThemeService({
  sites: siteRepository,
  templates: templateRepository,
  buildClient: (ctx) =>
    createPluginClient({ ...ctx, protocol: env.PROVISION_SKIP_SSL ? 'http' : 'https' }),
  decryptSecret: decrypt,
  packageTheme: createThemePackager(run),
  templatesDir: env.TEMPLATES_DIR,
});
