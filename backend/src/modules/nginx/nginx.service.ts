import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type ShellRunner = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const NGINX_TEMPLATE = `server {
    listen 80;
    server_name {{DOMAIN}};
    root {{SITE_ROOT}};
    index index.php index.html;

    access_log /var/log/nginx/{{DOMAIN}}.access.log;
    error_log  /var/log/nginx/{{DOMAIN}}.error.log;

    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param HTTP_PROXY "";
    }

    location ~ /\\.ht { deny all; }
    location = /xmlrpc.php { deny all; }
}
`;

export interface NginxServiceOpts {
  sitesAvailableDir: string;
  sitesEnabledDir: string;
  runShell: ShellRunner;
  /** Override `nginx` binary path. */
  nginxBinary?: string;
  /** Override reload command (default `systemctl reload nginx`). */
  reloadCmd?: { cmd: string; args: string[] };
}

const DOMAIN_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

function assertSafeDomain(domain: string): void {
  if (!DOMAIN_REGEX.test(domain) || domain.length > 253) {
    throw new Error(`nginx.invalid_domain: ${domain}`);
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

export class NginxService {
  constructor(private readonly opts: NginxServiceOpts) {}

  async deployConfig(
    domain: string,
    siteRoot: string,
  ): Promise<{ configPath: string; enabledPath: string }> {
    assertSafeDomain(domain);
    const configPath = path.join(this.opts.sitesAvailableDir, `${domain}.conf`);
    const enabledPath = path.join(this.opts.sitesEnabledDir, `${domain}.conf`);
    const tmp = `${configPath}.tmp`;

    const cfg = NGINX_TEMPLATE
      .split('{{DOMAIN}}')
      .join(domain)
      .split('{{SITE_ROOT}}')
      .join(siteRoot);

    await fs.mkdir(this.opts.sitesAvailableDir, { recursive: true });
    await fs.mkdir(this.opts.sitesEnabledDir, { recursive: true });

    // Atomic write: tmp + rename
    await fs.writeFile(tmp, cfg);
    await fs.rename(tmp, configPath);

    // Symlink (idempotent)
    if (!(await pathExists(enabledPath))) {
      await fs.symlink(configPath, enabledPath);
    }

    // Test config BEFORE reload
    try {
      await this.opts.runShell(this.opts.nginxBinary ?? 'nginx', ['-t']);
    } catch (e) {
      // Roll back this step
      await fs.unlink(enabledPath).catch(() => undefined);
      await fs.unlink(configPath).catch(() => undefined);
      throw new Error(
        `nginx.test_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const reload = this.opts.reloadCmd ?? { cmd: 'systemctl', args: ['reload', 'nginx'] };
    await this.opts.runShell(reload.cmd, reload.args);

    return { configPath, enabledPath };
  }

  async remove(domain: string): Promise<void> {
    assertSafeDomain(domain);
    const configPath = path.join(this.opts.sitesAvailableDir, `${domain}.conf`);
    const enabledPath = path.join(this.opts.sitesEnabledDir, `${domain}.conf`);
    await fs.unlink(enabledPath).catch(() => undefined);
    await fs.unlink(configPath).catch(() => undefined);
    const reload = this.opts.reloadCmd ?? { cmd: 'systemctl', args: ['reload', 'nginx'] };
    await this.opts.runShell(reload.cmd, reload.args).catch(() => undefined);
  }
}
