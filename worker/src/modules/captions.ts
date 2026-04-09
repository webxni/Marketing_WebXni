/**
 * Caption helpers — port of post_content.py caption logic
 * Preserves all platform character limits exactly.
 */
import type { PostRow } from '../types';

/** Hard character limits enforced by Upload-Post / platform APIs */
export const CAPTION_MAX_LEN: Record<string, number> = {
  tiktok:    90,   // TikTok photo title
  x:        280,   // X / Twitter
  threads:  500,
  bluesky:  300,
  pinterest: 100,  // Pinterest title
};

/** Platforms handled outside Upload-Post — skip in posting loop */
export const SKIP_PLATFORMS = new Set(['website_blog', 'blogger']);

export const PLATFORM_TO_CAP_FIELD: Record<string, keyof PostRow> = {
  facebook:        'cap_facebook',
  instagram:       'cap_instagram',
  linkedin:        'cap_linkedin',
  x:               'cap_x',
  threads:         'cap_threads',
  tiktok:          'cap_tiktok',
  pinterest:       'cap_pinterest',
  bluesky:         'cap_bluesky',
  google_business: 'cap_google_business',
  gbp_la:          'cap_gbp_la',
  gbp_wa:          'cap_gbp_wa',
  gbp_or:          'cap_gbp_or',
};

/** Notion display values → internal slugs (matches post_content.py NOTION_VALUE_TO_SLUG) */
const PLATFORM_ALIASES: Record<string, string> = {
  'x / twitter':                'x',
  'x/twitter':                  'x',
  'twitter':                    'x',
  'x':                          'x',
  'google business profile':    'google_business',
  'google business':            'google_business',
  'gbp':                        'google_business',
  'google business profile la': 'gbp_la',
  'google business la':         'gbp_la',
  'google business profile wa': 'gbp_wa',
  'google business wa':         'gbp_wa',
  'google business profile or': 'gbp_or',
  'google business or':         'gbp_or',
  'linkedin page':              'linkedin',
  'tik tok':                    'tiktok',
  'youtube':                    'youtube',
};

export function normalizePlatform(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[()/]/g, ' ')
    .replace(/\s+/g, ' ');
  return PLATFORM_ALIASES[cleaned] ?? cleaned.replace(/[\s-]+/g, '_');
}

export function getCaption(post: PostRow, platform: string): string | null {
  const normalized = normalizePlatform(platform);

  // YouTube uses youtube_title instead of a caption field
  if (normalized === 'youtube') {
    return post.youtube_title ?? null;
  }

  const field = PLATFORM_TO_CAP_FIELD[normalized];
  if (!field) return null;

  const raw = post[field];
  if (typeof raw !== 'string') return null;

  const caption = raw.trim();
  if (!caption) return null;

  const maxLen = CAPTION_MAX_LEN[normalized];
  if (maxLen && caption.length > maxLen) {
    return caption.slice(0, maxLen - 1) + '…';
  }
  return caption;
}
