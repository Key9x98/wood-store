import { api } from '@/lib/api';
import type { AuthTokens, ItemResponse } from '@/lib/types';

export async function loginRequest(email: string, password: string): Promise<AuthTokens> {
  const res = await api.post<ItemResponse<AuthTokens>>('/auth/login', { email, password });
  return res.data.data;
}
