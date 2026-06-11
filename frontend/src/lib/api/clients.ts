import { api } from './client';
import type { Client, ClientPlatform, ClientMonthlyContentPlan, ClientMonthlyTopic, ConnectionHealth } from '../types';

export interface ClientContentHistoryItem {
  id: string;
  title: string | null;
  publish_date: string | null;
  content_type: string | null;
  platforms: string | null;
  topic_service_category: string | null;
  target_keyword: string | null;
  status: string | null;
  monthly_topic_title: string | null;
  monthly_topic_status: string | null;
  monthly_topic_skip_reason: string | null;
  linked_service_category: string | null;
}

export interface PlatformConfigWarning {
  code: string;
  message: string;
}

export interface UploadPostPlatformSyncItem {
  client: string;
  platform: string;
  action: 'created' | 'updated' | 'skipped';
  account_id: string | null;
  username: string | null;
  profile_url: string | null;
  details: Record<string, string | null>;
}

export interface UploadPostPlatformSyncResult {
  ok: boolean;
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  synced: UploadPostPlatformSyncItem[];
  errors: Array<{ client: string; error: string }>;
  content: string;
  platforms: ClientPlatform[];
}

export interface WpTestResult {
  ok:     boolean;
  user?:  { id: number; name: string; email: string };
  error?: string;
}

export interface WpCategory { id: number; name: string; slug: string; count: number }
export interface WpAuthor   { id: number; name: string; slug: string }
export interface WpTemplate {
  id: string; client_id: string | null; template_key: string;
  name: string; html_template: string; css: string | null;
  description: string | null; is_default: number;
}

export const clientsApi = {
  list: (status: 'active' | 'inactive' | 'all' = 'active') =>
    api.get<{ clients: Client[] }>(`/api/clients?status=${status}`),

  get: (slug: string) =>
    api.get<{ client: Client & { platforms: ClientPlatform[]; gbp_locations: unknown[]; restrictions: string[] } }>(`/api/clients/${slug}`),

  connectionCheck: (id: string) =>
    api.get<{ ok: boolean; profile_ok: boolean; profile_message: string; profile_message_es: string; accounts: ConnectionHealth[] }>(`/api/clients/${id}/connection-check`),

  create: (data: Partial<Client>) =>
    api.post<{ client: Client }>('/api/clients', data),

  update: (slug: string, data: Partial<Client>) =>
    api.put<{ client: Client }>(`/api/clients/${slug}`, data),

  delete: (slug: string, opts: { confirmed?: boolean; hard_delete?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.confirmed) q.set('confirmed', 'true');
    if (opts.hard_delete) q.set('hard_delete', 'true');
    return api.delete<{ ok: boolean; archived?: boolean; hard_deleted?: boolean; posts_preserved?: number }>(`/api/clients/${slug}?${q}`);
  },

  updatePlatform: (slug: string, platform: string, data: Record<string, unknown>) =>
    api.put<{ platform: ClientPlatform; warnings?: PlatformConfigWarning[] }>(`/api/clients/${slug}/platforms/${platform}`, data),

  // WordPress integration
  wpStatus: (slug: string) =>
    api.get<{ configured: boolean; base_url: string | null; username: string | null; template_key: string | null; default_status: string }>(`/api/clients/${slug}/wordpress/status`),

  wpTest: (slug: string) =>
    api.post<WpTestResult>(`/api/clients/${slug}/wordpress/test`),

  wpCategories: (slug: string) =>
    api.get<{ categories: WpCategory[] }>(`/api/clients/${slug}/wordpress/categories`),

  wpAuthors: (slug: string) =>
    api.get<{ authors: WpAuthor[] }>(`/api/clients/${slug}/wordpress/authors`),

  wpTemplates: (slug: string) =>
    api.get<{ templates: WpTemplate[] }>(`/api/clients/${slug}/wordpress/templates`),

  wpSaveTemplate: (slug: string, data: Partial<WpTemplate>) =>
    api.post<{ template: WpTemplate }>(`/api/clients/${slug}/wordpress/templates`, data),

  wpDeleteTemplate: (slug: string, key: string) =>
    api.delete(`/api/clients/${slug}/wordpress/templates/${key}`),

  getPlatforms: (slug: string) =>
    api.get<{ platforms: ClientPlatform[] }>(`/api/clients/${slug}/platforms`),

  syncUploadPostPlatforms: (slug: string, opts: { dry_run?: boolean; force?: boolean } = {}) =>
    api.post<UploadPostPlatformSyncResult>(`/api/clients/${slug}/platforms/sync-upload-post`, opts),

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

  getEvents: (slug: string) =>
    api.get<{ events: unknown[] }>(`/api/clients/${slug}/events`),

  createEvent: (slug: string, data: Record<string, unknown>) =>
    api.post<{ event: unknown }>(`/api/clients/${slug}/events`, data),

  updateEvent: (slug: string, id: string, data: Record<string, unknown>) =>
    api.put<{ ok: boolean }>(`/api/clients/${slug}/events/${id}`, data),

  deleteEvent: (slug: string, id: string) =>
    api.delete(`/api/clients/${slug}/events/${id}`),

  // GBP AI generation + asset upload
  generateGbp: (slug: string, type: 'offer' | 'event') =>
    api.post<{ variations: unknown[] }>(`/api/clients/${slug}/gbp/generate`, { type }),

  uploadGbpAsset: (slug: string, itemType: 'offers' | 'events', itemId: string, formData: FormData) =>
    api.upload<{ ok: boolean; r2_key: string; url: string | null }>(
      `/api/clients/${slug}/gbp/${itemType}/${itemId}/upload`, formData,
    ),

  // Intelligence
  getIntelligence: (slug: string) =>
    api.get<{ intelligence: unknown }>(`/api/clients/${slug}/intelligence`),

  saveIntelligence: (slug: string, data: Record<string, unknown>) =>
    api.put<{ intelligence: unknown }>(`/api/clients/${slug}/intelligence`, data),

  getContentHistory: (slug: string, params: Record<string, string | number | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') q.set(key, String(value));
    }
    return api.get<{ history: ClientContentHistoryItem[] }>(`/api/clients/${slug}/content-history?${q}`);
  },

  // Platform links
  getPlatformLinks: (slug: string) =>
    api.get<{ links: unknown }>(`/api/clients/${slug}/platform-links`),

  savePlatformLinks: (slug: string, data: Record<string, unknown>) =>
    api.put<{ links: unknown }>(`/api/clients/${slug}/platform-links`, data),

  // Platform management
  deletePlatform: (slug: string, platform: string) =>
    api.delete(`/api/clients/${slug}/platforms/${platform}`),

  // Feedback
  getFeedback: (slug: string) =>
    api.get<{ feedback: unknown[] }>(`/api/clients/${slug}/feedback`),

  addFeedback: (slug: string, data: Record<string, unknown>) =>
    api.post<{ feedback: unknown }>(`/api/clients/${slug}/feedback`, data),

  updateFeedback: (slug: string, id: string, data: Record<string, unknown>) =>
    api.patch<{ ok: boolean }>(`/api/clients/${slug}/feedback/${id}`, data),

  deleteFeedback: (slug: string, id: string) =>
    api.delete(`/api/clients/${slug}/feedback/${id}`),

  getMonthlyTopics: (slug: string, month: string, status = 'all') =>
    api.get<{ topics: ClientMonthlyTopic[] }>(`/api/clients/${slug}/monthly-topics?month=${encodeURIComponent(month)}&status=${encodeURIComponent(status)}`),

  getMonthlyContentPlan: (slug: string, month: string) =>
    api.get<{ plan: ClientMonthlyContentPlan | null }>(`/api/clients/${slug}/monthly-plan?month=${encodeURIComponent(month)}`),

  saveMonthlyContentPlan: (slug: string, data: Record<string, unknown>) =>
    api.put<{ plan: ClientMonthlyContentPlan }>(`/api/clients/${slug}/monthly-plan`, data),

  createMonthlyTopic: (slug: string, data: Record<string, unknown>) =>
    api.post<{ topic: ClientMonthlyTopic }>(`/api/clients/${slug}/monthly-topics`, data),

  bulkCreateMonthlyTopics: (slug: string, data: Record<string, unknown>) =>
    api.post<{ inserted: number }>(`/api/clients/${slug}/monthly-topics/bulk`, data),

  parseMonthlyTopics: (slug: string, data: Record<string, unknown>) =>
    api.post<{ topics: ClientMonthlyTopic[] }>(`/api/clients/${slug}/monthly-topics/parse`, data),

  suggestMonthlyTopics: (slug: string, data: Record<string, unknown>) =>
    api.post<{ suggestions: ClientMonthlyTopic[] }>(`/api/clients/${slug}/monthly-topics/suggest`, data),

  updateMonthlyTopic: (slug: string, topicId: string, data: Record<string, unknown>) =>
    api.put<{ topic: ClientMonthlyTopic }>(`/api/clients/${slug}/monthly-topics/${topicId}`, data),

  deleteMonthlyTopic: (slug: string, topicId: string) =>
    api.delete(`/api/clients/${slug}/monthly-topics/${topicId}`),
};
