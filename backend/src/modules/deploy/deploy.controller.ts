import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';
import { deployService } from './deploy.module';

export async function deployTheme(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) return next(new AppError('auth.not_authenticated', 401));
  const siteId = Number(req.params.siteId);
  if (!Number.isInteger(siteId) || siteId <= 0) {
    return next(new AppError('deploy.invalid_site_id', 400));
  }
  const r = await deployService.requestThemeDeploy(siteId, {
    id: req.user.id,
    role: req.user.role,
  });
  if (!r.ok) return next(r.error);
  res.status(202).json({ data: r.value });
}
