/**
 * Reporting routes
 * GET /api/reports/overview          — aggregate dashboard metrics
 * GET /api/reports/posting-stats     — posts by status / platform / client + date range
 * GET /api/reports/client-health     — per-client platform failure rates
 * GET /api/reports/monthly/:clientId — full monthly report for one client
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';
import {
  addMetricTotals,
  emptyMetricTotals,
  getClientProfileAnalytics,
  getPlatformMetricConfig,
  parseStoredMetricTotals,
  syncPostPlatformMetrics,
} from '../modules/reporting-metrics';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

reportRoutes.use('/*', requirePermission('reports.view'));

interface ReportPlatformRow {
  id: string;
  post_id: string;
  title: string;
  publish_date: string;
  platform: string;
  tracking_id: string | null;
  real_url: string | null;
  platform_post_id: string | null;
  status: string | null;
  error_message: string | null;
  attempted_at: string | null;
  idempotency_key: string | null;
  metrics_json: string | null;
  metrics_source: string | null;
  metrics_error: string | null;
  profile_snapshot_json: string | null;
  profile_snapshot_latest_json: string | null;
  profile_snapshot_latest_date: string | null;
  metrics_synced_at: number | null;
  metrics: ReturnType<typeof emptyMetricTotals>;
  metric_labels: Record<string, string>;
  primary_impressions_field: string | null;
}

interface ReportPostRow extends Record<string, unknown> {
  status: string | null;
  actual_platforms: string[];
  metrics: ReturnType<typeof emptyMetricTotals>;
  platform_rows: ReportPlatformRow[];
}

/** GET /api/reports/overview */
reportRoutes.get('/overview', async (c) => {
  // Wrap each query in its own try-catch so a single schema gap can't 500 the dashboard
  const safeCount = async (sql: string): Promise<number> => {
    try {
      const r = await c.env.DB.prepare(sql).first<{ n: number }>();
      return r?.n ?? 0;
    } catch { return 0; }
  };

  const safeJobs = async (): Promise<unknown[]> => {
    try {
      const r = await c.env.DB
        .prepare(
          'SELECT id, mode, status, client_filter, stats_json, created_at, completed_at FROM posting_jobs ORDER BY created_at DESC LIMIT 5',
        )
        .all();
      return r.results ?? [];
    } catch { return []; }
  };

  const [clients, total_posts, posted, failed, pending_approvals, drafts, approved, ready, scheduled, recent_jobs] =
    await Promise.all([
      safeCount("SELECT COUNT(*) as n FROM clients WHERE status = 'active'"),
      safeCount('SELECT COUNT(*) as n FROM posts'),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'posted'"),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'failed'"),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'pending_approval'"),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'draft'"),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'approved'"),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'ready'"),
      safeCount("SELECT COUNT(*) as n FROM posts WHERE status = 'scheduled'"),
      safeJobs(),
    ]);

  return c.json({ clients, total_posts, posted, failed, pending_approvals, drafts, approved, ready, scheduled, recent_jobs });
});

/** GET /api/reports/posting-stats?from=YYYY-MM-DD&to=YYYY-MM-DD&client=slug */
reportRoutes.get('/posting-stats', async (c) => {
  const { from, to, client } = c.req.query();
  const binds: unknown[] = [];
  const conditions: string[] = [];

  // publish_date may be stored as 'YYYY-MM-DDTHH:MM' — use substr(10) to compare date only
  if (from) { conditions.push("substr(p.publish_date,1,10) >= ?"); binds.push(from); }
  if (to)   { conditions.push("substr(p.publish_date,1,10) <= ?"); binds.push(to); }

  let clientId: string | null = null;
  if (client) {
    const row = await c.env.DB.prepare('SELECT id FROM clients WHERE slug = ?').bind(client).first<{ id: string }>();
    if (row) { clientId = row.id; conditions.push('p.client_id = ?'); binds.push(clientId); }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Posts by status
  const byStatus = await c.env.DB
    .prepare(`SELECT status, COUNT(*) as count FROM posts p ${where} GROUP BY status`)
    .bind(...binds)
    .all<{ status: string; count: number }>();

  // Posts by platform (via post_platforms)
  const byPlatform = await c.env.DB
    .prepare(`
      SELECT pp.platform, pp.status, COUNT(*) as count
      FROM post_platforms pp
      JOIN posts p ON p.id = pp.post_id
      ${where ? `${where} AND pp.status != 'legacy_invalid'` : `WHERE pp.status != 'legacy_invalid'`}
      GROUP BY pp.platform, pp.status
      ORDER BY pp.platform, pp.status
    `)
    .bind(...binds)
    .all<{ platform: string; status: string; count: number }>();

  // Posts by client
  const byClient = await c.env.DB
    .prepare(`
      SELECT c.slug, c.canonical_name,
             COUNT(*) as total,
             SUM(CASE WHEN p.status = 'posted' THEN 1 ELSE 0 END) as posted,
             SUM(CASE WHEN p.status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
             SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM posts p
      JOIN clients c ON c.id = p.client_id
      ${where}
      GROUP BY c.id
      ORDER BY total DESC
    `)
    .bind(...binds)
    .all<{ slug: string; canonical_name: string; total: number; posted: number; scheduled: number; failed: number }>();

  return c.json({
    by_status:   byStatus.results,
    by_platform: byPlatform.results,
    by_client:   byClient.results,
  });
});

/** GET /api/reports/client-health */
reportRoutes.get('/client-health', async (c) => {
  const rows = await c.env.DB
    .prepare(`
      SELECT
        c.slug, c.canonical_name,
        pp.platform,
        COUNT(*) as attempts,
        SUM(CASE WHEN pp.status IN ('sent','idempotent','posted') THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN pp.status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN pp.status = 'blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN pp.status = 'skipped' THEN 1 ELSE 0 END) as skipped,
        MAX(pp.attempted_at) as last_attempt
      FROM post_platforms pp
      JOIN posts p ON p.id = pp.post_id
      JOIN clients c ON c.id = p.client_id
      WHERE pp.status != 'legacy_invalid'
      GROUP BY c.id, pp.platform
      ORDER BY c.canonical_name, pp.platform
    `)
    .all();
  return c.json({ health: rows.results });
});

/** GET /api/reports/monthly/:clientId?month=2026-04 */
reportRoutes.get('/monthly/:clientId', async (c) => {
  const { clientId } = c.req.param();
  const monthParam = c.req.query('month');
  const fromParam = c.req.query('from');
  const toParam = c.req.query('to');
  const platformFilter = c.req.query('platform') ?? null;

  const resolvedMonth = monthParam ?? (!fromParam && !toParam ? new Date().toISOString().slice(0, 7) : null);
  const [year, month] = resolvedMonth ? resolvedMonth.split('-').map(Number) : [0, 0];
  const from = fromParam ?? (resolvedMonth ? `${resolvedMonth}-01` : new Date().toISOString().slice(0, 10));
  const lastDay = resolvedMonth ? new Date(year, month, 0).getDate() : Number(toParam?.slice(8, 10) ?? 0);
  const to = toParam ?? (resolvedMonth ? `${resolvedMonth}-${String(lastDay).padStart(2, '0')}` : from);

  const client = await c.env.DB
    .prepare('SELECT id, slug, canonical_name, brand_json, upload_post_profile FROM clients WHERE id = ? OR slug = ?')
    .bind(clientId, clientId)
    .first<{ id: string; slug: string; canonical_name: string; brand_json: string | null; upload_post_profile: string | null }>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const platformExistsClause = !platformFilter
    ? ''
    : platformFilter === 'website_blog'
      ? "AND p.wp_post_url IS NOT NULL"
      : `AND EXISTS (
           SELECT 1 FROM post_platforms pp2
           WHERE pp2.post_id = p.id
             AND pp2.platform = ?
             AND pp2.status != 'legacy_invalid'
         )`;
  const postIdBinds: unknown[] = [client.id, from, to];
  if (platformFilter && platformFilter !== 'website_blog') postIdBinds.push(platformFilter);
  const postIds = await c.env.DB
    .prepare(`
      SELECT p.id
      FROM posts p
      WHERE p.client_id = ?
        AND substr(p.publish_date,1,10) >= ?
        AND substr(p.publish_date,1,10) <= ?
        ${platformExistsClause}
      ORDER BY p.publish_date DESC
    `)
    .bind(...postIdBinds)
    .all<{ id: string }>();

  await syncPostPlatformMetrics(c.env, {
    postIds: postIds.results.map((row) => row.id),
    limit: 250,
  });

  const rangeBinds: unknown[] = [client.id, from, to];
  if (platformFilter && platformFilter !== 'website_blog') rangeBinds.push(platformFilter);
  const platformWhere = platformFilter && platformFilter !== 'website_blog' ? 'AND pp.platform = ?' : '';

  const [clientPlatformRows, posts, byPlatform, failedPosts, metricConfig] = await Promise.all([
    c.env.DB
      .prepare('SELECT platform, page_id FROM client_platforms WHERE client_id = ?')
      .bind(client.id)
      .all<{ platform: string; page_id: string | null }>(),
    c.env.DB
      .prepare(`
        SELECT p.*
        FROM posts p
        WHERE p.client_id = ?
          AND substr(p.publish_date,1,10) >= ?
          AND substr(p.publish_date,1,10) <= ?
          ${platformExistsClause}
        ORDER BY p.publish_date DESC, p.updated_at DESC
      `)
      .bind(...rangeBinds)
      .all<Record<string, unknown>>(),
    c.env.DB
      .prepare(`
        SELECT pp.*,
               p.id as post_id,
               p.title,
               p.publish_date
        FROM post_platforms pp
        JOIN posts p ON p.id = pp.post_id
        WHERE p.client_id = ?
          AND substr(p.publish_date,1,10) >= ?
          AND substr(p.publish_date,1,10) <= ?
          ${platformWhere}
          AND pp.status != 'legacy_invalid'
        ORDER BY p.publish_date DESC, pp.platform ASC
      `)
      .bind(...rangeBinds)
      .all<Record<string, unknown>>(),
    c.env.DB
      .prepare(`
        SELECT p.title, p.publish_date, pp.platform, pp.error_message
        FROM post_platforms pp
        JOIN posts p ON p.id = pp.post_id
        WHERE p.client_id = ?
          AND pp.status = 'failed'
          AND substr(p.publish_date,1,10) >= ?
          AND substr(p.publish_date,1,10) <= ?
          ${platformWhere}
          AND pp.status != 'legacy_invalid'
      `)
      .bind(...rangeBinds)
      .all<{ title: string; publish_date: string; platform: string; error_message: string }>(),
    getPlatformMetricConfig(c.env),
  ]);

  const profileAnalytics = await getClientProfileAnalytics(c.env, {
    upload_post_profile: client.upload_post_profile,
    platform_page_ids: Object.fromEntries(clientPlatformRows.results.map((row) => [row.platform, row.page_id ?? ''])),
  }, {
    from,
    to,
    platforms: [...new Set(byPlatform.results.map((row) => String(row['platform'] ?? '')))].filter(Boolean),
  });

  const platformRows: ReportPlatformRow[] = byPlatform.results.map((row) => {
    const platform = String(row['platform'] ?? '');
    return {
      id: String(row['id'] ?? ''),
      post_id: String(row['post_id'] ?? ''),
      title: String(row['title'] ?? ''),
      publish_date: String(row['publish_date'] ?? ''),
      platform,
      tracking_id: row['tracking_id'] == null ? null : String(row['tracking_id']),
      real_url: row['real_url'] == null ? null : String(row['real_url']),
      platform_post_id: row['platform_post_id'] == null ? null : String(row['platform_post_id']),
      status: row['status'] == null ? null : String(row['status']),
      error_message: row['error_message'] == null ? null : String(row['error_message']),
      attempted_at: row['attempted_at'] == null ? null : String(row['attempted_at']),
      idempotency_key: row['idempotency_key'] == null ? null : String(row['idempotency_key']),
      metrics_json: row['metrics_json'] == null ? null : String(row['metrics_json']),
      metrics_source: row['metrics_source'] == null ? null : String(row['metrics_source']),
      metrics_error: row['metrics_error'] == null ? null : String(row['metrics_error']),
      profile_snapshot_json: row['profile_snapshot_json'] == null ? null : String(row['profile_snapshot_json']),
      profile_snapshot_latest_json: row['profile_snapshot_latest_json'] == null ? null : String(row['profile_snapshot_latest_json']),
      profile_snapshot_latest_date: row['profile_snapshot_latest_date'] == null ? null : String(row['profile_snapshot_latest_date']),
      metrics_synced_at: typeof row['metrics_synced_at'] === 'number' ? row['metrics_synced_at'] : null,
      metrics: parseStoredMetricTotals((row['metrics_json'] as string | null) ?? null),
      metric_labels: metricConfig[platform]?.metric_labels ?? {},
      primary_impressions_field: metricConfig[platform]?.primary_impressions_field ?? null,
    };
  });

  const rowsByPost = new Map<string, ReportPlatformRow[]>();
  for (const row of platformRows) {
    const key = String(row.post_id);
    const existing = rowsByPost.get(key) ?? [];
    existing.push(row);
    rowsByPost.set(key, existing);
  }

  const postsWithPlatformRows: ReportPostRow[] = posts.results.map((post) => {
    const postPlatformRows = [...(rowsByPost.get(String(post['id'])) ?? [])];
    if (String(post['content_type'] ?? '') === 'blog' && typeof post['wp_post_url'] === 'string' && post['wp_post_url']) {
      postPlatformRows.unshift({
        id: `blog:${String(post['id'])}`,
        post_id: String(post['id']),
        platform: 'website_blog',
        tracking_id: null,
        real_url: String(post['wp_post_url']),
        platform_post_id: String(post['wp_post_id'] ?? ''),
        status: String(post['wp_post_status'] ?? post['status'] ?? 'posted'),
        error_message: null,
        attempted_at: null,
        idempotency_key: null,
        metrics_json: null,
        metrics_source: null,
        metrics_error: null,
        profile_snapshot_json: null,
        profile_snapshot_latest_json: null,
        profile_snapshot_latest_date: null,
        metrics_synced_at: null,
        title: String(post['title'] ?? ''),
        publish_date: String(post['publish_date'] ?? ''),
        metrics: emptyMetricTotals(),
        metric_labels: {},
        primary_impressions_field: null,
      });
    }
    const postMetrics = postPlatformRows.reduce((acc, row) => addMetricTotals(acc, row.metrics), emptyMetricTotals());
    return {
      ...post,
      status: post['status'] == null ? null : String(post['status']),
      actual_platforms: [...new Set(postPlatformRows.filter((row) => ['posted', 'sent', 'idempotent'].includes(String(row.status ?? ''))).map((row) => row.platform))],
      metrics: postMetrics,
      platform_rows: postPlatformRows,
    };
  });

  const allReportRows = postsWithPlatformRows.flatMap((post) => post.platform_rows);
  const summaryMetrics = allReportRows.reduce((acc, row) => addMetricTotals(acc, row.metrics), emptyMetricTotals());

  const platformBreakdownMap = new Map<string, {
    platform: string;
    total: number;
    posted: number;
    failed: number;
    links: number;
    metrics: ReturnType<typeof emptyMetricTotals>;
  }>();
  for (const row of allReportRows) {
    const key = row.platform;
    const current = platformBreakdownMap.get(key) ?? {
      platform: key,
      total: 0,
      posted: 0,
      failed: 0,
      links: 0,
      metrics: emptyMetricTotals(),
    };
    current.total++;
    if (['posted', 'sent', 'idempotent'].includes(String(row.status ?? ''))) current.posted++;
    if (String(row.status ?? '') === 'failed') current.failed++;
    if (row.real_url) current.links++;
    current.metrics = addMetricTotals(current.metrics, row.metrics);
    platformBreakdownMap.set(key, current);
  }

  const total = postsWithPlatformRows.length;
  const posted = postsWithPlatformRows.filter((row) => row.status === 'posted').length;
  const scheduled = postsWithPlatformRows.filter((row) => row.status === 'scheduled').length;
  const failed = postsWithPlatformRows.filter((row) => row.status === 'failed').length;

  return c.json({
    client:     { ...client, brand: client.brand_json ? JSON.parse(client.brand_json) : null },
    period:     { month: resolvedMonth, from, to },
    filters:    { platform: platformFilter },
    summary:    {
      total,
      posted,
      scheduled,
      failed,
      success_rate: total > 0 ? Math.round((posted / total) * 100) : 0,
      metrics: summaryMetrics,
      total_impressions: profileAnalytics.total_impressions ?? summaryMetrics.impressions,
    },
    platform_breakdown: [...platformBreakdownMap.values()]
      .map((row) => ({
        ...row,
        success_rate: row.total > 0 ? Math.round((row.posted / row.total) * 100) : 0,
        profile: profileAnalytics.by_platform[row.platform] ?? emptyMetricTotals(),
        primary_impressions_field: metricConfig[row.platform]?.primary_impressions_field ?? null,
      }))
      .sort((a, b) => b.total - a.total),
    profile_analytics: {
      total_impressions: profileAnalytics.total_impressions,
      by_platform: profileAnalytics.by_platform,
      metric_config: metricConfig,
    },
    posts:      postsWithPlatformRows,
    failed_detail: failedPosts.results,
  });
});
