# Runbook: Redis Down

## Symptoms

- Alert `cms_bullmq_jobs` không update / metric scrape fail
- `GET /readyz` trả 503
- Worker logs spam `MaxRetriesPerRequestError` / `ECONNREFUSED`
- Job mới enqueue fail với "Redis is not connected"
- Site provision request không advance khỏi status `queued`

## Severity

- **Production Redis down** → **P1** (page on-call ngay)
- **Worker can't pick up queue** (process running, Redis flapping) → **P2**

## Triage

```bash
# 1. Redis process alive?
systemctl status redis-server
redis-cli -h 127.0.0.1 -p 6379 ping  # expect PONG

# 2. Memory pressure?
redis-cli info memory | grep -E 'used_memory_human|maxmemory_human'

# 3. Latency
redis-cli --latency

# 4. Connection count
redis-cli info clients | grep connected_clients

# 5. Disk (AOF/RDB)
df -h /var/lib/redis
ls -lh /var/lib/redis/

# 6. Worker side
systemctl status cms-worker-provision cms-worker-template-import cms-worker-rollback
journalctl -u cms-worker-provision -n 100 --no-pager
```

## Mitigation

### Case A — Redis process crashed

```bash
systemctl start redis-server
# Wait for healthy
until redis-cli ping; do sleep 1; done

# Restart workers (graceful — finish in-flight jobs)
systemctl restart cms-worker-provision cms-worker-template-import cms-worker-rollback
```

### Case B — Out of memory

Trên prod default `maxmemory` không set → Redis sẽ OOM-killed bởi kernel khi RAM cạn.

```bash
# Inspect biggest keys
redis-cli --bigkeys

# Clear failed jobs (older than 7d) — built into BullMQ but may have backlog
# From a worker host:
node -e "const Q=require('bullmq');new Q.Queue('provision').clean(7*86400*1000,1000,'failed')"

# Set memory cap + LRU policy
redis-cli config set maxmemory 2gb
redis-cli config set maxmemory-policy allkeys-lru
# Persist config:
sed -i 's/^# maxmemory .*/maxmemory 2gb/' /etc/redis/redis.conf
sed -i 's/^# maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
```

### Case C — AOF / RDB corruption

```bash
# Stop service
systemctl stop redis-server

# Backup current state
cp -a /var/lib/redis /var/lib/redis.bak.$(date +%s)

# Try AOF rewrite
redis-check-aof --fix /var/lib/redis/appendonly.aof
# Or fall back to last good RDB
ls -lt /var/lib/redis/*.rdb

systemctl start redis-server
redis-cli ping
```

### Case D — Network partition (cluster / managed Redis)

1. Verify route từ app host: `tcptraceroute <REDIS_HOST> 6379`
2. Check security group / firewall rules
3. Failover to replica if cluster: `redis-cli failover`

### Emergency degraded mode

Express CMS chỉ cần Redis cho queue + readiness. Nếu Redis hỏng:

- Disable `/readyz` (k8s/LB sẽ pull instance khỏi rotation — ý chí của ta để chỉ user-facing API down, KHÔNG cho enqueue mới)
- HTTP API read endpoints (`GET /api/sites`) vẫn hoạt động (chỉ dùng MySQL)
- Provision worker tự reconnect khi Redis up lại

## Recovery verification

```bash
# 1. Redis healthy
redis-cli ping
redis-cli info replication

# 2. /readyz
curl -fsS https://<CMS_HOST>/readyz | jq .

# 3. Queue depth back to expected baseline
curl -sS https://<CMS_HOST>/metrics | grep cms_bullmq_jobs

# 4. End-to-end: enqueue test provision
curl -X POST https://<CMS_HOST>/api/sites \
  -H "authorization: Bearer <admin>" \
  -H "content-type: application/json" \
  -d '{"domain":"smoke-test.example.com","templateId":1}'
# Expect: 201 with site.id; worker picks up within 10s
```

## Postmortem follow-up

- [ ] Set `maxmemory` + `maxmemory-policy` nếu chưa
- [ ] Monitoring: alert khi `used_memory > 80%` 
- [ ] Bật AOF + RDB cùng lúc (durability)
- [ ] Document peak queue depth lúc incident
- [ ] Worker `lockDuration` đủ dài cho longest step? (provision = 10min)

## References

- BullMQ docs: <https://docs.bullmq.io/>
- Redis docs: <https://redis.io/docs/>
- Backend code: `backend/src/lib/redis.ts`, `backend/src/queues/`
