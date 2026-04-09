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
      if (platCfg.upload_post_location_id) {
        extra.gbp_location_id = platCfg.upload_post_location_id;
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
