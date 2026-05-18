import { api } from '@/lib/api';
import type { ItemResponse, ListResponse, Template } from '@/lib/types';

export type ImportSource =
  | { type: 'local'; path: string }
  | { type: 'git'; repo: string; ref?: string }
  | { type: 'zip'; path: string };

export interface ImportTemplateInput {
  slug: string;
  source: ImportSource;
}

export interface ListTemplatesParams {
  limit?: number;
  offset?: number;
  status?: 'building' | 'ready' | 'failed';
}

export async function listTemplates(params: ListTemplatesParams = {}): Promise<ListResponse<Template>> {
  const res = await api.get<ListResponse<Template>>('/templates', { params });
  return res.data;
}

export async function getTemplate(id: number): Promise<Template> {
  const res = await api.get<ItemResponse<Template>>(`/templates/${id}`);
  return res.data.data;
}

export async function importTemplate(input: ImportTemplateInput): Promise<Template> {
  const res = await api.post<ItemResponse<Template>>('/templates/import', input);
  return res.data.data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/templates/${id}`);
}
