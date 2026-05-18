import { SslError, type IssueCertResult } from './ssl.types';

export type ShellRunner = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export type DnsAResolver = (domain: string) => Promise<string[]>;

export interface SslServiceOpts {
  serverIp: string;
  adminEmail: string;
  runShell: ShellRunner;
  resolveA: DnsAResolver;
  /** Defaults to /etc/letsencrypt. Override in test. */
  letsencryptDir?: string;
  /** Override default 90 days for testing. */
  defaultValidityDays?: number;
}

const DOMAIN_REGEX = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;

export class SslService {
  private readonly leDir: string;
  private readonly validityDays: number;

  constructor(private readonly opts: SslServiceOpts) {
    this.leDir = opts.letsencryptDir ?? '/etc/letsencrypt';
    this.validityDays = opts.defaultValidityDays ?? 90;
  }

  async issueCert(domain: string): Promise<IssueCertResult> {
    if (!DOMAIN_REGEX.test(domain)) {
      throw new SslError('ssl.invalid_domain', { domain });
    }

    await this.verifyDnsPointsToServer(domain);
    await this.invokeCertbot(domain);

    const liveDir = `${this.leDir}/live/${domain}`;
    return {
      domain,
      certPath: `${liveDir}/cert.pem`,
      fullchainPath: `${liveDir}/fullchain.pem`,
      privkeyPath: `${liveDir}/privkey.pem`,
      chainPath: `${liveDir}/chain.pem`,
      expiresAt: new Date(Date.now() + this.validityDays * 24 * 60 * 60 * 1000),
    };
  }

  private async verifyDnsPointsToServer(domain: string): Promise<void> {
    let addrs: string[];
    try {
      addrs = await this.opts.resolveA(domain);
    } catch (e) {
      throw new SslError('ssl.dns_lookup_failed', {
        domain,
        cause: e instanceof Error ? e.message : String(e),
      });
    }
    if (!addrs.includes(this.opts.serverIp)) {
      throw new SslError('ssl.dns_not_propagated', {
        domain,
        expected: this.opts.serverIp,
        actual: addrs,
      });
    }
  }

  private async invokeCertbot(domain: string): Promise<void> {
    const args = [
      'certonly',
      '--nginx',
      '-d',
      domain,
      '--non-interactive',
      '--agree-tos',
      '-m',
      this.opts.adminEmail,
      '--keep-until-expiring',
    ];
    try {
      await this.opts.runShell('certbot', args, { timeout: 5 * 60_000 });
    } catch (e) {
      throw new SslError('ssl.certbot_failed', {
        domain,
        cause: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
