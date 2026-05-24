# Site Management — Backend CMS quản lý site như thế nào

> Đọc file này để trả lời câu hỏi: *"Site nằm trong `/var/www/html/sites/<domain>/` —
> vốn là source frontend — thì Backend CMS quản lý (thêm/sửa/xoá nội dung, đổi
> template) bằng cách nào?"*

---

## 1. Hai mặt phẳng (two planes)

Hệ thống có **2 mặt phẳng tách biệt**. Hiểu sai ranh giới này là gốc của mọi nhầm lẫn.

```
┌──────────────────────── CONTROL PLANE ────────────────────────┐
│  Express CMS  +  MySQL cms_core                                │
│  - NGUỒN CHÂN LÝ cho mọi nội dung site                         │
│  - sites, site_products, site_pages, site_media, site_settings │
│  - user nhập/sửa/xoá Ở ĐÂY, không phải trong wp-admin          │
└───────────────────────────┬────────────────────────────────────┘
                            │  queue:content-sync
                            │  (đẩy 1 chiều, HMAC REST)
                            ▼
┌──────────────────────── RENDER PLANE ─────────────────────────┐
│  /var/www/html/sites/<domain>/   (1 WordPress install)         │
│  - CHỈ render. Là bản chiếu (projection) của cms_core.         │
│  - DB wp_<domain_safe> chứa wp_posts/wp_postmeta...            │
│  - DISPOSABLE: xoá sạch rồi dựng lại được từ cms_core          │
└────────────────────────────────────────────────────────────────┘
            ▲
            │  cầu nối DUY NHẤT
   ┌────────┴─────────┐
   │ ai-builder-plugin │  REST API trong WordPress (namespace ai-builder/v1)
   └───────────────────┘
```

**Quy tắc vàng:**

1. Express **không bao giờ** kết nối trực tiếp vào DB WordPress (`wp_<domain>`)
   để ghi nội dung. Mọi thay đổi đi qua `ai-builder-plugin` REST API.
2. End-user **không** đăng nhập `wp-admin` để sửa nội dung. wp-admin chỉ dành cho
   super-admin xử lý sự cố. Nội dung sửa ở dashboard Express.
3. WordPress trong `/var/www/html/sites/<domain>/` là **artifact tái tạo được**.
   Nếu nó hỏng: xoá folder + DB, dựng lại WP core, replay sync từ `cms_core` →
   site trở lại y nguyên. Không mất dữ liệu vì dữ liệu gốc nằm ở `cms_core`.

> Đây chính là lý do "site nằm trong source frontend" **không** ngăn backend quản
> lý nó: thư mục đó không phải là nơi lưu dữ liệu gốc, nó chỉ là nơi *render*.

---

## 2. `wood-store-frontend` repo đóng vai trò gì

Repo `github.com/Key9x98/wood-store-frontend.git` **không phải** "một template".
Nó là **WordPress runtime shell** dùng chung cho mọi site:

| Thành phần trong repo | Vai trò |
|---|---|
| WP core (`wp-admin/`, `wp-includes/`, `wp-*.php`) | Bộ WordPress chạy được — nguồn cho `WP_CORE_DIR` |
| `wp-content/plugins/ai-builder-plugin/` | Cầu nối REST để Express điều khiển site |
| `plugin/ai-builder-plugin/` | Source code plugin (để build artifact) |
| `db_dump.sql`, `wp-content/themes/` | Hạt giống cho template `furniture-basic` |

Khi setup host: clone repo này **một lần** → đặt làm `WP_CORE_DIR`. Mỗi site mới
chỉ **copy** từ `WP_CORE_DIR` (xem `provisioning-flow.md` bước C), **không**
`git clone` lại từng site, **không** có repo riêng cho từng template.

---

## 3. Schema nội dung trong `cms_core`

Đây là phần `architecture.md §2.2` còn thiếu. `cms_core` phải có bảng nội dung
canonical, nếu không thì WordPress mới là CMS thật (sai nguyên tắc CLAUDE.md §4.1).

| Bảng | Mục đích | Cột khoá chiếu sang WP |
|---|---|---|
| `site_products` | sản phẩm canonical của 1 site | `wp_post_id`, `sync_status`, `synced_at` |
| `site_pages` | trang canonical (home, gioi-thieu...) | `wp_post_id`, `sync_status`, `synced_at` |
| `site_media` | media đã upload (dedup theo `sha256`) | `wp_attachment_id`, `wp_url` |
| `site_settings` | custom fields template (shop_name, hotline, logo...) | đẩy qua `/fields` |
| `content_sync_log` | lịch sử mỗi lần sync 1 entity (hoặc dùng `audit_logs`) | — |

Nguyên tắc cột chiếu (projection mapping):

- Mỗi row canonical giữ `wp_post_id` / `wp_attachment_id` = ID tương ứng phía WP
  *sau khi* sync thành công. Trước đó = `NULL`.
- `sync_status ∈ {pending, syncing, synced, failed}`. Mọi lần CRUD ở Express set
  lại `pending`.
- `site_media` dedup theo `sha256` của file gốc → re-sync không upload lại ảnh.

---

## 4. Vòng đời nội dung: CRUD ở đâu, sync thế nào

### 4.1. Sơ đồ chung

```
Admin dashboard
   │  POST/PATCH/DELETE /api/sites/:id/products
   ▼
Express controller → service
   │  1. validate (Zod)
   │  2. ghi cms_core (site_products), sync_status='pending'
   │  3. ghi audit_logs
   │  4. enqueue queue:content-sync { siteId, entity, entityId, op }
   ▼
HTTP trả 200 NGAY (không chờ WP)
   ⋮  (async)
ContentSyncWorker
   │  1. đọc row canonical từ cms_core
   │  2. resolve media: ảnh chưa có wp_attachment_id → POST /media/upload
   │  3. POST /wp-json/ai-builder/v1/content/products  (HMAC)
   │  4. nhận wp_post_id → lưu lại vào cms_core, sync_status='synced'
   │  5. POST /cache/flush
   ▼
WordPress render nội dung mới
```

HTTP handler **không** chờ WordPress — đúng nguyên tắc CLAUDE.md §4.3 (job dài
đều qua queue). User thấy phản hồi tức thì; site cập nhật vài giây sau.

### 4.2. Thêm sản phẩm

1. `POST /api/sites/:id/products` → validate → INSERT `site_products`
   (`sync_status='pending'`, `wp_post_id=NULL`).
2. Enqueue `content-sync { siteId, entity:'product', entityId, op:'upsert' }`.
3. Worker upsert sang WP qua `POST /content/products` (idempotent theo `slug`).

### 4.3. Sửa sản phẩm

1. `PATCH /api/sites/:id/products/:productId` → UPDATE `site_products`,
   set `sync_status='pending'`.
2. Enqueue `content-sync` op `upsert`. Worker dùng `wp_post_id` đã lưu → update
   đúng post, không tạo trùng.

### 4.4. Xoá sản phẩm

1. `DELETE /api/sites/:id/products/:productId` → **soft-delete**:
   `status='archived'` trong `cms_core` (không xoá cứng — giữ để audit/khôi phục).
2. Enqueue `content-sync` op `delete`. Worker gọi plugin `DELETE /content/products/:slug`
   → plugin `wp_trash_post(wp_post_id)`.

### 4.5. Bulk import

`POST /api/sites/:id/products/bulk-import` (CSV/JSON) → validate từng dòng → ghi
`cms_core` → enqueue **một** `content-sync` cho cả batch (worker lặp + cập nhật
`job.updateProgress`). Xem skill `furniture-template` cho seed đồ gỗ.

---

## 5. Đổi template cho 1 site đã chạy

Câu hỏi: *"đổi template cho site"* — đây là điểm sáng của mô hình "cms_core là kho gốc":
**đổi template không làm mất sản phẩm**, vì sản phẩm sống ở `cms_core`, không ở theme.

Template = lớp **trình bày** (theme + cấu trúc trang). Sản phẩm = **dữ liệu** ở
`cms_core`. Đổi template = thay lớp trình bày rồi render lại dữ liệu cũ lên đó.

Luồng (`queue:deploy`, job `switch-template`):

```
PATCH /api/sites/:id  { template_id: <new> }
   │  validate: template mới status='ready'; min_php/min_wp tương thích
   ▼
UPDATE sites SET template_id=<new>, status='switching_template'
enqueue queue:deploy { siteId, op:'switch-template', fromTemplateId, toTemplateId }
   ⋮
DeployWorker (idempotent, có rollback):
   1. backup: ghi lại theme slug + db dump hiện tại
   2. copy theme mới vào /var/www/html/sites/<domain>/wp-content/themes/<slug>
   3. POST /wp-json/ai-builder/v1/themes/activate { slug }
   4. import phần CẤU TRÚC của template mới (pages mặc định, CPT, taxonomy)
      — KHÔNG đụng sản phẩm
   5. re-sync toàn bộ site_products + site_pages + site_settings từ cms_core
      (enqueue content-sync full-resync)
   6. POST /cache/flush  +  POST /elementor/rebuild
   7. smoke test homepage 200
   8. nếu fail bất kỳ bước nào → rollback: activate lại theme cũ, restore dump
   ▼
UPDATE sites SET status='active'
```

Lưu ý:

- Endpoint plugin `POST /themes/activate` do `ThemesController.php` cung cấp (xem
  `wordpress-plugin.md §4`). Trước đây code plugin có nhưng docs chưa ghi.
- Sản phẩm **không** bị xoá hay import lại từ template — chỉ render lại.
- `template_version` của site được snapshot; không auto-migrate khi template ra
  bản mới (xem `template-system.md`).

---

## 6. Reconciliation — dựng lại WP từ `cms_core`

Vì WordPress chỉ là projection, ta luôn có thể **tái tạo**:

| Tình huống | Hành động |
|---|---|
| DB WP hỏng / bị xoá | dựng lại DB từ template dump → full-resync từ `cms_core` |
| Folder site bị xoá | re-run provision (idempotent) → full-resync |
| Nghi ngờ WP lệch cms_core | job `content-reconcile`: so `site_products` vs `GET /content/products` của plugin, sync lại phần lệch |
| Site cần dọn về sạch | xoá site → provision lại → full-resync |

Job `full-resync`: lặp mọi row `site_products`/`site_pages`/`site_settings` của
site → set `sync_status='pending'` → enqueue `content-sync`. Idempotent vì WP
upsert theo `slug`.

---

## 7. Module backend liên quan

| Module Express | Trách nhiệm |
|---|---|
| `modules/content` | CRUD `site_products` / `site_pages` / `site_media` trong `cms_core` |
| `modules/wordpress` | client gọi `ai-builder-plugin` REST (HMAC) + WP-CLI wrapper |
| `workers/content-sync.worker.ts` | tiêu thụ `queue:content-sync`, đẩy lên WP |
| `workers/deploy.worker.ts` | `switch-template`, deploy theme/plugin |

Scaffold module mới: skill `/scaffold-backend-module`. Viết worker: skill
`/create-queue-worker`. Quản lý/sync nội dung: skill `/sync-site-content`. Đổi
template: skill `/change-site-template`.

---

## 8. Checklist kiểm tra mô hình đúng

- [ ] Mọi CRUD nội dung ghi `cms_core` TRƯỚC, không ghi thẳng WP DB.
- [ ] HTTP handler không chờ WordPress — luôn enqueue `content-sync`.
- [ ] Mỗi entity canonical có `wp_post_id` + `sync_status` + `synced_at`.
- [ ] Sync worker idempotent: chạy lại không tạo post trùng (upsert theo slug).
- [ ] `site_media` dedup theo `sha256` — re-sync không upload lại ảnh.
- [ ] Đổi template không xoá `site_products`.
- [ ] Xoá WP DB + full-resync → site khôi phục đầy đủ nội dung.
- [ ] Express không có connection string trỏ vào `wp_<domain>` để ghi nội dung.
