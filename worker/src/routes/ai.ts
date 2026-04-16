/**
 * AI Agent — /api/ai/agent  +  /api/ai/dispatch (Discord-ready)
 *
 * Architecture:
 *   • OpenAI gpt-4o-mini with function calling (tool loop, max 2 iter)
 *   • Tools call existing DB/service logic directly — no HTTP round-trip
 *   • Structured response: { message, summary, items, actions_taken, suggestions, errors }
 *   • Stale-data fix: mutations re-query and return fresh data in tool result
 *   • Discord-ready: /api/ai/dispatch accepts source + auth_token for bot callers
 */

import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listClients, getClientBySlug,
  listPosts, getPostById, updatePost, setPostStatus,
  createPost, createGenerationRun, createPostingJob,
  writeAuditLog,
} from '../db/queries';
import { runPosting }    from '../loader/posting-run';
import { planGeneration } from '../loader/generation-run';
import { AGENT_SKILLS, AGENT_MEMORY, RESPONSE_RULES } from '../agent/context';

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ─────────────────────────────────────────────────────────────────────────────
// Structured response types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentStructuredResponse {
  message:       string;
  summary?:      Record<string, unknown>;
  items?:        unknown[];
  actions_taken: string[];
  suggestions?:  string[];
  errors:        string[];
  tools_used?:   string[];
  job_id?:       string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_TOOLS = [
  // ── READ ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_posts',
      description: 'Get posts with filters. Returns items array with fresh post data.',
      parameters: {
        type: 'object',
        properties: {
          client:    { type: 'string', description: 'Client slug' },
          status:    { type: 'string', description: 'draft|pending_approval|approved|ready|scheduled|posted|failed|cancelled' },
          date_from: { type: 'string', description: 'YYYY-MM-DD' },
          date_to:   { type: 'string', description: 'YYYY-MM-DD' },
          platform:  { type: 'string' },
          limit:     { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_queue',
      description: 'Get the posting queue — ready posts awaiting automation.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_client_details',
      description: 'Get full client info: profile, platforms, intelligence, services, areas, offers, events.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
        },
        required: ['client'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report',
      description: 'Get post statistics grouped by status.',
      parameters: {
        type: 'object',
        properties: {
          client:    { type: 'string' },
          date_from: { type: 'string' },
          date_to:   { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: 'Inspect system health: failed posts, stuck jobs, stale records, missing WP sync. Returns issues and fix suggestions.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // ── POST MUTATIONS ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'generate_content',
      description: 'Trigger AI content generation for clients over a date range.',
      parameters: {
        type: 'object',
        properties: {
          client_slugs:       { type: 'array', items: { type: 'string' }, description: 'Empty = all active' },
          date_from:          { type: 'string', description: 'YYYY-MM-DD' },
          date_to:            { type: 'string', description: 'YYYY-MM-DD' },
          overwrite_existing: { type: 'boolean' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_post_for_platform',
      description: 'Create a new post targeting one specific platform for a client.',
      parameters: {
        type: 'object',
        properties: {
          client:        { type: 'string', description: 'Client slug' },
          platform:      { type: 'string', description: 'facebook|instagram|linkedin|tiktok|pinterest|bluesky|x|threads|youtube|google_business' },
          title:         { type: 'string' },
          caption:       { type: 'string', description: 'Main caption / master_caption' },
          publish_date:  { type: 'string', description: 'YYYY-MM-DD or YYYY-MM-DDTHH:MM' },
          content_type:  { type: 'string', description: 'image|video|reel|blog (default: image)' },
          status:        { type: 'string', description: 'draft|approved|ready (default: draft)' },
        },
        required: ['client', 'platform', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_post',
      description: 'Update fields on a single post. Returns fresh post data after update.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string' },
          fields:  { type: 'object', description: 'title, master_caption, publish_date, status, cap_*, seo_title, target_keyword, etc.' },
        },
        required: ['post_id', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_update_posts',
      description: 'Update multiple posts. ALWAYS dry_run=true first unless user confirms.',
      parameters: {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            properties: {
              client:    { type: 'string' },
              status:    { type: 'string' },
              date_from: { type: 'string' },
              date_to:   { type: 'string' },
              post_ids:  { type: 'array', items: { type: 'string' } },
            },
          },
          changes: { type: 'object' },
          dry_run: { type: 'boolean', description: 'Default true' },
        },
        required: ['filters', 'changes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_post_status',
      description: 'Change workflow status of a post. Returns fresh post after change.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string' },
          status:  { type: 'string', description: 'approved|rejected|ready|cancelled|draft|pending_approval' },
          reason:  { type: 'string' },
        },
        required: ['post_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_post',
      description: 'Trigger social posting for a single post immediately.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string' },
          dry_run: { type: 'boolean' },
        },
        required: ['post_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_bulk',
      description: 'Run bulk posting automation for ready posts.',
      parameters: {
        type: 'object',
        properties: {
          client:   { type: 'string' },
          platform: { type: 'string' },
          limit:    { type: 'number' },
          dry_run:  { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fix_failed_posts',
      description: 'Reset failed posts back to ready so automation can retry.',
      parameters: {
        type: 'object',
        properties: {
          client:   { type: 'string' },
          post_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_post',
      description: 'Permanently delete a post. Requires explicit user confirmation.',
      parameters: {
        type: 'object',
        properties: {
          post_id:  { type: 'string' },
          confirmed: { type: 'boolean', description: 'Must be true to execute' },
        },
        required: ['post_id', 'confirmed'],
      },
    },
  },

  // ── BLOG ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_blog_post',
      description: 'Update blog-specific fields on a post (content, SEO, keyword, slug, excerpt, template key).',
      parameters: {
        type: 'object',
        properties: {
          post_id:            { type: 'string' },
          blog_content:       { type: 'string' },
          seo_title:          { type: 'string' },
          meta_description:   { type: 'string' },
          target_keyword:     { type: 'string' },
          secondary_keywords: { type: 'string' },
          slug:               { type: 'string' },
          blog_excerpt:       { type: 'string' },
        },
        required: ['post_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_blog',
      description: 'Publish or update a blog post to WordPress. Returns WP post URL on success.',
      parameters: {
        type: 'object',
        properties: {
          post_id:      { type: 'string' },
          wp_status:    { type: 'string', description: 'publish|draft|pending (default: use client default)' },
          force_update: { type: 'boolean', description: 'Replace existing WP post if already published' },
        },
        required: ['post_id'],
      },
    },
  },

  // ── CLIENT MUTATIONS ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'update_client_profile',
      description: 'Update client profile fields: name, phone, email, industry, state, notes, brand colors, WordPress config, language, upload_post_profile, etc.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          fields: {
            type: 'object',
            description: 'Any writable client fields: canonical_name, phone, email, owner_name, industry, state, notes, language, cta_text, cta_label, brand_primary_color, brand_accent_color, upload_post_profile, wp_template_key, wp_base_url, wp_username, wp_application_password, wp_default_post_status, package, status, manual_only',
          },
        },
        required: ['client', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_client_intelligence',
      description: 'Update client intelligence / brand voice settings.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          fields: {
            type: 'object',
            description: 'brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities, content_angles, seasonal_notes, audience_notes, primary_keyword, secondary_keywords, local_seo_themes, humanization_style',
          },
        },
        required: ['client', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_client_platforms',
      description: 'Upsert a platform configuration for a client (upload-post IDs, page IDs, etc.).',
      parameters: {
        type: 'object',
        properties: {
          client:   { type: 'string', description: 'Client slug' },
          platform: { type: 'string', description: 'facebook|instagram|linkedin|tiktok|pinterest|bluesky|x|threads|youtube|google_business' },
          fields: {
            type: 'object',
            description: 'upload_post_account_id, upload_post_location_id, upload_post_board_id, page_id, paused',
          },
        },
        required: ['client', 'platform', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_client_service',
      description: 'Add a new service to a client.',
      parameters: {
        type: 'object',
        properties: {
          client:      { type: 'string', description: 'Client slug' },
          name:        { type: 'string' },
          description: { type: 'string' },
        },
        required: ['client', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_client_area',
      description: 'Add a service area to a client.',
      parameters: {
        type: 'object',
        properties: {
          client:       { type: 'string', description: 'Client slug' },
          city:         { type: 'string' },
          state:        { type: 'string' },
          primary_area: { type: 'boolean' },
        },
        required: ['client', 'city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_client_feedback',
      description: 'Record client feedback for a given month.',
      parameters: {
        type: 'object',
        properties: {
          client:    { type: 'string', description: 'Client slug' },
          message:   { type: 'string' },
          sentiment: { type: 'string', description: 'positive|neutral|negative' },
          category:  { type: 'string' },
          month:     { type: 'string', description: 'YYYY-MM' },
        },
        required: ['client', 'message'],
      },
    },
  },

  // ── OFFERS ────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_offer',
      description: 'Create a GBP offer for a client.',
      parameters: {
        type: 'object',
        properties: {
          client:          { type: 'string', description: 'Client slug' },
          title:           { type: 'string' },
          description:     { type: 'string' },
          cta_text:        { type: 'string' },
          valid_until:     { type: 'string', description: 'YYYY-MM-DD' },
          gbp_cta_type:    { type: 'string', description: 'BOOK|ORDER|SHOP|LEARN_MORE|SIGN_UP|CALL' },
          gbp_cta_url:     { type: 'string' },
          gbp_coupon_code: { type: 'string' },
          recurrence:      { type: 'string', description: 'none|weekly|biweekly|monthly' },
          next_run_date:   { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['client', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_offer',
      description: 'Update an existing GBP offer.',
      parameters: {
        type: 'object',
        properties: {
          offer_id: { type: 'string' },
          fields:   { type: 'object', description: 'title, description, cta_text, valid_until, active, gbp_cta_type, gbp_cta_url, gbp_coupon_code, recurrence, next_run_date, paused' },
        },
        required: ['offer_id', 'fields'],
      },
    },
  },

  // ── EVENTS ────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Create a GBP event for a client.',
      parameters: {
        type: 'object',
        properties: {
          client:               { type: 'string', description: 'Client slug' },
          title:                { type: 'string' },
          description:          { type: 'string' },
          gbp_event_title:      { type: 'string' },
          gbp_event_start_date: { type: 'string', description: 'YYYY-MM-DD' },
          gbp_event_start_time: { type: 'string', description: 'HH:MM' },
          gbp_event_end_date:   { type: 'string', description: 'YYYY-MM-DD' },
          gbp_event_end_time:   { type: 'string', description: 'HH:MM' },
          gbp_cta_type:         { type: 'string' },
          gbp_cta_url:          { type: 'string' },
          recurrence:           { type: 'string', description: 'once|weekly|biweekly|monthly' },
          next_run_date:        { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['client', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_event',
      description: 'Update an existing GBP event.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          fields:   { type: 'object', description: 'title, description, gbp_event_title, gbp_event_start_date, gbp_event_start_time, gbp_event_end_date, gbp_event_end_time, gbp_cta_type, gbp_cta_url, active, paused, recurrence, next_run_date' },
        },
        required: ['event_id', 'fields'],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool result type
// ─────────────────────────────────────────────────────────────────────────────

interface ToolResult {
  success:        boolean;
  data?:          unknown;
  items?:         unknown[];
  summary?:       Record<string, unknown>;
  suggestions?:   string[];
  error?:         string;
  action_summary?: string;
  job_id?:        string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveClientSlug(db: D1Database, slug: string): Promise<{ id: string; canonical_name: string } | null> {
  const row = await db
    .prepare('SELECT id, canonical_name FROM clients WHERE slug = ?')
    .bind(slug)
    .first<{ id: string; canonical_name: string }>();
  return row ?? null;
}

function mapPostToItem(p: Record<string, unknown>): Record<string, unknown> {
  return {
    id:           p['id'],
    title:        p['title'],
    status:       p['status'],
    content_type: p['content_type'],
    publish_date: p['publish_date'],
    client:       p['client_name'] ?? p['client_id'],
    platforms:    p['platforms'],
    ready:        p['ready_for_automation'],
    asset:        p['asset_delivered'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
  user: SessionData,
  baseUrl: string,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  try {
    switch (name) {

      // ── GET POSTS ──────────────────────────────────────────────────────────
      case 'get_posts': {
        let clientId: string | undefined;
        if (args.client) {
          const c = await resolveClientSlug(env.DB, args.client as string);
          if (!c) return { success: false, error: `Client not found: ${args.client}` };
          clientId = c.id;
        }
        const { rows, total } = await listPosts(env.DB, {
          clientId,
          status:   typeof args.status    === 'string' ? args.status    : undefined,
          dateFrom: typeof args.date_from  === 'string' ? args.date_from : undefined,
          dateTo:   typeof args.date_to    === 'string' ? args.date_to   : undefined,
          platform: typeof args.platform   === 'string' ? args.platform  : undefined,
          limit:    typeof args.limit === 'number' ? Math.min(100, args.limit) : 25,
        });

        // Enrich with client names
        const ids = [...new Set(rows.map(p => p.client_id))];
        const nameMap = new Map<string, string>();
        if (ids.length) {
          const ph = ids.map(() => '?').join(',');
          const cl = await env.DB
            .prepare(`SELECT id, canonical_name, slug FROM clients WHERE id IN (${ph})`)
            .bind(...ids).all<{ id: string; canonical_name: string; slug: string }>();
          for (const r of cl.results) nameMap.set(r.id, `${r.canonical_name} (${r.slug})`);
        }

        const items = rows.map(p => ({
          id:           p.id,
          title:        p.title,
          status:       p.status,
          content_type: p.content_type,
          publish_date: p.publish_date,
          client:       nameMap.get(p.client_id) ?? p.client_id,
          platforms:    p.platforms,
          ready:        p.ready_for_automation,
          asset:        p.asset_delivered,
        }));

        const byStatus: Record<string, number> = {};
        for (const p of rows) {
          byStatus[p.status || 'unknown'] = (byStatus[p.status || 'unknown'] ?? 0) + 1;
        }

        return {
          success: true,
          items,
          summary: { total, shown: items.length, by_status: byStatus },
          action_summary: `Found ${total} posts (showing ${items.length})`,
        };
      }

      // ── GET QUEUE ──────────────────────────────────────────────────────────
      case 'get_queue': {
        const nowExpr = `strftime('%Y-%m-%dT%H:%M','now','-6 hours')`;
        const rows = await env.DB
          .prepare(`
            SELECT p.id, p.title, p.status, p.content_type, p.publish_date,
                   c.canonical_name AS client_name, c.slug AS client_slug,
                   CASE
                     WHEN substr(p.publish_date,1,16) < ${nowExpr} THEN 'overdue'
                     WHEN substr(p.publish_date,1,16) <= strftime('%Y-%m-%dT%H:%M','now','-6 hours','+2 minutes') THEN 'posting'
                     WHEN substr(p.publish_date,1,16) <= strftime('%Y-%m-%dT%H:%M','now','-6 hours','+60 minutes') THEN 'due_soon'
                     ELSE 'queued'
                   END AS queue_state
            FROM posts p
            JOIN clients c ON c.id = p.client_id
            WHERE p.status IN ('ready','approved')
              AND p.content_type != 'blog'
              AND p.ready_for_automation = 1
              AND p.asset_delivered = 1
              AND p.publish_date IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM post_platforms pp
                WHERE pp.post_id = p.id AND pp.status IN ('sent','idempotent','posted')
              )
            ORDER BY p.publish_date ASC LIMIT 100
          `)
          .all<Record<string, unknown>>();

        const posts = rows.results;
        const overdue  = posts.filter(p => p['queue_state'] === 'overdue').length;
        const due_soon = posts.filter(p => p['queue_state'] === 'due_soon').length;
        const queued   = posts.filter(p => p['queue_state'] === 'queued').length;

        const suggestions: string[] = [];
        if (overdue > 0) suggestions.push(`Run publish_bulk to process ${overdue} overdue posts`);
        if (due_soon > 0) suggestions.push(`${due_soon} posts are due within the hour`);

        return {
          success: true,
          items: posts,
          summary: { total: posts.length, overdue, due_soon, queued },
          suggestions,
          action_summary: `Queue: ${posts.length} posts (${overdue} overdue, ${due_soon} due soon, ${queued} queued)`,
        };
      }

      // ── GET CLIENT DETAILS ────────────────────────────────────────────────
      case 'get_client_details': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const [platforms, intel, services, areas, offers, events] = await Promise.all([
          env.DB.prepare('SELECT * FROM client_platforms WHERE client_id = ?').bind(client.id).all(),
          env.DB.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first(),
          env.DB.prepare('SELECT * FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order LIMIT 30').bind(client.id).all(),
          env.DB.prepare('SELECT * FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order LIMIT 20').bind(client.id).all(),
          env.DB.prepare('SELECT * FROM client_offers WHERE client_id = ? ORDER BY active DESC LIMIT 10').bind(client.id).all(),
          env.DB.prepare('SELECT * FROM client_events WHERE client_id = ? ORDER BY active DESC LIMIT 10').bind(client.id).all(),
        ]);

        return {
          success: true,
          data: {
            profile:    client,
            platforms:  platforms.results,
            intelligence: intel ?? null,
            services:   services.results,
            areas:      areas.results,
            offers:     offers.results,
            events:     events.results,
          },
          action_summary: `Client details for ${client.canonical_name}`,
        };
      }

      // ── GET REPORT ─────────────────────────────────────────────────────────
      case 'get_report': {
        const client   = typeof args.client    === 'string' ? args.client    : null;
        const dateFrom = typeof args.date_from === 'string' ? args.date_from : null;
        const dateTo   = typeof args.date_to   === 'string' ? args.date_to   : null;

        const conditions: string[] = [];
        const binds: unknown[]     = [];
        if (client) {
          const row = await resolveClientSlug(env.DB, client);
          if (!row) return { success: false, error: `Client not found: ${client}` };
          conditions.push('p.client_id = ?'); binds.push(row.id);
        }
        if (dateFrom) { conditions.push("substr(p.publish_date,1,10) >= ?"); binds.push(dateFrom); }
        if (dateTo)   { conditions.push("substr(p.publish_date,1,10) <= ?"); binds.push(dateTo);   }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [statusRows, clientRows] = await Promise.all([
          env.DB.prepare(`SELECT p.status, COUNT(*) AS cnt FROM posts p ${where} GROUP BY p.status`).bind(...binds).all<{ status: string; cnt: number }>(),
          client ? null : env.DB.prepare(`SELECT c.canonical_name AS name, c.slug, COUNT(p.id) AS cnt FROM posts p JOIN clients c ON c.id = p.client_id ${where} GROUP BY p.client_id ORDER BY cnt DESC LIMIT 10`).bind(...binds).all<{ name: string; slug: string; cnt: number }>(),
        ]);

        const byStatus: Record<string, number> = {};
        let total = 0;
        for (const row of statusRows.results) { byStatus[row.status] = row.cnt; total += row.cnt; }

        return {
          success: true,
          summary: { total, by_status: byStatus, top_clients: clientRows?.results ?? null },
          action_summary: `Report: ${total} total posts`,
        };
      }

      // ── GET SYSTEM STATUS ──────────────────────────────────────────────────
      case 'get_system_status': {
        const [failed, stuckJobs, stuckGen, recentErrors, missingUrls] = await Promise.all([
          env.DB.prepare(`
            SELECT p.id, p.title, p.status, p.publish_date, c.slug AS client_slug
            FROM posts p JOIN clients c ON c.id = p.client_id
            WHERE p.status = 'failed' ORDER BY p.updated_at DESC LIMIT 20
          `).all<Record<string, unknown>>(),
          env.DB.prepare(`
            SELECT id, mode, status, created_at, completed_at
            FROM posting_jobs WHERE status = 'running'
              AND created_at < unixepoch('now') - 1800
            LIMIT 10
          `).all<Record<string, unknown>>(),
          env.DB.prepare(`
            SELECT id, status, week_start, created_at, current_slot_idx, total_slots
            FROM generation_runs WHERE status = 'running'
              AND created_at < unixepoch('now') - 1800
            LIMIT 5
          `).all<Record<string, unknown>>(),
          env.DB.prepare(`
            SELECT p.id, p.title, p.publish_date, c.slug AS client_slug
            FROM posts p JOIN clients c ON c.id = p.client_id
            WHERE p.status = 'posted'
              AND p.publish_date < date('now', '-1 day')
              AND NOT EXISTS (
                SELECT 1 FROM post_platforms pp WHERE pp.post_id = p.id AND pp.real_url IS NOT NULL
              )
            ORDER BY p.publish_date DESC LIMIT 10
          `).all<Record<string, unknown>>(),
          env.DB.prepare(`
            SELECT COUNT(*) AS cnt FROM posts
            WHERE status IN ('draft','pending_approval')
              AND publish_date IS NOT NULL
              AND substr(publish_date,1,10) < date('now')
          `).first<{ cnt: number }>(),
        ]);

        const issues: Array<{ type: string; severity: string; count: number; description: string; fix: string }> = [];
        if (failed.results.length > 0) issues.push({ type: 'failed_posts', severity: 'high', count: failed.results.length, description: `${failed.results.length} posts in failed state`, fix: 'Use fix_failed_posts to reset them to ready' });
        if (stuckJobs.results.length > 0) issues.push({ type: 'stuck_posting_jobs', severity: 'medium', count: stuckJobs.results.length, description: `${stuckJobs.results.length} posting jobs stuck running >30min`, fix: 'These may have timed out — check logs then re-trigger posting' });
        if (stuckGen.results.length > 0) issues.push({ type: 'stuck_generation_runs', severity: 'medium', count: stuckGen.results.length, description: `${stuckGen.results.length} generation runs stuck >30min`, fix: 'Cancel via PATCH /api/run/generate/runs/:id/cancel and re-trigger' });
        if (recentErrors.results.length > 0) issues.push({ type: 'missing_published_urls', severity: 'low', count: recentErrors.results.length, description: `${recentErrors.results.length} posted posts missing real_url`, fix: 'Run POST /api/run/fetch-urls to sync URLs from Upload-Post' });
        if ((missingUrls?.cnt ?? 0) > 0) { issues.push({ type: 'stale_draft_posts', severity: 'low', count: missingUrls?.cnt ?? 0, description: `${missingUrls?.cnt ?? 0} posts still draft/pending with past publish dates`, fix: 'Review and approve or cancel these posts' }); }

        const suggestions = issues.map(i => `[${i.severity.toUpperCase()}] ${i.description} — ${i.fix}`);

        return {
          success: true,
          items: issues,
          summary: {
            healthy: issues.length === 0,
            issue_count: issues.length,
            failed_posts: failed.results.length,
            stuck_jobs: stuckJobs.results.length,
            stuck_gen_runs: stuckGen.results.length,
            missing_urls: recentErrors.results.length,
          },
          suggestions,
          action_summary: issues.length === 0
            ? 'System is healthy — no issues found'
            : `Found ${issues.length} issue${issues.length !== 1 ? 's' : ''}`,
        };
      }

      // ── GENERATE CONTENT ───────────────────────────────────────────────────
      case 'generate_content': {
        const dateFrom = typeof args.date_from === 'string' ? args.date_from : null;
        const dateTo   = typeof args.date_to   === 'string' ? args.date_to   : dateFrom;
        if (!dateFrom) return { success: false, error: 'date_from is required' };

        const clientSlugs: string[] = Array.isArray(args.client_slugs) ? (args.client_slugs as string[]) : [];
        const dates: string[] = [];
        const d = new Date(dateFrom); const end = new Date(dateTo!);
        while (d <= end && dates.length < 60) { dates.push(d.toISOString().split('T')[0]); d.setUTCDate(d.getUTCDate() + 1); }

        const run = await createGenerationRun(env.DB, {
          triggered_by: user.userId,
          date_range: `${dates[0]}:${dates[dates.length - 1]}`,
          client_filter: clientSlugs.length > 0 ? JSON.stringify(clientSlugs) : null,
          overwrite_existing: args.overwrite_existing === true,
        });

        ctx.waitUntil(planGeneration(env, {
          run_id: run.id, client_slugs: clientSlugs,
          period_start: dates[0], period_end: dates[dates.length - 1],
          triggered_by: user.userId, publish_time: null,
          overwrite_existing: args.overwrite_existing === true,
        }, baseUrl));

        return {
          success: true,
          job_id: run.id,
          summary: { job_id: run.id, date_range: `${dates[0]} → ${dates[dates.length - 1]}`, clients: clientSlugs.length > 0 ? clientSlugs.join(', ') : 'all active', days: dates.length },
          action_summary: `Generation job ${run.id} started — ${clientSlugs.length > 0 ? clientSlugs.join(', ') : 'all clients'} for ${dates.length} days`,
        };
      }

      // ── CREATE POST FOR PLATFORM ───────────────────────────────────────────
      case 'create_post_for_platform': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const platform     = typeof args.platform    === 'string' ? args.platform    : null;
        const title        = typeof args.title       === 'string' ? args.title       : null;
        const caption      = typeof args.caption     === 'string' ? args.caption     : null;
        const publishDate  = typeof args.publish_date === 'string' ? args.publish_date : null;
        const contentType  = typeof args.content_type === 'string' ? args.content_type : 'image';
        const status       = typeof args.status      === 'string' ? args.status      : 'draft';

        if (!platform) return { success: false, error: 'platform is required' };
        if (!title)    return { success: false, error: 'title is required' };

        const capField = `cap_${platform}`;
        const capData: Record<string, string | null> = { master_caption: caption };
        capData[capField] = caption;

        const post = await createPost(env.DB, {
          client_id:    client.id,
          title,
          status,
          content_type: contentType,
          platforms:    JSON.stringify([platform]),
          publish_date: publishDate ?? null,
          master_caption: caption ?? null,
          ...capData,
        } as never);

        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_create_post', entity_type: 'post', entity_id: post.id, new_value: { platform, title } });

        return {
          success: true,
          items: [mapPostToItem({ ...post, client_name: client.canonical_name })],
          summary: { post_id: post.id, platform, status },
          action_summary: `Created ${platform} post "${title}" for ${client.canonical_name} (${status})`,
        };
      }

      // ── UPDATE POST ────────────────────────────────────────────────────────
      case 'update_post': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };
        const before = await getPostById(env.DB, postId);
        if (!before) return { success: false, error: `Post not found: ${postId}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const FORBIDDEN = ['id', 'client_id', 'created_at', 'generation_run_id', 'automation_slot_key'];
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (!FORBIDDEN.includes(k)) safe[k] = v;
        }
        if (Object.keys(safe).length === 0) return { success: false, error: 'No valid fields to update' };

        await updatePost(env.DB, postId, safe as never);
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_update_post', entity_type: 'post', entity_id: postId, new_value: safe });

        // Re-query for fresh data
        const after = await getPostById(env.DB, postId);
        return {
          success: true,
          items: after ? [mapPostToItem(after as unknown as Record<string, unknown>)] : [],
          summary: { post_id: postId, updated_fields: Object.keys(safe) },
          action_summary: `Updated "${before.title || postId}": ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── BULK UPDATE POSTS ──────────────────────────────────────────────────
      case 'bulk_update_posts': {
        const filters = (args.filters ?? {}) as Record<string, unknown>;
        const changes = (args.changes  ?? {}) as Record<string, unknown>;
        const dryRun  = args.dry_run !== false;

        let clientId: string | undefined;
        if (filters.client) {
          const c = await resolveClientSlug(env.DB, filters.client as string);
          clientId = c?.id;
        }

        let matchedIds: string[];
        if (Array.isArray(filters.post_ids) && (filters.post_ids as string[]).length > 0) {
          matchedIds = filters.post_ids as string[];
        } else {
          const { rows } = await listPosts(env.DB, {
            clientId,
            status:   typeof filters.status   === 'string' ? filters.status   : undefined,
            dateFrom: typeof filters.date_from === 'string' ? filters.date_from : undefined,
            dateTo:   typeof filters.date_to   === 'string' ? filters.date_to   : undefined,
            limit: 200,
          });
          matchedIds = rows.map(p => p.id);
        }

        if (dryRun) {
          return {
            success: true,
            summary: { dry_run: true, matched: matchedIds.length, changes },
            suggestions: ['Call again with dry_run: false to apply'],
            action_summary: `DRY RUN: would update ${matchedIds.length} posts`,
          };
        }

        const FORBIDDEN = ['id', 'client_id', 'created_at'];
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(changes)) if (!FORBIDDEN.includes(k)) safe[k] = v;

        let updated = 0;
        for (const id of matchedIds) {
          try { await updatePost(env.DB, id, safe as never); updated++; } catch { /* continue */ }
        }
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_bulk_update', entity_type: 'post', entity_id: 'bulk', new_value: { updated, changes: safe } });

        return {
          success: true,
          summary: { updated, total_matched: matchedIds.length },
          action_summary: `Updated ${updated} of ${matchedIds.length} posts`,
        };
      }

      // ── SET POST STATUS ────────────────────────────────────────────────────
      case 'set_post_status': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        const status = typeof args.status  === 'string' ? args.status  : null;
        if (!postId || !status) return { success: false, error: 'post_id and status required' };

        const before = await getPostById(env.DB, postId);
        if (!before) return { success: false, error: `Post not found: ${postId}` };

        const ALLOWED = ['approved', 'rejected', 'ready', 'cancelled', 'draft', 'pending_approval'];
        if (!ALLOWED.includes(status)) return { success: false, error: `Invalid status: ${status}` };

        await setPostStatus(env.DB, postId, status);
        await writeAuditLog(env.DB, { user_id: user.userId, action: `agent_${status}_post`, entity_type: 'post', entity_id: postId, new_value: status });

        // Fresh data
        const after = await getPostById(env.DB, postId);
        return {
          success: true,
          items: after ? [mapPostToItem(after as unknown as Record<string, unknown>)] : [],
          summary: { post_id: postId, old_status: before.status, new_status: status },
          action_summary: `"${before.title || postId}" changed from ${before.status} → ${status}`,
        };
      }

      // ── PUBLISH POST ───────────────────────────────────────────────────────
      case 'publish_post': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };
        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const dryRun = args.dry_run === true;
        const job = await createPostingJob(env.DB, { triggered_by: user.userId, mode: dryRun ? 'dry_run' : 'real' });
        ctx.waitUntil(runPosting(env, { mode: dryRun ? 'dry_run' : 'real', job_id: job.id, post_ids: [postId], triggered_by: user.userId }));
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_publish_post', entity_type: 'post', entity_id: postId, new_value: dryRun ? 'dry_run' : 'real' });

        return {
          success: true,
          job_id: job.id,
          summary: { job_id: job.id, post_id: postId, mode: dryRun ? 'dry_run' : 'real' },
          action_summary: `${dryRun ? '[DRY RUN] ' : ''}Posting job ${job.id} started for "${post.title || postId}"`,
        };
      }

      // ── PUBLISH BULK ───────────────────────────────────────────────────────
      case 'publish_bulk': {
        const dryRun   = args.dry_run === true;
        const client   = typeof args.client   === 'string' ? args.client   : undefined;
        const platform = typeof args.platform === 'string' ? args.platform : undefined;
        const limit    = typeof args.limit    === 'number' ? Math.min(200, args.limit) : 50;

        const job = await createPostingJob(env.DB, { triggered_by: user.userId, mode: dryRun ? 'dry_run' : 'real', client_filter: client, platform_filter: platform, limit_count: limit });
        ctx.waitUntil(runPosting(env, { mode: dryRun ? 'dry_run' : 'real', job_id: job.id, client_filter: client, platform_filter: platform, limit, triggered_by: user.userId }));
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_publish_bulk', entity_type: 'posting_job', entity_id: job.id, new_value: { client, platform, dryRun, limit } });

        return {
          success: true,
          job_id: job.id,
          summary: { job_id: job.id, mode: dryRun ? 'dry_run' : 'real', filter: [client, platform].filter(Boolean).join('/') || 'all', limit },
          action_summary: `${dryRun ? '[DRY RUN] ' : ''}Bulk posting job ${job.id} started`,
        };
      }

      // ── FIX FAILED POSTS ───────────────────────────────────────────────────
      case 'fix_failed_posts': {
        const client  = typeof args.client === 'string' ? args.client : null;
        const postIds = Array.isArray(args.post_ids) ? (args.post_ids as string[]) : [];

        let query: string; let binds: unknown[];
        if (postIds.length > 0) {
          const ph = postIds.map(() => '?').join(',');
          query = `UPDATE posts SET status = 'ready', updated_at = ? WHERE id IN (${ph}) AND status = 'failed'`;
          binds = [Math.floor(Date.now() / 1000), ...postIds];
        } else if (client) {
          const row = await resolveClientSlug(env.DB, client);
          if (!row) return { success: false, error: `Client not found: ${client}` };
          query = `UPDATE posts SET status = 'ready', updated_at = ? WHERE client_id = ? AND status = 'failed'`;
          binds = [Math.floor(Date.now() / 1000), row.id];
        } else {
          query = `UPDATE posts SET status = 'ready', updated_at = ? WHERE status = 'failed'`;
          binds = [Math.floor(Date.now() / 1000)];
        }

        const result = await env.DB.prepare(query).bind(...binds).run();
        const count  = result.meta?.changes ?? 0;
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_fix_failed', entity_type: 'post', entity_id: 'bulk', new_value: { client, count } });

        return {
          success: true,
          summary: { reset: count, client: client ?? 'all' },
          suggestions: count > 0 ? ['Run publish_bulk to process them now'] : [],
          action_summary: `Reset ${count} failed post${count !== 1 ? 's' : ''} to ready`,
        };
      }

      // ── DELETE POST ────────────────────────────────────────────────────────
      case 'delete_post': {
        const postId   = typeof args.post_id   === 'string'  ? args.post_id   : null;
        const confirmed = args.confirmed === true;
        if (!postId)    return { success: false, error: 'post_id is required' };
        if (!confirmed) return { success: false, error: 'Set confirmed: true to delete. This is permanent.' };

        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        await env.DB.prepare('DELETE FROM post_platforms WHERE post_id = ?').bind(postId).run();
        await env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId).run();
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_delete_post', entity_type: 'post', entity_id: postId, old_value: { title: post.title, status: post.status } });

        return {
          success: true,
          summary: { deleted_post_id: postId, title: post.title },
          action_summary: `Deleted post "${post.title || postId}"`,
        };
      }

      // ── UPDATE BLOG POST ───────────────────────────────────────────────────
      case 'update_blog_post': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };
        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const BLOG_FIELDS = ['blog_content','seo_title','meta_description','target_keyword','secondary_keywords','slug','blog_excerpt','title'];
        const safe: Record<string, unknown> = {};
        for (const f of BLOG_FIELDS) {
          if (args[f] !== undefined) safe[f] = args[f];
        }
        if (Object.keys(safe).length === 0) return { success: false, error: 'No blog fields provided' };

        await updatePost(env.DB, postId, safe as never);
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_update_blog', entity_type: 'post', entity_id: postId, new_value: safe });

        const after = await getPostById(env.DB, postId);
        return {
          success: true,
          items: after ? [{ id: after.id, title: after.title, seo_title: after.seo_title, target_keyword: after.target_keyword, slug: after.slug }] : [],
          summary: { updated_fields: Object.keys(safe) },
          suggestions: ['Run publish_blog to sync to WordPress'],
          action_summary: `Blog post "${post.title}" updated: ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── PUBLISH BLOG ───────────────────────────────────────────────────────
      case 'publish_blog': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };

        const wpStatus    = typeof args.wp_status    === 'string' ? args.wp_status    : undefined;
        const forceUpdate = args.force_update === true;

        // Call the blog publish endpoint via internal fetch
        try {
          const resp = await env.SELF.fetch(
            new Request(`http://internal/api/posts/${postId}/publish-blog`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Cookie': '' },
              body: JSON.stringify({ status: wpStatus, force_update: forceUpdate }),
            })
          );
          const body = await resp.json() as Record<string, unknown>;
          if (!resp.ok) {
            return { success: false, error: `Blog publish failed: ${body['error'] ?? resp.status}` };
          }
          return {
            success: true,
            summary: { wp_post_url: body['wp_post_url'], wp_post_id: body['wp_post_id'] },
            action_summary: `Blog published to WordPress${body['wp_post_url'] ? ` — ${body['wp_post_url']}` : ''}`,
          };
        } catch (err) {
          // If SELF doesn't support it, fall through with guidance
          return {
            success: false,
            error: 'Blog publish requires browser session — use the Publish button in the post detail view, or call POST /api/posts/:id/publish-blog directly.',
            suggestions: ['Open the post in the dashboard and click "Publish Blog"'],
          };
        }
      }

      // ── UPDATE CLIENT PROFILE ──────────────────────────────────────────────
      case 'update_client_profile': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const ALLOWED = new Set([
          'canonical_name','package','status','language','manual_only',
          'upload_post_profile','notes','brand_json',
          'wp_admin_url','wp_base_url','wp_rest_base','wp_username','wp_application_password',
          'wp_default_post_status','wp_default_author_id','wp_default_category_ids',
          'wp_template_key','wp_featured_image_mode','wp_excerpt_mode',
          'phone','email','owner_name','cta_text','cta_label','industry','state',
          'brand_primary_color','brand_accent_color','logo_url',
        ]);
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k)) safe[k] = v;
        if (Object.keys(safe).length === 0) return { success: false, error: 'No valid fields to update' };

        const now = Math.floor(Date.now() / 1000);
        const sets   = [...Object.keys(safe).map(k => `${k} = ?`), 'updated_at = ?'];
        const values = [...Object.values(safe), now, client.id];
        await env.DB.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_update_client', entity_type: 'client', entity_id: client.id, new_value: safe });

        // Fresh data
        const after = await getClientBySlug(env.DB, slug);
        return {
          success: true,
          data: after,
          summary: { updated_fields: Object.keys(safe) },
          action_summary: `Updated ${client.canonical_name}: ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── UPDATE CLIENT INTELLIGENCE ─────────────────────────────────────────
      case 'update_client_intelligence': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const ALLOWED = new Set([
          'brand_voice','tone_keywords','prohibited_terms','approved_ctas',
          'content_goals','service_priorities','content_angles','seasonal_notes',
          'competitor_notes','audience_notes','primary_keyword','secondary_keywords',
          'local_seo_themes','humanization_style','monthly_snapshot','feedback_summary',
        ]);
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k)) safe[k] = v;
        if (Object.keys(safe).length === 0) return { success: false, error: 'No valid intelligence fields' };

        const now = Math.floor(Date.now() / 1000);
        const existing = await env.DB.prepare('SELECT id FROM client_intelligence WHERE client_id = ?').bind(client.id).first<{ id: string }>();

        if (!existing) {
          const id = crypto.randomUUID().replace(/-/g, '');
          const cols   = ['id', 'client_id', ...Object.keys(safe), 'created_at', 'updated_at'];
          const vals   = [id, client.id, ...Object.values(safe), now, now];
          await env.DB.prepare(`INSERT INTO client_intelligence (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...vals).run();
        } else {
          const sets   = [...Object.keys(safe).map(k => `${k} = ?`), 'updated_at = ?'];
          const values = [...Object.values(safe), now, existing.id];
          await env.DB.prepare(`UPDATE client_intelligence SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
        }

        const after = await env.DB.prepare('SELECT * FROM client_intelligence WHERE client_id = ?').bind(client.id).first();
        return {
          success: true,
          data: after,
          summary: { updated_fields: Object.keys(safe) },
          action_summary: `Intelligence updated for ${client.canonical_name}: ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── UPDATE CLIENT PLATFORMS ────────────────────────────────────────────
      case 'update_client_platforms': {
        const slug     = typeof args.client   === 'string' ? args.client   : '';
        const platform = typeof args.platform === 'string' ? args.platform : '';
        const client   = await getClientBySlug(env.DB, slug);
        if (!client)   return { success: false, error: `Client not found: ${slug}` };
        if (!platform) return { success: false, error: 'platform is required' };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const ALLOWED = new Set(['upload_post_account_id','upload_post_location_id','upload_post_board_id','page_id','paused','active']);
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k)) safe[k] = v;

        const now = Math.floor(Date.now() / 1000);
        const existing = await env.DB.prepare('SELECT id FROM client_platforms WHERE client_id = ? AND platform = ?').bind(client.id, platform).first<{ id: string }>();

        if (!existing) {
          const id   = crypto.randomUUID().replace(/-/g, '');
          const cols = ['id', 'client_id', 'platform', ...Object.keys(safe), 'created_at', 'updated_at'];
          const vals = [id, client.id, platform, ...Object.values(safe), now, now];
          await env.DB.prepare(`INSERT INTO client_platforms (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...vals).run();
        } else {
          const sets   = [...Object.keys(safe).map(k => `${k} = ?`), 'updated_at = ?'];
          const values = [...Object.values(safe), now, existing.id];
          await env.DB.prepare(`UPDATE client_platforms SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
        }

        return {
          success: true,
          summary: { client: slug, platform, fields: Object.keys(safe) },
          action_summary: `Platform ${platform} config updated for ${client.canonical_name}`,
        };
      }

      // ── ADD CLIENT SERVICE ─────────────────────────────────────────────────
      case 'add_client_service': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const name = typeof args.name   === 'string' ? args.name.trim() : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        if (!name)   return { success: false, error: 'name is required' };

        const id  = crypto.randomUUID().replace(/-/g, '');
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare('INSERT INTO client_services (id, client_id, name, description, active, sort_order, created_at, updated_at) VALUES (?,?,?,?,1,0,?,?)')
          .bind(id, client.id, name, args.description ?? null, now, now).run();

        return {
          success: true,
          summary: { service_id: id, name, client: slug },
          action_summary: `Service "${name}" added to ${client.canonical_name}`,
        };
      }

      // ── ADD CLIENT AREA ────────────────────────────────────────────────────
      case 'add_client_area': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const city = typeof args.city   === 'string' ? args.city.trim() : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        if (!city)   return { success: false, error: 'city is required' };

        const id  = crypto.randomUUID().replace(/-/g, '');
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare('INSERT INTO client_service_areas (id, client_id, city, state, primary_area, sort_order, created_at) VALUES (?,?,?,?,?,0,?)')
          .bind(id, client.id, city, args.state ?? null, args.primary_area ? 1 : 0, now).run();

        return {
          success: true,
          summary: { area_id: id, city, state: args.state ?? null },
          action_summary: `Service area "${city}${args.state ? `, ${args.state}` : ''}" added to ${client.canonical_name}`,
        };
      }

      // ── ADD CLIENT FEEDBACK ────────────────────────────────────────────────
      case 'add_client_feedback': {
        const slug = typeof args.client  === 'string' ? args.client  : '';
        const msg  = typeof args.message === 'string' ? args.message : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        if (!msg)    return { success: false, error: 'message is required' };

        const id    = crypto.randomUUID().replace(/-/g, '');
        const now   = Math.floor(Date.now() / 1000);
        const month = typeof args.month === 'string' ? args.month : new Date().toISOString().slice(0, 7);
        await env.DB.prepare('INSERT INTO client_feedback (id, client_id, month, category, sentiment, message, admin_reviewed, applied_to_intelligence, created_at) VALUES (?,?,?,?,?,?,0,0,?)')
          .bind(id, client.id, month, args.category ?? null, args.sentiment ?? null, msg, now).run();

        return {
          success: true,
          summary: { feedback_id: id, month, sentiment: args.sentiment ?? 'unset' },
          action_summary: `Feedback recorded for ${client.canonical_name} (${month})`,
        };
      }

      // ── CREATE OFFER ───────────────────────────────────────────────────────
      case 'create_offer': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        if (!title)  return { success: false, error: 'title is required' };

        const id  = crypto.randomUUID().replace(/-/g, '');
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(`
          INSERT INTO client_offers
            (id, client_id, title, description, cta_text, valid_until, active,
             gbp_coupon_code, gbp_cta_type, gbp_cta_url, recurrence, next_run_date, paused, created_at)
          VALUES (?,?,?,?,?,?,1,?,?,?,?,?,0,?)`)
          .bind(id, client.id, title,
            args.description ?? null, args.cta_text ?? null, args.valid_until ?? null,
            args.gbp_coupon_code ?? null, args.gbp_cta_type ?? null, args.gbp_cta_url ?? null,
            args.recurrence ?? 'none', args.next_run_date ?? null, now,
          ).run();

        const row = await env.DB.prepare('SELECT * FROM client_offers WHERE id = ?').bind(id).first();
        return {
          success: true,
          items: row ? [row] : [],
          summary: { offer_id: id, client: slug },
          action_summary: `Offer "${title}" created for ${client.canonical_name}`,
        };
      }

      // ── UPDATE OFFER ───────────────────────────────────────────────────────
      case 'update_offer': {
        const offerId = typeof args.offer_id === 'string' ? args.offer_id : null;
        if (!offerId) return { success: false, error: 'offer_id is required' };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const ALLOWED = new Set(['title','description','cta_text','valid_until','active','gbp_coupon_code','gbp_redeem_url','gbp_terms','gbp_cta_type','gbp_cta_url','gbp_location_id','recurrence','next_run_date','paused']);
        const entries = Object.entries(fields).filter(([k]) => ALLOWED.has(k));
        if (entries.length === 0) return { success: false, error: 'No valid offer fields' };

        const sets   = entries.map(([k]) => `${k} = ?`);
        const values = entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
        await env.DB.prepare(`UPDATE client_offers SET ${sets.join(', ')} WHERE id = ?`).bind(...values, offerId).run();

        const row = await env.DB.prepare('SELECT * FROM client_offers WHERE id = ?').bind(offerId).first();
        return {
          success: true,
          items: row ? [row] : [],
          summary: { updated_fields: entries.map(([k]) => k) },
          action_summary: `Offer ${offerId} updated: ${entries.map(([k]) => k).join(', ')}`,
        };
      }

      // ── CREATE EVENT ───────────────────────────────────────────────────────
      case 'create_event': {
        const slug  = typeof args.client === 'string' ? args.client : '';
        const title = typeof args.title  === 'string' ? args.title.trim() : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        if (!title)  return { success: false, error: 'title is required' };

        const id  = crypto.randomUUID().replace(/-/g, '');
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(`
          INSERT INTO client_events
            (id, client_id, title, description, gbp_event_title,
             gbp_event_start_date, gbp_event_start_time, gbp_event_end_date, gbp_event_end_time,
             gbp_cta_type, gbp_cta_url, gbp_location_id,
             recurrence, next_run_date, active, paused, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?)`)
          .bind(id, client.id, title,
            args.description ?? null, args.gbp_event_title ?? title,
            args.gbp_event_start_date ?? null, args.gbp_event_start_time ?? null,
            args.gbp_event_end_date ?? null, args.gbp_event_end_time ?? null,
            args.gbp_cta_type ?? null, args.gbp_cta_url ?? null, args.gbp_location_id ?? null,
            args.recurrence ?? 'once', args.next_run_date ?? null,
            now, now,
          ).run();

        const row = await env.DB.prepare('SELECT * FROM client_events WHERE id = ?').bind(id).first();
        return {
          success: true,
          items: row ? [row] : [],
          summary: { event_id: id, client: slug },
          action_summary: `Event "${title}" created for ${client.canonical_name}`,
        };
      }

      // ── UPDATE EVENT ───────────────────────────────────────────────────────
      case 'update_event': {
        const eventId = typeof args.event_id === 'string' ? args.event_id : null;
        if (!eventId) return { success: false, error: 'event_id is required' };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const ALLOWED = new Set(['title','description','gbp_event_title','gbp_event_start_date','gbp_event_start_time','gbp_event_end_date','gbp_event_end_time','gbp_cta_type','gbp_cta_url','gbp_location_id','active','paused','recurrence','next_run_date']);
        const entries = Object.entries(fields).filter(([k]) => ALLOWED.has(k));
        if (entries.length === 0) return { success: false, error: 'No valid event fields' };

        const now    = Math.floor(Date.now() / 1000);
        const sets   = [...entries.map(([k]) => `${k} = ?`), 'updated_at = ?'];
        const values = [...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)), now];
        await env.DB.prepare(`UPDATE client_events SET ${sets.join(', ')} WHERE id = ?`).bind(...values, eventId).run();

        const row = await env.DB.prepare('SELECT * FROM client_events WHERE id = ?').bind(eventId).first();
        return {
          success: true,
          items: row ? [row] : [],
          summary: { updated_fields: entries.map(([k]) => k) },
          action_summary: `Event ${eventId} updated: ${entries.map(([k]) => k).join(', ')}`,
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildSystemPrompt(env: Env): Promise<string> {
  let clients: { canonical_name: string; slug: string }[] = [];
  try {
    const all = await listClients(env.DB, 'active');
    clients = all.map(c => ({ canonical_name: c.canonical_name, slug: c.slug }));
  } catch { /* non-fatal */ }

  const today = new Date().toISOString().split('T')[0];
  const clientList = clients.map(c => `  ${c.canonical_name} → "${c.slug}"`).join('\n');

  return `You are the WebXni Marketing Platform AI Agent — an intelligent operations assistant.
TODAY'S DATE: ${today}

## ACTIVE CLIENTS
${clientList}

${AGENT_SKILLS}
${AGENT_MEMORY}
${RESPONSE_RULES}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent runner (shared by web + discord)
// ─────────────────────────────────────────────────────────────────────────────

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export async function runAgent(opts: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt: string;
  openAiKey: string;
  env: Env;
  user: SessionData;
  baseUrl: string;
  ctx: ExecutionContext;
}): Promise<AgentStructuredResponse> {
  const { message, history, systemPrompt, openAiKey, env, user, baseUrl, ctx } = opts;

  const messages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const allActionsTaken: string[]       = [];
  const allErrors:       string[]       = [];
  const allSuggestions:  string[]       = [];
  const allItems:        unknown[]      = [];
  let   allSummary:      Record<string, unknown> = {};
  const toolsUsed:       string[]       = [];
  let   finalMessage                    = '';
  let   jobId:           string | undefined;

  for (let iter = 0; iter < 2; iter++) {
    console.log(`[agent] OpenAI call iter ${iter + 1}`);

    let resp: Response;
    try {
      const ctrl = new AbortController();
      const to   = setTimeout(() => ctrl.abort(), 25_000);
      try {
        resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            temperature: 0.1,
            max_tokens: 800,
          }),
        });
      } finally { clearTimeout(to); }
    } catch (fetchErr) {
      const m = fetchErr instanceof Error && fetchErr.name === 'AbortError' ? 'OpenAI request timed out' : `Fetch error: ${String(fetchErr).slice(0, 80)}`;
      console.error('[agent] fetch error:', m);
      allErrors.push(m);
      break;
    }

    if (!resp.ok) {
      let errText = '';
      try { errText = await resp.text(); } catch { /* ignore */ }
      console.error(`[agent] OpenAI ${resp.status}:`, errText.slice(0, 100));
      allErrors.push(`OpenAI error ${resp.status}`);
      break;
    }

    let completion: { choices: Array<{ message: OpenAIMessage; finish_reason: string }> };
    try {
      completion = await resp.json() as typeof completion;
    } catch {
      allErrors.push('Failed to parse OpenAI response');
      break;
    }

    const msg = completion?.choices?.[0]?.message;
    if (!msg) { allErrors.push('Empty OpenAI response'); break; }
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      finalMessage = msg.content ?? '';
      break;
    }

    console.log('[agent] tools:', msg.tool_calls.map(t => t.function.name).join(', '));
    const toolResults: OpenAIMessage[] = [];

    for (const call of msg.tool_calls) {
      const toolName = call.function.name;
      toolsUsed.push(toolName);
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = JSON.parse(call.function.arguments) as Record<string, unknown>; } catch { /* ok */ }

      let result: ToolResult;
      try {
        result = await executeTool(toolName, toolArgs, env, user, baseUrl, ctx);
      } catch (toolErr) {
        result = { success: false, error: toolErr instanceof Error ? toolErr.message : String(toolErr) };
      }

      if (result.action_summary) allActionsTaken.push(result.action_summary);
      if (result.error)          allErrors.push(`${toolName}: ${result.error}`);
      if (result.suggestions)    allSuggestions.push(...result.suggestions);
      if (result.items)          allItems.push(...result.items);
      if (result.summary)        allSummary = { ...allSummary, ...result.summary };
      if (result.job_id)         jobId = result.job_id;

      toolResults.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result.success
          ? { data: result.data, summary: result.summary, items_count: result.items?.length }
          : { error: result.error }),
      });
    }

    messages.push(...toolResults);
  }

  if (!finalMessage) {
    finalMessage = allActionsTaken.length > 0
      ? allActionsTaken.join(' ')
      : allErrors.length > 0
        ? `Encountered an issue: ${allErrors[0]}`
        : 'Done.';
  }

  return {
    message: finalMessage,
    summary: Object.keys(allSummary).length > 0 ? allSummary : undefined,
    items:   allItems.length > 0 ? allItems : undefined,
    actions_taken:  allActionsTaken,
    suggestions:    allSuggestions.length > 0 ? allSuggestions : undefined,
    errors:         allErrors,
    tools_used:     toolsUsed,
    job_id:         jobId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent log
// ─────────────────────────────────────────────────────────────────────────────

async function logInteraction(db: D1Database, user: SessionData, message: string, result: AgentStructuredResponse) {
  try {
    const id = crypto.randomUUID().replace(/-/g, '');
    await db.prepare(
      `INSERT INTO agent_logs (id, user_id, user_email, message, response, tools_used, actions, errors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.userId, user.email, message, result.message,
      JSON.stringify(result.tools_used ?? []),
      JSON.stringify(result.actions_taken),
      JSON.stringify(result.errors),
      Math.floor(Date.now() / 1000),
    ).run();
  } catch { /* non-fatal */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/agent — web UI
// ─────────────────────────────────────────────────────────────────────────────

aiRoutes.post('/agent', async (c) => {
  const user = c.get('user');

  const fail = (message: string, errors: string[] = []) =>
    c.json({ message, actions_taken: [], errors, tools_used: [], summary: undefined, items: undefined, suggestions: undefined } as AgentStructuredResponse);

  try {
    let body: { message?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> };
    try { body = (await c.req.json()) as typeof body; } catch { return fail('Could not parse request.'); }

    const userMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!userMessage) return fail('Please send a message.');

    console.log('[agent] web request from', user.email, ':', userMessage.slice(0, 80));

    let baseUrl = 'https://marketing.webxni.com';
    try { baseUrl = new URL(c.req.url).origin; } catch { /* keep default */ }

    let openAiKey = c.env.OPENAI_API_KEY || '';
    if (!openAiKey) {
      try {
        const raw = await c.env.KV_BINDING.get('settings:system');
        const s: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
        openAiKey = s['ai_api_key'] || '';
      } catch { /* ignore */ }
    }
    if (!openAiKey) return fail('OpenAI API key not configured. Set it in Settings.', ['Missing API key']);

    let systemPrompt = '';
    try { systemPrompt = await buildSystemPrompt(c.env); } catch (err) {
      systemPrompt = `You are the WebXni Marketing Platform AI Agent. Today is ${new Date().toISOString().split('T')[0]}. ${RESPONSE_RULES}`;
    }

    const result = await runAgent({
      message: userMessage,
      history: Array.isArray(body.history) ? body.history : [],
      systemPrompt, openAiKey,
      env: c.env, user, baseUrl, ctx: c.executionCtx,
    });

    c.executionCtx.waitUntil(logInteraction(c.env.DB, user, userMessage, result));
    return c.json(result);

  } catch (outerErr) {
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error('[agent] uncaught:', msg);
    return fail('Something went wrong. Please try again.', [msg]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/dispatch — Discord-ready endpoint
// Accepts source='discord'|'web', auth via session (web) or bot_token (discord)
// ─────────────────────────────────────────────────────────────────────────────

aiRoutes.post('/dispatch', async (c) => {
  let body: {
    source?:       'web' | 'discord' | 'api';
    message?:      string;
    history?:      Array<{ role: 'user' | 'assistant'; content: string }>;
    bot_token?:    string;
    discord_user?: string;
  };
  try { body = (await c.req.json()) as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const source = body.source ?? 'api';

  // ── Auth for discord/api source ──────────────────────────────────────────
  let user: SessionData;
  if (source === 'discord' || source === 'api') {
    // Verify bot_token matches DISCORD_BOT_SECRET setting
    let botSecret = '';
    try {
      const raw = await c.env.KV_BINDING.get('settings:system');
      const s: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
      botSecret = s['discord_bot_secret'] || '';
    } catch { /* ignore */ }

    if (!botSecret || body.bot_token !== botSecret) {
      return c.json({ error: 'Unauthorized — invalid bot_token' }, 401);
    }

    // Create synthetic session for bot
    user = {
      userId:   'discord-bot',
      email:    `discord:${body.discord_user ?? 'bot'}`,
      name:     body.discord_user ?? 'Discord Bot',
      role:     'admin',
      clientId: null,
    };
  } else {
    // Fall back to session auth (same as /agent)
    user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
  }

  const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
  if (!userMessage) return c.json({ error: 'message is required' }, 400);

  let openAiKey = c.env.OPENAI_API_KEY || '';
  if (!openAiKey) {
    try {
      const raw = await c.env.KV_BINDING.get('settings:system');
      const s: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
      openAiKey = s['ai_api_key'] || '';
    } catch { /* ignore */ }
  }
  if (!openAiKey) return c.json({ error: 'OpenAI API key not configured' }, 503);

  let baseUrl = 'https://marketing.webxni.com';
  try { baseUrl = new URL(c.req.url).origin; } catch { /* keep default */ }

  let systemPrompt = '';
  try { systemPrompt = await buildSystemPrompt(c.env); } catch {
    systemPrompt = `You are the WebXni Marketing Platform AI Agent. Today is ${new Date().toISOString().split('T')[0]}. ${RESPONSE_RULES}`;
  }

  try {
    const result = await runAgent({
      message: userMessage,
      history: Array.isArray(body.history) ? body.history : [],
      systemPrompt, openAiKey,
      env: c.env, user,
      baseUrl, ctx: c.executionCtx,
    });

    c.executionCtx.waitUntil(logInteraction(c.env.DB, user, userMessage, result));

    // Format for discord: plain text message + summary
    if (source === 'discord') {
      const lines: string[] = [result.message];
      if (result.actions_taken.length > 0) lines.push('\nActions: ' + result.actions_taken.join(' | '));
      if (result.errors.length > 0) lines.push('\nErrors: ' + result.errors.join(' | '));
      if (result.suggestions?.length) lines.push('\nSuggestions: ' + result.suggestions[0]);
      return c.json({ text: lines.join('\n'), ...result });
    }

    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent/dispatch] error:', msg);
    return c.json({ message: 'Agent error — please try again.', errors: [msg], actions_taken: [] } as AgentStructuredResponse);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/agent/logs
// ─────────────────────────────────────────────────────────────────────────────

aiRoutes.get('/agent/logs', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare('SELECT id, user_email, message, response, tools_used, actions, errors, created_at FROM agent_logs ORDER BY created_at DESC LIMIT 50')
      .all<Record<string, unknown>>();
    return c.json({ logs: rows.results });
  } catch {
    return c.json({ logs: [] });
  }
});
