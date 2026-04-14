/**
 * Upload-Post API client
 * Docs: https://docs.upload-post.com
 * Auth: Authorization: Apikey YOUR_KEY
 *
 * Three posting endpoints:
 *   /api/upload_text   — text posts (no media)
 *   /api/upload_photos — image posts (multipart)
 *   /api/upload        — video posts (URL)
 *
 * Port of post_content.py UploadPostClient
 */

const BASE = 'https://api.upload-post.com';

export interface UploadPostResponse {
  success: boolean;
  message?: string;
  job_id?: string;
  request_id?: string;
  total_platforms?: number;
  [key: string]: unknown;
}

export class UploadPostError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Upload-Post HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'UploadPostError';
  }

  /** 400 with idempotency/already/duplicate → treat as already submitted */
  get isIdempotent(): boolean {
    const lower = this.body.toLowerCase();
    return (
      this.status === 400 &&
      (lower.includes('idempotency') ||
        lower.includes('already') ||
        lower.includes('duplicate'))
    );
  }
}

export interface PostTextParams {
  user: string;
  platform: string;
  title: string;
  scheduled_date?: string;
  idempotency_key?: string;
  facebook_page_id?: string;
  target_linkedin_page_id?: string;
  gbp_location_id?: string;
  // GBP post type + CTA
  gbp_topic_type?: string;        // 'STANDARD'|'EVENT'|'OFFER'
  gbp_cta_type?: string;          // 'BOOK'|'ORDER'|'SHOP'|'LEARN_MORE'|'SIGN_UP'|'CALL'
  gbp_cta_url?: string;
  // GBP event fields
  gbp_event_title?: string;
  gbp_event_start_date?: string;
  gbp_event_start_time?: string;
  gbp_event_end_date?: string;
  gbp_event_end_time?: string;
  // GBP offer fields
  gbp_coupon_code?: string;
  gbp_redeem_url?: string;
  gbp_terms?: string;
  [key: string]: string | undefined;
}

export interface PostPhotoParams {
  user: string;
  platform: string;
  title: string;
  photoBytes: ArrayBuffer;       // raw bytes from R2 — File() accepts ArrayBuffer
  photoFilename: string;
  photoContentType: string;
  scheduled_date?: string;
  idempotency_key?: string;
  facebook_page_id?: string;
  target_linkedin_page_id?: string;
  pinterest_board_id?: string;
  gbp_location_id?: string;
  // GBP post type + CTA
  gbp_topic_type?: string;
  gbp_cta_type?: string;
  gbp_cta_url?: string;
  // GBP event fields
  gbp_event_title?: string;
  gbp_event_start_date?: string;
  gbp_event_start_time?: string;
  gbp_event_end_date?: string;
  gbp_event_end_time?: string;
  // GBP offer fields
  gbp_coupon_code?: string;
  gbp_redeem_url?: string;
  gbp_terms?: string;
}

export interface PostVideoParams {
  user: string;
  platform: string;
  title: string;
  videoUrl: string;
  content_type?: 'reel' | 'video';
  scheduled_date?: string;
  idempotency_key?: string;
  description?: string;
  instagram_media_type?: 'REELS' | 'VIDEO';
  facebook_media_type?: 'REELS' | 'VIDEO';
  youtube_title?: string;
  youtube_description?: string;
  privacyStatus?: string;
  privacy_level?: string;
  gbp_location_id?: string;
  [key: string]: string | undefined;
}

export class UploadPostClient {
  private readonly auth: Record<string, string>;

  constructor(apiKey: string) {
    this.auth = { Authorization: `Apikey ${apiKey}` };
  }

  /** POST /api/upload_text — text posts: facebook, linkedin, x, threads, bluesky, google_business */
  async postText(params: PostTextParams): Promise<UploadPostResponse> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'idempotency_key' || v === undefined) continue;
      fd.append(k === 'platform' ? 'platform[]' : k, v);
    }
    return this._call('/api/upload_text', fd, params.idempotency_key);
  }

  /**
   * POST /api/upload_photos — image posts (multipart)
   * Streams from R2 — does NOT buffer into memory to avoid Worker limits.
   */
  async postPhoto(params: PostPhotoParams): Promise<UploadPostResponse> {
    const fd = new FormData();
    fd.append('user', params.user);
    fd.append('platform[]', params.platform);
    fd.append('title', params.title);
    if (params.scheduled_date) fd.append('scheduled_date', params.scheduled_date);
    if (params.facebook_page_id) fd.append('facebook_page_id', params.facebook_page_id);
    if (params.target_linkedin_page_id) fd.append('target_linkedin_page_id', params.target_linkedin_page_id);
    if (params.pinterest_board_id) fd.append('pinterest_board_id', params.pinterest_board_id);
    if (params.gbp_location_id)   fd.append('gbp_location_id',    params.gbp_location_id);
    if (params.gbp_topic_type)    fd.append('gbp_topic_type',      params.gbp_topic_type);
    if (params.gbp_cta_type)      fd.append('gbp_cta_type',        params.gbp_cta_type);
    if (params.gbp_cta_url)       fd.append('gbp_cta_url',         params.gbp_cta_url);
    if (params.gbp_event_title)   fd.append('gbp_event_title',     params.gbp_event_title);
    if (params.gbp_event_start_date) fd.append('gbp_event_start_date', params.gbp_event_start_date);
    if (params.gbp_event_start_time) fd.append('gbp_event_start_time', params.gbp_event_start_time);
    if (params.gbp_event_end_date)   fd.append('gbp_event_end_date',   params.gbp_event_end_date);
    if (params.gbp_event_end_time)   fd.append('gbp_event_end_time',   params.gbp_event_end_time);
    if (params.gbp_coupon_code)   fd.append('gbp_coupon_code',     params.gbp_coupon_code);
    if (params.gbp_redeem_url)    fd.append('gbp_redeem_url',      params.gbp_redeem_url);
    if (params.gbp_terms)         fd.append('gbp_terms',           params.gbp_terms);
    fd.append(
      'photos[]',
      new File([params.photoBytes], params.photoFilename, { type: params.photoContentType }),
    );
    return this._call('/api/upload_photos', fd, params.idempotency_key);
  }

  /** POST /api/upload — video URL posts: tiktok, instagram, youtube, facebook, etc. */
  async postVideo(params: PostVideoParams): Promise<UploadPostResponse> {
    const fd = new FormData();
    fd.append('user', params.user);
    fd.append('platform[]', params.platform);
    fd.append('title', params.title);
    fd.append('video', params.videoUrl);
    if (params.scheduled_date) fd.append('scheduled_date', params.scheduled_date);
    if (params.description) fd.append('description', params.description);
    if (params.youtube_title) fd.append('youtube_title', params.youtube_title);
    if (params.youtube_description) fd.append('youtube_description', params.youtube_description);
    if (params.privacyStatus) fd.append('privacyStatus', params.privacyStatus);
    if (params.privacy_level) fd.append('privacy_level', params.privacy_level);
    if (params.gbp_location_id) fd.append('gbp_location_id', params.gbp_location_id);
    if (params.content_type === 'reel') {
      if (params.platform === 'instagram') fd.append('media_type', params.instagram_media_type ?? 'REELS');
      if (params.platform === 'facebook') fd.append('facebook_media_type', params.facebook_media_type ?? 'REELS');
    } else if (params.content_type === 'video') {
      if (params.platform === 'instagram') fd.append('media_type', params.instagram_media_type ?? 'VIDEO');
      if (params.platform === 'facebook') fd.append('facebook_media_type', params.facebook_media_type ?? 'VIDEO');
    }

    for (const [k, v] of Object.entries(params)) {
      if (
        k === 'user' ||
        k === 'platform' ||
        k === 'title' ||
        k === 'videoUrl' ||
        k === 'scheduled_date' ||
        k === 'idempotency_key' ||
        k === 'description' ||
        k === 'youtube_title' ||
        k === 'youtube_description' ||
        k === 'privacyStatus' ||
        k === 'privacy_level' ||
        k === 'gbp_location_id' ||
        k === 'content_type' ||
        k === 'instagram_media_type' ||
        k === 'facebook_media_type' ||
        v === undefined
      ) continue;
      fd.append(k, v);
    }
    return this._call('/api/upload', fd, params.idempotency_key);
  }

  /** GET /api/uploadposts/status — poll async/scheduled post status */
  async getStatus(params: { jobId?: string; requestId?: string }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params.jobId) qs.set('job_id', params.jobId);
    if (params.requestId) qs.set('request_id', params.requestId);
    const r = await fetch(`${BASE}/api/uploadposts/status?${qs}`, {
      headers: this.auth,
    });
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json();
  }

  /** GET /api/uploadposts/history — for URL fetch-back after posts go live */
  async getHistory(limit = 100): Promise<{ history: Array<Record<string, unknown>> }> {
    const r = await fetch(`${BASE}/api/uploadposts/history?limit=${limit}`, {
      headers: this.auth,
    });
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json() as Promise<{ history: Array<Record<string, unknown>> }>;
  }

  /** GET /api/uploadposts/post-analytics/request_id — published URL + stats by request id */
  async getPostAnalytics(requestId: string): Promise<unknown> {
    const r = await fetch(
      `${BASE}/api/uploadposts/post-analytics/request_id?request_id=${encodeURIComponent(requestId)}`,
      { headers: this.auth },
    );
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json();
  }

  /** GET /api/uploadposts/google-business/locations — list GBP location IDs */
  async getGbpLocations(profile: string): Promise<unknown> {
    const r = await fetch(
      `${BASE}/api/uploadposts/google-business/locations?profile=${encodeURIComponent(profile)}`,
      { headers: this.auth },
    );
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json();
  }

  /** GET /api/uploadposts/pinterest/boards — list Pinterest board IDs */
  async getPinterestBoards(profile: string): Promise<unknown> {
    const r = await fetch(
      `${BASE}/api/uploadposts/pinterest/boards?profile=${encodeURIComponent(profile)}`,
      { headers: this.auth },
    );
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json();
  }

  /** GET /api/uploadposts/linkedin/pages — list LinkedIn page IDs */
  async getLinkedinPages(profile: string): Promise<unknown> {
    const r = await fetch(
      `${BASE}/api/uploadposts/linkedin/pages?profile=${encodeURIComponent(profile)}`,
      { headers: this.auth },
    );
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json();
  }

  /** GET /api/uploadposts/users/{username} — profile + connected social accounts */
  async getProfile(profile: string): Promise<unknown> {
    const r = await fetch(
      `${BASE}/api/uploadposts/users/${encodeURIComponent(profile)}`,
      { headers: this.auth },
    );
    if (!r.ok) throw new UploadPostError(r.status, await r.text());
    return r.json();
  }

  /** Verify API key — lightweight check via history endpoint */
  async verify(): Promise<boolean> {
    try {
      await this.getHistory(1);
      return true;
    } catch {
      return false;
    }
  }

  private async _call(
    path: string,
    body: FormData,
    idempotencyKey?: string,
  ): Promise<UploadPostResponse> {
    const headers: Record<string, string> = { ...this.auth };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body });
    if (!r.ok) {
      const text = await r.text();
      throw new UploadPostError(r.status, text);
    }
    return r.json() as Promise<UploadPostResponse>;
  }
}
