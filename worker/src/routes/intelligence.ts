/**
 * Client intelligence routes
 * GET /api/clients/:slug/intelligence
 * PUT /api/clients/:slug/intelligence
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  createClientMonthlyTopic,
  deleteClientMonthlyTopic,
  getClientBySlug,
  listClientMonthlyTopics,
  updateClientMonthlyTopic,
} from '../db/queries';
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

/** GET /api/clients/:slug/monthly-topics?month=YYYY-MM&status=planned|used|skipped|all */
intelligenceRoutes.get('/:slug/monthly-topics', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  const month = String(c.req.query('month') ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month=YYYY-MM is required' }, 400);
  const statusRaw = String(c.req.query('status') ?? 'all');
  const status = new Set(['planned', 'used', 'skipped', 'all']).has(statusRaw) ? statusRaw as 'planned' | 'used' | 'skipped' | 'all' : 'all';

  const topics = await listClientMonthlyTopics(c.env.DB, client.id, month, status);
  return c.json({ topics });
});

/** POST /api/clients/:slug/monthly-topics */
intelligenceRoutes.post('/:slug/monthly-topics', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const planMonth = String(body.plan_month ?? '').trim();
  const topicTitle = String(body.topic_title ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(planMonth)) return c.json({ error: 'plan_month must be YYYY-MM' }, 400);
  if (!topicTitle) return c.json({ error: 'topic_title is required' }, 400);

  const preferredPlatforms = Array.isArray(body.preferred_platforms)
    ? JSON.stringify((body.preferred_platforms as string[]).filter(Boolean))
    : typeof body.preferred_platforms === 'string'
      ? body.preferred_platforms
      : null;

  const topic = await createClientMonthlyTopic(c.env.DB, {
    id: crypto.randomUUID().replace(/-/g, '').toLowerCase(),
    client_id: client.id,
    plan_month: planMonth,
    topic_title: topicTitle,
    service_category: typeof body.service_category === 'string' ? body.service_category : null,
    target_keyword: typeof body.target_keyword === 'string' ? body.target_keyword : null,
    content_type_preference: typeof body.content_type_preference === 'string' ? body.content_type_preference : null,
    preferred_platforms: preferredPlatforms,
    priority: typeof body.priority === 'number' ? body.priority : 0,
    status: typeof body.status === 'string' ? body.status : 'planned',
    notes: typeof body.notes === 'string' ? body.notes : null,
    used_post_id: null,
    created_by: c.get('user').userId,
  });

  return c.json({ topic }, 201);
});

/** POST /api/clients/:slug/monthly-topics/bulk */
intelligenceRoutes.post('/:slug/monthly-topics/bulk', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const planMonth = String(body.plan_month ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(planMonth)) return c.json({ error: 'plan_month must be YYYY-MM' }, 400);

  const linesRaw = typeof body.topics_text === 'string' ? body.topics_text : '';
  const defaultContentType = typeof body.content_type_preference === 'string' ? body.content_type_preference : null;
  const defaultPriority = typeof body.priority === 'number' ? body.priority : 0;
  const preferredPlatforms = Array.isArray(body.preferred_platforms)
    ? JSON.stringify((body.preferred_platforms as string[]).filter(Boolean))
    : null;

  const lines = linesRaw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•\d.\s]+/, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return c.json({ error: 'topics_text is required' }, 400);

  let inserted = 0;
  for (const line of lines) {
    await createClientMonthlyTopic(c.env.DB, {
      id: crypto.randomUUID().replace(/-/g, '').toLowerCase(),
      client_id: client.id,
      plan_month: planMonth,
      topic_title: line,
      service_category: null,
      target_keyword: null,
      content_type_preference: defaultContentType,
      preferred_platforms: preferredPlatforms,
      priority: defaultPriority,
      status: 'planned',
      notes: null,
      used_post_id: null,
      created_by: c.get('user').userId,
    });
    inserted++;
  }

  return c.json({ inserted }, 201);
});

/** POST /api/clients/:slug/monthly-topics/suggest */
intelligenceRoutes.post('/:slug/monthly-topics/suggest', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  if (!c.env.OPENAI_API_KEY) return c.json({ error: 'OPENAI_API_KEY not configured' }, 503);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const planMonth = String(body.plan_month ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(planMonth)) return c.json({ error: 'plan_month must be YYYY-MM' }, 400);
  const count = typeof body.count === 'number' ? Math.max(3, Math.min(15, Math.floor(body.count))) : 8;

  const [intelligence, services, areas] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first(),
    c.env.DB.prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order ASC LIMIT 15').bind(client.id).all<{ name: string }>(),
    c.env.DB.prepare('SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order ASC LIMIT 10').bind(client.id).all<{ city: string }>(),
  ]);

  const prompt = `Suggest ${count} monthly content topics for ${client.canonical_name} for ${planMonth}.
Return JSON only in this shape:
{"suggestions":[{"topic_title":"...","service_category":"...","target_keyword":"...","content_type_preference":"image|reel|video|blog","notes":"..."}]}

Client language: ${client.language ?? 'en'}
Industry: ${client.industry ?? ''}
State: ${client.state ?? ''}
Services: ${services.results.map((item) => item.name).join(', ')}
Service areas: ${areas.results.map((item) => item.city).join(', ')}
Brand voice: ${String((intelligence as Record<string, unknown> | null)?.['brand_voice'] ?? '')}
Service priorities: ${String((intelligence as Record<string, unknown> | null)?.['service_priorities'] ?? '')}
Content goals: ${String((intelligence as Record<string, unknown> | null)?.['content_goals'] ?? '')}
Content angles: ${String((intelligence as Record<string, unknown> | null)?.['content_angles'] ?? '')}
Local SEO themes: ${String((intelligence as Record<string, unknown> | null)?.['local_seo_themes'] ?? '')}

Requirements:
- Avoid generic duplicate themes
- Prefer locally relevant topics
- Make the set varied across services and content types
- Keep notes concise`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${c.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate monthly content plan ideas. Respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1800,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    return c.json({ error: `OpenAI ${res.status}: ${errorText.slice(0, 300)}` }, 502);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const parsed = raw ? JSON.parse(raw) as { suggestions?: Array<Record<string, unknown>> } : { suggestions: [] };
  const suggestions = (parsed.suggestions ?? []).map((item) => ({
    id: crypto.randomUUID().replace(/-/g, '').toLowerCase(),
    client_id: client.id,
    plan_month: planMonth,
    topic_title: String(item.topic_title ?? '').trim(),
    service_category: typeof item.service_category === 'string' ? item.service_category : null,
    target_keyword: typeof item.target_keyword === 'string' ? item.target_keyword : null,
    content_type_preference: typeof item.content_type_preference === 'string' ? item.content_type_preference : null,
    preferred_platforms: null,
    priority: 0,
    status: 'planned',
    notes: typeof item.notes === 'string' ? item.notes : null,
    used_post_id: null,
    created_by: c.get('user').userId,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    used_at: null,
  })).filter((item) => item.topic_title);

  return c.json({ suggestions });
});

/** PUT /api/clients/:slug/monthly-topics/:topicId */
intelligenceRoutes.put('/:slug/monthly-topics/:topicId', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const update: Record<string, unknown> = {};
  if (typeof body.plan_month === 'string') update['plan_month'] = body.plan_month.trim();
  if (typeof body.topic_title === 'string') update['topic_title'] = body.topic_title.trim();
  if (typeof body.service_category === 'string' || body.service_category === null) update['service_category'] = body.service_category;
  if (typeof body.target_keyword === 'string' || body.target_keyword === null) update['target_keyword'] = body.target_keyword;
  if (typeof body.content_type_preference === 'string' || body.content_type_preference === null) update['content_type_preference'] = body.content_type_preference;
  if (typeof body.priority === 'number') update['priority'] = body.priority;
  if (typeof body.status === 'string') update['status'] = body.status;
  if (typeof body.notes === 'string' || body.notes === null) update['notes'] = body.notes;
  if (Array.isArray(body.preferred_platforms)) update['preferred_platforms'] = JSON.stringify((body.preferred_platforms as string[]).filter(Boolean));
  if (body.preferred_platforms === null) update['preferred_platforms'] = null;

  await updateClientMonthlyTopic(c.env.DB, c.req.param('topicId') ?? '', update);
  const row = await c.env.DB
    .prepare('SELECT * FROM client_monthly_topics WHERE id = ? AND client_id = ?')
    .bind(c.req.param('topicId') ?? '', client.id)
    .first();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ topic: row });
});

/** DELETE /api/clients/:slug/monthly-topics/:topicId */
intelligenceRoutes.delete('/:slug/monthly-topics/:topicId', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  await deleteClientMonthlyTopic(c.env.DB, c.req.param('topicId') ?? '', client.id);
  return c.json({ ok: true });
});

// ─── Categories ───────────────────────────────────────────────────────────────

/** GET /api/clients/:slug/categories */
intelligenceRoutes.get('/:slug/categories', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_categories WHERE client_id = ? ORDER BY sort_order, name')
    .bind(client.id).all();
  return c.json({ categories: rows.results });
});

/** POST /api/clients/:slug/categories */
intelligenceRoutes.post('/:slug/categories', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'name is required' }, 400);
  const id  = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('INSERT INTO client_categories (id, client_id, name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, client.id, name, body.sort_order ?? 0, now, now).run();
  const row = await c.env.DB.prepare('SELECT * FROM client_categories WHERE id = ?').bind(id).first();
  return c.json({ category: row }, 201);
});

// ─── Services ─────────────────────────────────────────────────────────────────

/** GET /api/clients/:slug/services */
intelligenceRoutes.get('/:slug/services', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare(`SELECT s.*, cat.name as category_name
              FROM client_services s
              LEFT JOIN client_categories cat ON s.category_id = cat.id
              WHERE s.client_id = ?
              ORDER BY s.sort_order, s.name`)
    .bind(client.id).all();
  return c.json({ services: rows.results });
});

/** POST /api/clients/:slug/services */
intelligenceRoutes.post('/:slug/services', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'name is required' }, 400);
  const id  = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('INSERT INTO client_services (id, client_id, category_id, name, description, active, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?)')
    .bind(id, client.id, body.category_id ?? null, name, body.description ?? null, body.sort_order ?? 0, now, now).run();
  const row = await c.env.DB.prepare('SELECT * FROM client_services WHERE id = ?').bind(id).first();
  return c.json({ service: row }, 201);
});

/** DELETE /api/clients/:slug/services/:id */
intelligenceRoutes.delete('/:slug/services/:serviceId', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_services WHERE id = ? AND client_id = ?')
    .bind(c.req.param('serviceId') ?? '', client.id).run();
  return c.json({ ok: true });
});

// ─── Service Areas ────────────────────────────────────────────────────────────

/** GET /api/clients/:slug/areas */
intelligenceRoutes.get('/:slug/areas', requirePermission('clients.view'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  const rows = await c.env.DB
    .prepare('SELECT * FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order, city')
    .bind(client.id).all();
  return c.json({ areas: rows.results });
});

/** POST /api/clients/:slug/areas */
intelligenceRoutes.post('/:slug/areas', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const city = String(body.city ?? '').trim();
  if (!city) return c.json({ error: 'city is required' }, 400);
  const id  = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('INSERT INTO client_service_areas (id, client_id, city, state, zip, primary_area, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, client.id, city, body.state ?? null, body.zip ?? null, body.primary_area ? 1 : 0, body.sort_order ?? 0, now).run();
  const row = await c.env.DB.prepare('SELECT * FROM client_service_areas WHERE id = ?').bind(id).first();
  return c.json({ area: row }, 201);
});

/** DELETE /api/clients/:slug/areas/:id */
intelligenceRoutes.delete('/:slug/areas/:areaId', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') ?? '');
  if (!client) return c.json({ error: 'Not found' }, 404);
  await c.env.DB
    .prepare('DELETE FROM client_service_areas WHERE id = ? AND client_id = ?')
    .bind(c.req.param('areaId') ?? '', client.id).run();
  return c.json({ ok: true });
});
