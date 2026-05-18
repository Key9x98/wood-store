export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface SmokeTestServiceOpts {
  fetcher?: Fetcher;
  timeoutMs?: number;
  protocol?: 'http' | 'https';
  /**
   * Path to GET for the smoke check. Default '/' (homepage) — proves Apache,
   * PHP, WordPress bootstrap and DB connectivity. The plugin's own
   * /wp-json/ai-builder/v1/health route is HMAC-auth-gated, so it cannot be
   * used as an unauthenticated smoke check.
   */
  healthPath?: string;
}

export class SmokeTestService {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly protocol: 'http' | 'https';
  private readonly healthPath: string;

  constructor(opts: SmokeTestServiceOpts = {}) {
    this.fetcher = opts.fetcher ?? (globalThis.fetch as Fetcher);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.protocol = opts.protocol ?? 'https';
    this.healthPath = opts.healthPath ?? '/';
  }

  async check(domain: string): Promise<void> {
    const url = `${this.protocol}://${domain}${this.healthPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetcher(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`smoke.failed: HTTP ${res.status}`);
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error('smoke.timeout');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
