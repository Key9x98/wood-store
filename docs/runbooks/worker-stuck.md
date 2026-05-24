# Runbook: Worker Stuck / Stalled Jobs

## Symptoms

- `cms_bullmq_jobs{state="active"}` plateau cao trong > 10 phút
- Site stuck ở status `provisioning` không tiến lên `active` / `failed`
- BullMQ event `stalled` log spam
- `provision_state.steps[X].done = false` cho step quá lâu (`at` cũ > 10min)
- New jobs vẫn enqueue được nhưng không pick up

## Severity

- **All workers idle, queue depth > 50** → **P1**
- **Single job stalled** → **P2** (job sẽ retry tự động)
- **Throughput chậm đáng kể** → **P3**

## Triage

```bash
# 1. Worker process còn alive?
systemctl status cms-worker-provision cms-worker-template-import cms-worker-rollback
ps aux | grep -E "worker:provision|worker:rollback|worker:template-import" | grep -v grep

# 2. CPU / memory of worker process
top -p $(pgrep -f "worker:provision")

# 3. Lock state (Redis BullMQ keys)
redis-cli --scan --pattern "bull:provision:*" | head -20
redis-cli HGETALL "bull:provision:<jobId>"

# 4. Stalled jobs
redis-cli ZRANGE "bull:provision:stalled" 0 -1 WITHSCORES | head

# 5. Worker logs — gần đây có error chưa swallow?
journalctl -u cms-worker-provision -n 200 --no-pager | tail -100

# 6. Lock duration vs actual step time
# Step C (clone) lâu nhất ~ 30-60s. Step E (import dump) ~ 1-3 phút.
# lockDuration = 10 * 60_000 = 10min — đủ với mọi step.
```

## Mitigation

### Case A — Worker process crashed silently

```bash
# Restart workers (graceful)
systemctl restart cms-worker-provision

# Watch logs khi worker boot lại
journalctl -u cms-worker-provision -f
```

Khi worker restart, BullMQ tự pick up stalled jobs sau `stalledInterval` (default 30s).

### Case B — Job stuck do step `runShell` hang

Một số shell command có thể hang vô hạn nếu network/disk fail nhưng không timeout. Examples:
- `git clone` template lớn từ slow mirror (worker `template-import`)
- copy WP core (`fs.cp`) khi disk I/O nghẽn (worker `provision`, step C)
- `mysql` import dump với foreign key check loop
- `certbot` chờ HTTP-01 callback mà DNS chưa propagate

```bash
# Identify hung child process
ps -ef --forest | grep -A 5 "worker:provision"

# Kill specific child (KHÔNG kill worker parent)
kill -9 <hung-pid>
```

Worker sẽ thấy `execFile` lỗi → step throws → rollback enqueue.

**Long-term**: mọi `runShell` MUST có timeout option set. Audit:
```bash
grep -rn "runShell\|run(" backend/src/ --include="*.ts" | grep -v "timeout"
```

### Case C — Lock chiếm bởi worker đã chết

BullMQ assigns lock với worker token. Nếu worker chết không cleanup → lock orphan đến hết `lockDuration`.

```bash
# Force release lock + move job back to waiting
node -e "
  const {Queue} = require('bullmq');
  const Redis = require('ioredis');
  const conn = new Redis(process.env.REDIS_URL);
  const q = new Queue('provision', {connection: conn});
  await q.getJob('<jobId>').then(j => j?.moveToWait('forced-reclaim'));
  await conn.quit();
"
```

### Case D — siteId job duplicate / unique conflict

Nếu job được enqueue với `jobId: 'site:<id>'` nhưng job cũ chưa cleanup → BullMQ reject silent.

```bash
# Inspect
redis-cli HGETALL "bull:provision:site:<siteId>"
# Status field cho biết job đang ở waiting/active/completed/failed

# Manual remove + re-enqueue
redis-cli DEL "bull:provision:site:<siteId>"
curl -X POST https://<CMS_HOST>/api/sites/<id>/retry-provision \
  -H "authorization: Bearer <admin>"
```

### Case E — Worker too slow (legitimate workload)

```bash
# Bump concurrency
systemctl edit cms-worker-provision
# Environment="WORKER_CONCURRENCY=4"   (default 2)
systemctl restart cms-worker-provision

# Or scale horizontally: add another worker host
```

Cảnh báo: tăng concurrency → tăng pressure lên MySQL/Cloudflare API/disk. Monitor `cms_provision_total{result="failed"}` để tránh tăng error rate.

## Recovery verification

```bash
# 1. Active count back to baseline (< concurrency)
curl -sS https://<CMS_HOST>/metrics | grep 'queue="provision",state="active"'

# 2. Process specific stuck site
SITE_ID=42
mysql --defaults-extra-file=/etc/mysql/root.cnf cms_core -e \
  "SELECT id, domain, status, provision_state->'$.steps' FROM sites WHERE id=${SITE_ID}\G"
# Expect: status='active' và mọi step done=true

# 3. Throughput baseline
# Provision count completed trong 1h gần
curl -sS https://<CMS_HOST>/metrics | grep 'cms_provision_total{result="success"}'
```

## Postmortem follow-up

- [ ] Add timeout cho mọi `runShell` call (audit grep)
- [ ] BullMQ `removeOnComplete` configured đủ ngắn để Redis không phình?
- [ ] Alert: `cms_bullmq_jobs{state="active"}` > 0 trong > 30min cùng job
- [ ] Worker health endpoint `/worker/healthz` (nội bộ) trả số job picked up gần đây

## References

- BullMQ stalled docs: <https://docs.bullmq.io/guide/jobs/stalled>
- Backend code: `backend/src/workers/provision.worker.ts`, `backend/src/modules/provision/provision.orchestrator.ts`
