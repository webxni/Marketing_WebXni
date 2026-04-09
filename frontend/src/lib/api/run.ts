import { api } from './client';
import type { PostingJob } from '../types';

export const runApi = {
  triggerPosting: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string; mode: string }>('/api/run/posting', params),

  triggerGenerate: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string }>('/api/run/generate', params),

  fetchUrls: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string }>('/api/run/fetch-urls', params),

  listJobs: () =>
    api.get<{ jobs: PostingJob[] }>('/api/run/jobs'),

  getJob: (id: string) =>
    api.get<{ job: PostingJob }>(`/api/run/jobs/${id}`),

  getStatus: (trackingId: string) =>
    api.get<{ status: unknown }>(`/api/run/status/${trackingId}`),
};
