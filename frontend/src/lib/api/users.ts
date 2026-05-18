import { api } from '@/lib/api';
import type { ItemResponse, ListResponse, Role, User } from '@/lib/types';

export interface ListUsersParams {
  limit?: number;
  offset?: number;
}

export async function listUsers(params: ListUsersParams = {}): Promise<ListResponse<User>> {
  const res = await api.get<ListResponse<User>>('/users', { params });
  return res.data;
}

export async function getUser(id: number): Promise<User> {
  const res = await api.get<ItemResponse<User>>(`/users/${id}`);
  return res.data.data;
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const res = await api.post<ItemResponse<User>>('/users', input);
  return res.data.data;
}

export interface UpdateUserInput {
  email?: string;
  password?: string;
  role?: Role;
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<User> {
  const res = await api.patch<ItemResponse<User>>(`/users/${id}`, input);
  return res.data.data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}
