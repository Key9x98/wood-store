# Template Mẫu: Website Bán Đồ Gỗ

> Spec template `furniture` — bán tủ, bàn, ghế, ban thờ, kệ, tủ thờ, sập gỗ...

---

## 1. Mục tiêu template

Sinh ra một WP site WooCommerce-based, theme custom, có:

- Trang chủ giới thiệu xưởng + sản phẩm nổi bật.
- Catalog sản phẩm chia theo danh mục (Tủ / Bàn / Ghế / Ban thờ / Kệ / Khác).
- Trang chi tiết sản phẩm với gallery + video + thông tin chất liệu + giá gốc/sale.
- Trang "Giới thiệu xưởng", "Quy trình sản xuất", "Liên hệ".
- Form yêu cầu báo giá / đặt hàng (lưu vào WP + gửi mail + webhook về Express).
- Tìm kiếm + filter theo chất liệu, giá, danh mục.
- Mobile-first, tối ưu Core Web Vitals.

---

## 2. Product schema

Dùng WooCommerce custom product type `furniture` (hoặc dùng `product` mặc định + meta).

Fields bắt buộc:

| Field | Kiểu | Lưu ở | Required |
|---|---|---|---|
| `name` | text | `post_title` | ✅ |
| `slug` | text | `post_name` | auto |
| `short_description` | richtext | `post_excerpt` | ✅ |
| `description` | richtext | `post_content` | ✅ |
| `category` | taxonomy term | `product_cat` | ✅ (1+ value) |
| `material` | taxonomy term `pa_material` | attribute | ✅ |
| `dimensions` | text (W×D×H mm) | meta `_furniture_dimensions` | optional |
| `weight_kg` | number | meta `_furniture_weight_kg` | optional |
| `wood_type` | taxonomy term `pa_wood` | attribute | ✅ |
| `origin` | text | meta `_furniture_origin` | optional |
| `regular_price` | number (VND) | `_regular_price` | ✅ |
| `sale_price` | number (VND) | `_sale_price` | optional |
| `sale_percent` | number, auto compute | meta `_furniture_sale_percent` | derived |
| `gallery_images[]` | attachment IDs | `_product_image_gallery` | ≥1 |
| `featured_image` | attachment ID | `_thumbnail_id` | ✅ |
| `video_url` | url (mp4 / Youtube) | meta `_furniture_video_url` | optional |
| `featured` | bool | meta `_furniture_featured` | optional |
| `craftsmanship_notes` | richtext | meta `_furniture_craft_notes` | optional |
| `warranty_months` | int | meta `_furniture_warranty_months` | default 12 |

`sale_percent` = `round((regular_price - sale_price) / regular_price * 100)` — compute trong service ở Express, KHÔNG dựa vào WP.

---

## 3. Categories mặc định (taxonomy `product_cat`)

```
- tu (Tủ)
  - tu-quan-ao (Tủ quần áo)
  - tu-bep (Tủ bếp)
  - tu-tho (Tủ thờ)
  - tu-trang-tri (Tủ trang trí)
- ban (Bàn)
  - ban-an (Bàn ăn)
  - ban-lam-viec (Bàn làm việc)
  - ban-tra (Bàn trà)
  - ban-tho (Bàn thờ)
- ghe (Ghế)
  - ghe-an (Ghế ăn)
  - ghe-sofa (Ghế sofa)
  - ghe-thu-gian (Ghế thư giãn)
- ban-tho (Ban thờ / Đồ thờ)
- ke (Kệ)
- sap-go (Sập gỗ)
- khac (Khác)
```

Lưu trong DB dump, slug không dấu để URL sạch.

---

## 4. Attributes (WooCommerce global attributes)

| Attribute | Slug | Values mẫu |
|---|---|---|
| Chất liệu (loại gỗ) | `wood` | Gỗ Lim, Gỗ Hương, Gỗ Gụ, Gỗ Sồi, Gỗ Cao Su, Gỗ Mít, Gỗ Xoan Đào |
| Bề mặt | `finish` | Sơn PU, Vecni, Dầu lau, Tự nhiên |
| Phong cách | `style` | Hiện đại, Cổ điển, Tân cổ điển, Á Đông, Bắc Âu |
| Màu sắc | `color` | Nâu, Vàng, Đen, Trắng, Đỏ nâu |

Filter trang catalog dựa trên các attribute này.

---

## 5. Pages mặc định

| Slug | Tiêu đề | Mô tả |
|---|---|---|
| `home` | Trang chủ | Hero + featured products + categories grid + testimonial + CTA báo giá |
| `shop` | Sản phẩm | Catalog + sidebar filter |
| `category/<slug>` | Theo category | tự WooCommerce render |
| `gioi-thieu` | Giới thiệu | Câu chuyện xưởng, đội ngũ |
| `quy-trinh-san-xuat` | Quy trình | Step-by-step + ảnh xưởng |
| `bao-gia` | Yêu cầu báo giá | Form gravity/CF7 |
| `lien-he` | Liên hệ | Map + form + thông tin |
| `bao-hanh` | Bảo hành | Chính sách |
| `blog` | Tin tức | Blog index |

---

## 6. Custom fields qua `template.json`

```json
{
  "slug": "furniture",
  "name": "Xưởng đồ gỗ",
  "fields": [
    { "key": "shop_name", "label": "Tên xưởng", "type": "string", "required": true },
    { "key": "tagline", "label": "Slogan", "type": "string" },
    { "key": "phone", "label": "Hotline", "type": "string", "required": true },
    { "key": "address", "label": "Địa chỉ xưởng", "type": "string", "required": true },
    { "key": "zalo", "label": "Zalo", "type": "string" },
    { "key": "facebook_url", "label": "Facebook", "type": "url" },
    { "key": "primary_color", "label": "Màu chủ đạo", "type": "color", "default": "#7B3F00" },
    { "key": "logo", "label": "Logo", "type": "image", "required": true },
    { "key": "hero_image", "label": "Ảnh hero", "type": "image", "required": true },
    { "key": "about_short", "label": "Giới thiệu ngắn", "type": "richtext" }
  ]
}
```

Sau khi provision xong, Express push values qua `POST /wp-json/ai-builder/v1/fields`. Theme đọc từ `get_option('ai_builder_fields')`.

---

## 7. SEO defaults

- Title format: `{product_name} | {category} | {shop_name}`.
- Meta description: dùng `short_description` (160 ký tự).
- Schema.org `Product` JSON-LD (price, currency=VND, availability, brand=shop_name).
- Open Graph + Twitter Card ảnh featured.
- Sitemap.xml: Yoast hoặc Rank Math (plugin required).

---

## 8. Form báo giá

Trường:
- Họ tên (required)
- SĐT (required, regex VN)
- Email (optional)
- Sản phẩm quan tâm (auto-fill nếu vào từ trang product)
- Kích thước mong muốn
- Chất liệu mong muốn
- Ngân sách
- Ghi chú

Submit:
1. Lưu vào `wp_options.ai_builder_quote_requests` (hoặc CPT `quote-request`).
2. Email tới `{shop_email}`.
3. Webhook POST tới `${EXPRESS_BASE}/api/webhooks/quote-request` với HMAC.
4. Tracking: GA4 event `quote_request`.

---

## 9. Performance budget

- LCP < 2.5s trên 3G.
- Ảnh sản phẩm: WebP, lazy load, `srcset`, max 1600px width.
- Theme inline critical CSS.
- Defer JS không thiết yếu.
- Page size homepage < 1.5MB.
- Lighthouse mobile ≥ 85 Performance.

---

## 10. Data ingestion từ Express

Express có endpoint admin `POST /api/sites/:id/products/bulk-import` nhận CSV/JSON:

```json
[
  {
    "name": "Tủ thờ gỗ Mít chân quỳ",
    "category": ["tu-tho"],
    "wood": "Gỗ Mít",
    "dimensions": "1270x610x1670",
    "regular_price": 12500000,
    "sale_price": 9990000,
    "description": "...",
    "short_description": "...",
    "images": ["https://cdn/.../1.jpg", "..."],
    "video_url": "https://...mp4"
  }
]
```

Backend (mô hình "cms_core là kho gốc" — xem `site-management.md`):
1. Validate Zod từng dòng.
2. Compute `sale_percent` rồi **ghi `cms_core.site_products`** (`sync_status='pending'`).
   Đây là bước "thêm sản phẩm" — dữ liệu gốc nằm ở đây, KHÔNG ở WordPress.
3. Enqueue `queue:content-sync { siteId, op:'full-resync' }` (hoặc per-product).
4. `ContentSyncWorker` mới gọi plugin: tải ảnh → `POST /media/upload` → nhận
   attachment ID → `POST /content/products` với meta đầy đủ.
5. Lưu `wp_post_id` trả về vào `site_products`, set `sync_status='synced'`.
6. Idempotent theo slug (cả phía worker lẫn phía plugin upsert).

HTTP handler trả 200 ngay sau bước 3 — không chờ WordPress.

---

## 11. Sample data (cho DB dump template)

Template ship sẵn 12 sản phẩm mẫu phủ đủ category:
- 2 tủ thờ
- 2 bàn ăn
- 2 ghế sofa
- 2 sập gỗ
- 1 ban thờ
- 1 tủ quần áo
- 1 kệ
- 1 bàn trà

Ảnh: dùng ảnh có license cho phép (Unsplash, Pexels) hoặc render Midjourney prompt riêng cho template, lưu trong `template/uploads/`.

---

## 12. Acceptance criteria

Template được mark `ready` khi:

- [ ] Tạo site mới từ template → mở homepage 200 OK trong 60s.
- [ ] 12 sản phẩm mẫu hiển thị đúng.
- [ ] Filter theo `wood` + `category` hoạt động.
- [ ] Trang chi tiết product có gallery + video + giá sale + % giảm.
- [ ] Form báo giá submit → lưu + webhook ping Express.
- [ ] Mobile 360px không vỡ layout.
- [ ] Lighthouse mobile ≥ 85 trên homepage.
- [ ] Apply 1 set custom fields qua `/wp-json/ai-builder/v1/fields` → site cập nhật ngay (logo + hotline + màu).
