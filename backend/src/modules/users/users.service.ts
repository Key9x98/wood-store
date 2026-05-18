import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import type { IUserRepository } from './users.repository';
import type { CreateUserInput, UpdateUserInput, ListUsersInput } from './users.schema';
import { toPublic, type UserPublic } from './users.types';

const BCRYPT_ROUNDS = 10;

export class UserService {
  constructor(private repo: IUserRepository) {}

  async create(input: CreateUserInput): Promise<Result<UserPublic, AppError>> {
    const existing = await this.repo.findByEmail(input.email);
    if (existing) return err(new AppError('users.email_taken', 409));
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const u = await this.repo.create({
      email: input.email,
      passwordHash,
      role: input.role,
    });
    return ok(toPublic(u));
  }

  async findById(id: number): Promise<Result<UserPublic, AppError>> {
    const u = await this.repo.findById(id);
    if (!u) return err(new AppError('users.not_found', 404));
    return ok(toPublic(u));
  }

  async list(opts: ListUsersInput): Promise<{ items: UserPublic[]; total: number }> {
    const [items, total] = await Promise.all([this.repo.list(opts), this.repo.count()]);
    return { items: items.map(toPublic), total };
  }

  async update(id: number, patch: UpdateUserInput): Promise<Result<UserPublic, AppError>> {
    const target = await this.repo.findById(id);
    if (!target) return err(new AppError('users.not_found', 404));

    if (patch.email && patch.email !== target.email) {
      const dup = await this.repo.findByEmail(patch.email);
      if (dup && dup.id !== id) return err(new AppError('users.email_taken', 409));
    }

    const updateData: Partial<{ email: string; passwordHash: string; role: string }> = {};
    if (patch.email) updateData.email = patch.email;
    if (patch.role) updateData.role = patch.role;
    if (patch.password) updateData.passwordHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);

    const u = await this.repo.update(id, updateData);
    return ok(toPublic(u));
  }

  async remove(id: number): Promise<Result<true, AppError>> {
    const target = await this.repo.findById(id);
    if (!target) return err(new AppError('users.not_found', 404));
    await this.repo.delete(id);
    return ok(true);
  }

  // Internal helper for auth service
  async verifyCredentials(email: string, password: string): Promise<User | null> {
    const u = await this.repo.findByEmail(email);
    if (!u) return null;
    const matched = await bcrypt.compare(password, u.passwordHash);
    return matched ? u : null;
  }
}
