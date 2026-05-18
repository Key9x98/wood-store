import { describe, it, expect, vi } from 'vitest';
import { CloudflareProvider, type Fetcher } from './cloudflare.provider';
import { NoopRateLimiter } from './dns.rate-limiter';
import { DnsError } from './dns.types';

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const buildFetcher = (
  responses: Array<{ status?: number; ok?: boolean; body: unknown }>,
): { fetcher: Fetcher; calls: MockCall[] } => {
  const calls: MockCall[] = [];
  let i = 0;
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = responses[i++];
    if (!r) throw new Error(`no mock response for call ${i}: ${init.method} ${url}`);
    const status = r.status ?? 200;
    return {
      status,
      ok: r.ok ?? (status >= 200 && status < 300),
      text: async () => JSON.stringify(r.body),
    };
  };
  return { fetcher, calls };
};

const okResp = (result: unknown) => ({ body: { success: true, errors: [], result } });

const make = (responses: Array<{ status?: number; ok?: boolean; body: unknown }>) => {
  const { fetcher, calls } = buildFetcher(responses);
  const provider = new CloudflareProvider({
    apiToken: 'test-token',
    fetcher,
    rateLimiter: new NoopRateLimiter(),
    zoneIdMap: { 'example.com': 'zone-id-123' },
  });
  return { provider, calls };
};

describe('CloudflareProvider.findRecord', () => {
  it('returns null when no records match', async () => {
    const { provider, calls } = make([okResp([])]);
    const r = await provider.findRecord({ zone: 'example.com', name: 'a.example.com' });
    expect(r).toBeNull();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toContain('/zones/zone-id-123/dns_records');
    expect(calls[0]?.url).toContain('name=a.example.com');
    expect(calls[0]?.headers.authorization).toBe('Bearer test-token');
  });

  it('returns first record when found', async () => {
    const { provider } = make([
      okResp([
        { id: 'rec-1', name: 'a.example.com', type: 'A', content: '1.2.3.4', ttl: 300, proxied: false },
      ]),
    ]);
    const r = await provider.findRecord({ zone: 'example.com', name: 'a.example.com', type: 'A' });
    expect(r).not.toBeNull();
    expect(r?.id).toBe('rec-1');
    expect(r?.content).toBe('1.2.3.4');
    expect(r?.zone).toBe('example.com');
  });
});

describe('CloudflareProvider.upsertA', () => {
  it('creates a new record when none exists (POST)', async () => {
    const { provider, calls } = make([
      okResp([]), // find → empty
      okResp({ id: 'rec-new', name: 'a.example.com', type: 'A', content: '1.2.3.4', ttl: 300 }), // POST
    ]);

    const r = await provider.upsertA({ zone: 'example.com', name: 'a.example.com', content: '1.2.3.4' });

    expect(r.id).toBe('rec-new');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.url).toContain('/zones/zone-id-123/dns_records');
    const body = JSON.parse(calls[1]!.body!);
    expect(body).toMatchObject({
      type: 'A',
      name: 'a.example.com',
      content: '1.2.3.4',
      ttl: 300,
      proxied: false,
    });
  });

  it('updates existing record (PUT) and passes ttl + proxied', async () => {
    const { provider, calls } = make([
      okResp([{ id: 'rec-existing', name: 'a.example.com', type: 'A', content: '9.9.9.9', ttl: 300 }]),
      okResp({ id: 'rec-existing', name: 'a.example.com', type: 'A', content: '1.2.3.4', ttl: 600, proxied: true }),
    ]);

    const r = await provider.upsertA({
      zone: 'example.com',
      name: 'a.example.com',
      content: '1.2.3.4',
      ttl: 600,
      proxied: true,
    });

    expect(r.id).toBe('rec-existing');
    expect(r.content).toBe('1.2.3.4');
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toContain('/dns_records/rec-existing');
    const body = JSON.parse(calls[1]!.body!);
    expect(body).toMatchObject({ ttl: 600, proxied: true });
  });
});

describe('CloudflareProvider.deleteRecord', () => {
  it('issues DELETE to correct path', async () => {
    const { provider, calls } = make([okResp({ id: 'rec-1' })]);
    await provider.deleteRecord({ zone: 'example.com', recordId: 'rec-1' });
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toContain('/zones/zone-id-123/dns_records/rec-1');
  });
});

describe('CloudflareProvider error mapping', () => {
  it('maps 401 → dns.unauthorized', async () => {
    const { provider } = make([
      { status: 401, ok: false, body: { success: false, errors: [{ code: 10000, message: 'bad token' }] } },
    ]);
    await expect(
      provider.findRecord({ zone: 'example.com', name: 'a.example.com' }),
    ).rejects.toMatchObject({ name: 'DnsError', code: 'dns.unauthorized' });
  });

  it('maps 429 → dns.rate_limited', async () => {
    const { provider } = make([
      { status: 429, ok: false, body: { success: false, errors: [] } },
    ]);
    await expect(
      provider.findRecord({ zone: 'example.com', name: 'a.example.com' }),
    ).rejects.toBeInstanceOf(DnsError);
  });

  it('maps success: false → dns.provider_error', async () => {
    const { provider } = make([
      { status: 400, ok: false, body: { success: false, errors: [{ code: 1003, message: 'invalid' }] } },
    ]);
    await expect(
      provider.findRecord({ zone: 'example.com', name: 'a.example.com' }),
    ).rejects.toMatchObject({ code: 'dns.provider_error' });
  });
});

describe('CloudflareProvider zone resolution', () => {
  it('looks up zone id via API when not in static map', async () => {
    const { fetcher, calls } = buildFetcher([
      okResp([{ id: 'zone-from-api', name: 'other.com' }]),
      okResp([]),
    ]);
    const provider = new CloudflareProvider({
      apiToken: 't',
      fetcher,
      rateLimiter: new NoopRateLimiter(),
    });
    await provider.findRecord({ zone: 'other.com', name: 'a.other.com' });
    expect(calls[0]?.url).toContain('/zones?name=other.com');
    expect(calls[1]?.url).toContain('/zones/zone-from-api/dns_records');
  });

  it('throws dns.zone_not_found when zone not in account', async () => {
    const { fetcher } = buildFetcher([okResp([])]);
    const provider = new CloudflareProvider({
      apiToken: 't',
      fetcher,
      rateLimiter: new NoopRateLimiter(),
    });
    await expect(
      provider.findRecord({ zone: 'nope.com', name: 'a.nope.com' }),
    ).rejects.toMatchObject({ code: 'dns.zone_not_found' });
  });
});

describe('CloudflareProvider throttling', () => {
  it('acquires rate-limit token for each call', async () => {
    const acquireSpy = vi.fn().mockResolvedValue(undefined);
    const { fetcher } = buildFetcher([okResp([]), okResp([]), okResp([])]);
    const provider = new CloudflareProvider({
      apiToken: 't',
      fetcher,
      rateLimiter: { acquire: acquireSpy },
      zoneIdMap: { 'example.com': 'zid' },
    });
    await provider.findRecord({ zone: 'example.com', name: 'a.example.com' });
    await provider.findRecord({ zone: 'example.com', name: 'b.example.com' });
    expect(acquireSpy).toHaveBeenCalledWith('zid');
    expect(acquireSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
