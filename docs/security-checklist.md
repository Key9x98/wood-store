# Security Checklist

> Trạng thái sau milestone 8 (Hardening). `[x]` = done với code/config evidence. `[ ]` = chưa làm hoặc operational-only (cần infra/runbook ngoài repo).

## 1. Express backend

- [x] `helmet()` mặc định trên app. — `backend/src/app.ts`
- [x] CORS whitelist (KHÔNG `*` cho prod). — `lib/cors.ts` + env `CORS_ORIGINS` (default `*` dev only)
- [x] Rate limit `/api/auth/*` (5 req/min/IP). — `middleware/rate-limit.middleware.ts`
- [x] JWT secret ≥ 32 chars (validated). — env Zod `z.string().min(32)`
- [ ] JWT secret rotate hằng quý. — **operational**; cần runbook + automation
- [x] RBAC: `admin`, `user`, `system`. — `lib/jwt.ts` `Role` type + `role()` middleware
- [ ] Audit log mọi POST/PUT/DELETE quan trọng. — bảng `audit_logs` trong architecture.md; **chưa có repository implementing**
- [x] Input validate Zod ở mọi controller. — mọi controller dùng `safeParse`
- [x] SQL parameterized (Prisma). — không có `$queryRaw*` (grep clean)
- [x] Không log secret. — pino redact 23 paths + 17 tests

## 2. Shell exec

- [x] Chỉ dùng `execFile` (array args). — `lib/shell.ts`; grep `exec(` chỉ ra `regex.exec` (JS method)
- [x] Whitelist regex `domain`, `dbName`, `slug`. — `DomainSchema`, `assertSafeIdentifier`, `TemplateSlugSchema`
- [x] Timeout cho mọi gọi shell. — `run()` default timeout 60s
- [x] KHÔNG dùng `shell: true`. — `execFile` không hỗ trợ option đó

## 3. Filesystem

- [x] Mọi path tạo/xoá validate trong allowed root. — `SourceService.assertWithinRoot` + `NginxService` path.join với env config
- [x] Không cho phép `..`. — `path.resolve` normalize + `startsWith(root)` check
- [x] `chmod 640` cho `wp-config.php`. — `WpConfigService.generate({mode: 0o640})`
- [ ] `chown www-data:www-data` cho wp-config.php. — production-only (worker chạy as root → cần chown bằng shell sau write). Currently relies on PHP-FPM pool config + umask.

## 4. Database

- [ ] DB root chỉ accessible từ `127.0.0.1`. — **operational** (MySQL `bind-address`)
- [x] Site WP user permissions giới hạn DB của mình. — `WpDbService.grant`: `GRANT ALL ON dbName.* TO user@localhost` (không `*.*`)
- [x] Encrypt `sites.db_password` AES-256-GCM. — `lib/crypto.ts` + provision step D encrypt before persist
- [ ] Backup encrypt với age trước S3. — **operational**, runbook `db-down.md` reference
- [ ] `local_infile = 0` trong MySQL. — **operational** (MySQL server config)

## 5. WordPress sites

- [ ] Disable `XML-RPC` (nginx + plugin). — Nginx `location = /xmlrpc.php { deny all; }` ✅ trong template; plugin disable chưa
- [x] Disable file editor: `DISALLOW_FILE_EDIT`. — `WpConfigService` default template
- [x] `DISALLOW_FILE_MODS = true`. — same template
- [x] WP salt keys random 64 chars. — `randomBytes(48).toString('base64')` × 8 keys
- [ ] Hide WP version (HTML source). — theme `functions.php` chưa remove `wp_generator`
- [ ] `wp-admin/` rate limit Nginx. — chưa thêm vào `nginx.service.ts` template
- [ ] Force HTTPS redirect 80→443. — Nginx template hiện chỉ listen 80; certbot --nginx tự add redirect khi issue cert (step I)
- [ ] Disable user enumeration `/?author=N`. — chưa làm

## 6. Plugin auth (HMAC)

- [x] Constant-time compare (`hash_equals`). — `HmacAuthenticator::check`
- [x] Timestamp window ±5 phút. — `TIMESTAMP_WINDOW_SECONDS = 300`
- [x] IP whitelist option. — `ai_builder_allowed_ips` (csv)
- [x] Secret 64 bytes random per site. — `bin2hex(random_bytes(32))` = 64-char hex on plugin activation
- [ ] Rotate endpoint trong Express. — chưa implement (TODO trong `runbooks/plugin-auth-fail.md` postmortem)

## 7. SSL

- [ ] Chỉ TLS 1.2 + 1.3. — **operational** (Nginx `ssl_protocols`)
- [ ] HSTS preload (sau khi stable). — **operational**
- [ ] Ciphers Mozilla intermediate. — **operational**
- [ ] OCSP stapling. — **operational**
- [x] Renewal monitored. — runbook `cert-renewal-fail.md` + Grafana alert rule example trong `ops/grafana/README.md`

## 8. Container / host

- [x] Image base Alpine. — `Dockerfile` uses `node:20-alpine`
- [x] Run as non-root. — `Dockerfile` `USER cms` (uid 10001)
- [ ] Read-only root filesystem. — `Dockerfile` chưa set `readOnlyRootFilesystem`
- [ ] Drop capabilities. — runtime config (k8s/compose), không trong Dockerfile
- [ ] Unattended-upgrades. — **operational**

## 9. Secrets

- [ ] `.env` mode 600 production. — **operational**
- [x] KHÔNG commit `.env`. — `backend/.gitignore` includes `.env`
- [ ] CI dùng secret manager. — **operational** (cần wire GH Secrets/Vault/Doppler)
- [ ] Tách secret per env. — Zod schema same; **operational** (`.env.dev` / `.env.staging` / `.env.prod`)

## 10. Logging & audit

- [x] Không log password/token/PII. — pino redact + 17 tests
- [ ] Audit log: actor, action, target, before, after, ip, ts. — schema có nhưng repository chưa làm
- [ ] Log retention ≥ 90 ngày. — **operational** (Loki/journald rotation)
- [ ] Tách stream app/access/audit. — pino single stream hiện; **operational** routing

## 11. Threat model (reference table)

| Threat | Mitigation | Status |
|---|---|---|
| Command injection via domain | regex validate + execFile array | ✅ test verify "abc.com; rm -rf /" reject |
| SQL injection | Prisma/parameterized | ✅ grep `queryRaw*` clean |
| Tenant data leakage | DB per site (wp_<site>), per-user GRANT | ✅ |
| SSRF qua DNS provider response | Zod parse `CfResp<T>` shape | ✅ `cloudflare.provider.ts` |
| XSS từ field user → WP page | `wp_kses_post` + `esc_html` trong theme | ✅ theme + plugin sanitize |
| Mass-assign attack | Zod whitelist field | ✅ |
| BullMQ replay | jobId unique + idempotent | ✅ test 2 lần = 1 lần |
| Stolen plugin secret | IP whitelist; rotate endpoint TODO | ⚠️ partial |
| CSRF admin dashboard | SameSite + token | ❌ UI chưa exist |
| Rate-limit bypass | by req.ip + trust proxy | ✅ |

## 12. Incident response

- [x] Runbooks. — 6 runbooks trong `docs/runbooks/`:
  - `cert-renewal-fail.md` (Let's Encrypt rate limit, DNS not propagated)
  - `redis-down.md` (crash, OOM, AOF corruption)
  - `db-down.md` (MySQL crash, too many conns, disk full, single WP corrupt, InnoDB recovery)
  - `dns-provider-down.md` (Cloudflare API outage, token revoked, rate limit)
  - `worker-stuck.md` (stalled jobs, hung shell, orphan lock)
  - `plugin-auth-fail.md` (HMAC 401: secret mismatch, clock skew, IP whitelist)
- [ ] Rotate secret playbook < 30 phút. — runbook covers manual rotation; cần automation script
- [ ] On-call rotation. — **operational**
- [ ] Post-mortem template (blameless). — chưa tạo `docs/incidents/_template.md`

## Tổng kết

**Done (code/config evidence): 27**
**Operational / outside-repo: 14**
**Partial / TODO: 6**

Items kế tiếp đáng làm để fully harden:
1. Implement `audit_logs` repository + middleware ghi mọi mutation
2. Rotate endpoint `POST /api/sites/<id>/rotate-plugin-secret`
3. Nginx template: rate limit `wp-admin/`, hide `wp_generator`, force HTTPS redirect
4. Backend chown wp-config sau write (`run('chown', ['www-data:www-data', configPath])`)
5. Post-mortem template `docs/incidents/_template.md`
6. CI wire GitHub Secrets cho production .env values
