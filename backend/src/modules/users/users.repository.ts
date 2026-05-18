import type { PrismaClient, User } from '@prisma/client';

export interface UserCreateData {
  email: string;
  passwordHash: string;
  role: string;
}

export interface UserUpdateData {
  email?: string;
  passwordHash?: string;
  role?: string;
}

export interface IUserRepository {
  findById(id: number): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: UserCreateData): Promise<User>;
  update(id: number, patch: UserUpdateData): Promise<User>;
  delete(id: number): Promise<User>;
  list(opts: { limit: number; offset: number }): Promise<User[]>;
  count(): Promise<number>;
}

export class UserRepository implements IUserRepository {
  constructor(private db: PrismaClient) {}

  findById(id: number) {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  create(data: UserCreateData) {
    return this.db.user.create({ data });
  }

  update(id: number, patch: UserUpdateData) {
    return this.db.user.update({ where: { id }, data: patch });
  }

  delete(id: number) {
    return this.db.user.delete({ where: { id } });
  }

  list(opts: { limit: number; offset: number }) {
    return this.db.user.findMany({
      take: opts.limit,
      skip: opts.offset,
      orderBy: { id: 'desc' },
    });
  }

  count() {
    return this.db.user.count();
  }
}
