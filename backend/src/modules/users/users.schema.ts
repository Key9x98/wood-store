import { z } from 'zod';

export const RoleSchema = z.enum(['admin', 'user', 'system']);

export const CreateUserSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z.string().min(8).max(128),
  role: RoleSchema.default('user'),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  email: z.string().email().max(254).toLowerCase().optional(),
  password: z.string().min(8).max(128).optional(),
  role: RoleSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const ListUsersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListUsersInput = z.infer<typeof ListUsersSchema>;
