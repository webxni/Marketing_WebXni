/**
 * Platform media limits — how many photos can ride in a single post per platform.
 *
 * When an image post has N attached images, the posting loop truncates to
 * `maxPhotosForPlatform(platform)` for that specific platform. If the max is 1
 * we only send the first image; if it's 0 the platform doesn't support images
 * at all (image posts should be skipped for that platform).
 *
 * Caps sourced from current platform APIs (as proxied by Upload-Post):
 *   - Instagram carousel: 2-10 images
 *   - Facebook Page album/multi-photo: up to 10
 *   - LinkedIn multi-image post: up to 9
 *   - X (Twitter): up to 4 media items per tweet
 *   - Threads: up to 10 images per post
 *   - TikTok photo mode: up to 35 photos
 *   - Bluesky: up to 4 images
 *   - Pinterest: 1 image per pin (no native carousel via the API)
 *   - Google Business Profile: 1 image per post (photos, not albums)
 *   - YouTube: does not accept still-image posts
 */
export const MAX_PHOTOS_PER_PLATFORM: Record<string, number> = {
  instagram:       10,
  facebook:        10,
  linkedin:         9,
  x:                4,
  threads:         10,
  tiktok:          35,
  bluesky:          4,
  pinterest:        1,
  google_business:  1,
  youtube:          0,
};

export function maxPhotosForPlatform(platform: string): number {
  return MAX_PHOTOS_PER_PLATFORM[platform] ?? 1;
}

/**
 * Given the full ordered list of images attached to a post, return the slice
 * that should actually be sent to this platform. Returns [] if the platform
 * doesn't support image posts at all.
 */
export function selectPhotosForPlatform<T>(all: T[], platform: string): T[] {
  const cap = maxPhotosForPlatform(platform);
  if (cap <= 0) return [];
  if (all.length <= cap) return all;
  return all.slice(0, cap);
}

/** True if the platform supports native multi-image / carousel posts. */
export function supportsCarousel(platform: string): boolean {
  return maxPhotosForPlatform(platform) > 1;
}
