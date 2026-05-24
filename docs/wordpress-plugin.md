# WordPress Plugin: `ai-builder-plugin`

Plugin riêng cài trên mọi site WordPress để Express CMS điều khiển từ xa.

---

## 1. Mục đích

- Expose REST API riêng cho Express CMS gọi vào.
- Đồng bộ content (pages/posts/products) từ Express → WP.
- Trigger Elementor render lại sau khi đổi data.
- Upload media nhận từ Express.
- Healthcheck endpoint cho smoke test.

KHÔNG cho phép user cuối edit qua plugin này. Đây là plugin **system**, ẩn khỏi UI admin (chỉ super-admin nhìn thấy).

> Plugin này là **cầu nối DUY NHẤT** giữa Express và 1 site. Express không bao
> giờ kết nối thẳng vào DB `wp_<domain>` để ghi nội dung — mọi thay đổi đi qua
> các REST endpoint dưới đây. Xem mô hình control-plane/render-plane ở
> `docs/site-management.md`.

---

## 2. Cấu trúc plugin

```
ai-builder-plugin/
├── ai-builder-plugin.php       # plugin header + bootstrap
├── composer.json
├── src/
│   ├── Plugin.php              # main class, singleton
│   ├── Rest/
│   │   ├── RouteRegistrar.php
│   │   ├── HealthController.php
│   │   ├── ContentController.php
│   │   ├── MediaController.php
│   │   ├── FieldsController.php
│   │   └── ElementorController.php
│   ├── Auth/
│   │   └── HmacAuthenticator.php
│   ├── Services/
│   │   ├── ContentSync.php
│   │   ├── MediaImporter.php
│   │   └── ElementorBridge.php
│   └── Support/
│       └── Logger.php
├── tests/
└── readme.txt
```

---

## 3. Authentication

Mỗi site có 1 shared secret (Express lưu trong `sites.plugin_secret`, plugin lưu trong `wp_options.ai_builder_secret`). Generate khi provision.

Express gọi với header:
```
X-AIB-Timestamp: 1715000000
X-AIB-Signature: hex( hmac_sha256(secret, timestamp + "\n" + method + "\n" + path + "\n" + body) )
```

Plugin:
- Reject nếu `|now - timestamp| > 300s`.
- So sánh signature constant-time (`hash_equals`).
- Reject nếu IP không nằm trong whitelist (option `ai_builder_allowed_ips`).

---

## 4. REST endpoints (namespace `ai-builder/v1`)

| Method | Path | Mục đích |
|---|---|---|
| GET | `/health` | Liveness, trả về version + DB OK |
| POST | `/content/pages` | Upsert page (slug, title, content, meta) |
| GET | `/content/products` | List product (slug + id) — dùng cho reconciliation |
| POST | `/content/posts` | Upsert post |
| POST | `/content/products` | Upsert WooCommerce product |
| DELETE | `/content/products/:slug` | Trash product theo slug (cho luồng xoá) |
| POST | `/media/upload` | Upload ảnh — multipart `file` HOẶC JSON `{source_url}` (sideload từ URL); trả `attachment_id` + url |
| POST | `/fields` | Update `ai_builder_fields` option |
| GET | `/themes` | List theme đã cài (slug, version, active) |
| POST | `/themes/activate` | Kích hoạt theme theo slug (đổi template) |
| POST | `/elementor/rebuild` | Trigger Elementor regenerate CSS |
| POST | `/cache/flush` | Flush WP cache + page cache plugin |
| GET | `/status` | Trả về theme, plugin list, WP version |

`/themes*` do `ThemesController.php` + `Services/ThemeManager.php` xử lý — phục
vụ luồng "đổi template cho site đang chạy" (xem `site-management.md §5`). Mọi
route đều qua `permission_callback => HmacAuthenticator::verify`.

Mỗi endpoint:
- `permission_callback => [HmacAuthenticator::class, 'verify']`
- Validate input bằng `args` schema.
- Trả về `WP_REST_Response` với JSON envelope `{ ok: true, data: ... }`.

---

## 5. Upsert page logic

```php
// ContentController::upsertPage($req)
$slug = sanitize_title($req['slug']);
$existing = get_page_by_path($slug);
$args = [
    'post_type'    => 'page',
    'post_status'  => 'publish',
    'post_title'   => $req['title'],
    'post_content' => $req['content'],
    'post_name'    => $slug,
    'meta_input'   => $req['meta'] ?? [],
];
if ($existing) {
    $args['ID'] = $existing->ID;
}
$id = wp_insert_post($args, true);
```

Idempotent: 2 lần gọi cùng slug → 1 page duy nhất, content overwrite.

---

## 6. Elementor integration

Khi Express update content có Elementor data:

```php
update_post_meta($postId, '_elementor_data', wp_slash($elementorJson));
update_post_meta($postId, '_elementor_edit_mode', 'builder');
update_post_meta($postId, '_elementor_template_type', 'wp-page');

// trigger regenerate
\Elementor\Plugin::$instance->files_manager->clear_cache();
\Elementor\Plugin::$instance->posts_css_manager->clear_cache();
```

Wrap trong try/catch — nếu Elementor chưa active, fail mềm.

---

## 7. Media upload

```php
// MediaController::upload($req)
$file = $req->get_file_params()['file'];
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

$attachmentId = media_handle_sideload($file, 0);
if (is_wp_error($attachmentId)) return error_response($attachmentId);

return ok([
    'id'  => $attachmentId,
    'url' => wp_get_attachment_url($attachmentId),
]);
```

Reject MIME ngoài whitelist (image/*, video/mp4, application/pdf).
Limit size 50MB qua nginx `client_max_body_size`.

---

## 8. Logging

Plugin log vào `wp-content/uploads/ai-builder-logs/YYYY-MM-DD.log` (rotation hằng ngày, giữ 14 ngày). Mỗi log line JSON:

```json
{"ts":"...","level":"info","route":"/content/pages","status":200,"duration_ms":42}
```

Không log secret, không log body request lớn.

---

## 9. Cài đặt khi provision

Worker `ProvisionWorker` ở bước G chạy:

```bash
sudo -u www-data wp --path=${siteRoot} plugin install ${pluginZipPath} --activate
sudo -u www-data wp --path=${siteRoot} option update ai_builder_secret "${secret}"
sudo -u www-data wp --path=${siteRoot} option update ai_builder_allowed_ips "${EXPRESS_IPS}"
```

`pluginZipPath` = artefact build sẵn (CI build từ source plugin).

---

## 10. Versioning

- Plugin theo semver. Header `Version: 1.2.3` trong file `ai-builder-plugin.php`.
- Express lưu `plugin_version` của từng site. Endpoint `/status` trả về version.
- Update plugin qua worker `deploy:plugin-upgrade`:
  1. Download zip mới.
  2. `wp plugin update --activate-network ai-builder-plugin`.
  3. Smoke test `/health`.
  4. Nếu fail: `wp plugin install <old-zip> --activate`.

---

## 11. Security checklist

- [ ] Nonce / HMAC bắt buộc trên mọi route.
- [ ] Không expose endpoint public, mọi route đều yêu cầu auth.
- [ ] Sanitize: `sanitize_text_field`, `wp_kses_post`, `esc_url_raw`.
- [ ] Capability check khi gọi vào hàm WP admin.
- [ ] Không `eval`, không `unserialize` user input.
- [ ] Disable XML-RPC nếu không dùng: option `xmlrpc_enabled = false`.
