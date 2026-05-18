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
| `templates` | metadata template (git_repo, db_dump path, theme) |
| `jobs` | log mọi BullMQ job (jobId, type, status, payload, error) |
| `audit_logs` | mọi hành động write quan trọng |
| `dns_records` | bản sao DNS đã apply qua provider API |
| `ssl_certs` | trạng thái SSL của từng domain |

Mỗi site WordPress dùng database RIÊNG (xem `provisioning-flow.md`), KHÔNG nằm trong `cms_core`.

### 2.3. Redis + BullMQ
Queues:
- `queue:provision` — tạo site mới end-to-end
- `queue:dns` — sub-job DNS
- `queue:ssl` — sub-job SSL
- `queue:deploy` — deploy code/theme
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

### 2.5. WordPress sites
- Mỗi site là 1 WordPress installation độc lập trong `/var/www/html/sites/<domain>/`.
- Database riêng `wp_<domain_safe>`.
- Cùng dùng plugin `ai-builder-plugin` để nhận lệnh từ Express.
- KHÔNG sửa core WordPress; mọi tuỳ biến qua plugin + theme.

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
