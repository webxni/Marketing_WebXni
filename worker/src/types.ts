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
  SELF: Fetcher;   // Service binding — self-call without going through public network
  UPLOAD_POST_API_KEY: string;
  OPENAI_API_KEY: string;
  R2_MEDIA_PUBLIC_URL: string;
  NOTION_API_TOKEN?: string;       // optional — only needed for Notion import
  // Discord
  DISCORD_BOT_TOKEN?:      string; // wrangler secret
  DISCORD_PUBLIC_KEY?:     string; // wrangler secret — Ed25519 public key from Developer Portal
  DISCORD_APPLICATION_ID?: string; // wrangler var — App ID from Developer Portal
  DISCORD_CHANNEL_ID?:     string; // wrangler var — target notification channel
  DISCORD_OWNER_ID?:       string; // wrangler var — owner's user ID for DMs
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
  userId:   string;
  email:    string;
  name:     string;
  role:     'admin' | 'designer' | 'client';
  clientId: string | null; // set for role=client, null otherwise
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
  id:                       string;
  slug:                     string;
  canonical_name:           string;
  package:                  string | null;
  status:                   string | null;
  manual_only:              number;
  requires_approval_from:   string | null;
  language:                 string | null;
  upload_post_profile:      string | null;
  owner_group:              string | null;
  never_mix_with:           string | null;
  // WordPress — legacy fields (kept for backwards compat)
  wp_domain:                string | null;
  wp_url:                   string | null;
  wp_auth:                  string | null;
  wp_template:              string | null;
  // WordPress — new per-client credential fields (migration 0004)
  wp_admin_url:             string | null;
  wp_base_url:              string | null;
  wp_rest_base:             string | null;
  wp_username:              string | null;
  wp_application_password:  string | null;
  wp_default_post_status:   string | null;
  wp_default_author_id:     number | null;
  wp_default_category_ids:  string | null;  // JSON array e.g. "[1,5,12]"
  wp_template_key:          string | null;
  wp_featured_image_mode:   string | null;
  wp_excerpt_mode:          string | null;
  // Notion sync
  notion_page_id:           string | null;
  brand_json:               string | null;
  notes:                    string | null;
  // Contact + identity (migration 0006)
  phone:                    string | null;
  email:                    string | null;
  owner_name:               string | null;
  cta_text:                 string | null;
  cta_label:                string | null;
  industry:                 string | null;
  state:                    string | null;
  created_at:               number;
  updated_at:               number;
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
  profile_url?:            string | null;
  profile_username?:       string | null;
  connection_status?:      string | null;
  yt_channel_id?:          string | null;
  linkedin_urn?:           string | null;
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
  id:               string;
  client_id:        string;
  title:            string;
  description:      string | null;
  cta_text:         string | null;
  valid_until:      string | null;
  active:           number;
  // GBP fields (migration 0009)
  gbp_coupon_code:  string | null;
  gbp_redeem_url:   string | null;
  gbp_terms:        string | null;
  gbp_cta_type:     string | null;
  gbp_cta_url:      string | null;
  gbp_location_id:  string | null;
  recurrence:       string;   // 'none'|'weekly'|'biweekly'|'monthly'
  next_run_date:    string | null;
  last_posted_at:   string | null;
  asset_r2_key:     string | null;
  asset_r2_bucket:  string | null;
  paused:           number;
  // AI generation (migration 0014)
  ai_image_prompt:  string | null;
  created_at:       number;
}

export interface ClientEventRow {
  id:                  string;
  client_id:           string;
  title:               string;
  description:         string | null;
  gbp_event_title:     string | null;
  gbp_event_start_date: string | null;
  gbp_event_start_time: string | null;
  gbp_event_end_date:  string | null;
  gbp_event_end_time:  string | null;
  gbp_cta_type:        string | null;
  gbp_cta_url:         string | null;
  gbp_location_id:     string | null;
  asset_r2_key:        string | null;
  asset_r2_bucket:     string | null;
  recurrence:          string;   // 'once'|'weekly'|'biweekly'|'monthly'
  next_run_date:       string | null;
  last_posted_at:      string | null;
  active:              number;
  paused:              number;
  // AI generation (migration 0014)
  ai_image_prompt:     string | null;
  created_at:          number;
  updated_at:          number;
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
  secondary_keywords:     string | null;
  ai_image_prompt:        string | null;
  ai_video_prompt:        string | null;
  video_script:           string | null;
  asset_r2_key:           string | null;
  asset_r2_bucket:        string | null;
  asset_type:             string | null;
  canva_link:             string | null;
  wp_post_url:            string | null;
  wp_post_id:             number | null;
  wp_post_status:         string | null;
  blog_excerpt:           string | null;
  wp_featured_media_id:   number | null;
  // GBP advanced fields (migration 0004 + 0009)
  gbp_location_id:        string | null;  // per-post location override (migration 0009)
  gbp_topic_type:         string | null;  // 'STANDARD'|'EVENT'|'OFFER'
  gbp_cta_type:           string | null;  // 'LEARN_MORE'|'BOOK'|'ORDER'|'SHOP'|'SIGN_UP'|'CALL'
  gbp_cta_url:            string | null;
  gbp_event_title:        string | null;
  gbp_event_start_date:   string | null;
  gbp_event_start_time:   string | null;
  gbp_event_end_date:     string | null;
  gbp_event_end_time:     string | null;
  gbp_coupon_code:        string | null;
  gbp_redeem_url:         string | null;
  gbp_terms:              string | null;
  // Notion sync
  notion_page_id:         string | null;
  ready_for_automation:   number;
  asset_delivered:        number;
  skarleth_status:        string | null;
  skarleth_notes:         string | null;
  error_log:              string | null;
  last_automation_run:    string | null;
  scheduled_by_automation: number;
  platform_manual_override: number;
  automation_slot_key:    string | null;
  generation_run_id:      string | null;
  created_by:             string | null;
  posted_at:              number | null;
  created_at:             number;
  updated_at:             number;
}

export interface WpTemplateRow {
  id:            string;
  client_id:     string | null;
  template_key:  string;
  name:          string;
  html_template: string;
  css:           string | null;
  description:   string | null;
  is_default:    number;
  created_at:    number;
  updated_at:    number;
}

export interface PostPlatformRow {
  id:              string;
  post_id:         string;
  platform:        string;
  tracking_id:     string | null;
  real_url:        string | null;
  platform_post_id: string | null;
  status:          string | null;
  error_message:   string | null;
  attempted_at:    string | null;
  idempotency_key: string | null;
  metrics_json:    string | null;
  metrics_source:  string | null;
  metrics_error:   string | null;
  profile_snapshot_json: string | null;
  profile_snapshot_latest_json: string | null;
  profile_snapshot_latest_date: string | null;
  metrics_synced_at: number | null;
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
