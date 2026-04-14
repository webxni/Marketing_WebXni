import type { ClientGbpLocationRow, ClientPlatformRow, PostRow } from '../types';

export type SupportedContentType =
  | 'image'
  | 'reel'
  | 'video'
  | 'blog'
  | 'google_business'
  | 'text';

export interface PlatformCompatibilityRule {
  allowed: string[];
  excluded: string[];
}

export interface ResolvedPlatformSelection {
  contentType: SupportedContentType;
  selected: string[];
  compatible: string[];
  incompatible: string[];
  availableClientPlatforms: string[];
}

const PLATFORM_ALIAS: Record<string, string> = {
  website: 'website_blog',
  blog: 'website_blog',
  website_blog: 'website_blog',
  x_twitter: 'x',
  twitter: 'x',
  google_business_profile: 'google_business',
  gbp: 'google_business',
};

const CONTENT_TYPE_ALIAS: Record<string, SupportedContentType> = {
  image: 'image',
  photo: 'image',
  reel: 'reel',
  short_video: 'reel',
  short: 'reel',
  video: 'video',
  blog: 'blog',
  website_blog: 'blog',
  google_business: 'google_business',
  gbp: 'google_business',
  text: 'text',
};

export const PLATFORM_RULES: Record<SupportedContentType, PlatformCompatibilityRule> = {
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

export function uniquePlatforms(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const platform = normalizePlatform(raw);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    out.push(platform);
  }
  return out;
}

export function parsePlatforms(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return uniquePlatforms(raw);
  try {
    return uniquePlatforms(JSON.parse(raw) as string[]);
  } catch {
    return [];
  }
}

export function normalizeContentType(
  contentType: string | null | undefined,
  assetType?: string | null,
): SupportedContentType {
  const direct = String(contentType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (assetType && direct === 'video') {
    const asset = assetType.toLowerCase();
    if (asset.includes('short') || asset.includes('reel') || asset.includes('vertical')) return 'reel';
  }
  return CONTENT_TYPE_ALIAS[direct] ?? 'image';
}

export function getPlatformRule(contentType: string | null | undefined, assetType?: string | null): PlatformCompatibilityRule {
  return PLATFORM_RULES[normalizeContentType(contentType, assetType)];
}

export function getCompatiblePlatforms(
  contentType: string | null | undefined,
  platforms: Array<string | null | undefined>,
  assetType?: string | null,
): string[] {
  const allowed = new Set(getPlatformRule(contentType, assetType).allowed);
  return uniquePlatforms(platforms).filter((platform) => allowed.has(platform));
}

export function getClientActivePlatforms(clientPlatforms: ClientPlatformRow[]): string[] {
  return uniquePlatforms(
    clientPlatforms
      .filter((platform) => platform.paused !== 1)
      .map((platform) => platform.platform),
  );
}

export function resolvePlatformSelection(input: {
  contentType: string | null | undefined;
  requestedPlatforms?: Array<string | null | undefined>;
  packagePlatforms?: Array<string | null | undefined>;
  clientPlatforms?: ClientPlatformRow[];
  assetType?: string | null;
  allowIncompatibleOverride?: boolean;
}): ResolvedPlatformSelection {
  const contentType = normalizeContentType(input.contentType, input.assetType);
  const clientPlatforms = getClientActivePlatforms(input.clientPlatforms ?? []);
  const packagePlatforms = uniquePlatforms(input.packagePlatforms ?? []);
  const requestedPlatforms = uniquePlatforms(input.requestedPlatforms ?? []);
  const rule = PLATFORM_RULES[contentType];
  const allowed = new Set(rule.allowed);
  const configuredClient = new Set(clientPlatforms);

  const baseSelection = requestedPlatforms.length > 0
    ? requestedPlatforms
    : packagePlatforms.length > 0 && clientPlatforms.length > 0
      ? packagePlatforms.filter((platform) => configuredClient.has(platform))
      : packagePlatforms.length > 0
        ? packagePlatforms
      : clientPlatforms.length > 0
        ? clientPlatforms
        : [];

  const compatible = baseSelection.filter((platform) => allowed.has(platform));
  const incompatible = baseSelection.filter((platform) => !allowed.has(platform));
  const selected = uniquePlatforms(
    input.allowIncompatibleOverride
      ? [...compatible, ...incompatible]
      : compatible,
  );

  return {
    contentType,
    selected,
    compatible,
    incompatible,
    availableClientPlatforms: clientPlatforms,
  };
}

export function getAutomationSlotKey(clientId: string, date: string, contentType: string, slotIndex: number): string {
  return `${clientId}:${date}:${normalizeContentType(contentType)}:${slotIndex}`;
}

export function getGbpCaptionField(location: Pick<ClientGbpLocationRow, 'label' | 'caption_field'>): keyof PostRow | null {
  const normalized = normalizePlatform(location.caption_field ?? location.label);
  const byKey: Record<string, keyof PostRow> = {
    cap_gbp_la: 'cap_gbp_la',
    caption_google_business_la: 'cap_gbp_la',
    gbp_la: 'cap_gbp_la',
    la: 'cap_gbp_la',
    cap_gbp_wa: 'cap_gbp_wa',
    caption_google_business_wa: 'cap_gbp_wa',
    gbp_wa: 'cap_gbp_wa',
    wa: 'cap_gbp_wa',
    cap_gbp_or: 'cap_gbp_or',
    caption_google_business_or: 'cap_gbp_or',
    gbp_or: 'cap_gbp_or',
    or: 'cap_gbp_or',
  };
  return byKey[normalized] ?? null;
}

export function getGbpPostedKey(location: Pick<ClientGbpLocationRow, 'label' | 'posted_field'>): string {
  const normalized = normalizePlatform(location.posted_field ?? location.label);
  const byKey: Record<string, string> = {
    posted_google_business_la: 'gbp_la',
    gbp_la: 'gbp_la',
    la: 'gbp_la',
    posted_google_business_wa: 'gbp_wa',
    gbp_wa: 'gbp_wa',
    wa: 'gbp_wa',
    posted_google_business_or: 'gbp_or',
    gbp_or: 'gbp_or',
    or: 'gbp_or',
  };
  return byKey[normalized] ?? `gbp_${normalizePlatform(location.label)}`;
}

export function isPostContentComplete(post: PostRow, clientGbpLocations: ClientGbpLocationRow[] = []): boolean {
  const contentType = normalizeContentType(post.content_type, post.asset_type);
  const selectedPlatforms = parsePlatforms(post.platforms);
  if (!String(post.master_caption ?? '').trim()) return false;

  if (contentType === 'blog') {
    return Boolean(
      String(post.blog_content ?? '').trim() &&
      String(post.seo_title ?? '').trim() &&
      String(post.meta_description ?? '').trim() &&
      String(post.target_keyword ?? '').trim() &&
      String(post.slug ?? '').trim(),
    );
  }

  if (contentType === 'video' || contentType === 'reel') {
    if (!String(post.video_script ?? '').trim() || !String(post.ai_video_prompt ?? '').trim()) return false;
  }

  if (contentType === 'image' || contentType === 'video' || contentType === 'reel') {
    if (!String(post.ai_image_prompt ?? '').trim()) return false;
  }

  if (selectedPlatforms.includes('youtube') && (!String(post.youtube_title ?? '').trim() || !String(post.youtube_description ?? '').trim())) {
    return false;
  }

  const captionFields: Record<string, keyof PostRow> = {
    facebook: 'cap_facebook',
    instagram: 'cap_instagram',
    linkedin: 'cap_linkedin',
    x: 'cap_x',
    threads: 'cap_threads',
    tiktok: 'cap_tiktok',
    pinterest: 'cap_pinterest',
    bluesky: 'cap_bluesky',
    google_business: 'cap_google_business',
  };

  for (const platform of selectedPlatforms) {
    const field = captionFields[platform];
    if (field && !String(post[field] ?? '').trim()) return false;
  }

  if (selectedPlatforms.includes('google_business') && clientGbpLocations.filter((loc) => loc.paused !== 1).length > 1) {
    for (const loc of clientGbpLocations.filter((item) => item.paused !== 1)) {
      const field = getGbpCaptionField(loc);
      if (field && !String(post[field] ?? '').trim()) return false;
    }
  }

  return true;
}
