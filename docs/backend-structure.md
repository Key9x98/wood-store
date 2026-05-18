# Backend Structure (Express + TypeScript)

## 1. Folder layout

```
backend/
├── src/
│   ├── app.ts                 # express app factory (no listen)
│   ├── server.ts              # bootstrap: env, db, redis, listen
│   ├── config/
│   │   ├── env.ts             # zod-validated env
│   │   └── logger.ts          # pino instance
│   ├── modules/
│   │   ├── auth/              # login, JWT, RBAC
│   │   ├── users/
│   │   ├── sites/             # CRUD sites + provision trigger
│   │   ├── templates/         # template CRUD + import
│   │   ├── wordpress/         # WP-CLI wrapper + plugin REST client
│   │   ├── dns/               # provider adapters (cloudflare, namecheap)
│   │   ├── ssl/               # certbot wrapper
│   │   ├── deployments/       # site code/theme deploy
│   │   └── ai/                # OpenAI / Claude content gen
│   ├── queues/                # BullMQ queue definitions
│   │   ├── index.ts
│   │   ├── provision.queue.ts
│   │   ├── dns.queue.ts
│   │   ├── ssl.queue.ts
│   │   └── deploy.queue.ts
│   ├── workers/               # BullMQ workers (separate entry points)
│   │   ├── provision.worker.ts
│   │   ├── dns.worker.ts
│   │   ├── ssl.worker.ts
│   │   ├── deploy.worker.ts
│   │   └── rollback.worker.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── error.middleware.ts
│   │   ├── request-id.middleware.ts
│   │   └── rate-limit.middleware.ts
│   ├── db/
│   │   ├── prisma/            # schema.prisma + migrations
│   │   └── repositories/
│   ├── lib/
│   │   ├── shell.ts           # safe execFile wrapper
│   │   ├── result.ts          # Result<T,E> type
│   │   ├── crypto.ts          # AES-256-GCM encrypt secrets
│   │   └── http.ts            # fetch with timeout + retry
│   └── utils/
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
├── .env.example
└── Dockerfile
```

## 2. Convention 1 module

Mỗi module trong `src/modules/<name>/` có:

```
<name>/
├── <name>.routes.ts       # Router export, gắn vào app
├── <name>.controller.ts   # parse req, gọi service, format response
├── <name>.service.ts      # business logic, không biết req/res
├── <name>.repository.ts   # truy cập DB
├── <name>.schema.ts       # zod schemas in/out
├── <name>.types.ts        # interface, enum
└── <name>.test.ts
```

Service KHÔNG được import express; controller KHÔNG được gọi DB trực tiếp.

## 3. Result type (no throw across module boundary)

```ts
// src/lib/result.ts
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

Controller xử lý:
```ts
const r = await sitesService.create(input);
if (!r.ok) return next(r.error);
res.status(201).json(r.value);
```

## 4. env.ts (zod)

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  SERVER_IP: z.string().ip(),
  ADMIN_EMAIL: z.string().email(),
  CLOUDFLARE_API_TOKEN: z.string(),
  CLOUDFLARE_ZONE_ID: z.string(),
  SECRET_ENCRYPTION_KEY: z.string().length(64),  // hex 32 bytes
});

export const env = schema.parse(process.env);
```

## 5. Repository pattern (Prisma)

```ts
// src/modules/sites/sites.repository.ts
export class SitesRepository {
  constructor(private db: PrismaClient) {}

  async create(data: CreateSiteInput) {
    return this.db.site.create({ data });
  }

  async findByDomain(domain: string) {
    return this.db.site.findUnique({ where: { domain } });
  }

  async updateStatus(id: number, status: SiteStatus, extra?: Prisma.SiteUpdateInput) {
    return this.db.site.update({ where: { id }, data: { status, ...extra } });
  }
}
```

## 6. Queue pattern

```ts
// src/queues/provision.queue.ts
import { Queue } from 'bullmq';
import { redis } from '../lib/redis';

export const provisionQueue = new Queue('provision', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800 },
  },
});

export type ProvisionJob = { siteId: number };

export const enqueueProvision = (data: ProvisionJob) =>
  provisionQueue.add('provision-site', data, {
    jobId: `site:${data.siteId}`,  // unique per site
  });
```

## 7. Worker pattern

Mỗi worker là entry point riêng (`pnpm worker:provision`):

```ts
// src/workers/provision.worker.ts
import { Worker } from 'bullmq';
import { redis } from '../lib/redis';
import { provisionSite } from '../modules/sites/sites.service';
import { logger } from '../config/logger';

new Worker<ProvisionJob>('provision', async (job) => {
  const log = logger.child({ jobId: job.id, siteId: job.data.siteId });
  log.info('start');
  const r = await provisionSite(job.data.siteId, { log });
  if (!r.ok) {
    log.error({ err: r.error }, 'failed');
    throw r.error;
  }
  log.info('done');
}, {
  connection: redis,
  concurrency: 2,
  lockDuration: 60_000,
});
```

## 8. Error class

```ts
export class AppError extends Error {
  constructor(
    public code: string,           // 'site.domain_taken'
    public status = 500,
    public detail?: unknown,
  ) { super(code); }
}
```

Error middleware map `AppError` → JSON:
```json
{ "error": { "code": "site.domain_taken", "message": "..." } }
```

## 9. Shell helper (an toàn)

```ts
// src/lib/shell.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pExecFile = promisify(execFile);

export async function run(cmd: string, args: string[], opts: { timeout?: number; cwd?: string } = {}) {
  return pExecFile(cmd, args, { timeout: opts.timeout ?? 60_000, cwd: opts.cwd });
}
```

KHÔNG export `exec` (string). Mọi gọi shell qua `run`.

## 10. Tests

- `unit/`: thuần service, mock repo + provider.
- `integration/`: thật DB (testcontainers MySQL), thật Redis (testcontainers Redis), mock provider HTTP (msw).
- `e2e/`: thật mọi thứ + 1 VPS sandbox (dùng namespace folder `/var/www/html/sites-test/`).

Coverage threshold: services ≥ 80%, controllers ≥ 60%, workers ≥ 70%.

## 11. Scripts npm khuyến nghị

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.build.json",
  "start": "node dist/server.js",
  "worker:provision": "node dist/workers/provision.worker.js",
  "worker:deploy": "node dist/workers/deploy.worker.js",
  "test": "vitest run",
  "test:int": "vitest run -c vitest.int.config.ts",
  "lint": "eslint src --max-warnings 0",
  "typecheck": "tsc --noEmit",
  "prisma:migrate": "prisma migrate deploy"
}
```
