/**
 * Client routes — CRUD + platform management
 * GET    /api/clients
 * POST   /api/clients
 * GET    /api/clients/:slug
 * PUT    /api/clients/:slug
 * GET    /api/clients/:slug/platforms
 * POST   /api/clients/:slug/platforms/:platform/pause
 * POST   /api/clients/:slug/platforms/:platform/unpause
 * PUT    /api/clients/:slug/platforms/:platform  — upsert platform config
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listClients,
  getClientBySlug,
  getClientPlatforms,
  getClientGbpLocations,
  getClientRestrictions,
  writeAuditLog,
} from '../db/queries';

export const clientRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// Allowed fields for client create/update — explicit allowlist prevents mass-assignment
const CLIENT_WRITABLE_FIELDS = new Set([
  'canonical_name', 'package', 'status', 'language', 'manual_only',
  'requires_approval_from', 'owner_group', 'never_mix_with',
  'upload_post_profile', 'notes', 'brand_json',
  // WordPress legacy
  'wp_domain', 'wp_url', 'wp_auth', 'wp_template',
  // WordPress — new fields (migration 0004)
  'wp_admin_url', 'wp_base_url', 'wp_rest_base',
  'wp_username', 'wp_application_password',
  'wp_default_post_status', 'wp_default_author_id', 'wp_default_category_ids',
  'wp_template_key', 'wp_featured_image_mode', 'wp_excerpt_mode',
  // Notion
  'notion_page_id',
  // Logo + brand colors (migration 0005)
  'logo_r2_key', 'logo_url', 'brand_primary_color', 'brand_accent_color',
  // Contact + identity (migration 0006)
  'phone', 'email', 'owner_name', 'cta_text', 'cta_label', 'industry', 'state',
]);

/** GET /api/clients */
clientRoutes.get('/', async (c) => {
  const status = (c.req.query('status') as 'active' | 'inactive' | 'all') ?? 'active';
  const clients = await listClients(c.env.DB, status);
  return c.json({ clients });
});

/** POST /api/clients — create a new client */
clientRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin' && user.role !== 'manager') {
    return c.json({ error: 'Forbidden — only admin/manager can create clients' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const name = String(body.canonical_name ?? '').trim();
  const slug = String(body.slug ?? '').trim();
  if (!name) return c.json({ error: 'canonical_name is required' }, 400);
  if (!slug)  return c.json({ error: 'slug is required' }, 400);
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ error: 'slug must be lowercase alphanumeric with hyphens only' }, 400);
  }

  const existing = await getClientBySlug(c.env.DB, slug);
  if (existing) return c.json({ error: `slug '${slug}' is already in use` }, 409);

  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  // Build column list from allowed writable fields present in body
  const extraFields: string[] = [];
  const extraValues: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (k === 'canonical_name' || k === 'slug') continue; // already handled
    if (CLIENT_WRITABLE_FIELDS.has(k)) {
      extraFields.push(k);
      extraValues.push(v ?? null);
    }
  }

  const colNames = ['id', 'slug', 'canonical_name', ...extraFields, 'created_at', 'updated_at'].join(', ');
  const placeholders = new Array(5 + extraFields.length).fill('?').join(', ');

  await c.env.DB
    .prepare(`INSERT INTO clients (${colNames}) VALUES (${placeholders})`)
    .bind(id, slug, name, ...extraValues, now, now)
    .run();

  const client = await getClientBySlug(c.env.DB, slug);
  await writeAuditLog(c.env.DB, {
    user_id: user.userId,
    action: 'client.create',
    entity_type: 'client',
    entity_id: id,
    new_value: { slug, canonical_name: name },
  });

  return c.json({ client }, 201);
});

/** GET /api/clients/:slug */
clientRoutes.get('/:slug', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  const [platforms, gbp_locations, restrictions] = await Promise.all([
    getClientPlatforms(c.env.DB, client.id),
    getClientGbpLocations(c.env.DB, client.id),
    getClientRestrictions(c.env.DB, client.id),
  ]);
  return c.json({ client: { ...client, platforms, gbp_locations, restrictions } });
});

/** PUT /api/clients/:slug — update a client */
clientRoutes.put('/:slug', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Build SET clause from allowed fields only
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [k, v] of Object.entries(body)) {
    if (!CLIENT_WRITABLE_FIELDS.has(k)) continue;
    setClauses.push(`${k} = ?`);
    values.push(v ?? null);
  }

  if (setClauses.length === 0) return c.json({ error: 'No valid fields to update' }, 400);

  setClauses.push('updated_at = ?');
  values.push(Math.floor(Date.now() / 1000));
  values.push(client.id);

  await c.env.DB
    .prepare(`UPDATE clients SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const updated = await getClientBySlug(c.env.DB, c.req.param('slug'));
  await writeAuditLog(c.env.DB, {
    user_id: c.get('user').userId,
    action: 'client.update',
    entity_type: 'client',
    entity_id: client.id,
    new_value: body,
  });

  return c.json({ client: updated });
});

/** GET /api/clients/:slug/platforms */
clientRoutes.get('/:slug/platforms', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  const platforms = await getClientPlatforms(c.env.DB, client.id);
  return c.json({ platforms });
});

/** PUT /api/clients/:slug/platforms/:platform — upsert a platform config */
clientRoutes.put('/:slug/platforms/:platform', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const platform = c.req.param('platform');
  const allowed = new Set([
    'account_id', 'username', 'page_id',
    'upload_post_board_id', 'upload_post_location_id',
    'privacy_level', 'privacy_status', 'notes',
    // migration 0005
    'profile_url', 'profile_username', 'connection_status',
    'yt_channel_id', 'linkedin_urn',
  ]);

  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.has(k)) continue;
    setClauses.push(`${k} = ?`);
    values.push(v ?? null);
  }

  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();

  if (setClauses.length > 0) {
    // Try UPDATE first, then INSERT if not exists
    const result = await c.env.DB
      .prepare(`UPDATE client_platforms SET ${setClauses.join(', ')} WHERE client_id = ? AND platform = ?`)
      .bind(...values, client.id, platform)
      .run();

    if (!result.meta?.changes || result.meta.changes === 0) {
      // Row doesn't exist — INSERT
      const fieldNames = ['id', 'client_id', 'platform', ...Array.from(allowed).filter(f => body[f] !== undefined)];
      const fieldVals = [id, client.id, platform, ...Array.from(allowed).filter(f => body[f] !== undefined).map(f => body[f] ?? null)];
      await c.env.DB
        .prepare(`INSERT INTO client_platforms (${fieldNames.join(', ')}) VALUES (${fieldNames.map(() => '?').join(', ')})`)
        .bind(...fieldVals)
        .run();
    }
  }

  const platforms = await getClientPlatforms(c.env.DB, client.id);
  const updated = platforms.find(p => p.platform === platform);
  return c.json({ platform: updated ?? null });
});

/** POST /api/clients/:slug/platforms/:platform/pause */
clientRoutes.post('/:slug/platforms/:platform/pause', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  let reason = '';
  try { reason = ((await c.req.json()) as { reason?: string }).reason ?? ''; } catch { /* empty */ }
  await c.env.DB
    .prepare(
      "UPDATE client_platforms SET paused = 1, paused_reason = ?, paused_since = date('now') WHERE client_id = ? AND platform = ?",
    )
    .bind(reason || 'Manually paused', client.id, c.req.param('platform'))
    .run();
  return c.json({ ok: true });
});

/** POST /api/clients/:slug/platforms/:platform/unpause */
clientRoutes.post('/:slug/platforms/:platform/unpause', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare(
      'UPDATE client_platforms SET paused = 0, paused_reason = NULL, paused_since = NULL WHERE client_id = ? AND platform = ?',
    )
    .bind(client.id, c.req.param('platform'))
    .run();
  return c.json({ ok: true });
});
