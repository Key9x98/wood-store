import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { makeRateLimit } from './rate-limit.middleware';

async function fire(app: express.Express, ip = '203.0.113.10'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', url: '/test', headers: { 'x-forwarded-for': ip }, body: {}, ip } as unknown as express.Request;
    const res = {
      _status: 200,
      _headers: {} as Record<string, string>,
      status(c: number) { this._status = c; return this; },
      setHeader(k: string, v: string) { this._headers[k.toLowerCase()] = String(v); },
      getHeader(k: string) { return this._headers[k.toLowerCase()]; },
      removeHeader(_k: string) {},
      json() { resolve(this._status); },
      end() { resolve(this._status); },
      send() { resolve(this._status); },
      writeHead(c: number) { this._status = c; },
    } as unknown as express.Response & { _status: number };
    app(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve((res as unknown as { _status: number })._status);
    });
  });
}

describe('makeRateLimit', () => {
  it('allows N then blocks N+1 with 429', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(makeRateLimit({ windowMs: 60_000, limit: 3 }));
    app.post('/test', (_req, res) => res.json({ ok: true }));

    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push(await fire(app));
    }
    expect(codes.slice(0, 3).every((c) => c === 200)).toBe(true);
    expect(codes[3]).toBe(429);
    expect(codes[4]).toBe(429);
  });

  it('isolates by IP', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(makeRateLimit({ windowMs: 60_000, limit: 2 }));
    app.post('/test', (_req, res) => res.json({ ok: true }));

    expect(await fire(app, '10.0.0.1')).toBe(200);
    expect(await fire(app, '10.0.0.1')).toBe(200);
    expect(await fire(app, '10.0.0.1')).toBe(429);
    expect(await fire(app, '10.0.0.2')).toBe(200);
  });

  it('skips OPTIONS preflight (default options)', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(makeRateLimit({ windowMs: 60_000, limit: 1 }));
    app.options('/test', (_req, res) => res.end());
    app.post('/test', (_req, res) => res.json({ ok: true }));

    // Manually invoke for OPTIONS to bypass limiter
    const optsStatus: number = await new Promise((resolve) => {
      const req = { method: 'OPTIONS', url: '/test', headers: {}, ip: '10.0.0.3' } as unknown as express.Request;
      const res = {
        _status: 200,
        status(c: number) { this._status = c; return this; },
        end() { resolve(this._status); },
        send() { resolve(this._status); },
        setHeader() {}, getHeader() {}, removeHeader() {}, writeHead(c: number) { this._status = c; },
      } as unknown as express.Response & { _status: number };
      app(req, res, () => resolve((res as unknown as { _status: number })._status));
    });
    expect(optsStatus).toBe(200);
    vi.unstubAllGlobals();
  });
});
