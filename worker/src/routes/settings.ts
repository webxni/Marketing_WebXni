/**
 * System settings routes (admin only)
 * Settings stored as KV key `settings:system` (JSON object)
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const SETTINGS_KEY = 'settings:system';

async function loadSettings(env: Env): Promise<Record<string, string>> {
  try {
    const raw = await env.SESSION.get(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** GET /api/settings */
settingsRoutes.get('/', requirePermission('settings.view'), async (c) => {
  const settings = await loadSettings(c.env);
  return c.json({ settings });
});

/** PUT /api/settings */
settingsRoutes.put('/', requirePermission('settings.edit'), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { settings } = body as { settings?: Record<string, string> };
  if (!settings || typeof settings !== 'object') {
    return c.json({ error: 'settings object required' }, 400);
  }

  await c.env.SESSION.put(SETTINGS_KEY, JSON.stringify(settings));
  return c.json({ ok: true });
});
