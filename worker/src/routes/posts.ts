/**
 * Post routes — CRUD + workflow actions
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listPosts,
  getPostById,
  createPost,
  updatePost,
  setPostStatus,
  getPostPlatforms,
  writeAuditLog,
} from '../db/queries';

export const postRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

/** GET /api/posts */
postRoutes.get('/', async (c) => {
  const q = c.req.query();
  const { client, status, platform, limit, page } = q;
  // Support both date_from/date_to and from/to
  const dateFrom = q['date_from'] ?? q['from'];
  const dateTo   = q['date_to']   ?? q['to'];

  let clientId: string | undefined;
  if (client) {
    const row = await c.env.DB
      .prepare('SELECT id FROM clients WHERE slug = ?')
      .bind(client)
      .first<{ id: string }>();
    clientId = row?.id;
  }

  const pageNum  = page ? Math.max(1, parseInt(page)) : 1;
  const limitNum = limit ? Math.min(200, parseInt(limit)) : 50;
  const offset   = (pageNum - 1) * limitNum;

  const [posts, countRow] = await Promise.all([
    listPosts(c.env.DB, {
      clientId,
      status,
      platform,
      dateFrom,
      dateTo,
      limit: limitNum,
      offset,
    }),
    c.env.DB
      .prepare('SELECT COUNT(*) as n FROM posts' +
        (clientId  ? ' WHERE client_id = ?' :
         status    ? ' WHERE status = ?'    : ''))
      .bind(...(clientId ? [clientId] : status ? [status] : []))
      .first<{ n: number }>(),
  ]);

  // Join client name
  const enriched = await Promise.all(posts.map(async (p) => {
    const cl = await c.env.DB
      .prepare('SELECT slug, canonical_name FROM clients WHERE id = ?')
      .bind(p.client_id)
      .first<{ slug: string; canonical_name: string }>();
    return { ...p, client_slug: cl?.slug, client_name: cl?.canonical_name };
  }));

  return c.json({ posts: enriched, total: countRow?.n ?? posts.length });
});

/** GET /api/posts/:id */
postRoutes.get('/:id', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  const platforms = await getPostPlatforms(c.env.DB, post.id);
  // Join client name
  const cl = await c.env.DB
    .prepare('SELECT slug, canonical_name FROM clients WHERE id = ?')
    .bind(post.client_id)
    .first<{ slug: string; canonical_name: string }>();
  return c.json({ post: { ...post, client_slug: cl?.slug, client_name: cl?.canonical_name }, platforms });
});

/** POST /api/posts */
postRoutes.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Resolve client_slug → client_id if needed
  let clientId = body['client_id'] as string | undefined;
  if (!clientId && body['client_slug']) {
    const row = await c.env.DB
      .prepare('SELECT id FROM clients WHERE slug = ?')
      .bind(body['client_slug'])
      .first<{ id: string }>();
    if (!row) return c.json({ error: 'Client not found' }, 404);
    clientId = row.id;
  }
  if (!clientId) return c.json({ error: 'client_id or client_slug required' }, 400);

  const user = c.get('user');
  const post = await createPost(c.env.DB, {
    client_id:           clientId,
    title:               (body['title'] as string) ?? null,
    status:              (body['status'] as string) ?? 'draft',
    content_type:        (body['content_type'] as string) ?? 'image',
    platforms:           typeof body['platforms'] === 'string'
                           ? body['platforms']
                           : JSON.stringify(body['platforms'] ?? []),
    publish_date:        (body['publish_date'] as string) ?? null,
    master_caption:      (body['master_caption'] as string) ?? null,
    cap_facebook:        (body['cap_facebook'] as string) ?? null,
    cap_instagram:       (body['cap_instagram'] as string) ?? null,
    cap_linkedin:        (body['cap_linkedin'] as string) ?? null,
    cap_x:               (body['cap_x'] as string) ?? null,
    cap_threads:         (body['cap_threads'] as string) ?? null,
    cap_tiktok:          (body['cap_tiktok'] as string) ?? null,
    cap_pinterest:       (body['cap_pinterest'] as string) ?? null,
    cap_bluesky:         (body['cap_bluesky'] as string) ?? null,
    cap_google_business: (body['cap_google_business'] as string) ?? null,
    asset_r2_key:        (body['asset_r2_key'] as string) ?? null,
    canva_link:          (body['canva_link'] as string) ?? null,
    created_by:          user.userId,
  } as Parameters<typeof createPost>[1]);

  await writeAuditLog(c.env.DB, {
    user_id: user.userId,
    action: 'post.create',
    entity_type: 'post',
    entity_id: post.id,
  });
  return c.json({ post }, 201);
});

/** PUT /api/posts/:id */
postRoutes.put('/:id', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Version snapshot
  const snap = JSON.stringify(post);
  const version = await c.env.DB
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 as v FROM post_versions WHERE post_id = ?')
    .bind(post.id)
    .first<{ v: number }>();
  await c.env.DB
    .prepare('INSERT INTO post_versions (id, post_id, version, changed_by, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID().replace(/-/g, ''), post.id, version?.v ?? 1, c.get('user').userId, snap, Math.floor(Date.now() / 1000))
    .run();

  await updatePost(c.env.DB, post.id, body as Record<string, unknown>);
  const updated = await getPostById(c.env.DB, post.id);
  return c.json({ post: updated });
});

/** POST /api/posts/:id/approve */
postRoutes.post('/:id/approve', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await setPostStatus(c.env.DB, post.id, 'approved');
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'post.approve',
    entity_type: 'post',
    entity_id: post.id,
    old_value: { status: post.status },
    new_value: { status: 'approved' },
  });
  return c.json({ ok: true, status: 'approved' });
});

/** POST /api/posts/:id/reject */
postRoutes.post('/:id/reject', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  let reason = '';
  try { reason = ((await c.req.json()) as { reason?: string }).reason ?? ''; } catch { /* empty */ }
  await setPostStatus(c.env.DB, post.id, 'draft');
  if (reason) await updatePost(c.env.DB, post.id, { error_log: `[REJECTED] ${reason}` });
  return c.json({ ok: true, status: 'draft' });
});

/** POST /api/posts/:id/ready */
postRoutes.post('/:id/ready', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await updatePost(c.env.DB, post.id, { status: 'ready', ready_for_automation: 1, asset_delivered: 1 });
  return c.json({ ok: true, status: 'ready' });
});

/** POST /api/posts/:id/publish */
postRoutes.post('/:id/publish', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  let dryRun = false;
  try { dryRun = ((await c.req.json()) as { dry_run?: boolean }).dry_run ?? false; } catch { /* empty */ }

  const { createPostingJob } = await import('../db/queries');
  const job = await createPostingJob(c.env.DB, { triggered_by: 'api', mode: dryRun ? 'dry_run' : 'real', client_filter: undefined });

  c.executionCtx.waitUntil(
    c.env.LOADER.fetch(new Request('https://loader/run-posting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: dryRun ? 'dry_run' : 'real', entry_id: post.id, job_id: job.id, triggered_by: 'api' }),
    })),
  );

  return c.json({ ok: true, job_id: job.id, dry_run: dryRun }, 202);
});

/** POST /api/posts/:id/retry */
postRoutes.post('/:id/retry', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare("UPDATE post_platforms SET status = 'pending', tracking_id = NULL, error_message = NULL WHERE post_id = ? AND status = 'failed'")
    .bind(post.id)
    .run();
  await setPostStatus(c.env.DB, post.id, 'ready', 'Pending');
  return c.json({ ok: true, message: 'Failed platforms reset' });
});

/** GET /api/posts/:id/platforms */
postRoutes.get('/:id/platforms', async (c) => {
  const platforms = await getPostPlatforms(c.env.DB, c.req.param('id'));
  return c.json({ platforms });
});

/** GET /api/posts/:id/history */
postRoutes.get('/:id/history', async (c) => {
  const versions = await c.env.DB
    .prepare('SELECT id, version, changed_by, created_at FROM post_versions WHERE post_id = ? ORDER BY version DESC')
    .bind(c.req.param('id'))
    .all();
  return c.json({ versions: versions.results });
});
