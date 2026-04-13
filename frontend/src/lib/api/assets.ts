import { api } from './client';

export interface UploadResult {
  ok:       boolean;
  asset_id: string;
  r2_key:   string;
  bucket:   string;
  url:      string | null;  // public URL (null if R2_MEDIA_PUBLIC_URL not configured)
}

export const assetsApi = {
  upload: (file: File, clientId?: string, postId?: string, bucket: 'MEDIA' | 'IMAGES' = 'MEDIA') => {
    const fd = new FormData();
    fd.append('file',   file);
    fd.append('bucket', bucket);
    if (clientId) fd.append('client_id', clientId);
    if (postId)   fd.append('post_id',   postId);
    return api.upload<UploadResult>('/api/assets/upload', fd);
  },

  delete: (id: string) =>
    api.delete<{ ok: boolean }>(`/api/assets/${id}`),
};
