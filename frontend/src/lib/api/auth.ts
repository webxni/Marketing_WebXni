import { api } from './client';
import type { SessionUser } from '../types';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ ok: boolean; user: SessionUser }>('/api/auth/login', { email, password }),

  logout: () =>
    api.post<{ ok: boolean }>('/api/auth/logout'),

  me: () =>
    api.get<{ user: SessionUser }>('/api/auth/me'),
};
