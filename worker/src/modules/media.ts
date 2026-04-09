/**
 * Media helpers — port of post_content.py media utilities
 */

export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.flv',
]);

/** Convert any Google Drive share URL to a direct download URL */
export function normalizeDriveUrl(url: string): string {
  if (!url.includes('drive.google.com')) return url;
  // Already a direct download URL
  if (url.includes('/uc?') && url.includes('export=download')) return url;

  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return `https://drive.google.com/uc?id=${match[1]}&export=download`;
    }
  }
  return url;
}

/** True if the URL points to a video file by extension */
export function isVideoUrl(url: string): boolean {
  const pathPart = url.split('?')[0].toLowerCase();
  return Array.from(VIDEO_EXTENSIONS).some((ext) => pathPart.endsWith(ext));
}

/** True if the content type requires a media asset */
export function requiresMedia(contentType: string): boolean {
  const lower = contentType.toLowerCase().trim();
  return ['image', 'video', 'reel', 'carousel'].some((kw) => lower.includes(kw));
}

/** Infer 'video' or 'image' from the asset_type field */
export function inferMediaTypeFromAssetType(
  assetType: string | null,
): 'video' | 'image' | null {
  if (!assetType) return null;
  const lower = assetType.toLowerCase();
  if (lower.includes('video') || lower.includes('reel') || lower.includes('short')) {
    return 'video';
  }
  if (lower.includes('image') || lower.includes('photo') || lower.includes('carousel')) {
    return 'image';
  }
  return null;
}

/**
 * Return ISO 8601 scheduled time.
 * If publishDate is null, empty, or in the past → schedule 5 minutes from now.
 * Port of post_content.py get_scheduled_time()
 */
export function getScheduledTime(publishDate: string | null): string {
  const fallback = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  if (!publishDate) return fallback;

  let dt = publishDate;
  // Add time component if only a date was provided
  if (!dt.includes('T')) dt = `${dt}T09:00:00`;
  // Add UTC offset if missing
  if (!dt.includes('+') && !dt.includes('Z')) dt = `${dt}+00:00`;

  try {
    const parsed = new Date(dt);
    if (isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return fallback;
    }
    return parsed.toISOString();
  } catch {
    return fallback;
  }
}
