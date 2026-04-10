/**
 * Notion import/export routes
 *
 * POST /api/notion/import/clients  — pull clients from a Notion database
 * POST /api/notion/import/posts    — pull posts from a Notion content database
 * POST /api/notion/export/post/:id — write posting status back to Notion
 * GET  /api/notion/sync-log        — recent sync history
 *
 * Property name mapping is provided in the request body so this works
 * regardless of how columns are named in the user's Notion database.
 */

import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  NotionClient,
  getText,
  getDate,
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
  if (user.role !== 'admin' && user.role !== 'manager') {
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
  if (user.role !== 'admin' && user.role !== 'manager') {
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
  if (!prop_map?.title) return c.json({ error: 'prop_map.title is required' }, 400);

  let notion: NotionClient;
  try { notion = new NotionClient(getToken(c.env)); }
  catch (e) { return c.json({ error: String(e) }, 500); }

  const pages = await notion.queryDatabase(database_id);
  const results: { notion_id: string; action: string; title: string; error?: string }[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const page of pages) {
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
    total:   results.length,
    created: results.filter(r => r.action === 'created').length,
    updated: results.filter(r => r.action === 'updated').length,
    skipped: results.filter(r => r.action === 'skipped').length,
    errors:  results.filter(r => r.action === 'error').length,
  };

  return c.json({ ok: true, counts, results });
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
