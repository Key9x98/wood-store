import { describe, it, expect } from 'vitest';
import pino from 'pino';

/**
 * Verify the redact path list censors all known sensitive fields. We instantiate
 * an isolated pino logger with the same paths used in production (kept in sync
 * with src/config/logger.ts) and assert that no plaintext secret leaks.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-aib-signature"]',
  'req.headers["x-aib-timestamp"]',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.signature',
  '*.apiKey',
  '*.dbPassword',
  '*.db_password',
  '*.dbPasswordEnc',
  '*.pluginSecret',
  '*.plugin_secret',
  '*.pluginSecretEnc',
  '*.JWT_SECRET',
  '*.SECRET_ENCRYPTION_KEY',
  '*.CLOUDFLARE_API_TOKEN',
];

function captureLog(input: object): string {
  const captured: string[] = [];
  const stream = { write: (s: string) => captured.push(s) };
  const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
  log.info(input, 'event');
  return captured.join('');
}

describe('Logger redaction', () => {
  it.each([
    ['password', 'hunter2'],
    ['passwordHash', 'bcrypt$abc'],
    ['token', 'eyJraWQ='],
    ['accessToken', 'eyJraWQ='],
    ['refreshToken', 'rtk_123'],
    ['secret', 'super-secret'],
    ['signature', 'deadbeef'],
    ['apiKey', 'sk_live_xxx'],
    ['dbPassword', 'p@ss'],
    ['dbPasswordEnc', 'enc:base64'],
    ['pluginSecret', 'plg-secret'],
    ['pluginSecretEnc', 'enc:plg'],
    ['JWT_SECRET', 'jwt-secret'],
    ['SECRET_ENCRYPTION_KEY', 'a'.repeat(64)],
    ['CLOUDFLARE_API_TOKEN', 'cf-token-leak'],
  ])('redacts %s', (key, value) => {
    const line = captureLog({ payload: { [key]: value } });
    expect(line).not.toContain(value);
    expect(line).toContain('[REDACTED]');
  });

  it('redacts authorization header', () => {
    const line = captureLog({ req: { headers: { authorization: 'Bearer secret-jwt' } } });
    expect(line).not.toContain('secret-jwt');
    expect(line).toContain('[REDACTED]');
  });

  it('does NOT redact innocuous fields', () => {
    const line = captureLog({ email: 'a@b.com', userId: 42 });
    expect(line).toContain('a@b.com');
    expect(line).toContain('42');
  });
});
