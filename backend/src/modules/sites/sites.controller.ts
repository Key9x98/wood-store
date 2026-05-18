import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';
import { CreateSiteSchema, ListSitesSchema } from './sites.schema';
import { sitesService } from './sites.module';

export async function createSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next(new AppError('auth.not_authenticated', 401));
  const parsed = CreateSiteSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('sites.invalid_input', 400, parsed.error.format()));
  const r = await sitesService.create(parsed.data, req.user.id);
  if (!r.ok) return next(r.error);
  res.status(201).json({ data: r.value });
}

export async function listSites(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next(new AppError('auth.not_authenticated', 401));
  const parsed = ListSitesSchema.safeParse(req.query);
  if (!parsed.success) return next(new AppError('sites.invalid_query', 400, parsed.error.format()));
  const result = await sitesService.list(parsed.data, req.user);
  res.json({ data: result.items, total: result.total });
}

export async function getSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next(new AppError('auth.not_authenticated', 401));
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('sites.invalid_id', 400));
  const r = await sitesService.findById(id, req.user);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function deleteSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next(new AppError('auth.not_authenticated', 401));
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('sites.invalid_id', 400));
  const r = await sitesService.remove(id, req.user);
  if (!r.ok) return next(r.error);
  res.status(204).end();
}
