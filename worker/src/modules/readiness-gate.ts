import type { ClientGbpLocationRow, ClientPlatformRow, ClientRow, PostRow } from '../types';
import { normalizePlatform } from './captions';
import { normalizeContentType } from './platform-compatibility';

export type ReadinessMode = 'ready' | 'publish';

export interface ReadinessIssue {
  code: string;
  message: string;
}

export interface ReadinessClient extends ClientRow {
  platforms: ClientPlatformRow[];
  gbp_locations?: ClientGbpLocationRow[];
}

function parsePlatforms(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map(normalizePlatform).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizedDestination(platform: string): string {
  return platform.startsWith('gbp_') ? 'google_business' : platform;
}

function parsePublishDate(value: string | null): number | null {
  if (!value?.trim()) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function platformIssue(client: ReadinessClient, platform: string): ReadinessIssue | null {
  const destination = normalizedDestination(platform);
  if (destination === 'website_blog' || destination === 'blogger') return null;
  const cfg = client.platforms.find((row) => normalizePlatform(row.platform) === destination || normalizePlatform(row.platform) === platform);
  if (!cfg) return { code: 'DESTINATION_NOT_CONFIGURED', message: `Destination '${platform}' is not configured` };
  if (cfg.paused === 1) return { code: 'DESTINATION_PAUSED', message: `Destination '${platform}' is paused` };
  if (cfg.connection_status !== 'connected') {
    return { code: 'DESTINATION_DISCONNECTED', message: `Destination '${platform}' is ${cfg.connection_status ?? 'not connected'}` };
  }
  if (cfg.verification_status !== 'verified') {
    return { code: 'DESTINATION_NOT_VERIFIED', message: `Destination '${platform}' is ${cfg.verification_status ?? 'not verified'}` };
  }
  if (destination === 'google_business') {
    const locations = client.gbp_locations ?? [];
    const activeLocations = locations.filter((loc) => loc.paused !== 1);
    const badLocation = activeLocations.find((loc) => loc.verification_status !== 'verified');
    if (badLocation) {
      return { code: 'GBP_LOCATION_NOT_VERIFIED', message: `GBP location '${badLocation.label}' is ${badLocation.verification_status}` };
    }
  }
  return null;
}

function gbpIssue(post: PostRow, platforms: string[]): ReadinessIssue | null {
  const hasGbp = platforms.some((platform) => normalizedDestination(platform) === 'google_business');
  if (!hasGbp) return null;
  if (post.gbp_cta_type && post.gbp_cta_type !== 'CALL' && !post.gbp_cta_url?.trim()) {
    return { code: 'GBP_CTA_URL_REQUIRED', message: `GBP CTA type '${post.gbp_cta_type}' requires a CTA URL` };
  }
  if (post.gbp_topic_type === 'EVENT') {
    const missing: string[] = [];
    if (!post.gbp_event_title?.trim()) missing.push('gbp_event_title');
    if (!post.gbp_event_start_date?.trim()) missing.push('gbp_event_start_date');
    if (!post.gbp_event_end_date?.trim()) missing.push('gbp_event_end_date');
    if (missing.length > 0) return { code: 'GBP_EVENT_FIELDS_REQUIRED', message: `GBP EVENT post missing required fields: ${missing.join(', ')}` };
  }
  if (post.gbp_topic_type === 'OFFER' && !post.gbp_coupon_code?.trim() && !post.gbp_redeem_url?.trim()) {
    return { code: 'GBP_OFFER_REDEMPTION_REQUIRED', message: 'GBP OFFER post should have gbp_coupon_code or gbp_redeem_url' };
  }
  return null;
}

function platformCaption(post: PostRow, platform: string): string | null | undefined {
  switch (platform) {
    case 'facebook': return post.cap_facebook;
    case 'instagram': return post.cap_instagram;
    case 'linkedin': return post.cap_linkedin;
    case 'x': return post.cap_x;
    case 'threads': return post.cap_threads;
    case 'tiktok': return post.cap_tiktok;
    case 'pinterest': return post.cap_pinterest;
    case 'bluesky': return post.cap_bluesky;
    case 'youtube': return post.youtube_title;
    case 'google_business': return post.cap_google_business;
    case 'gbp_la': return post.cap_gbp_la ?? post.cap_google_business;
    case 'gbp_wa': return post.cap_gbp_wa ?? post.cap_google_business;
    case 'gbp_or': return post.cap_gbp_or ?? post.cap_google_business;
    case 'website_blog': return post.blog_content;
    default: return post.master_caption;
  }
}

export function validateAutomationReadiness(
  post: PostRow,
  client: ReadinessClient,
  options: { mode: ReadinessMode; now?: Date } = { mode: 'ready' },
): ReadinessIssue | null {
  const platforms = parsePlatforms(post.platforms);
  if (platforms.length === 0) return { code: 'NO_PLATFORMS', message: 'Post has no target platforms' };

  const scheduled = parsePublishDate(post.publish_date);
  if (scheduled === null) return { code: 'PUBLISH_DATE_REQUIRED', message: 'publish_date is required before automation' };
  const now = options.now?.getTime() ?? Date.now();
  if (options.mode === 'ready' && scheduled <= now) {
    return { code: 'PUBLISH_DATE_OVERDUE', message: `publish_date has passed (${post.publish_date}); reschedule before approval` };
  }
  if (options.mode === 'publish' && scheduled > now) return { code: 'PUBLISH_DATE_IN_FUTURE', message: `publish_date is in the future (${post.publish_date})` };

  const contentType = normalizeContentType(post.content_type, post.asset_type);
  if (contentType !== 'blog' && !post.master_caption?.trim()) {
    return { code: 'MASTER_CAPTION_REQUIRED', message: 'master_caption is required' };
  }
  for (const platform of platforms) {
    if (!platformCaption(post, platform)?.trim()) {
      return { code: 'PLATFORM_COPY_REQUIRED', message: `Platform-specific copy is required for '${platform}'` };
    }
  }
  const mediaRequired = contentType !== 'blog' && contentType !== 'text';
  if (mediaRequired && post.asset_delivered !== 1) return { code: 'ASSET_REQUIRED', message: 'Media post requires delivered designer asset' };
  if ((contentType === 'reel' || contentType === 'video') && !post.asset_r2_key) {
    return { code: 'MEDIA_URL_REQUIRED', message: 'Reel/video post requires an attached media asset' };
  }
  if (options.mode === 'publish') {
    if (!['ready', 'approved', 'scheduled'].includes(post.status ?? '')) {
      return { code: 'STATUS_NOT_PUBLISHABLE', message: `Post status '${post.status ?? 'unknown'}' is not publishable` };
    }
    if (post.ready_for_automation !== 1) return { code: 'READY_FLAG_REQUIRED', message: 'ready_for_automation must be set before publishing' };
    if (post.asset_delivered !== 1) return { code: 'ASSET_DELIVERED_REQUIRED', message: 'asset_delivered must be set before publishing' };
  }

  for (const platform of platforms) {
    const issue = platformIssue(client, platform);
    if (issue) return issue;
  }
  return gbpIssue(post, platforms);
}

export function assertAutomationReadiness(post: PostRow, client: ReadinessClient, options: { mode: ReadinessMode; now?: Date }): void {
  const issue = validateAutomationReadiness(post, client, options);
  if (issue) throw new Error(`${issue.code}: ${issue.message}`);
}
