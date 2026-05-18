---
name: create-template
description: Tạo hoặc import một template website mới (theme + DB dump + manifest). Dùng khi user nói "tạo template <X>", "import template", "thêm theme mới", hoặc viết code module templates. Đọc docs/template-system.md trước.
---

# Skill: Create Template

## 1. Khi nào dùng

- Tạo template mới từ scratch (designer ship theme).
- Import template từ zip/git repo lên hệ thống.
- Viết module `templates` trong backend.
- Viết worker `template-import`.

## 2. Pre-read

- `docs/template-system.md`
- `docs/furniture-template.md` (template mẫu)
- `docs/wordpress-plugin.md` mục 5 (Upsert page)

## 3. Output checklist khi tạo template mới

```
templates/<slug>/
├── template.json
├── db_dump.sql          # đã sanitize URL → {{SITE_URL}}
├── theme/               # folder copy vào wp-content/themes/
├── plugins/             # plugin phụ thuộc (nếu có)
├── uploads/             # media mặc định, tối ưu webp
├── preview.png          # 1280x800
└── README.md
```

`template.json` phải pass JSON schema (xem `docs/template-system.md` mục 2).

## 4. Quy trình thực tế

1. Khởi tạo 1 site WP sạch ở `/var/www/html/sites/template-${slug}.local`.
2. Cài theme, plugins, set up content mẫu.
3. Test thủ công: home + 1 trang chi tiết product + form contact.
4. Export DB:
   ```bash
   wp --path=<site> db export db_dump.sql --add-drop-table --default-character-set=utf8mb4
   ```
5. Sanitize URL:
   ```bash
   wp --path=<site> search-replace 'https://template-furniture.local' '{{SITE_URL}}' --all-tables --skip-columns=guid --export=db_dump_clean.sql
   ```
6. Copy theme:
   ```bash
   cp -r <site>/wp-content/themes/<theme> templates/<slug>/theme/
   ```
7. Tối ưu uploads: `cwebp` mọi ảnh > 100KB.
8. Viết `template.json` đầy đủ `fields[]` cho UI form.
9. Test import lại: dùng worker `template-import` → tạo site test → smoke pass.

## 5. Worker `template-import` (TypeScript)

```ts
new Worker('template-import', async (job) => {
  const { source, slug } = z.object({
    source: z.union([
      z.object({ type: z.literal('git'), repo: z.string(), ref: z.string() }),
      z.object({ type: z.literal('zip'),  path: z.string() }),
    ]),
    slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  }).parse(job.data);

  const stagingDir = `/var/lib/cms/staging/${slug}-${Date.now()}`;
  try {
    if (source.type === 'git')  await run('git', ['clone', '--depth=1', '-b', source.ref, source.repo, stagingDir]);
    else                        await run('unzip', [source.path, '-d', stagingDir]);

    const manifest = JSON.parse(await fs.readFile(`${stagingDir}/template.json`, 'utf8'));
    validateManifest(manifest);

    const finalDir = `/var/lib/cms/templates/${slug}`;
    if (await fs.exists(finalDir)) await run('rm', ['-rf', finalDir]);
    await run('mv', [stagingDir, finalDir]);

    await templatesRepo.upsert({
      slug: manifest.slug,
      manifest,
      local_path: finalDir,
      version: manifest.version,
      status: 'ready',
    });
  } catch (err) {
    await templatesRepo.markFailed(slug, String(err));
    await run('rm', ['-rf', stagingDir]).catch(() => {});
    throw err;
  }
});
```

## 6. Validation `template.json` (ajv)

Schema phải kiểm:
- `slug` regex `^[a-z][a-z0-9-]*$`.
- `version` semver.
- `db_dump` file tồn tại.
- `theme.path` folder tồn tại.
- `preview_image` tồn tại.
- `fields[].key` unique.
- `fields[].type` ∈ `string|richtext|url|email|color|image|number|boolean`.

## 7. Quy tắc về sample data

- KHÔNG dùng tên thật, SĐT thật, ảnh có watermark/license cấm.
- Comments sample: max 3 cái, content "Lorem ipsum".
- Users dump: chỉ 1 admin `template-admin` (worker DROP USER này khi import xong và tạo user thật cho site).

## 8. Anti-pattern

❌ `sed -i s/oldurl/newurl/g` thay search-replace WP-CLI → corrupt Elementor data.

❌ Commit binary lớn (video) vào git template → repo phình; dùng Git LFS hoặc S3 link.

❌ Hardcode `plugins/elementor` vào template thay vì khai báo trong `plugins_required` → license/version conflict.

## 9. Test must-pass

- [ ] `ajv validate template.json`.
- [ ] Import template → tạo site test → home 200.
- [ ] Apply 1 set `fields` qua plugin → reflect trên site.
- [ ] Lighthouse mobile ≥ 80 trên homepage template.
