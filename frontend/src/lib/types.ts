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

export interface SiteProduct {
  id: number;
  siteId: number;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string;
  regularPrice: number;
  salePrice: number | null;
  salePercent: number;
  videoUrl: string | null;
  featured: boolean;
  attributes: Record<string, unknown>;
  categories: string[];
  images: string[];
  status: 'active' | 'archived';
  wpPostId: number | null;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  syncError: string | null;
  syncedAt: string | null;
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
