import type { DnsProvider } from './dns.provider';
import {
  type DnsRecord,
  type DnsRecordType,
  type UpsertARequest,
  type FindRecordRequest,
  type DeleteRecordRequest,
  DnsError,
} from './dns.types';
import { TokenBucketRateLimiter, type IRateLimiter } from './dns.rate-limiter';

const CF_BASE = 'https://api.cloudflare.com/client/v4';

interface CfResp<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages?: unknown[];
  result?: T;
}

interface CfZone {
  id: string;
  name: string;
}

interface CfDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  zone_id?: string;
}

export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}>;

export interface CloudflareProviderOpts {
  apiToken: string;
  fetcher?: Fetcher;
  rateLimiter?: IRateLimiter;
  /** Optional static zone-name → zone-id mapping; bypasses API lookup. */
  zoneIdMap?: Record<string, string>;
}

const defaultFetcher: Fetcher = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, ok: r.ok, text: () => r.text() };
};

export class CloudflareProvider implements DnsProvider {
  private readonly fetcher: Fetcher;
  private readonly limiter: IRateLimiter;
  private readonly authHeader: string;
  private readonly zoneIdCache = new Map<string, string>();

  constructor(opts: CloudflareProviderOpts) {
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.limiter = opts.rateLimiter ?? new TokenBucketRateLimiter(4, 4);
    this.authHeader = `Bearer ${opts.apiToken}`;
    if (opts.zoneIdMap) {
      for (const [name, id] of Object.entries(opts.zoneIdMap)) {
        this.zoneIdCache.set(name, id);
      }
    }
  }

  async findRecord(req: FindRecordRequest): Promise<DnsRecord | null> {
    const zoneId = await this.resolveZoneId(req.zone);
    const params = new URLSearchParams({ name: req.name });
    if (req.type) params.set('type', req.type);
    const body = await this.call<CfDnsRecord[]>('GET', `/zones/${zoneId}/dns_records?${params}`, zoneId);
    const first = body[0];
    return first ? this.toRecord(first, req.zone) : null;
  }

  async upsertA(req: UpsertARequest): Promise<DnsRecord> {
    const zoneId = await this.resolveZoneId(req.zone);
    const existing = await this.findRecord({ zone: req.zone, name: req.name, type: 'A' });
    const payload = {
      type: 'A',
      name: req.name,
      content: req.content,
      ttl: req.ttl ?? 300,
      proxied: req.proxied ?? false,
    };
    if (existing) {
      const updated = await this.call<CfDnsRecord>(
        'PUT',
        `/zones/${zoneId}/dns_records/${existing.id}`,
        zoneId,
        payload,
      );
      return this.toRecord(updated, req.zone);
    }
    const created = await this.call<CfDnsRecord>(
      'POST',
      `/zones/${zoneId}/dns_records`,
      zoneId,
      payload,
    );
    return this.toRecord(created, req.zone);
  }

  async deleteRecord(req: DeleteRecordRequest): Promise<void> {
    const zoneId = await this.resolveZoneId(req.zone);
    await this.call<{ id: string }>('DELETE', `/zones/${zoneId}/dns_records/${req.recordId}`, zoneId);
  }

  private async resolveZoneId(zoneName: string): Promise<string> {
    const cached = this.zoneIdCache.get(zoneName);
    if (cached) return cached;
    const params = new URLSearchParams({ name: zoneName });
    // Use the zone-NAME as the throttle key for the lookup itself
    const zones = await this.call<CfZone[]>('GET', `/zones?${params}`, zoneName);
    const found = zones.find((z) => z.name === zoneName);
    if (!found) throw new DnsError('dns.zone_not_found', { zone: zoneName });
    this.zoneIdCache.set(zoneName, found.id);
    return found.id;
  }

  private async call<T>(
    method: string,
    path: string,
    rateKey: string,
    body?: unknown,
  ): Promise<T> {
    await this.limiter.acquire(rateKey);
    let resp;
    try {
      resp = await this.fetcher(`${CF_BASE}${path}`, {
        method,
        headers: {
          authorization: this.authHeader,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new DnsError('dns.network_error', e instanceof Error ? e.message : String(e));
    }

    const text = await resp.text();
    let parsed: CfResp<T>;
    try {
      parsed = text ? (JSON.parse(text) as CfResp<T>) : { success: resp.ok, errors: [] };
    } catch {
      throw new DnsError('dns.invalid_response', { status: resp.status, body: text.slice(0, 500) });
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new DnsError('dns.unauthorized', parsed.errors);
    }
    if (resp.status === 429) {
      throw new DnsError('dns.rate_limited', parsed.errors);
    }
    if (!parsed.success) {
      throw new DnsError('dns.provider_error', { status: resp.status, errors: parsed.errors });
    }
    if (parsed.result === undefined && method !== 'DELETE') {
      throw new DnsError('dns.invalid_response', { status: resp.status, body: text.slice(0, 500) });
    }
    return (parsed.result ?? ({} as T)) as T;
  }

  private toRecord(r: CfDnsRecord, zoneName: string): DnsRecord {
    return {
      id: r.id,
      zone: zoneName,
      name: r.name,
      type: r.type as DnsRecordType,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
    };
  }
}
