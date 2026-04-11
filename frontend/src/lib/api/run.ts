import { api } from './client';
import type { PostingJob, GenerationRun } from '../types';

export interface GenerateParams {
  client_slugs?: string[];
  date_from:     string;
  date_to:       string;
}

export const runApi = {
  triggerPosting: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string; mode: string }>('/api/run/posting', params),

  triggerGenerate: (params: GenerateParams) =>
    api.post<{ ok: boolean; job_id: string }>('/api/run/generate', params),

  fetchUrls: (params: Record<string, unknown> = {}) =>
    api.post<{ ok: boolean; job_id: string }>('/api/run/fetch-urls', params),

  listJobs: () =>
    api.get<{ jobs: PostingJob[] }>('/api/run/jobs'),

  getJob: (id: string) =>
    api.get<{ job: PostingJob }>(`/api/run/jobs/${id}`),

  listGenerationRuns: () =>
    api.get<{ runs: GenerationRun[] }>('/api/run/generate/runs'),

  getGenerationRun: (id: string) =>
    api.get<{ run: GenerationRun }>(`/api/run/generate/runs/${id}`),

  getStatus: (trackingId: string) =>
    api.get<{ status: unknown }>(`/api/run/status/${trackingId}`),
};
