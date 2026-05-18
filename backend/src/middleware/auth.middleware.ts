import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { verifyAccess, type Role } from '../lib/jwt';

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authRequired(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('auth.missing_token', 401));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccess(token);
    req.user = {
      id: Number(payload.sub),
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (_e) {
    next(new AppError('auth.invalid_token', 401));
  }
}

export function role(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AppError('auth.not_authenticated', 401));
    if (!allowed.includes(req.user.role)) {
      return next(new AppError('auth.forbidden', 403, { required: allowed }));
    }
    next();
  };
}
