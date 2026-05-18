import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Rate limiter for sensitive auth endpoints (login + refresh).
 * Keyed by client IP via the default `req.ip`. Skip CORS preflights.
 */
const authRateLimitOptions: Partial<Options> = {
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'auth.rate_limited',
        message: 'Too many requests; please retry after the Retry-After window.',
      },
    });
  },
};

export const authRateLimit = rateLimit(authRateLimitOptions);

/** Factory for tests / per-route customization. */
export function makeRateLimit(overrides: Partial<Options> = {}) {
  return rateLimit({ ...authRateLimitOptions, ...overrides });
}
