import { api } from '@/lib/api';
import type { ItemResponse, ListResponse, Site } from '@/lib/types';

export interface ListSitesParams {
  limit?: number;
  offset?: number;
  status?: string;
}

export async function listSites(params: ListSitesParams = {}): Promise<ListResponse<Site>> {
  const res = await api.get<ListResponse<Site>>('/sites', { params });
  return res.data;
}

export async function getSite(id: number): Promise<Site> {
  const res = await api.get<ItemResponse<Site>>(`/sites/${id}`);
  return res.data.data;
}

export interface CreateSiteInput {
  domain: string;
  templateId: number;
}

export async function createSite(input: CreateSiteInput): Promise<Site> {
  const res = await api.post<ItemResponse<Site>>('/sites', input);
  return res.data.data;
}

export async function deleteSite(id: number): Promise<void> {
  await api.delete(`/sites/${id}`);
}
