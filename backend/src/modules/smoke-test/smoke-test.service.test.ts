import { describe, it, expect, vi } from 'vitest';
import { SmokeTestService, type Fetcher } from './smoke-test.service';

const mockFetcher = (resp: { ok: boolean; status: number }): Fetcher =>
  vi.fn(async () => ({ ok: resp.ok, status: resp.status, text: async () => '' })) as Fetcher;

describe('SmokeTestService.check', () => {
  it('resolves on HTTP 200', async () => {
    const fetcher = mockFetcher({ ok: true, status: 200 });
    const svc = new SmokeTestService({ fetcher });
    await expect(svc.check('abc.example.com')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'https://abc.example.com/',
      expect.anything(),
    );
  });

  it('throws on non-2xx', async () => {
    const fetcher = mockFetcher({ ok: false, status: 503 });
    const svc = new SmokeTestService({ fetcher });
    await expect(svc.check('abc.example.com')).rejects.toThrow(/HTTP 503/);
  });

  it('uses http protocol when configured', async () => {
    const fetcher = mockFetcher({ ok: true, status: 200 });
    const svc = new SmokeTestService({ fetcher, protocol: 'http' });
    await svc.check('abc.example.com');
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('http://abc.example.com'),
      expect.anything(),
    );
  });
});
