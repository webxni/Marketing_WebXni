/** Marketing_WebXni — shared types */

// ─────────────────────────────────────────────────────────────────────────────
// Worker environment bindings
// ─────────────────────────────────────────────────────────────────────────────

/** Main worker bindings */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: R2Bucket;
  KV_BINDING: KVNamespace;
  ASSETS: Fetcher;
  UPLOAD_POST_API_KEY: string;
  OPENAI_API_KEY: string;
  R2_MEDIA_PUBLIC_URL: string;
}

/** LOADER worker bindings (no SESSION / ASSETS) */
export interface LoaderEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: R2Bucket;
  UPLOAD_POST_API_KEY: string;
  OPENAI_API_KEY: string;
  R2_MEDIA_PUBLIC_URL: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session / Auth
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionData {
  userId: string;
  email:  string;
  name:   string;
  role:   'admin' | 'manager' | 'editor' | 'reviewer' | 'operator';
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Row types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserRow {
  id:            string;
  email:         string;
  name:          string;
  role:          string;
  password_hash: string;
  is_active:     number;
  last_login:    number | null;
  created_at:    number;
  updated_at:    number;
}

export interface ClientRow {
  id:                     string;
  slug:                   string;
  canonical_name:         string;
  package:                string | null;
  status:                 string | null;
  manual_only:            number;
  requires_approval_from: string | null;
  language:               string | null;
  upload_post_profile:    string | null;
  owner_group:            string | null;
  never_mix_with:         string | null;
  wp_domain:              string | null;
  wp_url:                 string | null;
  wp_auth:                string | null;
  wp_template:            string | null;
  brand_json:             string | null;
  notes:                  string | null;
  created_at:             number;
  updated_at:             number;
}

export interface ClientPlatformRow {
  id:                      string;
  client_id:               string;
  platform:                string;
  account_id:              string | null;
  username:                string | null;
  page_id:                 string | null;
  upload_post_board_id:    string | null;
  upload_post_location_id: string | null;
  privacy_level:           string | null;
  privacy_status:          string | null;
  paused:                  number;
  paused_reason:           string | null;
  paused_since:            string | null;
  notes:                   string | null;
}

export interface ClientGbpLocationRow {
  id:                  string;
  client_id:           string;
  label:               string;
  location_id:         string;
  upload_post_profile: string | null;
  caption_field:       string | null;
  posted_field:        string | null;
  paused:              number;
  paused_reason:       string | null;
  sort_order:          number;
}

export interface ClientCategoryRow {
  id:         string;
  client_id:  string;
  name:       string;
  sort_order: number;
}

export interface ClientServiceRow {
  id:            string;
  client_id:     string;
  category_id:   string | null;
  name:          string;
  description:   string | null;
  active:        number;
  sort_order:    number;
  category_name: string | null; // joined
}

export interface ClientServiceAreaRow {
  id:           string;
  client_id:    string;
  city:         string;
  state:        string | null;
  zip:          string | null;
  radius_mi:    number | null;
  primary_area: number;
  sort_order:   number;
}

export interface ClientOfferRow {
  id:          string;
  client_id:   string;
  title:       string;
  description: string | null;
  cta_text:    string | null;
  valid_until: string | null;
  active:      number;
  created_at:  number;
}

export interface PostRow {
  id:                     string;
  client_id:              string;
  title:                  string | null;
  status:                 string | null;
  automation_status:      string | null;
  content_type:           string | null;
  platforms:              string | null;
  publish_date:           string | null;
  master_caption:         string | null;
  cap_facebook:           string | null;
  cap_instagram:          string | null;
  cap_linkedin:           string | null;
  cap_x:                  string | null;
  cap_threads:            string | null;
  cap_tiktok:             string | null;
  cap_pinterest:          string | null;
  cap_bluesky:            string | null;
  cap_google_business:    string | null;
  cap_gbp_la:             string | null;
  cap_gbp_wa:             string | null;
  cap_gbp_or:             string | null;
  youtube_title:          string | null;
  youtube_description:    string | null;
  blog_content:           string | null;
  seo_title:              string | null;
  meta_description:       string | null;
  slug:                   string | null;
  target_keyword:         string | null;
  ai_image_prompt:        string | null;
  ai_video_prompt:        string | null;
  video_script:           string | null;
  asset_r2_key:           string | null;
  asset_r2_bucket:        string | null;
  asset_type:             string | null;
  canva_link:             string | null;
  wp_post_url:            string | null;
  ready_for_automation:   number;
  asset_delivered:        number;
  skarleth_status:        string | null;
  skarleth_notes:         string | null;
  error_log:              string | null;
  last_automation_run:    string | null;
  scheduled_by_automation: number;
  generation_run_id:      string | null;
  created_by:             string | null;
  created_at:             number;
  updated_at:             number;
}

export interface PostPlatformRow {
  id:              string;
  post_id:         string;
  platform:        string;
  tracking_id:     string | null;
  real_url:        string | null;
  status:          string | null;
  error_message:   string | null;
  attempted_at:    string | null;
  idempotency_key: string | null;
}

export interface PostingJobRow {
  id:              string;
  triggered_by:    string | null;
  mode:            string;
  client_filter:   string | null;
  platform_filter: string | null;
  limit_count:     number | null;
  status:          string;
  stats_json:      string | null;
  created_at:      number;
  completed_at:    number | null;
}
