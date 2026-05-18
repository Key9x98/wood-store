import type { User } from '@prisma/client';

export type UserPublic = Omit<User, 'passwordHash'>;

export const toPublic = (u: User): UserPublic => {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
};
