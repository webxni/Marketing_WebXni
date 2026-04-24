import type { LoaderEnv, PostPlatformRow, PostRow } from '../types';
import { UploadPostClient } from '../services/uploadpost';
import { normalizePlatform } from './captions';
import { getCompatiblePlatforms, normalizeContentType } from './platform-compatibility';

const URL_KEYS = ['post_url', 'url', 'link', 'post_link', 'permalink', 'published_url', 'public_url'] as const;
const SUCCESS_STATUSES = new Set(['posted', 'sent', 'idempotent']);
const TERMINAL_STATUSES = new Set(['posted', 'sent', 'idempotent', 'skipped', 'skip', 'blocked', 'failed', 'legacy_invalid']);
const LEGACY_INVALID_PATTERNS = [
  'invalid platforms for text post',
  'requires a video',
  'requires video',
  'requires un video',
  'requires un video o imagen',
  'requires video or image',
  'se envió como texto',
  'incompatible with',
  'platforms are incompatible',
] as const;

interface SyncCandidateRow {
  id: string;
  post_id: string;
  platform: string;
  tracking_id: string | null;
  platform_post_id: string | null;
  upload_post_profile: string | null;
  status: string | null;
}

function parsePlatforms(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function basePlatform(platform: string): string {
  return platform.startsWith('google_business_') ? 'google_business' : normalizePlatform(platform);
}

function looksLikeHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function deepFindUrl(value: unknown, platform?: string, depth = 0): string | null {
  if (depth > 5 || value == null) return null;
  if (looksLikeHttpUrl(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindUrl(item, platform, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (platform) {
    const directPlatform = record[platform];
    const nestedDirect = deepFindUrl(directPlatform, undefined, depth + 1);
    if (nestedDirect) return nestedDirect;
    const normalized = basePlatform(platform);
    const normalizedPlatform = record[normalized];
    const nestedNormalized = deepFindUrl(normalizedPlatform, undefined, depth + 1);
    if (nestedNormalized) return nestedNormalized;
  }

  for (const key of URL_KEYS) {
    const candidate = record[key];
    if (looksLikeHttpUrl(candidate)) return candidate;
  }

  for (const [key, child] of Object.entries(record)) {
    if (platform && key.toLowerCase().includes(platform.toLowerCase())) {
      const nested = deepFindUrl(child, undefined, depth + 1);
      if (nested) return nested;
    }
  }
  for (const child of Object.values(record)) {
    const nested = deepFindUrl(child, platform, depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function extractPublishedUrl(payload: unknown, platform?: string): string | null {
  return deepFindUrl(payload, platform);
}

export function trackingIdRaw(trackingId: string | null | undefined): string | null {
  if (!trackingId) return null;
  const raw = trackingId.replace(/^UP:/, '');
  return raw.replace(/^IDEM:/, '') || null;
}

export function isSuccessPlatformStatus(status: string | null | undefined): boolean {
  return SUCCESS_STATUSES.has(String(status ?? '').toLowerCase());
}

export function isTerminalPlatformStatus(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.has(String(status ?? '').toLowerCase());
}

export function isLegacyInvalidAttempt(post: PostRow, row: Pick<PostPlatformRow, 'platform' | 'status' | 'error_message'>): boolean {
  const status = String(row.status ?? '').toLowerCase();
  if (!['failed', 'blocked', 'skipped', 'skip'].includes(status)) return false;

  const error = String(row.error_message ?? '').toLowerCase();
  const postPlatforms = parsePlatforms(post.platforms);
  const postContentType = normalizeContentType(post.content_type, post.asset_type);
  const rowBase = basePlatform(row.platform);

  const noLongerSelected = !postPlatforms.includes(rowBase);
  const incompatible = !getCompatiblePlatforms(postContentType, postPlatforms.length ? postPlatforms : [rowBase]).includes(rowBase);
  const classificationError = LEGACY_INVALID_PATTERNS.some((pattern) => error.includes(pattern));

  return noLongerSelected || incompatible || classificationError;
}

async function finalizePosts(db: D1Database, postIds: Iterable<string>): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let promoted = 0;
  for (const postId of new Set(postIds)) {
    const remaining = await db
      .prepare(`SELECT COUNT(*) as n FROM post_platforms
                WHERE post_id = ? AND status NOT IN ('posted','sent','idempotent','skipped','skip','blocked','failed','legacy_invalid')`)
      .bind(postId)
      .first<{ n: number }>();
    const hasSuccess = await db
      .prepare(`SELECT COUNT(*) as n FROM post_platforms
                WHERE post_id = ? AND status IN ('posted','sent','idempotent')`)
      .bind(postId)
      .first<{ n: number }>();

    if ((remaining?.n ?? 1) === 0 && (hasSuccess?.n ?? 0) > 0) {
      await db
        .prepare(`UPDATE posts
                  SET status = 'posted',
                      automation_status = 'Posted',
                      ready_for_automation = 0,
                      posted_at = COALESCE(posted_at, ?),
                      updated_at = ?
                  WHERE id = ?`)
        .bind(now, now, postId)
        .run();
      promoted++;
    }
  }
  return promoted;
}

export async function syncPublishedUrls(
  env: Pick<LoaderEnv, 'DB' | 'UPLOAD_POST_API_KEY'>,
  options: { postIds?: string[] } = {},
): Promise<{ matched: number; posts_promoted: number }> {
  const db = env.DB;
  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);
  const filters: string[] = [
    'real_url IS NULL',
    "status IN ('sent','idempotent','posted')",
    '(tracking_id IS NOT NULL OR platform_post_id IS NOT NULL)',
  ];
  const binds: unknown[] = [];
  if (options.postIds && options.postIds.length > 0) {
    filters.push(`post_id IN (${options.postIds.map(() => '?').join(',')})`);
    binds.push(...options.postIds);
  }

  const rows = await db
    .prepare(`SELECT pp.id, pp.post_id, pp.platform, pp.tracking_id, pp.platform_post_id, pp.status,
                     c.upload_post_profile
              FROM post_platforms pp
              JOIN posts p ON p.id = pp.post_id
              JOIN clients c ON c.id = p.client_id
              WHERE ${filters.join(' AND ')}`)
    .bind(...binds)
    .all<SyncCandidateRow>();

  if (rows.results.length === 0) {
    return { matched: 0, posts_promoted: 0 };
  }

  const urlMap = new Map<string, string>();
  const rowByTracking = new Map<string, SyncCandidateRow[]>();
  for (const row of rows.results) {
    const rawId = trackingIdRaw(row.tracking_id);
    if (!rawId) continue;
    const existing = rowByTracking.get(rawId) ?? [];
    existing.push(row);
    rowByTracking.set(rawId, existing);
  }

  for (const [rawId, trackingRows] of rowByTracking.entries()) {
    for (const variant of [{ jobId: rawId }, { requestId: rawId }]) {
      try {
        const statusPayload = await up.getStatus(variant);
        const direct = extractPublishedUrl(statusPayload, trackingRows[0]?.platform);
        if (direct) {
          urlMap.set(rawId, direct);
          break;
        }
      } catch {
        // continue
      }
    }
    if (urlMap.has(rawId)) continue;
    try {
      const analytics = await up.getPostAnalytics(rawId);
      const direct = extractPublishedUrl(analytics, trackingRows[0]?.platform);
      if (direct) urlMap.set(rawId, direct);
    } catch {
      // continue
    }
  }

  const platformPostUrlMap = new Map<string, string>();
  for (const row of rows.results) {
    if (!row.platform_post_id || !row.upload_post_profile) continue;
    const key = `${row.platform}|${row.platform_post_id}`;
    if (platformPostUrlMap.has(key)) continue;

    try {
      const analytics = await up.getPostAnalyticsByPlatformPostId({
        platformPostId: row.platform_post_id,
        platform: basePlatform(row.platform),
        user: row.upload_post_profile,
      });
      const direct = extractPublishedUrl(analytics, row.platform);
      if (direct) {
        platformPostUrlMap.set(key, direct);
      }
    } catch {
      // continue
    }
  }

  if (urlMap.size < rowByTracking.size) {
    try {
      const { history } = await up.getHistory(300);
      for (const entry of history) {
        const candidateId = String(entry['job_id'] ?? entry['request_id'] ?? entry['id'] ?? '');
        const direct = extractPublishedUrl(entry);
        if (candidateId && direct && !urlMap.has(candidateId)) {
          urlMap.set(candidateId, direct);
        }
      }
    } catch {
      // allow partial success
    }
  }

  let matched = 0;
  const candidatePosts = new Set<string>(rows.results.map((row) => row.post_id));
  const affectedPosts = new Set<string>();
  for (const row of rows.results) {
    const rawId = trackingIdRaw(row.tracking_id);
    const byTracking = rawId ? urlMap.get(rawId) : null;
    const byPlatformPostId = row.platform_post_id
      ? platformPostUrlMap.get(`${row.platform}|${row.platform_post_id}`)
      : null;
    const realUrl = byTracking ?? byPlatformPostId ?? null;
    if (!realUrl) continue;
    await db
      .prepare(`UPDATE post_platforms
                SET real_url = ?, status = 'posted'
                WHERE id = ?`)
      .bind(realUrl, row.id)
      .run();
    matched++;
    affectedPosts.add(row.post_id);
  }

  const promoted = await finalizePosts(db, candidatePosts);
  return { matched, posts_promoted: promoted };
}

export async function cleanupLegacyInvalidPlatformAttempts(
  db: D1Database,
): Promise<{ archived: number }> {
  const rows = await db
    .prepare(`SELECT pp.id, pp.post_id, pp.platform, pp.status, pp.error_message,
                     p.content_type, p.asset_type, p.platforms
              FROM post_platforms pp
              JOIN posts p ON p.id = pp.post_id
              WHERE pp.status IN ('failed','blocked','skipped','skip')`)
    .all<{
      id: string;
      post_id: string;
      platform: string;
      status: string | null;
      error_message: string | null;
      content_type: string | null;
      asset_type: string | null;
      platforms: string | null;
    }>();

  let archived = 0;
  for (const row of rows.results) {
    const post = row as unknown as PostRow;
    if (!isLegacyInvalidAttempt(post, row)) continue;
    await db
      .prepare(`UPDATE post_platforms
                SET status = 'legacy_invalid',
                    error_message = COALESCE(error_message, 'Legacy invalid platform attempt')
                WHERE id = ?`)
      .bind(row.id)
      .run();
    archived++;
  }
  return { archived };
}

export async function repairOrphanScheduledPosts(
  db: D1Database,
): Promise<{ reset_to_ready: number }> {
  const result = await db
    .prepare(`
      UPDATE posts
      SET status = 'ready',
          automation_status = 'Pending',
          ready_for_automation = 1,
          updated_at = unixepoch()
      WHERE status = 'scheduled'
        AND content_type != 'blog'
        AND NOT EXISTS (
          SELECT 1
          FROM post_platforms pp
          WHERE pp.post_id = posts.id
        )
    `)
    .run();

  return { reset_to_ready: Number(result.meta?.changes ?? 0) };
}
