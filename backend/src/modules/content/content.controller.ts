import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';
import {
  BulkImportSchema,
  CreateProductSchema,
  ListProductsSchema,
  UpdateProductSchema,
} from './content.schema';
import { contentService } from './content.module';
import type { Viewer } from './content.service';

function parseId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function viewerOf(req: Request): Viewer | null {
  return req.user ? { id: req.user.id, role: req.user.role } : null;
}

export async function listProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  if (siteId === null) return next(new AppError('content.invalid_site_id', 400));
  const parsed = ListProductsSchema.safeParse(req.query);
  if (!parsed.success) return next(new AppError('content.invalid_query', 400, parsed.error.format()));
  const r = await contentService.listProducts(siteId, parsed.data, viewer);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value.items, total: r.value.total });
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  if (siteId === null) return next(new AppError('content.invalid_site_id', 400));
  const parsed = CreateProductSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('content.invalid_input', 400, parsed.error.format()));
  const r = await contentService.createProduct(siteId, parsed.data, viewer);
  if (!r.ok) return next(r.error);
  res.status(201).json({ data: r.value });
}

export async function getProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  const productId = parseId(req.params.productId);
  if (siteId === null || productId === null) {
    return next(new AppError('content.invalid_id', 400));
  }
  const r = await contentService.getProduct(siteId, productId, viewer);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  const productId = parseId(req.params.productId);
  if (siteId === null || productId === null) {
    return next(new AppError('content.invalid_id', 400));
  }
  const parsed = UpdateProductSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('content.invalid_input', 400, parsed.error.format()));
  const r = await contentService.updateProduct(siteId, productId, parsed.data, viewer);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  const productId = parseId(req.params.productId);
  if (siteId === null || productId === null) {
    return next(new AppError('content.invalid_id', 400));
  }
  const r = await contentService.deleteProduct(siteId, productId, viewer);
  if (!r.ok) return next(r.error);
  res.status(204).end();
}

export async function bulkImport(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  if (siteId === null) return next(new AppError('content.invalid_site_id', 400));
  const parsed = BulkImportSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('content.invalid_input', 400, parsed.error.format()));
  const r = await contentService.bulkImport(siteId, parsed.data, viewer);
  if (!r.ok) return next(r.error);
  res.status(202).json({ data: r.value });
}

export async function resyncSite(req: Request, res: Response, next: NextFunction): Promise<void> {
  const viewer = viewerOf(req);
  if (!viewer) return next(new AppError('auth.not_authenticated', 401));
  const siteId = parseId(req.params.siteId);
  if (siteId === null) return next(new AppError('content.invalid_site_id', 400));
  const r = await contentService.resync(siteId, viewer);
  if (!r.ok) return next(r.error);
  res.status(202).json({ data: r.value });
}
