import type { PostRow } from '../types';

const REVIEW_FIELDS: Array<keyof PostRow> = [
  'title',
  'content_type',
  'platforms',
  'master_caption',
  'cap_facebook',
  'cap_instagram',
  'cap_linkedin',
  'cap_x',
  'cap_threads',
  'cap_tiktok',
  'cap_pinterest',
  'cap_bluesky',
  'cap_google_business',
  'cap_gbp_la',
  'cap_gbp_wa',
  'cap_gbp_or',
  'youtube_title',
  'youtube_description',
  'blog_content',
  'blog_excerpt',
  'seo_title',
  'meta_description',
  'target_keyword',
  'target_locality',
  'secondary_keywords',
  'video_script',
  'ai_image_prompt',
  'ai_video_prompt',
];

export const REVIEW_AFFECTING_FIELDS = new Set<string>(REVIEW_FIELDS);

export async function buildPostContentHash(post: Partial<PostRow>): Promise<string> {
  const canonical = REVIEW_FIELDS.map((field) => [field, post[field] ?? null]);
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hasReviewAffectingUpdate(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((field) => REVIEW_AFFECTING_FIELDS.has(field));
}
