/**
 * Package routes
 * GET    /api/packages
 * POST   /api/packages
 * PUT    /api/packages/:id
 * DELETE /api/packages/:id
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';

export const packageRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const FIELDS = [
  'slug','name','posts_per_month','images_per_month','videos_per_month',
  'reels_per_month','blog_posts_per_month','platforms_included','includes_gbp',
  'includes_blog','includes_bilingual','includes_stories','posting_frequency',
  'posting_days','cadence_notes','price_cents','active','sort_order',
];

/** GET /api/packages */
packageRoutes.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT * FROM packages WHERE active = 1 ORDER BY sort_order, name')
    .all();
  return c.json({ packages: rows.results });
});

/** GET /api/packages/all — includes inactive */
packageRoutes.get('/all', requirePermission('settings.view'), async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT * FROM packages ORDER BY sort_order, name')
    .all();
  return c.json({ packages: rows.results });
});

/** POST /api/packages */
packageRoutes.post('/', requirePermission('settings.view'), async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!body['name'] || !body['slug']) return c.json({ error: 'name and slug required' }, 400);

  const existing = await c.env.DB
    .prepare('SELECT id FROM packages WHERE slug = ?')
    .bind(body['slug']).first();
  if (existing) return c.json({ error: 'slug already exists' }, 409);

  const id = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  const cols = ['id', ...FIELDS.filter(f => body[f] !== undefined), 'created_at', 'updated_at'];
  const vals = [id, ...FIELDS.filter(f => body[f] !== undefined).map(f => {
    const v = body[f];
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? null);
  }), now, now];

  await c.env.DB
    .prepare(`INSERT INTO packages (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .bind(...vals).run();

  const pkg = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(id).first();
  return c.json({ package: pkg }, 201);
});

/** PUT /api/packages/:id */
packageRoutes.put('/:id', requirePermission('settings.view'), async (c) => {
  const pkg = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(c.req.param('id')).first();
  if (!pkg) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const now = Math.floor(Date.now() / 1000);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of FIELDS) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(typeof body[f] === 'object' && body[f] !== null ? JSON.stringify(body[f]) : (body[f] ?? null));
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push('updated_at = ?');
  vals.push(now, c.req.param('id'));

  await c.env.DB
    .prepare(`UPDATE packages SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals).run();

  const updated = await c.env.DB.prepare('SELECT * FROM packages WHERE id = ?').bind(c.req.param('id')).first();
  return c.json({ package: updated });
});

/** DELETE /api/packages/:id */
packageRoutes.delete('/:id', requirePermission('settings.view'), async (c) => {
  await c.env.DB.prepare('DELETE FROM packages WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
