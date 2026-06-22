import type { Prisma, SiteProduct } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { IContentSyncQueue } from '../../queues/content-sync.queue';
import type {
  IContentRepository,
  ProductCreateData,
  ProductUpdateData,
} from './content.repository';
import type {
  BulkImportInput,
  CreateProductInput,
  ListProductsInput,
  UpdateProductInput,
} from './content.schema';

/** Narrow site lookup for ownership checks — satisfied by SiteRepository. */
export interface ISiteAccessLookup {
  findById(id: number): Promise<{ id: number; ownerId: number; status: string } | null>;
}

export interface Viewer {
  id: number;
  role: string;
}

export interface BulkImportResult {
  created: number;
  updated: number;
}

/** Derive a URL-safe slug, handling Vietnamese diacritics. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return base || `product-${Date.now()}`;
}

/** sale_percent is derived in Express, never trusted from WordPress. */
export function computeSalePercent(regularPrice: number, salePrice?: number | null): number {
  if (!salePrice || salePrice >= regularPrice) return 0;
  return Math.round(((regularPrice - salePrice) / regularPrice) * 100);
}

export class ContentService {
  constructor(
    private repo: IContentRepository,
    private sites: ISiteAccessLookup,
    private queue: IContentSyncQueue,
  ) {}

  private async assertSiteAccess(
    siteId: number,
    viewer: Viewer,
  ): Promise<Result<{ id: number; ownerId: number; status: string }, AppError>> {
    const site = await this.sites.findById(siteId);
    if (!site) return err(new AppError('content.site_not_found', 404));
    if (viewer.role !== 'admin' && site.ownerId !== viewer.id) {
      return err(new AppError('content.forbidden', 403));
    }
    return ok(site);
  }

  private buildCreateData(siteId: number, slug: string, input: CreateProductInput): ProductCreateData {
    return {
      siteId,
      slug,
      name: input.name,
      shortDescription: input.shortDescription ?? null,
      description: input.description,
      regularPrice: input.regularPrice,
      salePrice: input.salePrice ?? null,
      salePercent: computeSalePercent(input.regularPrice, input.salePrice),
      videoUrl: input.videoUrl ?? null,
      featured: input.featured ?? false,
      attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
      categories: (input.categories ?? []) as Prisma.InputJsonValue,
      images: (input.images ?? []) as Prisma.InputJsonValue,
    };
  }

  async createProduct(
    siteId: number,
    input: CreateProductInput,
    viewer: Viewer,
  ): Promise<Result<SiteProduct, AppError>> {
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;

    const slug = input.slug ?? slugify(input.name);
    const clash = await this.repo.findProductBySlug(siteId, slug);
    if (clash) return err(new AppError('content.slug_taken', 409, { slug }));

    const product = await this.repo.createProduct(this.buildCreateData(siteId, slug, input));
    await this.queue.enqueue({ siteId, op: 'upsert', productId: product.id });
    return ok(product);
  }

  async updateProduct(
    siteId: number,
    productId: number,
    input: UpdateProductInput,
    viewer: Viewer,
  ): Promise<Result<SiteProduct, AppError>> {
    const product = await this.repo.findProductById(productId);
    if (!product || product.siteId !== siteId) {
      return err(new AppError('content.product_not_found', 404));
    }
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;

    const regularPrice = input.regularPrice ?? product.regularPrice;
    // Distinguish `undefined` (keep current) from `null` (clear discount); `??`
    // would collapse both, leaving sale_percent stale when the UI clears sale.
    const salePrice =
      input.salePrice !== undefined ? input.salePrice : product.salePrice;

    const patch: ProductUpdateData = { salePercent: computeSalePercent(regularPrice, salePrice) };
    if (input.name !== undefined) patch.name = input.name;
    if (input.shortDescription !== undefined) patch.shortDescription = input.shortDescription;
    if (input.description !== undefined) patch.description = input.description;
    if (input.regularPrice !== undefined) patch.regularPrice = input.regularPrice;
    if (input.salePrice !== undefined) patch.salePrice = input.salePrice;
    if (input.videoUrl !== undefined) patch.videoUrl = input.videoUrl;
    if (input.featured !== undefined) patch.featured = input.featured;
    if (input.attributes !== undefined) patch.attributes = input.attributes as Prisma.InputJsonValue;
    if (input.categories !== undefined) patch.categories = input.categories as Prisma.InputJsonValue;
    if (input.images !== undefined) patch.images = input.images as Prisma.InputJsonValue;

    const updated = await this.repo.updateProduct(productId, patch);
    await this.queue.enqueue({ siteId, op: 'upsert', productId });
    return ok(updated);
  }

  async deleteProduct(
    siteId: number,
    productId: number,
    viewer: Viewer,
  ): Promise<Result<true, AppError>> {
    const product = await this.repo.findProductById(productId);
    if (!product || product.siteId !== siteId) {
      return err(new AppError('content.product_not_found', 404));
    }
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;

    // Soft delete: keep the row for audit/restore; the sync job trashes the
    // WordPress post (docs/site-management.md §4.4).
    await this.repo.archiveProduct(productId);
    await this.queue.enqueue({ siteId, op: 'delete', productId });
    return ok(true);
  }

  async getProduct(
    siteId: number,
    productId: number,
    viewer: Viewer,
  ): Promise<Result<SiteProduct, AppError>> {
    const product = await this.repo.findProductById(productId);
    if (!product || product.siteId !== siteId) {
      return err(new AppError('content.product_not_found', 404));
    }
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;
    return ok(product);
  }

  async listProducts(
    siteId: number,
    input: ListProductsInput,
    viewer: Viewer,
  ): Promise<Result<{ items: SiteProduct[]; total: number }, AppError>> {
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;
    const [items, total] = await Promise.all([
      this.repo.listProducts({
        siteId,
        limit: input.limit,
        offset: input.offset,
        status: input.status,
        syncStatus: input.syncStatus,
      }),
      this.repo.countProducts({ siteId, status: input.status, syncStatus: input.syncStatus }),
    ]);
    return ok({ items, total });
  }

  /**
   * Upsert many products by slug, then trigger a single full-resync. Idempotent:
   * re-importing the same payload updates rows in place (docs/furniture-template.md §10).
   */
  async bulkImport(
    siteId: number,
    input: BulkImportInput,
    viewer: Viewer,
  ): Promise<Result<BulkImportResult, AppError>> {
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;

    let created = 0;
    let updated = 0;
    for (const item of input.products) {
      const slug = item.slug ?? slugify(item.name);
      const existing = await this.repo.findProductBySlug(siteId, slug);
      if (existing) {
        await this.repo.updateProduct(existing.id, {
          name: item.name,
          shortDescription: item.shortDescription ?? null,
          description: item.description,
          regularPrice: item.regularPrice,
          salePrice: item.salePrice ?? null,
          salePercent: computeSalePercent(item.regularPrice, item.salePrice),
          videoUrl: item.videoUrl ?? null,
          featured: item.featured ?? false,
          attributes: (item.attributes ?? {}) as Prisma.InputJsonValue,
          categories: (item.categories ?? []) as Prisma.InputJsonValue,
          images: (item.images ?? []) as Prisma.InputJsonValue,
        });
        updated += 1;
      } else {
        await this.repo.createProduct(this.buildCreateData(siteId, slug, item));
        created += 1;
      }
    }
    await this.queue.enqueue({ siteId, op: 'full-resync' });
    return ok({ created, updated });
  }

  /** Re-push every active product of a site to WordPress (reconciliation). */
  async resync(siteId: number, viewer: Viewer): Promise<Result<{ jobId: string }, AppError>> {
    const access = await this.assertSiteAccess(siteId, viewer);
    if (!access.ok) return access;
    const job = await this.queue.enqueue({ siteId, op: 'full-resync' });
    return ok(job);
  }
}
