/**
 * Client routes — CRUD + platform management
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listClients,
  getClientBySlug,
  getClientPlatforms,
  getClientGbpLocations,
  getClientRestrictions,
} from '../db/queries';

export const clientRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

/** GET /api/clients */
clientRoutes.get('/', async (c) => {
  const status = (c.req.query('status') as 'active' | 'inactive' | 'all') ?? 'active';
  const clients = await listClients(c.env.DB, status);
  return c.json({ clients });
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

/** GET /api/clients/:slug/platforms */
clientRoutes.get('/:slug/platforms', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  const platforms = await getClientPlatforms(c.env.DB, client.id);
  return c.json({ platforms });
});

/** PUT /api/clients/:slug/platforms/:platform/pause */
clientRoutes.post('/:slug/platforms/:platform/pause', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  let reason = '';
  try { reason = ((await c.req.json()) as { reason?: string }).reason ?? ''; } catch { /* empty */ }
  await c.env.DB
    .prepare("UPDATE client_platforms SET paused = 1, paused_reason = ? WHERE client_id = ? AND platform = ?")
    .bind(reason || 'Manually paused', client.id, c.req.param('platform'))
    .run();
  return c.json({ ok: true });
});

/** POST /api/clients/:slug/platforms/:platform/unpause */
clientRoutes.post('/:slug/platforms/:platform/unpause', async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug'));
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare("UPDATE client_platforms SET paused = 0, paused_reason = NULL WHERE client_id = ? AND platform = ?")
    .bind(client.id, c.req.param('platform'))
    .run();
  return c.json({ ok: true });
});
