# Template System

## 1. Khái niệm

Một **template** = bộ artefact đủ để dựng 1 site WordPress hoàn chỉnh:

```
templates/<template-slug>/
├── template.json          # manifest
├── db_dump.sql            # WP database snapshot (đã sanitize URL)
├── theme/                 # theme WP (folder copy vào wp-content/themes/)
├── plugins/               # plugins phụ thuộc (nếu có)
├── uploads/               # media mặc định
├── preview.png            # ảnh preview cho UI
└── README.md
```

**Phân biệt rõ 3 thứ — đừng nhầm lẫn:**

| Khái niệm | Là gì | Ở đâu |
|---|---|---|
| `wood-store-frontend` repo | WordPress runtime shell dùng chung (WP core + `ai-builder-plugin`) | clone 1 lần → `WP_CORE_DIR` |
| **Template** | artifact = theme + `db_dump.sql` + manifest, lớp *trình bày* | `TEMPLATES_DIR/<slug>/` (mặc định `/var/lib/cms/templates`) |
| **Site** | 1 WP install = copy WP core + overlay theme của template | `/var/www/html/sites/<domain>/` |

Template **không** là 1 git repo riêng để site clone về. Provision copy WP core
rồi overlay theme (xem `provisioning-flow.md` bước C). Nội dung thật của site nằm
ở `cms_core`, không ở template (xem `site-management.md`).

## 2. `template.json` schema

```json
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "slug": "restaurant",
  "name": "Restaurant",
  "version": "1.0.0",
  "category": "food",
  "git_repo": "git@github.com:org/template-restaurant.git",
  "git_ref": "v1.0.0",
  "db_dump": "db_dump.sql",
  "theme": {
    "slug": "restaurant-theme",
    "path": "theme/"
  },
  "plugins_required": ["elementor", "woocommerce"],
  "default_pages": ["home", "menu", "contact"],
  "custom_post_types": [{ "slug": "dish", "label": "Món ăn" }],
  "fields": [
    { "key": "business_name", "label": "Tên nhà hàng", "type": "string", "required": true },
    { "key": "phone", "label": "SĐT", "type": "string" }
  ],
  "preview_image": "preview.png",
  "min_php": "8.1",
  "min_wp": "6.4"
}
```

Validate bằng `ajv` ở backend trước khi import.

`git_repo` / `git_ref` là **tùy chọn** — chỉ là *nguồn import* template (cách
khác: upload zip). Chúng KHÔNG có nghĩa "mỗi site clone từ repo này". Sau import,
template sống ở `TEMPLATES_DIR/<slug>/` trên host.

## 3. Cách backend dùng

### 3.1. Bảng `templates` trong `cms_core`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | int PK | |
| `slug` | varchar(64) UNIQUE | trùng với `template.json.slug` |
| `manifest` | JSON | chính là file `template.json` |
| `local_path` | varchar(255) | đường dẫn folder template trên host |
| `status` | enum | `ready`, `building`, `failed` |
| `version` | varchar(32) | semver |
| `created_at` | timestamp | |

### 3.2. Lifecycle

```
admin upload zip   →   queue:template-import   →   validate   →   extract   →   register row
                                                                  │
                                                                  ▼
                                                          status = ready
```

User chỉ chọn template ở `status='ready'`.

## 4. Quy trình tạo template mới

Dùng skill `/create-template`. Các bước:

1. Khởi tạo 1 site WordPress sạch.
2. Cài theme + plugins + cấu hình.
3. Tạo nội dung mẫu (pages, posts, menu, customizer).
4. Export DB: `wp db export db_dump.sql --add-drop-table`.
5. Sanitize URL trong dump: replace `https://staging.local` → `{{SITE_URL}}` (placeholder, worker thay khi import).
6. Copy folder `wp-content/themes/<theme>` vào `template/theme/`.
7. Copy `wp-content/uploads/` vào `template/uploads/` (đã optimize ảnh).
8. Viết `template.json`.
9. Tạo `preview.png` 1280x800.
10. Đóng gói artifact: zip thư mục `templates/<slug>/` **hoặc** commit lên git.
11. Import qua `queue:template-import` (nguồn = zip path hoặc git repo+ref) →
    artifact giải nén vào `TEMPLATES_DIR/<slug>/`, đăng ký row `templates`.

## 5. URL placeholder rule

Trong `db_dump.sql`:
- KHÔNG hardcode URL site cụ thể.
- Dùng placeholder `{{SITE_URL}}` ở mọi nơi WP lưu URL: `wp_options.siteurl/home`, `wp_posts.guid`, `wp_postmeta` (Elementor data), v.v.
- Worker khi import sẽ:
  ```sql
  UPDATE wp_options SET option_value = REPLACE(option_value, '{{SITE_URL}}', ?) ...
  ```
  Hoặc dùng WP-CLI: `wp search-replace '{{SITE_URL}}' 'https://abc.com' --all-tables`.

## 6. Elementor data — lưu ý

Elementor lưu data dạng JSON serialize trong `wp_postmeta` (`_elementor_data`). Nếu chỉ `REPLACE` string sẽ làm hỏng độ dài serialize → corrupt page.

**Bắt buộc** dùng `wp search-replace`:
```bash
wp search-replace '{{SITE_URL}}' 'https://abc.com' --all-tables --skip-columns=guid
```
WP-CLI hiểu serialize và update đúng length.

## 7. Custom fields theo template

`template.json.fields[]` định nghĩa các field user cần điền khi tạo site. Sau khi provision xong, backend gọi plugin REST:

```
POST https://<domain>/wp-json/ai-builder/v1/apply-fields
Body: { "business_name": "Quán A", "phone": "0900..." }
```

Plugin update vào `wp_options` (key `ai_builder_fields`) + render lại các page có shortcode `[ai_field key="business_name"]`.

## 8. Versioning & update template

- Site đã provision lưu `template_version` snapshot.
- Khi template ra v2: KHÔNG auto-migrate site cũ. User chủ động chọn "update theme" → queue `template-upgrade-site`.
- Worker upgrade: backup DB → apply diff theme/plugin → smoke test → commit, nếu fail rollback.

## 8b. Đổi template cho 1 site đang chạy

Khác với §8 (nâng cấp *cùng* template lên version mới), đây là **chuyển site
sang một template KHÁC** (ví dụ `furniture-basic` → `furniture-premium`).

- Endpoint: `PATCH /api/sites/:id { template_id }` → job `switch-template` trên
  `queue:deploy`.
- Worker: copy theme mới → plugin `POST /themes/activate` → import cấu trúc
  template mới → **re-sync** `site_products`/`site_pages` từ `cms_core` → smoke
  test → rollback theme cũ nếu fail.
- **Sản phẩm KHÔNG bị mất**: chúng sống ở `cms_core`, chỉ được render lại lên
  theme mới. Đây là lợi ích trực tiếp của mô hình "cms_core là kho gốc".

Chi tiết đầy đủ: `docs/site-management.md §5`. Skill: `/change-site-template`.

## 9. Quality gate cho template

Trước khi đưa `status=ready`:

- [ ] `wp core verify-checksums` pass.
- [ ] `wp db check` pass.
- [ ] Mở homepage local → HTTP 200, không PHP warning.
- [ ] Lighthouse Performance ≥ 80, SEO ≥ 90.
- [ ] Mobile responsive 360px.
- [ ] Không hardcode URL test trong source.
- [ ] Không chứa user data thật (sanitize comments, users dump).
