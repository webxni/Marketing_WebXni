import { api } from './client';

export interface NotionImportCounts {
  created: number;
  updated: number;
  skipped: number;
  errors:  number;
}

export interface NotionImportResponse {
  ok:      boolean;
  counts:  NotionImportCounts;
  results: Array<{ notion_id: string; name?: string; slug?: string; action: string; error?: string; tabs?: string[] }>;
}

export interface NotionFullImportParams {
  database_id:            string;
  notion_id_to_app_slug?: Record<string, string>;
  active_only?:           boolean;
  force_sub_tables?:      boolean;
}

export const notionApi = {
  importClientsFull: (params: NotionFullImportParams) =>
    api.post<NotionImportResponse>('/api/notion/import/clients/full', params),
};
