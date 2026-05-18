import { z } from 'zod';

export const TemplateSlugSchema = z
  .string()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'templates.invalid_slug');

export const TemplateStatusSchema = z.enum(['building', 'ready', 'failed']);

const LocalSource = z.object({
  type: z.literal('local'),
  path: z.string().min(1),
});

const GitSource = z.object({
  type: z.literal('git'),
  repo: z.string().min(1),
  ref: z.string().min(1).default('main'),
});

const ZipSource = z.object({
  type: z.literal('zip'),
  path: z.string().min(1),
});

export const ImportSourceSchema = z.discriminatedUnion('type', [LocalSource, GitSource, ZipSource]);
export type ImportSource = z.infer<typeof ImportSourceSchema>;

export const ImportTemplateSchema = z.object({
  slug: TemplateSlugSchema,
  source: ImportSourceSchema,
});
export type ImportTemplateInput = z.infer<typeof ImportTemplateSchema>;

export const ListTemplatesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: TemplateStatusSchema.optional(),
});
export type ListTemplatesInput = z.infer<typeof ListTemplatesSchema>;
