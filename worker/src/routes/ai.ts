/**
 * AI Agent Chat — /api/ai/agent
 *
 * Accepts a user message + conversation history, runs an agentic loop
 * using OpenAI function calling, executes tool calls against existing
 * backend logic, and returns a structured result.
 */

import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listClients,
  listPosts,
  getPostById,
  updatePost,
  setPostStatus,
  writeAuditLog,
} from '../db/queries';
import { runPosting } from '../loader/posting-run';
import { planGeneration } from '../loader/generation-run';
import { createGenerationRun, createPostingJob } from '../db/queries';

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_posts',
      description: 'Retrieve posts with optional filters. Use to show posts by date, client, or status.',
      parameters: {
        type: 'object',
        properties: {
          client:    { type: 'string', description: 'Client slug (e.g. elite-team-builders)' },
          status:    { type: 'string', description: 'draft | pending_approval | approved | ready | scheduled | posted | failed | cancelled' },
          date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
          date_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
          platform:  { type: 'string', description: 'Filter by platform (facebook, instagram, etc.)' },
          limit:     { type: 'number', description: 'Max results (default 20, max 100)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_queue',
      description: 'Get the current posting queue — all ready posts awaiting automation.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_content',
      description: 'Trigger AI content generation for one or more clients over a date range. Returns a job_id to track progress.',
      parameters: {
        type: 'object',
        properties: {
          client_slugs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Client slugs to generate for. Empty array = all active clients.',
          },
          date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
          date_to:   { type: 'string', description: 'End date YYYY-MM-DD' },
          overwrite_existing: { type: 'boolean', description: 'Replace existing posts in range (default false)' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_post',
      description: 'Update one or more fields on a single post by ID.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post ID' },
          fields: {
            type: 'object',
            description: 'Fields to update: title, master_caption, publish_date, status, etc.',
          },
        },
        required: ['post_id', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_update_posts',
      description: 'Update multiple posts at once. Always use dry_run=true first for large batches.',
      parameters: {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            description: 'Which posts to target',
            properties: {
              client:    { type: 'string' },
              status:    { type: 'string' },
              date_from: { type: 'string' },
              date_to:   { type: 'string' },
              post_ids:  { type: 'array', items: { type: 'string' } },
            },
          },
          changes: {
            type: 'object',
            description: 'Fields to apply to all matched posts',
          },
          dry_run: { type: 'boolean', description: 'Preview without saving (default true for safety)' },
        },
        required: ['filters', 'changes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_post_status',
      description: 'Change the workflow status of a post.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string' },
          status: {
            type: 'string',
            description: 'approved | rejected | ready | cancelled | draft | pending_approval',
          },
          reason: { type: 'string', description: 'Reason (required for rejection)' },
        },
        required: ['post_id', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_post',
      description: 'Immediately trigger posting for a single post.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Preview only (default false)' },
        },
        required: ['post_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_bulk',
      description: 'Run the posting automation for all ready posts. Optionally filter by client or platform.',
      parameters: {
        type: 'object',
        properties: {
          client:  { type: 'string', description: 'Client slug filter (optional)' },
          platform: { type: 'string', description: 'Platform filter (optional)' },
          limit:   { type: 'number', description: 'Max posts to process (default 50)' },
          dry_run: { type: 'boolean', description: 'Preview without actually posting' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fix_failed_posts',
      description: 'Retry failed posts by resetting them to ready status so automation can pick them up.',
      parameters: {
        type: 'object',
        properties: {
          client:   { type: 'string', description: 'Limit to a specific client slug (optional)' },
          post_ids: { type: 'array', items: { type: 'string' }, description: 'Specific post IDs to fix (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_report',
      description: 'Get post statistics and summary report.',
      parameters: {
        type: 'object',
        properties: {
          client:    { type: 'string', description: 'Client slug (omit for all clients)' },
          date_from: { type: 'string' },
          date_to:   { type: 'string' },
        },
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────────

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  action_summary?: string;
}

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
          const row = await env.DB
            .prepare('SELECT id FROM clients WHERE slug = ?')
            .bind(args.client)
            .first<{ id: string }>();
          clientId = row?.id;
          if (!clientId) return { success: false, error: `Client not found: ${args.client}` };
        }
        const { rows, total } = await listPosts(env.DB, {
          clientId,
          status:   typeof args.status === 'string' ? args.status : undefined,
          dateFrom: typeof args.date_from === 'string' ? args.date_from : undefined,
          dateTo:   typeof args.date_to   === 'string' ? args.date_to   : undefined,
          platform: typeof args.platform  === 'string' ? args.platform  : undefined,
          limit:    typeof args.limit === 'number' ? Math.min(100, args.limit) : 20,
        });
        // Enrich with client names
        const clientIds = [...new Set(rows.map(p => p.client_id))];
        const clientNames = new Map<string, string>();
        if (clientIds.length > 0) {
          const ph = clientIds.map(() => '?').join(',');
          const cl = await env.DB
            .prepare(`SELECT id, canonical_name, slug FROM clients WHERE id IN (${ph})`)
            .bind(...clientIds).all<{ id: string; canonical_name: string; slug: string }>();
          for (const r of cl.results) clientNames.set(r.id, `${r.canonical_name} (${r.slug})`);
        }
        const enriched = rows.map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          content_type: p.content_type,
          publish_date: p.publish_date,
          client: clientNames.get(p.client_id) ?? p.client_id,
          platforms: p.platforms,
          ready_for_automation: p.ready_for_automation,
          asset_delivered: p.asset_delivered,
        }));
        return {
          success: true,
          data: { posts: enriched, total },
          action_summary: `Found ${total} posts (showing ${enriched.length})`,
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
            ORDER BY p.publish_date ASC
            LIMIT 100
          `)
          .all<Record<string, unknown>>();
        const posts = rows.results;
        const overdue  = posts.filter(p => p['queue_state'] === 'overdue').length;
        const due_soon = posts.filter(p => p['queue_state'] === 'due_soon').length;
        const queued   = posts.filter(p => p['queue_state'] === 'queued').length;
        return {
          success: true,
          data: { posts, stats: { total: posts.length, overdue, due_soon, queued } },
          action_summary: `Queue: ${posts.length} posts (${overdue} overdue, ${due_soon} due soon, ${queued} queued)`,
        };
      }

      // ── GENERATE CONTENT ───────────────────────────────────────────────────
      case 'generate_content': {
        const dateFrom = typeof args.date_from === 'string' ? args.date_from : null;
        const dateTo   = typeof args.date_to   === 'string' ? args.date_to   : dateFrom;
        if (!dateFrom) return { success: false, error: 'date_from is required' };

        const clientSlugs: string[] = Array.isArray(args.client_slugs)
          ? (args.client_slugs as string[])
          : [];

        // Build dates array
        const dates: string[] = [];
        const d = new Date(dateFrom);
        const end = new Date(dateTo!);
        while (d <= end && dates.length < 60) {
          dates.push(d.toISOString().split('T')[0]);
          d.setUTCDate(d.getUTCDate() + 1);
        }

        const run = await createGenerationRun(env.DB, {
          triggered_by: user.userId,
          date_range:   `${dates[0]}:${dates[dates.length - 1]}`,
          client_filter: clientSlugs.length > 0 ? JSON.stringify(clientSlugs) : null,
          overwrite_existing: args.overwrite_existing === true,
        });

        ctx.waitUntil(
          planGeneration(env, {
            run_id:       run.id,
            client_slugs: clientSlugs,
            period_start: dates[0],
            period_end:   dates[dates.length - 1],
            triggered_by: user.userId,
            publish_time: null,
            overwrite_existing: args.overwrite_existing === true,
          }, baseUrl),
        );

        const clientLabel = clientSlugs.length > 0
          ? clientSlugs.join(', ')
          : 'all active clients';
        return {
          success: true,
          data: { job_id: run.id, date_range: `${dates[0]} → ${dates[dates.length - 1]}`, clients: clientLabel },
          action_summary: `Generation started for ${clientLabel} (${dates.length} days) — job ${run.id}`,
        };
      }

      // ── UPDATE POST ────────────────────────────────────────────────────────
      case 'update_post': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };
        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        // Strip protected fields
        const FORBIDDEN = ['id', 'client_id', 'created_at', 'generation_run_id', 'automation_slot_key'];
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (!FORBIDDEN.includes(k)) safe[k] = v;
        }
        if (Object.keys(safe).length === 0) return { success: false, error: 'No valid fields to update' };

        await updatePost(env.DB, postId, safe as never);
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_update_post', entity_type: 'post', entity_id: postId, new_value: safe });
        return {
          success: true,
          data: { post_id: postId, updated_fields: Object.keys(safe) },
          action_summary: `Updated post ${post.title || postId}: ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── BULK UPDATE POSTS ──────────────────────────────────────────────────
      case 'bulk_update_posts': {
        const filters = (args.filters ?? {}) as Record<string, unknown>;
        const changes = (args.changes ?? {}) as Record<string, unknown>;
        const dryRun  = args.dry_run !== false; // default to true for safety

        // Query matching posts
        let clientId: string | undefined;
        if (filters.client) {
          const row = await env.DB
            .prepare('SELECT id FROM clients WHERE slug = ?')
            .bind(filters.client).first<{ id: string }>();
          clientId = row?.id;
        }

        let matchedIds: string[] = [];
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
            data: { dry_run: true, matched_count: matchedIds.length, post_ids: matchedIds.slice(0, 20), changes },
            action_summary: `DRY RUN: Would update ${matchedIds.length} posts with ${Object.keys(changes).join(', ')}`,
          };
        }

        // Strip forbidden fields
        const FORBIDDEN = ['id', 'client_id', 'created_at', 'generation_run_id'];
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(changes)) {
          if (!FORBIDDEN.includes(k)) safe[k] = v;
        }

        let updated = 0;
        for (const id of matchedIds) {
          try {
            await updatePost(env.DB, id, safe as never);
            updated++;
          } catch { /* continue */ }
        }
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_bulk_update', entity_type: 'post', entity_id: 'bulk', new_value: { matched: matchedIds.length, updated, changes: safe } });
        return {
          success: true,
          data: { updated, total_matched: matchedIds.length, changes },
          action_summary: `Updated ${updated} of ${matchedIds.length} posts`,
        };
      }

      // ── SET POST STATUS ────────────────────────────────────────────────────
      case 'set_post_status': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        const status = typeof args.status  === 'string' ? args.status  : null;
        if (!postId || !status) return { success: false, error: 'post_id and status are required' };

        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const ALLOWED = ['approved', 'rejected', 'ready', 'cancelled', 'draft', 'pending_approval'];
        if (!ALLOWED.includes(status)) return { success: false, error: `Invalid status: ${status}` };

        await setPostStatus(env.DB, postId, status);
        if (status === 'approved' || status === 'rejected' || status === 'ready') {
          await writeAuditLog(env.DB, { user_id: user.userId, action: `agent_${status}_post`, entity_type: 'post', entity_id: postId, new_value: typeof args.reason === 'string' ? args.reason : status });
        }
        return {
          success: true,
          data: { post_id: postId, new_status: status },
          action_summary: `Post "${post.title || postId}" → ${status}`,
        };
      }

      // ── PUBLISH POST ───────────────────────────────────────────────────────
      case 'publish_post': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };

        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const dryRun = args.dry_run === true;
        const job = await createPostingJob(env.DB, {
          triggered_by: user.userId,
          mode: dryRun ? 'dry_run' : 'real',
        });

        ctx.waitUntil(
          runPosting(env, {
            mode: dryRun ? 'dry_run' : 'real',
            job_id: job.id,
            post_ids: [postId],
            triggered_by: user.userId,
          }),
        );

        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_publish_post', entity_type: 'post', entity_id: postId, new_value: dryRun ? 'dry_run' : 'real' });
        return {
          success: true,
          data: { job_id: job.id, post_id: postId, mode: dryRun ? 'dry_run' : 'real' },
          action_summary: `${dryRun ? '[DRY RUN] ' : ''}Publishing post "${post.title || postId}" — job ${job.id}`,
        };
      }

      // ── PUBLISH BULK ───────────────────────────────────────────────────────
      case 'publish_bulk': {
        const dryRun  = args.dry_run === true;
        const client  = typeof args.client   === 'string' ? args.client   : undefined;
        const platform = typeof args.platform === 'string' ? args.platform : undefined;
        const limit   = typeof args.limit    === 'number' ? Math.min(200, args.limit) : 50;

        const job = await createPostingJob(env.DB, {
          triggered_by:    user.userId,
          mode:            dryRun ? 'dry_run' : 'real',
          client_filter:   client,
          platform_filter: platform,
          limit_count:     limit,
        });

        ctx.waitUntil(
          runPosting(env, {
            mode:            dryRun ? 'dry_run' : 'real',
            job_id:          job.id,
            client_filter:   client,
            platform_filter: platform,
            limit,
            triggered_by:    user.userId,
          }),
        );

        const label = [client, platform].filter(Boolean).join(' / ') || 'all';
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_publish_bulk', entity_type: 'posting_job', entity_id: job.id, new_value: { label, dryRun, limit } });
        return {
          success: true,
          data: { job_id: job.id, mode: dryRun ? 'dry_run' : 'real', filter: label, limit },
          action_summary: `${dryRun ? '[DRY RUN] ' : ''}Bulk posting started for ${label} (limit ${limit}) — job ${job.id}`,
        };
      }

      // ── FIX FAILED POSTS ───────────────────────────────────────────────────
      case 'fix_failed_posts': {
        const client  = typeof args.client === 'string' ? args.client : null;
        const postIds = Array.isArray(args.post_ids) ? (args.post_ids as string[]) : [];

        let query: string;
        let binds: unknown[];

        if (postIds.length > 0) {
          const ph = postIds.map(() => '?').join(',');
          query  = `UPDATE posts SET status = 'ready', updated_at = ? WHERE id IN (${ph}) AND status = 'failed'`;
          binds  = [Math.floor(Date.now() / 1000), ...postIds];
        } else if (client) {
          const row = await env.DB.prepare('SELECT id FROM clients WHERE slug = ?').bind(client).first<{ id: string }>();
          if (!row) return { success: false, error: `Client not found: ${client}` };
          query  = `UPDATE posts SET status = 'ready', updated_at = ? WHERE client_id = ? AND status = 'failed'`;
          binds  = [Math.floor(Date.now() / 1000), row.id];
        } else {
          query  = `UPDATE posts SET status = 'ready', updated_at = ? WHERE status = 'failed'`;
          binds  = [Math.floor(Date.now() / 1000)];
        }

        const result = await env.DB.prepare(query).bind(...binds).run();
        const count  = result.meta?.changes ?? 0;
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_fix_failed', entity_type: 'post', entity_id: 'bulk', new_value: { client, post_ids: postIds, reset: count } });
        return {
          success: true,
          data: { reset_count: count, client: client ?? 'all' },
          action_summary: `Reset ${count} failed post${count !== 1 ? 's' : ''} to ready`,
        };
      }

      // ── GET REPORT ─────────────────────────────────────────────────────────
      case 'get_report': {
        const client   = typeof args.client    === 'string' ? args.client    : null;
        const dateFrom = typeof args.date_from === 'string' ? args.date_from : null;
        const dateTo   = typeof args.date_to   === 'string' ? args.date_to   : null;

        const conditions: string[] = [];
        const binds: unknown[] = [];

        if (client) {
          const row = await env.DB.prepare('SELECT id, canonical_name FROM clients WHERE slug = ?').bind(client).first<{ id: string; canonical_name: string }>();
          if (!row) return { success: false, error: `Client not found: ${client}` };
          conditions.push('p.client_id = ?');
          binds.push(row.id);
        }
        if (dateFrom) { conditions.push("substr(p.publish_date,1,10) >= ?"); binds.push(dateFrom); }
        if (dateTo)   { conditions.push("substr(p.publish_date,1,10) <= ?"); binds.push(dateTo);   }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const stats = await env.DB
          .prepare(`
            SELECT
              p.status,
              COUNT(*) AS cnt
            FROM posts p
            ${where}
            GROUP BY p.status
          `)
          .bind(...binds)
          .all<{ status: string; cnt: number }>();

        const byStatus: Record<string, number> = {};
        let total = 0;
        for (const row of stats.results) {
          byStatus[row.status] = row.cnt;
          total += row.cnt;
        }

        const clientStats = client ? null : await env.DB
          .prepare(`
            SELECT c.canonical_name AS name, c.slug, COUNT(p.id) AS cnt
            FROM posts p JOIN clients c ON c.id = p.client_id
            ${where}
            GROUP BY p.client_id
            ORDER BY cnt DESC LIMIT 10
          `)
          .bind(...binds)
          .all<{ name: string; slug: string; cnt: number }>();

        return {
          success: true,
          data: { total, by_status: byStatus, top_clients: clientStats?.results ?? null, filters: { client, date_from: dateFrom, date_to: dateTo } },
          action_summary: `Report: ${total} total posts`,
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildSystemPrompt(env: Env): Promise<string> {
  const clients = await listClients(env.DB, 'active');
  const clientList = clients.map(c => `  - ${c.canonical_name} → slug: "${c.slug}"`).join('\n');
  const today = new Date().toISOString().split('T')[0];

  return `You are the WebXni Marketing Platform AI Agent — an intelligent operator assistant for a social media marketing agency.

TODAY'S DATE: ${today}

## YOUR ROLE
You control the platform using natural language. You can:
- Generate AI content for clients
- View, filter, and update posts
- Manage the posting queue
- Approve, reject, or change post status
- Trigger posting automation
- Retry failed posts
- Show reports and statistics

## ACTIVE CLIENTS
${clientList}

## POST STATUS LIFECYCLE
draft → pending_approval → approved → ready → scheduled → posted
Also: failed, cancelled

## RULES
1. For large destructive operations (bulk updates, bulk publish), use dry_run=true first and report what would happen, then ask for confirmation before executing for real.
2. Always resolve client names to their slugs before calling tools.
3. Normalize all date references to YYYY-MM-DD format.
4. If you're unsure what the user wants, ask a clarifying question instead of guessing.
5. After executing tools, summarize results clearly — what was done, how many items affected, any errors.
6. "Next week" means 7 days starting from tomorrow. "Today" = ${today}.
7. For generate_content, date ranges should match the client's posting schedule (typically 3-5 posts per week).

## RESPONSE FORMAT
After all tool calls complete, respond with a clear, concise summary. Use structured formatting:
- Lead with what was done
- Include counts (X posts, Y clients)
- List any errors
- Suggest next steps if relevant

Be operational. Be clear. Don't be verbose.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent log writer
// ─────────────────────────────────────────────────────────────────────────────

async function writeAgentLog(
  db: D1Database,
  user: SessionData,
  message: string,
  response: string,
  toolsUsed: string[],
  actions: string[],
  errors: string[],
) {
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `INSERT INTO agent_logs (id, user_id, user_email, message, response, tools_used, actions, errors, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, user.userId, user.email,
        message, response,
        JSON.stringify(toolsUsed),
        JSON.stringify(actions),
        JSON.stringify(errors),
        now,
      )
      .run();
  } catch {
    // Non-fatal — table may not exist yet
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai/agent
// ─────────────────────────────────────────────────────────────────────────────

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AgentRequest {
  message: string;
  history?: ConversationMessage[];
}

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

aiRoutes.post('/agent', async (c) => {
  const user = c.get('user');

  // ── Safe response helper ────────────────────────────────────────────────
  const safeResponse = (
    message: string,
    actions_taken: string[] = [],
    errors: string[]        = [],
    tools_used: string[]    = [],
  ) => c.json({ message, actions_taken, data: {}, errors, tools_used });

  // ── Global try/catch — handler must never crash ─────────────────────────
  try {
    console.log('[agent] request received — user:', user?.email ?? 'unknown');

    // ── 1. Parse and validate request body ─────────────────────────────────
    let body: AgentRequest;
    try {
      body = (await c.req.json()) as AgentRequest;
    } catch {
      console.log('[agent] invalid JSON body');
      return safeResponse('I could not parse your request. Please try again.');
    }

    const userMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!userMessage) {
      console.log('[agent] empty message');
      return safeResponse('Please send a message so I can help you.');
    }

    console.log('[agent] message:', userMessage.slice(0, 100));

    // ── 2. Resolve base URL safely ──────────────────────────────────────────
    let baseUrl = 'https://marketing.webxni.com';
    try {
      baseUrl = new URL(c.req.url).origin;
    } catch {
      // keep default
    }

    // ── 2b. Resolve OpenAI API key (secret → KV fallback) ──────────────────
    let openAiKey = c.env.OPENAI_API_KEY || '';
    if (!openAiKey) {
      try {
        const settingsRaw = await c.env.KV_BINDING.get('settings:system');
        const settings: Record<string, string> = settingsRaw ? JSON.parse(settingsRaw) as Record<string, string> : {};
        openAiKey = settings['ai_api_key'] || '';
      } catch { /* ignore */ }
    }
    if (!openAiKey) {
      console.error('[agent] OpenAI API key not configured');
      return safeResponse(
        'OpenAI API key is not configured. Set the OPENAI_API_KEY secret or configure it in Settings.',
        [],
        ['OpenAI API key not configured'],
      );
    }
    console.log('[agent] OpenAI key resolved, length:', openAiKey.length);

    // ── 3. Build system prompt ──────────────────────────────────────────────
    console.log('[agent] building system prompt');
    let systemPrompt = '';
    try {
      systemPrompt = await buildSystemPrompt(c.env);
    } catch (err) {
      console.error('[agent] system prompt error:', err);
      systemPrompt = `You are the WebXni Marketing Platform AI Agent. Today is ${new Date().toISOString().split('T')[0]}.`;
    }
    console.log('[agent] system prompt ready, length:', systemPrompt.length);

    // ── 4. Build message thread ─────────────────────────────────────────────
    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
    ];
    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    for (const h of history) {
      if (h.role && h.content) messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: userMessage });

    // ── 5. Agentic loop — max 2 iterations ─────────────────────────────────
    const allActionsTaken: string[] = [];
    const allErrors: string[]       = [];
    const toolsUsed: string[]       = [];
    let finalMessage                = '';
    const MAX_ITER                  = 2;

    for (let iteration = 0; iteration < MAX_ITER; iteration++) {
      console.log(`[agent] OpenAI call — iteration ${iteration + 1}/${MAX_ITER}`);

      // ── OpenAI call with timeout ──────────────────────────────────────────
      let openAIResponse: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000); // 25s timeout
        try {
          openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${openAiKey}`,
            },
            body: JSON.stringify({
              model:       'gpt-4o-mini',
              messages,
              tools:       AGENT_TOOLS,
              tool_choice: 'auto',
              temperature: 0.2,
              max_tokens:  1200,
            }),
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (fetchErr) {
        const isTimeout = fetchErr instanceof Error && fetchErr.name === 'AbortError';
        const errMsg = isTimeout ? 'OpenAI request timed out' : `OpenAI fetch error: ${String(fetchErr).slice(0, 100)}`;
        console.error('[agent] fetch error:', errMsg);
        allErrors.push(errMsg);
        break;
      }

      console.log('[agent] OpenAI response status:', openAIResponse.status);

      // ── Handle non-200 from OpenAI — never return 502 ────────────────────
      if (!openAIResponse.ok) {
        let errText = '';
        try { errText = await openAIResponse.text(); } catch { /* ignore */ }
        const errMsg = `OpenAI error ${openAIResponse.status}: ${errText.slice(0, 150)}`;
        console.error('[agent]', errMsg);
        allErrors.push(errMsg);
        break; // exit loop, return whatever we have
      }

      // ── Parse completion ──────────────────────────────────────────────────
      let completion: { choices: Array<{ message: OpenAIMessage; finish_reason: string }> };
      try {
        completion = await openAIResponse.json() as typeof completion;
      } catch (parseErr) {
        console.error('[agent] JSON parse error:', parseErr);
        allErrors.push('Failed to parse OpenAI response');
        break;
      }

      const choice = completion?.choices?.[0];
      if (!choice?.message) {
        console.error('[agent] no choice in completion');
        allErrors.push('Empty response from OpenAI');
        break;
      }

      const assistantMsg = choice.message;
      messages.push(assistantMsg);

      // ── No tool calls → final answer ──────────────────────────────────────
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        finalMessage = typeof assistantMsg.content === 'string' ? assistantMsg.content : '';
        console.log('[agent] final answer received, length:', finalMessage.length);
        break;
      }

      console.log('[agent] tool calls:', assistantMsg.tool_calls.map(t => t.function.name).join(', '));

      // ── Execute tool calls ────────────────────────────────────────────────
      const toolResultMessages: OpenAIMessage[] = [];

      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;
        toolsUsed.push(toolName);
        console.log('[agent] executing tool:', toolName);

        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          toolArgs = {};
        }

        let result: ToolResult;
        try {
          result = await executeTool(toolName, toolArgs, c.env, user, baseUrl, c.executionCtx);
        } catch (toolErr) {
          const msg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          console.error(`[agent] tool ${toolName} threw:`, msg);
          result = { success: false, error: msg };
        }

        console.log(`[agent] tool ${toolName} result — success: ${result.success}`);
        if (result.action_summary) allActionsTaken.push(result.action_summary);
        if (result.error)          allErrors.push(`${toolName}: ${result.error}`);

        toolResultMessages.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          content:      JSON.stringify(
            result.success
              ? (result.data ?? {})
              : { error: result.error ?? 'Tool failed' }
          ),
        });
      }

      messages.push(...toolResultMessages);
    } // end agentic loop

    // ── 6. Compose final message ────────────────────────────────────────────
    if (!finalMessage) {
      finalMessage = allActionsTaken.length > 0
        ? allActionsTaken.join('\n')
        : allErrors.length > 0
          ? `I encountered some issues: ${allErrors.join('; ')}`
          : 'Done.';
    }

    console.log('[agent] responding — actions:', allActionsTaken.length, 'errors:', allErrors.length);

    // ── 7. Log interaction (non-blocking) ───────────────────────────────────
    c.executionCtx.waitUntil(
      writeAgentLog(c.env.DB, user, userMessage, finalMessage, toolsUsed, allActionsTaken, allErrors),
    );

    return safeResponse(finalMessage, allActionsTaken, allErrors, toolsUsed);

  } catch (outerErr) {
    // Global fallback — must never 502
    const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error('[agent] uncaught error:', msg);
    return safeResponse(
      'Something went wrong on my end. Please try again.',
      [],
      [msg],
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/agent/logs — recent agent conversation logs
// ─────────────────────────────────────────────────────────────────────────────

aiRoutes.get('/agent/logs', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`SELECT id, user_email, message, response, tools_used, actions, errors, created_at
                FROM agent_logs ORDER BY created_at DESC LIMIT 50`)
      .all<Record<string, unknown>>();
    return c.json({ logs: rows.results });
  } catch {
    return c.json({ logs: [] });
  }
});
