---
name: furniture-template
description: Sinh hoặc cập nhật template website đồ gỗ (tủ/bàn/ghế/ban thờ/kệ/sập). Dùng khi user nói "template đồ gỗ", "bán đồ gỗ", "furniture template", hoặc nhập/seed sản phẩm gỗ. Đọc docs/furniture-template.md trước.
---

# Skill: Furniture Template

## 1. Pre-read

- `docs/furniture-template.md` (spec đầy đủ, đọc trước khi làm)
- `docs/template-system.md` (cơ chế template chung)

## 2. Khi nào dùng

- Tạo template `furniture` từ đầu.
- Thêm danh mục/sản phẩm mẫu vào template.
- Import danh sách sản phẩm thật của 1 xưởng vào site đã provision từ template này.
- Sửa schema sản phẩm (thêm field như `wood_age`, `craftsman_name`).

## 3. Định nghĩa sản phẩm (recap)

Mỗi sản phẩm có:
- name, slug, short_description, description
- category (1+), wood (chất liệu), finish, style, color (attributes)
- dimensions (WxDxH mm), weight_kg
- regular_price, sale_price → tự tính sale_percent
- featured_image, gallery_images[], video_url
- warranty_months, origin, craftsmanship_notes

Lưu: `wp_posts` (product) + `wp_postmeta` (các field) + WooCommerce taxonomy.

## 4. Quy trình apply template + seed data

Sản phẩm là dữ liệu canonical → ghi `cms_core` TRƯỚC, rồi sync. Xem skill
`/sync-site-content` và `docs/site-management.md`.

```
1. Express POST /api/sites { template_slug: 'furniture', custom_fields: {...} }
2. Worker provision như flow chuẩn (dựng vỏ site + sample data của template).
3. Seed sản phẩm thật:
   a. Validate + compute sale_percent → INSERT cms_core.site_products
      (sync_status='pending'). Custom fields → cms_core.site_settings.
   b. enqueue queue:content-sync { siteId, op:'full-resync' }.
4. ContentSyncWorker:
   a. Foreach product: download images → POST /media/upload (dedup sha256)
      → POST /content/products với attachment_ids → lưu wp_post_id.
   b. Set taxonomy terms (categories, wood, finish).
   c. Apply fields (shop_name, hotline, logo) → POST /fields.
   d. POST /cache/flush.
```

## 5. Mapping field → WP

| Express field | WP storage |
|---|---|
| `name` | `wp_posts.post_title` |
| `slug` | `wp_posts.post_name` (sanitize_title) |
| `short_description` | `wp_posts.post_excerpt` |
| `description` | `wp_posts.post_content` |
| `regular_price` | meta `_regular_price` |
| `sale_price` | meta `_sale_price` |
| `sale_percent` | meta `_furniture_sale_percent` |
| `dimensions` | meta `_furniture_dimensions` |
| `weight_kg` | meta `_furniture_weight_kg` |
| `video_url` | meta `_furniture_video_url` |
| `warranty_months` | meta `_furniture_warranty_months` |
| `origin` | meta `_furniture_origin` |
| `craftsmanship_notes` | meta `_furniture_craft_notes` |
| `featured` | meta `_furniture_featured` |
| `featured_image` | `_thumbnail_id` |
| `gallery_images[]` | meta `_product_image_gallery` (csv ids) |
| `category[]` | tax `product_cat` terms |
| `wood` | tax `pa_wood` term |
| `finish` | tax `pa_finish` term |
| `style` | tax `pa_style` term |
| `color` | tax `pa_color` term |

## 6. Plugin endpoint sẽ dùng

- `POST /wp-json/ai-builder/v1/media/upload` (multipart) → `{ id, url }`.
- `POST /wp-json/ai-builder/v1/content/products` → upsert by slug.
- `POST /wp-json/ai-builder/v1/fields` → set custom fields template.
- `POST /wp-json/ai-builder/v1/cache/flush`.

Nếu thiếu endpoint nào: skill `wp-plugin-feature` để thêm.

## 7. Validate input ở Express

```ts
const Product = z.object({
  name: z.string().min(2).max(160),
  short_description: z.string().max(500).optional(),
  description: z.string().min(1),
  category: z.array(z.string()).min(1),
  wood: z.string(),
  finish: z.string().optional(),
  style: z.string().optional(),
  color: z.string().optional(),
  dimensions: z.string().regex(/^\d+x\d+x\d+$/).optional(),
  weight_kg: z.number().positive().optional(),
  regular_price: z.number().int().positive(),
  sale_price: z.number().int().positive().optional(),
  warranty_months: z.number().int().nonnegative().default(12),
  origin: z.string().optional(),
  craftsmanship_notes: z.string().optional(),
  featured: z.boolean().default(false),
  images: z.array(z.string().url()).min(1),       // featured = images[0]
  video_url: z.string().url().optional(),
});
```

Compute `sale_percent`:
```ts
const sale_percent = product.sale_price
  ? Math.round((product.regular_price - product.sale_price) / product.regular_price * 100)
  : 0;
```

## 8. Image pipeline

1. Download buffer (timeout 30s, max 10MB).
2. Detect MIME — reject ngoài `image/jpeg|png|webp`.
3. Resize > 1600px width → 1600px, giữ ratio (sharp).
4. Convert WebP nếu chưa.
5. Multipart upload tới plugin.
6. Lưu attachment_id vào DB Express (bảng `product_assets`) để rerun không re-upload.

## 9. Sample seed (12 sản phẩm) — yêu cầu

Khi tạo lần đầu, seed đủ:
- 2 tủ thờ, 1 tủ quần áo, 1 tủ bếp
- 2 bàn ăn, 1 bàn trà
- 2 ghế sofa, 1 ghế ăn
- 1 sập gỗ, 1 ban thờ

Distribution wood: Mít / Hương / Gụ / Sồi / Lim — mỗi loại ít nhất 1.

## 10. Acceptance test sau seed

- [ ] `GET /shop` hiển thị 12 sản phẩm.
- [ ] Filter `?pa_wood=go-mit` trả ≥ 1 product.
- [ ] Mở 1 product page: gallery ≥ 1 ảnh, sale_percent đúng.
- [ ] JSON-LD Product có price + currency=VND.
- [ ] Form báo giá submit thành công + webhook về Express.

## 11. Anti-pattern

❌ Upload ảnh từng cái không retry → 1 fail kéo cả seed dở dang.

❌ Hardcode tỉ giá vào template → không dùng.

❌ Lưu `gallery_images` dạng JSON trong meta thay vì CSV id → WooCommerce không hiển thị.

❌ Set `_thumbnail_id` mà chưa upload attachment → product không có ảnh.

❌ Tạo product trước khi terms tồn tại → WooCommerce ignore taxonomy.
