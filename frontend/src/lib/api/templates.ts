import { api } from '@/lib/api';
import type { ItemResponse, ListResponse, Template } from '@/lib/types';

export interface ListTemplatesParams {
  limit?: number;
  offset?: number;
  status?: 'building' | 'ready' | 'failed';
}

export async function listTemplates(
  params: ListTemplatesParams = {},
): Promise<ListResponse<Template>> {
  const res = await api.get<ListResponse<Template>>('/templates', { params });
  return res.data;
}

export async function getTemplate(id: number): Promise<Template> {
  const res = await api.get<ItemResponse<Template>>(`/templates/${id}`);
  return res.data.data;
}

/** Import = upload a WordPress theme as a base64-encoded .zip. */
export interface ImportTemplateInput {
  slug: string;
  zipBase64: string;
}

export interface ImportTemplateResult {
  templateId: number;
  jobId: string;
}

export async function importTemplate(
  input: ImportTemplateInput,
): Promise<ImportTemplateResult> {
  const res = await api.post<ItemResponse<ImportTemplateResult>>('/templates/import', input);
  return res.data.data;
}

export async function deleteTemplate(id: number): Promise<void> {
  await api.delete(`/templates/${id}`);
}
