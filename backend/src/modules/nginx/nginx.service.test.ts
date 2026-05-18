import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { NginxService, type ShellRunner } from './nginx.service';

const testRoot = path.join(os.tmpdir(), `cms-test-nginx-${Date.now()}-${process.pid}`);
const availDir = path.join(testRoot, 'sites-available');
const enabledDir = path.join(testRoot, 'sites-enabled');

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});
afterAll(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

const makeRunner = (): ShellRunner =>
  vi.fn(async () => ({ stdout: '', stderr: '' })) as unknown as ShellRunner;

describe('NginxService.deployConfig — happy path', () => {
  it('writes config atomically, symlinks, runs nginx -t, then reload', async () => {
    const runShell = makeRunner();
    const svc = new NginxService({
      sitesAvailableDir: availDir,
      sitesEnabledDir: enabledDir,
      runShell,
      reloadCmd: { cmd: 'echo', args: ['reload'] },
    });
    const r = await svc.deployConfig('a.example.com', '/var/www/html/sites/a.example.com');

    expect(r.configPath).toBe(path.join(availDir, 'a.example.com.conf'));
    expect(r.enabledPath).toBe(path.join(enabledDir, 'a.example.com.conf'));

    const cfg = await fs.readFile(r.configPath, 'utf8');
    expect(cfg).toContain('server_name a.example.com');
    expect(cfg).toContain('root /var/www/html/sites/a.example.com');

    // .tmp must not remain
    const entries = await fs.readdir(availDir);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);

    // Calls: nginx -t, then reload
    const calls = (runShell as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe('nginx');
    expect(calls[0]?.[1]).toEqual(['-t']);
    expect(calls[1]?.[0]).toBe('echo');
  });
});

describe('NginxService.deployConfig — nginx -t fails', () => {
  it('does NOT reload and cleans up config + symlink', async () => {
    const runShell = vi.fn(async (cmd: string) => {
      if (cmd === 'nginx') throw new Error('nginx: configuration test failed');
      return { stdout: '', stderr: '' };
    }) as unknown as ShellRunner;
    const svc = new NginxService({
      sitesAvailableDir: availDir,
      sitesEnabledDir: enabledDir,
      runShell,
      reloadCmd: { cmd: 'echo', args: ['SHOULD_NOT_RUN'] },
    });
    await expect(
      svc.deployConfig('bad.example.com', '/var/www/html/sites/bad.example.com'),
    ).rejects.toThrow(/test_failed/);

    // Cleanup verified
    await expect(
      fs.access(path.join(availDir, 'bad.example.com.conf')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(enabledDir, 'bad.example.com.conf')),
    ).rejects.toThrow();

    // reload must NOT have been called
    const calls = (runShell as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('echo');
  });
});

describe('NginxService.deployConfig — input validation', () => {
  it.each(['abc.com; rm -rf /', '-abc.com', '', 'localhost', 'http://abc.com'])(
    'rejects bad domain: %s',
    async (d) => {
      const svc = new NginxService({
        sitesAvailableDir: availDir,
        sitesEnabledDir: enabledDir,
        runShell: makeRunner(),
      });
      await expect(svc.deployConfig(d, '/x')).rejects.toThrow(/invalid_domain/);
    },
  );
});

describe('NginxService.remove', () => {
  it('removes both config and symlink, reload, idempotent on missing', async () => {
    const runShell = makeRunner();
    const svc = new NginxService({
      sitesAvailableDir: availDir,
      sitesEnabledDir: enabledDir,
      runShell,
      reloadCmd: { cmd: 'echo', args: ['reload'] },
    });
    await svc.deployConfig('remove.example.com', '/var/www/html/sites/remove.example.com');
    await svc.remove('remove.example.com');
    await expect(
      fs.access(path.join(availDir, 'remove.example.com.conf')),
    ).rejects.toThrow();
    await expect(svc.remove('remove.example.com')).resolves.toBeUndefined();
  });
});
