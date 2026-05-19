import { createHash } from 'node:crypto';
import type { SiteProduct } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { ContentSyncJobPayload } from '../../queues/content-sync.queue';
import type { IPluginClient, PluginClientContext } from '../wordpress/plugin-client';
import type { IContentRepository } from './content.repository';

/** Narrow site lookup — needs the domain + encrypted plugin secret. */
export interface ISiteSecretLookup {
  findById(
    id: number,
  ): Promise<{ id: number; domain: string; pluginSecretEnc: string | null } | null>;
}

export interface ContentSyncDeps {
  content: IContentRepository;
  sites: ISiteSecretLookup;
  buildClient: (ctx: PluginClientContext) => IPluginClient;
  decryptSecret: (enc: string) => string;
}

export interface ContentSyncSummary {
  synced: number;
  deleted: number;
  failed: number;
}

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export class ContentSyncService {
  constructor(private deps: ContentSyncDeps) {}

  /**
   * Push canonical content from cms_core to a WordPress site via the plugin.
   * Returns a Result — the worker rethrows on error so BullMQ retries.
   */
  async run(payload: ContentSyncJobPayload): Promise<Result<ContentSyncSummary, AppError>> {
    const site = await this.deps.sites.findById(payload.siteId);
    if (!site) return err(new AppError('content_sync.site_not_found', 404));
    if (!site.pluginSecretEnc) {
      return err(new AppError('content_sync.site_not_provisioned', 409));
    }

    let secret: string;
    try {
      secret = this.deps.decryptSecret(site.pluginSecretEnc);
    } catch {
      return err(new AppError('content_sync.secret_decrypt_failed', 500));
    }
    const client = this.deps.buildClient({ domain: site.domain, secret });

    if (payload.op === 'full-resync') {
      return this.fullResync(client, payload.siteId);
    }

    if (!payload.productId) {
      return err(new AppError('content_sync.missing_product_id', 400));
    }
    const product = await this.deps.content.findProductById(payload.productId);
    if (!product) {
      // Deleting an already-removed product is a successful no-op.
      if (payload.op === 'delete') return ok({ synced: 0, deleted: 0, failed: 0 });
      return err(new AppError('content_sync.product_not_found', 404));
    }

    if (payload.op === 'delete' || product.status === 'archived') {
      return this.deleteOne(client, product);
    }
    return this.upsertOne(client, product);
  }

  private async fullResync(
    client: IPluginClient,
    siteId: number,
  ): Promise<Result<ContentSyncSummary, AppError>> {
    const products = await this.deps.content.listProductsForSite(siteId, 'active');
    let synced = 0;
    let failed = 0;
    for (const product of products) {
      try {
        await this.syncProduct(client, product);
        synced += 1;
      } catch {
        // syncProduct already marked this product 'failed' in cms_core.
        failed += 1;
      }
    }
    await client.flushCache().catch(() => undefined);
    const summary: ContentSyncSummary = { synced, deleted: 0, failed };
    if (failed > 0) {
      return err(new AppError('content_sync.partial_failure', 502, summary));
    }
    return ok(summary);
  }

  private async upsertOne(
    client: IPluginClient,
    product: SiteProduct,
  ): Promise<Result<ContentSyncSummary, AppError>> {
    try {
      await this.syncProduct(client, product);
    } catch (e) {
      return err(
        new AppError('content_sync.product_sync_failed', 502, {
          productId: product.id,
          reason: e instanceof Error ? e.message : String(e),
        }),
      );
    }
    await client.flushCache().catch(() => undefined);
    return ok({ synced: 1, deleted: 0, failed: 0 });
  }

  private async deleteOne(
    client: IPluginClient,
    product: SiteProduct,
  ): Promise<Result<ContentSyncSummary, AppError>> {
    try {
      await client.deleteProduct(product.slug);
    } catch (e) {
      await this.deps.content.setProductSyncState(product.id, {
        syncStatus: 'failed',
        syncError: e instanceof Error ? e.message : String(e),
      });
      return err(new AppError('content_sync.product_delete_failed', 502, { productId: product.id }));
    }
    await this.deps.content.setProductSyncState(product.id, {
      syncStatus: 'synced',
      syncError: null,
      syncedAt: new Date(),
    });
    await client.flushCache().catch(() => undefined);
    return ok({ synced: 0, deleted: 1, failed: 0 });
  }

  /** Upsert one product onto WordPress. Throws on failure (caller handles). */
  private async syncProduct(client: IPluginClient, product: SiteProduct): Promise<void> {
    await this.deps.content.setProductSyncState(product.id, { syncStatus: 'syncing' });
    try {
      const imageUrls = Array.isArray(product.images) ? (product.images as string[]) : [];
      const attachmentIds: number[] = [];
      for (const url of imageUrls) {
        attachmentIds.push(await this.ensureMedia(client, product.siteId, url));
      }

      const result = await client.upsertProduct({
        slug: product.slug,
        name: product.name,
        short_description: product.shortDescription ?? undefined,
        description: product.description,
        regular_price: product.regularPrice,
        sale_price: product.salePrice ?? undefined,
        featured_image_id: attachmentIds[0],
        gallery_ids: attachmentIds.slice(1),
        category_slugs: Array.isArray(product.categories)
          ? (product.categories as string[])
          : [],
        meta: this.buildProductMeta(product),
      });

      await this.deps.content.setProductSyncState(product.id, {
        syncStatus: 'synced',
        wpPostId: result.id,
        syncError: null,
        syncedAt: new Date(),
      });
    } catch (e) {
      await this.deps.content.setProductSyncState(product.id, {
        syncStatus: 'failed',
        syncError: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  /**
   * Resolve a source image URL to a WordPress attachment id. Deduped via
   * site_media so a re-sync never re-uploads the same image.
   */
  private async ensureMedia(
    client: IPluginClient,
    siteId: number,
    sourceUrl: string,
  ): Promise<number> {
    const urlHash = sha256Hex(sourceUrl);
    const existing = await this.deps.content.findMedia(siteId, urlHash);
    if (existing?.wpAttachmentId) return existing.wpAttachmentId;

    const uploaded = await client.uploadMedia(sourceUrl);
    await this.deps.content.upsertMedia({
      siteId,
      sourceUrl,
      urlHash,
      wpAttachmentId: uploaded.id,
      wpUrl: uploaded.url,
    });
    return uploaded.id;
  }

  /**
   * Pack derived + furniture-specific data into WordPress post-meta. The plugin
   * only persists `meta` key/values it receives — see docs/furniture-template.md
   * §5 for the `_furniture_*` key mapping the theme reads.
   */
  private buildProductMeta(product: SiteProduct): Record<string, string | number> {
    const meta: Record<string, string | number> = {
      _furniture_sale_percent: product.salePercent,
      _furniture_featured: product.featured ? 1 : 0,
    };
    if (product.videoUrl) meta._furniture_video_url = product.videoUrl;

    const attrKeyToMeta: Record<string, string> = {
      wood: '_furniture_wood',
      finish: '_furniture_finish',
      style: '_furniture_style',
      color: '_furniture_color',
      dimensions: '_furniture_dimensions',
      weightKg: '_furniture_weight_kg',
      origin: '_furniture_origin',
      craftNotes: '_furniture_craft_notes',
      warrantyMonths: '_furniture_warranty_months',
    };
    const attrs = this.asObject(product.attributes);
    for (const [attrKey, metaKey] of Object.entries(attrKeyToMeta)) {
      const value = attrs[attrKey];
      if (typeof value === 'string' || typeof value === 'number') {
        meta[metaKey] = value;
      }
    }
    return meta;
  }

  private asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
