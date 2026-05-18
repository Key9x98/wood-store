import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Site, Template, Prisma } from '@prisma/client';
import { ProvisionOrchestrator } from './provision.orchestrator';
import { MockDnsProvider } from '../dns/mock.provider';
import { SourceService } from '../wordpress/source.service';
import { WpDbService, type IMysqlClient } from '../wordpress/wp-db.service';
import { WpConfigService } from '../wordpress/wp-config.service';
import { WpCliService } from '../wordpress/wp-cli.service';
import { NginxService, type ShellRunner as NginxShell } from '../nginx/nginx.service';
import { SmokeTestService } from '../smoke-test/smoke-test.service';
import type { ISiteRepository, DbCredentials } from '../sites/sites.repository';
import type { ITemplateRepository } from '../templates/templates.repository';
import type { SslService } from '../ssl/ssl.service';
import type { IRollbackQueue } from '../../queues/rollback.queue';
import type { ProvisionState, StepKey } from './provision.types';

// ─── In-memory repos ───────────────────────────────────────────────────
class InMemorySitesRepo implements ISiteRepository {
  rows: Site[] = [];
  private nextId = 1;
  async findById(id: number) { return this.rows.find((r) => r.id === id) ?? null; }
  async findByDomain(d: string) { return this.rows.find((r) => r.domain === d) ?? null; }
  async create(data: { domain: string; templateId: number; ownerId: number; status: string }) {
    const row: Site = {
      id: this.nextId++,
      domain: data.domain,
      status: data.status,
      templateId: data.templateId,
      ownerId: data.ownerId,
      dbName: null,
      dbUser: null,
      dbPasswordEnc: null,
      pluginSecretEnc: null,
      provisionState: {} as Prisma.JsonValue,
      provisionedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async updateStatus(id: number, status: string) { return this.patch(id, { status }); }
  async delete(id: number) { const r = await this.findById(id); if (!r) throw new Error('nf'); this.rows = this.rows.filter((x) => x.id !== id); return r; }
  async list() { return [...this.rows]; }
  async count() { return this.rows.length; }
  async transitionToProvisioning(id: number) {
    const r = await this.findById(id);
    if (!r) return null;
    if (r.status !== 'queued' && r.status !== 'provisioning') return null;
    return this.patch(id, { status: 'provisioning' });
  }
  async updateProvisionState(id: number, state: Prisma.InputJsonValue) {
    return this.patch(id, { provisionState: state as Prisma.JsonValue });
  }
  async updateDbCredentials(id: number, creds: DbCredentials) {
    return this.patch(id, {
      dbName: creds.dbName,
      dbUser: creds.dbUser,
      dbPasswordEnc: creds.dbPasswordEnc,
    });
  }
  async markActive(id: number) {
    return this.patch(id, { status: 'active', provisionedAt: new Date() });
  }
  async markFailed(id: number) { return this.patch(id, { status: 'failed' }); }

  private async patch(id: number, p: Partial<Site>) {
    const r = await this.findById(id);
    if (!r) throw new Error(`not_found ${id}`);
    Object.assign(r, p, { updatedAt: new Date() });
    return r;
  }
}

class InMemoryTemplatesRepo implements ITemplateRepository {
  rows: Template[] = [];
  async findById(id: number) { return this.rows.find((r) => r.id === id) ?? null; }
  async findBySlug(slug: string) { return this.rows.find((r) => r.slug === slug) ?? null; }
  async create() { throw new Error('not used'); }
  async update() { throw new Error('not used'); }
  async delete() { throw new Error('not used'); }
  async list() { return [...this.rows]; }
  async count() { return this.rows.length; }
}

// ─── Sandbox paths ─────────────────────────────────────────────────────
const sandboxRoot = '/var/www/html/sites-test';
const tmpRoot = path.join(os.tmpdir(), `cms-test-provision-${Date.now()}-${process.pid}`);
const tplDir = path.join(tmpRoot, 'tpl');
const wpCoreDir = path.join(tmpRoot, 'wp-core');
const nginxAvail = path.join(tmpRoot, 'nginx-available');
const nginxEnabled = path.join(tmpRoot, 'nginx-enabled');

beforeAll(async () => {
  await fs.mkdir(sandboxRoot, { recursive: true });
  await fs.mkdir(tplDir, { recursive: true });
  await fs.writeFile(path.join(tplDir, 'index.php'), '<?php // template');
  await fs.mkdir(path.join(tplDir, 'wp-content', 'themes', 'restaurant-theme'), { recursive: true });
  await fs.writeFile(path.join(tplDir, 'template.json'), JSON.stringify({
    slug: 'restaurant',
    name: 'Restaurant',
    version: '1.0.0',
    theme: { slug: 'restaurant-theme', path: 'wp-content/themes/restaurant-theme' },
  }));
  // Pristine WP core fixture for SourceService.materializeSite
  await fs.mkdir(path.join(wpCoreDir, 'wp-content', 'themes'), { recursive: true });
  await fs.writeFile(path.join(wpCoreDir, 'index.php'), '<?php // wp core');
  await fs.mkdir(tmpRoot, { recursive: true });
});

afterAll(async () => {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ─── Helpers to build a wired orchestrator ─────────────────────────────
interface Harness {
  orchestrator: ProvisionOrchestrator;
  sites: InMemorySitesRepo;
  templates: InMemoryTemplatesRepo;
  dnsProvider: MockDnsProvider;
  mysqlCalls: Array<{ op: string; args: unknown[] }>;
  rollbackEnqueueSpy: ReturnType<typeof vi.fn>;
  shellSpyNginx: ReturnType<typeof vi.fn>;
  shellSpyWp: ReturnType<typeof vi.fn>;
  nginxFailMode: { fail: boolean };
}

function buildHarness(overrides: { ssl?: Partial<SslService> } = {}): Harness {
  const sites = new InMemorySitesRepo();
  const templates = new InMemoryTemplatesRepo();
  const dnsProvider = new MockDnsProvider();
  const mysqlCalls: Array<{ op: string; args: unknown[] }> = [];

  const mysql: IMysqlClient = {
    execute: async (sql, params) => { mysqlCalls.push({ op: `execute:${sql.slice(0, 40)}`, args: params ?? [] }); },
    query: async (sql, params) => {
      mysqlCalls.push({ op: `query:${sql.slice(0, 40)}`, args: params ?? [] });
      if (sql.includes('FROM mysql.user')) return [{ count: 0 }] as unknown as Record<string, unknown>[];
      return [];
    },
    importDump: async (dbName, dumpPath) => { mysqlCalls.push({ op: 'importDump', args: [dbName, dumpPath] }); },
  };

  const shellSpyNginx = vi.fn(async () => ({ stdout: '', stderr: '' }));
  const shellSpyWp = vi.fn(async () => ({ stdout: '', stderr: '' }));
  const rollbackEnqueueSpy = vi.fn().mockResolvedValue({ jobId: 'rollback:1' });
  const nginxFailMode = { fail: false };

  const nginxShellRunner: NginxShell = (cmd, args) => {
    shellSpyNginx(cmd, args);
    if (cmd === 'nginx' && args[0] === '-t' && nginxFailMode.fail) {
      return Promise.reject(new Error('nginx: configuration test failed'));
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  };

  const sourceService = new SourceService({ sitesRoot: sandboxRoot, wpCoreDir });
  const wpDbService = new WpDbService(mysql);
  const wpConfigService = new WpConfigService();
  const wpCliService = new WpCliService({ runShell: shellSpyWp });
  const nginxService = new NginxService({
    sitesAvailableDir: nginxAvail,
    sitesEnabledDir: nginxEnabled,
    runShell: nginxShellRunner,
    reloadCmd: { cmd: 'echo', args: ['reload-noop'] },
  });
  const smokeTestService = new SmokeTestService({
    fetcher: async () => ({ ok: true, status: 200, text: async () => 'ok' }),
  });
  const sslService = {
    issueCert: vi.fn(async (domain: string) => ({
      domain,
      certPath: `/tmp/le/live/${domain}/cert.pem`,
      fullchainPath: `/tmp/le/live/${domain}/fullchain.pem`,
      privkeyPath: `/tmp/le/live/${domain}/privkey.pem`,
      chainPath: `/tmp/le/live/${domain}/chain.pem`,
      expiresAt: new Date(Date.now() + 90 * 86400_000),
    })),
    ...overrides.ssl,
  } as unknown as SslService;

  const rollbackQueue: IRollbackQueue = { enqueue: rollbackEnqueueSpy };

  const orchestrator = new ProvisionOrchestrator({
    sitesRepo: sites,
    templateRepo: templates,
    dnsProvider,
    sourceService,
    wpDbService,
    wpConfigService,
    wpCliService,
    webServerService: nginxService,
    sslService,
    smokeTestService,
    rollbackQueue,
    serverIp: '1.2.3.4',
    sitesRoot: sandboxRoot,
  });

  return {
    orchestrator, sites, templates, dnsProvider, mysqlCalls,
    rollbackEnqueueSpy, shellSpyNginx, shellSpyWp, nginxFailMode,
  };
}

async function seedSiteAndTemplate(h: Harness, domain: string): Promise<{ siteId: number; templateId: number }> {
  const tpl: Template = {
    id: 1, slug: 'restaurant', name: 'Restaurant', version: '1.0.0',
    manifest: { slug: 'restaurant', theme: { slug: 'restaurant-theme', path: 'theme/' } } as Prisma.JsonValue,
    localPath: tplDir, status: 'ready', createdAt: new Date(), updatedAt: new Date(),
  };
  h.templates.rows.push(tpl);
  const site = await h.sites.create({ domain, templateId: tpl.id, ownerId: 1, status: 'queued' });
  return { siteId: site.id, templateId: tpl.id };
}

// ─── Tests ─────────────────────────────────────────────────────────────
describe('ProvisionOrchestrator — E2E in sandbox', () => {
  beforeEach(async () => {
    // Reset sandbox between tests
    for (const e of await fs.readdir(sandboxRoot)) {
      await fs.rm(path.join(sandboxRoot, e), { recursive: true, force: true });
    }
    await fs.rm(nginxAvail, { recursive: true, force: true });
    await fs.rm(nginxEnabled, { recursive: true, force: true });
  });

  it('runs full happy path A→K, site becomes active, fs has site root + wp-config', async () => {
    const h = buildHarness();
    const { siteId } = await seedSiteAndTemplate(h, 'a.example.com');

    await h.orchestrator.run(siteId);

    const site = await h.sites.findById(siteId);
    expect(site?.status).toBe('active');
    expect(site?.dbName).toBe('wp_a_example_com');
    expect(site?.dbUser).toBe('wp_a_example_com');
    expect(site?.dbPasswordEnc).toBeTruthy();

    const state = site?.provisionState as ProvisionState;
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as StepKey[]) {
      expect(state.steps[k]?.done).toBe(true);
    }

    // FS side-effects
    const siteFs = path.join(sandboxRoot, 'a.example.com');
    expect(await fs.readdir(siteFs)).toContain('wp-config.php');
    const wpConf = await fs.readFile(path.join(siteFs, 'wp-config.php'), 'utf8');
    expect(wpConf).toContain("define('DB_NAME',     'wp_a_example_com')");

    // DNS record persisted
    expect(h.dnsProvider.list('example.com')).toHaveLength(1);

    // Nginx config + symlink present
    expect(await fs.access(path.join(nginxAvail, 'a.example.com.conf')).then(() => true, () => false)).toBe(true);
    expect(await fs.access(path.join(nginxEnabled, 'a.example.com.conf')).then(() => true, () => false)).toBe(true);

    // rollback not enqueued
    expect(h.rollbackEnqueueSpy).not.toHaveBeenCalled();
  });

  it('is idempotent — second run does not duplicate DB creates or DNS records', async () => {
    const h = buildHarness();
    const { siteId } = await seedSiteAndTemplate(h, 'b.example.com');

    await h.orchestrator.run(siteId);
    const dnsAfter1 = h.dnsProvider.list('example.com').length;
    const createDbCallsAfter1 = h.mysqlCalls.filter((c) => c.op.startsWith('execute:CREATE DATABASE')).length;
    const wpCliCallsAfter1 = h.shellSpyWp.mock.calls.length;
    const nginxShellAfter1 = h.shellSpyNginx.mock.calls.length;

    await h.orchestrator.run(siteId);

    expect(h.dnsProvider.list('example.com').length).toBe(dnsAfter1);
    expect(h.mysqlCalls.filter((c) => c.op.startsWith('execute:CREATE DATABASE')).length).toBe(createDbCallsAfter1);
    expect(h.shellSpyWp.mock.calls.length).toBe(wpCliCallsAfter1);
    expect(h.shellSpyNginx.mock.calls.length).toBe(nginxShellAfter1);

    const site = await h.sites.findById(siteId);
    expect(site?.status).toBe('active');
  });

  it('on step H failure: throws + enqueues rollback with completed[] = A..G', async () => {
    const h = buildHarness();
    h.nginxFailMode.fail = true;
    const { siteId } = await seedSiteAndTemplate(h, 'fail.example.com');

    await expect(h.orchestrator.run(siteId)).rejects.toThrow();
    expect(h.rollbackEnqueueSpy).toHaveBeenCalledTimes(1);
    const payload = h.rollbackEnqueueSpy.mock.calls[0]?.[0] as { siteId: number; completed: StepKey[] };
    expect(payload.siteId).toBe(siteId);
    expect(payload.completed).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('rollback compensates DNS + DB + folder in reverse', async () => {
    const h = buildHarness();
    const { siteId } = await seedSiteAndTemplate(h, 'c.example.com');
    await h.orchestrator.run(siteId);

    expect(h.dnsProvider.list('example.com')).toHaveLength(1);
    const siteFs = path.join(sandboxRoot, 'c.example.com');
    expect(await fs.access(siteFs).then(() => true, () => false)).toBe(true);

    await h.orchestrator.rollback(siteId, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);

    expect(h.dnsProvider.list('example.com')).toHaveLength(0);
    expect(await fs.access(siteFs).then(() => true, () => false)).toBe(false);
    const dropDb = h.mysqlCalls.filter((c) => c.op.startsWith('execute:DROP DATABASE'));
    expect(dropDb.length).toBe(1);

    const site = await h.sites.findById(siteId);
    expect(site?.status).toBe('failed');
  });

  it('rejects invalid domain before any side-effects', async () => {
    const h = buildHarness();
    const { siteId } = await seedSiteAndTemplate(h, 'a.example.com');
    // Tamper site.domain to an invalid value (simulating bad data)
    h.sites.rows[0]!.domain = 'abc.com; rm -rf /';

    await expect(h.orchestrator.run(siteId)).rejects.toThrow();
    expect(h.dnsProvider.list('example.com')).toHaveLength(0);
    expect(h.mysqlCalls.length).toBe(0);
  });
});
