# Runbook: MySQL Database Down

Covers 2 cases:

- **CMS core DB (`cms_core`)** — users, sites, templates, jobs metadata
- **WP site DB (`wp_<domain>`)** — content of 1 provisioned site

## Symptoms

### CMS core down
- `GET /readyz` trả 503 (nếu readyz check DB; currently chỉ Redis — TODO)
- Login fail với `internal_error`
- Worker provision fail step A
- Pino logs spam `PrismaClientKnownRequestError P1001 / P2024`

### WP site DB down
- 1 domain trả "Error establishing a database connection"
- Plugin `/wp-json/ai-builder/v1/health` trả `db_ok: false`
- CMS sites table không bị ảnh hưởng

## Severity

| Case | Severity |
|---|---|
| cms_core down | **P1** (toàn platform down) |
| Single WP DB down | **P2** (1 site bị ảnh hưởng) |
| Many WP DBs down | **P1** (host MySQL issue) |

## Triage

```bash
# 1. MySQL service
systemctl status mysql
mysqladmin --defaults-extra-file=/etc/mysql/root.cnf ping

# 2. Connection count
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "SHOW STATUS LIKE 'Threads_connected'"
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "SHOW VARIABLES LIKE 'max_connections'"

# 3. Slow query / lock contention
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "SHOW FULL PROCESSLIST" | head -50
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "SHOW ENGINE INNODB STATUS\G" | grep -A 5 "LATEST DETECTED DEADLOCK"

# 4. Disk space (data + binlog)
df -h /var/lib/mysql
ls -lh /var/lib/mysql/ib_logfile* 2>/dev/null

# 5. Error log
tail -200 /var/log/mysql/error.log

# 6. For single WP site:
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "SHOW DATABASES" | grep wp_
mysql --defaults-extra-file=/etc/mysql/root.cnf wp_<safe_domain> -e "SELECT 1"
```

## Mitigation

### Case A — MySQL service crashed

```bash
systemctl start mysql
# Tail until healthy
journalctl -u mysql -f
# When healthy:
mysqladmin --defaults-extra-file=/etc/mysql/root.cnf ping  # mysqld is alive
```

### Case B — `Too many connections`

```bash
# Kill long-running idle sessions
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "
  SELECT id FROM information_schema.processlist
  WHERE command='Sleep' AND time > 300
" | tail -n +2 | xargs -I{} mysql --defaults-extra-file=/etc/mysql/root.cnf -e "KILL {}"

# Bump max_connections temporarily (no restart needed)
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "SET GLOBAL max_connections = 500"

# Long-term fix: tune in /etc/mysql/mysql.conf.d/server.cnf, restart
```

### Case C — Disk full

```bash
df -h /var/lib/mysql
# Purge binlogs older than 3 days
mysql --defaults-extra-file=/etc/mysql/root.cnf -e "PURGE BINARY LOGS BEFORE NOW() - INTERVAL 3 DAY"

# Or rotate
mysqlbinlog --read-from-remote-server --raw --result-file=/backup/ ...
```

Nếu vẫn không đủ → mount extra volume, point `datadir` (đòi hỏi downtime).

### Case D — Single `wp_<domain>` corrupted

```bash
DB=wp_<safe_domain>
# Mark site degraded in CMS first
mysql --defaults-extra-file=/etc/mysql/root.cnf cms_core \
  -e "UPDATE sites SET status='failed' WHERE db_name='${DB}'"

# Repair
mysqlcheck --defaults-extra-file=/etc/mysql/root.cnf --auto-repair --quick "${DB}"

# If corrupt beyond repair → restore from backup
LATEST=$(ls -t /backup/mysql/${DB}-*.sql.gz | head -1)
gunzip < "${LATEST}" | mysql --defaults-extra-file=/etc/mysql/root.cnf "${DB}"
```

### Case E — InnoDB recovery loop

```bash
# Stop mysqld
systemctl stop mysql

# Backup current state
cp -a /var/lib/mysql /var/lib/mysql.bak.$(date +%s)

# Start in recovery mode (force_recovery = 1..6, lower first)
# /etc/mysql/mysql.conf.d/recovery.cnf:
#   [mysqld]
#   innodb_force_recovery = 1
systemctl start mysql

# Dump all DBs:
mysqldump --defaults-extra-file=/etc/mysql/root.cnf --all-databases --single-transaction \
  > /backup/emergency-dump.sql

# Stop, remove recovery mode, re-init DB files, restore
```

## Recovery verification

```bash
# 1. MySQL accepting connections
mysqladmin --defaults-extra-file=/etc/mysql/root.cnf ping

# 2. CMS core schema queryable
mysql --defaults-extra-file=/etc/mysql/root.cnf cms_core -e "SELECT COUNT(*) FROM sites"

# 3. Prisma migration state OK
cd /opt/cms/backend && pnpm prisma migrate status

# 4. /healthz from API
curl -fsS https://<CMS_HOST>/healthz

# 5. End-to-end: login works
curl -fsS -X POST https://<CMS_HOST>/api/auth/login \
  -H "content-type: application/json" \
  -d '{"email":"admin@example.com","password":"<pw>"}'

# 6. For WP site recovery:
curl -fsS https://<DOMAIN>/wp-json/ai-builder/v1/health \
  -H "X-AIB-Timestamp: $(date +%s)" -H "X-AIB-Signature: <sig>" | jq .data.db_ok
# expect true
```

## Postmortem follow-up

- [ ] /readyz nên ping DB + Redis (hiện chỉ Redis) → tracking issue
- [ ] Backup latency SLO: cms_core hourly, WP DB daily
- [ ] Connection pool size đủ chưa? Prisma `connection_limit`
- [ ] Add metric `cms_db_query_duration_seconds`
- [ ] Add metric `cms_db_connections_in_use`
- [ ] Per-WP DB monitoring (size, query rate) — hiện chỉ host-level

## References

- Prisma error codes: <https://www.prisma.io/docs/orm/reference/error-reference>
- InnoDB recovery: <https://dev.mysql.com/doc/refman/8.0/en/forcing-innodb-recovery.html>
- Backend code: `backend/src/db/prisma.ts`, `backend/src/modules/sites/sites.repository.ts`
