import { api } from './client';
import type { PostingJob, GenerationRun, Post } from '../types';

export interface GenerateParams {
  client_slugs?:  string[];
  date_from:      string;
  date_to:        string;
  publish_time?:  string;  // HH:MM — applied to all generated posts
  overwrite_existing?: boolean;
}

export const runApi = {
  triggerPosting: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string; mode: string }>('/api/run/posting', params),

  triggerGenerate: (params: GenerateParams) =>
    api.post<{ ok: boolean; job_id: string }>('/api/run/generate', params),

  fetchUrls: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string }>('/api/run/fetch-urls', params),

  listQueue: () =>
    api.get<{ posts: Post[] }>('/api/run/queue'),

  listJobs: () =>
    api.get<{ jobs: PostingJob[] }>('/api/run/jobs'),

  getJob: (id: string) =>
    api.get<{ job: PostingJob }>(`/api/run/jobs/${id}`),

  listGenerationRuns: () =>
    api.get<{ runs: GenerationRun[] }>('/api/run/generate/runs'),

  getGenerationRun: (id: string) =>
    api.get<{ run: GenerationRun }>(`/api/run/generate/runs/${id}`),

  cancelRun: (id: string) =>
    api.patch<{ ok: boolean }>(`/api/run/generate/runs/${id}/cancel`),

  getStatus: (trackingId: string) =>
    api.get<{ status: unknown }>(`/api/run/status/${trackingId}`),
};
