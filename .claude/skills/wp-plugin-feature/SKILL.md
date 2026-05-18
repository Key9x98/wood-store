---
name: wp-plugin-feature
description: Thêm một feature/endpoint vào WordPress plugin ai-builder-plugin (REST route + service + auth + test). Dùng khi user nói "thêm endpoint plugin", "WP plugin support X", "sync <Y> từ Express xuống WP". Đọc docs/wordpress-plugin.md trước.
---

# Skill: WP Plugin Feature

## 1. Khi nào dùng

- Thêm REST endpoint mới vào `ai-builder-plugin`.
- Thêm hook vào lifecycle WP (save_post, init).
- Đồng bộ data type mới từ Express → WP.

## 2. Pre-read

- `docs/wordpress-plugin.md` (toàn file).
- `docs/security-checklist.md` mục 6 (Plugin auth HMAC).

## 3. Workflow thêm 1 REST endpoint

### Bước 1 — Controller class

```php
<?php
namespace AiBuilder\Rest;

use WP_REST_Request;
use WP_REST_Response;
use AiBuilder\Auth\HmacAuthenticator;

class FooController {
    public function register(): void {
        register_rest_route('ai-builder/v1', '/foo', [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle'],
            'permission_callback' => [HmacAuthenticator::class, 'verify'],
            'args' => [
                'name' => [
                    'required' => true,
                    'type'     => 'string',
                    'sanitize_callback' => 'sanitize_text_field',
                ],
            ],
        ]);
    }

    public function handle(WP_REST_Request $req): WP_REST_Response {
        $name = $req->get_param('name');
        // do work...
        return new WP_REST_Response(['ok' => true, 'data' => ['name' => $name]], 200);
    }
}
```

### Bước 2 — Đăng ký trong `RouteRegistrar`

```php
add_action('rest_api_init', function () {
    (new FooController())->register();
    // ...
});
```

### Bước 3 — Service (business logic tách khỏi controller)

```php
namespace AiBuilder\Services;

class FooService {
    public function doIt(string $name): array {
        // wp_insert_post / update_option / ...
    }
}
```

Controller chỉ parse + return; service chứa logic.

### Bước 4 — Test

```php
// tests/Rest/FooControllerTest.php (PHPUnit + Brain Monkey hoặc WP_UnitTestCase)
class FooControllerTest extends \WP_UnitTestCase {
    public function test_creates_foo() {
        $request = new \WP_REST_Request('POST', '/ai-builder/v1/foo');
        $request->set_param('name', 'hello');
        $request->set_header('X-AIB-Timestamp', (string) time());
        $request->set_header('X-AIB-Signature', $this->sign($request));

        $response = rest_do_request($request);
        $this->assertSame(200, $response->get_status());
    }
}
```

## 4. Quy tắc bắt buộc

- ✅ Mọi route có `permission_callback => HmacAuthenticator::verify`.
- ✅ Mọi input có `sanitize_callback`.
- ✅ Trả `WP_REST_Response`, không `wp_send_json_*` trực tiếp.
- ✅ Trả envelope `{ ok: true, data: ... }` hoặc `{ ok: false, error: { code, message } }`.
- ✅ Log mỗi request qua `AiBuilder\Support\Logger`.
- ❌ KHÔNG dùng `$_POST/$_GET` — luôn qua `$req->get_param()`.
- ❌ KHÔNG `eval`, `extract`, `unserialize` trên input.
- ❌ KHÔNG echo trước khi return response.

## 5. HMAC auth contract

```
X-AIB-Timestamp: <unix>
X-AIB-Signature: hex(hmac_sha256(secret, ts + "\n" + method + "\n" + path + "\n" + body))
```

Verify:
```php
$secret = get_option('ai_builder_secret');
$expected = hash_hmac('sha256', $ts . "\n" . $method . "\n" . $path . "\n" . $body, $secret);
if (!hash_equals($expected, $got)) return false;
if (abs(time() - intval($ts)) > 300) return false;
```

Bên Express phải dùng cùng layout — nếu thay đổi, đổi cả 2 phía + bump plugin version.

## 6. Idempotent upsert

```php
public function upsertPage(WP_REST_Request $req): WP_REST_Response {
    $slug = sanitize_title($req->get_param('slug'));
    $existing = get_page_by_path($slug);
    $args = [
        'post_type'   => 'page',
        'post_status' => 'publish',
        'post_title'  => sanitize_text_field($req->get_param('title')),
        'post_content'=> wp_kses_post($req->get_param('content')),
        'post_name'   => $slug,
    ];
    if ($existing) $args['ID'] = $existing->ID;
    $id = wp_insert_post($args, true);
    if (is_wp_error($id)) return $this->error($id->get_error_code(), $id->get_error_message());
    return $this->ok(['id' => $id]);
}
```

## 7. Khi thêm shortcode / block

- Shortcode: register trong `init` action; output buffer + return (KHÔNG echo).
- Gutenberg block: build với @wordpress/scripts; register PHP-side `register_block_type`.

## 8. Versioning

- Bump `Version:` header và `composer.json`.
- Test backward compat — Express có thể chạy plugin version cũ trên site cũ.
- Nếu break compat: cần migration script + cờ feature ở Express.

## 9. Anti-pattern

❌ Trả về raw HTML từ endpoint → khó parse phía Express, mất type safety.

❌ Log raw body request có chứa HMAC signature → log leak.

❌ `register_rest_route` trong constructor class (chạy quá sớm) → dùng action `rest_api_init`.

❌ Update option khổng lồ (>1MB) trong mỗi request → DB autoload chết.

## 10. Smoke test

Mỗi feature mới phải có `/wp-json/ai-builder/v1/health` vẫn 200 OK sau khi cài.
