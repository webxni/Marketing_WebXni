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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveClient(c: any) {
  return getClientBySlug(c.env.DB, c.req.param('slug') as string);
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
  title:            z.string().min(1),
  description:      z.string().optional(),
  cta_text:         z.string().optional(),
  valid_until:      z.string().optional(),
  active:           z.boolean().optional().default(true),
  // GBP fields (migration 0009)
  gbp_coupon_code:  z.string().optional(),
  gbp_redeem_url:   z.string().optional(),
  gbp_terms:        z.string().optional(),
  gbp_cta_type:     z.enum(['BOOK','ORDER','SHOP','LEARN_MORE','SIGN_UP','CALL']).optional(),
  gbp_cta_url:      z.string().url().optional().or(z.literal('')),
  gbp_location_id:  z.string().optional(),
  recurrence:       z.enum(['none','weekly','biweekly','monthly']).optional().default('none'),
  next_run_date:    z.string().optional(),  // YYYY-MM-DD
  paused:           z.boolean().optional(),
  // AI generation (migration 0014)
  ai_image_prompt:  z.string().optional(),
});

serviceRoutes.post('/:slug/offers', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = offerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const d = parsed.data;
  // Validation: gbp_cta_url required if gbp_cta_type is set
  if (d.gbp_cta_type && d.gbp_cta_type !== 'CALL' && !d.gbp_cta_url) {
    return c.json({ error: 'gbp_cta_url is required when gbp_cta_type is set (except CALL)' }, 400);
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(`INSERT INTO client_offers
      (id, client_id, title, description, cta_text, valid_until, active,
       gbp_coupon_code, gbp_redeem_url, gbp_terms, gbp_cta_type, gbp_cta_url,
       gbp_location_id, recurrence, next_run_date, paused, ai_image_prompt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id, client.id, d.title, d.description ?? null, d.cta_text ?? null,
      d.valid_until ?? null, d.active ? 1 : 0,
      d.gbp_coupon_code ?? null, d.gbp_redeem_url ?? null, d.gbp_terms ?? null,
      d.gbp_cta_type ?? null, d.gbp_cta_url ?? null,
      d.gbp_location_id ?? null, d.recurrence ?? 'none',
      d.next_run_date ?? null, d.paused ? 1 : 0,
      d.ai_image_prompt ?? null, now,
    )
    .run();
  return c.json({ offer: { id, client_id: client.id, ...d } }, 201);
});

// Allowed columns for offer update (prevent mass-assignment)
const OFFER_WRITABLE = new Set([
  'title','description','cta_text','valid_until','active',
  'gbp_coupon_code','gbp_redeem_url','gbp_terms','gbp_cta_type','gbp_cta_url',
  'gbp_location_id','recurrence','next_run_date','last_posted_at','paused',
  'ai_image_prompt','asset_r2_key','asset_r2_bucket',
]);

serviceRoutes.put('/:slug/offers/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const entries = Object.entries(body).filter(([k]) => OFFER_WRITABLE.has(k));
  if (entries.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  const sets   = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  await c.env.DB
    .prepare(`UPDATE client_offers SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`)
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

// ─── EVENTS ──────────────────────────────────────────────────────────────────

const eventSchema = z.object({
  title:                z.string().min(1),
  description:          z.string().optional(),
  gbp_event_title:      z.string().optional(),
  gbp_event_start_date: z.string().optional(),   // YYYY-MM-DD
  gbp_event_start_time: z.string().optional(),   // HH:MM
  gbp_event_end_date:   z.string().optional(),   // YYYY-MM-DD
  gbp_event_end_time:   z.string().optional(),   // HH:MM
  gbp_cta_type:         z.enum(['BOOK','ORDER','SHOP','LEARN_MORE','SIGN_UP','CALL']).optional(),
  gbp_cta_url:          z.string().url().optional().or(z.literal('')),
  gbp_location_id:      z.string().optional(),
  recurrence:           z.enum(['once','weekly','biweekly','monthly']).optional().default('once'),
  next_run_date:        z.string().optional(),
  active:               z.boolean().optional().default(true),
  paused:               z.boolean().optional(),
  // AI generation (migration 0014)
  ai_image_prompt:      z.string().optional(),
});

serviceRoutes.get('/:slug/events', requirePermission('clients.view'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_events WHERE client_id = ? ORDER BY active DESC, created_at DESC')
    .bind(client.id).all();
  return c.json({ events: rows.results });
});

serviceRoutes.post('/:slug/events', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const d = parsed.data;
  // Validation: end date must be >= start date
  if (d.gbp_event_start_date && d.gbp_event_end_date && d.gbp_event_end_date < d.gbp_event_start_date) {
    return c.json({ error: 'gbp_event_end_date must be on or after gbp_event_start_date' }, 400);
  }
  if (d.gbp_cta_type && d.gbp_cta_type !== 'CALL' && !d.gbp_cta_url) {
    return c.json({ error: 'gbp_cta_url is required when gbp_cta_type is set (except CALL)' }, 400);
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(`INSERT INTO client_events
      (id, client_id, title, description,
       gbp_event_title, gbp_event_start_date, gbp_event_start_time,
       gbp_event_end_date, gbp_event_end_time,
       gbp_cta_type, gbp_cta_url, gbp_location_id,
       recurrence, next_run_date, active, paused, ai_image_prompt, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id, client.id, d.title, d.description ?? null,
      d.gbp_event_title ?? null, d.gbp_event_start_date ?? null, d.gbp_event_start_time ?? null,
      d.gbp_event_end_date ?? null, d.gbp_event_end_time ?? null,
      d.gbp_cta_type ?? null, d.gbp_cta_url ?? null, d.gbp_location_id ?? null,
      d.recurrence ?? 'once', d.next_run_date ?? null,
      d.active ? 1 : 0, d.paused ? 1 : 0, d.ai_image_prompt ?? null, now, now,
    )
    .run();
  return c.json({ event: { id, client_id: client.id, ...d } }, 201);
});

const EVENT_WRITABLE = new Set([
  'title','description','gbp_event_title',
  'gbp_event_start_date','gbp_event_start_time','gbp_event_end_date','gbp_event_end_time',
  'gbp_cta_type','gbp_cta_url','gbp_location_id',
  'recurrence','next_run_date','last_posted_at','active','paused',
  'ai_image_prompt','asset_r2_key','asset_r2_bucket',
]);

serviceRoutes.put('/:slug/events/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const entries = Object.entries(body).filter(([k]) => EVENT_WRITABLE.has(k));
  if (entries.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  const now = Math.floor(Date.now() / 1000);
  const sets   = [...entries.map(([k]) => `${k} = ?`), 'updated_at = ?'];
  const values = [...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)), now];
  await c.env.DB
    .prepare(`UPDATE client_events SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`)
    .bind(...values, c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});

serviceRoutes.delete('/:slug/events/:id', requirePermission('clients.edit'), async (c) => {
  const client = await resolveClient(c);
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_events WHERE id = ? AND client_id = ?')
    .bind(c.req.param('id'), client.id).run();
  return c.json({ ok: true });
});
