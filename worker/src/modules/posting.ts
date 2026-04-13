/**
 * Posting helpers — port of post_content.py build_extra_params() + extract_tracking_id()
 */
import type { ClientPlatformRow, PostRow } from '../types';
import { normalizePlatform } from './captions';

/**
 * Build Upload-Post platform-specific extra parameters.
 * Port of post_content.py build_extra_params()
 */
export function buildExtraParams(
  platform: string,
  platCfg: ClientPlatformRow,
  post: PostRow,
): Record<string, string> {
  const normalized = normalizePlatform(platform);
  const extra: Record<string, string> = {};

  switch (normalized) {
    case 'facebook':
      if (platCfg.page_id) extra.facebook_page_id = platCfg.page_id;
      break;

    case 'linkedin':
      // LinkedIn page posts require target_linkedin_page_id
      if (platCfg.page_id) extra.target_linkedin_page_id = platCfg.page_id;
      break;

    case 'pinterest':
      if (platCfg.upload_post_board_id) {
        extra.pinterest_board_id = platCfg.upload_post_board_id;
      }
      break;

    case 'tiktok':
      extra.privacy_level = platCfg.privacy_level ?? 'PUBLIC_TO_EVERYONE';
      break;

    case 'youtube':
      if (post.youtube_title) extra.youtube_title = post.youtube_title;
      if (post.youtube_description) extra.youtube_description = post.youtube_description;
      extra.privacyStatus = platCfg.privacy_status ?? 'public';
      break;

    case 'google_business':
      // Location: prefer post-level override, fall back to platform config
      if (post.gbp_location_id ?? platCfg.upload_post_location_id) {
        extra.gbp_location_id = (post.gbp_location_id ?? platCfg.upload_post_location_id)!;
      }
      // Topic type (STANDARD/EVENT/OFFER)
      if (post.gbp_topic_type) extra.gbp_topic_type = post.gbp_topic_type;
      // CTA
      if (post.gbp_cta_type) extra.gbp_cta_type = post.gbp_cta_type;
      if (post.gbp_cta_url)  extra.gbp_cta_url  = post.gbp_cta_url;
      // Event fields
      if (post.gbp_topic_type === 'EVENT') {
        if (post.gbp_event_title)      extra.gbp_event_title      = post.gbp_event_title;
        if (post.gbp_event_start_date) extra.gbp_event_start_date = post.gbp_event_start_date;
        if (post.gbp_event_start_time) extra.gbp_event_start_time = post.gbp_event_start_time;
        if (post.gbp_event_end_date)   extra.gbp_event_end_date   = post.gbp_event_end_date;
        if (post.gbp_event_end_time)   extra.gbp_event_end_time   = post.gbp_event_end_time;
      }
      // Offer fields
      if (post.gbp_topic_type === 'OFFER') {
        if (post.gbp_coupon_code) extra.gbp_coupon_code = post.gbp_coupon_code;
        if (post.gbp_redeem_url)  extra.gbp_redeem_url  = post.gbp_redeem_url;
        if (post.gbp_terms)       extra.gbp_terms        = post.gbp_terms;
      }
      break;
  }

  return extra;
}

/**
 * Extract tracking ID from Upload-Post response.
 * Scheduled posts return job_id (HTTP 202).
 * Async posts return request_id (HTTP 200).
 * Port of post_content.py extract_tracking_id()
 */
export function extractTrackingId(
  response: Record<string, unknown>,
): string | null {
  const jobId = response['job_id'];
  const requestId = response['request_id'];
  if (typeof jobId === 'string' && jobId) return jobId;
  if (typeof requestId === 'string' && requestId) return requestId;
  return null;
}
