/**
 * Client business profile routes (services, areas, categories, offers)
 *
 * GET/POST /api/clients/:slug/categories
 * DELETE   /api/clients/:slug/categories/:id
 *
 * GET/POST /api/clients/:slug/services
 * DELETE   /api/clients/:slug/services/:id
 *
 * GET/POST /api/clients/:slug/areas
 * DELETE   /api/clients/:slug/areas/:id
 *
 * GET/POST /api/clients/:slug/offers
 * PUT      /api/clients/:slug/offers/:id
 * DELETE   /api/clients/:slug/offers/:id
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';
import { getClientBySlug } from '../db/queries';

export const serviceRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ─── helpers ─────────────────────────────────────────────────────────────────
async function resolveClient(c: { env: { DB: D1Database }; req: { param: (k: string) => string } }) {
  return getClientBySlug(c.env.DB, c.req.param('slug'));
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
serviceRoutes.get('/:slug/categories', requirePermission('clients.view'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_categories WHERE client_id = ? ORDER BY sort_order, name')
    .bind(client.id).all();
  return c.json({ categories: rows.results });
});

serviceRoutes.post('/:slug/categories', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const schema = z.object({ name: z.string().min(1), sort_order: z.number().int().optional().default(0) });
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB
    .prepare('INSERT INTO client_categories (id, client_id, name, sort_order) VALUES (?, ?, ?, ?)')
    .bind(id, client.id, parsed.data.name, parsed.data.sort_order)
    .run();
  return c.json({ category: { id, client_id: client.id, ...parsed.data } }, 201);
});

serviceRoutes.delete('/:slug/categories/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_categories WHERE id = ? AND client_id = ?')
    .bind(c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});

// ─── SERVICES ────────────────────────────────────────────────────────────────
serviceRoutes.get('/:slug/services', requirePermission('clients.view'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare(`
      SELECT s.*, c.name as category_name
      FROM client_services s
      LEFT JOIN client_categories c ON c.id = s.category_id
      WHERE s.client_id = ?
      ORDER BY s.sort_order, s.name
    `)
    .bind(client.id).all();
  return c.json({ services: rows.results });
});

serviceRoutes.post('/:slug/services', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const schema = z.object({
    name:        z.string().min(1),
    description: z.string().optional(),
    category_id: z.string().optional(),
    sort_order:  z.number().int().optional().default(0),
  });
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB
    .prepare('INSERT INTO client_services (id, client_id, category_id, name, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, client.id, parsed.data.category_id ?? null, parsed.data.name, parsed.data.description ?? null, parsed.data.sort_order)
    .run();
  return c.json({ service: { id, client_id: client.id, ...parsed.data } }, 201);
});

serviceRoutes.delete('/:slug/services/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_services WHERE id = ? AND client_id = ?')
    .bind(c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});

// ─── SERVICE AREAS ───────────────────────────────────────────────────────────
serviceRoutes.get('/:slug/areas', requirePermission('clients.view'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order, city')
    .bind(client.id).all();
  return c.json({ areas: rows.results });
});

serviceRoutes.post('/:slug/areas', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const schema = z.object({
    city:         z.string().min(1),
    state:        z.string().optional(),
    zip:          z.string().optional(),
    radius_mi:    z.number().int().optional(),
    primary_area: z.boolean().optional().default(false),
    sort_order:   z.number().int().optional().default(0),
  });
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB
    .prepare('INSERT INTO client_service_areas (id, client_id, city, state, zip, radius_mi, primary_area, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, client.id, parsed.data.city, parsed.data.state ?? null, parsed.data.zip ?? null,
      parsed.data.radius_mi ?? null, parsed.data.primary_area ? 1 : 0, parsed.data.sort_order)
    .run();
  return c.json({ area: { id, client_id: client.id, ...parsed.data } }, 201);
});

serviceRoutes.delete('/:slug/areas/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_service_areas WHERE id = ? AND client_id = ?')
    .bind(c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});

// ─── OFFERS ──────────────────────────────────────────────────────────────────
serviceRoutes.get('/:slug/offers', requirePermission('clients.view'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_offers WHERE client_id = ? ORDER BY active DESC, created_at DESC')
    .bind(client.id).all();
  return c.json({ offers: rows.results });
});

const offerSchema = z.object({
  title:       z.string().min(1),
  description: z.string().optional(),
  cta_text:    z.string().optional(),
  valid_until: z.string().optional(),
  active:      z.boolean().optional().default(true),
});

serviceRoutes.post('/:slug/offers', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = offerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('INSERT INTO client_offers (id, client_id, title, description, cta_text, valid_until, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, client.id, parsed.data.title, parsed.data.description ?? null, parsed.data.cta_text ?? null,
      parsed.data.valid_until ?? null, parsed.data.active ? 1 : 0, now)
    .run();
  return c.json({ offer: { id, client_id: client.id, ...parsed.data } }, 201);
});

serviceRoutes.put('/:slug/offers/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = offerSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const updates = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k} = ?`);
  const values = Object.entries(parsed.data)
    .filter(([, v]) => v !== undefined)
    .map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  await c.env.DB
    .prepare(`UPDATE client_offers SET ${updates.join(', ')} WHERE id = ? AND client_id = ?`)
    .bind(...values, c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});

serviceRoutes.delete('/:slug/offers/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_offers WHERE id = ? AND client_id = ?')
    .bind(c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});
