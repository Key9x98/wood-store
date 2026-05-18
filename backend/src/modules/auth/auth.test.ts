import { describe, it, expect, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { AuthService } from './auth.service';
import type { IUserRepository } from '../users/users.repository';
import { verifyAccess, signRefresh } from '../../lib/jwt';

const buildRepo = (over: Partial<IUserRepository> = {}): IUserRepository => ({
  findById: vi.fn(),
  findByEmail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  ...over,
});

const buildUser = async (overrides: Partial<User> = {}): Promise<User> => ({
  id: 42,
  email: 'a@example.com',
  passwordHash: await bcrypt.hash('correct horse battery staple', 4),
  role: 'admin',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthService.login', () => {
  it('issues tokens on valid credentials', async () => {
    const user = await buildUser();
    const repo = buildRepo({ findByEmail: vi.fn().mockResolvedValue(user) });
    const svc = new AuthService(repo);

    const r = await svc.login('a@example.com', 'correct horse battery staple');

    expect(r.ok).toBe(true);
    if (r.ok) {
      const payload = verifyAccess(r.value.accessToken);
      expect(payload.sub).toBe('42');
      expect(payload.role).toBe('admin');
      expect(r.value.user.email).toBe('a@example.com');
    }
  });

  it('rejects bad password with invalid_credentials', async () => {
    const user = await buildUser();
    const repo = buildRepo({ findByEmail: vi.fn().mockResolvedValue(user) });
    const svc = new AuthService(repo);

    const r = await svc.login('a@example.com', 'wrong-password');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth.invalid_credentials');
  });

  it('rejects unknown email with same code (no enumeration)', async () => {
    const repo = buildRepo({ findByEmail: vi.fn().mockResolvedValue(null) });
    const svc = new AuthService(repo);
    const r = await svc.login('nope@example.com', 'whatever');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth.invalid_credentials');
  });
});

describe('AuthService.refresh', () => {
  it('issues new tokens on valid refresh', async () => {
    const user = await buildUser();
    const repo = buildRepo({ findById: vi.fn().mockResolvedValue(user) });
    const svc = new AuthService(repo);

    const r = await svc.refresh(signRefresh(user.id));

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.user.id).toBe(user.id);
  });

  it('rejects garbage token', async () => {
    const repo = buildRepo();
    const svc = new AuthService(repo);
    const r = await svc.refresh('not-a-jwt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('auth.invalid_refresh');
  });
});
