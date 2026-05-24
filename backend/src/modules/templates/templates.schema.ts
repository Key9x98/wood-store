import { z } from 'zod';

export const TemplateSlugSchema = z
  .string()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'templates.invalid_slug');

export const TemplateStatusSchema = z.enum(['building', 'ready', 'failed']);

/**
 * Import a template = upload a WordPress theme as a base64-encoded `.zip`.
 * The worker drops the theme into the codebase repo (`GIT_URLS`) under
 * `wp-content/themes/<slug>` and pushes it. No per-import source type — the
 * git target is fixed infrastructure (.env GIT_URLS / GIT_BRANCH).
 */
export const ImportTemplateSchema = z.object({
  slug: TemplateSlugSchema,
  zipBase64: z.string().min(1, 'templates.zip_required'),
});
export type ImportTemplateInput = z.infer<typeof ImportTemplateSchema>;

export const ListTemplatesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: TemplateStatusSchema.optional(),
});
export type ListTemplatesInput = z.infer<typeof ListTemplatesSchema>;
