import { AppError } from '../../lib/errors';
import { ok, err, type Result } from '../../lib/result';
import { signAccess, signRefresh, verifyRefresh, type Role } from '../../lib/jwt';
import type { IUserRepository } from '../users/users.repository';
import { toPublic, type UserPublic } from '../users/users.types';
import bcrypt from 'bcryptjs';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserPublic;
}

export class AuthService {
  constructor(private users: IUserRepository) {}

  async login(email: string, password: string): Promise<Result<AuthTokens, AppError>> {
    const u = await this.users.findByEmail(email);
    if (!u) return err(new AppError('auth.invalid_credentials', 401));
    const matched = await bcrypt.compare(password, u.passwordHash);
    if (!matched) return err(new AppError('auth.invalid_credentials', 401));
    return ok({
      accessToken: signAccess({ id: u.id, email: u.email, role: u.role as Role }),
      refreshToken: signRefresh(u.id),
      user: toPublic(u),
    });
  }

  async refresh(token: string): Promise<Result<AuthTokens, AppError>> {
    let payload;
    try {
      payload = verifyRefresh(token);
    } catch {
      return err(new AppError('auth.invalid_refresh', 401));
    }
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      return err(new AppError('auth.invalid_refresh', 401));
    }
    const u = await this.users.findById(userId);
    if (!u) return err(new AppError('auth.user_gone', 401));
    return ok({
      accessToken: signAccess({ id: u.id, email: u.email, role: u.role as Role }),
      refreshToken: signRefresh(u.id),
      user: toPublic(u),
    });
  }
}
