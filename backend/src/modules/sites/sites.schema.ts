import { z } from 'zod';

// Domain rule from CLAUDE.md §4.4 and docs/provisioning-flow.md §2:
//   - lowercase only (lower-cased via .toLowerCase())
//   - labels 1..63 chars, no leading/trailing '-'
//   - 2+ labels, TLD ≥ 2 chars
//   - total length ≤ 253
export const DomainSchema = z
  .string()
  .toLowerCase()
  .max(253, 'sites.domain_too_long')
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/,
    'sites.invalid_domain',
  )
  .refine((d) => /\.[a-z]{2,}$/.test(d), { message: 'sites.invalid_tld' });

export const CreateSiteSchema = z.object({
  domain: DomainSchema,
  templateId: z.coerce.number().int().positive(),
});
export type CreateSiteInput = z.infer<typeof CreateSiteSchema>;

export const UpdateSiteSchema = z.object({
  status: z.enum(['queued', 'provisioning', 'active', 'failed', 'ssl_failed', 'deleted']).optional(),
});
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>;

export const ListSitesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});
export type ListSitesInput = z.infer<typeof ListSitesSchema>;
