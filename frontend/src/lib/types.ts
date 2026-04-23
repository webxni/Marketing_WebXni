/** Shared frontend types — mirror backend DB rows + API response shapes */

export type Role = 'admin' | 'designer' | 'client';

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

export interface BlogBodyImage {
  slot:                  1 | 2 | 3;
  r2_key:                string | null;
  prompt:                string;
  wp_media_id?:          number | null;
  attempts?:             number;
  status:                'generated' | 'failed' | 'pending';
  error?:                string;
  updated_at?:           number;
  prompt_quality_score?: number;
  prompt_quality_label?: 'Good' | 'Weak';
  attempts_remaining?:   number;
  regeneration_reason?:  string;
}

export interface User {
  id:           string;
  email:        string;
  name:         string;
  role:         Role;
  is_active:    number;
  client_id:    string | null;
  client_name:  string | null;
  totp_enabled: number;
  last_login:   number | null;
  created_at:   number;
}

export interface SessionUser {
  userId:   string;
  email:    string;
  name:     string;
  role:     Role;
  clientId: string | null;
}

export interface Client {
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
  // WordPress legacy
  wp_domain:                string | null;
  wp_url:                   string | null;
  wp_auth:                  string | null;
  wp_template:              string | null;
  // WordPress — new credential fields
  wp_admin_url:             string | null;
  wp_base_url:              string | null;
  wp_rest_base:             string | null;
  wp_username:              string | null;
  wp_application_password:  string | null;
  wp_default_post_status:   string | null;
  wp_default_author_id:     number | null;
  wp_default_category_ids:  string | null;
  wp_template_key:          string | null;
  wp_featured_image_mode:   string | null;
  wp_excerpt_mode:          string | null;
  // Notion
  notion_page_id:           string | null;
  brand_json:               string | null;
  notes:                    string | null;
  // Logo + brand (migration 0005)
  logo_r2_key:              string | null;
  logo_url:                 string | null;
  brand_primary_color:      string | null;
  brand_accent_color:       string | null;
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
  // joined
  platforms?:               ClientPlatform[];
  gbp_locations?:           GbpLocation[];
  restrictions?:            string[];
}

export interface ClientPlatform {
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
  profile_url:             string | null;
  profile_username:        string | null;
  connection_status:       string | null;
  yt_channel_id:           string | null;
  linkedin_urn:            string | null;
  paused:                  number;
  paused_reason:           string | null;
  paused_since:            string | null;
  notes:                   string | null;
}

export interface ConnectionHealth {
  platform:      string;
  configured:    boolean;
  connected:     boolean;
  status:        'connected' | 'warning' | 'failed' | 'not_configured';
  message:       string;
  message_es:    string;
  details?:      Record<string, unknown>;
}

export interface GbpLocation {
  id:           string;
  label:        string;
  location_id:  string;
  paused:       number;
  sort_order:   number;
}

export interface ClientService {
  id:            string;
  client_id:     string;
  category_id:   string | null;
  name:          string;
  description:   string | null;
  active:        number;
  sort_order:    number;
  category_name: string | null;
}

export interface ClientArea {
  id:           string;
  city:         string;
  state:        string | null;
  zip:          string | null;
  primary_area: number;
}

export interface ClientOffer {
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

export interface ClientEvent {
  id:                   string;
  client_id:            string;
  title:                string;
  description:          string | null;
  gbp_event_title:      string | null;
  gbp_event_start_date: string | null;
  gbp_event_start_time: string | null;
  gbp_event_end_date:   string | null;
  gbp_event_end_time:   string | null;
  gbp_cta_type:         string | null;
  gbp_cta_url:          string | null;
  gbp_location_id:      string | null;
  asset_r2_key:         string | null;
  asset_r2_bucket:      string | null;
  recurrence:           string;   // 'once'|'weekly'|'biweekly'|'monthly'
  next_run_date:        string | null;
  last_posted_at:       string | null;
  active:               number;
  paused:               number;
  // AI generation (migration 0014)
  ai_image_prompt:      string | null;
  created_at:           number;
  updated_at:           number;
}

export type PostStatus = 'draft' | 'pending_approval' | 'approved' | 'ready' | 'scheduled' | 'posted' | 'failed' | 'cancelled';

export interface Post {
  id:                   string;
  client_id:            string;
  title:                string | null;
  status:               PostStatus | null;
  automation_status:    string | null;
  content_type:         string | null;
  platforms:            string | null;  // JSON array
  publish_date:         string | null;
  master_caption:       string | null;
  cap_facebook:         string | null;
  cap_instagram:        string | null;
  cap_linkedin:         string | null;
  cap_x:                string | null;
  cap_threads:          string | null;
  cap_tiktok:           string | null;
  cap_pinterest:        string | null;
  cap_bluesky:          string | null;
  cap_google_business:  string | null;
  // GBP multi-location (Elite Team Builders)
  cap_gbp_la:           string | null;
  cap_gbp_wa:           string | null;
  cap_gbp_or:           string | null;
  youtube_title:        string | null;
  youtube_description:  string | null;
  blog_content:         string | null;
  seo_title:            string | null;
  meta_description:     string | null;
  target_keyword:       string | null;
  secondary_keywords:   string | null;
  slug:                 string | null;   // WordPress post slug
  video_script:         string | null;
  ai_image_prompt:      string | null;
  ai_video_prompt:      string | null;
  skarleth_notes:       string | null;
  asset_r2_key:         string | null;
  asset_r2_bucket:      string | null;
  asset_type:           string | null;
  /** Count of assets attached to the post (added by listPosts query). */
  asset_count?:         number;
  canva_link:           string | null;
  wp_post_url:          string | null;
  wp_post_id:           number | null;
  wp_post_status:       string | null;
  blog_excerpt:         string | null;
  wp_featured_media_id: number | null;
  blog_body_images:     string | null;  // JSON-serialized BlogBodyImage[]
  // GBP advanced fields
  gbp_location_id:      string | null;  // per-post location override (migration 0009)
  gbp_topic_type:       string | null;
  gbp_cta_type:         string | null;
  gbp_cta_url:          string | null;
  gbp_event_title:      string | null;
  gbp_event_start_date: string | null;
  gbp_event_start_time: string | null;
  gbp_event_end_date:   string | null;
  gbp_event_end_time:   string | null;
  gbp_coupon_code:      string | null;
  gbp_redeem_url:       string | null;
  gbp_terms:            string | null;
  notion_page_id:       string | null;
  ready_for_automation: number;
  asset_delivered:      number;
  skarleth_status:      string | null;
  error_log:            string | null;
  posted_at:            number | null;
  platform_manual_override: number;
  automation_slot_key:  string | null;
  created_at:           number;
  updated_at:           number;
  // joined from client
  client_name?:         string;
  client_slug?:         string;
  queue_state?:         'queued' | 'due_soon' | 'overdue' | 'posting';
}

export interface PostPlatform {
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

export interface PostingJob {
  id:              string;
  triggered_by:    string | null;
  mode:            string;
  client_filter:   string | null;
  platform_filter: string | null;
  status:          string;
  stats_json:      string | null;
  created_at:      number;
  completed_at:    number | null;
}

export interface GenerationRun {
  id:                string;
  phase:             number;
  triggered_by:      string | null;
  week_start:        string;
  client_filter:     string | null;
  status:            string;
  clients_processed: string | null;
  posts_created:     number;
  posts_updated:     number;
  overwrite_existing: number;
  error_log:         string | null;
  progress_json:     string | null;
  execution_log:     string | null;
  last_activity_at:  number | null;
  created_at:        number;
  completed_at:      number | null;
  post_slots?:       string | null;
  total_slots?:      number | null;
  current_slot_idx?: number | null;
  publish_time?:     string | null;
}

export interface GenerationProgress {
  current_client:   string;
  current_post:     string;
  completed:        number;
  total_estimated:  number;
  errors:           number;
  clients_done:     number;
  clients_total:    number;
}

export interface OverviewStats {
  clients:           number;
  total_posts:       number;
  posted:            number;
  failed:            number;
  pending_approvals: number;
  drafts:            number;
  approved:          number;
  ready:             number;
  scheduled:         number;
  recent_jobs:       PostingJob[];
}

export interface Package {
  id:                   string;
  slug:                 string;
  name:                 string;
  posts_per_month:      number;
  images_per_month:     number;
  videos_per_month:     number;
  reels_per_month:      number;
  blog_posts_per_month: number;
  platforms_included:   string;  // JSON array
  includes_gbp:         number;
  includes_blog:        number;
  includes_bilingual:   number;
  includes_stories:     number;
  posting_frequency:    string;
  posting_days:         string | null;  // JSON: ["monday","wednesday","friday"]
  weekly_schedule:      string | null;  // JSON: {"monday":["image"],"wednesday":["video","blog"]}
  cadence_notes:        string | null;
  price_cents:          number | null;
  active:               number;
  sort_order:           number;
}

export interface ClientIntelligence {
  id?:                  string;
  client_id?:           string;
  brand_voice:          string | null;
  tone_keywords:        string | null;   // JSON array stored as string
  prohibited_terms:     string | null;
  approved_ctas:        string | null;
  content_goals:        string | null;
  service_priorities:   string | null;
  content_angles:       string | null;
  seasonal_notes:       string | null;
  competitor_notes:     string | null;
  audience_notes:       string | null;
  primary_keyword:      string | null;
  secondary_keywords:   string | null;
  local_seo_themes:     string | null;
  generation_language:  string | null;
  humanization_style:   string | null;
  monthly_snapshot:     string | null;
  feedback_summary:     string | null;
  last_research_at:     number | null;
  updated_at?:          number;
}

export interface ClientPlatformLinks {
  id?:            string;
  facebook?:      string | null;
  instagram?:     string | null;
  tiktok?:        string | null;
  youtube?:       string | null;
  linkedin?:      string | null;
  pinterest?:     string | null;
  x?:             string | null;
  threads?:       string | null;
  bluesky?:       string | null;
  google_business?: string | null;
  website?:       string | null;
}

export interface ContentRequest {
  id:                string;
  client_id:         string;
  request_type:      string;
  content_type:      string | null;
  platforms:         string | null;
  recurrence:        string;
  day_of_week:       number | null;
  time_of_day:       string | null;
  per_run:           number;
  topic_strategy:    string;
  fixed_topic:       string | null;
  next_run_date:     string | null;
  last_triggered_at: string | null;
  active:            number;
  paused:            number;
  notes:             string | null;
  created_by:        string | null;
  created_at:        number;
  updated_at:        number;
}

export interface ClientTopic {
  id:           string;
  client_id:    string;
  topic:        string;
  content_type: string | null;
  platforms:    string | null;
  target_date:  string | null;
  priority:     number;
  status:       string;
  used_post_id: string | null;
  notes:        string | null;
  created_by:   string | null;
  created_at:   number;
  used_at:      number | null;
}

export interface PostingStats {
  by_status:   { status: string; count: number }[];
  by_platform: { platform: string; status: string; count: number }[];
  by_client:   { slug: string; canonical_name: string; total: number; posted: number; scheduled: number; failed: number }[];
}

export interface MetricTotals {
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  reach: number | null;
  followers: number | null;
}

export interface ReportMetricConfig {
  primary_impressions_field: string | null;
  available_metrics: string[];
  metric_labels: Record<string, string>;
}

export interface ReportPlatformRow extends PostPlatform {
  title: string;
  publish_date: string;
  metrics: MetricTotals;
  metric_labels: Record<string, string>;
  primary_impressions_field: string | null;
}

export interface ReportPost extends Post {
  actual_platforms: string[];
  metrics: MetricTotals;
  platform_rows: ReportPlatformRow[];
}

export interface MonthlyReport {
  client:       Client & { brand: Record<string, string> | null };
  period:       { month: string | null; from: string; to: string };
  filters:      { platform: string | null };
  summary:      {
    total: number;
    posted: number;
    scheduled: number;
    failed: number;
    success_rate: number;
    metrics: MetricTotals;
    total_impressions: number | null;
  };
  platform_breakdown: {
    platform: string;
    total: number;
    posted: number;
    failed: number;
    success_rate: number;
    links: number;
    metrics: MetricTotals;
    profile: MetricTotals;
    primary_impressions_field: string | null;
  }[];
  profile_analytics: {
    total_impressions: number | null;
    by_platform: Record<string, MetricTotals>;
    metric_config: Record<string, ReportMetricConfig>;
  };
  posts:        ReportPost[];
  failed_detail: { title: string; publish_date: string; platform: string; error_message: string }[];
}

export interface ApiError {
  error:  string;
  issues?: unknown[];
}

// Platform display names + colors
export const PLATFORM_META: Record<string, { label: string; color: string }> = {
  facebook:        { label: 'Facebook',         color: '#1877F2' },
  instagram:       { label: 'Instagram',        color: '#E1306C' },
  linkedin:        { label: 'LinkedIn',         color: '#0A66C2' },
  x:               { label: 'X / Twitter',      color: '#E7E9EA' },
  threads:         { label: 'Threads',          color: '#AAAAAA' },
  tiktok:          { label: 'TikTok',           color: '#EE1D52' },
  pinterest:       { label: 'Pinterest',        color: '#E60023' },
  bluesky:         { label: 'Bluesky',          color: '#0085FF' },
  youtube:         { label: 'YouTube',          color: '#FF0000' },
  google_business: { label: 'Google Business',  color: '#4285F4' },
  gbp_la:          { label: 'GBP LA',           color: '#4285F4' },
  gbp_wa:          { label: 'GBP WA',           color: '#4285F4' },
  gbp_or:          { label: 'GBP OR',           color: '#4285F4' },
  website_blog:    { label: 'Blog',             color: '#6366F1' },
};

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:            { label: 'Draft',            cls: 'badge-draft'     },
  pending_approval: { label: 'Pending Review',   cls: 'badge-pending'   },
  approved:         { label: 'Approved',         cls: 'badge-approved'  },
  ready:     { label: 'Ready',     cls: 'badge-ready'     },
  scheduled: { label: 'Scheduled', cls: 'badge-scheduled' },
  posted:    { label: 'Posted',    cls: 'badge-posted'    },
  failed:    { label: 'Failed',    cls: 'badge-failed'    },
  blocked:   { label: 'Blocked',   cls: 'badge-blocked'   },
  cancelled: { label: 'Cancelled', cls: 'badge-draft'     },
  running:   { label: 'Running',   cls: 'badge-running'   },
  completed: { label: 'Completed', cls: 'badge-completed' },
  pending:   { label: 'Pending',   cls: 'badge-pending'   },
  sent:      { label: 'Sent',      cls: 'badge-scheduled' },
  active:    { label: 'Active',    cls: 'badge-active'    },
  inactive:  { label: 'Inactive',  cls: 'badge-inactive'  },
};
