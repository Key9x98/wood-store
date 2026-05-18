import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

const ACCESS_TTL: SignOptions['expiresIn'] = '15m';
const REFRESH_TTL: SignOptions['expiresIn'] = '7d';

export type Role = 'admin' | 'user' | 'system';

export interface AccessPayload extends JwtPayload {
  sub: string;
  email: string;
  role: Role;
  type: 'access';
}

export interface RefreshPayload extends JwtPayload {
  sub: string;
  type: 'refresh';
}

export function signAccess(user: { id: number; email: string; role: Role }): string {
  const payload: AccessPayload = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    type: 'access',
  };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefresh(userId: number): string {
  const payload: RefreshPayload = { sub: String(userId), type: 'refresh' };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccess(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || decoded.type !== 'access') {
    throw new Error('invalid_token_type');
  }
  return decoded as AccessPayload;
}

export function verifyRefresh(token: string): RefreshPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || decoded.type !== 'refresh') {
    throw new Error('invalid_token_type');
  }
  return decoded as RefreshPayload;
}
