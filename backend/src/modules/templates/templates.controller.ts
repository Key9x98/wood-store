import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';
import { ImportTemplateSchema, ListTemplatesSchema } from './templates.schema';
import { templatesService } from './templates.module';

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) return next(new AppError('auth.not_authenticated', 401));
  const parsed = ListTemplatesSchema.safeParse(req.query);
  if (!parsed.success) return next(new AppError('templates.invalid_query', 400, parsed.error.format()));
  const result = await templatesService.list(parsed.data, req.user.role);
  res.json({ data: result.items, total: result.total });
}

export async function getTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('templates.invalid_id', 400));
  const r = await templatesService.findById(id);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function importTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = ImportTemplateSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('templates.invalid_input', 400, parsed.error.format()));
  const r = await templatesService.startImport(parsed.data);
  if (!r.ok) return next(r.error);
  res.status(202).json({ data: r.value });
}

export async function deleteTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('templates.invalid_id', 400));
  const r = await templatesService.remove(id);
  if (!r.ok) return next(r.error);
  res.status(204).end();
}
