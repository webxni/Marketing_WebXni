import { api } from './client';
import type { User, Role } from '../types';

export const usersApi = {
  list: () =>
    api.get<{ users: User[] }>('/api/users'),

  create: (data: { email: string; name: string; role: Role; password: string; client_id?: string }) =>
    api.post<{ user: User }>('/api/users', data),

  update: (id: string, data: { name?: string; role?: Role; password?: string; client_id?: string | null }) =>
    api.put<{ ok: boolean }>(`/api/users/${id}`, data),

  deactivate: (id: string) =>
    api.post<{ ok: boolean }>(`/api/users/${id}/deactivate`),

  reactivate: (id: string) =>
    api.post<{ ok: boolean }>(`/api/users/${id}/reactivate`),

  reset2fa: (id: string) =>
    api.post<{ ok: boolean }>(`/api/users/${id}/reset-2fa`),
};
