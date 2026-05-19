import { z } from 'zod';

// Slug: lowercase, alphanumeric words joined by single hyphens. Optional on
// input — the service derives it from `name` when omitted.
export const ProductSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'content.invalid_slug')
  .max(160);

// Furniture attributes live in a JSON column so `site_products` stays
// template-agnostic. `.passthrough()` keeps fields a future template may add.
export const ProductAttributesSchema = z
  .object({
    wood: z.string().max(120).optional(),
    finish: z.string().max(120).optional(),
    style: z.string().max(120).optional(),
    color: z.string().max(120).optional(),
    dimensions: z.string().regex(/^\d+x\d+x\d+$/, 'content.invalid_dimensions').optional(),
    weightKg: z.number().positive().optional(),
    origin: z.string().max(160).optional(),
    craftNotes: z.string().max(2000).optional(),
    warrantyMonths: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const ProductBase = z.object({
  slug: ProductSlugSchema,
  name: z.string().min(2).max(200),
  shortDescription: z.string().max(500),
  description: z.string().min(1).max(20_000),
  regularPrice: z.number().int().positive(),
  salePrice: z.number().int().positive(),
  videoUrl: z.string().url(),
  featured: z.boolean(),
  attributes: ProductAttributesSchema,
  categories: z.array(z.string().min(1).max(120)).max(20),
  images: z.array(z.string().url()).max(30),
});

const salePriceBelowRegular = (p: {
  regularPrice?: number;
  salePrice?: number;
}): boolean => p.salePrice == null || p.regularPrice == null || p.salePrice < p.regularPrice;

export const CreateProductSchema = ProductBase.partial({
  slug: true,
  shortDescription: true,
  salePrice: true,
  videoUrl: true,
  featured: true,
  attributes: true,
  categories: true,
  images: true,
}).refine(salePriceBelowRegular, {
  message: 'content.sale_price_gte_regular',
  path: ['salePrice'],
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = ProductBase.partial().refine(salePriceBelowRegular, {
  message: 'content.sale_price_gte_regular',
  path: ['salePrice'],
});
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const BulkImportSchema = z.object({
  products: z.array(CreateProductSchema).min(1).max(500),
});
export type BulkImportInput = z.infer<typeof BulkImportSchema>;

export const ListProductsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['active', 'archived']).optional(),
  syncStatus: z.enum(['pending', 'syncing', 'synced', 'failed']).optional(),
});
export type ListProductsInput = z.infer<typeof ListProductsSchema>;
