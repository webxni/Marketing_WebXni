/**
 * Client intelligence routes
 * GET /api/clients/:slug/intelligence
 * PUT /api/clients/:slug/intelligence
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { getClientBySlug } from '../db/queries';
import { requirePermission } from '../middleware/auth';

export const intelligenceRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const WRITABLE_FIELDS = new Set([
  'brand_voice','tone_keywords','prohibited_terms','approved_ctas',
  'content_goals','service_priorities','content_angles','seasonal_notes',
  'competitor_notes','audience_notes','primary_keyword','secondary_keywords',
  'local_seo_themes','generation_model','generation_language','humanization_style',
  'monthly_snapshot','feedback_summary',
]);

/** GET /api/clients/:slug/intelligence */
intelligenceRoutes.get('/:slug/intelligence', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  const row = await c.env.DB
    .prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
    .bind(client.id)
    .first();
  return c.json({ intelligence: row ?? null });
});

/** PUT /api/clients/:slug/intelligence — upsert */
intelligenceRoutes.put('/:slug/intelligence', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const existing = await c.env.DB
    .prepare('SELECT id FROM client_intelligence WHERE client_id = ?')
    .bind(client.id)
    .first<{ id: string }>();

  const now = Math.floor(Date.now() / 1000);

  if (!existing) {
    // INSERT
    const id = crypto.randomUUID().replace(/-/g, '');
    const fields = ['id', 'client_id'];
    const values: unknown[] = [id, client.id];
    for (const [k, v] of Object.entries(body)) {
      if (WRITABLE_FIELDS.has(k)) {
        fields.push(k);
        values.push(
          typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? null)
        );
      }
    }
    fields.push('created_at', 'updated_at');
    values.push(now, now);
    await c.env.DB
      .prepare(`INSERT INTO client_intelligence (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
      .bind(...values)
      .run();
  } else {
    // UPDATE
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (WRITABLE_FIELDS.has(k)) {
        sets.push(`${k} = ?`);
        values.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? null));
      }
    }
    if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
    sets.push('updated_at = ?');
    values.push(now, existing.id);
    await c.env.DB
      .prepare(`UPDATE client_intelligence SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
    .bind(client.id)
    .first();
  return c.json({ intelligence: row });
});

/** GET /api/clients/:slug/platform-links */
intelligenceRoutes.get('/:slug/platform-links', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  const row = await c.env.DB
    .prepare('SELECT * FROM client_platform_links WHERE client_id = ?')
    .bind(client.id).first();
  return c.json({ links: row ?? null });
});

/** PUT /api/clients/:slug/platform-links */
intelligenceRoutes.put('/:slug/platform-links', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const allowed = new Set(['facebook','instagram','tiktok','youtube','linkedin','pinterest','x','threads','bluesky','google_business','website']);
  const now = Math.floor(Date.now() / 1000);

  const existing = await c.env.DB
    .prepare('SELECT id FROM client_platform_links WHERE client_id = ?')
    .bind(client.id).first<{ id: string }>();

  if (!existing) {
    const id = crypto.randomUUID().replace(/-/g, '');
    const fields = ['id', 'client_id'];
    const values: unknown[] = [id, client.id];
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k)) { fields.push(k); values.push(v ?? null); }
    }
    fields.push('created_at', 'updated_at');
    values.push(now, now);
    await c.env.DB
      .prepare(`INSERT INTO client_platform_links (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
      .bind(...values).run();
  } else {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k)) { sets.push(`${k} = ?`); values.push(v ?? null); }
    }
    if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
    sets.push('updated_at = ?');
    values.push(now, existing.id);
    await c.env.DB
      .prepare(`UPDATE client_platform_links SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values).run();
  }

  const row = await c.env.DB
    .prepare('SELECT * FROM client_platform_links WHERE client_id = ?')
    .bind(client.id).first();
  return c.json({ links: row });
});

/** GET /api/clients/:slug/feedback */
intelligenceRoutes.get('/:slug/feedback', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_feedback WHERE client_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(client.id)
    .all();
  return c.json({ feedback: rows.results });
});

/** POST /api/clients/:slug/feedback */
intelligenceRoutes.post('/:slug/feedback', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const id = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  const month = (body.month as string) || new Date().toISOString().slice(0, 7);

  await c.env.DB
    .prepare(`INSERT INTO client_feedback (id, client_id, month, post_id, category, sentiment, message, admin_reviewed, applied_to_intelligence, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`)
    .bind(id, client.id, month, body.post_id ?? null, body.category ?? null,
          body.sentiment ?? null, body.message ?? null, now)
    .run();

  const row = await c.env.DB
    .prepare('SELECT * FROM client_feedback WHERE id = ?')
    .bind(id).first();
  return c.json({ feedback: row });
});

/** PATCH /api/clients/:slug/feedback/:id — mark reviewed / applied */
intelligenceRoutes.patch('/:slug/feedback/:feedbackId', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.admin_reviewed !== undefined) { sets.push('admin_reviewed = ?'); vals.push(body.admin_reviewed ? 1 : 0); }
  if (body.applied_to_intelligence !== undefined) { sets.push('applied_to_intelligence = ?'); vals.push(body.applied_to_intelligence ? 1 : 0); }
  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  vals.push(c.req.param('feedbackId') ?? '', client.id);
  await c.env.DB
    .prepare(`UPDATE client_feedback SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`)
    .bind(...vals).run();
  return c.json({ ok: true });
});

/** DELETE /api/clients/:slug/feedback/:id */
intelligenceRoutes.delete('/:slug/feedback/:feedbackId', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_feedback WHERE id = ? AND client_id = ?')
    .bind(c.req.param('feedbackId') ?? '', client.id).run();
  return c.json({ ok: true });
});

/** DELETE /api/clients/:slug/platforms/:platform — remove a platform config */
intelligenceRoutes.delete('/:slug/platforms/:platform', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_platforms WHERE client_id = ? AND platform = ?')
    .bind(client.id, c.req.param('platform') ?? '')
    .run();
  return c.json({ ok: true });
});
