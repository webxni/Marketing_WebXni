/**
 * WordPress integration routes — per-client credential management
 *
 * All routes are mounted under /api/clients (in index.ts as :slug sub-routes)
 *   GET  /api/clients/:slug/wordpress/status       — check if configured
 *   POST /api/clients/:slug/wordpress/test         — test live connection
 *   GET  /api/clients/:slug/wordpress/categories   — pull WP categories
 *   GET  /api/clients/:slug/wordpress/authors      — pull WP authors
 *   GET  /api/clients/:slug/wordpress/templates    — list stored WP templates
 *   POST /api/clients/:slug/wordpress/templates    — create/upsert a template
 *   GET  /api/clients/:slug/wordpress/templates/:key — get one template
 *   DELETE /api/clients/:slug/wordpress/templates/:key — delete template
 */

import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { getClientBySlug } from '../db/queries';
import { buildWordPressClient } from '../services/wordpress';

export const wordpressRoutes = new Hono<{
  Bindings: Env;
  Variables: { user: SessionData };
}>();

// ─── Status ───────────────────────────────────────────────────────────────────

wordpressRoutes.get('/:slug/wordpress/status', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const configured =
    !!(client.wp_base_url || client.wp_url) &&
    !!(client.wp_username || client.wp_auth);

  return c.json({
    configured,
    base_url:       client.wp_base_url ?? client.wp_url ?? null,
    username:       client.wp_username ?? null,
    template_key:   client.wp_template_key ?? client.wp_template ?? null,
    default_status: client.wp_default_post_status ?? 'draft',
  });
});

// ─── Test connection ──────────────────────────────────────────────────────────

wordpressRoutes.post('/:slug/wordpress/test', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const wp = buildWordPressClient(client);
  if (!wp) {
    return c.json({ ok: false, error: 'WordPress not configured for this client. Set wp_base_url, wp_username, and wp_application_password.' }, 400);
  }

  try {
    const user = await wp.testConnection();
    return c.json({ ok: true, user });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg });
  }
});

// ─── Pull categories ──────────────────────────────────────────────────────────

wordpressRoutes.get('/:slug/wordpress/categories', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const wp = buildWordPressClient(client);
  if (!wp) return c.json({ error: 'WordPress not configured' }, 400);

  try {
    const categories = await wp.getCategories();
    return c.json({ categories });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ─── Pull authors ─────────────────────────────────────────────────────────────

wordpressRoutes.get('/:slug/wordpress/authors', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const wp = buildWordPressClient(client);
  if (!wp) return c.json({ error: 'WordPress not configured' }, 400);

  try {
    const authors = await wp.getAuthors();
    return c.json({ authors });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// ─── Templates ────────────────────────────────────────────────────────────────

wordpressRoutes.get('/:slug/wordpress/templates', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  // Return templates for this client + global templates
  const templates = await c.env.DB
    .prepare(
      `SELECT id, client_id, template_key, name, description, is_default, created_at
       FROM wp_templates
       WHERE client_id = ? OR client_id IS NULL
       ORDER BY is_default DESC, name ASC`,
    )
    .bind(client.id)
    .all();

  return c.json({ templates: templates.results });
});

wordpressRoutes.get('/:slug/wordpress/templates/:key', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const tpl = await c.env.DB
    .prepare(
      `SELECT * FROM wp_templates
       WHERE template_key = ? AND (client_id = ? OR client_id IS NULL)
       ORDER BY client_id IS NOT NULL DESC LIMIT 1`,
    )
    .bind(c.req.param('key'), client.id)
    .first();

  if (!tpl) return c.json({ error: 'Template not found' }, 404);
  return c.json({ template: tpl });
});

wordpressRoutes.post('/:slug/wordpress/templates', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { template_key, name, html_template, css, description, is_default } = body;
  if (!template_key || !name || !html_template) {
    return c.json({ error: 'template_key, name, and html_template are required' }, 400);
  }

  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // If is_default, clear other defaults for this client first
  if (is_default) {
    await c.env.DB
      .prepare('UPDATE wp_templates SET is_default = 0 WHERE client_id = ?')
      .bind(client.id)
      .run();
  }

  await c.env.DB
    .prepare(
      `INSERT INTO wp_templates
         (id, client_id, template_key, name, html_template, css, description, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, template_key) DO UPDATE SET
         name          = excluded.name,
         html_template = excluded.html_template,
         css           = excluded.css,
         description   = excluded.description,
         is_default    = excluded.is_default,
         updated_at    = excluded.updated_at`,
    )
    .bind(
      id, client.id, template_key, name, html_template,
      css ?? null, description ?? null, is_default ? 1 : 0, now, now,
    )
    .run();

  const tpl = await c.env.DB
    .prepare('SELECT * FROM wp_templates WHERE client_id = ? AND template_key = ?')
    .bind(client.id, template_key)
    .first();

  return c.json({ template: tpl }, 201);
});

wordpressRoutes.delete('/:slug/wordpress/templates/:key', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Client not found' }, 404);

  await c.env.DB
    .prepare('DELETE FROM wp_templates WHERE client_id = ? AND template_key = ?')
    .bind(client.id, c.req.param('key'))
    .run();

  return c.json({ ok: true });
});
