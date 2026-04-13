import { api } from './client';
import type { Post, PostPlatform } from '../types';

export interface ListPostsParams {
  client?:    string;
  status?:    string;
  platform?:  string;
  from?:      string;
  to?:        string;
  page?:      number;
  limit?:     number;
  [key: string]: string | number | undefined;
}

export const postsApi = {
  list: (params: ListPostsParams = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') q.set(k, String(v));
    }
    return api.get<{ posts: Post[]; total: number }>(`/api/posts?${q}`);
  },

  get: (id: string) =>
    api.get<{ post: Post; platforms: PostPlatform[] }>(`/api/posts/${id}`),

  create: (data: Record<string, unknown>) =>
    api.post<{ post: Post }>('/api/posts', data),

  update: (id: string, data: Partial<Post>) =>
    api.put<{ post: Post }>(`/api/posts/${id}`, data),

  approve: (id: string) =>
    api.post<{ ok: boolean; status: string }>(`/api/posts/${id}/approve`),

  reject: (id: string, reason?: string) =>
    api.post<{ ok: boolean }>(`/api/posts/${id}/reject`, { reason }),

  markReady: (id: string) =>
    api.post<{ ok: boolean }>(`/api/posts/${id}/ready`),

  publish: (id: string, dryRun = false) =>
    api.post<{ ok: boolean; job_id: string }>(`/api/posts/${id}/publish`, { dry_run: dryRun }),

  retry: (id: string) =>
    api.post<{ ok: boolean }>(`/api/posts/${id}/retry`),

  getPlatforms: (id: string) =>
    api.get<{ platforms: PostPlatform[] }>(`/api/posts/${id}/platforms`),

  getHistory: (id: string) =>
    api.get<{ versions: unknown[] }>(`/api/posts/${id}/history`),

  translateContext: (id: string) =>
    api.post<{ translations: Record<string, string> }>(`/api/posts/${id}/translate`),

  generateCaption: (id: string, platform: string) =>
    api.post<{ ok: boolean; platform: string; caption: string; field: string }>(`/api/posts/${id}/generate-caption`, { platform }),

  delete: (id: string) =>
    api.delete(`/api/posts/${id}`),
};
