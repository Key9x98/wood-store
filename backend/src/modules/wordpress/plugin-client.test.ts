import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { PluginClient, type PluginFetcher, type ProductUpsertPayload } from './plugin-client';

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function recordingFetcher(
  response: { ok: boolean; status: number; body: string },
): { fetcher: PluginFetcher; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetcher: PluginFetcher = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(response.body),
    });
  };
  return { fetcher, calls };
}

const SECRET = 's3cr3t-per-site';
const FIXED_NOW = 1_700_000_000_000; // → timestamp 1700000000

const sampleProduct: ProductUpsertPayload = {
  slug: 'tu-tho',
  name: 'Tủ thờ',
  description: 'Mô tả',
  regular_price: 1_000_000,
  gallery_ids: [],
  category_slugs: ['tu-tho'],
  meta: { _furniture_sale_percent: 0, _furniture_featured: 0 },
};

afterEach(() => vi.restoreAllMocks());

describe('PluginClient HMAC signing', () => {
  it('signs POST /content/products with the documented message layout', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const { fetcher, calls } = recordingFetcher({
      ok: true,
      status: 200,
      body: JSON.stringify({ ok: true, data: { id: 42 } }),
    });
    const client = new PluginClient({ domain: 'abc.com', secret: SECRET, fetcher });

    const res = await client.upsertProduct(sampleProduct);
    expect(res.id).toBe(42);

    const call = calls[0];
    expect(call.url).toBe(
      'https://abc.com/?rest_route=%2Fai-builder%2Fv1%2Fcontent%2Fproducts',
    );
    expect(call.method).toBe('POST');
    expect(call.headers['X-AIB-Timestamp']).toBe('1700000000');

    const expectedMessage =
      `1700000000\nPOST\n/ai-builder/v1/content/products\n${call.body}`;
    const expectedSig = createHmac('sha256', SECRET).update(expectedMessage).digest('hex');
    expect(call.headers['X-AIB-Signature']).toBe(expectedSig);
  });

  it('signs DELETE with an empty body and url-encodes the slug', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    const { fetcher, calls } = recordingFetcher({
      ok: true,
      status: 200,
      body: JSON.stringify({ ok: true }),
    });
    const client = new PluginClient({ domain: 'abc.com', secret: SECRET, fetcher });

    await client.deleteProduct('tu-tho');

    const call = calls[0];
    expect(call.method).toBe('DELETE');
    expect(call.body).toBeUndefined();
    const expectedMessage = `1700000000\nDELETE\n/ai-builder/v1/content/products/tu-tho\n`;
    const expectedSig = createHmac('sha256', SECRET).update(expectedMessage).digest('hex');
    expect(call.headers['X-AIB-Signature']).toBe(expectedSig);
  });

  it('uses http when the protocol option is set', async () => {
    const { fetcher, calls } = recordingFetcher({
      ok: true,
      status: 200,
      body: JSON.stringify({ ok: true }),
    });
    const client = new PluginClient({
      domain: 'dev.local',
      secret: SECRET,
      protocol: 'http',
      fetcher,
    });
    await client.flushCache();
    expect(calls[0].url).toBe(
      'http://dev.local/?rest_route=%2Fai-builder%2Fv1%2Fcache%2Fflush',
    );
  });
});

describe('PluginClient error handling', () => {
  it('throws when the envelope reports ok:false', async () => {
    const { fetcher } = recordingFetcher({
      ok: true,
      status: 200,
      body: JSON.stringify({ ok: false, error: { code: 'bad_request', message: 'nope' } }),
    });
    const client = new PluginClient({ domain: 'abc.com', secret: SECRET, fetcher });
    await expect(client.upsertProduct(sampleProduct)).rejects.toThrow('bad_request');
  });

  it('throws on a non-2xx HTTP status', async () => {
    const { fetcher } = recordingFetcher({ ok: false, status: 500, body: '' });
    const client = new PluginClient({ domain: 'abc.com', secret: SECRET, fetcher });
    await expect(client.flushCache()).rejects.toThrow('plugin.error');
  });
});
