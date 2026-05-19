import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { SiteProduct } from '@prisma/client';
import { ContentSyncService } from './content-sync.service';
import type { ContentSyncDeps } from './content-sync.service';
import type { IContentRepository } from './content.repository';
import type { IPluginClient } from '../wordpress/plugin-client';

const fakeProduct = (over: Partial<SiteProduct> = {}): SiteProduct => ({
  id: 1,
  siteId: 1,
  slug: 'tu-tho',
  name: 'Tủ thờ',
  shortDescription: 'ngắn',
  description: 'Mô tả',
  regularPrice: 1_000_000,
  salePrice: 800_000,
  salePercent: 20,
  videoUrl: null,
  featured: true,
  attributes: { wood: 'Gỗ Mít' },
  categories: ['tu-tho'],
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
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
  setProductSyncState: vi.fn().mockResolvedValue(fakeProduct()),
  listProducts: vi.fn().mockResolvedValue([]),
  countProducts: vi.fn().mockResolvedValue(0),
  listProductsForSite: vi.fn().mockResolvedValue([]),
  findMedia: vi.fn().mockResolvedValue(null),
  upsertMedia: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const buildClient = (over: Partial<IPluginClient> = {}): IPluginClient => ({
  health: vi.fn().mockResolvedValue(undefined),
  uploadMedia: vi.fn().mockResolvedValue({ id: 20, url: 'https://wp/x.jpg' }),
  upsertProduct: vi.fn().mockResolvedValue({ id: 555 }),
  deleteProduct: vi.fn().mockResolvedValue(undefined),
  flushCache: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const buildDeps = (
  over: Partial<ContentSyncDeps> = {},
  client: IPluginClient = buildClient(),
): ContentSyncDeps => ({
  content: buildRepo(),
  sites: {
    findById: vi
      .fn()
      .mockResolvedValue({ id: 1, domain: 'abc.com', pluginSecretEnc: 'enc-secret' }),
  },
  buildClient: () => client,
  decryptSecret: (s) => s,
  ...over,
});

describe('ContentSyncService.run — upsert', () => {
  it('pushes the product and records the WP post id', async () => {
    const client = buildClient();
    const deps = buildDeps({}, client);
    const svc = new ContentSyncService(deps);

    const r = await svc.run({ siteId: 1, op: 'upsert', productId: 1 });

    expect(r.ok).toBe(true);
    expect(client.upsertProduct).toHaveBeenCalledTimes(1);
    // Payload must match the real plugin contract: category_slugs + meta.
    expect(client.upsertProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'tu-tho',
        category_slugs: ['tu-tho'],
        meta: expect.objectContaining({
          _furniture_wood: 'Gỗ Mít',
          _furniture_sale_percent: 20,
        }),
      }),
    );
    expect(deps.content.setProductSyncState).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ syncStatus: 'synced', wpPostId: 555 }),
    );
  });

  it('dedups media — an image already in site_media is not re-uploaded', async () => {
    const hashA = createHash('sha256').update('https://x/a.jpg').digest('hex');
    const content = buildRepo({
      findProductById: vi
        .fn()
        .mockResolvedValue(fakeProduct({ images: ['https://x/a.jpg', 'https://x/b.jpg'] })),
      findMedia: vi.fn().mockImplementation((_siteId: number, urlHash: string) =>
        Promise.resolve(urlHash === hashA ? { wpAttachmentId: 10 } : null),
      ),
    });
    const client = buildClient();
    const svc = new ContentSyncService(buildDeps({ content }, client));

    const r = await svc.run({ siteId: 1, op: 'upsert', productId: 1 });

    expect(r.ok).toBe(true);
    expect(client.uploadMedia).toHaveBeenCalledTimes(1);
    expect(client.uploadMedia).toHaveBeenCalledWith('https://x/b.jpg');
    expect(client.upsertProduct).toHaveBeenCalledWith(
      expect.objectContaining({ featured_image_id: 10, gallery_ids: [20] }),
    );
  });

  it('marks the product failed and returns an error when the plugin rejects', async () => {
    const client = buildClient({
      upsertProduct: vi.fn().mockRejectedValue(new Error('plugin.error: boom')),
    });
    const deps = buildDeps({}, client);
    const svc = new ContentSyncService(deps);

    const r = await svc.run({ siteId: 1, op: 'upsert', productId: 1 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content_sync.product_sync_failed');
    expect(deps.content.setProductSyncState).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ syncStatus: 'failed' }),
    );
  });
});

describe('ContentSyncService.run — delete', () => {
  it('trashes the WP post and marks the row synced', async () => {
    const client = buildClient();
    const deps = buildDeps({}, client);
    const svc = new ContentSyncService(deps);

    const r = await svc.run({ siteId: 1, op: 'delete', productId: 1 });

    expect(r.ok).toBe(true);
    expect(client.deleteProduct).toHaveBeenCalledWith('tu-tho');
    expect(deps.content.setProductSyncState).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ syncStatus: 'synced' }),
    );
  });

  it('is a no-op success when the product no longer exists', async () => {
    const content = buildRepo({ findProductById: vi.fn().mockResolvedValue(null) });
    const svc = new ContentSyncService(buildDeps({ content }));
    const r = await svc.run({ siteId: 1, op: 'delete', productId: 9 });
    expect(r.ok).toBe(true);
  });
});

describe('ContentSyncService.run — full-resync', () => {
  it('syncs every active product of the site', async () => {
    const content = buildRepo({
      listProductsForSite: vi
        .fn()
        .mockResolvedValue([fakeProduct({ id: 1 }), fakeProduct({ id: 2, slug: 'ban-an' })]),
    });
    const client = buildClient();
    const svc = new ContentSyncService(buildDeps({ content }, client));

    const r = await svc.run({ siteId: 1, op: 'full-resync' });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.synced).toBe(2);
    expect(client.upsertProduct).toHaveBeenCalledTimes(2);
  });
});

describe('ContentSyncService.run — guards', () => {
  it('rejects a site that has not been provisioned (no plugin secret)', async () => {
    const deps = buildDeps({
      sites: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: 1, domain: 'abc.com', pluginSecretEnc: null }),
      },
    });
    const svc = new ContentSyncService(deps);
    const r = await svc.run({ siteId: 1, op: 'full-resync' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content_sync.site_not_provisioned');
  });

  it('errors on an upsert for an unknown product', async () => {
    const content = buildRepo({ findProductById: vi.fn().mockResolvedValue(null) });
    const svc = new ContentSyncService(buildDeps({ content }));
    const r = await svc.run({ siteId: 1, op: 'upsert', productId: 9 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('content_sync.product_not_found');
  });
});
