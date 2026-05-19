import { createHmac } from 'node:crypto';

/**
 * HMAC-signed REST client for `ai-builder-plugin` — the ONLY bridge between
 * Express and a live WordPress site (docs/site-management.md §1, §7,
 * docs/wordpress-plugin.md §3-4). Express never touches the `wp_<domain>`
 * database directly.
 *
 * Signature contract (must match HmacAuthenticator on the plugin side):
 *   message   = `${timestamp}\n${method}\n${routePath}\n${body}`
 *   signature = hex(hmac_sha256(perSiteSecret, message))
 *   routePath = WP REST route, e.g. `/ai-builder/v1/content/products`
 *               (what WP_REST_Request::get_route() returns — no /wp-json prefix)
 *   body      = the exact JSON string sent ('' for GET/DELETE without a body)
 */

export type PluginFetcher = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface PluginClientOpts {
  domain: string;
  /** Decrypted per-site HMAC secret (Site.pluginSecretEnc → decrypt()). */
  secret: string;
  protocol?: 'http' | 'https';
  fetcher?: PluginFetcher;
  timeoutMs?: number;
}

/**
 * Wire shape for POST /content/products. Keys match exactly what the plugin's
 * ContentController::upsertProduct + ContentSync::upsertProduct read. Anything
 * the plugin has no dedicated field for (sale_percent, video_url, featured,
 * furniture attributes) is carried inside `meta` as post-meta key/values —
 * fields the plugin does not recognise are silently dropped.
 */
export interface ProductUpsertPayload {
  slug: string;
  name: string;
  short_description?: string;
  description: string;
  regular_price: number;
  sale_price?: number;
  featured_image_id?: number;
  gallery_ids: number[];
  category_slugs: string[];
  meta: Record<string, string | number>;
}

/** Wire shape for POST /themes (JSON form — a base64 .zip the plugin unpacks). */
export interface ThemeInstallPayload {
  zip_b64: string;
  overwrite: boolean;
}

export interface IPluginClient {
  health(): Promise<void>;
  /**
   * Ask the plugin to sideload an image from `sourceUrl` and return its
   * WordPress attachment id + url. The plugin fetches the file itself, so the
   * request body stays small JSON and the HMAC signature stays clean.
   */
  uploadMedia(sourceUrl: string): Promise<{ id: number; url: string }>;
  upsertProduct(payload: ProductUpsertPayload): Promise<{ id: number }>;
  deleteProduct(slug: string): Promise<void>;
  flushCache(): Promise<void>;
  /** Install/overwrite a theme from a base64-encoded .zip. */
  installTheme(payload: ThemeInstallPayload): Promise<{ slug: string }>;
  /** Switch the active theme by directory slug. */
  activateTheme(slug: string): Promise<void>;
}

const NAMESPACE = '/ai-builder/v1';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

export class PluginClient implements IPluginClient {
  private readonly domain: string;
  private readonly secret: string;
  private readonly protocol: 'http' | 'https';
  private readonly fetcher: PluginFetcher;
  private readonly timeoutMs: number;

  constructor(opts: PluginClientOpts) {
    this.domain = opts.domain;
    this.secret = opts.secret;
    this.protocol = opts.protocol ?? 'https';
    this.fetcher = opts.fetcher ?? (globalThis.fetch as unknown as PluginFetcher);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async health(): Promise<void> {
    await this.request('GET', '/health');
  }

  async uploadMedia(sourceUrl: string): Promise<{ id: number; url: string }> {
    const data = await this.request<{ id: number; url: string }>(
      'POST',
      '/media/upload',
      { source_url: sourceUrl },
    );
    return data;
  }

  async upsertProduct(payload: ProductUpsertPayload): Promise<{ id: number }> {
    const data = await this.request<{ id: number }>('POST', '/content/products', payload);
    return data;
  }

  async deleteProduct(slug: string): Promise<void> {
    await this.request('DELETE', `/content/products/${encodeURIComponent(slug)}`);
  }

  async flushCache(): Promise<void> {
    await this.request('POST', '/cache/flush', {});
  }

  async installTheme(payload: ThemeInstallPayload): Promise<{ slug: string }> {
    return this.request<{ slug: string }>('POST', '/themes', payload);
  }

  async activateTheme(slug: string): Promise<void> {
    await this.request('POST', `/themes/${encodeURIComponent(slug)}/activate`);
  }

  private sign(
    method: string,
    routePath: string,
    body: string,
  ): { timestamp: string; signature: string } {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}\n${method}\n${routePath}\n${body}`;
    const signature = createHmac('sha256', this.secret).update(message).digest('hex');
    return { timestamp, signature };
  }

  private async request<T>(
    method: string,
    endpoint: string,
    bodyObj?: unknown,
  ): Promise<T> {
    const routePath = `${NAMESPACE}${endpoint}`;
    const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    const { timestamp, signature } = this.sign(method, routePath, body);

    const headers: Record<string, string> = {
      'X-AIB-Timestamp': timestamp,
      'X-AIB-Signature': signature,
    };
    if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';

    // Always use the ?rest_route= form: it works on every WordPress install
    // regardless of permalink settings. Pretty /wp-json/ URLs need rewrite
    // rules a freshly-provisioned site may not have. The plugin's
    // HmacAuthenticator strips `rest_route` before signing, so the signed
    // path stays the clean route below.
    const url = `${this.protocol}://${this.domain}/?rest_route=${encodeURIComponent(routePath)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      res = await this.fetcher(url, {
        method,
        headers,
        body: bodyObj === undefined ? undefined : body,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`plugin.timeout: ${method} ${endpoint}`);
      }
      throw new Error(
        `plugin.unreachable: ${method} ${endpoint}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    let parsed: Envelope<T>;
    try {
      parsed = raw ? (JSON.parse(raw) as Envelope<T>) : { ok: res.ok };
    } catch {
      throw new Error(`plugin.bad_response: ${method} ${endpoint}: HTTP ${res.status}`);
    }

    if (!res.ok || parsed.ok === false) {
      const code = parsed.error?.code ?? `http_${res.status}`;
      const msg = parsed.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`plugin.error: ${method} ${endpoint}: ${code}: ${msg}`);
    }

    return (parsed.data ?? ({} as T)) as T;
  }
}

export interface PluginClientContext {
  domain: string;
  secret: string;
  protocol?: 'http' | 'https';
}

export function createPluginClient(ctx: PluginClientContext): IPluginClient {
  return new PluginClient(ctx);
}
