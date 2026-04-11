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

export const reportRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

reportRoutes.use('/*', requirePermission('reports.view'));

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

  if (from) { conditions.push('p.publish_date >= ?'); binds.push(from); }
  if (to)   { conditions.push('p.publish_date <= ?'); binds.push(to); }

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
      ${where}
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
             SUM(CASE WHEN p.status IN ('scheduled','posted') THEN 1 ELSE 0 END) as posted,
             SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM posts p
      JOIN clients c ON c.id = p.client_id
      ${where}
      GROUP BY c.id
      ORDER BY total DESC
    `)
    .bind(...binds)
    .all<{ slug: string; canonical_name: string; total: number; posted: number; failed: number }>();

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
        SUM(CASE WHEN pp.status = 'sent' OR pp.status = 'idempotent' THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN pp.status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN pp.status = 'blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN pp.status = 'skipped' THEN 1 ELSE 0 END) as skipped,
        MAX(pp.attempted_at) as last_attempt
      FROM post_platforms pp
      JOIN posts p ON p.id = pp.post_id
      JOIN clients c ON c.id = p.client_id
      GROUP BY c.id, pp.platform
      ORDER BY c.canonical_name, pp.platform
    `)
    .all();
  return c.json({ health: rows.results });
});

/** GET /api/reports/monthly/:clientId?month=2026-04 */
reportRoutes.get('/monthly/:clientId', async (c) => {
  const { clientId } = c.req.param();
  const monthParam = c.req.query('month') ?? new Date().toISOString().slice(0, 7); // YYYY-MM

  const [year, month] = monthParam.split('-').map(Number);
  const from = `${monthParam}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${monthParam}-${String(lastDay).padStart(2, '0')}`;

  const client = await c.env.DB
    .prepare('SELECT id, slug, canonical_name, brand_json FROM clients WHERE id = ? OR slug = ?')
    .bind(clientId, clientId)
    .first<{ id: string; slug: string; canonical_name: string; brand_json: string | null }>();
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const [posts, byPlatform, failedPosts] = await Promise.all([
    c.env.DB
      .prepare(`
        SELECT p.id, p.title, p.status, p.content_type, p.platforms, p.publish_date,
               p.master_caption, p.wp_post_url
        FROM posts p
        WHERE p.client_id = ? AND p.publish_date >= ? AND p.publish_date <= ?
        ORDER BY p.publish_date ASC
      `)
      .bind(client.id, from, to)
      .all(),
    c.env.DB
      .prepare(`
        SELECT pp.platform, pp.status, pp.real_url, pp.tracking_id, pp.error_message,
               p.title, p.publish_date
        FROM post_platforms pp
        JOIN posts p ON p.id = pp.post_id
        WHERE p.client_id = ? AND p.publish_date >= ? AND p.publish_date <= ?
        ORDER BY p.publish_date ASC, pp.platform ASC
      `)
      .bind(client.id, from, to)
      .all(),
    c.env.DB
      .prepare(`
        SELECT p.title, p.publish_date, pp.platform, pp.error_message
        FROM post_platforms pp
        JOIN posts p ON p.id = pp.post_id
        WHERE p.client_id = ? AND pp.status = 'failed' AND p.publish_date >= ? AND p.publish_date <= ?
      `)
      .bind(client.id, from, to)
      .all(),
  ]);

  // Summary metrics
  const total = posts.results.length;
  const posted = posts.results.filter((r: Record<string, unknown>) => r['status'] === 'scheduled' || r['status'] === 'posted').length;
  const failed = failedPosts.results.length;

  return c.json({
    client:     { ...client, brand: client.brand_json ? JSON.parse(client.brand_json) : null },
    period:     { month: monthParam, from, to },
    summary:    { total, posted, failed, success_rate: total > 0 ? Math.round((posted / total) * 100) : 0 },
    posts:      posts.results,
    platforms:  byPlatform.results,
    failed_detail: failedPosts.results,
  });
});
