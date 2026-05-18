import { describe, it, expect } from 'vitest';
import { buildCorsOptions } from './cors';

describe('buildCorsOptions', () => {
  it('wildcard yields permissive origin: true', () => {
    expect(buildCorsOptions('*')).toEqual({ origin: true });
    expect(buildCorsOptions('https://foo.com,*,https://bar.com')).toEqual({ origin: true });
  });

  it('explicit list emits array + credentials', () => {
    expect(
      buildCorsOptions('https://dashboard.example.com,https://admin.example.com'),
    ).toEqual({
      origin: ['https://dashboard.example.com', 'https://admin.example.com'],
      credentials: true,
    });
  });

  it('trims whitespace and drops empty values', () => {
    expect(buildCorsOptions(' https://a.com , , https://b.com ')).toEqual({
      origin: ['https://a.com', 'https://b.com'],
      credentials: true,
    });
  });

  it('empty string yields empty allowlist (deny all)', () => {
    expect(buildCorsOptions('')).toEqual({ origin: [], credentials: true });
  });
});
