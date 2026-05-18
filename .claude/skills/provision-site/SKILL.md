---
name: provision-site
description: Triển khai 1 website WordPress mới end-to-end (DNS → folder → DB → wp-config → theme → Nginx → SSL → smoke test). Mọi bước idempotent, có rollback. Dùng khi user yêu cầu "provision site", "tạo site mới", "deploy domain", hoặc viết/sửa worker provisioning.
---

# Skill: Provision Site

> Đọc `docs/provisioning-flow.md` đầy đủ trước. Skill này là playbook ngắn để Claude triển khai/sửa code provisioning đúng.

## 1. Khi nào dùng skill

- User yêu cầu code `ProvisionWorker` mới.
- Sửa bug trong flow provision.
- Thêm 1 step vào provision (ví dụ: tạo Cloudflare Page Rule).
- Viết test cho provision.

## 2. Pre-check (phải làm trước khi code)

1. Đọc `docs/provisioning-flow.md` — nắm 11 bước A→K.
2. Đọc `docs/backend-structure.md` — convention module.
3. Đọc `docs/security-checklist.md` mục 2 (shell exec) + 4 (DB).
4. Kiểm tra `.env.example` có đủ: `SERVER_IP`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `ADMIN_EMAIL`, `SECRET_ENCRYPTION_KEY`.

## 3. Quy tắc bắt buộc

- ✅ Mọi shell exec dùng `execFile` qua `src/lib/shell.ts`.
- ✅ Validate `domain` bằng regex `^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i` TRƯỚC khi truyền vào bất kỳ helper nào.
- ✅ Mỗi step ghi `sites.provision_state.steps[X].done = true` trước khi sang step kế.
- ✅ Bắt đầu step: check `done` → skip nếu đã xong.
- ✅ Job có `jobId: "site:${siteId}"` (unique).
- ✅ Nếu step fail: enqueue `queue:rollback` với danh sách step đã làm.
- ❌ KHÔNG `exec()` với string nội suy.
- ❌ KHÔNG share DB giữa site.
- ❌ KHÔNG block HTTP handler với long task — luôn enqueue.

## 4. Template implementation

```ts
// src/workers/provision.worker.ts
import { Worker } from 'bullmq';
import { z } from 'zod';
import { redis } from '../lib/redis';
import { logger } from '../config/logger';
import { sitesRepo } from '../modules/sites/sites.repository';
import { dnsService } from '../modules/dns/dns.service';
import { sourceService } from '../modules/wordpress/source.service';
import { dbService } from '../modules/wordpress/db.service';
import { wpConfigService } from '../modules/wordpress/wp-config.service';
import { nginxService } from '../modules/wordpress/nginx.service';
import { sslService } from '../modules/ssl/ssl.service';
import { rollbackQueue } from '../queues/rollback.queue';

const Job = z.object({ siteId: z.number().int().positive() });

new Worker('provision', async (job) => {
  const { siteId } = Job.parse(job.data);
  const log = logger.child({ jobId: job.id, siteId });
  const completed: string[] = [];

  try {
    await sitesRepo.transitionToProvisioning(siteId);

    await runStep('B', () => dnsService.upsertA(siteId));        completed.push('B');
    await runStep('C', () => sourceService.cloneTemplate(siteId));completed.push('C');
    await runStep('D', () => dbService.createWpDatabase(siteId));completed.push('D');
    await runStep('E', () => dbService.importDump(siteId));      completed.push('E');
    await runStep('F', () => wpConfigService.generate(siteId));  completed.push('F');
    await runStep('G', () => sourceService.activateTheme(siteId));completed.push('G');
    await runStep('H', () => nginxService.deployConfig(siteId)); completed.push('H');
    await runStep('I', () => sslService.issue(siteId));          completed.push('I');
    await runStep('J', () => smokeTest(siteId));                 completed.push('J');

    await sitesRepo.markActive(siteId);
    log.info('provisioned');
  } catch (err) {
    log.error({ err, completed }, 'failed; enqueuing rollback');
    await rollbackQueue.add('rollback', { siteId, completed });
    throw err;
  }
}, { connection: redis, concurrency: 2, lockDuration: 5 * 60_000 });
```

`runStep` xem `docs/queue-workers.md` mục 4.

## 5. Mỗi service phải có

- `createWpDatabase(siteId)`:
  - Đọc `sites.domain` → tính `dbName = wp_${domain.replace(/[^a-z0-9]/g, '_')}`.
  - `CREATE DATABASE IF NOT EXISTS`.
  - `CREATE USER ... IDENTIFIED BY ...` (skip nếu exists).
  - `GRANT ALL ON dbName.* TO user`.
  - Lưu `db_password` encrypted vào `sites`.
- `cloneTemplate(siteId)`:
  - Đường dẫn target validate `startsWith('/var/www/html/sites/')`.
  - Nếu folder exists + non-empty → skip.
  - `git clone --depth=1 <template.git_repo> <target>`.
  - chown www-data + chmod đúng.
- `nginxService.deployConfig(siteId)`:
  - Render từ template `templates/nginx-site.template.conf`.
  - Atomic write: `.conf.tmp` → rename.
  - `nginx -t` trước khi reload.
  - Reload bằng `systemctl reload nginx`.
- `sslService.issue(siteId)`:
  - Pre-check: `dig +short A <domain>` = SERVER_IP, nếu không → throw `dns_not_propagated` (retry với backoff dài).
  - `certbot certonly --nginx -d <domain> --non-interactive --agree-tos -m <ADMIN_EMAIL> --keep-until-expiring`.
  - Sau khi cert OK: re-render nginx config HTTPS, reload.

## 6. Test must-pass

- [ ] Unit: regex domain reject `abc.com; rm -rf /`, `localhost`, `192.168.1.1`.
- [ ] Integration: chạy provision 2 lần → DB chỉ tạo 1 lần.
- [ ] Integration: inject lỗi ở step H → rollback xoá đúng B, C, D, E, G.
- [ ] E2E (sandbox VPS): provision `test-${ts}.example.com` → curl HTTPS 200.

## 7. Anti-pattern thường gặp

❌ Mock `child_process` trong unit test rồi tự tin → integration vẫn fail. Phải có 1 integration test thật.

❌ `await dnsProvider.create()` không kiểm tra response status → record không tạo nhưng job vẫn pass.

❌ Quên `chown www-data` → WP không ghi được `wp-content`, plugin nhận lỗi 500 lúc smoke test.

❌ Reload Nginx khi `nginx -t` fail → 502 cho mọi site khác trên host.

## 8. Khi user báo lỗi

Hỏi:
1. `sites.provision_state.steps` đang dừng ở đâu?
2. Log worker quanh job ID đó?
3. Có manual chỉnh trên VPS (folder, DNS, Nginx) không?

Đừng nhảy vào sửa code khi chưa biết step đang fail.
