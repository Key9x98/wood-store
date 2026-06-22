import { describe, it, expect, vi } from 'vitest';
import type { SiteProduct } from '@prisma/client';
import { ContentService, computeSalePercent, slugify } from './content.service';
import type { ISiteAccessLookup, Viewer } from './content.service';
import type { IContentRepository } from './content.repository';
import type { IContentSyncQueue } from '../../queues/content-sync.queue';
import { CreateProductSchema } from './content.schema';

const fakeProduct = (over: Partial<SiteProduct> = {}): SiteProduct => ({
  id: 1,
  siteId: 1,
  slug: 'tu-tho-go-mit',
  name: 'Tủ thờ gỗ Mít',
  shortDescription: null,
  description: 'Mô tả chi tiết',
  regularPrice: 1_000_000,
  salePrice: null,
  salePercent: 0,
  videoUrl: null,
  featured: false,
  attributes: {},
  categories: [],
  images: [],
  status: 'active',
  wpPostId: null,
  syncStatus: 'pending',
  syncError: null,
  syncedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const buildRepo = (over: Partial<IContentRepository> = {}): IContentRepository => ({
  findProductById: vi.fn().mockResolvedValue(fakeProduct()),
  findProductBySlug: vi.fn().mockResolvedValue(null),
  createProduct: vi.fn().mockImplementation((d) => Promise.resolve(fakeProduct(d))),
  updateProduct: vi.fn().mockResolvedValue(fakeProduct()),
  archiveProduct: vi.fn().mockResolvedValue(fakeProduct({ status: 'archived' })),
  setProductSyncState: vi.fn().mockResolvedValue(fakeProduct()),
  listProducts: vi.fn().mockResolvedValue([]),
  countProducts: vi.fn().mockResolvedValue(0),
  listProductsForSite: vi.fn().mockResolvedValue([]),
  findMedia: vi.fn().mockResolvedValue(null),
  upsertMedia: vi.fn(),
  ...over,
});

const buildSites = (over: Partial<ISiteAccessLookup> = {}): ISiteAccessLookup => ({
  findById: vi.fn().mockResolvedValue({ id: 1, ownerId: 1, status: 'active' }),
  ...over,
});

const buildQueue = (): IContentSyncQueue => ({
  enqueue: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
});

const owner: Viewer = { id: 1, role: 'user' };

describe('computeSalePercent', () => {
  it('rounds the discount percentage', () => {
    expect(computeSalePercent(1_000_000, 800_000)).toBe(20);
    expect(computeSalePercent(1_200_000, 999_000)).toBe(17);
  });
  it('is 0 with no sale price or an invalid one', () => {
    expect(computeSalePercent(1_000_000)).toBe(0);
    expect(computeSalePercent(1_000_000, null)).toBe(0);
    expect(computeSalePercent(1_000_000, 1_000_000)).toBe(0);
  });
});

describe('slugify', () => {
  it('strips Vietnamese diacritics', () => {
    expect(slugify('Tủ thờ gỗ Mít chân quỳ')).toBe('tu-tho-go-mit-chan-quy');
    expect(slugify('Bàn ăn gỗ Sồi')).toBe('ban-an-go-soi');
  });
});

describe('CreateProductSchema', () => {
  it('rejects a sale price not below the regular price', () => {
    const r = CreateProductSchema.safeParse({
      name: 'Tủ thờ',
      description: 'd',
      regularPrice: 1000,
      salePrice: 1200,
    });
    expect(r.success).toBe(false);
  });
  it('accepts a valid product', () => {
    const r = CreateProductSchema.safeParse({
      name: 'Tủ thờ',
      description: 'd',
      regularPrice: 1000,
      salePrice: 800,
    });
    expect(r.success).toBe(true);
  });
});

describe('ContentService.createProduct', () => {
  it('creates a pending product and enqueues an upsert sync', async () => {
    const repo = buildRepo();
    const queue = buildQueue();
    const svc = new ContentService(repo, buildSites(), queue);

    const r = await svc.createProduct(
      1,
      { name: 'Tủ thờ gỗ Mít', description: 'd', regularPrice: 1_000_000, salePrice: 800_000 },
      owner,
    );

    expect(r.ok).toBe(true);
    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 1, slug: 'tu-tho-go-mit', salePercent: 20 }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith({ siteId: 1, op: 'upsert', productId: 1 });
  });

  it('rejects a duplicate slug without enqueuing', async () => {
    const repo = buildRepo({ findProductBySlug: vi.fn().mockResolvedValue(fakeProduct()) });
    const queue = buildQueue();
    const svc = new ContentService(repo, buildSites(), queue);

    const r = await svc.createProduct(1, { name: 'Tủ thờ', description: 'd', regularPrice: 1000 }, owner);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content.slug_taken');
    expect(repo.createProduct).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an unknown site', async () => {
    const sites = buildSites({ findById: vi.fn().mockResolvedValue(null) });
    const svc = new ContentService(buildRepo(), sites, buildQueue());
    const r = await svc.createProduct(9, { name: 'Tủ thờ', description: 'd', regularPrice: 1000 }, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content.site_not_found');
  });

  it('forbids a non-owner non-admin', async () => {
    const sites = buildSites({
      findById: vi.fn().mockResolvedValue({ id: 1, ownerId: 99, status: 'active' }),
    });
    const svc = new ContentService(buildRepo(), sites, buildQueue());
    const r = await svc.createProduct(1, { name: 'Tủ thờ', description: 'd', regularPrice: 1000 }, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content.forbidden');
  });
});

describe('ContentService.deleteProduct', () => {
  it('soft-deletes (archive) and enqueues a delete sync', async () => {
    const repo = buildRepo();
    const queue = buildQueue();
    const svc = new ContentService(repo, buildSites(), queue);

    const r = await svc.deleteProduct(1, 1, owner);

    expect(r.ok).toBe(true);
    expect(repo.archiveProduct).toHaveBeenCalledWith(1);
    expect(queue.enqueue).toHaveBeenCalledWith({ siteId: 1, op: 'delete', productId: 1 });
  });

  it('404s when the product belongs to another site', async () => {
    const repo = buildRepo({ findProductById: vi.fn().mockResolvedValue(fakeProduct({ siteId: 2 })) });
    const svc = new ContentService(repo, buildSites(), buildQueue());
    const r = await svc.deleteProduct(1, 1, owner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content.product_not_found');
  });
});

describe('ContentService.updateProduct', () => {
  it('recomputes sale_percent and re-queues a sync', async () => {
    const repo = buildRepo();
    const queue = buildQueue();
    const svc = new ContentService(repo, buildSites(), queue);

    const r = await svc.updateProduct(1, 1, { salePrice: 500_000 }, owner);

    expect(r.ok).toBe(true);
    // existing regularPrice 1_000_000, new salePrice 500_000 → 50%
    expect(repo.updateProduct).toHaveBeenCalledWith(1, expect.objectContaining({ salePercent: 50 }));
    expect(queue.enqueue).toHaveBeenCalledWith({ siteId: 1, op: 'upsert', productId: 1 });
  });

  it('clears the sale price when salePrice is null', async () => {
    const repo = buildRepo();
    const queue = buildQueue();
    const svc = new ContentService(repo, buildSites(), queue);

    const r = await svc.updateProduct(1, 1, { salePrice: null }, owner);

    expect(r.ok).toBe(true);
    expect(repo.updateProduct).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ salePrice: null, salePercent: 0 }),
    );
  });

  it('persists explicit empty arrays so the UI can clear categories/images', async () => {
    const repo = buildRepo();
    const queue = buildQueue();
    const svc = new ContentService(repo, buildSites(), queue);

    const r = await svc.updateProduct(1, 1, { categories: [], images: [], featured: false }, owner);

    expect(r.ok).toBe(true);
    expect(repo.updateProduct).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ categories: [], images: [], featured: false }),
    );
  });
});
