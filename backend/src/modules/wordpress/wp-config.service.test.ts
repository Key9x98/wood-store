import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WpConfigService } from './wp-config.service';

const testRoot = path.join(os.tmpdir(), `cms-test-wpconfig-${Date.now()}-${process.pid}`);

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});
afterAll(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('WpConfigService.generate', () => {
  it('substitutes all variables and writes file', async () => {
    const svc = new WpConfigService();
    const siteRoot = path.join(testRoot, 'a');
    await fs.mkdir(siteRoot, { recursive: true });
    const r = await svc.generate(siteRoot, {
      dbName: 'wp_a',
      dbUser: 'wp_a',
      dbPassword: 'p@ss',
      dbHost: 'localhost',
      domain: 'a.example.com',
    });
    const contents = await fs.readFile(r.configPath, 'utf8');
    expect(contents).toContain("define('DB_NAME',     'wp_a')");
    expect(contents).toContain("define('DB_PASSWORD', 'p@ss')");
    expect(contents).toContain("define('WP_HOME',    'https://a.example.com')");
    expect(contents).not.toContain('{{');
  });

  it('writes atomically (no .tmp left behind)', async () => {
    const svc = new WpConfigService();
    const siteRoot = path.join(testRoot, 'b');
    await fs.mkdir(siteRoot, { recursive: true });
    await svc.generate(siteRoot, {
      dbName: 'wp_b',
      dbUser: 'wp_b',
      dbPassword: 'x',
      dbHost: 'localhost',
      domain: 'b.example.com',
    });
    const entries = await fs.readdir(siteRoot);
    expect(entries).toContain('wp-config.php');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });

  it('produces different salts on each invocation', async () => {
    const svc = new WpConfigService();
    const a = path.join(testRoot, 'salt-a');
    const b = path.join(testRoot, 'salt-b');
    await fs.mkdir(a, { recursive: true });
    await fs.mkdir(b, { recursive: true });
    const vars = { dbName: 'd', dbUser: 'u', dbPassword: 'p', dbHost: 'h', domain: 'a.com' };
    await svc.generate(a, vars);
    await svc.generate(b, vars);
    const ca = await fs.readFile(path.join(a, 'wp-config.php'), 'utf8');
    const cb = await fs.readFile(path.join(b, 'wp-config.php'), 'utf8');
    const extractAuth = (s: string) => /define\('AUTH_KEY',\s+'([^']+)'\)/.exec(s)?.[1];
    expect(extractAuth(ca)).not.toBe(extractAuth(cb));
  });
});
