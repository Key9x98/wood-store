import { describe, it, expect, vi } from 'vitest';
import type { User } from '@prisma/client';
import { UserService } from './users.service';
import type { IUserRepository } from './users.repository';

const fakeUser = (override: Partial<User> = {}): User => ({
  id: 1,
  email: 'a@example.com',
  passwordHash: 'hashed',
  role: 'user',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...override,
});

const makeRepo = (over: Partial<IUserRepository> = {}): IUserRepository => ({
  findById: vi.fn(),
  findByEmail: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  ...over,
});

describe('UserService.create', () => {
  it('creates a user when email is available', async () => {
    const created = fakeUser({ email: 'new@example.com' });
    const repo = makeRepo({
      findByEmail: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(created),
    });
    const svc = new UserService(repo);

    const r = await svc.create({ email: 'new@example.com', password: 'longenough', role: 'user' });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe('new@example.com');
      // passwordHash must NOT leak through public projection
      expect((r.value as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
    }
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('returns email_taken when duplicate', async () => {
    const repo = makeRepo({
      findByEmail: vi.fn().mockResolvedValue(fakeUser({ email: 'dup@example.com' })),
    });
    const svc = new UserService(repo);

    const r = await svc.create({ email: 'dup@example.com', password: 'longenough', role: 'user' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('users.email_taken');
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('UserService.verifyCredentials', () => {
  it('returns null on unknown email', async () => {
    const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(null) });
    const svc = new UserService(repo);
    expect(await svc.verifyCredentials('x@x.com', 'pw')).toBeNull();
  });
});
