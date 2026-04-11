import { api } from './client';
import type { Package } from '../types';

export const packagesApi = {
  list: () =>
    api.get<{ packages: Package[] }>('/api/packages'),

  listAll: () =>
    api.get<{ packages: Package[] }>('/api/packages/all'),

  create: (data: Partial<Package>) =>
    api.post<{ package: Package }>('/api/packages', data),

  update: (id: string, data: Partial<Package>) =>
    api.put<{ package: Package }>(`/api/packages/${id}`, data),

  delete: (id: string) =>
    api.delete(`/api/packages/${id}`),
};
