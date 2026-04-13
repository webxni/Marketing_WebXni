import { api } from './client';

export interface PortalSummary {
  client: { id: string; slug: string; canonical_name: string };
  period: { month: string };
  summary: { total: number; published: number; scheduled: number; failed: number };
  by_platform: { platform: string; status: string; count: number }[];
  recent_posts: { id: string; title: string; status: string; content_type: string; platforms: string; publish_date: string }[];
}

export interface PortalPost {
  id: string; title: string; status: string; content_type: string;
  platforms: string; publish_date: string;
  post_urls: { platform: string; real_url: string | null; status: string }[];
}

export interface PortalReport {
  client: { id: string; slug: string; canonical_name: string };
  period: { from: string; to: string };
  summary: { total: number; published: number; success_rate: number };
  posts: { id: string; title: string; status: string; content_type: string; platforms: string; publish_date: string }[];
  post_platforms: { platform: string; status: string; real_url: string | null; post_id: string; title: string; publish_date: string }[];
}

export const portalApi = {
  summary:  (clientId?: string) =>
    api.get<PortalSummary>(`/api/portal/summary${clientId ? `?client_id=${clientId}` : ''}`),

  posts: (params: { page?: number; limit?: number; status?: string; client_id?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page)      q.set('page',      String(params.page));
    if (params.limit)     q.set('limit',     String(params.limit));
    if (params.status)    q.set('status',    params.status);
    if (params.client_id) q.set('client_id', params.client_id);
    return api.get<{ posts: PortalPost[]; total: number; page: number; pages: number }>(`/api/portal/posts?${q}`);
  },

  report: (params: { from?: string; to?: string; client_id?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.from)      q.set('from',      params.from);
    if (params.to)        q.set('to',        params.to);
    if (params.client_id) q.set('client_id', params.client_id);
    return api.get<PortalReport>(`/api/portal/report?${q}`);
  },
};
