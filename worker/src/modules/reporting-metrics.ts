import type { Env } from '../types';
import { UploadPostClient, UploadPostError } from '../services/uploadpost';
import { extractPublishedUrl, trackingIdRaw } from './published-urls';

export const REPORT_METRIC_KEYS = [
  'impressions',
  'likes',
  'comments',
  'shares',
  'saves',
  'views',
  'reach',
  'followers',
] as const;

export type ReportMetricKey = (typeof REPORT_METRIC_KEYS)[number];
export type MetricTotals = Record<ReportMetricKey, number | null>;

export interface PlatformMetricConfig {
  primary_impressions_field: string | null;
  available_metrics: string[];
  metric_labels: Record<string, string>;
}

interface MetricsCandidateRow {
  id: string;
  post_id: string;
  platform: string;
  tracking_id: string | null;
  platform_post_id: string | null;
  real_url: string | null;
  metrics_json: string | null;
  metrics_synced_at: number | null;
  status: string | null;
  upload_post_profile: string | null;
}

function basePlatform(platform: string): string {
  return platform.startsWith('google_business_') ? 'google_business' : platform;
}

function parseMetricNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function emptyMetricTotals(): MetricTotals {
  return {
    impressions: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    views: null,
    reach: null,
    followers: null,
  };
}

export function metricTotalsFromUnknown(value: unknown): MetricTotals {
  const totals = emptyMetricTotals();
  if (!value || typeof value !== 'object') return totals;
  const record = value as Record<string, unknown>;
  for (const key of REPORT_METRIC_KEYS) {
    totals[key] = parseMetricNumber(record[key]);
  }
  return totals;
}

export function parseStoredMetricTotals(json: string | null): MetricTotals {
  if (!json) return emptyMetricTotals();
  try {
    return metricTotalsFromUnknown(JSON.parse(json));
  } catch {
    return emptyMetricTotals();
  }
}

export function addMetricTotals(base: MetricTotals, next: MetricTotals): MetricTotals {
  const totals = emptyMetricTotals();
  for (const key of REPORT_METRIC_KEYS) {
    const a = base[key];
    const b = next[key];
    totals[key] = a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  }
  return totals;
}

function normalizePlatformPayload(payload: unknown, platform: string): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const platforms = record['platforms'];
  if (!platforms || typeof platforms !== 'object') return null;
  const platformMap = platforms as Record<string, unknown>;
  const direct = platformMap[platform];
  if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
  const entries = Object.entries(platformMap).find(([key]) => key.toLowerCase() === platform.toLowerCase());
  return entries && typeof entries[1] === 'object' ? (entries[1] as Record<string, unknown>) : null;
}

function normalizeMetricConfig(payload: unknown): Record<string, PlatformMetricConfig> {
  if (!payload || typeof payload !== 'object') return {};
  const config: Record<string, PlatformMetricConfig> = {};
  for (const [platform, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    config[platform] = {
      primary_impressions_field: typeof row['primary_impressions_field'] === 'string' ? row['primary_impressions_field'] : null,
      available_metrics: Array.isArray(row['available_metrics']) ? row['available_metrics'].map((item) => String(item)) : [],
      metric_labels: row['metric_labels'] && typeof row['metric_labels'] === 'object'
        ? Object.fromEntries(Object.entries(row['metric_labels'] as Record<string, unknown>).map(([key, label]) => [key, String(label)]))
        : {},
    };
  }
  return config;
}

function isAnalyticsSupported(platform: string): boolean {
  return !platform.startsWith('google_business');
}

export async function syncPostPlatformMetrics(
  env: Pick<Env, 'DB' | 'UPLOAD_POST_API_KEY'>,
  options: { postIds?: string[]; limit?: number; staleAfterSeconds?: number } = {},
): Promise<{ synced: number; attempted: number }> {
  const staleAfter = options.staleAfterSeconds ?? 12 * 60 * 60;
  const binds: unknown[] = [];
  const where = [
    "pp.status IN ('sent','idempotent','posted')",
    '(pp.tracking_id IS NOT NULL OR pp.platform_post_id IS NOT NULL)',
  ];
  if (options.postIds && options.postIds.length > 0) {
    where.push(`pp.post_id IN (${options.postIds.map(() => '?').join(',')})`);
    binds.push(...options.postIds);
  } else {
    where.push('(pp.metrics_synced_at IS NULL OR pp.metrics_synced_at < ?)');
    binds.push(Math.floor(Date.now() / 1000) - staleAfter);
  }

  const rows = await env.DB.prepare(`
      SELECT pp.id, pp.post_id, pp.platform, pp.tracking_id, pp.platform_post_id, pp.real_url,
             pp.metrics_json, pp.metrics_synced_at, pp.status, c.upload_post_profile
      FROM post_platforms pp
      JOIN posts p ON p.id = pp.post_id
      JOIN clients c ON c.id = p.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.publish_date DESC
      LIMIT ?
    `)
    .bind(...binds, options.limit ?? 100)
    .all<MetricsCandidateRow>();

  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);
  const now = Math.floor(Date.now() / 1000);
  let synced = 0;

  for (const row of rows.results) {
    const platform = basePlatform(row.platform);
    if (!isAnalyticsSupported(platform)) continue;

    try {
      let payload: unknown = null;
      const requestId = trackingIdRaw(row.tracking_id);
      if (requestId) {
        payload = await up.getPostAnalytics(requestId, platform);
      } else if (row.platform_post_id && row.upload_post_profile) {
        payload = await up.getPostAnalyticsByPlatformPostId({
          platformPostId: row.platform_post_id,
          platform,
          user: row.upload_post_profile,
        });
      } else {
        continue;
      }

      const platformPayload = normalizePlatformPayload(payload, platform);
      if (!platformPayload) continue;

      const metrics = metricTotalsFromUnknown(platformPayload['post_metrics']);
      const platformPostId = typeof platformPayload['platform_post_id'] === 'string' ? platformPayload['platform_post_id'] : row.platform_post_id;
      const postUrl = extractPublishedUrl(payload, platform) ?? row.real_url;
      const metricsSource = typeof platformPayload['post_metrics_source'] === 'string' ? platformPayload['post_metrics_source'] : 'upload_post';
      const metricsError = typeof platformPayload['post_metrics_error'] === 'string' ? platformPayload['post_metrics_error'] : null;
      const profileSnapshot = platformPayload['profile_snapshot_at_post_date'] ?? null;
      const profileSnapshotLatest = platformPayload['profile_snapshot_latest'] ?? null;
      const latestDate = typeof platformPayload['profile_snapshot_latest_date'] === 'string' ? platformPayload['profile_snapshot_latest_date'] : null;

      await env.DB.prepare(`
          UPDATE post_platforms
          SET real_url = COALESCE(?, real_url),
              platform_post_id = COALESCE(?, platform_post_id),
              metrics_json = ?,
              metrics_source = ?,
              metrics_error = ?,
              profile_snapshot_json = ?,
              profile_snapshot_latest_json = ?,
              profile_snapshot_latest_date = ?,
              metrics_synced_at = ?
          WHERE id = ?
        `)
        .bind(
          postUrl,
          platformPostId,
          JSON.stringify(metrics),
          metricsSource,
          metricsError,
          profileSnapshot ? JSON.stringify(profileSnapshot) : null,
          profileSnapshotLatest ? JSON.stringify(profileSnapshotLatest) : null,
          latestDate,
          now,
          row.id,
        )
        .run();
      synced++;
    } catch (err) {
      const message = err instanceof UploadPostError ? err.body.slice(0, 300) : String(err);
      await env.DB
        .prepare('UPDATE post_platforms SET metrics_error = ?, metrics_synced_at = ? WHERE id = ?')
        .bind(message, now, row.id)
        .run();
    }
  }

  return { synced, attempted: rows.results.length };
}

export async function getPlatformMetricConfig(
  env: Pick<Env, 'UPLOAD_POST_API_KEY'>,
): Promise<Record<string, PlatformMetricConfig>> {
  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);
  try {
    const payload = await up.getPlatformMetricsConfig();
    return normalizeMetricConfig(payload);
  } catch {
    return {};
  }
}

export async function getClientProfileAnalytics(
  env: Pick<Env, 'UPLOAD_POST_API_KEY'>,
  client: {
    upload_post_profile: string | null;
    platform_page_ids?: Record<string, string>;
  },
  options: {
    from: string;
    to: string;
    platforms: string[];
  },
): Promise<{
  total_impressions: number | null;
  by_platform: Record<string, MetricTotals>;
}> {
  if (!client.upload_post_profile || options.platforms.length === 0) {
    return { total_impressions: null, by_platform: {} };
  }

  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);
  const byPlatform: Record<string, MetricTotals> = {};
  let totalImpressions: number | null = null;
  const supported = options.platforms.filter((platform) => isAnalyticsSupported(platform));

  if (supported.length > 0) {
    try {
      const payload = await up.getProfileAnalytics({
        profile: client.upload_post_profile,
        platforms: supported,
        pageId: client.platform_page_ids?.facebook,
        pageUrn: client.platform_page_ids?.linkedin,
      });
      if (payload && typeof payload === 'object') {
        for (const [platform, value] of Object.entries(payload as Record<string, unknown>)) {
          byPlatform[platform] = metricTotalsFromUnknown(value);
        }
      }
    } catch {
      // Graceful degradation: report still renders from local data.
    }
  }

  try {
    const payload = await up.getTotalImpressions({
      profile: client.upload_post_profile,
      startDate: options.from,
      endDate: options.to,
      platforms: supported,
      breakdown: true,
      metrics: ['likes', 'comments', 'shares', 'saves'],
    });
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      totalImpressions = parseMetricNumber(record['total_impressions']);
    }
  } catch {
    // Graceful degradation: rely on persisted post metrics.
  }

  return { total_impressions: totalImpressions, by_platform: byPlatform };
}
