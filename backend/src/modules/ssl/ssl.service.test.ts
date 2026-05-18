import { describe, it, expect, vi } from 'vitest';
import { SslService, type ShellRunner, type DnsAResolver } from './ssl.service';

const buildDeps = (over: Partial<{ runShell: ShellRunner; resolveA: DnsAResolver }> = {}) => {
  const runShell = vi.fn(async () => ({ stdout: '', stderr: '' })) as ShellRunner & {
    mock: { calls: unknown[][] };
  };
  const resolveA = vi.fn(async (_d: string) => ['1.2.3.4']) as DnsAResolver & {
    mock: { calls: unknown[][] };
  };
  return {
    runShell: over.runShell ?? runShell,
    resolveA: over.resolveA ?? resolveA,
  };
};

const make = (over: Partial<{ runShell: ShellRunner; resolveA: DnsAResolver }> = {}) => {
  const deps = buildDeps(over);
  const svc = new SslService({
    serverIp: '1.2.3.4',
    adminEmail: 'admin@example.com',
    runShell: deps.runShell,
    resolveA: deps.resolveA,
    letsencryptDir: '/tmp/test-le',
    defaultValidityDays: 90,
  });
  return { svc, deps };
};

describe('SslService.issueCert — happy path', () => {
  it('returns cert paths and expiry on success', async () => {
    const { svc, deps } = make();

    const r = await svc.issueCert('abc.com');

    expect(r.domain).toBe('abc.com');
    expect(r.certPath).toBe('/tmp/test-le/live/abc.com/cert.pem');
    expect(r.fullchainPath).toBe('/tmp/test-le/live/abc.com/fullchain.pem');
    expect(r.privkeyPath).toBe('/tmp/test-le/live/abc.com/privkey.pem');
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86400_000);

    expect(deps.resolveA).toHaveBeenCalledWith('abc.com');
    expect(deps.runShell).toHaveBeenCalledTimes(1);
  });

  it('passes correct args to certbot', async () => {
    const { svc, deps } = make();
    await svc.issueCert('abc.com');
    const calls = (deps.runShell as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe('certbot');
    expect(calls[0]?.[1]).toEqual([
      'certonly',
      '--nginx',
      '-d',
      'abc.com',
      '--non-interactive',
      '--agree-tos',
      '-m',
      'admin@example.com',
      '--keep-until-expiring',
    ]);
    expect(calls[0]?.[2]).toMatchObject({ timeout: expect.any(Number) });
  });
});

describe('SslService.issueCert — DNS not propagated', () => {
  it('throws ssl.dns_not_propagated when A record points elsewhere', async () => {
    const resolveA = vi.fn(async () => ['9.9.9.9']);
    const { svc, deps } = make({ resolveA });

    await expect(svc.issueCert('abc.com')).rejects.toMatchObject({
      name: 'SslError',
      code: 'ssl.dns_not_propagated',
    });
    expect(deps.runShell).not.toHaveBeenCalled();
  });

  it('throws ssl.dns_lookup_failed when resolver errors out', async () => {
    const resolveA = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const { svc, deps } = make({ resolveA });

    await expect(svc.issueCert('abc.com')).rejects.toMatchObject({
      code: 'ssl.dns_lookup_failed',
    });
    expect(deps.runShell).not.toHaveBeenCalled();
  });

  it('accepts when SERVER_IP is one of multiple A records', async () => {
    const resolveA = vi.fn(async () => ['7.7.7.7', '1.2.3.4']);
    const { svc } = make({ resolveA });
    await expect(svc.issueCert('abc.com')).resolves.toBeDefined();
  });
});

describe('SslService.issueCert — certbot failure', () => {
  it('wraps non-zero exit as ssl.certbot_failed', async () => {
    const runShell = vi.fn(async () => {
      throw new Error('certbot exit 1: rate limit reached');
    });
    const { svc } = make({ runShell });

    await expect(svc.issueCert('abc.com')).rejects.toMatchObject({
      name: 'SslError',
      code: 'ssl.certbot_failed',
    });
  });
});

describe('SslService.issueCert — input validation', () => {
  it.each([
    'abc.com; rm -rf /',
    '-abc.com',
    'abc-.com',
    '',
    'localhost',
    'http://abc.com',
  ])('rejects invalid domain: %s', async (d) => {
    const { svc, deps } = make();
    await expect(svc.issueCert(d)).rejects.toMatchObject({ code: 'ssl.invalid_domain' });
    expect(deps.runShell).not.toHaveBeenCalled();
    expect(deps.resolveA).not.toHaveBeenCalled();
  });
});
