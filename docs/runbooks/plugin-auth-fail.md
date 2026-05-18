# Runbook: Plugin HMAC Auth Failures

## Symptoms

- Express CMS log: spam `pluginClient: HTTP 401` khi call vào WP site
- WP plugin log (`wp-content/uploads/ai-builder-logs/YYYY-MM-DD.log`): nhiều entries `route=/wp-json/ai-builder/v1/...` status=401
- Smoke test step J fails consistently với 401
- Site stuck ở status `provisioning` sau step I (SSL) hoặc bị mark `failed` ở step J

## Severity

- **All sites đồng loạt 401** → **P1** (key rotation issue toàn cục)
- **Single site 401** → **P2** (secret mismatch riêng)
- **Sporadic 401** → **P3** (clock skew, signing bug)

## Triage

```bash
# 1. Sample signed request manually
DOMAIN=abc.example.com
SECRET=$(mysql --defaults-extra-file=/etc/mysql/root.cnf cms_core -se \
  "SELECT plugin_secret_enc FROM sites WHERE domain='${DOMAIN}'")
# decrypt qua node helper:
node -e "
  const {decrypt} = require('/opt/cms/backend/dist/lib/crypto');
  console.log(decrypt(process.argv[1]));
" "${SECRET}"

# 2. Compute expected signature
TS=$(date +%s)
PATH_=/wp-json/ai-builder/v1/health
BODY=""
EXPECTED=$(printf "%s\n%s\n%s\n%s" "${TS}" "GET" "${PATH_}" "${BODY}" \
  | openssl dgst -sha256 -hmac "${PLAIN_SECRET}" -hex | awk '{print $2}')

# 3. Call WP
curl -sSi "https://${DOMAIN}${PATH_}" \
  -H "X-AIB-Timestamp: ${TS}" \
  -H "X-AIB-Signature: ${EXPECTED}"
# 200 = HMAC OK; 401 = mismatch

# 4. Compare secret on WP side
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} option get ai_builder_secret"

# 5. WP plugin log
ssh root@<vps> "tail -50 /var/www/html/sites/${DOMAIN}/wp-content/uploads/ai-builder-logs/$(date +%Y-%m-%d).log"

# 6. Server clock skew
ssh root@<vps> "date -u +%s"
date -u +%s
# Diff > 5 phút → window check fail
```

## Mitigation

### Case A — Secret mismatch (single site)

CMS DB ≠ WP option.

```bash
# Re-push secret to WP
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} option update ai_builder_secret '${PLAIN_SECRET}'"

# Verify
curl -sSi "https://${DOMAIN}/wp-json/ai-builder/v1/health" \
  -H "X-AIB-Timestamp: $(date +%s)" \
  -H "X-AIB-Signature: $(compute_sig)"
```

Long-term fix: thêm endpoint `POST /api/sites/<id>/rotate-plugin-secret` trong CMS để rotate atomic (update DB + push qua REST + verify trong 1 transaction).

### Case B — Clock skew (server NTP drift)

```bash
# On VPS
timedatectl status
systemctl status systemd-timesyncd

# Force sync
sudo systemctl restart systemd-timesyncd
sudo chronyc -a makestep   # if chrony
```

Plugin window là 300s. Drift > 5 phút → tất cả requests 401. Yêu cầu: chrony/ntp luôn enabled.

### Case C — IP whitelist block

```bash
# Check whitelist on WP
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} option get ai_builder_allowed_ips"

# CMS host IP
CMS_IP=$(curl -sS https://ifconfig.io)

# Add to whitelist (csv)
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} option update ai_builder_allowed_ips '${CMS_IP},<existing>'"
```

### Case D — Signing bug after deployment

Nếu Express CMS deploy mới gây regression signing algorithm:

```bash
# Diff git log signing helper
cd /opt/cms/backend && git log --oneline -- src/lib/jwt.ts src/modules/*/plugin-client.ts | head

# Rollback Express deployment
systemctl stop cms-api
cd /opt/cms/backend && git checkout <previous-tag>
pnpm install --frozen-lockfile
pnpm build
systemctl start cms-api
```

Test cases (`backend/src/...test.ts`) phải có HMAC sign/verify round-trip.

### Case E — Plugin version downgrade / corruption

```bash
# Check version
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} plugin get ai-builder-plugin"

# Reinstall from artefact
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} plugin install /tmp/ai-builder-plugin-0.1.0.zip --activate --force"

# Re-push secret (plugin install có thể reset option)
ssh root@<vps> "wp --path=/var/www/html/sites/${DOMAIN} option update ai_builder_secret '${PLAIN_SECRET}'"
```

## Recovery verification

```bash
# 1. Smoke test signed call
curl -fsS "https://${DOMAIN}/wp-json/ai-builder/v1/health" \
  -H "X-AIB-Timestamp: $(date +%s)" \
  -H "X-AIB-Signature: $(compute_sig)" | jq .data.db_ok
# expect true

# 2. CMS-side bulk verify (against N random sites)
node /opt/cms/backend/scripts/verify-all-plugin-secrets.js

# 3. No more 401 spam in last 5min
journalctl -u cms-api --since="5 minutes ago" | grep -c "pluginClient.*401"
# expect 0
```

## Postmortem follow-up

- [ ] Implement `/api/sites/<id>/rotate-plugin-secret` endpoint
- [ ] NTP monitoring → alert nếu drift > 30s
- [ ] HMAC sign/verify round-trip integration test (currently chỉ test plugin side)
- [ ] Plugin install hook ensure secret persists qua update
- [ ] Metric: `cms_plugin_auth_fail_total{site_id}` để alert per-site

## References

- Plugin HMAC contract: `docs/wordpress-plugin.md` §3
- Plugin auth code: `plugin/ai-builder-plugin/src/Auth/HmacAuthenticator.php`
- Backend signer (TODO milestone 9): `backend/src/modules/wordpress/plugin-client.ts`
