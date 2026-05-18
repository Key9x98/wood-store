import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../lib/errors';
import { CreateUserSchema, UpdateUserSchema, ListUsersSchema } from './users.schema';
import { usersService } from './users.module';

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('users.invalid_input', 400, parsed.error.format()));
  const r = await usersService.create(parsed.data);
  if (!r.ok) return next(r.error);
  res.status(201).json({ data: r.value });
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = ListUsersSchema.safeParse(req.query);
  if (!parsed.success) return next(new AppError('users.invalid_query', 400, parsed.error.format()));
  const result = await usersService.list(parsed.data);
  res.json({ data: result.items, total: result.total });
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('users.invalid_id', 400));
  const r = await usersService.findById(id);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('users.invalid_id', 400));
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) return next(new AppError('users.invalid_input', 400, parsed.error.format()));
  const r = await usersService.update(id, parsed.data);
  if (!r.ok) return next(r.error);
  res.json({ data: r.value });
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new AppError('users.invalid_id', 400));
  const r = await usersService.remove(id);
  if (!r.ok) return next(r.error);
  res.status(204).end();
}
