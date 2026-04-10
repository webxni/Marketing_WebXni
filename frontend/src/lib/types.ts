/** Shared frontend types — mirror backend DB rows + API response shapes */

export type Role = 'admin' | 'manager' | 'editor' | 'reviewer' | 'operator';

export interface User {
  id:         string;
  email:      string;
  name:       string;
  role:       Role;
  is_active:  number;
  last_login: number | null;
  created_at: number;
}

export interface SessionUser {
  userId: string;
  email:  string;
  name:   string;
  role:   Role;
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
  username:                string | null;
  page_id:                 string | null;
  upload_post_board_id:    string | null;
  upload_post_location_id: string | null;
  paused:                  number;
  paused_reason:           string | null;
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
  id:          string;
  title:       string;
  description: string | null;
  cta_text:    string | null;
  valid_until: string | null;
  active:      number;
  created_at:  number;
}

export type PostStatus = 'draft' | 'approved' | 'ready' | 'scheduled' | 'posted' | 'failed' | 'cancelled';

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
  youtube_title:        string | null;
  youtube_description:  string | null;
  blog_content:         string | null;
  seo_title:            string | null;
  meta_description:     string | null;
  ai_image_prompt:      string | null;
  asset_r2_key:         string | null;
  asset_r2_bucket:      string | null;
  canva_link:           string | null;
  wp_post_url:          string | null;
  wp_post_id:           number | null;
  wp_post_status:       string | null;
  // GBP advanced fields
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
  created_at:           number;
  updated_at:           number;
  // joined from client
  client_name?:         string;
  client_slug?:         string;
}

export interface PostPlatform {
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

export interface OverviewStats {
  clients:           number;
  total_posts:       number;
  posted:            number;
  failed:            number;
  pending_approvals: number;
  recent_jobs:       PostingJob[];
}

export interface PostingStats {
  by_status:   { status: string; count: number }[];
  by_platform: { platform: string; status: string; count: number }[];
  by_client:   { slug: string; canonical_name: string; total: number; posted: number; failed: number }[];
}

export interface MonthlyReport {
  client:       Client & { brand: Record<string, string> | null };
  period:       { month: string; from: string; to: string };
  summary:      { total: number; posted: number; failed: number; success_rate: number };
  posts:        Post[];
  platforms:    (PostPlatform & { title: string; publish_date: string })[];
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
  x:               { label: 'X / Twitter',      color: '#000000' },
  threads:         { label: 'Threads',          color: '#000000' },
  tiktok:          { label: 'TikTok',           color: '#010101' },
  pinterest:       { label: 'Pinterest',        color: '#E60023' },
  bluesky:         { label: 'Bluesky',          color: '#0085FF' },
  youtube:         { label: 'YouTube',          color: '#FF0000' },
  google_business: { label: 'Google Business',  color: '#4285F4' },
  website_blog:    { label: 'Blog',             color: '#6366F1' },
};

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'badge-draft'     },
  approved:  { label: 'Approved',  cls: 'badge-approved'  },
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
