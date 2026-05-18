import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';
import { LoginSchema, RefreshSchema } from './auth.schema';
import { authService } from './auth.module';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('auth.invalid_input', 400, parsed.error.format()));
  const r = await authService.login(parsed.data.email, parsed.data.password);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('auth.invalid_input', 400, parsed.error.format()));
  const r = await authService.refresh(parsed.data.refreshToken);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}
