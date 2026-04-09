import { api } from './client';
import type { OverviewStats, PostingStats, MonthlyReport } from '../types';

export const reportsApi = {
  overview: () =>
    api.get<OverviewStats>('/api/reports/overview'),

  postingStats: (params: { from?: string; to?: string; month?: string; client?: string } = {}) => {
    const q = new URLSearchParams();
    // If month supplied, derive from/to
    if (params.month && !params.from) {
      q.set('from', `${params.month}-01`);
      q.set('to',   `${params.month}-31`);
    }
    if (params.from)   q.set('from',   params.from);
    if (params.to)     q.set('to',     params.to);
    if (params.client) q.set('client', params.client);
    return api.get<PostingStats>(`/api/reports/posting-stats?${q}`);
  },

  clientHealth: () =>
    api.get<{ health: unknown[] }>('/api/reports/client-health'),

  monthly: (clientId: string, month: string) =>
    api.get<MonthlyReport>(`/api/reports/monthly/${clientId}?month=${month}`),
};
