---
name: sync-site-content
description: Quản lý và đồng bộ nội dung site (sản phẩm, trang, media) từ cms_core xuống WordPress qua ai-builder-plugin. Dùng khi user nói "thêm/sửa/xoá sản phẩm cho site", "sync nội dung", "viết worker content-sync", "module content", "bulk import sản phẩm". Đọc docs/site-management.md trước.
---

# Skill: Sync Site Content

> Trả lời câu hỏi gốc: backend quản lý nội dung site (nằm trong `/var/www/html/sites/`)
> bằng cách ghi `cms_core` rồi sync xuống WordPress. Đọc `docs/site-management.md` đầy đủ trước.

## 1. Khi nào dùng

- Code module `content` (CRUD `site_products` / `site_pages` / `site_media`).
- Viết/sửa `ContentSyncWorker` (`queue:content-sync`).
- Thêm/sửa/xoá hoặc bulk-import sản phẩm cho 1 site đã provision.
- Sửa bug "site không cập nhật nội dung", "sản phẩm trùng trên WP".

## 2. Pre-read

- `docs/site-management.md` (toàn file — mô hình control/render plane).
- `docs/wordpress-plugin.md` mục 4–6 (REST endpoints + upsert).
- `docs/queue-workers.md` mục 1, 4 (idempotent + step tracking).

## 3. Nguyên tắc bất biến

- ✅ Mọi CRUD nội dung ghi `cms_core` **TRƯỚC**, set `sync_status='pending'`.
- ✅ HTTP handler enqueue `queue:content-sync` rồi trả 200 NGAY — không chờ WP.
- ✅ Express gọi WordPress **chỉ** qua `ai-builder-plugin` REST (HMAC). KHÔNG mở
  connection vào DB `wp_<domain>`.
- ✅ Mỗi entity canonical giữ `wp_post_id`/`wp_attachment_id` + `sync_status` +
  `synced_at`.
- ✅ Xoá = soft-delete (`status='archived'`) ở `cms_core` + op `delete` sang WP.
- ✅ `site_media` dedup theo `sha256` — không upload lại ảnh đã có.
- ❌ KHÔNG để worker đồng bộ chạy đồng thời 2 job cho cùng site (jobId unique).

## 4. Module `content` (scaffold qua `/scaffold-backend-module`)

```
src/modules/content/
├── content.routes.ts        # /api/sites/:id/products, /pages ...
├── content.controller.ts
├── content.service.ts       # ghi cms_core + enqueue content-sync
├── content.repository.ts    # site_products / site_pages / site_media
├── content.schema.ts        # Zod (xem furniture-template skill cho Product)
└── content.test.ts
```

`content.service.create()` =  validate → INSERT `site_products` (`sync_status='pending'`)
→ `auditLogs` → `enqueueContentSync({ siteId, entity:'product', entityId, op:'upsert' })`.

## 5. Worker `content-sync` (skeleton)

```ts
// src/workers/content-sync.worker.ts
const Job = z.object({
  siteId:  z.number().int().positive(),
  entity:  z.enum(['product', 'page', 'settings']).optional(),
  entityId:z.number().int().positive().optional(),
  op:      z.enum(['upsert', 'delete', 'full-resync']),
});

new Worker('content-sync', withMetrics(async (job) => {
  const { siteId, entity, entityId, op } = Job.parse(job.data);
  const site = await sitesRepo.findById(siteId);
  const wp = wpPluginClient(site);            // HMAC client, base = https://<domain>/wp-json/ai-builder/v1

  if (op === 'full-resync') {
    for (const p of await contentRepo.listProducts(siteId)) await syncProduct(wp, p);
    return;
  }
  if (op === 'delete') { await wp.delete(`/content/products/${slug}`); return; }
  await syncProduct(wp, await contentRepo.getProduct(entityId));
}), { connection: redis, concurrency: 2, lockDuration: 5 * 60_000 });

async function syncProduct(wp, p) {
  // 1. media: ảnh chưa có wp_attachment_id → POST /media/upload, lưu lại
  // 2. POST /content/products (upsert theo slug) → nhận wp_post_id
  // 3. UPDATE site_products SET wp_post_id=?, sync_status='synced', synced_at=NOW()
  // 4. POST /cache/flush
}
```

Enqueue: `jobId: \`content-sync:${siteId}\`` để 1 site chỉ 1 job sync chạy.

## 6. Idempotency

- WP upsert theo `slug` → gọi lại không tạo post trùng.
- Worker re-run: ảnh đã có `wp_attachment_id` → skip upload (Pattern B,
  `queue-workers.md`).
- Job fail giữa chừng → `sync_status` vẫn `pending` → re-run hoàn tất nốt.

## 7. Anti-pattern

❌ Ghi thẳng `wp_posts` qua MySQL connection — phá HMAC, phá audit, phá cache.

❌ HTTP handler `await` cả luồng sync → request treo 30s+.

❌ Upload lại toàn bộ ảnh mỗi lần sync → chậm + đầy `wp_uploads`. Dedup `sha256`.

❌ Xoá cứng row `site_products` → mất audit, không khôi phục được.

❌ Quên lưu `wp_post_id` trả về → lần sync sau tạo post mới = trùng sản phẩm.

## 8. Test must-pass

- [ ] Tạo product → `site_products` có row `sync_status='pending'`.
- [ ] Worker chạy → product lên WP, `wp_post_id` được lưu, `sync_status='synced'`.
- [ ] Chạy sync 2 lần → WP chỉ 1 product (idempotent).
- [ ] Sửa product → re-sync update đúng post cũ, không tạo mới.
- [ ] Xoá product → WP trash post, `cms_core` `status='archived'`.
- [ ] Xoá DB WP rồi `full-resync` → nội dung khôi phục đầy đủ từ `cms_core`.
