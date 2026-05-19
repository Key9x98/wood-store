import type { PrismaClient, Prisma, SiteProduct, SiteMedia } from '@prisma/client';

export interface ProductCreateData {
  siteId: number;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string;
  regularPrice: number;
  salePrice: number | null;
  salePercent: number;
  videoUrl: string | null;
  featured: boolean;
  attributes: Prisma.InputJsonValue;
  categories: Prisma.InputJsonValue;
  images: Prisma.InputJsonValue;
}

export interface ProductUpdateData {
  name?: string;
  shortDescription?: string | null;
  description?: string;
  regularPrice?: number;
  salePrice?: number | null;
  salePercent?: number;
  videoUrl?: string | null;
  featured?: boolean;
  attributes?: Prisma.InputJsonValue;
  categories?: Prisma.InputJsonValue;
  images?: Prisma.InputJsonValue;
}

export interface ProductSyncState {
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  wpPostId?: number;
  syncError?: string | null;
  syncedAt?: Date;
}

export interface ListProductsOpts {
  siteId: number;
  limit: number;
  offset: number;
  status?: string;
  syncStatus?: string;
}

export interface MediaUpsertData {
  siteId: number;
  sourceUrl: string;
  urlHash: string;
  wpAttachmentId: number;
  wpUrl: string;
}

export interface IContentRepository {
  findProductById(id: number): Promise<SiteProduct | null>;
  findProductBySlug(siteId: number, slug: string): Promise<SiteProduct | null>;
  createProduct(data: ProductCreateData): Promise<SiteProduct>;
  updateProduct(id: number, patch: ProductUpdateData): Promise<SiteProduct>;
  /** Sets status='archived' + sync_status='pending' (soft delete). */
  archiveProduct(id: number): Promise<SiteProduct>;
  setProductSyncState(id: number, state: ProductSyncState): Promise<SiteProduct>;
  listProducts(opts: ListProductsOpts): Promise<SiteProduct[]>;
  countProducts(opts: Pick<ListProductsOpts, 'siteId' | 'status' | 'syncStatus'>): Promise<number>;
  /** Active products of a site — used by full-resync. */
  listProductsForSite(siteId: number, status?: string): Promise<SiteProduct[]>;

  findMedia(siteId: number, urlHash: string): Promise<SiteMedia | null>;
  upsertMedia(data: MediaUpsertData): Promise<SiteMedia>;
}

export class ContentRepository implements IContentRepository {
  constructor(private db: PrismaClient) {}

  findProductById(id: number) {
    return this.db.siteProduct.findUnique({ where: { id } });
  }

  findProductBySlug(siteId: number, slug: string) {
    return this.db.siteProduct.findUnique({
      where: { siteId_slug: { siteId, slug } },
    });
  }

  createProduct(data: ProductCreateData) {
    return this.db.siteProduct.create({ data });
  }

  updateProduct(id: number, patch: ProductUpdateData) {
    // A content edit always re-queues a sync — reset the projection state.
    return this.db.siteProduct.update({
      where: { id },
      data: { ...patch, syncStatus: 'pending', syncError: null },
    });
  }

  archiveProduct(id: number) {
    return this.db.siteProduct.update({
      where: { id },
      data: { status: 'archived', syncStatus: 'pending', syncError: null },
    });
  }

  setProductSyncState(id: number, state: ProductSyncState) {
    return this.db.siteProduct.update({
      where: { id },
      data: {
        syncStatus: state.syncStatus,
        ...(state.wpPostId !== undefined ? { wpPostId: state.wpPostId } : {}),
        ...(state.syncError !== undefined ? { syncError: state.syncError } : {}),
        ...(state.syncedAt !== undefined ? { syncedAt: state.syncedAt } : {}),
      },
    });
  }

  listProducts(opts: ListProductsOpts) {
    return this.db.siteProduct.findMany({
      where: { siteId: opts.siteId, status: opts.status, syncStatus: opts.syncStatus },
      take: opts.limit,
      skip: opts.offset,
      orderBy: { id: 'desc' },
    });
  }

  countProducts(opts: Pick<ListProductsOpts, 'siteId' | 'status' | 'syncStatus'>) {
    return this.db.siteProduct.count({
      where: { siteId: opts.siteId, status: opts.status, syncStatus: opts.syncStatus },
    });
  }

  listProductsForSite(siteId: number, status = 'active') {
    return this.db.siteProduct.findMany({
      where: { siteId, status },
      orderBy: { id: 'asc' },
    });
  }

  findMedia(siteId: number, urlHash: string) {
    return this.db.siteMedia.findUnique({
      where: { siteId_urlHash: { siteId, urlHash } },
    });
  }

  upsertMedia(data: MediaUpsertData) {
    return this.db.siteMedia.upsert({
      where: { siteId_urlHash: { siteId: data.siteId, urlHash: data.urlHash } },
      create: data,
      update: { wpAttachmentId: data.wpAttachmentId, wpUrl: data.wpUrl },
    });
  }
}
