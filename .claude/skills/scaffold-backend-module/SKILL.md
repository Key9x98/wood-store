---
name: scaffold-backend-module
description: Sinh một module Express mới (routes/controller/service/repository/schema/test) theo convention dự án. Dùng khi user nói "tạo module X", "scaffold backend module", "thêm resource <Y>" hoặc cần thêm 1 entity mới (ví dụ "billing", "webhooks", "audit"). Đọc docs/backend-structure.md trước.
---

# Skill: Scaffold Backend Module

## 1. Convention 1 module

```
src/modules/<name>/
├── <name>.routes.ts
├── <name>.controller.ts
├── <name>.service.ts
├── <name>.repository.ts
├── <name>.schema.ts
├── <name>.types.ts
└── <name>.test.ts
```

Quy tắc:
- Service KHÔNG biết `Request/Response`.
- Controller KHÔNG biết Prisma/SQL.
- Repository KHÔNG biết business rule.
- Trả `Result<T, AppError>` ở biên service.

## 2. Template files

### `<name>.schema.ts`

```ts
import { z } from 'zod';

export const CreateXSchema = z.object({
  name: z.string().min(1).max(120),
  // ...
});
export type CreateXInput = z.infer<typeof CreateXSchema>;
```

### `<name>.repository.ts`

```ts
import { PrismaClient } from '@prisma/client';

export class XRepository {
  constructor(private db: PrismaClient) {}

  create(data: CreateXInput) { return this.db.x.create({ data }); }
  findById(id: number)       { return this.db.x.findUnique({ where: { id } }); }
  list(opts: ListOpts)       { return this.db.x.findMany({ ... }); }
}
```

### `<name>.service.ts`

```ts
import { ok, err, type Result } from '../../lib/result';
import { AppError } from '../../lib/errors';
import type { CreateXInput } from './x.schema';
import type { XRepository } from './x.repository';

export class XService {
  constructor(private repo: XRepository) {}

  async create(input: CreateXInput): Promise<Result<X>> {
    const exists = await this.repo.findByName(input.name);
    if (exists) return err(new AppError('x.name_taken', 409));
    const row = await this.repo.create(input);
    return ok(row);
  }
}
```

### `<name>.controller.ts`

```ts
import { Router } from 'express';
import { CreateXSchema } from './x.schema';
import { xService } from './x.module';   // DI container

export const xRouter = Router();

xRouter.post('/', async (req, res, next) => {
  const parsed = CreateXSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('x.invalid_input', 400, parsed.error.format()));

  const r = await xService.create(parsed.data);
  if (!r.ok) return next(r.error);
  res.status(201).json({ data: r.value });
});

xRouter.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const row = await xService.findById(id);
  if (!row) return next(new AppError('x.not_found', 404));
  res.json({ data: row });
});
```

### `<name>.routes.ts`

```ts
import { Router } from 'express';
import { authRequired } from '../../middleware/auth.middleware';
import { xRouter } from './x.controller';

export const xRoutes = Router();
xRoutes.use(authRequired);
xRoutes.use('/x', xRouter);
```

Mount trong `app.ts`: `app.use('/api', xRoutes)`.

### `<name>.test.ts` (vitest)

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { XService } from './x.service';

describe('XService', () => {
  it('rejects duplicate name', async () => {
    const repo = { findByName: vi.fn().mockResolvedValue({ id: 1 }) } as any;
    const svc = new XService(repo);
    const r = await svc.create({ name: 'a' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('x.name_taken');
  });
});
```

## 3. Checklist khi scaffold

- [ ] Prisma model trong `schema.prisma` + chạy `prisma migrate dev --name add_<name>`.
- [ ] Zod schemas cho mọi input.
- [ ] AppError code prefix theo module: `<name>.<reason>`.
- [ ] Audit log nếu là action quan trọng (create/update/delete).
- [ ] Rate limit nếu endpoint public.
- [ ] RBAC: route nào cần role nào.
- [ ] Test unit cho service ≥ 1 happy + 1 error case.

## 4. Naming

- File: `kebab-case.ts`.
- Class: `PascalCase` + suffix (`UserService`, `UserRepository`).
- Method: `camelCase`.
- DB table: `snake_case_plural` (`users`, `audit_logs`).
- Endpoint: `/api/<resource-plural>` (`/api/sites`, `/api/templates`).

## 5. Common module list (dự án này)

Đã/sẽ có:
- `auth` — login, refresh, JWT.
- `users` — admin manage user.
- `sites` — CRUD site + trigger provision.
- `templates` — CRUD + import.
- `content` — CRUD `site_products`/`site_pages`/`site_media` (canonical) + enqueue content-sync.
- `wordpress` — WP-CLI + `ai-builder-plugin` REST client (HMAC).
- `dns` — provider adapters.
- `ssl` — certbot wrapper.
- `deployments` — code/theme deploy.
- `ai` — content gen.
- `webhooks` — outbound webhook delivery.
- `billing` (tương lai).

Khi scaffold module mới: kiểm tra có trùng với danh sách trên không, nếu có thì update thay vì tạo trùng.
