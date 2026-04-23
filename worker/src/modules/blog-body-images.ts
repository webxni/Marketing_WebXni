/**
 * Blog body image helpers.
 *
 * The `posts.blog_body_images` column stores a JSON array of up to 3 entries
 * (one per slot). Each entry tracks the stored R2 key, the prompt used to
 * generate it, the WP media id (after upload), and status/error metadata.
 *
 * Slots:
 *   1 — after intro (hero body image)
 *   2 — middle of content (after 2nd section)
 *   3 — before CTA / footer
 */

import type { PostRow } from '../types';

export type BlogImageSlot = 1 | 2 | 3;
export const BLOG_IMAGE_SLOTS: readonly BlogImageSlot[] = [1, 2, 3] as const;

export interface BlogBodyImage {
  slot:         BlogImageSlot;
  r2_key:       string | null;
  prompt:       string;
  wp_media_id?: number | null;
  attempts?:    number;
  status:       'generated' | 'failed' | 'pending';
  error?:       string;
  updated_at?:  number;
}

export function parseBlogBodyImages(raw: string | null | undefined): BlogBodyImage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is BlogBodyImage => {
        if (!item || typeof item !== 'object') return false;
        const it = item as Partial<BlogBodyImage>;
        return typeof it.slot === 'number' && [1, 2, 3].includes(it.slot);
      })
      .map((it) => ({
        slot:         it.slot as BlogImageSlot,
        r2_key:       it.r2_key ?? null,
        prompt:       typeof it.prompt === 'string' ? it.prompt : '',
        wp_media_id:  typeof it.wp_media_id === 'number' ? it.wp_media_id : null,
        attempts:     typeof it.attempts === 'number' ? it.attempts : 0,
        status:       (it.status === 'generated' || it.status === 'failed' || it.status === 'pending') ? it.status : 'pending',
        error:        typeof it.error === 'string' ? it.error : undefined,
        updated_at:   typeof it.updated_at === 'number' ? it.updated_at : undefined,
      }))
      .sort((a, b) => a.slot - b.slot);
  } catch {
    return [];
  }
}

export function serializeBlogBodyImages(images: BlogBodyImage[]): string {
  return JSON.stringify(images);
}

export function upsertBlogBodyImage(existing: BlogBodyImage[], next: BlogBodyImage): BlogBodyImage[] {
  const filtered = existing.filter((img) => img.slot !== next.slot);
  return [...filtered, next].sort((a, b) => a.slot - b.slot);
}

export function getBlogBodyImage(post: Pick<PostRow, 'blog_body_images'>, slot: BlogImageSlot): BlogBodyImage | null {
  const images = parseBlogBodyImages(post.blog_body_images);
  return images.find((img) => img.slot === slot) ?? null;
}
