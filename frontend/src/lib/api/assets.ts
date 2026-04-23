import { api } from './client';

export interface PostAsset {
  id:           string;
  r2_key:       string;
  r2_bucket:    string;
  filename:     string | null;
  content_type: string | null;
  size_bytes:   number | null;
  sort_order:   number;
  url:          string | null;
  created_at?:  number;
}

export interface UploadResult {
  ok:          boolean;
  /** When a single file is uploaded, the response echoes the legacy flat shape. */
  asset_id?:   string;
  r2_key?:     string;
  bucket?:     string;
  url?:        string | null;
  sort_order?: number;
  /** Always set: one entry per uploaded file (size 1 for legacy callers). */
  assets:      PostAsset[];
  count?:      number;
}

export const assetsApi = {
  /**
   * Upload one or more files. When no post_id is supplied the assets are
   * created unattached (post_id=NULL) and can be attached later via attach().
   */
  upload: (
    files: File | File[],
    clientId?: string,
    postId?: string,
    bucket: 'MEDIA' | 'IMAGES' = 'MEDIA',
  ) => {
    const list = Array.isArray(files) ? files : [files];
    const fd = new FormData();
    fd.append('bucket', bucket);
    if (clientId) fd.append('client_id', clientId);
    if (postId)   fd.append('post_id',   postId);
    if (list.length === 1) {
      fd.append('file', list[0]);
    } else {
      for (const f of list) fd.append('files[]', f);
    }
    return api.upload<UploadResult>('/api/assets/upload', fd);
  },

  /** List the ordered attached assets for a post. */
  list: (postId: string) =>
    api.get<{ assets: PostAsset[] }>(`/api/assets/post/${postId}`),

  /** Link previously-unattached assets (uploaded with no post_id) to a post. */
  attach: (postId: string, assetIds: string[]) =>
    api.post<{ ok: boolean; attached: number }>(
      `/api/assets/post/${postId}/attach`,
      { asset_ids: assetIds },
    ),

  /** Reorder attached assets; the first id becomes the primary / thumbnail. */
  reorder: (postId: string, order: string[]) =>
    api.post<{ ok: boolean }>(`/api/assets/post/${postId}/reorder`, { order }),

  delete: (id: string) =>
    api.delete<{ ok: boolean }>(`/api/assets/${id}`),
};
