/**
 * Post routes — CRUD + workflow actions
 */
import { Hono } from 'hono';
import { z } from 'zod';
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
  const { client, status, platform, date_from, date_to, limit, offset } = c.req.query();
  let clientId: string | undefined;
  if (client) {
    const row = await c.env.DB
      .prepare('SELECT id FROM clients WHERE slug = ?')
      .bind(client)
      .first<{ id: string }>();
    clientId = row?.id;
  }
  const posts = await listPosts(c.env.DB, {
    clientId,
    status,
    platform,
    dateFrom: date_from,
    dateTo: date_to,
    limit: limit ? parseInt(limit) : 50,
    offset: offset ? parseInt(offset) : 0,
  });
  return c.json({ posts });
});

/** GET /api/posts/:id */
postRoutes.get('/:id', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  return c.json({ post });
});

/** POST /api/posts */
postRoutes.post('/', async (c) => {
  const schema = z.object({
    client_id: z.string(),
    title: z.string().min(1),
    content_type: z.string().optional().default('image'),
    platforms: z.array(z.string()).optional().default([]),
    publish_date: z.string().optional(),
  });
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const user = c.get('user');
  const post = await createPost(c.env.DB, {
    ...parsed.data,
    platforms: JSON.stringify(parsed.data.platforms),
    created_by: user.userId,
  });
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

  // Snapshot before update for version history
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
  if (reason) {
    await updatePost(c.env.DB, post.id, { error_log: `[REJECTED] ${reason}` });
  }
  return c.json({ ok: true, status: 'draft' });
});

/** POST /api/posts/:id/ready — mark ready for automation */
postRoutes.post('/:id/ready', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);
  await updatePost(c.env.DB, post.id, {
    status: 'ready',
    ready_for_automation: 1,
    asset_delivered: 1,
  });
  return c.json({ ok: true, status: 'ready' });
});

/** POST /api/posts/:id/publish — trigger single post */
postRoutes.post('/:id/publish', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  let dryRun = false;
  try { dryRun = ((await c.req.json()) as { dry_run?: boolean }).dry_run ?? false; } catch { /* empty */ }

  const { createPostingJob } = await import('../db/queries');
  const job = await createPostingJob(c.env.DB, {
    triggered_by: 'api',
    mode: dryRun ? 'dry_run' : 'real',
    client_filter: undefined,
  });

  c.executionCtx.waitUntil(
    c.env.LOADER.fetch(new Request('https://loader/run-posting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: dryRun ? 'dry_run' : 'real',
        entry_id: post.id,
        job_id: job.id,
        triggered_by: 'api',
      }),
    })),
  );

  return c.json({ ok: true, job_id: job.id, dry_run: dryRun }, 202);
});

/** POST /api/posts/:id/retry */
postRoutes.post('/:id/retry', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Not found' }, 404);

  // Reset failed platforms so they get retried
  await c.env.DB
    .prepare("UPDATE post_platforms SET status = 'pending', tracking_id = NULL, error_message = NULL WHERE post_id = ? AND status = 'failed'")
    .bind(post.id)
    .run();

  // Reset post status to ready
  await setPostStatus(c.env.DB, post.id, 'ready', 'Pending');

  return c.json({ ok: true, message: 'Failed platforms reset — will be retried on next run' });
});

/** GET /api/posts/:id/history */
postRoutes.get('/:id/history', async (c) => {
  const versions = await c.env.DB
    .prepare('SELECT id, version, changed_by, created_at FROM post_versions WHERE post_id = ? ORDER BY version DESC')
    .bind(c.req.param('id'))
    .all();
  return c.json({ versions: versions.results });
});

/** GET /api/posts/:id/platforms */
postRoutes.get('/:id/platforms', async (c) => {
  const platforms = await getPostPlatforms(c.env.DB, c.req.param('id'));
  return c.json({ platforms });
});
