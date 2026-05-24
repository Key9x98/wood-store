import { api } from '@/lib/api';
import type { ItemResponse } from '@/lib/types';

/** Package the site's current template theme and push it to the live WordPress site. */
export async function deployTheme(siteId: number): Promise<{ jobId: string }> {
  const res = await api.post<ItemResponse<{ jobId: string }>>(
    `/sites/${siteId}/deploy-theme`,
    {},
  );
  return res.data.data;
}

/** Switch the site to a different template (deploy that theme + repoint the site). */
export async function switchTemplate(
  siteId: number,
  templateId: number,
): Promise<{ jobId: string }> {
  const res = await api.post<ItemResponse<{ jobId: string }>>(
    `/sites/${siteId}/switch-template`,
    { templateId },
  );
  return res.data.data;
}
