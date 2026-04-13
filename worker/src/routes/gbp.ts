/**
 * GBP (Google Business Profile) utility routes
 *   POST /api/clients/:slug/gbp/generate         — AI offer/event variation generation
 *   POST /api/clients/:slug/gbp/offers/:id/upload — upload image for offer
 *   POST /api/clients/:slug/gbp/events/:id/upload — upload image for event
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { getClientBySlug } from '../db/queries';
import { requirePermission } from '../middleware/auth';
import { generateGbpVariations, type GbpGenerationContext } from '../services/openai';

export const gbpRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ── AI variation generation ───────────────────────────────────────────────────

gbpRoutes.post('/:slug/gbp/generate', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') as string);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  let body: { type?: string } = {};
  try { body = (await c.req.json()) as typeof body; } catch { /* defaults */ }

  const type = body.type === 'event' ? 'event' : 'offer';

  // Get OpenAI key
  const settingsRaw = await c.env.KV_BINDING.get('settings:system').catch(() => null);
  const settings: Record<string, string> = settingsRaw ? JSON.parse(settingsRaw) as Record<string, string> : {};
  const apiKey = c.env.OPENAI_API_KEY || settings['ai_api_key'] || '';
  if (!apiKey) return c.json({ error: 'OpenAI API key not configured' }, 400);

  // Load intelligence
  const intel = await c.env.DB
    .prepare('SELECT * FROM client_intelligence WHERE client_id = ?')
    .bind(client.id)
    .first<Record<string, string | null>>()
    .catch(() => null);

  // Load services list
  const svcRows = await c.env.DB
    .prepare('SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order LIMIT 20')
    .bind(client.id)
    .all<{ name: string }>()
    .catch(() => ({ results: [] as { name: string }[] }));

  // Load area list
  const areaRows = await c.env.DB
    .prepare('SELECT city, state FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order LIMIT 10')
    .bind(client.id)
    .all<{ city: string; state: string | null }>()
    .catch(() => ({ results: [] as { city: string; state: string | null }[] }));

  // Recent titles (anti-repetition)
  const recentTable = type === 'offer' ? 'client_offers' : 'client_events';
  const recentRows = await c.env.DB
    .prepare(`SELECT title FROM ${recentTable} WHERE client_id = ? ORDER BY created_at DESC LIMIT 15`)
    .bind(client.id)
    .all<{ title: string }>()
    .catch(() => ({ results: [] as { title: string }[] }));

  const clientCast = client as typeof client & {
    brand_primary_color?: string | null;
    brand_json?: string | null;
    phone?: string | null;
    cta_text?: string | null;
    industry?: string | null;
    state?: string | null;
  };

  const ctx: GbpGenerationContext = {
    client: {
      canonical_name:       client.canonical_name,
      industry:             clientCast.industry ?? null,
      state:                clientCast.state ?? null,
      phone:                clientCast.phone ?? null,
      cta_text:             clientCast.cta_text ?? null,
      brand_primary_color:  clientCast.brand_primary_color ?? null,
      brand_json:           clientCast.brand_json ?? null,
      notes:                client.notes ?? null,
      language:             client.language ?? null,
    },
    intelligence: intel ? {
      brand_voice:        intel['brand_voice'] ?? null,
      tone_keywords:      intel['tone_keywords'] ?? null,
      prohibited_terms:   intel['prohibited_terms'] ?? null,
      approved_ctas:      intel['approved_ctas'] ?? null,
      service_priorities: intel['service_priorities'] ?? null,
      seasonal_notes:     intel['seasonal_notes'] ?? null,
      audience_notes:     intel['audience_notes'] ?? null,
      humanization_style: intel['humanization_style'] ?? null,
    } : null,
    services:     svcRows.results.map(r => r.name),
    areas:        areaRows.results.map(r => r.state ? `${r.city}, ${r.state}` : r.city),
    recentTitles: recentRows.results.map(r => r.title),
  };

  try {
    const variations = await generateGbpVariations(apiKey, type, ctx);
    return c.json({ variations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `AI generation failed: ${msg}` }, 502);
  }
});

// ── Asset upload for offers ───────────────────────────────────────────────────

gbpRoutes.post('/:slug/gbp/offers/:offerId/upload', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') as string);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const offerId = c.req.param('offerId') as string;

  // Verify offer belongs to client
  const offer = await c.env.DB
    .prepare('SELECT id FROM client_offers WHERE id = ? AND client_id = ?')
    .bind(offerId, client.id)
    .first<{ id: string }>();
  if (!offer) return c.json({ error: 'Offer not found' }, 404);

  let formData: FormData;
  try { formData = await c.req.formData(); }
  catch { return c.json({ error: 'Invalid form data' }, 400); }

  const file = formData.get('file') as File | null;
  if (!file || !file.name) return c.json({ error: 'No file provided' }, 400);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const r2Key = `gbp/offers/${offerId}.${ext}`;
  const bytes = await file.arrayBuffer();

  await c.env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: file.type } });
  await c.env.DB
    .prepare('UPDATE client_offers SET asset_r2_key = ?, asset_r2_bucket = ? WHERE id = ?')
    .bind(r2Key, 'MEDIA', offerId)
    .run();

  const publicUrl = c.env.R2_MEDIA_PUBLIC_URL
    ? `${c.env.R2_MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`
    : null;

  return c.json({ ok: true, r2_key: r2Key, url: publicUrl });
});

// ── Asset upload for events ───────────────────────────────────────────────────

gbpRoutes.post('/:slug/gbp/events/:eventId/upload', requirePermission('clients.edit'), async (c) => {
  const client = await getClientBySlug(c.env.DB, c.req.param('slug') as string);
  if (!client) return c.json({ error: 'Client not found' }, 404);

  const eventId = c.req.param('eventId') as string;

  const event = await c.env.DB
    .prepare('SELECT id FROM client_events WHERE id = ? AND client_id = ?')
    .bind(eventId, client.id)
    .first<{ id: string }>();
  if (!event) return c.json({ error: 'Event not found' }, 404);

  let formData: FormData;
  try { formData = await c.req.formData(); }
  catch { return c.json({ error: 'Invalid form data' }, 400); }

  const file = formData.get('file') as File | null;
  if (!file || !file.name) return c.json({ error: 'No file provided' }, 400);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const r2Key = `gbp/events/${eventId}.${ext}`;
  const bytes = await file.arrayBuffer();

  await c.env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: file.type } });
  await c.env.DB
    .prepare('UPDATE client_events SET asset_r2_key = ?, asset_r2_bucket = ?, updated_at = ? WHERE id = ?')
    .bind(r2Key, 'MEDIA', Math.floor(Date.now() / 1000), eventId)
    .run();

  const publicUrl = c.env.R2_MEDIA_PUBLIC_URL
    ? `${c.env.R2_MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`
    : null;

  return c.json({ ok: true, r2_key: r2Key, url: publicUrl });
});
