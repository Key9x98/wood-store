# Runbooks

Incident playbooks. Mỗi runbook follow template:

1. **Symptoms** — Cách phát hiện
2. **Severity / pager** — Mức ưu tiên + ai page
3. **Triage** — Lệnh nhanh để xác định scope
4. **Mitigation** — Restore service ASAP (band-aid trước, fix gốc sau)
5. **Recovery verification** — Confirm khôi phục
6. **Postmortem follow-up** — Items để follow up

## Danh sách

| Runbook | Tag |
|---|---|
| [`cert-renewal-fail.md`](./cert-renewal-fail.md) | Let's Encrypt cert renewal lỗi |
| [`redis-down.md`](./redis-down.md) | Redis unreachable (queue + readyz fail) |
| [`db-down.md`](./db-down.md) | MySQL cms_core / WP site DB down (OOM, disk full, recovery) |
| [`dns-provider-down.md`](./dns-provider-down.md) | Cloudflare API down / rate-limited / token revoked |
| [`worker-stuck.md`](./worker-stuck.md) | BullMQ worker stalled, lock orphan, slow throughput |
| [`plugin-auth-fail.md`](./plugin-auth-fail.md) | HMAC 401 (secret mismatch, clock skew, IP whitelist) |

## Quy tắc viết runbook

- Trang con 1 trang in (~600 dòng max).
- Lệnh shell paste-ready. Đánh dấu rõ chỗ điền (`<DOMAIN>`, `<SERVICE>`).
- Mỗi mitigation phải có rollback nếu fail.
- Verify command cụ thể, không "kiểm tra service".
- Update sau mỗi incident — runbook stale là vô dụng.
