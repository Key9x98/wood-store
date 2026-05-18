# Runbook: DNS Provider Down (Cloudflare API)

## Symptoms

- New site provision job fails at step B with `DnsError code='dns.network_error'` hoặc `dns.provider_error`
- `cms_bullmq_jobs{queue="provision",state="failed"}` tăng đột ngột
- Logs: `[CloudflareProvider] fetch ...` lặp ECONNRESET / 5xx
- Cloudflare status page: <https://www.cloudflarestatus.com/>

## Severity

- **Toàn bộ provision pipeline stuck** → **P1**
- **Sporadic / rate limited** → **P2**
- **Single zone affected** → **P3** (có thể chờ window mở)

## Triage

```bash
# 1. Test API trực tiếp từ host app
curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones?name=example.com" | jq .

# 2. Test từ ngoài (curl-able từ internet)
curl -sS https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq .

# 3. Rate-limit status
# Cloudflare returns X-RateLimit-Remaining header
curl -sIv -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  https://api.cloudflare.com/client/v4/zones 2>&1 | grep -i ratelimit

# 4. Token còn valid?
# Output từ /user/tokens/verify phải có "status":"active"

# 5. DNS provider chính (Cloudflare DNS itself) còn alive?
dig +short A example.com @1.1.1.1
```

## Mitigation

### Case A — Provider API down (Cloudflare side)

Không có quick fix. Options:

1. **Stop accepting new provision requests**: `wp option update site_provisioning_enabled false` (or admin UI flag). New provisions queue lên với status `paused`.

2. **Wait for recovery** — Cloudflare status page > 99% uptime. Average outage < 30 phút.

3. **Failover to mock**: nếu môi trường dev/staging, set `DNS_PROVIDER=mock` để unblock testing. KHÔNG dùng prod.

### Case B — Token revoked / invalid

```bash
# Verify
curl -sS https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq .

# Nếu "code":10000 → token bad. Rotate:
# 1. Generate new token via Cloudflare dashboard (Profile → API Tokens)
# 2. Update env:
echo "CLOUDFLARE_API_TOKEN=<new-token>" >> /etc/cms/.env  # use systemd EnvironmentFile
systemctl restart cms-api cms-worker-provision
```

### Case C — Rate limited (Cloudflare 1200/5min default)

Lỗi log: `dns.rate_limited`. Provider có throttle 4 req/s/zone built-in nhưng burst nhiều site cùng zone → spike.

```bash
# Drain queue tạm thời (giảm concurrency)
# Worker concurrency 2 → 1
systemctl edit cms-worker-provision
# Add Environment="WORKER_CONCURRENCY=1"
systemctl restart cms-worker-provision
```

Long-term: tăng `TokenBucketRateLimiter` capacity hoặc dùng `enterprise` Cloudflare plan.

### Case D — Specific zone không có trong account

Error `dns.zone_not_found`. Site được tạo với domain ngoài zones admin sở hữu.

```sql
-- Mark sites unfixable
UPDATE sites SET status = 'failed'
WHERE id IN (<offending ids>);
```

Document trong onboarding: trước khi tạo site, customer phải point NS về Cloudflare.

### Emergency: bypass DNS step

Nếu DNS bị stuck nhưng SSL chưa cần (provision dev), có thể skip step B tạm bằng cách patch `provision_state.steps.B` manual:

```sql
UPDATE sites
SET provision_state = JSON_SET(
  provision_state,
  '$.steps.B',
  JSON_OBJECT('done', true, 'at', NOW(), 'artefact', JSON_OBJECT('recordId', 'manual', 'zone', 'manual'))
)
WHERE id = <site_id>;
```

→ Worker khi resume sẽ skip B, đi tiếp C. **NHƯNG** site sẽ không resolve trên internet → SSL fail bước I. Chỉ dùng cho local dev.

## Recovery verification

```bash
# 1. Provider call thành công
curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  https://api.cloudflare.com/client/v4/user/tokens/verify | jq -r .success
# expect true

# 2. Provision queue drain
curl -sS https://<CMS_HOST>/metrics | grep 'queue="provision",state="waiting"'

# 3. Retry 1 failed provision
curl -X POST https://<CMS_HOST>/api/sites/<id>/retry-provision \
  -H "authorization: Bearer <admin>"
```

## Postmortem follow-up

- [ ] Multi-provider failover (Namecheap as backup)? Cost vs complexity
- [ ] Circuit breaker khi Cloudflare consecutive failures > N → pause queue auto
- [ ] Alert ngưỡng: nếu provision_total{result="failed"} rate > 50% trong 5min → page
- [ ] Verify SLO: provision latency P95 < 5min vẫn meet sau khi recover

## References

- Cloudflare API status: <https://www.cloudflarestatus.com/>
- Cloudflare API docs: <https://developers.cloudflare.com/api/>
- Backend code: `backend/src/modules/dns/cloudflare.provider.ts`, `backend/src/modules/dns/dns.rate-limiter.ts`
