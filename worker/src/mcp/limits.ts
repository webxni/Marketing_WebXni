import type { ClientMcpLimitRow } from '../types';

export type Category = 'blog' | 'gbp' | 'social';
export type PublishDecision = { allowed: boolean; reason?: string };

/** Per-client auto-publish gate. `strict` = designer-delivered assets only (legacy). */
export type AutoPublishPolicy = 'strict' | 'ai_and_text';

/** Origin of a post's image/video asset. */
export type AssetSource = 'designer' | 'ai_generated' | 'external_upload';

/**
 * Whether a media post is approved for auto-publishing, given the client policy
 * and the asset's origin. Text-only posts are decided separately (never blocked here).
 *
 * - `ai_generated`: approved only under `ai_and_text`.
 * - `external_upload`: never auto-approved — always routes to pending-approval.
 * - `designer` / legacy (null): approved when the designer asset is delivered.
 */
export function isMediaApproved(
  policy: AutoPublishPolicy,
  assetSource: string | null | undefined,
  hasDeliveredMedia: boolean,
): boolean {
  if (assetSource === 'ai_generated') return policy === 'ai_and_text';
  if (assetSource === 'external_upload') return false;
  return hasDeliveredMedia;
}

export function platformCategory(platform: string): Category {
  if (platform === 'website_blog' || platform === 'blog') return 'blog';
  if (platform === 'google_business' || platform.startsWith('gbp')) return 'gbp';
  return 'social';
}

export function counterKey(clientId: string, bucket: string, dateIso: string): string {
  return `mcp:pub:${clientId}:${bucket}:${dateIso}`;
}

export function capFor(limits: ClientMcpLimitRow, category: Category): number {
  if (category === 'blog') return limits.blog_per_day;
  if (category === 'gbp') return limits.gbp_per_day;
  return limits.social_per_day;
}

export function decidePublish(input: {
  category: Category;
  usedForCategory: number;
  usedForPlatform: number;
  limits: ClientMcpLimitRow;
  hasDeliveredMedia: boolean;
  isMedia: boolean;
  assetSource?: string | null;
  policy?: AutoPublishPolicy;
}): PublishDecision {
  const policy = input.policy ?? 'strict';
  if (input.isMedia && !isMediaApproved(policy, input.assetSource, input.hasDeliveredMedia)) {
    const reason = policy === 'ai_and_text'
      ? 'Image/video posts auto-publish only when AI-generated or designer-delivered; this asset routes to pending-approval.'
      : 'Media posts require a delivered designer asset before auto-publishing.';
    return { allowed: false, reason };
  }
  if (input.usedForCategory >= capFor(input.limits, input.category)) {
    return { allowed: false, reason: `Daily ${input.category} publish limit reached.` };
  }
  if (input.category === 'social' && input.usedForPlatform >= input.limits.per_platform_per_day) {
    return { allowed: false, reason: 'Daily per-platform publish limit reached.' };
  }
  return { allowed: true };
}
