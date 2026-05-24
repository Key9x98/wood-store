import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Prisma } from '@prisma/client';
import type { DnsProvider } from '../dns/dns.provider';
import type { ISiteRepository } from '../sites/sites.repository';
import type { ITemplateRepository } from '../templates/templates.repository';
import type { SourceService } from '../wordpress/source.service';
import type { WpDbService } from '../wordpress/wp-db.service';
import type { WpConfigService } from '../wordpress/wp-config.service';
import type { WpCliService } from '../wordpress/wp-cli.service';
import type { SmokeTestService } from '../smoke-test/smoke-test.service';
import type { SslService } from '../ssl/ssl.service';
import type { IRollbackQueue } from '../../queues/rollback.queue';
import { encrypt, decrypt } from '../../lib/crypto';
import { DomainSchema } from '../sites/sites.schema';
import {
  type ProvisionState,
  type StepArtefacts,
  type StepKey,
  type WebServerService,
  STEP_KEYS,
  ProvisionError,
} from './provision.types';
import { rootDomain, dbNameFromDomain } from './domain.util';

export interface ProvisionLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: object): ProvisionLogger;
}

export interface ProvisionDeps {
  sitesRepo: ISiteRepository;
  templateRepo: ITemplateRepository;
  dnsProvider: DnsProvider;
  sourceService: SourceService;
  wpDbService: WpDbService;
  wpConfigService: WpConfigService;
  wpCliService: WpCliService;
  webServerService: WebServerService;
  sslService: SslService;
  smokeTestService: SmokeTestService;
  rollbackQueue: IRollbackQueue;
  serverIp: string;
  sitesRoot: string;
  /** Plugin slug to activate at step G. Default 'ai-builder-plugin'. */
  pluginSlug?: string;
  /** Skip step I (Let's Encrypt) — for local/dev without public DNS. */
  skipSsl?: boolean;
  logger?: ProvisionLogger;
}

const nullLogger: ProvisionLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};

interface RunContext {
  siteId: number;
  domain: string;
  state: ProvisionState;
  log: ProvisionLogger;
}

export class ProvisionOrchestrator {
  private readonly pluginSlug: string;

  constructor(private readonly deps: ProvisionDeps) {
    this.pluginSlug = deps.pluginSlug ?? 'ai-builder-plugin';
  }

  async run(siteId: number): Promise<void> {
    const log = (this.deps.logger ?? nullLogger).child({ siteId });

    const site0 = await this.deps.sitesRepo.findById(siteId);
    if (!site0) throw new ProvisionError('provision.site_not_found', { siteId });

    const domainCheck = DomainSchema.safeParse(site0.domain);
    if (!domainCheck.success) {
      await this.deps.sitesRepo.markFailed(siteId, 'invalid_domain');
      throw new ProvisionError('provision.invalid_domain', site0.domain);
    }
    const domain = domainCheck.data;

    const template = await this.deps.templateRepo.findById(site0.templateId);
    if (!template) {
      await this.deps.sitesRepo.markFailed(siteId, 'template_not_found');
      throw new ProvisionError('provision.template_not_found', site0.templateId);
    }

    const state: ProvisionState = isProvisionState(site0.provisionState)
      ? site0.provisionState
      : { steps: {} };

    const ctx: RunContext = { siteId, domain, state, log };
    const completed: StepKey[] = [];
    for (const k of STEP_KEYS) if (state.steps[k]?.done) completed.push(k);

    try {
      // ─── A. Lock ──────────────────────────────────────────────────────
      await this.runStep(ctx, 'A', async () => {
        const claimed = await this.deps.sitesRepo.transitionToProvisioning(siteId);
        if (!claimed) throw new ProvisionError('provision.not_claimable');
        return undefined;
      });
      track(completed, 'A');

      // ─── B. DNS ───────────────────────────────────────────────────────
      const _dnsArt = await this.runStep(ctx, 'B', async () => {
        const zone = rootDomain(domain);
        const record = await this.deps.dnsProvider.upsertA({
          zone,
          name: domain,
          content: this.deps.serverIp,
          ttl: 300,
        });
        return { recordId: record.id, zone };
      });
      track(completed, 'B');

      // ─── C. Copy source ───────────────────────────────────────────────
      const srcArt = await this.runStep(ctx, 'C', async () => {
        const siteRoot = path.join(this.deps.sitesRoot, domain);
        const theme = readTheme(template.manifest);
        await this.deps.sourceService.materializeSite(
          siteRoot,
          theme
            ? { srcDir: path.join(template.localPath, theme.path), slug: theme.slug }
            : undefined,
        );
        return { siteRoot };
      });
      track(completed, 'C');

      // ─── D. DB ────────────────────────────────────────────────────────
      let dbArt: StepArtefacts['D'];
      let runtimeDbPassword: string | null = null;
      const prevD = state.steps.D;
      if (prevD?.done && prevD.artefact) {
        dbArt = prevD.artefact;
      } else {
        dbArt = await this.runStep(ctx, 'D', async () => {
          const dbName = dbNameFromDomain(domain);
          const dbUser = dbName;
          const dbPassword = randomBytes(24).toString('base64url');
          runtimeDbPassword = dbPassword;
          await this.deps.wpDbService.createDatabase(dbName);
          await this.deps.wpDbService.createUser(dbUser, dbPassword);
          await this.deps.wpDbService.grant(dbName, dbUser);
          await this.deps.sitesRepo.updateDbCredentials(siteId, {
            dbName,
            dbUser,
            dbPasswordEnc: encrypt(dbPassword),
          });
          return { dbName, dbUser };
        });
        track(completed, 'D');
      }

      // ─── E. Import dump (skip if not present) ─────────────────────────
      await this.runStep(ctx, 'E', async () => {
        const dumpPath = path.join(template.localPath, 'db_dump.sql');
        const has = await pathExists(dumpPath);
        if (has) {
          await this.deps.wpDbService.importDump(dbArt.dbName, dumpPath);
        }
        return { imported: has };
      });
      track(completed, 'E');

      // ─── F. wp-config.php ─────────────────────────────────────────────
      const dbPassword = runtimeDbPassword ?? (await this.fetchAndDecryptDbPassword(siteId));
      const cfgArt = await this.runStep(ctx, 'F', async () => {
        const r = await this.deps.wpConfigService.generate(srcArt.siteRoot, {
          dbName: dbArt.dbName,
          dbUser: dbArt.dbUser,
          dbPassword,
          dbHost: 'localhost',
          domain,
          protocol: this.deps.skipSsl ? 'http' : 'https',
        });
        return r;
      });
      track(completed, 'F');

      // ─── G. WP-CLI activate ──────────────────────────────────────────
      await this.runStep(ctx, 'G', async () => {
        // All site files exist now (core + wp-config) — hand ownership to the
        // web user so Apache/PHP can read wp-config and wp-cli can write.
        await this.deps.sourceService.chownToWebUser(srcArt.siteRoot);
        const theme = readTheme(template.manifest);
        if (theme) {
          await this.deps.wpCliService.activateTheme(srcArt.siteRoot, theme.slug);
        }
        await this.deps.wpCliService.activatePlugin(srcArt.siteRoot, this.pluginSlug);
        await this.deps.wpCliService.flushRewrite(srcArt.siteRoot);
        return undefined;
      });
      track(completed, 'G');

      // ─── L. Plugin HMAC secret ───────────────────────────────────────
      await this.runStep(ctx, 'L', async () => {
        // Idempotent at two levels: runStep skips when state.L.done is set;
        // we also skip if a secret already exists on the site row (e.g. set
        // manually before this step existed) — never rotate a live secret.
        const cur = await this.deps.sitesRepo.findById(siteId);
        if (cur?.pluginSecretEnc) return undefined;
        const secret = randomBytes(32).toString('hex');
        await this.deps.wpCliService.setOption(srcArt.siteRoot, 'ai_builder_secret', secret);
        await this.deps.sitesRepo.setPluginSecret(siteId, encrypt(secret));
        return undefined;
      });
      track(completed, 'L');

      // ─── H. Nginx ─────────────────────────────────────────────────────
      const nginxArt = await this.runStep(ctx, 'H', async () => {
        return this.deps.webServerService.deployConfig(domain, srcArt.siteRoot);
      });
      track(completed, 'H');

      // ─── I. SSL ───────────────────────────────────────────────────────
      const sslArt = await this.runStep(ctx, 'I', async () => {
        if (this.deps.skipSsl) {
          ctx.log.warn({ step: 'I' }, 'ssl_skipped');
          return { certPath: '', fullchainPath: '', expiresAt: '' };
        }
        const r = await this.deps.sslService.issueCert(domain);
        return {
          certPath: r.certPath,
          fullchainPath: r.fullchainPath,
          expiresAt: r.expiresAt.toISOString(),
        };
      });
      track(completed, 'I');

      // ─── J. Smoke test ────────────────────────────────────────────────
      await this.runStep(ctx, 'J', async () => {
        await this.deps.smokeTestService.check(domain);
        return undefined;
      });
      track(completed, 'J');

      // ─── K. Mark active ───────────────────────────────────────────────
      await this.runStep(ctx, 'K', async () => {
        await this.deps.sitesRepo.markActive(siteId);
        return undefined;
      });
      track(completed, 'K');

      log.info({ completed }, 'provision_done');
      // Avoid "unused" complaints
      void cfgArt;
      void nginxArt;
      void sslArt;
    } catch (err) {
      log.error({ err, completed }, 'provision_failed_enqueueing_rollback');
      await this.deps.rollbackQueue.enqueue({ siteId, completed }).catch((e) => {
        log.error({ err: e }, 'rollback_enqueue_failed');
      });
      throw err;
    }
  }

  /**
   * Compensation in reverse order. Each step is best-effort and idempotent:
   * a failing compensation is logged and we continue.
   */
  async rollback(siteId: number, completedSteps: StepKey[]): Promise<void> {
    const log = (this.deps.logger ?? nullLogger).child({ siteId, op: 'rollback' });
    const site = await this.deps.sitesRepo.findById(siteId);
    if (!site) {
      log.warn({}, 'site_not_found');
      return;
    }
    const state: ProvisionState = isProvisionState(site.provisionState)
      ? site.provisionState
      : { steps: {} };

    for (const k of [...completedSteps].reverse()) {
      try {
        await this.compensate(k, site.domain, state);
        log.info({ step: k }, 'compensated');
      } catch (e) {
        log.error({ step: k, err: e instanceof Error ? e.message : String(e) }, 'compensation_failed');
      }
    }
    await this.deps.sitesRepo.markFailed(siteId, 'rollback_complete');
  }

  // ───── Helpers ─────────────────────────────────────────────────────────
  private async runStep<K extends StepKey>(
    ctx: RunContext,
    key: K,
    fn: () => Promise<StepArtefacts[K]>,
  ): Promise<StepArtefacts[K]> {
    const prev = ctx.state.steps[key];
    if (prev?.done) {
      return prev.artefact as StepArtefacts[K];
    }
    ctx.log.info({ step: key }, 'step_start');
    const artefact = await fn();
    // Index-by-K assignment widens to a union TS can't narrow; safe cast.
    (ctx.state.steps as Record<StepKey, unknown>)[key] = {
      done: true,
      at: new Date().toISOString(),
      artefact,
    };
    await this.deps.sitesRepo.updateProvisionState(
      ctx.siteId,
      ctx.state as unknown as Prisma.InputJsonValue,
    );
    ctx.log.info({ step: key }, 'step_done');
    return artefact;
  }

  private async fetchAndDecryptDbPassword(siteId: number): Promise<string> {
    const fresh = await this.deps.sitesRepo.findById(siteId);
    if (!fresh?.dbPasswordEnc) {
      throw new ProvisionError('provision.step_failed', 'db_password_missing');
    }
    return decrypt(fresh.dbPasswordEnc);
  }

  private async compensate(step: StepKey, domain: string, state: ProvisionState): Promise<void> {
    switch (step) {
      case 'B': {
        const a = state.steps.B?.artefact;
        if (a) await this.deps.dnsProvider.deleteRecord({ zone: a.zone, recordId: a.recordId });
        return;
      }
      case 'C': {
        const a = state.steps.C?.artefact;
        if (a) await this.deps.sourceService.removeSite(a.siteRoot);
        return;
      }
      case 'D': {
        const a = state.steps.D?.artefact;
        if (a) {
          await this.deps.wpDbService.dropDatabase(a.dbName);
          await this.deps.wpDbService.dropUser(a.dbUser);
        }
        return;
      }
      case 'H': {
        await this.deps.webServerService.remove(domain);
        return;
      }
      case 'I': {
        // Milestone 5: log only; certbot revoke is left to ops for now.
        return;
      }
      // A, E, F, G, J, K: no compensation needed (folded into other steps, or no side-effect outside DB row).
      default:
        return;
    }
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────
function track(list: StepKey[], k: StepKey): void {
  if (!list.includes(k)) list.push(k);
}

const pathExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

function isProvisionState(v: unknown): v is ProvisionState {
  if (!v || typeof v !== 'object') return false;
  const s = (v as { steps?: unknown }).steps;
  return typeof s === 'object' && s !== null;
}

function readTheme(manifest: unknown): { slug: string; path: string } | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const theme = (manifest as { theme?: unknown }).theme;
  if (!theme || typeof theme !== 'object') return null;
  const slug = (theme as { slug?: unknown }).slug;
  const themePath = (theme as { path?: unknown }).path;
  if (typeof slug !== 'string' || typeof themePath !== 'string') return null;
  return { slug, path: themePath };
}
