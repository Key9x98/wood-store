# Runbook: SSL Certificate Renewal Failure

## Symptoms

- Alert `cert_expires_in < 7d`
- `curl https://<domain>` reports expired cert hoặc `SSL_ERROR_DATE_INVALID`
- Browser warning về cert
- Cron `certbot.timer` đã chạy nhưng cert chưa update (`/etc/letsencrypt/live/<domain>/cert.pem` mtime cũ)

## Severity

- **Cert expired** trên site production → **P1** (page on-call)
- **Cert sắp expired (< 24h)** → **P2**
- **Cert > 7d** + cảnh báo từ renewal → **P3**

## Triage

```bash
# 1. Cert hiện tại expired?
openssl s_client -connect <DOMAIN>:443 -servername <DOMAIN> </dev/null 2>/dev/null \
  | openssl x509 -noout -dates

# 2. Certbot timer status
systemctl status certbot.timer
journalctl -u certbot.timer -n 50 --no-pager

# 3. Lần thử renewal gần nhất
tail -100 /var/log/letsencrypt/letsencrypt.log

# 4. Domain còn point về SERVER_IP?
dig +short A <DOMAIN> @1.1.1.1

# 5. Let's Encrypt rate limit?
# Check Cloudflare CT / crt.sh xem có vượt 50 cert/tuần per registered domain
```

## Mitigation

### Case A — DNS không còn point về SERVER_IP

DNS bị đổi → renewal fail vì HTTP-01 challenge không reach.

```bash
# Re-upsert A record qua Cloudflare API hoặc Express CMS UI
curl -X POST https://<CMS_HOST>/api/sites/<id>/repair-dns \
  -H "authorization: Bearer <admin-token>"
```

Đợi 60s TTL → retry renewal:

```bash
certbot renew --cert-name <DOMAIN> --force-renewal --non-interactive
systemctl reload nginx
```

### Case B — Let's Encrypt rate-limited

LE giới hạn 50 certs/week per registered domain (subdomain riêng tốn slot).

1. Confirm: `tail -50 /var/log/letsencrypt/letsencrypt.log | grep -i "too many"` cho thấy "Error creating new order :: too many certificates"
2. **Mitigation**: extend bằng cách dùng staging (test) hoặc đợi window reset
3. Cert hiện tại còn valid? Để site chạy đến khi window mở lại
4. Nếu cert đã expired:
   - Use existing chain cũ tạm thời (`--keep-until-expiring`)
   - Tạm thời chấp nhận warning, fix gốc: giảm số provision/week

### Case C — Nginx config broken khi renew

```bash
nginx -t
# fix lỗi config → reload
systemctl reload nginx
certbot renew --cert-name <DOMAIN>
```

### Case D — Certbot bug / disk space

```bash
df -h /etc/letsencrypt
# nếu disk full → cleanup logs trước
journalctl --vacuum-time=7d
# retry
certbot renew --cert-name <DOMAIN>
```

## Recovery verification

```bash
# Expiry phải > 60 ngày tính từ nay
openssl s_client -connect <DOMAIN>:443 -servername <DOMAIN> </dev/null 2>/dev/null \
  | openssl x509 -noout -enddate

# HTTPS site healthy
curl -sS -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/

# CMS smoke test
curl -sS https://<DOMAIN>/wp-json/ai-builder/v1/health \
  -H "X-AIB-Timestamp: $(date +%s)" \
  -H "X-AIB-Signature: <signed>"
```

## Postmortem follow-up

- [ ] Cập nhật alert threshold (nếu phát hiện muộn)
- [ ] Renewal failure metric `cms_ssl_renewal_fail_total` increment?
- [ ] Có pattern multi-site fail cùng lúc → vấn đề hệ thống (provider down, rate limit)
- [ ] Document root cause vào `docs/incidents/<date>-cert.md`

## References

- Let's Encrypt rate limits: <https://letsencrypt.org/docs/rate-limits/>
- Certbot docs: <https://eff-certbot.readthedocs.io/>
- Backend code: `backend/src/modules/ssl/ssl.service.ts`
