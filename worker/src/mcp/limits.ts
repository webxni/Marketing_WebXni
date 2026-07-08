import type { ClientMcpLimitRow } from '../types';

export type Category = 'blog' | 'gbp' | 'social';
export type PublishDecision = { allowed: boolean; reason?: string };

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
}): PublishDecision {
  if (input.isMedia && !input.hasDeliveredMedia) {
    return { allowed: false, reason: 'Media posts require a delivered designer asset before auto-publishing.' };
  }
  if (input.usedForCategory >= capFor(input.limits, input.category)) {
    return { allowed: false, reason: `Daily ${input.category} publish limit reached.` };
  }
  if (input.category === 'social' && input.usedForPlatform >= input.limits.per_platform_per_day) {
    return { allowed: false, reason: 'Daily per-platform publish limit reached.' };
  }
  return { allowed: true };
}
