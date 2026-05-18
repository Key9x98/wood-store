import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { run as runShell } from '../../lib/shell';
import { siteRepository } from '../sites/sites.module';
import { templateRepository } from '../templates/templates.module';
import { dnsProvider } from '../dns/dns.module';
import { sslService } from '../ssl/ssl.module';
import { SourceService } from '../wordpress/source.service';
import { WpConfigService } from '../wordpress/wp-config.service';
import { WpCliService } from '../wordpress/wp-cli.service';
import { WpDbService } from '../wordpress/wp-db.service';
import { WpMysqlClient } from '../wordpress/wp-mysql-client';
import { ApacheService } from '../apache/apache.service';
import { SmokeTestService } from '../smoke-test/smoke-test.service';
import { RollbackQueueAdapter } from '../../queues/rollback.queue';
import { ProvisionOrchestrator } from './provision.orchestrator';

/**
 * Production wiring. The orchestrator is process-agnostic; workers
 * (provision/rollback) just call `orchestrator.run` / `.rollback`.
 */
const SITES_ROOT = '/var/www/html/sites';

export const sourceService = new SourceService({
  sitesRoot: SITES_ROOT,
  wpCoreDir: env.WP_CORE_DIR,
  runShell,
  webUser: 'www-data',
});
export const wpDbService = new WpDbService(
  new WpMysqlClient({
    host: env.PROVISION_DB_HOST,
    port: env.PROVISION_DB_PORT,
    user: env.PROVISION_DB_ADMIN_USER,
    password: env.PROVISION_DB_ADMIN_PASSWORD,
  }),
);
export const wpConfigService = new WpConfigService();
export const wpCliService = new WpCliService({ runShell, wpUser: 'www-data' });
export const webServerService = new ApacheService({
  sitesAvailableDir: '/etc/apache2/sites-available',
  sitesEnabledDir: '/etc/apache2/sites-enabled',
  runShell,
});
export const smokeTestService = new SmokeTestService({
  protocol: env.PROVISION_SKIP_SSL ? 'http' : 'https',
});

export const provisionOrchestrator = new ProvisionOrchestrator({
  sitesRepo: siteRepository,
  templateRepo: templateRepository,
  dnsProvider,
  sourceService,
  wpDbService,
  wpConfigService,
  wpCliService,
  webServerService,
  sslService,
  smokeTestService,
  rollbackQueue: RollbackQueueAdapter,
  serverIp: env.SERVER_IP,
  sitesRoot: SITES_ROOT,
  skipSsl: env.PROVISION_SKIP_SSL,
  logger,
});
