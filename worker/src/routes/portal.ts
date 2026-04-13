/**
 * Client portal API — strictly isolated to user.clientId
 * All routes require role=client AND enforce client_id match.
 *
 * GET  /api/portal/summary          — dashboard metrics + client info
 * GET  /api/portal/posts            — paginated posts list
 * GET  /api/portal/report           — date-range report with platform breakdown
 * GET  /api/portal/feedback         — list client feedback
 * POST /api/portal/feedback         — submit new feedback
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';

export const portalRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// All portal routes: must be authenticated + have portal.view permission
portalRoutes.use('/*', requirePermission('portal.view'));

// Enforce: only client role (and admin) can access; client must have clientId
portalRoutes.use('/*', async (c, next) => {
  const user = c.get('user');
  if (user.role === 'admin') return next();           // admin can browse any portal
  if (user.role !== 'client') return c.json({ error: 'Forbidden' }, 403);
  if (!user.clientId) return c.json({ error: 'Client account not linked' }, 403);
  return next();
});

function getClientId(c: { get(k: 'user'): SessionData; req: { query(k: string): string | undefined } }): string | null {
  const user = c.get('user');
  if (user.role === 'admin') return c.req.query('client_id') ?? null; // admin can pass client_id param
  return user.clientId;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/summary
// ─────────────────────────────────────────────────────────────────────────────
portalRoutes.get('/summary', async (c) => {
  const clientId = getClientId(c);
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  const month   = `strftime('%Y-%m','now','-6 hours')`;

  const [client, totals, platforms, recentPosts, activePlatforms] = await Promise.all([
    c.env.DB
      .prepare(`SELECT id, slug, canonical_name, phone, email, industry, state,
                       brand_primary_color, brand_accent_color, logo_url, package
                FROM clients WHERE id = ?`)
      .bind(clientId)
      .first<{
        id: string; slug: string; canonical_name: string;
        phone: string | null; email: string | null; industry: string | null; state: string | null;
        brand_primary_color: string | null; brand_accent_color: string | null; logo_url: string | null;
        package: string | null;
      }>(),

    c.env.DB
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('scheduled','posted') THEN 1 ELSE 0 END) as published,
          SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as scheduled,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM posts
        WHERE client_id = ?
          AND substr(publish_date,1,7) = ${month}
      `)
      .bind(clientId)
      .first<{ total: number; published: number; scheduled: number; failed: number }>(),

    c.env.DB
      .prepare(`
        SELECT pp.platform, pp.status, COUNT(*) as count
        FROM post_platforms pp
        JOIN posts p ON p.id = pp.post_id
        WHERE p.client_id = ?
          AND substr(p.publish_date,1,7) = ${month}
        GROUP BY pp.platform, pp.status
        ORDER BY pp.platform
      `)
      .bind(clientId)
      .all<{ platform: string; status: string; count: number }>(),

    c.env.DB
      .prepare(`
        SELECT p.id, p.title, p.status, p.content_type, p.platforms, p.publish_date
        FROM posts p
        WHERE p.client_id = ?
          AND p.status IN ('scheduled','posted','ready','approved')
        ORDER BY p.publish_date DESC
        LIMIT 6
      `)
      .bind(clientId)
      .all<{ id: string; title: string; status: string; content_type: string; platforms: string; publish_date: string }>(),

    c.env.DB
      .prepare(`SELECT platform FROM client_platforms WHERE client_id = ? AND paused = 0 ORDER BY platform`)
      .bind(clientId)
      .all<{ platform: string }>(),
  ]);

  if (!client) return c.json({ error: 'Client not found' }, 404);

  return c.json({
    client,
    period: { month: new Date().toISOString().slice(0, 7) },
    summary: totals ?? { total: 0, published: 0, scheduled: 0, failed: 0 },
    by_platform: platforms.results,
    recent_posts: recentPosts.results,
    active_platforms: activePlatforms.results.map(r => r.platform),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/posts?page=1&limit=20&status=
// ─────────────────────────────────────────────────────────────────────────────
portalRoutes.get('/posts', async (c) => {
  const clientId = getClientId(c);
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  const page   = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit  = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)));
  const status = c.req.query('status') ?? '';
  const offset = (page - 1) * limit;

  const conditions = ['p.client_id = ?'];
  const binds: unknown[] = [clientId];

  if (status) { conditions.push('p.status = ?'); binds.push(status); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [posts, countRow] = await Promise.all([
    c.env.DB
      .prepare(`
        SELECT p.id, p.title, p.status, p.content_type, p.platforms, p.publish_date
        FROM posts p
        ${where}
        ORDER BY p.publish_date DESC
        LIMIT ? OFFSET ?
      `)
      .bind(...binds, limit, offset)
      .all<{ id: string; title: string; status: string; content_type: string; platforms: string; publish_date: string }>(),

    c.env.DB
      .prepare(`SELECT COUNT(*) as n FROM posts p ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ]);

  // Fetch post_platforms (live URLs) for these posts
  const ids = posts.results.map(p => p.id);
  let postPlatforms: { post_id: string; platform: string; real_url: string | null; status: string }[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const ppRows = await c.env.DB
      .prepare(`SELECT post_id, platform, real_url, status FROM post_platforms WHERE post_id IN (${placeholders})`)
      .bind(...ids)
      .all<{ post_id: string; platform: string; real_url: string | null; status: string }>();
    postPlatforms = ppRows.results;
  }

  // Attach URLs to posts
  const urlsByPost = postPlatforms.reduce<Record<string, typeof postPlatforms>>((acc, r) => {
    if (!acc[r.post_id]) acc[r.post_id] = [];
    acc[r.post_id].push(r);
    return acc;
  }, {});

  const enriched = posts.results.map(p => ({ ...p, post_urls: urlsByPost[p.id] ?? [] }));

  return c.json({
    posts: enriched,
    total: countRow?.n ?? 0,
    page,
    limit,
    pages: Math.ceil((countRow?.n ?? 0) / limit),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/report?from=YYYY-MM-DD&to=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
portalRoutes.get('/report', async (c) => {
  const clientId = getClientId(c);
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  const from = c.req.query('from') ?? new Date().toISOString().slice(0, 7) + '-01';
  const to   = c.req.query('to')   ?? new Date().toISOString().slice(0, 10);

  const [client, posts, byPlatform] = await Promise.all([
    c.env.DB
      .prepare('SELECT id, slug, canonical_name FROM clients WHERE id = ?')
      .bind(clientId).first<{ id: string; slug: string; canonical_name: string }>(),

    c.env.DB
      .prepare(`
        SELECT p.id, p.title, p.status, p.content_type, p.platforms, p.publish_date
        FROM posts p
        WHERE p.client_id = ?
          AND substr(p.publish_date,1,10) >= ?
          AND substr(p.publish_date,1,10) <= ?
        ORDER BY p.publish_date ASC
      `)
      .bind(clientId, from, to)
      .all<{ id: string; title: string; status: string; content_type: string; platforms: string; publish_date: string }>(),

    c.env.DB
      .prepare(`
        SELECT pp.platform, pp.status, pp.real_url, p.id as post_id, p.title, p.publish_date
        FROM post_platforms pp
        JOIN posts p ON p.id = pp.post_id
        WHERE p.client_id = ?
          AND substr(p.publish_date,1,10) >= ?
          AND substr(p.publish_date,1,10) <= ?
        ORDER BY p.publish_date ASC, pp.platform ASC
      `)
      .bind(clientId, from, to)
      .all<{ platform: string; status: string; real_url: string | null; post_id: string; title: string; publish_date: string }>(),
  ]);

  if (!client) return c.json({ error: 'Client not found' }, 404);

  const total     = posts.results.length;
  const published = posts.results.filter(p => p.status === 'scheduled' || p.status === 'posted').length;

  return c.json({
    client,
    period: { from, to },
    summary: { total, published, success_rate: total > 0 ? Math.round((published / total) * 100) : 0 },
    posts: posts.results,
    post_platforms: byPlatform.results,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/feedback
// ─────────────────────────────────────────────────────────────────────────────
portalRoutes.get('/feedback', async (c) => {
  const clientId = getClientId(c);
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  const rows = await c.env.DB
    .prepare(`SELECT id, category, sentiment, message, created_at
              FROM client_feedback
              WHERE client_id = ?
              ORDER BY created_at DESC
              LIMIT 20`)
    .bind(clientId)
    .all<{ id: string; category: string; sentiment: string; message: string; created_at: number }>();

  return c.json({ feedback: rows.results });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/feedback
// ─────────────────────────────────────────────────────────────────────────────
portalRoutes.post('/feedback', async (c) => {
  const user     = c.get('user');
  const clientId = getClientId(c);
  if (!clientId) return c.json({ error: 'client_id required' }, 400);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const { category, sentiment, message } = body as { category?: string; sentiment?: string; message?: string };
  if (!message?.trim()) return c.json({ error: 'message is required' }, 400);

  const validCategories = ['content_quality', 'timing', 'platform_issue', 'design', 'other'];
  const validSentiments = ['positive', 'neutral', 'negative'];
  const cat = validCategories.includes(category ?? '') ? (category as string) : 'other';
  const sen = validSentiments.includes(sentiment ?? '') ? (sentiment as string) : 'neutral';

  const id  = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  const month = new Date().toISOString().slice(0, 7);

  await c.env.DB
    .prepare(`INSERT INTO client_feedback (id, client_id, submitted_by, month, category, sentiment, message, admin_reviewed, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .bind(id, clientId, user.userId, month, cat, sen, message.trim(), now, now)
    .run();

  return c.json({ ok: true, id }, 201);
});
