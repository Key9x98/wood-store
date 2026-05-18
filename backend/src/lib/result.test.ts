import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr } from './result';

describe('Result', () => {
  it('ok carries value', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err carries error', () => {
    const e = new Error('boom');
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(e);
  });

  it('type guards', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('x'))).toBe(true);
  });
});
