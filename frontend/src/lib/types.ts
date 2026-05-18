export type Role = 'admin' | 'user' | 'system';

export interface User {
  id: number;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface Site {
  id: number;
  domain: string;
  status: 'queued' | 'provisioning' | 'active' | 'failed' | 'ssl_failed' | 'deleted';
  templateId: number;
  ownerId: number;
  provisionedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: number;
  slug: string;
  name: string;
  version: string;
  manifest: unknown;
  localPath: string;
  status: 'building' | 'ready' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; detail?: unknown };
}

export interface ListResponse<T> {
  data: T[];
  total: number;
}

export interface ItemResponse<T> {
  data: T;
}
