import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { WebServerService } from '../provision/provision.types';

export type ShellRunner = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const APACHE_TEMPLATE = `<VirtualHost *:80>
    ServerName {{DOMAIN}}
    DocumentRoot {{SITE_ROOT}}

    <Directory {{SITE_ROOT}}>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog \${APACHE_LOG_DIR}/{{DOMAIN}}.error.log
    CustomLog \${APACHE_LOG_DIR}/{{DOMAIN}}.access.log combined
</VirtualHost>
`;

export interface ApacheServiceOpts {
  sitesAvailableDir: string;
  sitesEnabledDir: string;
  runShell: ShellRunner;
  /** Override `apache2ctl` binary path. */
  apacheBinary?: string;
  /** Override reload command (default `systemctl reload apache2`). */
  reloadCmd?: { cmd: string; args: string[] };
}

const DOMAIN_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

function assertSafeDomain(domain: string): void {
  if (!DOMAIN_REGEX.test(domain) || domain.length > 253) {
    throw new Error(`apache.invalid_domain: ${domain}`);
  }
}

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Apache 2.4 counterpart of NginxService — writes a per-site vhost into
 * sites-available, symlinks it into sites-enabled, validates, then reloads.
 */
export class ApacheService implements WebServerService {
  constructor(private readonly opts: ApacheServiceOpts) {}

  async deployConfig(
    domain: string,
    siteRoot: string,
  ): Promise<{ configPath: string; enabledPath: string }> {
    assertSafeDomain(domain);
    const configPath = path.join(this.opts.sitesAvailableDir, `${domain}.conf`);
    const enabledPath = path.join(this.opts.sitesEnabledDir, `${domain}.conf`);
    const tmp = `${configPath}.tmp`;

    const cfg = APACHE_TEMPLATE
      .split('{{DOMAIN}}')
      .join(domain)
      .split('{{SITE_ROOT}}')
      .join(siteRoot);

    await fs.mkdir(this.opts.sitesAvailableDir, { recursive: true });
    await fs.mkdir(this.opts.sitesEnabledDir, { recursive: true });

    // Atomic write: tmp + rename
    await fs.writeFile(tmp, cfg);
    await fs.rename(tmp, configPath);

    // Symlink into sites-enabled (idempotent) — Apache includes sites-enabled/*.conf
    if (!(await pathExists(enabledPath))) {
      await fs.symlink(configPath, enabledPath);
    }

    // Validate config BEFORE reload
    try {
      await this.opts.runShell(this.opts.apacheBinary ?? 'apache2ctl', ['configtest']);
    } catch (e) {
      // Roll back this step
      await fs.unlink(enabledPath).catch(() => undefined);
      await fs.unlink(configPath).catch(() => undefined);
      throw new Error(
        `apache.configtest_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const reload = this.opts.reloadCmd ?? { cmd: 'systemctl', args: ['reload', 'apache2'] };
    await this.opts.runShell(reload.cmd, reload.args);

    return { configPath, enabledPath };
  }

  async remove(domain: string): Promise<void> {
    assertSafeDomain(domain);
    const configPath = path.join(this.opts.sitesAvailableDir, `${domain}.conf`);
    const enabledPath = path.join(this.opts.sitesEnabledDir, `${domain}.conf`);
    await fs.unlink(enabledPath).catch(() => undefined);
    await fs.unlink(configPath).catch(() => undefined);
    const reload = this.opts.reloadCmd ?? { cmd: 'systemctl', args: ['reload', 'apache2'] };
    await this.opts.runShell(reload.cmd, reload.args).catch(() => undefined);
  }
}
