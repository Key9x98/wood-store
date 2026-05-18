# Backend — CMS Core

Multi-tenant auto website builder (brain/source of truth). Đọc:

- `../CLAUDE.md` — nguyên tắc bất biến.
- `../docs/backend-structure.md` — convention module.
- `../docs/architecture.md` — kiến trúc tổng thể.
- `../USAGE.md` — workflow Claude Code.

## Quick start

```bash
cp .env.example .env
# (tuỳ chọn) sửa SECRET_ENCRYPTION_KEY bằng: openssl rand -hex 32

pnpm install
pnpm prisma generate     # cần thiết trước khi import @prisma/client
pnpm typecheck
pnpm dev
```

Endpoints:
- `GET /healthz` — liveness
- `GET /readyz` — Redis ping

## Workers

```bash
pnpm worker:provision    # stub ở milestone 1, sẽ implement đầy đủ ở milestone 5
```

## Docker (dev)

Ở repo root: `docker compose -f docker-compose.dev.yml up`.
