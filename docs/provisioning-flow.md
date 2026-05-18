# Provisioning Flow

> Đây là phần KHÓ NHẤT của hệ thống. Đọc kỹ trước khi code worker.

Mục tiêu: từ "user add domain" → website chạy được HTTPS, tự động, idempotent, có rollback.

---

## 1. Tóm tắt high-level

```
User submits domain
    │
    ▼
POST /api/sites  ──► validate + INSERT sites (status='queued')
    │
    ▼
enqueue queue:provision { siteId }
    │
    ▼
ProvisionWorker chia thành sub-steps (mỗi step có thể retry độc lập)
```

---

## 2. Validate input (trong HTTP handler)

```ts
const DomainRegex = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63})+$/i;
if (!DomainRegex.test(domain)) throw new BadRequest('invalid_domain');
if (await sitesRepo.exists(domain)) throw new Conflict('domain_taken');
```

Reject: IP literals, underscores, domain dài >253, TLD ngắn <2 ký tự.

---

## 3. Các bước provisioning (idempotent)

Worker `ProvisionWorker` chạy tuần tự các bước. Mỗi bước:
- Trước khi thực thi: check "đã làm chưa" → skip nếu rồi.
- Ghi `sites.provision_state` (JSON) sau mỗi bước.
- Nếu fail bước N → enqueue `queue:rollback` với danh sách bước đã làm.

### Bước A — Khoá domain

```sql
UPDATE sites SET status='provisioning' WHERE id=? AND status='queued';
```
Nếu affected_rows = 0 → job đã chạy bởi worker khác, exit.

### Bước B — DNS

```ts
await dnsProvider.upsertARecord({
  zone: rootDomain(domain),
  name: subdomain(domain),
  content: env.SERVER_IP,
  proxied: false,
  ttl: 300,
});
```

- Provider mặc định: Cloudflare. Adapter pattern, xem `src/modules/dns/`.
- Lưu record ID vào `dns_records` table để rollback.
- Sau khi tạo: poll DNS (`dig +short A <domain> @1.1.1.1`) đến khi resolve về `SERVER_IP`, max 60s. Nếu timeout → vẫn tiếp tục (nhiều DNS lazy).

### Bước C — Tạo folder & clone source

```ts
const root = `/var/www/html/sites/${domain}`;
if (!await fs.exists(root)) {
  await execFile('git', ['clone', '--depth=1', template.git_repo, root]);
}
await execFile('chown', ['-R', 'www-data:www-data', root]);
await execFile('find', [root, '-type', 'd', '-exec', 'chmod', '755', '{}', '+']);
await execFile('find', [root, '-type', 'f', '-exec', 'chmod', '644', '{}', '+']);
```

**An toàn**: dùng `execFile`, KHÔNG nội suy `${domain}` vào string lệnh.

### Bước D — Tạo MySQL DB cho WordPress

```ts
const dbName = `wp_${domain.replace(/[^a-z0-9]/g, '_')}`;     // wp_abc_com
const dbUser = dbName;                                          // 1 user per DB
const dbPass = crypto.randomBytes(24).toString('base64url');

await mysql.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await mysql.query(`CREATE USER ?@'localhost' IDENTIFIED BY ?`, [dbUser, dbPass]);
await mysql.query(`GRANT ALL ON \`${dbName}\`.* TO ?@'localhost'`, [dbUser]);
await mysql.query('FLUSH PRIVILEGES');
```

Lưu credential vào bảng `sites` (cột `db_password` mã hoá AES-256-GCM bằng key trong env).

**Idempotent**: dùng `CREATE DATABASE IF NOT EXISTS` thì OK, nhưng user thì check `SELECT FROM mysql.user` trước.

### Bước E — Import DB dump của template

```bash
mysql -u root --defaults-extra-file=/etc/mysql/root.cnf \
  "${dbName}" < /var/www/html/templates/${templateSlug}/db_dump.sql
```

Trong Node:
```ts
await new Promise((resolve, reject) => {
  const proc = spawn('mysql', ['-u', 'root', `--defaults-extra-file=${cnf}`, dbName]);
  fs.createReadStream(dumpPath).pipe(proc.stdin);
  proc.on('exit', code => code === 0 ? resolve(null) : reject(new Error(`mysql exit ${code}`)));
});
```

Sau import: chạy SQL replace siteurl:
```sql
UPDATE wp_options SET option_value=? WHERE option_name IN ('siteurl','home');
```
Dùng `?` placeholder để tránh SQL injection.

### Bước F — Generate `wp-config.php`

Đọc template `templates/wp-config.template.php`, thay placeholder:

```ts
const cfg = (await fs.readFile(templatePath, 'utf8'))
  .replace('{{DB_NAME}}', dbName)
  .replace('{{DB_USER}}', dbUser)
  .replace('{{DB_PASSWORD}}', dbPass)
  .replace('{{DB_HOST}}', 'localhost')
  .replace('{{AUTH_KEY}}', randomKey(64))
  .replace('{{SECURE_AUTH_KEY}}', randomKey(64))
  // ... 8 keys WP yêu cầu
  .replace('{{TABLE_PREFIX}}', 'wp_');

await fs.writeFile(`${root}/wp-config.php`, cfg, { mode: 0o640 });
await execFile('chown', ['www-data:www-data', `${root}/wp-config.php`]);
```

`randomKey` = `crypto.randomBytes(48).toString('base64')`.

### Bước G — Apply theme + activate plugin

Dùng WP-CLI:
```bash
sudo -u www-data wp --path=/var/www/html/sites/${domain} theme activate ${themeSlug}
sudo -u www-data wp --path=/var/www/html/sites/${domain} plugin activate ai-builder-plugin
sudo -u www-data wp --path=/var/www/html/sites/${domain} rewrite flush
```

### Bước H — Generate Nginx config

Template `templates/nginx-site.template.conf`:
```nginx
server {
    listen 80;
    server_name {{DOMAIN}};
    root /var/www/html/sites/{{DOMAIN}};
    index index.php;

    access_log /var/log/nginx/{{DOMAIN}}.access.log;
    error_log  /var/log/nginx/{{DOMAIN}}.error.log;

    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
        fastcgi_param HTTP_PROXY "";
    }

    location ~ /\.ht { deny all; }
    location = /xmlrpc.php { deny all; }
}
```

Workflow:
1. Render template → ghi `/etc/nginx/sites-available/<domain>.conf` (atomic: write tmp + rename).
2. `ln -sf` vào `sites-enabled/`.
3. `nginx -t` → nếu fail: xoá symlink, fail job.
4. `systemctl reload nginx` (KHÔNG `nginx -s reload` vì systemd quản lý).

### Bước I — SSL via Certbot

```bash
certbot certonly --nginx -d "${domain}" -d "www.${domain}" \
  --non-interactive --agree-tos -m "${ADMIN_EMAIL}" \
  --rsa-key-size 2048 --keep-until-expiring
```

Sau khi cert cấp:
- Generate Nginx config phiên bản HTTPS (template `nginx-site-ssl.template.conf`), reload.
- Lưu thông tin cert vào `ssl_certs` (issued_at, expires_at, path).
- Setup cron renew: certbot tự tạo systemd timer, kiểm tra `systemctl status certbot.timer`.

Nếu domain chưa resolve về SERVER_IP → Certbot fail. Retry với backoff exponential (5m, 15m, 45m). Sau 3 lần → mark site `ssl_failed` (vẫn HTTP work).

### Bước J — Smoke test

```ts
const res = await fetch(`https://${domain}/wp-json/ai-builder/v1/health`, { timeout: 10000 });
if (res.status !== 200) throw new Error('smoke_test_failed');
```

### Bước K — Hoàn tất

```sql
UPDATE sites SET status='active', provisioned_at=NOW() WHERE id=?;
```
Emit event `site.provisioned` (cho webhook user/notification).

---

## 4. Rollback strategy

Worker `RollbackWorker` nhận `{ siteId, completedSteps: ['B','C','D'...] }`:

| Step | Compensation |
|---|---|
| B (DNS) | `dnsProvider.deleteRecord(recordId)` |
| C (folder) | `rm -rf /var/www/html/sites/<domain>` (validate path bắt đầu bằng `/var/www/html/sites/`) |
| D (DB user) | `DROP USER`, `DROP DATABASE` |
| F (wp-config) | đã nằm trong D folder, không cần |
| H (nginx) | xoá symlink + file, reload |
| I (SSL) | `certbot revoke --cert-path ...` |

Rollback chạy theo thứ tự NGƯỢC. Mỗi compensation cũng phải idempotent (xoá cái đã xoá thì OK).

---

## 5. Concurrency & locking

- Dùng `SELECT ... FOR UPDATE SKIP LOCKED` khi pick site để provision (hoặc dùng BullMQ unique job key = `site:${siteId}`).
- DNS provider có rate limit: throttle Cloudflare 4 req/s per zone.
- Certbot có rate limit Let's Encrypt: 50 cert/tuần per domain. Test bằng staging endpoint trước.

---

## 6. Bảo mật shell exec — bắt buộc

```ts
// BAD ❌
exec(`mysql -e "CREATE DATABASE ${dbName}"`);

// GOOD ✅
await mysqlConn.query('CREATE DATABASE ??', [dbName]);

// BAD ❌
exec(`certbot -d ${domain}`);

// GOOD ✅
await execFile('certbot', ['certonly', '--nginx', '-d', domain, ...]);
```

Whitelist regex cho `domain`, `dbName`, `templateSlug` trước khi truyền vào bất kỳ helper nào chạm shell.

---

## 7. Test checklist (per worker)

- [ ] Run job 2 lần liên tiếp → trạng thái cuối giống nhau (idempotent).
- [ ] Kill worker giữa bước E → resume job → tiếp tục từ bước E, không hỏng.
- [ ] Inject lỗi ở bước I → rollback chạy B..H đầy đủ.
- [ ] Domain với ký tự lạ (`abc.com; rm -rf /`) → reject ở validate.
- [ ] 2 job cùng siteId → chỉ 1 chạy (BullMQ jobId unique).
