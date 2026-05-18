# Infrastructure

## 1. Stack vận hành

| Component | Tech | Note |
|---|---|---|
| Web server | Nginx ≥ 1.24 | reverse proxy + WP static |
| PHP runtime | PHP 8.2 + PHP-FPM | pool riêng nếu cần isolation |
| Database (WP) | MySQL 8.0 | UTF8MB4 |
| Database (CMS) | MySQL 8.0 hoặc Postgres 16 | tách instance khi scale |
| Queue | Redis 7 | persistence AOF |
| Container | Docker + docker-compose | chỉ dev, prod chạy systemd |
| SSL | Certbot + Let's Encrypt | auto-renew systemd timer |
| CDN | Cloudflare | front mọi domain (optional) |
| Monitoring | Prometheus + Grafana + Loki | scrape Express + Nginx |

## 2. PHP-FPM pool config

`/etc/php/8.2/fpm/pool.d/www.conf` (mặc định) — đủ cho dev.

Production khuyến nghị 1 pool per site nếu cần isolation security:

```ini
[abc_com]
user = abc_com
group = abc_com
listen = /run/php/abc_com.sock
listen.owner = www-data
listen.group = www-data
pm = dynamic
pm.max_children = 8
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
php_admin_value[open_basedir] = /var/www/html/sites/abc.com:/tmp
php_admin_value[upload_max_filesize] = 64M
php_admin_value[post_max_size] = 64M
php_admin_value[memory_limit] = 256M
```

Nginx point `fastcgi_pass unix:/run/php/abc_com.sock`.

Worker generate pool file từ template `templates/php-fpm-pool.template.conf`.

## 3. MySQL hardening

```sql
SET GLOBAL local_infile = 0;
```

Mỗi DB user của site:
- `GRANT ALL ON wp_<site>.*` (KHÔNG global).
- KHÔNG `GRANT SUPER, RELOAD, PROCESS, FILE`.

Root creds chỉ dùng bởi worker, lưu trong `/etc/mysql/root.cnf` (mode 600, owner root).

## 4. Nginx global

`/etc/nginx/nginx.conf`:

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    multi_accept on;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    server_tokens off;
    client_max_body_size 64M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    include /etc/nginx/sites-enabled/*.conf;
}
```

Mỗi site có file riêng trong `sites-available/` symlink vào `sites-enabled/`.

## 5. SSL renewal

```bash
systemctl status certbot.timer
```

Hook reload Nginx sau renew: `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`:
```bash
#!/bin/sh
systemctl reload nginx
```

## 6. Docker compose (dev)

`docker-compose.dev.yml`:

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: dev_root
    ports: ["3306:3306"]
    volumes: [mysql_data:/var/lib/mysql]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  api:
    build: ./backend
    command: pnpm dev
    environment:
      DATABASE_URL: mysql://root:dev_root@mysql:3306/cms_core
      REDIS_URL: redis://redis:6379
    depends_on: [mysql, redis]
    ports: ["3000:3000"]
    volumes: ["./backend:/app", "/app/node_modules"]

  worker:
    build: ./backend
    command: pnpm worker:provision
    depends_on: [mysql, redis]
    volumes: ["./backend:/app"]

volumes:
  mysql_data:
```

Production KHÔNG dùng compose; chạy systemd unit cho từng service.

## 7. Systemd units (production)

`/etc/systemd/system/cms-api.service`:

```ini
[Unit]
Description=CMS API
After=network.target mysql.service redis.service

[Service]
Type=simple
User=cms
WorkingDirectory=/opt/cms/backend
EnvironmentFile=/etc/cms/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Tương tự `cms-worker-provision.service`, `cms-worker-deploy.service`, v.v.

## 8. Firewall

UFW rules:
```
22/tcp    (SSH, hạn chế IP admin)
80/tcp    public
443/tcp   public
3306/tcp  ONLY 127.0.0.1
6379/tcp  ONLY 127.0.0.1
```

Express API không expose public — chạy sau Nginx reverse proxy với basic auth hoặc IP whitelist (admin dashboard).

## 9. Backup

- DB CMS: `mysqldump --single-transaction cms_core` daily → S3.
- DB WP sites: dump tất cả `wp_*` hằng ngày, encrypt với age, push S3.
- Folder sites: `rsync` incremental → backup server.
- Retention: 7 daily, 4 weekly, 6 monthly.

Restore drill mỗi quý.

## 10. Resource per site (ước tính)

| Site idle | RAM | Disk |
|---|---|---|
| WP + Elementor cơ bản | 60–100MB FPM | 500MB–1GB |
| WooCommerce | 150MB | 1–3GB |

VPS 8GB ~ 30 site idle. Khi vượt → spin host mới (bảng `servers`).
