---
name: change-site-template
description: Đổi template (theme + cấu trúc trình bày) cho 1 site WordPress đã provision, không làm mất sản phẩm. Dùng khi user nói "đổi template cho site", "chuyển site sang theme khác", "switch template", hoặc viết/sửa worker switch-template. Đọc docs/site-management.md trước.
---

# Skill: Change Site Template

> Đổi template = thay lớp **trình bày**. Sản phẩm sống ở `cms_core` nên KHÔNG mất —
> chỉ được render lại lên theme mới. Đọc `docs/site-management.md §5` trước.

## 1. Khi nào dùng

- User yêu cầu chuyển 1 site sang template khác (vd `furniture-basic` → `furniture-premium`).
- Viết/sửa worker `switch-template` trên `queue:deploy`.
- Sửa bug "đổi template xong mất sản phẩm / vỡ layout".

## 2. Pre-read

- `docs/site-management.md` mục 5 (luồng switch-template) + mục 6 (reconciliation).
- `docs/template-system.md` mục 8b.
- `docs/wordpress-plugin.md` mục 4 (`/themes`, `/themes/activate`).

## 3. Nguyên tắc bất biến

- ✅ Phân biệt: **template = trình bày** (theme + pages cấu trúc), **sản phẩm =
  dữ liệu** ở `cms_core`. Đổi template KHÔNG động vào `site_products`.
- ✅ Job idempotent + có rollback về theme cũ.
- ✅ Validate template mới `status='ready'` và `min_php`/`min_wp` tương thích host.
- ✅ Backup theme slug cũ + db dump trước khi đổi.
- ❌ KHÔNG xoá rồi re-import sản phẩm từ db_dump template — sẽ mất data thật.

## 4. Luồng (`queue:deploy`, op `switch-template`)

```
PATCH /api/sites/:id { template_id }
  → validate → UPDATE sites SET template_id, status='switching_template'
  → enqueue queue:deploy { siteId, op:'switch-template', fromTemplateId, toTemplateId }

DeployWorker:
  1. backup        — lưu theme slug cũ + `wp db export` snapshot
  2. copy theme    — copy TEMPLATES_DIR/<new>/theme/ → wp-content/themes/<slug>
  3. activate      — POST /wp-json/ai-builder/v1/themes/activate { slug }
  4. structure     — import pages/CPT/taxonomy của template mới (KHÔNG đụng product)
  5. re-render     — enqueue content-sync { siteId, op:'full-resync' }
  6. refresh       — POST /cache/flush  +  POST /elementor/rebuild
  7. smoke test    — GET homepage → 200
  8. on fail       — rollback: activate theme cũ, restore dump → status='active'
  → UPDATE sites SET status='active'
```

## 5. Worker skeleton

```ts
const Job = z.object({
  siteId: z.number().int().positive(),
  op: z.literal('switch-template'),
  fromTemplateId: z.number().int().positive(),
  toTemplateId:   z.number().int().positive(),
});

// trong handler:
const newTpl = await templatesRepo.findById(toTemplateId);
if (newTpl.status !== 'ready') throw new AppError('template.not_ready', 409);

await runStep(siteId, 'backup',   () => backupTheme(site));
await runStep(siteId, 'copy',     () => sourceService.overlayTheme(siteRoot, newTpl));
await runStep(siteId, 'activate', () => wp.post('/themes/activate', { slug: newTpl.theme.slug }));
await runStep(siteId, 'structure',() => importTemplateStructure(wp, newTpl));
await contentSyncQueue.add('resync', { siteId, op: 'full-resync' });
await runStep(siteId, 'smoke',    () => smokeTest(site.domain));
```

`jobId: \`deploy:switch:${siteId}\`` — 1 site chỉ 1 job switch chạy.

## 6. Rollback

| Bước fail | Compensation |
|---|---|
| copy/activate | `POST /themes/activate { slug: oldSlug }` |
| structure/smoke | activate theme cũ + restore db dump backup |

Rollback xong: `status='active'` (giữ template cũ), ghi `audit_logs`, alert.

## 7. Anti-pattern

❌ Import `db_dump.sql` của template mới đè lên DB site → xoá sạch sản phẩm thật.
   Chỉ import phần *cấu trúc* (pages, CPT, taxonomy), product re-sync từ `cms_core`.

❌ Đổi theme mà quên `full-resync` → trang trống vì theme mới chưa có nội dung.

❌ Quên `/elementor/rebuild` → layout cũ cache lại, theme mới không hiện.

❌ Không backup theme cũ → fail giữa chừng không rollback được.

## 8. Test must-pass

- [ ] Site có 12 sản phẩm → đổi template → vẫn đủ 12 sản phẩm, layout mới.
- [ ] Inject lỗi bước `smoke` → rollback về theme cũ, site vẫn 200.
- [ ] Chạy job 2 lần → kết quả giống nhau (idempotent).
- [ ] `site_products` không bị sửa/xoá sau khi switch.
- [ ] Template chưa `ready` → API từ chối ngay, không enqueue.
