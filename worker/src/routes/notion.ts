/**
 * Notion import/export routes
 *
 * POST /api/notion/import/clients       — shallow client import (legacy)
 * POST /api/notion/import/clients/full  — full import: populates all 8 client tabs from Notion
 * POST /api/notion/import/posts         — pull posts from a Notion content database
 * POST /api/notion/export/post/:id      — write posting status back to Notion
 * GET  /api/notion/sync-log             — recent sync history
 */

import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  NotionClient,
  getText,
  getDate,
  getChecked,
  getMultiSelect,
  mergeField,
  slugFromName,
  notionStatus,
  notionUrl,
} from '../services/notion';
import { getPostById } from '../db/queries';

export const notionRoutes = new Hono<{
  Bindings: Env;
  Variables: { user: SessionData };
}>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getToken(env: Env): string {
  const t = (env as unknown as Record<string, unknown>).NOTION_API_TOKEN as string | undefined;
  if (!t) throw new Error('NOTION_API_TOKEN secret not set. Run: wrangler secret put NOTION_API_TOKEN');
  return t;
}

async function logSync(
  db: D1Database,
  entry: {
    direction: 'import' | 'export';
    entity_type: 'client' | 'post';
    entity_id?: string;
    notion_page_id?: string;
    status: 'success' | 'skipped' | 'error';
    details?: string;
  },
): Promise<void> {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  await db
    .prepare(
      `INSERT INTO notion_sync_log
         (id, direction, entity_type, entity_id, notion_page_id, status, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    )
    .bind(
      id,
      entry.direction,
      entry.entity_type,
      entry.entity_id ?? null,
      entry.notion_page_id ?? null,
      entry.status,
      entry.details ?? null,
    )
    .run();
}

// ─── Import clients ───────────────────────────────────────────────────────────

/**
 * POST /api/notion/import/clients
 * Body:
 * {
 *   database_id: string,           // Notion DB ID
 *   prop_map: {                    // Map Notion column names → field roles
 *     name:                 string,  // client business name
 *     slug?:                string,
 *     upload_post_profile?: string,
 *     wp_domain?:           string,
 *     wp_username?:         string,
 *     wp_application_password?: string,
 *     status?:              string,
 *     notes?:               string,
 *   }
 * }
 */
notionRoutes.post('/import/clients', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { database_id, prop_map } = body as {
    database_id: string;
    prop_map: Record<string, string>;
  };

  if (!database_id) return c.json({ error: 'database_id is required' }, 400);
  if (!prop_map?.name) return c.json({ error: 'prop_map.name is required' }, 400);

  let notion: NotionClient;
  try { notion = new NotionClient(getToken(c.env)); }
  catch (e) { return c.json({ error: String(e) }, 500); }

  const pages = await notion.queryDatabase(database_id);
  const results: { notion_id: string; action: string; slug: string; error?: string }[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const page of pages) {
    const props = page.properties;
    const name = getText(props[prop_map.name]);
    if (!name) continue;

    const slug =
      prop_map.slug ? getText(props[prop_map.slug]) || slugFromName(name) : slugFromName(name);

    try {
      // Find existing client by notion_page_id first, then by slug
      let existing = await c.env.DB
        .prepare('SELECT * FROM clients WHERE notion_page_id = ?')
        .bind(page.id)
        .first<Record<string, unknown>>();

      if (!existing) {
        existing = await c.env.DB
          .prepare('SELECT * FROM clients WHERE slug = ?')
          .bind(slug)
          .first<Record<string, unknown>>();
      }

      // Build update fields — never overwrite non-empty local values with empty Notion values
      const upPost = mergeField(
        existing?.upload_post_profile as string,
        prop_map.upload_post_profile ? getText(props[prop_map.upload_post_profile]) : undefined,
      );
      const wpDomain = mergeField(
        existing?.wp_domain as string,
        prop_map.wp_domain ? getText(props[prop_map.wp_domain]) : undefined,
      );
      const wpUsername = mergeField(
        existing?.wp_username as string,
        prop_map.wp_username ? getText(props[prop_map.wp_username]) : undefined,
      );
      const wpAppPw = mergeField(
        existing?.wp_application_password as string,
        prop_map.wp_application_password ? getText(props[prop_map.wp_application_password]) : undefined,
      );
      const notesVal = mergeField(
        existing?.notes as string,
        prop_map.notes ? getText(props[prop_map.notes]) : undefined,
      );

      if (existing) {
        // UPDATE
        await c.env.DB
          .prepare(
            `UPDATE clients SET
               canonical_name          = CASE WHEN canonical_name = '' OR canonical_name IS NULL THEN ? ELSE canonical_name END,
               notion_page_id          = ?,
               upload_post_profile     = COALESCE(?, upload_post_profile),
               wp_domain               = COALESCE(?, wp_domain),
               wp_username             = COALESCE(?, wp_username),
               wp_application_password = COALESCE(?, wp_application_password),
               notes                   = COALESCE(?, notes),
               updated_at              = ?
             WHERE id = ?`,
          )
          .bind(
            name, page.id,
            upPost, wpDomain, wpUsername, wpAppPw, notesVal,
            now,
            existing.id,
          )
          .run();

        await logSync(c.env.DB, { direction: 'import', entity_type: 'client', entity_id: existing.id as string, notion_page_id: page.id, status: 'success', details: `Updated from Notion` });
        results.push({ notion_id: page.id, action: 'updated', slug: slug });
      } else {
        // INSERT
        const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
        await c.env.DB
          .prepare(
            `INSERT INTO clients
               (id, slug, canonical_name, notion_page_id, upload_post_profile,
                wp_domain, wp_username, wp_application_password, notes,
                status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .bind(
            id, slug, name, page.id, upPost,
            wpDomain, wpUsername, wpAppPw, notesVal,
            now, now,
          )
          .run();

        await logSync(c.env.DB, { direction: 'import', entity_type: 'client', entity_id: id, notion_page_id: page.id, status: 'success', details: 'Created from Notion' });
        results.push({ notion_id: page.id, action: 'created', slug });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logSync(c.env.DB, { direction: 'import', entity_type: 'client', notion_page_id: page.id, status: 'error', details: msg });
      results.push({ notion_id: page.id, action: 'error', slug, error: msg });
    }
  }

  const counts = {
    total:   results.length,
    created: results.filter(r => r.action === 'created').length,
    updated: results.filter(r => r.action === 'updated').length,
    errors:  results.filter(r => r.action === 'error').length,
  };

  return c.json({ ok: true, counts, results });
});

// ─── Full client import ───────────────────────────────────────────────────────

/**
 * POST /api/notion/import/clients/full
 *
 * Reads the WebXni Notion Clients DB and populates all 8 client tabs:
 *   clients (profile fields)
 *   client_intelligence
 *   client_platform_links (social links)
 *   client_platforms      (active platform rows)
 *   client_restrictions   (content restrictions)
 *   client_services       (service catalog)
 *   client_service_areas  (geographic targeting)
 *   client_offers         (offers / CTAs)
 *
 * Body:
 * {
 *   database_id: string,                         // Notion DB ID
 *   notion_id_to_app_slug?: Record<string,string>, // override map: notion_page_id → app slug
 *   active_only?: boolean,                       // skip pages with Package = "Inactive" (default true)
 *   force_sub_tables?: boolean,                  // re-insert services/areas/offers even if rows exist
 * }
 */

// ── parsing helpers ──────────────────────────────────────────────────────────

function normPackage(raw: string): string | null {
  const v = raw.toLowerCase().trim();
  if (v === 'premium') return 'premium';
  if (v === 'medium')  return 'medium';
  if (v === 'basic')   return 'basic';
  if (v === 'inactive' || v === '') return null;
  return v; // custom slug
}

function normFrequency(raw: string): string | null {
  const v = raw.toLowerCase();
  if (v.includes('daily') || v.includes('weekday') || v.includes('5x') || v.includes('7x')) return 'daily';
  if (v.includes('3x'))    return '3x_week';
  if (v.includes('twice')) return 'twice_weekly';
  if (v.includes('week'))  return 'weekly';
  if (v.includes('bi'))    return 'biweekly';
  if (v.includes('month')) return 'monthly';
  return null;
}

/** Parse "City, ST" or "City ST" into {city, state}. State is optional. */
function parseCity(raw: string, stateDefault: string | null): { city: string; state: string | null } {
  const t = raw.trim().replace(/\.$/, '');
  const m = t.match(/^(.+?),?\s+([A-Z]{2})$/);
  if (m) return { city: m[1].trim(), state: m[2] };
  return { city: t, state: stateDefault };
}

/** Parse service areas / target cities text into area rows. */
function parseAreas(
  serviceArea: string,
  serviceAreas: string,
  targetCities: string,
  stateDefault: string | null,
): Array<{ city: string; state: string | null; primary_area: number }> {
  const seen = new Set<string>();
  const out: Array<{ city: string; state: string | null; primary_area: number }> = [];

  function add(raw: string, isPrimary: number) {
    const t = raw.trim();
    if (!t || t.length < 2) return;
    if (/^[A-Z\s]+\s*\(\d+\s*cities?\)\s*:/i.test(t)) return;
    if (/^\d{5}$/.test(t)) return;
    const { city, state } = parseCity(t, stateDefault);
    const key = city.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ city, state, primary_area: isPrimary });
  }

  if (serviceArea.trim()) {
    const cleaned = serviceArea.replace(/[A-Z\s]+\(\d+\s*cities?\):/gi, '').trim();
    for (const part of cleaned.split(',')) add(part, 1);
  }
  if (serviceAreas.trim()) {
    const body = serviceAreas.replace(/[A-Z][A-Z\s]*\(\d+\s*cities?\):/gi, '');
    for (const part of body.split(',')) add(part.trim(), 0);
  }
  if (targetCities.trim()) {
    for (const part of targetCities.split(',')) add(part.trim(), 0);
  }
  return out.slice(0, 80);
}

/** Parse services text into rows (simple list or CATEGORY: items | format). */
function parseServices(raw: string): Array<{ name: string; category: string | null }> {
  if (!raw.trim()) return [];
  const out: Array<{ name: string; category: string | null }> = [];
  const seen = new Set<string>();

  function addSvc(name: string, cat: string | null) {
    const n = name.trim().replace(/^[-•*]\s*/, '');
    if (!n || n.length < 2 || n.length > 120) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: n, category: cat });
  }

  const hasPipes  = raw.includes(' | ') || raw.includes('|');
  const hasColons = /[A-Z]{4,}[^:]*:/.test(raw);
  if (hasPipes && hasColons) {
    for (const block of raw.split(/\s*\|\s*/)) {
      const idx = block.indexOf(':');
      if (idx === -1) { addSvc(block, null); continue; }
      const cat   = block.slice(0, idx).trim();
      const items = block.slice(idx + 1);
      const displayCat = cat.length > 0 && cat.length < 80 ? cat : null;
      for (const item of items.split(',')) addSvc(item, displayCat);
    }
  } else {
    for (const item of raw.split(/[,\n;]+/)) addSvc(item, null);
  }
  return out.slice(0, 60);
}

/** Extract primary keyword (first comma-separated value) and secondary keywords (rest). */
function parseKeywords(raw: string): { primary: string | null; secondary: string[] } {
  if (!raw.trim()) return { primary: null, secondary: [] };
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return { primary: parts[0] ?? null, secondary: parts.slice(1) };
}

/** Parse restrictions text into individual term strings. */
function parseRestrictions(raw: string): string[] {
  return raw
    .split(/[,.\n;]+/)
    .map(s => s.trim())
    .filter(s => s.length > 2 && s.length < 200)
    .slice(0, 30);
}

// ── the route ────────────────────────────────────────────────────────────────

notionRoutes.post('/import/clients/full', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const {
    database_id,
    notion_id_to_app_slug = {},
    active_only = true,
    force_sub_tables = false,
  } = body as {
    database_id: string;
    notion_id_to_app_slug?: Record<string, string>;
    active_only?: boolean;
    force_sub_tables?: boolean;
  };

  if (!database_id) return c.json({ error: 'database_id is required' }, 400);

  let notion: NotionClient;
  try { notion = new NotionClient(getToken(c.env)); }
  catch (e) { return c.json({ error: String(e) }, 500); }

  const pages = await notion.queryDatabase(database_id);

  const results: Array<{
    notion_id: string;
    name: string;
    action: 'updated' | 'created' | 'skipped' | 'error';
    tabs: string[];
    error?: string;
  }> = [];

  const now = Math.floor(Date.now() / 1000);

  for (const page of pages) {
    const p = page.properties;

    const name        = getText(p['Business Name']);
    const pkgRaw      = getText(p['Package']);
    const packageSlug = normPackage(pkgRaw);

    if (!name) continue;
    if (active_only && packageSlug === null) {
      results.push({ notion_id: page.id, name, action: 'skipped', tabs: [], error: 'Inactive package' });
      continue;
    }

    // ── extract all Notion fields ──────────────────────────────────────────
    const website      = getText(p['Website']);
    const phone        = p['Phone']?.type === 'phone_number' ? (p['Phone'].phone_number ?? '') : getText(p['Phone']);
    const email        = p['Email']?.type === 'email'        ? (p['Email'].email ?? '')        : getText(p['Email']);
    const ownerName    = getText(p['Owner Name']);
    const industry     = getText(p['Industry']);
    const stateRaw     = getText(p['State']);          // "CA" | "CA / OR / WA"
    const primaryState = stateRaw.split(/[/,]/)[0].trim() || null;
    const ctaPrimary   = getText(p['CTA Primary']);
    const contentTone  = getText(p['Content Tone']);   // "Professional" | "Urgent" | "Friendly"
    const brandKw      = getText(p['Brand Keywords']);
    const bizProfile   = getText(p['Business Profile']);
    const targetAud    = getText(p['Target Audience']);
    const primKwRaw    = getText(p['Primary Keywords']);
    const servicesRaw  = getText(p['Services ']);      // trailing space in Notion property name
    const serviceArea  = getText(p['Service Area']);
    const serviceAreas = getText(p['Service Areas']);
    const targetCities = getText(p['Target Cities']);
    const restrictions = getText(p['Content Restrictions']);
    const specialInstr = getText(p['Special Instructions']);
    const clientNotes  = getText(p['Client Notes']);
    const approvalReq  = getChecked(p['Approval Required']);
    const approverName = getText(p['Approver Name']);
    const freqRaw      = getText(p['Posting Frequency']);

    const slug = (notion_id_to_app_slug[page.id] as string | undefined)
      ?? slugFromName(name);

    const tabsDone: string[] = [];

    try {
      // ──────────────────────────────────────────────────────────────────────
      // 1. CLIENTS (profile + contact)
      // ──────────────────────────────────────────────────────────────────────
      let existing = await c.env.DB
        .prepare('SELECT * FROM clients WHERE notion_page_id = ?')
        .bind(page.id)
        .first<Record<string, unknown>>();

      if (!existing) {
        existing = await c.env.DB
          .prepare('SELECT * FROM clients WHERE slug = ?')
          .bind(slug)
          .first<Record<string, unknown>>();
      }

      // Build merged scalar fields — mergeField never overwrites non-empty local value
      const mergedPhone      = mergeField(existing?.phone as string, phone || undefined);
      const mergedEmail      = mergeField(existing?.email as string, email || undefined);
      const mergedOwnerName  = mergeField(existing?.owner_name as string, ownerName || undefined);
      const mergedCtaText    = mergeField(existing?.cta_text as string, ctaPrimary || undefined);
      const mergedWpDomain   = mergeField(existing?.wp_domain as string,
        website ? website.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined);
      const mergedNotes      = mergeField(existing?.notes as string,
        [clientNotes, specialInstr].filter(Boolean).join('\n\n') || undefined);
      const mergedApprover   = approvalReq
        ? mergeField(existing?.requires_approval_from as string, approverName || undefined)
        : (existing?.requires_approval_from as string | null) ?? null;
      const mergedPkg        = packageSlug
        ? (existing?.package as string | null) ?? packageSlug   // keep local if already set
        : (existing?.package as string | null);
      const freq             = normFrequency(freqRaw);

      let clientId: string;
      let action: 'created' | 'updated';

      if (existing) {
        clientId = existing.id as string;
        action   = 'updated';
        await c.env.DB
          .prepare(`UPDATE clients SET
              canonical_name        = CASE WHEN canonical_name = '' OR canonical_name IS NULL THEN ? ELSE canonical_name END,
              notion_page_id        = ?,
              package               = COALESCE(?, package),
              phone                 = COALESCE(?, phone),
              email                 = COALESCE(?, email),
              owner_name            = COALESCE(?, owner_name),
              cta_text              = COALESCE(?, cta_text),
              industry              = COALESCE(?, industry),
              state                 = COALESCE(?, state),
              wp_domain             = COALESCE(?, wp_domain),
              notes                 = COALESCE(?, notes),
              requires_approval_from= COALESCE(?, requires_approval_from),
              updated_at            = ?
            WHERE id = ?`)
          .bind(
            name, page.id,
            mergedPkg,
            mergedPhone, mergedEmail, mergedOwnerName, mergedCtaText,
            industry || null, stateRaw || null,
            mergedWpDomain, mergedNotes, mergedApprover,
            now, clientId,
          )
          .run();
      } else {
        clientId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
        action   = 'created';
        await c.env.DB
          .prepare(`INSERT INTO clients
              (id, slug, canonical_name, notion_page_id, package, status,
               phone, email, owner_name, cta_text, industry, state,
               wp_domain, notes, requires_approval_from,
               language, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?)`)
          .bind(
            clientId, slug, name, page.id,
            mergedPkg ?? 'medium',
            mergedPhone, mergedEmail, mergedOwnerName, mergedCtaText,
            industry || null, stateRaw || null,
            mergedWpDomain, mergedNotes, mergedApprover,
            now, now,
          )
          .run();
      }
      tabsDone.push('profile');

      await logSync(c.env.DB, {
        direction: 'import', entity_type: 'client',
        entity_id: clientId, notion_page_id: page.id,
        status: 'success', details: `${action} — profile`,
      });

      // ──────────────────────────────────────────────────────────────────────
      // 2. CLIENT_INTELLIGENCE
      // ──────────────────────────────────────────────────────────────────────
      const { primary: pkw, secondary: skws } = parseKeywords(primKwRaw);

      const brandVoice = [contentTone, brandKw ? `Keywords: ${brandKw}` : '']
        .filter(Boolean).join('. ') || null;

      const toneKeywords = brandKw
        ? JSON.stringify(brandKw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10))
        : null;

      const prohibTerms = restrictions.trim()
        ? JSON.stringify(parseRestrictions(restrictions))
        : null;

      const approvedCtas = ctaPrimary.trim()
        ? JSON.stringify([ctaPrimary.trim()])
        : null;

      const localSeo = targetCities.trim()
        ? JSON.stringify(targetCities.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20))
        : null;

      const secondaryKws = skws.length > 0 ? JSON.stringify(skws) : null;

      const humanStyle: Record<string, string> = {
        'Professional': 'professional and authoritative',
        'Urgent':       'urgent, direct, action-oriented',
        'Friendly':     'warm and conversational',
      };

      const existingIntel = await c.env.DB
        .prepare('SELECT id FROM client_intelligence WHERE client_id = ?')
        .bind(clientId)
        .first<{ id: string }>();

      if (!existingIntel) {
        const intelId = crypto.randomUUID().replace(/-/g, '');
        await c.env.DB
          .prepare(`INSERT INTO client_intelligence
              (id, client_id, brand_voice, tone_keywords, prohibited_terms, approved_ctas,
               content_goals, service_priorities, audience_notes, primary_keyword,
               secondary_keywords, local_seo_themes, humanization_style, feedback_summary,
               generation_language, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(
            intelId, clientId,
            brandVoice,
            toneKeywords,
            prohibTerms,
            approvedCtas,
            bizProfile.slice(0, 1000) || null,
            servicesRaw.slice(0, 500) || null,
            targetAud || null,
            pkw,
            secondaryKws,
            localSeo,
            contentTone ? (humanStyle[contentTone] ?? contentTone.toLowerCase()) : null,
            specialInstr.slice(0, 1000) || null,
            freq ? (freq === 'daily' ? 'en' : 'en') : 'en',
            now, now,
          )
          .run();
      } else {
        // Update only empty fields — never overwrite non-null values
        await c.env.DB
          .prepare(`UPDATE client_intelligence SET
              brand_voice       = CASE WHEN brand_voice       IS NULL OR brand_voice       = '' THEN ? ELSE brand_voice       END,
              tone_keywords     = CASE WHEN tone_keywords     IS NULL OR tone_keywords     = '' THEN ? ELSE tone_keywords     END,
              prohibited_terms  = CASE WHEN prohibited_terms  IS NULL OR prohibited_terms  = '' THEN ? ELSE prohibited_terms  END,
              approved_ctas     = CASE WHEN approved_ctas     IS NULL OR approved_ctas     = '' THEN ? ELSE approved_ctas     END,
              content_goals     = CASE WHEN content_goals     IS NULL OR content_goals     = '' THEN ? ELSE content_goals     END,
              service_priorities= CASE WHEN service_priorities IS NULL OR service_priorities='' THEN ? ELSE service_priorities END,
              audience_notes    = CASE WHEN audience_notes    IS NULL OR audience_notes    = '' THEN ? ELSE audience_notes    END,
              primary_keyword   = CASE WHEN primary_keyword   IS NULL OR primary_keyword   = '' THEN ? ELSE primary_keyword   END,
              secondary_keywords= CASE WHEN secondary_keywords IS NULL OR secondary_keywords='' THEN ? ELSE secondary_keywords END,
              local_seo_themes  = CASE WHEN local_seo_themes  IS NULL OR local_seo_themes  = '' THEN ? ELSE local_seo_themes  END,
              humanization_style= CASE WHEN humanization_style IS NULL OR humanization_style='' THEN ? ELSE humanization_style END,
              feedback_summary  = CASE WHEN feedback_summary  IS NULL OR feedback_summary  = '' THEN ? ELSE feedback_summary  END,
              updated_at        = ?
            WHERE client_id = ?`)
          .bind(
            brandVoice, toneKeywords, prohibTerms, approvedCtas,
            bizProfile.slice(0, 1000) || null,
            servicesRaw.slice(0, 500) || null,
            targetAud || null,
            pkw, secondaryKws, localSeo,
            contentTone ? (humanStyle[contentTone] ?? contentTone.toLowerCase()) : null,
            specialInstr.slice(0, 1000) || null,
            now, clientId,
          )
          .run();
      }
      tabsDone.push('intelligence');

      // ──────────────────────────────────────────────────────────────────────
      // 3. CLIENT_PLATFORM_LINKS (Social Links tab)
      // ──────────────────────────────────────────────────────────────────────
      const existingLinks = await c.env.DB
        .prepare('SELECT id FROM client_platform_links WHERE client_id = ?')
        .bind(clientId)
        .first<{ id: string }>();

      if (!existingLinks) {
        const linksId = crypto.randomUUID().replace(/-/g, '');
        await c.env.DB
          .prepare(`INSERT INTO client_platform_links
              (id, client_id, website, created_at, updated_at)
            VALUES (?,?,?,?,?)`)
          .bind(linksId, clientId, website || null, now, now)
          .run();
      } else {
        await c.env.DB
          .prepare(`UPDATE client_platform_links SET
              website    = CASE WHEN website IS NULL OR website = '' THEN ? ELSE website END,
              updated_at = ?
            WHERE client_id = ?`)
          .bind(website || null, now, clientId)
          .run();
      }
      tabsDone.push('social_links');

      // ──────────────────────────────────────────────────────────────────────
      // 4. CLIENT_RESTRICTIONS (feeds into prohibited_terms display)
      // ──────────────────────────────────────────────────────────────────────
      if (restrictions.trim()) {
        const terms = parseRestrictions(restrictions);
        for (const term of terms) {
          await c.env.DB
            .prepare('INSERT OR IGNORE INTO client_restrictions (client_id, term) VALUES (?,?)')
            .bind(clientId, term)
            .run();
        }
        if (terms.length > 0) tabsDone.push('restrictions');
      }

      // ──────────────────────────────────────────────────────────────────────
      // 5. CLIENT_SERVICES (Services tab)
      // ──────────────────────────────────────────────────────────────────────
      const existingSvcCount = await c.env.DB
        .prepare('SELECT COUNT(*) as n FROM client_services WHERE client_id = ?')
        .bind(clientId).first<{ n: number }>();

      if (servicesRaw.trim() && (force_sub_tables || (existingSvcCount?.n ?? 0) === 0)) {
        const svcs = parseServices(servicesRaw);

        const catNames = [...new Set(svcs.map(s => s.category).filter(Boolean) as string[])];
        const catIdMap: Record<string, string> = {};
        for (let i = 0; i < catNames.length; i++) {
          const catId = crypto.randomUUID().replace(/-/g, '');
          catIdMap[catNames[i]] = catId;
          await c.env.DB
            .prepare('INSERT OR IGNORE INTO client_categories (id, client_id, name, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)')
            .bind(catId, clientId, catNames[i], i, now, now).run();
        }
        for (let i = 0; i < svcs.length; i++) {
          const { name: svcName, category } = svcs[i];
          const svcId = crypto.randomUUID().replace(/-/g, '');
          const catId = category ? (catIdMap[category] ?? null) : null;
          await c.env.DB
            .prepare('INSERT INTO client_services (id, client_id, category_id, name, active, sort_order, created_at, updated_at) VALUES (?,?,?,?,1,?,?,?)')
            .bind(svcId, clientId, catId, svcName, i, now, now).run();
        }
        if (svcs.length > 0) tabsDone.push('services');
      }

      // ──────────────────────────────────────────────────────────────────────
      // 6. CLIENT_SERVICE_AREAS (Areas tab)
      // ──────────────────────────────────────────────────────────────────────
      const existingAreaCount = await c.env.DB
        .prepare('SELECT COUNT(*) as n FROM client_service_areas WHERE client_id = ?')
        .bind(clientId).first<{ n: number }>();

      if (force_sub_tables || (existingAreaCount?.n ?? 0) === 0) {
        const areas = parseAreas(serviceArea, serviceAreas, targetCities, primaryState);
        for (let i = 0; i < areas.length; i++) {
          const { city, state: aState, primary_area } = areas[i];
          const areaId = crypto.randomUUID().replace(/-/g, '');
          await c.env.DB
            .prepare('INSERT INTO client_service_areas (id, client_id, city, state, primary_area, sort_order, created_at) VALUES (?,?,?,?,?,?,?)')
            .bind(areaId, clientId, city, aState, primary_area, i, now).run();
        }
        if (areas.length > 0) tabsDone.push('areas');
      }

      await logSync(c.env.DB, {
        direction: 'import', entity_type: 'client',
        entity_id: clientId, notion_page_id: page.id,
        status: 'success', details: `tabs: ${tabsDone.join(', ')}`,
      });

      results.push({ notion_id: page.id, name, action, tabs: tabsDone });

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logSync(c.env.DB, {
        direction: 'import', entity_type: 'client',
        notion_page_id: page.id, status: 'error', details: msg,
      });
      results.push({ notion_id: page.id, name, action: 'error', tabs: [], error: msg });
    }
  }

  const counts = {
    total:   results.length,
    created: results.filter(r => r.action === 'created').length,
    updated: results.filter(r => r.action === 'updated').length,
    skipped: results.filter(r => r.action === 'skipped').length,
    errors:  results.filter(r => r.action === 'error').length,
  };

  return c.json({ ok: true, counts, results });
});

// ─── Import posts ─────────────────────────────────────────────────────────────

/**
 * POST /api/notion/import/posts
 * Body:
 * {
 *   database_id: string,
 *   prop_map: {
 *     title:          string,
 *     client_name?:   string,   // used to match local client
 *     publish_date?:  string,
 *     status?:        string,
 *     platforms?:     string,   // multi_select → JSON array
 *     master_caption?: string,
 *     content_type?:  string,
 *   }
 * }
 */
notionRoutes.post('/import/posts', async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { database_id, prop_map, date_from, date_to } = body as {
    database_id: string;
    prop_map: Record<string, string>;
    date_from?: string;  // ISO date e.g. "2026-04-09" — filter by publish_date >= this
    date_to?: string;    // ISO date e.g. "2026-04-09" — filter by publish_date <= this
  };

  if (!database_id) return c.json({ error: 'database_id is required' }, 400);
  if (!prop_map?.title) return c.json({ error: 'prop_map.title is required' }, 400);

  let notion: NotionClient;
  try { notion = new NotionClient(getToken(c.env)); }
  catch (e) { return c.json({ error: String(e) }, 500); }

  // Build Notion date filter if date range + publish_date prop mapping provided
  let notionFilter: unknown;
  if (date_from && prop_map.publish_date) {
    const conditions: unknown[] = [
      { property: prop_map.publish_date, date: { on_or_after: date_from } },
    ];
    if (date_to) {
      conditions.push({ property: prop_map.publish_date, date: { on_or_before: date_to } });
    }
    notionFilter = conditions.length === 1 ? conditions[0] : { and: conditions };
  }

  const pages = await notion.queryDatabase(database_id, notionFilter);

  // Local date filter as safety net (in case Notion prop name differs or filter not set)
  const filteredPages = (date_from || date_to)
    ? pages.filter(page => {
        if (!prop_map.publish_date) return true;
        const d = page.properties[prop_map.publish_date];
        const dateStr = d?.type === 'date' ? d.date?.start ?? null : null;
        if (!dateStr) return !date_from; // keep undated pages only if no lower bound
        if (date_from && dateStr < date_from) return false;
        if (date_to   && dateStr > date_to)   return false;
        return true;
      })
    : pages;

  const results: { notion_id: string; action: string; title: string; error?: string }[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const page of filteredPages) {
    const props = page.properties;
    const title = getText(props[prop_map.title]);
    if (!title) continue;

    try {
      // Find existing post by notion_page_id
      const existing = await c.env.DB
        .prepare('SELECT id, client_id FROM posts WHERE notion_page_id = ?')
        .bind(page.id)
        .first<{ id: string; client_id: string }>();

      const publishDate = prop_map.publish_date ? getDate(props[prop_map.publish_date]) : null;
      const masterCaption = prop_map.master_caption ? getText(props[prop_map.master_caption]) : null;
      const contentType = prop_map.content_type ? getText(props[prop_map.content_type]) : null;
      const notionStatus_val = prop_map.status ? getText(props[prop_map.status]) : null;
      const platformsList = prop_map.platforms ? getMultiSelect(props[prop_map.platforms]) : [];

      // Map Notion status to local status
      const localStatus = mapNotionStatus(notionStatus_val);

      if (existing) {
        await c.env.DB
          .prepare(
            `UPDATE posts SET
               title          = CASE WHEN title = '' OR title IS NULL THEN ? ELSE title END,
               publish_date   = COALESCE(?, publish_date),
               master_caption = COALESCE(?, master_caption),
               content_type   = COALESCE(?, content_type),
               platforms      = CASE WHEN platforms = '[]' OR platforms IS NULL THEN ? ELSE platforms END,
               notion_page_id = ?,
               updated_at     = ?
             WHERE id = ?`,
          )
          .bind(
            title,
            publishDate, masterCaption,
            contentType,
            platformsList.length ? JSON.stringify(platformsList.map(p => p.toLowerCase())) : null,
            page.id,
            now,
            existing.id,
          )
          .run();

        await logSync(c.env.DB, { direction: 'import', entity_type: 'post', entity_id: existing.id, notion_page_id: page.id, status: 'success', details: 'Updated from Notion' });
        results.push({ notion_id: page.id, action: 'updated', title });
      } else {
        // Try to match client by name
        let clientId: string | null = null;
        if (prop_map.client_name) {
          const clientName = getText(props[prop_map.client_name]);
          if (clientName) {
            const cl = await c.env.DB
              .prepare('SELECT id FROM clients WHERE canonical_name = ? OR slug = ?')
              .bind(clientName, slugFromName(clientName))
              .first<{ id: string }>();
            clientId = cl?.id ?? null;
          }
        }

        if (!clientId) {
          await logSync(c.env.DB, { direction: 'import', entity_type: 'post', notion_page_id: page.id, status: 'skipped', details: `No matching client for post: ${title}` });
          results.push({ notion_id: page.id, action: 'skipped', title });
          continue;
        }

        const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
        await c.env.DB
          .prepare(
            `INSERT INTO posts
               (id, client_id, title, status, content_type, platforms,
                publish_date, master_caption, notion_page_id,
                ready_for_automation, asset_delivered, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
          )
          .bind(
            id, clientId, title,
            localStatus ?? 'draft',
            contentType ?? 'image',
            platformsList.length ? JSON.stringify(platformsList.map(p => p.toLowerCase())) : '[]',
            publishDate,
            masterCaption,
            page.id,
            now, now,
          )
          .run();

        await logSync(c.env.DB, { direction: 'import', entity_type: 'post', entity_id: id, notion_page_id: page.id, status: 'success', details: 'Created from Notion' });
        results.push({ notion_id: page.id, action: 'created', title });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logSync(c.env.DB, { direction: 'import', entity_type: 'post', notion_page_id: page.id, status: 'error', details: msg });
      results.push({ notion_id: page.id, action: 'error', title, error: msg });
    }
  }

  const counts = {
    total:        results.length,
    created:      results.filter(r => r.action === 'created').length,
    updated:      results.filter(r => r.action === 'updated').length,
    skipped:      results.filter(r => r.action === 'skipped').length,
    errors:       results.filter(r => r.action === 'error').length,
    pages_in_db:  pages.length,
    pages_after_filter: filteredPages.length,
  };

  return c.json({ ok: true, counts, results, date_filter: { date_from: date_from ?? null, date_to: date_to ?? null } });
});

// ─── Export: write status back to Notion ─────────────────────────────────────

/**
 * POST /api/notion/export/post/:id
 * Body: { status_prop: string, url_prop?: string }
 * Writes the post's automation_status and wp_post_url back to Notion.
 */
notionRoutes.post('/export/post/:id', async (c) => {
  const post = await getPostById(c.env.DB, c.req.param('id'));
  if (!post) return c.json({ error: 'Post not found' }, 404);
  if (!post.notion_page_id) return c.json({ error: 'Post has no notion_page_id — run import first' }, 400);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { status_prop, url_prop } = body as { status_prop: string; url_prop?: string };
  if (!status_prop) return c.json({ error: 'status_prop is required' }, 400);

  let notion: NotionClient;
  try { notion = new NotionClient(getToken(c.env)); }
  catch (e) { return c.json({ error: String(e) }, 500); }

  const properties: Record<string, unknown> = {
    [status_prop]: notionStatus(post.automation_status ?? post.status ?? 'Unknown'),
  };

  if (url_prop && post.wp_post_url) {
    properties[url_prop] = notionUrl(post.wp_post_url);
  }

  try {
    await notion.updatePage(post.notion_page_id, properties);
    await logSync(c.env.DB, {
      direction: 'export',
      entity_type: 'post',
      entity_id: post.id,
      notion_page_id: post.notion_page_id,
      status: 'success',
      details: `Wrote status: ${post.automation_status}`,
    });
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync(c.env.DB, {
      direction: 'export',
      entity_type: 'post',
      entity_id: post.id,
      notion_page_id: post.notion_page_id,
      status: 'error',
      details: msg,
    });
    return c.json({ error: msg }, 502);
  }
});

// ─── Sync log ─────────────────────────────────────────────────────────────────

notionRoutes.get('/sync-log', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const rows = await c.env.DB
    .prepare('SELECT * FROM notion_sync_log ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all();
  return c.json({ log: rows.results });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapNotionStatus(notionVal: string | null): string | null {
  if (!notionVal) return null;
  const v = notionVal.toLowerCase();
  if (v.includes('approved')) return 'approved';
  if (v.includes('ready'))    return 'ready';
  if (v.includes('posted') || v.includes('published')) return 'posted';
  if (v.includes('failed'))   return 'failed';
  if (v.includes('cancel'))   return 'cancelled';
  return 'draft';
}
