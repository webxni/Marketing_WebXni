import { api } from './client';
import type { User, Role } from '../types';

export const usersApi = {
  list: () =>
    api.get<{ users: User[] }>('/api/users'),

  create: (data: { email: string; name: string; role: Role; password: string }) =>
    api.post<{ user: User }>('/api/users', data),

  update: (id: string, data: { name?: string; role?: Role; password?: string }) =>
    api.put<{ ok: boolean }>(`/api/users/${id}`, data),

  deactivate: (id: string) =>
    api.post<{ ok: boolean }>(`/api/users/${id}/deactivate`),

  reactivate: (id: string) =>
    api.post<{ ok: boolean }>(`/api/users/${id}/reactivate`),
};
