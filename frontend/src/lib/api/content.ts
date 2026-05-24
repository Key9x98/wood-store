import { api } from '@/lib/api';
import type { ItemResponse, ListResponse, SiteProduct } from '@/lib/types';

export interface ListProductsParams {
  limit?: number;
  offset?: number;
  status?: 'active' | 'archived';
  syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';
}

/** Canonical product payload sent to the backend (cms_core is the source of truth). */
export interface ProductInput {
  name: string;
  description: string;
  shortDescription?: string;
  regularPrice: number;
  salePrice?: number;
  slug?: string;
  videoUrl?: string;
  featured?: boolean;
  attributes?: Record<string, unknown>;
  categories?: string[];
  images?: string[];
}

export async function listProducts(
  siteId: number,
  params: ListProductsParams = {},
): Promise<ListResponse<SiteProduct>> {
  const res = await api.get<ListResponse<SiteProduct>>(`/sites/${siteId}/products`, { params });
  return res.data;
}

export async function createProduct(siteId: number, input: ProductInput): Promise<SiteProduct> {
  const res = await api.post<ItemResponse<SiteProduct>>(`/sites/${siteId}/products`, input);
  return res.data.data;
}

export async function deleteProduct(siteId: number, productId: number): Promise<void> {
  await api.delete(`/sites/${siteId}/products/${productId}`);
}

export interface BulkImportResult {
  created: number;
  updated: number;
}

export async function bulkImportProducts(
  siteId: number,
  products: ProductInput[],
): Promise<BulkImportResult> {
  const res = await api.post<ItemResponse<BulkImportResult>>(
    `/sites/${siteId}/products/bulk-import`,
    { products },
  );
  return res.data.data;
}

/** Re-push every active product of the site to WordPress (reconciliation). */
export async function resyncSite(siteId: number): Promise<{ jobId: string }> {
  const res = await api.post<ItemResponse<{ jobId: string }>>(`/sites/${siteId}/resync`, {});
  return res.data.data;
}
