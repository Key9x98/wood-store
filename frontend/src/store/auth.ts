import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthTokens, User } from '@/lib/types';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  setTokens: (tokens: AuthTokens) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setTokens: (t) =>
        set({ accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'wood-cms-auth' },
  ),
);

export const authStorageKey = 'wood-cms-auth';
