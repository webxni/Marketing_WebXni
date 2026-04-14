export type SupportedContentType =
  | 'image'
  | 'reel'
  | 'video'
  | 'blog'
  | 'google_business'
  | 'text';

const PLATFORM_ALIAS: Record<string, string> = {
  website: 'website_blog',
  blog: 'website_blog',
  website_blog: 'website_blog',
  twitter: 'x',
  x_twitter: 'x',
  google_business_profile: 'google_business',
  gbp: 'google_business',
};

const CONTENT_TYPE_ALIAS: Record<string, SupportedContentType> = {
  image: 'image',
  photo: 'image',
  reel: 'reel',
  video: 'video',
  blog: 'blog',
  website_blog: 'blog',
  google_business: 'google_business',
  gbp: 'google_business',
  text: 'text',
};

export const PLATFORM_RULES: Record<SupportedContentType, { allowed: string[]; excluded: string[] }> = {
  image: {
    allowed: ['facebook', 'instagram', 'linkedin', 'x', 'threads', 'pinterest', 'bluesky', 'google_business'],
    excluded: ['tiktok', 'youtube', 'website_blog'],
  },
  reel: {
    allowed: ['instagram', 'facebook', 'tiktok', 'youtube', 'threads'],
    excluded: ['google_business', 'website_blog', 'pinterest', 'linkedin', 'x', 'bluesky'],
  },
  video: {
    allowed: ['facebook', 'instagram', 'youtube', 'linkedin', 'x'],
    excluded: ['google_business', 'website_blog', 'tiktok', 'pinterest', 'bluesky', 'threads'],
  },
  blog: {
    allowed: ['website_blog'],
    excluded: ['facebook', 'instagram', 'linkedin', 'x', 'threads', 'tiktok', 'pinterest', 'bluesky', 'youtube', 'google_business'],
  },
  google_business: {
    allowed: ['google_business'],
    excluded: ['facebook', 'instagram', 'linkedin', 'x', 'threads', 'tiktok', 'pinterest', 'bluesky', 'youtube', 'website_blog'],
  },
  text: {
    allowed: ['facebook', 'linkedin', 'x', 'threads', 'bluesky', 'google_business'],
    excluded: ['instagram', 'tiktok', 'pinterest', 'youtube', 'website_blog'],
  },
};

export function normalizePlatform(value: string | null | undefined): string {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[()/]/g, ' ')
    .replace(/\s+/g, '_');
  return PLATFORM_ALIAS[cleaned] ?? cleaned;
}

export function normalizeContentType(contentType: string | null | undefined): SupportedContentType {
  const cleaned = String(contentType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CONTENT_TYPE_ALIAS[cleaned] ?? 'image';
}

export function uniquePlatforms(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizePlatform(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function getCompatiblePlatforms(contentType: string | null | undefined, platforms: Array<string | null | undefined>): string[] {
  const allowed = new Set(PLATFORM_RULES[normalizeContentType(contentType)].allowed);
  return uniquePlatforms(platforms).filter((platform) => allowed.has(platform));
}

export function getIncompatiblePlatforms(contentType: string | null | undefined, platforms: Array<string | null | undefined>): string[] {
  const allowed = new Set(PLATFORM_RULES[normalizeContentType(contentType)].allowed);
  return uniquePlatforms(platforms).filter((platform) => !allowed.has(platform));
}

export function getDefaultPlatforms(contentType: string | null | undefined, configuredPlatforms: Array<string | null | undefined>): string[] {
  const normalizedType = normalizeContentType(contentType);
  const configured = uniquePlatforms(configuredPlatforms);
  if (configured.length === 0) return [];
  const compatible = getCompatiblePlatforms(normalizedType, configured);
  if (compatible.length > 0) return compatible;
  return [];
}
