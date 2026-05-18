import pino from 'pino';
import { env } from './env';

/**
 * Redaction paths: anything matching is replaced with [REDACTED] before serialization.
 * Use both top-level and wildcard paths to catch nested objects.
 */
const REDACT_PATHS = [
  // HTTP
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-aib-signature"]',
  'req.headers["x-aib-timestamp"]',
  'headers.authorization',
  'headers.cookie',
  // Generic secret-like fields
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.signature',
  '*.apiKey',
  // Site / plugin specifics
  '*.dbPassword',
  '*.db_password',
  '*.dbPasswordEnc',
  '*.pluginSecret',
  '*.plugin_secret',
  '*.pluginSecretEnc',
  // Env dumps must never leak the encryption key or JWT secret
  '*.JWT_SECRET',
  '*.SECRET_ENCRYPTION_KEY',
  '*.CLOUDFLARE_API_TOKEN',
];

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});

export type Logger = typeof logger;
