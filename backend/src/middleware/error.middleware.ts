import type { Request, Response, NextFunction } from 'express';
import { isAppError } from '../lib/errors';
import { logger } from '../config/logger';

export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const log = logger.child({ requestId: req.requestId });

  if (isAppError(err)) {
    log.warn({ code: err.code, status: err.status }, 'app_error');
    res.status(err.status).json({
      error: { code: err.code, message: err.message, detail: err.detail },
    });
    return;
  }

  log.error({ err }, 'unhandled_error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Internal Server Error' },
  });
}
