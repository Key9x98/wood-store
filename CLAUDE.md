# CLAUDE.md — Hướng dẫn cho Claude Code

> File này được Claude Code đọc tự động ở mỗi phiên. Mục đích: giúp Claude hiểu kiến trúc, nguyên tắc và cách triển khai nền tảng auto-tạo website (Express CMS + WordPress).

---

## 1. Bối cảnh dự án (đọc trước khi làm bất kỳ task nào)

Đây là nền tảng **multi-tenant auto website builder**:

- **Brain/Core**: Express.js + TypeScript (source of truth, CMS, API, orchestration)
- **Rendering**: WordPress (chỉ render frontend, không phải CMS chính)
- **Automation**: provisioning DNS / SSL / template / deploy / rollback

File định nghĩa yêu cầu gốc: `project.md`. Khi có mâu thuẫn giữa `project.md` và CLAUDE.md, `project.md` thắng và bạn phải báo cho user.

---

## 2. Cấu trúc tài liệu (đọc khi cần)

| Khi làm | Đọc file |
|---|---|
| Hiểu tổng thể kiến trúc | `docs/architecture.md` |
| Provisioning 1 website mới | `docs/provisioning-flow.md` |
| Làm việc với template | `docs/template-system.md` |
| Code backend Express | `docs/backend-structure.md` |
| Code WordPress plugin | `docs/wordpress-plugin.md` |
| Setup Nginx / PHP-FPM / Docker | `docs/infrastructure.md` |
| Viết BullMQ job | `docs/queue-workers.md` |
| Template website đồ gỗ | `docs/furniture-template.md` |
| Security / hardening | `docs/security-checklist.md` |

---

## 3. Skills (gọi qua `/skill-name`)

| Skill | Dùng khi |
|---|---|
| `provision-site` | Triển khai 1 website mới (DNS → DB → Nginx → SSL) |
| `create-template` | Tạo template mới (theme + DB dump + manifest) |
| `scaffold-backend-module` | Sinh module Express mới theo convention dự án |
| `create-queue-worker` | Viết BullMQ worker mới (idempotent + retry) |
| `wp-plugin-feature` | Thêm feature vào `ai-builder-plugin` |
| `furniture-template` | Sinh hoặc cập nhật template đồ gỗ (tủ/bàn/ghế/ban thờ) |

Skills nằm trong `.claude/skills/<name>/SKILL.md`.

---

## 4. Nguyên tắc bất biến (KHÔNG được vi phạm)

### 4.1. Express là source of truth
- KHÔNG dùng WordPress làm CMS chính.
- Mọi nghiệp vụ (user, billing, site, template, job) phải nằm trong Express + MySQL chính.
- WordPress chỉ render và nhận dữ liệu push từ Express qua REST API của plugin.

### 4.2. Mỗi site = 1 database WordPress riêng
- Không bao giờ share `wp_*` table giữa các site.
- Quy ước đặt tên DB: `wp_<domain_safe>` (ví dụ `abc.com` → `wp_abc_com`).
- DB user của mỗi site có quyền chỉ trên DB của chính nó.

### 4.3. Mọi job dài đều qua queue
- Provision, deploy, SSL, DNS, AI generation, rollback → BullMQ.
- KHÔNG gọi `exec()`/`certbot`/`mysql` trực tiếp trong HTTP handler.
- Mọi job phải **idempotent** (chạy lại không gây side-effect xấu).

### 4.4. Bảo mật shell exec
- Tuyệt đối không nối chuỗi `domain`/`db_name` vào lệnh shell.
- Validate domain bằng regex `^[a-z0-9.-]+\.[a-z]{2,}$` trước khi dùng.
- Dùng `child_process.execFile` với args array, không `exec` với string.

### 4.5. Filesystem layout cố định
```
/var/www/html/sites/<domain>/    # WordPress root của site
/etc/nginx/sites-available/<domain>.conf
/etc/letsencrypt/live/<domain>/
```
Không tự đổi layout này; nó được nhiều worker đồng thuận.

### 4.6. SERVER_IP và secrets
- Đọc từ `.env` qua một module config duy nhất (`src/config/env.ts`).
- Không hardcode IP, password, API key ở bất kỳ nơi nào khác.

---

## 5. Quy trình làm việc khuyến nghị

Khi user giao 1 task lớn (ví dụ "implement provisioning"):

1. **Đọc `project.md` + file docs/ liên quan** trước khi code.
2. **Lập plan** bằng TaskCreate, chia thành bước nhỏ idempotent.
3. **Code theo module convention** trong `docs/backend-structure.md`.
4. **Viết worker idempotent** theo template ở `docs/queue-workers.md`.
5. **Test golden path + 1 failure path** (ví dụ DNS fail thì rollback DB chưa?).
6. **Cập nhật docs/** nếu phát sinh quyết định kiến trúc mới.

---

## 6. Stack mặc định (không thay đổi nếu không có lý do)

| Layer | Tech |
|---|---|
| Backend | Node 20 + Express 4 + TypeScript 5 |
| Backend DB | MySQL 8 (database `cms_core`) |
| Queue | Redis 7 + BullMQ |
| WordPress | 6.x + PHP 8.2 + PHP-FPM |
| Web server | Nginx |
| SSL | Certbot (Let's Encrypt) |
| DNS provider | Cloudflare (mặc định) / Namecheap |
| CDN | Cloudflare |
| Container | Docker + docker-compose (dev) |
| ORM | Prisma (khuyến nghị) hoặc Knex |

---

## 7. Output style

- Code TypeScript strict mode, `noImplicitAny: true`.
- Tên file: `kebab-case.ts`. Tên class: `PascalCase`. Tên biến: `camelCase`.
- Mọi async function trả về `Promise<Result<T, E>>` ở biên module (không throw qua biên).
- Log dùng `pino` với `requestId` + `jobId`.
- Không thêm comment giải thích cái gì code đã rõ; chỉ comment cái **why** không hiển nhiên.

---

## 8. Khi bị block hoặc thiếu thông tin

Hỏi user — KHÔNG đoán các giá trị quan trọng như:
- DNS provider cụ thể (Cloudflare vs Namecheap có API khác nhau)
- Có dùng Docker production không
- Có chạy multi-server (load balancer) hay single VPS
- Storage upload media (S3 vs local)

---

## 9. Tham chiếu nhanh

- Yêu cầu gốc: [`project.md`](./project.md)
- Cách dùng Claude Code cho dự án: [`USAGE.md`](./USAGE.md)
- Phần khó nhất: **provisioning automation** — đọc `docs/provisioning-flow.md` rất kỹ trước khi code.
