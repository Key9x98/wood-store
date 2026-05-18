# USAGE.md — Cách dùng Claude Code để build dự án

> Hướng dẫn workflow thực tế dựa trên `CLAUDE.md` + `docs/` + `.claude/skills/`.

---

## 0. Setup ban đầu (1 lần)

```bash
# tại /var/www/html (hoặc thư mục dự án bạn chọn)
cd /var/www/html
claude       # mở Claude Code phiên đầu
```

Khi vào phiên đầu, gõ:

```
Đọc CLAUDE.md, project.md, docs/architecture.md.
Sau đó tóm tắt cho tôi: kiến trúc, các module backend cần làm, thứ tự ưu tiên.
```

→ Claude sẽ confirm đã đọc và đề xuất roadmap. Đây là bước "đồng bộ context".

---

## 1. Lộ trình build dự án (đề xuất 8 milestones)

| # | Milestone | Skill / Docs chính | Thời lượng ước |
|---|---|---|---|
| 1 | Scaffold backend Express + Prisma + Redis | `scaffold-backend-module`, `docs/backend-structure.md` | 0.5 ngày |
| 2 | Module `auth` + `users` + `sites` (CRUD) | `scaffold-backend-module` | 1 ngày |
| 3 | Module `templates` + worker `template-import` | `create-template`, `create-queue-worker` | 1 ngày |
| 4 | Module `dns` (Cloudflare adapter) + `ssl` (certbot wrapper) | `docs/provisioning-flow.md` | 1 ngày |
| 5 | `ProvisionWorker` end-to-end (11 bước A→K) | `provision-site` | 2 ngày |
| 6 | WordPress plugin `ai-builder-plugin` | `wp-plugin-feature`, `docs/wordpress-plugin.md` | 1.5 ngày |
| 7 | Template `furniture` + seed sản phẩm mẫu | `furniture-template` | 1 ngày |
| 8 | Hardening: tests, monitoring, runbook | `docs/security-checklist.md` | 1 ngày |

Mỗi milestone = 1–N phiên Claude. Đừng nhồi nhiều milestone vào 1 phiên — context loãng.

---

## 2. Quy trình chuẩn cho mỗi phiên

### 2.1. Mở phiên với context rõ ràng

❌ "code provisioning cho tôi"

✅ "Đọc `docs/provisioning-flow.md` và `.claude/skills/provision-site/SKILL.md`. Tôi muốn bạn implement bước B (DNS) và bước D (MySQL DB) cho `ProvisionWorker`. Đã có sẵn module `dns` (Cloudflare adapter). Hãy lập plan trước khi code."

### 2.2. Yêu cầu plan trước, code sau

```
Hãy lập plan chi tiết (file nào tạo/sửa, function nào, test nào)
trước khi viết code. Sau khi tôi duyệt thì mới thực hiện.
```

→ Claude dùng `ExitPlanMode` trình plan. Bạn duyệt hoặc chỉnh trước khi cho code.

### 2.3. Yêu cầu test cùng lúc với code

```
Mỗi service mới phải có ít nhất 1 unit test happy path + 1 error case.
Worker phải có integration test idempotent (chạy 2 lần = 1 lần).
```

### 2.4. Kiểm tra giữa chừng

Sau mỗi step lớn:

```
Run: pnpm typecheck && pnpm lint && pnpm test
Báo kết quả, đừng tự sửa nếu có lỗi mới phát sinh — hỏi tôi trước.
```

### 2.5. Commit theo từng step

```
Tôi sẽ tự commit. Hãy `git status` + `git diff --stat` để tôi review.
```

(Hoặc cho Claude commit nếu bạn tin tưởng — nhưng review diff trước khi push.)

---

## 3. Prompt mẫu theo từng milestone

### Milestone 1 — Scaffold

```
Tạo backend skeleton theo docs/backend-structure.md:
- package.json với scripts: dev, build, start, worker:*, test, lint, typecheck
- tsconfig strict, eslint, prettier
- src/config/env.ts dùng Zod schema (đầy đủ env như docs liệt kê)
- src/lib/{shell.ts, result.ts, crypto.ts, redis.ts, logger.ts}
- src/app.ts + src/server.ts
- Prisma schema khởi tạo với model User, Site, Template, Job
- Dockerfile + docker-compose.dev.yml
- .env.example

Sau khi xong: `pnpm install && pnpm typecheck && pnpm dev` phải chạy được.
```

### Milestone 2 — Auth + Sites

```
Dùng skill /scaffold-backend-module. Tạo 3 module: auth, users, sites.
- auth: POST /api/auth/login (JWT), POST /api/auth/refresh, middleware authRequired + role(admin|user).
- users: CRUD chỉ admin.
- sites: CRUD; POST /api/sites validate domain regex, INSERT row status='queued', enqueue queue:provision (job chưa cần worker, chỉ verify enqueue OK).

Kèm Zod schema, repository, service, controller, test unit.
```

### Milestone 3 — Templates

```
Dùng /create-template + /scaffold-backend-module.
- Module templates: CRUD metadata, GET /api/templates trả về list status='ready'.
- Worker template-import (queue:template-import): nhận { source: git|zip, slug }, clone/unzip vào staging, validate template.json bằng ajv, move vào /var/lib/cms/templates/<slug>, upsert DB row.
- Test integration: import 1 template fake từ folder /tmp/fake-template → DB có row status='ready'.
```

### Milestone 4 — DNS + SSL

```
Module dns (adapter pattern):
- Interface DnsProvider với upsertA, deleteRecord, findRecord.
- Implement CloudflareProvider dùng API v4.
- Mock provider cho test.
- Throttle 4 req/s/zone.

Module ssl:
- Service issueCert(domain) wrap certbot certonly --nginx, parse output.
- Pre-check dig A record == SERVER_IP, nếu sai throw 'dns_not_propagated'.
- Test: mock execFile, verify args truyền đúng.
```

### Milestone 5 — Provision worker (phần khó nhất)

```
Dùng skill /provision-site và đọc kỹ docs/provisioning-flow.md.

Implement đầy đủ 11 bước A→K của ProvisionWorker.
Mỗi bước là 1 method của 1 service riêng (dns, source, db, wpConfig, nginx, ssl).
runStep helper kiểm tra sites.provision_state.steps[X].done.
Nếu fail → enqueue rollback với completed[].

Quan trọng:
- Mọi shell exec qua src/lib/shell.ts (execFile array).
- Validate domain regex trước.
- nginx -t trước khi reload.
- Atomic write Nginx conf (tmp + rename).
- Idempotent test: chạy 2 lần liên tiếp, DB tạo 1 lần.

Thêm RollbackWorker xử lý ngược.

Sau khi code xong, viết E2E test trong sandbox (folder /var/www/html/sites-test/).
```

### Milestone 6 — WP Plugin

```
Dùng skill /wp-plugin-feature. Tạo plugin ai-builder-plugin:
- Plugin header v0.1.0
- HmacAuthenticator class
- Routes: /health, /content/pages, /content/posts, /content/products, /media/upload, /fields, /elementor/rebuild, /cache/flush, /status
- Mỗi route: permission_callback, sanitize, return WP_REST_Response envelope.
- Logger ghi vào wp-content/uploads/ai-builder-logs/YYYY-MM-DD.log

PHPUnit test với WP_UnitTestCase ≥ 1 test/route.
Build zip artefact qua composer + tạo script package.sh.
```

### Milestone 7 — Furniture template

```
Dùng skill /furniture-template.

1. Tạo template furniture/ folder:
   - template.json đầy đủ fields[] theo spec
   - theme/ (WordPress theme custom hoặc dựa trên Astra/Blocksy + customizer)
   - db_dump.sql với 12 sản phẩm sample đã sanitize {{SITE_URL}}
   - uploads/ ảnh webp tối ưu
   - preview.png 1280x800

2. Test:
   - Import template qua worker
   - Provision 1 site mới với template này
   - Site mở https://test-furniture.local/ 200 OK
   - 12 sản phẩm hiển thị
   - Filter theo wood hoạt động
```

### Milestone 8 — Hardening

```
Đọc docs/security-checklist.md. Audit:
1. helmet, CORS, rate limit endpoint nhạy cảm.
2. Mọi shell exec đã dùng execFile array? Grep tìm `exec(`.
3. Mọi DB query qua Prisma, không nội suy string?
4. Secrets KHÔNG ở log? Check pino redact.
5. /healthz, /readyz, /metrics expose Prometheus.
6. Runbook docs/runbooks/: cert-renewal-fail.md, redis-down.md, db-down.md.


Output: 1 PR fix tất cả issue tìm thấy.
```

---

## 4. Khi nào gọi skill nào

| Tình huống | Lệnh / prompt |
|---|---|
| Tạo module Express mới | `/scaffold-backend-module rồi tạo module billing` |
| Provision site, sửa bug provision | `/provision-site` rồi mô tả |
| Tạo / import template | `/create-template`, hoặc `/furniture-template` cho đồ gỗ |
| Thêm BullMQ worker mới | `/create-queue-worker tạo worker deploy:plugin-upgrade` |
| Thêm endpoint vào plugin WP | `/wp-plugin-feature thêm /content/menus` |

Skill được Claude tự đọc khi bạn gõ `/<name>`; bạn vẫn cần mô tả task cụ thể đi kèm.

---

## 5. Debug & sửa bug

Khi có bug, đừng nhảy thẳng vào "fix nó". Prompt mẫu:

```
Bug: provision site 'abc.com' fail ở step H (Nginx).
- Log worker: <paste>
- sites.provision_state: <paste>
- File /etc/nginx/sites-available/abc.com.conf: <paste hoặc "không tồn tại">

Phân tích root cause trước khi đề xuất fix. Không sửa code cho đến khi tôi đồng ý.
```

Triết lý: **root cause trước, fix sau**. Claude rất dễ "fix bằng try/catch" nếu bạn không yêu cầu phân tích.

---

## 6. Sub-agents song song

Khi 1 task có nhiều mảng độc lập:

```
Tôi cần đồng thời:
1. Tạo Cloudflare adapter (module dns).
2. Tạo certbot wrapper (module ssl).

Hãy chạy 2 sub-agent (general-purpose) song song cho 2 việc trên,
mỗi agent commit vào branch riêng feat/dns và feat/ssl.
```

Claude sẽ spawn 2 Agent tool calls cùng lúc → tiết kiệm thời gian.

Lưu ý: chỉ song song khi task **không phụ thuộc**. Nếu cần tích hợp → tuần tự.

---

## 7. Anti-pattern khi dùng Claude Code

| ❌ Đừng | ✅ Thay vào đó |
|---|---|
| "Build toàn bộ hệ thống cho tôi" | Chia milestone, mỗi phiên 1–2 milestone |
| Không đọc plan, duyệt thẳng | Yêu cầu plan + review trước khi code |
| Bỏ qua test | Bắt buộc test ở mọi service / worker |
| Để Claude commit toàn bộ end-to-end | Review `git diff` từng step |
| Hỏi "tại sao chậm" mà không show log | Cung cấp log + state cụ thể |
| Sửa cùng file ở 2 phiên song song | 1 file = 1 phiên |
| Để context > 70% mà chưa break | Khi context cao, mở phiên mới với handoff doc |

---

## 8. Handoff giữa các phiên

Khi 1 phiên dài & context đầy, kết phiên bằng:

```
Trước khi tôi đóng phiên: ghi file docs/progress/<milestone>-<date>.md tóm tắt:
- Đã làm xong gì
- Đang dở việc gì
- File nào đụng đến
- Quyết định kiến trúc mới (nếu có)
- TODO tiếp theo

Phiên sau tôi sẽ start bằng cách yêu cầu đọc file đó.
```

Phiên mới:

```
Đọc docs/progress/<latest>.md để tiếp tục công việc. Sau đó báo cho tôi
việc tiếp theo cần làm theo TODO.
```

---

## 9. Setup hữu ích cho dự án này

### 9.1. Permissions cho phép Claude tự chạy (file `.claude/settings.json`)

Sau khi project ổn định, có thể add allowlist để Claude bớt hỏi:

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm typecheck)",
      "Bash(pnpm lint)",
      "Bash(pnpm test*)",
      "Bash(pnpm prisma migrate dev*)",
      "Bash(pnpm prisma generate)",
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(git log*)"
    ]
  }
}
```

Dùng skill `/fewer-permission-prompts` để tự sinh allowlist dựa trên transcript.

### 9.2. CLAUDE.md cá nhân hoá

Nếu nhóm có quy ước riêng (commit format, PR template, code review rule) → bổ sung vào CLAUDE.md mục mới. Claude đọc tự động mỗi phiên.

---

## 10. Quick reference

```
# Mở phiên với context
"Đọc CLAUDE.md + docs/<file>.md + .claude/skills/<skill>/SKILL.md, lập plan."

# Code 1 milestone
"/<skill-name> + mô tả task. Plan trước, test cùng lúc, không commit tự động."

# Debug
"Bug X. Log: <paste>. State: <paste>. Phân tích root cause trước khi sửa."

# Song song
"Chạy 2 sub-agent (general-purpose) cho 2 mảng độc lập A và B."

# Đóng phiên
"Ghi docs/progress/<date>.md handoff trước khi đóng."
```

---

## 11. Khi nào CẦN dừng Claude lại

- Claude đang đề xuất "sửa cho dễ" nhưng vi phạm nguyên tắc bất biến trong CLAUDE.md (vd: shared DB giữa site).
- Claude muốn dùng thư viện mới chưa được vote trong stack mặc định.
- Claude propose breaking change cho plugin/HMAC contract → cần migration plan trước.
- Đề xuất bỏ test "vì code đơn giản".

Khi thấy 1 trong các case này: **dừng và yêu cầu Claude đọc lại file docs liên quan**.

---

## 12. Đầu ra cuối cùng (definition of done)

Dự án **xong** khi:

- [ ] User submit domain qua UI → 5 phút sau site HTTPS chạy được.
- [ ] Template furniture seed 12 sản phẩm hoạt động full chức năng.
- [ ] Rollback test: kill worker giữa provision → state recover được.
- [ ] CI green: typecheck, lint, test (unit + integration) tất cả pass.
- [ ] Monitoring: Grafana có dashboard queue depth + provision success rate.
- [ ] Runbook đủ cho 5 incident phổ biến (cert renewal fail, DNS provider down, DB OOM, worker stuck, plugin auth fail).
- [ ] Security checklist `docs/security-checklist.md` 100% checked.
