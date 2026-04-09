import { api } from './client';
import type { Client, ClientPlatform } from '../types';

export const clientsApi = {
  list: (status: 'active' | 'inactive' | 'all' = 'active') =>
    api.get<{ clients: Client[] }>(`/api/clients?status=${status}`),

  get: (slug: string) =>
    api.get<{ client: Client & { platforms: ClientPlatform[]; gbp_locations: unknown[]; restrictions: string[] } }>(`/api/clients/${slug}`),

  create: (data: Partial<Client>) =>
    api.post<{ client: Client }>('/api/clients', data),

  update: (slug: string, data: Partial<Client>) =>
    api.put<{ client: Client }>(`/api/clients/${slug}`, data),

  getPlatforms: (slug: string) =>
    api.get<{ platforms: ClientPlatform[] }>(`/api/clients/${slug}/platforms`),

  pausePlatform: (slug: string, platform: string, reason?: string) =>
    api.post<{ ok: boolean }>(`/api/clients/${slug}/platforms/${platform}/pause`, { reason }),

  unpausePlatform: (slug: string, platform: string) =>
    api.post<{ ok: boolean }>(`/api/clients/${slug}/platforms/${platform}/unpause`),

  getServices: (slug: string) =>
    api.get<{ services: unknown[] }>(`/api/clients/${slug}/services`),

  createService: (slug: string, data: Record<string, unknown>) =>
    api.post<{ service: unknown }>(`/api/clients/${slug}/services`, data),

  deleteService: (slug: string, id: string) =>
    api.delete(`/api/clients/${slug}/services/${id}`),

  getCategories: (slug: string) =>
    api.get<{ categories: unknown[] }>(`/api/clients/${slug}/categories`),

  createCategory: (slug: string, data: { name: string }) =>
    api.post<{ category: unknown }>(`/api/clients/${slug}/categories`, data),

  getAreas: (slug: string) =>
    api.get<{ areas: unknown[] }>(`/api/clients/${slug}/areas`),

  createArea: (slug: string, data: Record<string, unknown>) =>
    api.post<{ area: unknown }>(`/api/clients/${slug}/areas`, data),

  deleteArea: (slug: string, id: string) =>
    api.delete(`/api/clients/${slug}/areas/${id}`),

  getOffers: (slug: string) =>
    api.get<{ offers: unknown[] }>(`/api/clients/${slug}/offers`),

  createOffer: (slug: string, data: Record<string, unknown>) =>
    api.post<{ offer: unknown }>(`/api/clients/${slug}/offers`, data),

  updateOffer: (slug: string, id: string, data: Record<string, unknown>) =>
    api.put<{ ok: boolean }>(`/api/clients/${slug}/offers/${id}`, data),

  deleteOffer: (slug: string, id: string) =>
    api.delete(`/api/clients/${slug}/offers/${id}`),
};
