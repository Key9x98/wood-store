# Kiến trúc tổng thể

## 1. Sơ đồ luồng dữ liệu

```
                ┌────────────────────────┐
   User UI ───► │   Express CMS / API    │ ◄──── Admin Dashboard
                │   (TypeScript)         │
                └────────┬───────────────┘
                         │   write
                         ▼
                ┌────────────────────────┐
                │   MySQL: cms_core      │   (source of truth)
                │   - users              │
                │   - sites              │
                │   - templates          │
                │   - jobs / audit       │
                └────────┬───────────────┘
                         │
                         │  enqueue
                         ▼
                ┌────────────────────────┐
                │  Redis + BullMQ        │
                │  queues: provision,    │
                │  dns, ssl, deploy, ai  │
                └────────┬───────────────┘
                         │  dequeue
                         ▼
                ┌────────────────────────┐
                │  Workers (Node)        │
                │  - ProvisionWorker     │
                │  - DnsWorker           │
                │  - SslWorker           │
                │  - DeployWorker        │
                │  - AiWorker            │
                └────────┬───────────────┘
                         │  shell / API
                         ▼
   ┌─────────────────────────────────────────────┐
   │  Host server                                │
   │  ┌───────────┐  ┌──────────┐  ┌──────────┐  │
   │  │  Nginx    │  │ PHP-FPM  │  │  MySQL   │  │
   │  └─────┬─────┘  └────┬─────┘  └────┬─────┘  │
   │        │             │             │        │
   │        ▼             ▼             ▼        │
   │  /var/www/html/sites/abc.com (WordPress)    │
   │  /var/www/html/sites/xyz.com (WordPress)    │
   └─────────────────────────────────────────────┘
                         ▲
                         │  REST sync
                         │
            ┌────────────┴───────────┐
            │ ai-builder-plugin (WP) │
            │ - REST endpoints       │
            │ - Elementor trigger    │
            │ - Media upload         │
            └────────────────────────┘
```

## 1.1. Hai mặt phẳng: control plane vs render plane

- **Control plane** = Express + `cms_core`. Là **nguồn chân lý** cho mọi nội dung
  site (sản phẩm, trang, media, settings). User nhập/sửa/xoá ở đây.
- **Render plane** = các WordPress install trong `/var/www/html/sites/<domain>/`.
  Chỉ **render**. Là bản chiếu (projection) tái tạo được của `cms_core`.
- **Cầu nối duy nhất** = `ai-builder-plugin` REST API. Express **không bao giờ**
  ghi thẳng vào DB `wp_<domain>`.

Vì sao "site nằm trong source frontend `/var/www/html/sites/`" vẫn quản lý được:
thư mục đó không phải nơi lưu dữ liệu gốc — nó chỉ render. Chi tiết cách backend
thêm/sửa/xoá nội dung và đổi template: đọc **`docs/site-management.md`**.

## 2. Vai trò từng layer

### 2.1. Express CMS / API
- Quản lý user, billing, site, template metadata.
- Nhận request từ UI → validate → ghi DB `cms_core` → enqueue job.
- Expose REST + (tuỳ) GraphQL cho dashboard.
- **Không** chạy long task synchronously.

### 2.2. MySQL `cms_core`
Schema tối thiểu:

| Bảng | Mục đích |
|---|---|
| `users` | tài khoản user |
| `sites` | mỗi row = 1 website (domain, status, template_id, server_id) |
| `templates` | metadata template (slug, manifest, local_path, theme) |
| `site_products` | sản phẩm canonical của site (chiếu sang `wp_post_id`) |
| `site_pages` | trang canonical của site (chiếu sang `wp_post_id`) |
| `site_media` | media đã upload, dedup theo `sha256` (chiếu sang `wp_attachment_id`) |
| `site_settings` | custom fields template của từng site (shop_name, hotline...) |
| `jobs` | log mọi BullMQ job (jobId, type, status, payload, error) |
| `audit_logs` | mọi hành động write quan trọng |
| `dns_records` | bản sao DNS đã apply qua provider API |
| `ssl_certs` | trạng thái SSL của từng domain |

`site_products` / `site_pages` / `site_media` / `site_settings` là **nội dung
canonical** — `cms_core` là nguồn chân lý, DB WordPress chỉ là bản chiếu. Xem
`docs/site-management.md`.

Mỗi site WordPress dùng database RIÊNG (xem `provisioning-flow.md`), KHÔNG nằm trong `cms_core`.

### 2.3. Redis + BullMQ
Queues:
- `queue:provision` — tạo site mới end-to-end
- `queue:dns` — sub-job DNS
- `queue:ssl` — sub-job SSL
- `queue:deploy` — deploy code/theme, đổi template cho site đã chạy
- `queue:content-sync` — đẩy nội dung `cms_core` → WordPress qua plugin REST
- `queue:ai` — AI content generation
- `queue:rollback` — undo job lỗi

Mọi queue cấu hình:
- `attempts: 3`
- `backoff: { type: 'exponential', delay: 5000 }`
- `removeOnComplete: { age: 86400, count: 1000 }`

### 2.4. Workers
- Mỗi worker là process riêng, scale ngang được.
- Worker đọc job, gọi service tương ứng, ghi audit, cập nhật `sites.status`.
- Job phải idempotent — xem `queue-workers.md`.

### 2.5. WordPress sites (render plane)
- Mỗi site là 1 WordPress installation độc lập trong `/var/www/html/sites/<domain>/`.
- File WP core copy từ `WP_CORE_DIR` (nguồn: repo `wood-store-frontend`); KHÔNG
  `git clone` repo riêng cho từng site.
- Database riêng `wp_<domain_safe>`.
- Cùng dùng plugin `ai-builder-plugin` để **nhận lệnh đẩy nội dung** từ Express.
- Là **projection** của `cms_core`: disposable, dựng lại được bằng full-resync.
- KHÔNG sửa core WordPress; mọi tuỳ biến qua plugin + theme. End-user KHÔNG sửa
  nội dung trong `wp-admin` — sửa ở dashboard Express.

### 2.6. Nginx
- 1 server block per domain trong `/etc/nginx/sites-available/<domain>.conf`.
- Worker generate file này từ template, symlink vào `sites-enabled/`, rồi `nginx -t && nginx -s reload`.
- Nếu `nginx -t` fail → KHÔNG reload, rollback file, fail job, alert.

## 3. Multi-tenancy

- 1 host VPS có thể chứa N site WordPress.
- Phân biệt qua: domain (Nginx server_name) + DB riêng + folder riêng.
- Khi 1 host hết tài nguyên: backend tạo site mới ở host khác (bảng `servers` trong `cms_core`).

## 4. Failure & rollback

Mỗi bước provision đều có "compensation":

| Bước | Rollback nếu fail bước sau |
|---|---|
| Tạo DB | DROP DATABASE |
| Tạo folder | rm -rf folder (chỉ trong `/var/www/html/sites/`) |
| DNS record | DELETE record qua provider API |
| Nginx config | xoá file + reload |
| SSL cert | revoke cert (certbot revoke) |

Tất cả compensation chạy qua `queue:rollback`, KHÔNG inline trong worker chính.

## 5. Observability

- Logs: pino → stdout → systemd journal hoặc Loki.
- Metrics: Prom client expose `/metrics` từ Express; BullMQ exporter cho queue depth.
- Health: `/healthz` (liveness), `/readyz` (DB + Redis ping).

## 6. Deployment topology (đề xuất)

### Dev
- 1 máy, docker-compose chạy: mysql, redis, express, 1 worker.
- WordPress site test ở `/var/www/html/sites/test.local`.

### Production small (single VPS)
- VPS 8GB+ RAM.
- Systemd services: `cms-api`, `cms-worker-provision`, `cms-worker-deploy`...
- Nginx host trực tiếp WordPress sites.

### Production scale
- 1 control plane (Express + MySQL + Redis).
- N "site host" VPS chạy Nginx + PHP-FPM + MySQL (cho WP).
- Worker chạy lệnh qua SSH (gói trong service `RemoteExecutor`).
