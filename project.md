# Mục tiêu hệ thống

Build platform tự động tạo website dùng:

* frontend render bằng WordPress
* backend quản lý bằng Express.js
* automation deploy/domain/SSL/template

---

# Kiến trúc tổng thể

```text id="3v8m1q"
User
  ↓
Express CMS/API
  ↓
Queue System
  ↓
Provision Worker
  ↓
Server/VPS
  ├── WordPress Sites
  ├── MySQL
  ├── Nginx
  └── PHP-FPM
```

---

# Frontend Website

Dùng WordPress chỉ để:

* render template
* theme system
* Elementor
* frontend pages
* SEO
* WooCommerce nếu cần

## Không dùng làm CMS chính

---

# Backend chính

Dùng:

* Express.js
* TypeScript

Backend là:

```text id="0r2x9m"
source of truth
```

---

# Database

## Backend CMS

* MySQL

## WordPress

* database riêng cho từng site

---

# Queue / Async Jobs

Dùng:

* Redis
* BullMQ

Cho:

* provisioning
* AI generation
* deploy
* SSL
* DNS
* rollback

---

# Provision Flow

## 1. User add domain

Ví dụ:

```text id="2m7w1x"
abc.com
```

---

## 2. Backend gọi DNS provider API

Ví dụ:

* Cloudflare
* Namecheap

Tự động:

```text id="9k4x2m"
A Record -> SERVER_IP
```

SERVER_IP lấy từ `.env`.

---

## 3. Queue tạo website

API:

```text id="6v2m8q"
createWebsite()
```

→ push vào BullMQ queue.

---

## 4. Worker provisioning

Worker sẽ:

### a. Tạo folder

```text id="3n8x1q"
/var/www/html/sites/abc.com
```

---

### b. Clone source frontend

```bash id="7m2x9w"
git clone frontend_repo
```

---

### c. Tạo database

Ví dụ:

```text id="1x8m4q"
wp_abc_com
```

---

### d. Import template DB

```bash id="0m5x7q"
mysql < restaurant.sql
```

---

### e. Apply template/theme

Ví dụ:

```text id="8q1m4x"
Restaurant
SaaS
Portfolio
Agency
```

---

### f. Generate wp-config.php

Auto replace:

* DB_NAME
* DB_USER
* DB_PASSWORD
* DOMAIN

---

### g. Generate Nginx config

Ví dụ:

```nginx id="5x2m9q"
server_name abc.com;
root /var/www/html/sites/abc.com;
```

---

### h. Reload Nginx

```bash id="9m4x1q"
nginx -s reload
```

---

### i. SSL tự động

Dùng:

* Certbot

---

# Template System

Mỗi template có:

```text id="7v1m8q"
template.json
```

Ví dụ:

```json id="3x8m5q"
{
  "name": "Restaurant",
  "git_repo": "repo_url",
  "db_dump": "restaurant.sql",
  "theme": "restaurant-theme"
}
```

---

# WordPress Plugin riêng

Tạo plugin:

```text id="2w7m9q"
ai-builder-plugin
```

Để:

* expose REST API
* sync content
* publish pages
* upload media
* trigger Elementor

---

# Infrastructure

## Web server

* Nginx

## Runtime

* PHP-FPM

## Containers

* Docker

## SSL

* Certbot

## CDN

* Cloudflare

---

# Folder structure backend

```text id="4m8x1q"
src/
├── modules/
│   ├── auth/
│   ├── websites/
│   ├── templates/
│   ├── wordpress/
│   ├── dns/
│   ├── ssl/
│   ├── deployments/
│   └── ai/
│
├── queues/
├── workers/
├── middleware/
└── utils/
```

---

# Điều quan trọng nhất

```text id="1m8x4q"
Express CMS
=
brain/system core

WordPress
=
frontend rendering engine
```

---

# Phần khó nhất của hệ thống

Không phải frontend.

Mà là:

```text id="9x2m5q"
provisioning automation
```

bao gồm:

* DNS automation
* SSL automation
* deployment
* rollback
* template management
* queue workers
* failure recovery
* multisite orchestration.

# Template Mẫu: Website bán đồ gỗ như tủ, bàn, ghế, ban thờ,...

Mỗi item có thông tin:
 - tên
 - mô tả chi tiết
 - chất liệu
 - giá gốc
 - giá sale
 - sale bao nhiêu phần trăm
 - các ảnh về item
 - video về item
 - ... (bổ sung nếu cần)