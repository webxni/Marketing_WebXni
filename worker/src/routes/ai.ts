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

import { Hono, type Context } from 'hono';
import type { Env, SessionData } from '../types';
import {
  listClients, getClientBySlug,
  listPosts, getPostById, updatePost, setPostStatus,
  createPost, createGenerationRun, createPostingJob, getGenerationRunById,
  createApprovedCommandJob, appendGenerationError, appendGenerationLog,
  advanceGenerationSlot, finalizeGenerationRun, storeGenerationPlan, updateGenerationProgress,
  writeAuditLog,
  listContentRequests, getContentRequestById, createContentRequest, updateContentRequest,
  listClientTopics, addClientTopics, markClientTopicUsed,
} from '../db/queries';
import { runPosting }    from '../loader/posting-run';
import { prepareGenerationPlan, prebuildApprovedTerminalSlotRequests, resumeGenerationRun, type PreparedApprovedSlotRequest } from '../loader/generation-run';
import { runFetchUrls } from './run';
import { createContentWithImage } from '../loader/autonomous-content';
import { discordSend, DISCORD_COLORS } from '../services/discord';
import { syncUploadPostClientPlatforms } from '../modules/uploadpost-platform-sync';
import { publishBlogPost } from '../modules/blog-publishing';
import {
  AGENT_SKILLS, AGENT_MEMORY, RESPONSE_RULES,
  CLIENT_EXPERTISE, BUYER_PERSONAS, NL_INTENT_MAP, QUALITY_REVIEW_RULES,
} from '../agent/context';

export const aiRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const MCP_AGENT_USER: SessionData = {
  userId: 'agent-mcp',
  email: 'agent-mcp@internal.webxni',
  name: 'WebXni MCP Agent',
  role: 'admin',
  clientId: null,
};

function requireMcpBearer(c: Context<{ Bindings: Env; Variables: { user: SessionData } }>): boolean {
  const expected = c.env.AGENT_INTERNAL_TOKEN?.trim();
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return !!expected && token === expected;
}

const AGENT_CLIENT_FIELDS = new Set([
  'canonical_name','package','status','language','manual_only',
  'requires_approval_from','owner_group','never_mix_with',
  'upload_post_profile','notes','brand_json',
  'wp_domain','wp_url','wp_auth','wp_template',
  'wp_admin_url','wp_base_url','wp_rest_base','wp_username','wp_application_password',
  'wp_default_post_status','wp_default_author_id','wp_default_category_ids',
  'wp_template_key','wp_featured_image_mode','wp_excerpt_mode',
  'notion_page_id','logo_r2_key','logo_url','brand_primary_color','brand_accent_color',
  'phone','email','owner_name','cta_text','cta_label','industry','state',
]);

const AGENT_CLIENT_INTELLIGENCE_FIELDS = new Set([
  'brand_voice','tone_keywords','prohibited_terms','approved_ctas',
  'content_goals','service_priorities','content_angles','seasonal_notes',
  'competitor_notes','audience_notes','primary_keyword','secondary_keywords',
  'local_seo_themes','humanization_style','monthly_snapshot','feedback_summary',
]);

const AGENT_PLATFORM_FIELDS = new Set([
  'account_id','username','page_id','upload_post_board_id','upload_post_location_id',
  'privacy_level','privacy_status','paused','paused_reason','paused_since','notes',
  'profile_url','profile_username','connection_status','yt_channel_id','linkedin_urn',
]);

function slugifyClientName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function collectAllowedFields(fields: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.has(k)) safe[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return safe;
}

function hasTextValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeAgentClientFields(
  fields: Record<string, unknown>,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const safe = collectAllowedFields(fields, AGENT_CLIENT_FIELDS);
  for (const key of ['canonical_name', 'package', 'status']) {
    if (safe[key] === null || safe[key] === undefined || safe[key] === '') {
      delete safe[key];
    }
  }
  if (mode === 'create') {
    if (!hasTextValue(safe.package)) safe.package = 'medium';
    if (!hasTextValue(safe.status)) safe.status = 'active';
  }
  return safe;
}

async function resolveAgentClient(env: Env, value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const direct = await getClientBySlug(env.DB, raw);
  if (direct) return direct;
  const slugified = slugifyClientName(raw);
  if (slugified && slugified !== raw) {
    const bySlug = await getClientBySlug(env.DB, slugified);
    if (bySlug) return bySlug;
  }
  const clients = await listClients(env.DB, 'all');
  const normalized = raw.toLowerCase();
  const normalizedSlug = slugifyClientName(raw);
  const exact = clients.find((client) => client.canonical_name.toLowerCase() === normalized);
  if (exact) return exact;
  const byCanonicalSlug = clients.find((client) => slugifyClientName(client.canonical_name) === normalizedSlug);
  if (byCanonicalSlug) return byCanonicalSlug;
  const partial = clients.filter((client) => {
    const name = client.canonical_name.toLowerCase();
    return name.includes(normalized) || normalized.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}

function collectPlatformFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...fields };
  if ('upload_post_account_id' in normalized && !('account_id' in normalized)) {
    normalized.account_id = normalized.upload_post_account_id;
  }
  return collectAllowedFields(normalized, AGENT_PLATFORM_FIELDS);
}

async function resolveAgentOpenAiKey(env: Env): Promise<string> {
  let openAiKey = env.OPENAI_API_KEY || '';
  if (!openAiKey) {
    try {
      const raw = await env.KV_BINDING.get('settings:system');
      const s: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
      openAiKey = s['ai_api_key'] || '';
    } catch { /* ignore */ }
  }
  return openAiKey;
}

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

interface ApprovedTerminalJobArgs {
  run_id: string;
  client_slugs: string[];
  period_start: string;
  period_end: string;
  content_only: true;
  generate_images: false;
  provider: 'terminal';
  requested_in: 'agent';
  prepared_slots?: PreparedApprovedSlotRequest[];
}

function normalizeAgentPostUpdateFields(args: Record<string, unknown>): Record<string, unknown> {
  const fromFields = (args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields))
    ? { ...(args.fields as Record<string, unknown>) }
    : {};
  const topLevel = Object.fromEntries(
    Object.entries(args).filter(([key]) => !['post_id', 'fields'].includes(key)),
  );
  const merged = { ...topLevel, ...fromFields };

  if (typeof merged['caption'] === 'string' && !merged['master_caption']) {
    merged['master_caption'] = merged['caption'];
  }
  delete merged['caption'];

  if (Array.isArray(merged['platforms'])) {
    merged['platforms'] = JSON.stringify(merged['platforms']);
  }

  if (typeof merged['publish_date'] === 'string') {
    const value = merged['publish_date'].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) merged['publish_date'] = `${value}T10:00`;
  }

  const forbidden = new Set([
    'id',
    'client_id',
    'created_at',
    'generation_run_id',
    'automation_slot_key',
    'post_id',
  ]);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (forbidden.has(key)) continue;
    safe[key] = value;
  }
  return safe;
}

interface AgentBatchSlot {
  topic?: string;
  topicId: string | null;
  publishDate: string;
}

interface AgentBatchRunOptions {
  clientSlug: string;
  contentType: 'image' | 'reel' | 'video' | 'blog';
  platforms?: string[];
  status: 'draft' | 'pending_approval';
  slots: AgentBatchSlot[];
  runId: string;
  userEmail: string;
}

async function runAgentBatchContent(
  env: Env,
  openAiKey: string,
  options: AgentBatchRunOptions,
): Promise<void> {
  const total = options.slots.length;
  let created = 0;
  let failed = 0;
  let skipped = 0;

  await appendGenerationLog(
    env.DB,
    options.runId,
    'START',
    `Agent batch started for ${options.clientSlug} with ${total} ${options.contentType} slot(s)`,
  );

  for (let idx = 0; idx < options.slots.length; idx++) {
    const slot = options.slots[idx];
    const label = `${slot.publishDate} / ${options.contentType}${slot.topic ? ` / ${slot.topic}` : ''}`;
    await updateGenerationProgress(env.DB, options.runId, {
      current_client: options.clientSlug,
      current_post: label,
      completed: created + failed + skipped,
      total_estimated: total,
      errors: failed,
      clients_done: 0,
      clients_total: 1,
    });
    await appendGenerationLog(env.DB, options.runId, 'INFO', `Slot ${idx + 1}/${total}: ${label}`);

    let saved = false;
    let lastError = '';
    const attemptLimit = slot.topic ? 1 : 3;

    for (let attempt = 1; attempt <= attemptLimit; attempt++) {
      try {
        const result = await createContentWithImage(
          env,
          {
            clientSlug: options.clientSlug,
            platforms: options.platforms,
            contentType: options.contentType,
            topicOverride: slot.topic,
            publishDate: slot.publishDate,
            status: options.status,
            notifyDiscord: true,
            triggeredBy: `agent:batch:${options.userEmail}`,
            reuseSimilarDraft: false,
          },
          openAiKey,
        );
        if (slot.topicId) {
          try { await markClientTopicUsed(env.DB, slot.topicId, result.postId); }
          catch { /* non-fatal */ }
        }
        created++;
        saved = true;
        await appendGenerationLog(
          env.DB,
          options.runId,
          'SAVED',
          `Created post ${result.postId} for slot ${idx + 1}/${total}`,
        );
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const duplicateConflict = lastError.includes('Duplicate draft conflict');
        if (duplicateConflict && !slot.topic && attempt < attemptLimit) {
          await appendGenerationLog(
            env.DB,
            options.runId,
            'WARN',
            `Retrying slot ${idx + 1}/${total} after duplicate conflict (attempt ${attempt}/${attemptLimit})`,
          );
          continue;
        }
        if (duplicateConflict) skipped++;
        else failed++;
        await appendGenerationError(env.DB, options.runId, `Slot ${idx + 1}/${total} failed: ${lastError}`);
        break;
      }
    }

    await advanceGenerationSlot(
      env.DB,
      options.runId,
      idx + 1,
      created,
      JSON.stringify({
        current_client: options.clientSlug,
        current_post: label,
        completed: created + failed + skipped,
        total_estimated: total,
        errors: failed,
        clients_done: 1,
        clients_total: 1,
        skipped,
        failed,
        created,
      }),
    );

    if (!saved && lastError) {
      await appendGenerationLog(env.DB, options.runId, lastError.includes('Duplicate draft conflict') ? 'WARN' : 'ERROR', lastError);
    }
  }

  const status = created === 0 && (failed > 0 || skipped > 0)
    ? 'failed'
    : (failed > 0 || skipped > 0 ? 'completed_with_errors' : 'completed');
  await finalizeGenerationRun(
    env.DB,
    options.runId,
    status,
    created,
    failed > 0 || skipped > 0 ? `created=${created}; skipped=${skipped}; failed=${failed}` : null,
  );
  await appendGenerationLog(
    env.DB,
    options.runId,
    'DONE',
    `Agent batch finished: created=${created}, skipped=${skipped}, failed=${failed}`,
  );
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
      description: 'Trigger package-driven AI content generation for one or all active clients over a date range using the approved terminal workflow. Use this for "today content for all customers", weekly generation, or bulk package-based generation.',
      parameters: {
        type: 'object',
        properties: {
          client_slugs:       { type: 'array', items: { type: 'string' }, description: 'Empty = all active' },
          date_from:          { type: 'string', description: 'YYYY-MM-DD' },
          date_to:            { type: 'string', description: 'YYYY-MM-DD' },
          provider:           { type: 'string', description: 'terminal' },
          overwrite_existing: { type: 'boolean' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_generation_run',
      description: 'Resume a partial, timed out, failed, or cancelled generation run from its saved current slot.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'Generation run ID' },
        },
        required: ['run_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_post_for_platform',
      description: 'Create one manual stub post targeting exactly one platform for a client. Never use this for multi-platform requests.',
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
      description: 'Update fields on a single post. Use this whenever the user asks to edit, revise, rewrite, reschedule, retitle, or change a post. Accept either fields:{...} or direct editable keys like title, master_caption, publish_date, status, platforms, cap_*, seo_title, target_keyword, meta_description, slug, blog_excerpt, or blog_content. Returns fresh post data after update.',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post UUID to edit.' },
          fields:  { type: 'object', description: 'Editable fields object. Optional if you pass editable keys at the top level.' },
          title: { type: 'string', description: 'Update the post title/headline.' },
          caption: { type: 'string', description: 'Alias for master_caption.' },
          master_caption: { type: 'string', description: 'Update the main caption/body.' },
          publish_date: { type: 'string', description: 'New publish date/time. Accept YYYY-MM-DD or YYYY-MM-DDTHH:MM.' },
          status: { type: 'string', description: 'draft|pending_approval|approved|ready|scheduled|posted|failed|cancelled' },
          content_type: { type: 'string', description: 'image|video|reel|blog|text' },
          platforms: { type: 'array', items: { type: 'string' }, description: 'Replace the target platforms list.' },
          ai_image_prompt: { type: 'string', description: 'Update the image/design prompt.' },
          blog_content: { type: 'string', description: 'Update full blog body content.' },
          blog_excerpt: { type: 'string', description: 'Update blog excerpt/summary.' },
          seo_title: { type: 'string', description: 'Update SEO title.' },
          target_keyword: { type: 'string', description: 'Update target keyword.' },
          secondary_keywords: { type: 'string', description: 'Update comma-separated secondary keywords.' },
          meta_description: { type: 'string', description: 'Update SEO meta description.' },
          slug: { type: 'string', description: 'Update blog slug.' },
        },
        required: ['post_id'],
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
      name: 'create_client_profile',
      description: 'Create a new client profile when Marvin explicitly asks for a new client. Can also save services, service areas, and client intelligence. If required fields are missing, ask Marvin a question before calling.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Lowercase URL slug, e.g. nova-home-builders-llc. If omitted, derive from canonical_name.' },
          canonical_name: { type: 'string', description: 'Client/business name' },
          fields: {
            type: 'object',
            description: 'Writable client fields: package, status, language, manual_only, upload_post_profile, notes, brand_json, phone, email, owner_name, cta_text, cta_label, industry, state, brand_primary_color, brand_accent_color, logo_url, wp_* fields.',
          },
          services: {
            type: 'array',
            items: { type: 'string' },
            description: 'Services/categories to add to client_services.',
          },
          service_areas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                city: { type: 'string' },
                state: { type: 'string' },
                primary_area: { type: 'boolean' },
              },
              required: ['city'],
            },
            description: 'Cities/counties/areas to add to client_service_areas.',
          },
          intelligence: {
            type: 'object',
            description: 'Optional client_intelligence fields: brand_voice, tone_keywords, prohibited_terms, approved_ctas, content_goals, service_priorities, content_angles, audience_notes, primary_keyword, secondary_keywords, local_seo_themes, humanization_style.',
          },
        },
        required: ['canonical_name'],
      },
    },
  },
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
      name: 'delete_client_profile',
      description: 'Archive or permanently delete a client profile only when Marvin explicitly asks. Requires confirmed=true. Default mode archives by setting status=inactive. Hard delete is blocked if posts exist.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          confirmed: { type: 'boolean', description: 'Must be true to archive/delete.' },
          hard_delete: { type: 'boolean', description: 'Default false. If true, permanently deletes only when no posts exist.' },
        },
        required: ['client', 'confirmed'],
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
      description: 'Upsert a platform configuration for a client (Upload-Post account/location/board IDs, page IDs, usernames, profile URLs, pause state, connection notes, etc.).',
      parameters: {
        type: 'object',
        properties: {
          client:   { type: 'string', description: 'Client slug' },
          platform: { type: 'string', description: 'facebook|instagram|linkedin|tiktok|pinterest|bluesky|x|threads|youtube|google_business' },
          fields: {
            type: 'object',
            description: 'account_id or upload_post_account_id, username, page_id, upload_post_location_id, upload_post_board_id, privacy_level, privacy_status, paused, paused_reason, notes, profile_url, profile_username, connection_status, yt_channel_id, linkedin_urn',
          },
        },
        required: ['client', 'platform', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_upload_post_platforms',
      description: 'Pull connected platform account information from Upload-Post into the client platform tab. Use during new client onboarding after upload_post_profile is known, or when Marvin asks to sync connected platforms.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug. Omit only when Marvin asks to sync all active clients.' },
          dry_run: { type: 'boolean', description: 'Preview only; do not write changes.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_client_platform',
      description: 'Delete a platform configuration row from a client when Marvin explicitly asks to remove/disconnect that platform tab.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          platform: { type: 'string', description: 'facebook|instagram|linkedin|tiktok|pinterest|bluesky|x|threads|youtube|google_business' },
          confirmed: { type: 'boolean', description: 'Must be true to delete.' },
        },
        required: ['client', 'platform', 'confirmed'],
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
      name: 'update_client_service',
      description: 'Update a client service by service_id or by exact/current service name.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          service_id: { type: 'string' },
          current_name: { type: 'string', description: 'Existing service name when service_id is unknown.' },
          fields: {
            type: 'object',
            description: 'name, description, active, sort_order',
          },
        },
        required: ['client', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_client_service',
      description: 'Delete or deactivate a client service by service_id or exact/current service name. Requires confirmed=true.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          service_id: { type: 'string' },
          current_name: { type: 'string', description: 'Existing service name when service_id is unknown.' },
          confirmed: { type: 'boolean' },
          deactivate_only: { type: 'boolean', description: 'Default true. Sets active=0 instead of deleting.' },
        },
        required: ['client', 'confirmed'],
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
      name: 'update_client_area',
      description: 'Update a client service area by area_id or by exact/current city and optional state.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          area_id: { type: 'string' },
          current_city: { type: 'string' },
          current_state: { type: 'string' },
          fields: {
            type: 'object',
            description: 'city, state, zip, primary_area, sort_order',
          },
        },
        required: ['client', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_client_area',
      description: 'Delete a client service area by area_id or exact/current city and optional state. Requires confirmed=true.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string', description: 'Client slug' },
          area_id: { type: 'string' },
          current_city: { type: 'string' },
          current_state: { type: 'string' },
          confirmed: { type: 'boolean' },
        },
        required: ['client', 'confirmed'],
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
  {
    type: 'function',
    function: {
      name: 'delete_offer',
      description: 'Delete or deactivate a GBP offer. Requires confirmed=true. Prefer deactivation unless Marvin asks for permanent removal.',
      parameters: {
        type: 'object',
        properties: {
          offer_id: { type: 'string' },
          confirmed: { type: 'boolean' },
          deactivate_only: { type: 'boolean', description: 'Default true. Sets active=0 and paused=1 instead of deleting.' },
        },
        required: ['offer_id', 'confirmed'],
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
  {
    type: 'function',
    function: {
      name: 'delete_event',
      description: 'Delete or deactivate a GBP event. Requires confirmed=true. Prefer deactivation unless Marvin asks for permanent removal.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string' },
          confirmed: { type: 'boolean' },
          deactivate_only: { type: 'boolean', description: 'Default true. Sets active=0 and paused=1 instead of deleting.' },
        },
        required: ['event_id', 'confirmed'],
      },
    },
  },

  // ── MEDIA & QUICK PUBLISH ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'attach_asset_to_post',
      description: 'Attach a Discord-uploaded asset (r2_key) to a post. Sets asset_delivered=1 so the post is ready for automation.',
      parameters: {
        type: 'object',
        properties: {
          post_id:    { type: 'string', description: 'Post ID to attach the asset to' },
          r2_key:     { type: 'string', description: 'The R2 storage key from the uploaded asset' },
          asset_type: { type: 'string', description: 'image|video|reel (default: image)' },
        },
        required: ['post_id', 'r2_key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_captions',
      description: 'Generate AI captions for a post for one or more social media platforms in one call. Saves captions directly to the post.',
      parameters: {
        type: 'object',
        properties: {
          post_id:   { type: 'string' },
          platforms: {
            type: 'array',
            items: { type: 'string' },
            description: 'facebook|instagram|linkedin|x|threads|tiktok|pinterest|bluesky|google_business|youtube',
          },
        },
        required: ['post_id', 'platforms'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_and_publish',
      description: 'Approve a post and immediately trigger social media posting in one step (sets ready + ready_for_automation + triggers job).',
      parameters: {
        type: 'object',
        properties: {
          post_id: { type: 'string' },
          dry_run: { type: 'boolean', description: 'Default false. Set true to simulate without sending.' },
        },
        required: ['post_id'],
      },
    },
  },
  // ── AUTONOMOUS CONTENT + IMAGE ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_content_with_image',
      description: `Autonomously create a post: write high-quality content + Spanish designer prompt + save as pending_approval + notify Discord. AI image generation is optional and off by default.
Use for: "Create content for X about Y", "Make an Instagram post for Z", "Create a Google Business post with image", "Create a blog post answering Q".
If the user asks for one piece of content on multiple platforms, call this tool once with a platforms array. Do not create one separate post per platform unless the user explicitly asks for separate posts.
If the user says "post/reel", "post/reels", "content for today", or does not name exact platforms, omit platforms so the backend selects all connected compatible platforms allowed by the client's package.
If Marvin pastes a caption or raw copy to use, pass it in source_caption and use topic only for a short label/angle.
Runs content generation in the background — returns immediately.
If no topic is specified, the system researches the best topic automatically.
If platforms are omitted, the backend uses the client's package platforms + connected platform config + content-type compatibility.`,
      parameters: {
        type: 'object',
        properties: {
          client:        { type: 'string',  description: 'Client slug (required)' },
          platforms:     { type: 'array',   items: { type: 'string' }, description: 'facebook|instagram|linkedin|google_business|x|threads|tiktok|pinterest|bluesky|youtube. Omit unless Marvin named exact platforms; omitted means backend chooses package-compatible connected platforms.' },
          content_type:  { type: 'string',  description: 'image|reel|video|blog (default: image)' },
          topic:         { type: 'string',  description: 'Specific topic, question, or angle to write about. Leave empty for automatic research.' },
          source_caption:{ type: 'string',  description: 'Raw caption/copy pasted by Marvin. Preserve it as source material and adapt it into all selected platform captions.' },
          publish_date:  { type: 'string',  description: 'YYYY-MM-DD or YYYY-MM-DDTHH:MM. Default: today at 10:00.' },
          status:        { type: 'string',  description: 'pending_approval (default) or draft' },
          notify_discord:{ type: 'boolean', description: 'Send Discord notification on creation (default: true)' },
          generate_image:{ type: 'boolean', description: 'Optional. true only when Marvin explicitly requests AI image generation. Default false; designer prompt is saved instead.' },
        },
        required: ['client'],
      },
    },
  },

  // ── BATCH CONTENT CREATION ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'batch_create_content',
      description: `Create multiple posts for a client in one call. Each post runs full content+image generation in a persistent background run.
Use for: "Create 5 posts about bathroom remodeling this week", "Create 10 blog posts from this topic list", "Generate content from this question list".
Pass either:
  • topics[] — one post per topic (count = topics.length)
  • use_queue: true — consumes pending topics from client_topics (priority DESC)
  • topic + count — single topic, N posts with slight angle variation
  • count only — auto-researches each post independently
Supports up to 60 posts per call and returns a run_id with created/skipped/failed progress.`,
      parameters: {
        type: 'object',
        properties: {
          client:        { type: 'string',  description: 'Client slug (required)' },
          count:         { type: 'number',  description: 'Number of posts to create (1-60). Ignored when topics[] is provided.' },
          content_type:  { type: 'string',  description: 'image|reel|video|blog (default: image)' },
          platforms:     { type: 'array',   items: { type: 'string' }, description: 'Platforms array. Omit to use content-type defaults; if provided, use exactly these platforms.' },
          topic:         { type: 'string',  description: 'A single topic shared across all posts (each gets a different angle).' },
          topics:        { type: 'array',   items: { type: 'string' }, description: 'Explicit list of topics. One post per topic.' },
          use_queue:     { type: 'boolean', description: 'Consume from client_topics queue in priority order. Ignored if topics[] is set.' },
          start_date:    { type: 'string',  description: 'YYYY-MM-DD. Default: today.' },
          spacing_days:  { type: 'number',  description: 'Days between consecutive posts (default: 1).' },
          status:        { type: 'string',  description: 'pending_approval (default) or draft' },
        },
        required: ['client'],
      },
    },
  },

  // ── RECURRING CONTENT REQUESTS ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_content_request',
      description: `Schedule recurring content generation.
Use for: "Schedule a Google Business post every Monday at 9am for Golden Touch Roofing", "Every weekday, create one Instagram post for Unlocked Pros".
The hourly cron fires eligible requests; each firing creates per_run posts via the same content+image pipeline as create_content_with_image.`,
      parameters: {
        type: 'object',
        properties: {
          client:         { type: 'string',  description: 'Client slug (required)' },
          request_type:   { type: 'string',  description: "'social' (default), 'blog', or 'mixed'" },
          content_type:   { type: 'string',  description: 'image|reel|video|blog (overrides request_type default)' },
          platforms:      { type: 'array',   items: { type: 'string' }, description: 'Target platforms. Omit to use content-type defaults; if provided, use exactly these platforms.' },
          recurrence:     { type: 'string',  description: 'daily|weekdays|weekly|biweekly|monthly|once' },
          day_of_week:    { type: 'number',  description: '0=Sun..6=Sat (for weekly/biweekly). 1=Mon, 2=Tue, etc.' },
          time_of_day:    { type: 'string',  description: 'UTC HH:MM, e.g. "09:00". Request only fires after this hour.' },
          per_run:        { type: 'number',  description: 'Posts per firing, 1-10. Default 1.' },
          topic_strategy: { type: 'string',  description: "'queue' (default — use client_topics backlog), 'fixed' (use fixed_topic every run), 'auto' (research fresh topic)" },
          fixed_topic:    { type: 'string',  description: "Required when topic_strategy='fixed'" },
          next_run_date:  { type: 'string',  description: 'YYYY-MM-DD — first firing date. Default: today.' },
          notes:          { type: 'string' },
        },
        required: ['client', 'recurrence'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_content_requests',
      description: 'List recurring content schedules. Filter by client or active-only.',
      parameters: {
        type: 'object',
        properties: {
          client:      { type: 'string' },
          active_only: { type: 'boolean', description: 'Default: false (show all)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_content_request',
      description: 'Update a recurring content request (pause, resume, change recurrence, platforms, etc.).',
      parameters: {
        type: 'object',
        properties: {
          request_id: { type: 'string' },
          fields: {
            type: 'object',
            description: 'request_type, content_type, platforms (JSON string), recurrence, day_of_week, time_of_day, per_run, topic_strategy, fixed_topic, next_run_date, active (0/1), paused (0/1), notes',
          },
        },
        required: ['request_id', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_content_request',
      description: 'Deactivate a recurring content request (active=0). Does not delete history.',
      parameters: {
        type: 'object',
        properties: {
          request_id: { type: 'string' },
        },
        required: ['request_id'],
      },
    },
  },

  // ── TOPIC QUEUE ───────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'add_client_topics',
      description: `Add a list of topics to a client's topic queue.
Use for: "Here are 20 blog topics for Elite Team Builders: ...", "Add these questions to Unlocked Pros".
Topics are consumed in priority DESC, FIFO order by recurring schedules and by batch_create_content(use_queue=true).`,
      parameters: {
        type: 'object',
        properties: {
          client:       { type: 'string', description: 'Client slug (required)' },
          topics:       { type: 'array',  items: { type: 'string' }, description: 'List of topic strings (most common shape).' },
          content_type: { type: 'string', description: "Applies to all topics added: 'image'|'blog'|'reel'|'video' (optional)" },
          platforms:    { type: 'array',  items: { type: 'string' }, description: 'Optional target platforms (JSON-stringified by the tool).' },
          priority:     { type: 'number', description: 'Default 0. Higher = consumed first.' },
          target_date:  { type: 'string', description: 'Optional YYYY-MM-DD hint for when the topic should run.' },
        },
        required: ['client', 'topics'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_client_topics',
      description: 'Show the topic queue for a client.',
      parameters: {
        type: 'object',
        properties: {
          client: { type: 'string' },
          status: { type: 'string', description: "'pending' (default), 'used', 'skipped', or 'all'" },
          limit:  { type: 'number', description: 'Default 50.' },
        },
        required: ['client'],
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

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
  user: SessionData,
  baseUrl: string,
  ctx: ExecutionContext,
  openAiKey: string = '',
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
          id:             p.id,
          title:          p.title,
          status:         p.status,
          content_type:   p.content_type,
          publish_date:   p.publish_date,
          client:         nameMap.get(p.client_id) ?? p.client_id,
          platforms:      p.platforms,
          ready:          p.ready_for_automation,
          asset:          p.asset_delivered,
          master_caption: p.master_caption,
          asset_url:      p.asset_r2_key ? `${baseUrl}/media/${p.asset_r2_key}` : null,
          asset_type:     p.asset_type,
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
        const provider = 'terminal';

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

        const params = {
          run_id: run.id, client_slugs: clientSlugs,
          period_start: dates[0], period_end: dates[dates.length - 1],
          triggered_by: user.userId, publish_time: null,
          overwrite_existing: args.overwrite_existing === true,
          high_quality: true,
          provider,
        } as const;
        const { slots, clients } = await prepareGenerationPlan(env, params);
        await env.DB.prepare(
          `UPDATE generation_runs
           SET post_slots = ?, total_slots = ?, current_slot_idx = 0, publish_time = ?, progress_json = ?, last_activity_at = ?
           WHERE id = ?`,
        ).bind(
          JSON.stringify(slots),
          slots.length,
          '10:00',
          JSON.stringify({
            current_client: clients[0]?.canonical_name ?? '',
            current_post: slots[0] ? `${slots[0].date} / ${slots[0].content_type}` : '',
            completed: 0,
            total_estimated: slots.length,
            errors: 0,
            clients_done: 0,
            clients_total: clients.length,
          }),
          Math.floor(Date.now() / 1000),
          run.id,
        ).run();
        await appendGenerationLog(env.DB, run.id, 'START', `Terminal AI job queued from agent — ${dates[0]} → ${dates[dates.length - 1]}`);
        const preparedSlots = await prebuildApprovedTerminalSlotRequests(env, run.id);

        const approvedArgs: ApprovedTerminalJobArgs = {
          run_id: run.id,
          client_slugs: clientSlugs,
          period_start: dates[0],
          period_end: dates[dates.length - 1],
          content_only: true,
          generate_images: false,
          provider: 'terminal',
          requested_in: 'agent',
          prepared_slots: preparedSlots,
        };
        const approvedJob = await createApprovedCommandJob(env.DB, {
          generation_run_id: run.id,
          command_name: 'weekly_content_terminal',
          provider: 'terminal',
          requested_by: user.userId,
          args_json: JSON.stringify(approvedArgs),
        });

        return {
          success: true,
          job_id: approvedJob.id,
          summary: { job_id: approvedJob.id, date_range: `${dates[0]} → ${dates[dates.length - 1]}`, clients: clientSlugs.length > 0 ? clientSlugs.join(', ') : 'all active', days: dates.length, provider, mode: 'approved_terminal_job' },
          action_summary: `Generation job ${approvedJob.id} queued with Terminal AI — ${clientSlugs.length > 0 ? clientSlugs.join(', ') : 'all clients'} for ${dates.length} days`,
        };
      }

      case 'resume_generation_run': {
        const runId = typeof args.run_id === 'string' ? args.run_id : null;
        if (!runId) return { success: false, error: 'run_id is required' };

        const run = await getGenerationRunById(env.DB, runId);
        if (!run) return { success: false, error: `Generation run not found: ${runId}` };

        const totalSlots = run.total_slots ?? 0;
        const currentSlot = Math.max(0, run.current_slot_idx ?? 0);
        if (!run.post_slots || totalSlots === 0) {
          return { success: false, error: 'Run has no stored slot plan to resume' };
        }
        if (currentSlot >= totalSlots) {
          return { success: false, error: 'Run is already complete' };
        }

        const resumed = await resumeGenerationRun(env, baseUrl, runId);
        await writeAuditLog(env.DB, {
          user_id: user.userId,
          action: 'agent_resume_generation_run',
          entity_type: 'generation_run',
          entity_id: runId,
          new_value: { next_slot: resumed.nextSlot, total_slots: resumed.totalSlots },
        });

        return {
          success: true,
          job_id: runId,
          summary: { run_id: runId, next_slot: resumed.nextSlot, total_slots: resumed.totalSlots },
          action_summary: `Generation run ${runId} resumed from slot ${resumed.nextSlot + 1}/${resumed.totalSlots}`,
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

        const safe = normalizeAgentPostUpdateFields(args as Record<string, unknown>);
        if (Object.keys(safe).length === 0) {
          return {
            success: false,
            error: 'No valid fields to update. Provide fields like title, master_caption, publish_date, status, blog_content, seo_title, target_keyword, or cap_*.',
          };
        }

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

        const wpStatusArg = typeof args.wp_status === 'string' ? args.wp_status : undefined;
        const wpStatus = wpStatusArg === 'publish' || wpStatusArg === 'draft' || wpStatusArg === 'pending'
          ? wpStatusArg
          : undefined;

        // Publish in-worker (no browser session needed) — the publish-blog HTTP
        // route is session-gated, so automation/agent paths must call the module
        // directly. This is what unblocks ready-but-unpublished blogs.
        try {
          const result = await publishBlogPost(env, postId, { status: wpStatus });
          return {
            success: true,
            summary: { wp_post_url: result.wpPost.link, wp_post_id: result.wpPost.id, status: result.wpPost.status },
            action_summary: `Blog published to WordPress${result.wpPost.link ? ` — ${result.wpPost.link}` : ''}`,
            ...(result.warnings.length > 0 ? { suggestions: result.warnings } : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: `Blog publish failed: ${message}`,
            ...(message.includes('not configured')
              ? { suggestions: ['Set wp_base_url, wp_username, and wp_application_password for this client (WordPress REST + application password).'] }
              : {}),
          };
        }
      }

      // ── CREATE CLIENT PROFILE ──────────────────────────────────────────────
      case 'create_client_profile': {
        const canonicalName = typeof args.canonical_name === 'string' ? args.canonical_name.trim() : '';
        if (!canonicalName) return { success: false, error: 'canonical_name is required' };

        const requestedSlug = typeof args.slug === 'string' ? args.slug.trim() : '';
        const slug = requestedSlug ? slugifyClientName(requestedSlug) : slugifyClientName(canonicalName);
        if (!slug) return { success: false, error: 'A valid slug is required or must be derivable from canonical_name' };
        if (!/^[a-z0-9-]+$/.test(slug)) return { success: false, error: 'slug must be lowercase alphanumeric with hyphens only' };

        const existing = await getClientBySlug(env.DB, slug);
        if (existing) {
          return {
            success: false,
            error: `Client already exists: ${slug}`,
            suggestions: [`Use update_client_profile for ${slug} or choose a different slug.`],
          };
        }

        const fields = sanitizeAgentClientFields((args.fields ?? {}) as Record<string, unknown>, 'create');
        fields.canonical_name = canonicalName;
        const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
        const now = Math.floor(Date.now() / 1000);
        const extraEntries = Object.entries(fields).filter(([k]) => k !== 'canonical_name');
        const columns = ['id', 'slug', 'canonical_name', ...extraEntries.map(([k]) => k), 'created_at', 'updated_at'];
        const values = [id, slug, canonicalName, ...extraEntries.map(([, v]) => v ?? null), now, now];
        await env.DB
          .prepare(`INSERT INTO clients (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
          .bind(...values)
          .run();

        const serviceNames = Array.isArray(args.services)
          ? [...new Set((args.services as unknown[]).map((item) => String(item).trim()).filter(Boolean))]
          : [];
        for (const name of serviceNames) {
          await env.DB.prepare(
            'INSERT INTO client_services (id, client_id, name, description, active, sort_order, created_at, updated_at) VALUES (?,?,?,?,1,0,?,?)',
          ).bind(crypto.randomUUID().replace(/-/g, ''), id, name, null, now, now).run();
        }

        const areas = Array.isArray(args.service_areas) ? args.service_areas as Array<Record<string, unknown>> : [];
        const savedAreas: Array<{ city: string; state: string | null }> = [];
        for (const area of areas) {
          const city = typeof area.city === 'string' ? area.city.trim() : '';
          if (!city) continue;
          const state = typeof area.state === 'string' ? area.state.trim() : null;
          await env.DB.prepare(
            'INSERT INTO client_service_areas (id, client_id, city, state, primary_area, sort_order, created_at) VALUES (?,?,?,?,?,0,?)',
          ).bind(crypto.randomUUID().replace(/-/g, ''), id, city, state, area.primary_area ? 1 : 0, now).run();
          savedAreas.push({ city, state });
        }

        const intelligence = collectAllowedFields((args.intelligence ?? {}) as Record<string, unknown>, AGENT_CLIENT_INTELLIGENCE_FIELDS);
        if (Object.keys(intelligence).length > 0) {
          const intelId = crypto.randomUUID().replace(/-/g, '');
          const intelColumns = ['id', 'client_id', ...Object.keys(intelligence), 'created_at', 'updated_at'];
          const intelValues = [intelId, id, ...Object.values(intelligence).map((v) => v ?? null), now, now];
          await env.DB
            .prepare(`INSERT INTO client_intelligence (${intelColumns.join(', ')}) VALUES (${intelColumns.map(() => '?').join(', ')})`)
            .bind(...intelValues)
            .run();
        }

        await writeAuditLog(env.DB, {
          user_id: user.userId,
          action: 'agent_create_client',
          entity_type: 'client',
          entity_id: id,
          new_value: { slug, canonical_name: canonicalName, fields, services: serviceNames, service_areas: savedAreas, intelligence_fields: Object.keys(intelligence) },
        });

        const client = await getClientBySlug(env.DB, slug);
        return {
          success: true,
          data: client,
          summary: { client_id: id, slug, services_added: serviceNames.length, service_areas_added: savedAreas.length, intelligence_fields: Object.keys(intelligence) },
          suggestions: ['Review the new client in the dashboard before running content generation.', 'Add Upload-Post platform IDs when accounts are connected.'],
          action_summary: `Created client profile ${canonicalName} (${slug}) with ${serviceNames.length} service(s) and ${savedAreas.length} service area(s).`,
        };
      }

      // ── UPDATE CLIENT PROFILE ──────────────────────────────────────────────
      case 'update_client_profile': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await resolveAgentClient(env, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const safe = sanitizeAgentClientFields(fields, 'update');
        if (Object.keys(safe).length === 0) return { success: false, error: 'No valid fields to update' };

        const now = Math.floor(Date.now() / 1000);
        const sets   = [...Object.keys(safe).map(k => `${k} = ?`), 'updated_at = ?'];
        const values = [...Object.values(safe), now, client.id];
        await env.DB.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
        await writeAuditLog(env.DB, { user_id: user.userId, action: 'agent_update_client', entity_type: 'client', entity_id: client.id, new_value: safe });

        // Fresh data
        const after = await getClientBySlug(env.DB, client.slug);
        return {
          success: true,
          data: after,
          summary: { updated_fields: Object.keys(safe) },
          action_summary: `Updated ${client.canonical_name}: ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── DELETE CLIENT PROFILE ──────────────────────────────────────────────
      case 'delete_client_profile': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const confirmed = args.confirmed === true;
        const hardDelete = args.hard_delete === true;
        if (!slug) return { success: false, error: 'client slug is required' };
        if (!confirmed) return { success: false, error: 'Set confirmed: true to archive/delete a client profile. Ask Marvin to confirm first.' };

        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        const postCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE client_id = ?').bind(client.id).first<{ n: number }>();
        if (!hardDelete) {
          await env.DB.prepare("UPDATE clients SET status = 'inactive', updated_at = ? WHERE id = ?").bind(Math.floor(Date.now() / 1000), client.id).run();
          await writeAuditLog(env.DB, {
            user_id: user.userId,
            action: 'agent_archive_client',
            entity_type: 'client',
            entity_id: client.id,
            old_value: { status: client.status, slug: client.slug },
            new_value: { status: 'inactive' },
          });
          return {
            success: true,
            summary: { slug, archived: true, posts_preserved: postCount?.n ?? 0 },
            action_summary: `Archived client profile ${client.canonical_name}. Existing posts were preserved.`,
          };
        }

        if ((postCount?.n ?? 0) > 0) {
          return {
            success: false,
            error: `Hard delete blocked: ${client.canonical_name} has ${postCount?.n ?? 0} post(s). Archive it instead or remove posts manually first.`,
          };
        }

        const childTables = [
          'client_platforms',
          'client_gbp_locations',
          'client_restrictions',
          'client_intelligence',
          'client_feedback',
          'client_categories',
          'client_services',
          'client_service_areas',
          'client_offers',
          'client_events',
          'client_research_notes',
          'client_strategy_plans',
          'client_topics',
          'client_monthly_topics',
          'client_monthly_content_plans',
        ];
        for (const table of childTables) {
          await env.DB.prepare(`DELETE FROM ${table} WHERE client_id = ?`).bind(client.id).run();
        }
        await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(client.id).run();
        await writeAuditLog(env.DB, {
          user_id: user.userId,
          action: 'agent_delete_client',
          entity_type: 'client',
          entity_id: client.id,
          old_value: { slug: client.slug, canonical_name: client.canonical_name },
        });
        return {
          success: true,
          summary: { slug, hard_deleted: true },
          action_summary: `Permanently deleted client profile ${client.canonical_name}.`,
        };
      }

      // ── UPDATE CLIENT INTELLIGENCE ─────────────────────────────────────────
      case 'update_client_intelligence': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const safe = collectAllowedFields(fields, AGENT_CLIENT_INTELLIGENCE_FIELDS);
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
        const safe = collectPlatformFields(fields);
        if (Object.keys(safe).length === 0) return { success: false, error: 'No valid platform fields' };

        // NOTE: client_platforms has no created_at/updated_at columns (see schema).
        const existing = await env.DB.prepare('SELECT id FROM client_platforms WHERE client_id = ? AND platform = ?').bind(client.id, platform).first<{ id: string }>();

        if (!existing) {
          const id   = crypto.randomUUID().replace(/-/g, '');
          const cols = ['id', 'client_id', 'platform', ...Object.keys(safe)];
          const vals = [id, client.id, platform, ...Object.values(safe)];
          await env.DB.prepare(`INSERT INTO client_platforms (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...vals).run();
        } else {
          const sets   = Object.keys(safe).map(k => `${k} = ?`);
          const values = [...Object.values(safe), existing.id];
          await env.DB.prepare(`UPDATE client_platforms SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
        }

        return {
          success: true,
          summary: { client: slug, platform, fields: Object.keys(safe) },
          action_summary: `Platform ${platform} config updated for ${client.canonical_name}`,
        };
      }

      // ── SYNC UPLOAD-POST PLATFORMS ────────────────────────────────────────
      case 'sync_upload_post_platforms': {
        const slug = typeof args.client === 'string' && args.client.trim() ? args.client.trim() : undefined;
        if (slug) {
          const client = await getClientBySlug(env.DB, slug);
          if (!client) return { success: false, error: `Client not found: ${slug}` };
          if (!client.upload_post_profile) return { success: false, error: `Upload-Post profile is not configured for ${client.canonical_name}` };
        }
        const result = await syncUploadPostClientPlatforms(env, {
          client_slug: slug,
          dry_run: args.dry_run === true,
        });
        return {
          success: result.errors.length === 0,
          data: result,
          summary: {
            client: slug ?? 'all active clients',
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            errors: result.errors.length,
          },
          action_summary: `Upload-Post platform sync ${result.dry_run ? 'previewed' : 'completed'}: ${result.created} created, ${result.updated} updated, ${result.errors.length} error(s).`,
          suggestions: result.errors.map((err) => `${err.client}: ${err.error}`),
        };
      }

      // ── DELETE CLIENT PLATFORM ─────────────────────────────────────────────
      case 'delete_client_platform': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const platform = typeof args.platform === 'string' ? args.platform : '';
        if (args.confirmed !== true) return { success: false, error: 'confirmed=true is required to delete a client platform config' };
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };
        if (!platform) return { success: false, error: 'platform is required' };

        const existing = await env.DB.prepare('SELECT id FROM client_platforms WHERE client_id = ? AND platform = ?').bind(client.id, platform).first<{ id: string }>();
        if (!existing) return { success: false, error: `Platform config not found for ${client.canonical_name}: ${platform}` };
        await env.DB.prepare('DELETE FROM client_platforms WHERE id = ? AND client_id = ?').bind(existing.id, client.id).run();
        return {
          success: true,
          summary: { client: slug, platform, deleted: true },
          action_summary: `Platform ${platform} config deleted for ${client.canonical_name}`,
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

      // ── UPDATE CLIENT SERVICE ──────────────────────────────────────────────
      case 'update_client_service': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const serviceId = typeof args.service_id === 'string' ? args.service_id : '';
        const currentName = typeof args.current_name === 'string' ? args.current_name.trim() : '';
        const existing = serviceId
          ? await env.DB.prepare('SELECT id, name FROM client_services WHERE id = ? AND client_id = ?').bind(serviceId, client.id).first<{ id: string; name: string }>()
          : currentName
            ? await env.DB.prepare('SELECT id, name FROM client_services WHERE client_id = ? AND lower(name) = lower(?)').bind(client.id, currentName).first<{ id: string; name: string }>()
            : null;
        if (!existing) return { success: false, error: 'Service not found. Provide service_id or exact current_name.' };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const allowed = new Set(['name','description','active','sort_order']);
        const entries = Object.entries(collectAllowedFields(fields, allowed));
        if (entries.length === 0) return { success: false, error: 'No valid service fields' };
        const now = Math.floor(Date.now() / 1000);
        const sets = [...entries.map(([k]) => `${k} = ?`), 'updated_at = ?'];
        await env.DB.prepare(`UPDATE client_services SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`)
          .bind(...entries.map(([, v]) => v), now, existing.id, client.id).run();
        const row = await env.DB.prepare('SELECT * FROM client_services WHERE id = ?').bind(existing.id).first();
        return {
          success: true,
          data: row,
          summary: { service_id: existing.id, updated_fields: entries.map(([k]) => k) },
          action_summary: `Service "${existing.name}" updated for ${client.canonical_name}: ${entries.map(([k]) => k).join(', ')}`,
        };
      }

      // ── DELETE CLIENT SERVICE ──────────────────────────────────────────────
      case 'delete_client_service': {
        const slug = typeof args.client === 'string' ? args.client : '';
        if (args.confirmed !== true) return { success: false, error: 'confirmed=true is required to remove a service' };
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const serviceId = typeof args.service_id === 'string' ? args.service_id : '';
        const currentName = typeof args.current_name === 'string' ? args.current_name.trim() : '';
        const existing = serviceId
          ? await env.DB.prepare('SELECT id, name FROM client_services WHERE id = ? AND client_id = ?').bind(serviceId, client.id).first<{ id: string; name: string }>()
          : currentName
            ? await env.DB.prepare('SELECT id, name FROM client_services WHERE client_id = ? AND lower(name) = lower(?)').bind(client.id, currentName).first<{ id: string; name: string }>()
            : null;
        if (!existing) return { success: false, error: 'Service not found. Provide service_id or exact current_name.' };

        const deactivateOnly = args.deactivate_only !== false;
        if (deactivateOnly) {
          await env.DB.prepare('UPDATE client_services SET active = 0, updated_at = ? WHERE id = ? AND client_id = ?')
            .bind(Math.floor(Date.now() / 1000), existing.id, client.id).run();
        } else {
          await env.DB.prepare('DELETE FROM client_services WHERE id = ? AND client_id = ?').bind(existing.id, client.id).run();
        }
        return {
          success: true,
          summary: { service_id: existing.id, name: existing.name, deactivated: deactivateOnly, deleted: !deactivateOnly },
          action_summary: deactivateOnly
            ? `Service "${existing.name}" deactivated for ${client.canonical_name}`
            : `Service "${existing.name}" deleted for ${client.canonical_name}`,
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

      // ── UPDATE CLIENT AREA ─────────────────────────────────────────────────
      case 'update_client_area': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const areaId = typeof args.area_id === 'string' ? args.area_id : '';
        const currentCity = typeof args.current_city === 'string' ? args.current_city.trim() : '';
        const currentState = typeof args.current_state === 'string' ? args.current_state.trim() : '';
        const existing = areaId
          ? await env.DB.prepare('SELECT id, city, state FROM client_service_areas WHERE id = ? AND client_id = ?').bind(areaId, client.id).first<{ id: string; city: string; state: string | null }>()
          : currentCity
            ? await env.DB.prepare("SELECT id, city, state FROM client_service_areas WHERE client_id = ? AND lower(city) = lower(?) AND (? = '' OR lower(coalesce(state,'')) = lower(?))")
                .bind(client.id, currentCity, currentState, currentState).first<{ id: string; city: string; state: string | null }>()
            : null;
        if (!existing) return { success: false, error: 'Service area not found. Provide area_id or exact current_city.' };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const allowed = new Set(['city','state','zip','primary_area','sort_order']);
        const entries = Object.entries(collectAllowedFields(fields, allowed));
        if (entries.length === 0) return { success: false, error: 'No valid area fields' };
        const sets = entries.map(([k]) => `${k} = ?`);
        await env.DB.prepare(`UPDATE client_service_areas SET ${sets.join(', ')} WHERE id = ? AND client_id = ?`)
          .bind(...entries.map(([, v]) => v), existing.id, client.id).run();
        const row = await env.DB.prepare('SELECT * FROM client_service_areas WHERE id = ?').bind(existing.id).first();
        return {
          success: true,
          data: row,
          summary: { area_id: existing.id, updated_fields: entries.map(([k]) => k) },
          action_summary: `Service area "${existing.city}${existing.state ? `, ${existing.state}` : ''}" updated for ${client.canonical_name}: ${entries.map(([k]) => k).join(', ')}`,
        };
      }

      // ── DELETE CLIENT AREA ─────────────────────────────────────────────────
      case 'delete_client_area': {
        const slug = typeof args.client === 'string' ? args.client : '';
        if (args.confirmed !== true) return { success: false, error: 'confirmed=true is required to delete a service area' };
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const areaId = typeof args.area_id === 'string' ? args.area_id : '';
        const currentCity = typeof args.current_city === 'string' ? args.current_city.trim() : '';
        const currentState = typeof args.current_state === 'string' ? args.current_state.trim() : '';
        const existing = areaId
          ? await env.DB.prepare('SELECT id, city, state FROM client_service_areas WHERE id = ? AND client_id = ?').bind(areaId, client.id).first<{ id: string; city: string; state: string | null }>()
          : currentCity
            ? await env.DB.prepare("SELECT id, city, state FROM client_service_areas WHERE client_id = ? AND lower(city) = lower(?) AND (? = '' OR lower(coalesce(state,'')) = lower(?))")
                .bind(client.id, currentCity, currentState, currentState).first<{ id: string; city: string; state: string | null }>()
            : null;
        if (!existing) return { success: false, error: 'Service area not found. Provide area_id or exact current_city.' };
        await env.DB.prepare('DELETE FROM client_service_areas WHERE id = ? AND client_id = ?').bind(existing.id, client.id).run();
        return {
          success: true,
          summary: { area_id: existing.id, city: existing.city, state: existing.state, deleted: true },
          action_summary: `Service area "${existing.city}${existing.state ? `, ${existing.state}` : ''}" deleted for ${client.canonical_name}`,
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

      // ── DELETE OFFER ──────────────────────────────────────────────────────
      case 'delete_offer': {
        const offerId = typeof args.offer_id === 'string' ? args.offer_id : '';
        if (!offerId) return { success: false, error: 'offer_id is required' };
        if (args.confirmed !== true) return { success: false, error: 'confirmed=true is required to remove an offer' };

        const existing = await env.DB.prepare('SELECT id, title FROM client_offers WHERE id = ?').bind(offerId).first<{ id: string; title: string }>();
        if (!existing) return { success: false, error: `Offer not found: ${offerId}` };
        const deactivateOnly = args.deactivate_only !== false;
        if (deactivateOnly) {
          await env.DB.prepare('UPDATE client_offers SET active = 0, paused = 1 WHERE id = ?').bind(offerId).run();
        } else {
          await env.DB.prepare('DELETE FROM client_offers WHERE id = ?').bind(offerId).run();
        }
        return {
          success: true,
          summary: { offer_id: offerId, title: existing.title, deactivated: deactivateOnly, deleted: !deactivateOnly },
          action_summary: deactivateOnly ? `Offer "${existing.title}" deactivated` : `Offer "${existing.title}" deleted`,
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

      // ── DELETE EVENT ──────────────────────────────────────────────────────
      case 'delete_event': {
        const eventId = typeof args.event_id === 'string' ? args.event_id : '';
        if (!eventId) return { success: false, error: 'event_id is required' };
        if (args.confirmed !== true) return { success: false, error: 'confirmed=true is required to remove an event' };

        const existing = await env.DB.prepare('SELECT id, title FROM client_events WHERE id = ?').bind(eventId).first<{ id: string; title: string }>();
        if (!existing) return { success: false, error: `Event not found: ${eventId}` };
        const deactivateOnly = args.deactivate_only !== false;
        if (deactivateOnly) {
          await env.DB.prepare('UPDATE client_events SET active = 0, paused = 1, updated_at = ? WHERE id = ?')
            .bind(Math.floor(Date.now() / 1000), eventId).run();
        } else {
          await env.DB.prepare('DELETE FROM client_events WHERE id = ?').bind(eventId).run();
        }
        return {
          success: true,
          summary: { event_id: eventId, title: existing.title, deactivated: deactivateOnly, deleted: !deactivateOnly },
          action_summary: deactivateOnly ? `Event "${existing.title}" deactivated` : `Event "${existing.title}" deleted`,
        };
      }

      // ── ATTACH ASSET TO POST ───────────────────────────────────────────────
      case 'attach_asset_to_post': {
        const postId    = typeof args.post_id    === 'string' ? args.post_id    : null;
        const r2Key     = typeof args.r2_key     === 'string' ? args.r2_key     : null;
        const assetType = typeof args.asset_type === 'string' ? args.asset_type : 'image';

        if (!postId || !r2Key) return { success: false, error: 'post_id and r2_key are required' };

        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const now = Math.floor(Date.now() / 1000);
        await env.DB
          .prepare(`UPDATE posts SET asset_r2_key = ?, asset_r2_bucket = 'MEDIA', asset_type = ?, asset_delivered = 1, updated_at = ? WHERE id = ?`)
          .bind(r2Key, assetType, now, postId)
          .run();

        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_attach_asset',
          entity_type: 'post', entity_id: postId,
          new_value: { r2_key: r2Key, asset_type: assetType },
        });

        const assetUrl = `${baseUrl}/media/${r2Key}`;
        return {
          success: true,
          items: [{ id: postId, title: post.title, asset_url: assetUrl, asset_type: assetType, asset_delivered: true }],
          summary: { post_id: postId, r2_key: r2Key, asset_url: assetUrl },
          action_summary: `Asset (${assetType}) attached to "${post.title || postId}" — asset_delivered=1`,
        };
      }

      // ── GENERATE CAPTIONS ──────────────────────────────────────────────────
      case 'generate_captions': {
        const postId    = typeof args.post_id === 'string' ? args.post_id : null;
        const rawPlatforms = Array.isArray(args.platforms) ? (args.platforms as string[]) : [];

        if (!postId)              return { success: false, error: 'post_id is required' };
        if (!rawPlatforms.length) return { success: false, error: 'platforms array is required' };
        if (!openAiKey)           return { success: false, error: 'OpenAI key not available' };

        const VALID_PLATFORMS = new Set(['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','google_business','youtube']);
        const platforms = rawPlatforms.filter(p => VALID_PLATFORMS.has(p));
        if (!platforms.length) return { success: false, error: 'No valid platforms specified' };

        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const [clientRow, intelRow] = await Promise.all([
          env.DB
            .prepare('SELECT canonical_name, industry, language, phone, cta_text FROM clients WHERE id = ?')
            .bind(post.client_id).first<Record<string, string>>(),
          env.DB
            .prepare('SELECT brand_voice, prohibited_terms FROM client_intelligence WHERE client_id = ?')
            .bind(post.client_id).first<Record<string, string | null>>(),
        ]);
        if (!clientRow) return { success: false, error: 'Client not found' };

        const PLATFORM_INSTRUCTIONS: Record<string, string> = {
          facebook:        'engaging Facebook caption, 150-400 chars, include a call-to-action',
          instagram:       'Instagram caption with relevant emojis and 10-15 hashtags (150-300 chars, hashtags on new lines)',
          linkedin:        'professional LinkedIn post, insight-driven, 200-400 chars, max 5 hashtags',
          x:               'X/Twitter post, punchy and direct, max 280 chars',
          threads:         'casual Threads post, conversational, 100-250 chars',
          tiktok:          'TikTok caption with 5-10 trending hashtags, 150-250 chars',
          pinterest:       'Pinterest description, keyword-rich, 100-200 chars + 5-8 hashtags',
          bluesky:         'Bluesky post, casual and direct, max 300 chars',
          google_business: 'Google Business post, factual and local, 100-250 chars, NO hashtags',
          youtube:         'YouTube description with CTA, 200-400 chars',
        };

        const clientName  = clientRow['canonical_name'] ?? '';
        const brandVoice  = intelRow?.['brand_voice'] ?? null;
        const prohibited  = intelRow?.['prohibited_terms'] ?? null;

        // Generate captions in parallel
        const captionResults = await Promise.all(platforms.map(async (platform) => {
          const instr = PLATFORM_INSTRUCTIONS[platform] ?? '100-250 char social media caption';
          const prompt = `You are a social media writer for ${clientName}.${clientRow['industry'] ? ` Industry: ${clientRow['industry']}.` : ''}${brandVoice ? ` Brand voice: ${brandVoice}.` : ''}${prohibited ? ` NEVER USE: ${prohibited}.` : ''}${clientRow['cta_text'] ? ` Preferred CTA: ${clientRow['cta_text']}.` : ''}

Post title: ${post.title ?? ''}
Master caption: ${post.master_caption ?? ''}

Write a ${platform} caption: ${instr}.
Return JSON: { "caption": "..." }`;

          try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAiKey}` },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  { role: 'system', content: 'Social media caption writer. Respond with valid JSON only.' },
                  { role: 'user', content: prompt },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.75,
                max_tokens: 400,
              }),
            });
            if (!res.ok) return { platform, caption: null as string | null, err: `API ${res.status}` };
            const data = await res.json() as { choices: Array<{ message: { content: string } }> };
            const raw  = data.choices?.[0]?.message?.content;
            if (!raw) return { platform, caption: null as string | null, err: 'Empty response' };
            const caption = (JSON.parse(raw) as { caption: string }).caption;
            return { platform, caption, err: null as string | null };
          } catch (e) {
            return { platform, caption: null as string | null, err: e instanceof Error ? e.message : String(e) };
          }
        }));

        const succeeded = captionResults.filter(r => r.caption !== null);
        const failed    = captionResults.filter(r => r.caption === null);

        if (succeeded.length > 0) {
          const existingPlatforms: string[] = JSON.parse(post.platforms ?? '[]');
          const allPlatforms = [...new Set([...existingPlatforms, ...succeeded.map(r => r.platform)])];

          const setParts: string[] = ['platforms = ?', 'updated_at = ?'];
          const vals: unknown[]    = [JSON.stringify(allPlatforms), Math.floor(Date.now() / 1000)];

          // Set master_caption if not already set
          if (!post.master_caption) {
            const fallback = succeeded.find(r => r.platform === 'instagram')
              ?? succeeded.find(r => r.platform === 'facebook')
              ?? succeeded[0];
            if (fallback?.caption) { setParts.push('master_caption = ?'); vals.push(fallback.caption); }
          }

          for (const { platform, caption } of succeeded) {
            const field = `cap_${platform}`;
            setParts.push(`${field} = ?`);
            vals.push(caption);
          }

          vals.push(postId);
          await env.DB.prepare(`UPDATE posts SET ${setParts.join(', ')} WHERE id = ?`).bind(...vals).run();
          await writeAuditLog(env.DB, {
            user_id: user.userId, action: 'agent_generate_captions',
            entity_type: 'post', entity_id: postId,
            new_value: { platforms: succeeded.map(r => r.platform) },
          });
        }

        return {
          success: true,
          summary: { generated: succeeded.length, failed: failed.length, platforms: succeeded.map(r => r.platform), failed_platforms: failed.map(r => `${r.platform}: ${r.err}`) },
          suggestions: succeeded.length > 0 ? ['Captions saved — use approve_and_publish to post it'] : undefined,
          error: failed.length > 0 ? `Failed: ${failed.map(r => r.platform).join(', ')}` : undefined,
          action_summary: `Generated ${succeeded.length} caption${succeeded.length !== 1 ? 's' : ''} for "${post.title || postId}": ${succeeded.map(r => r.platform).join(', ')}`,
        };
      }

      // ── APPROVE AND PUBLISH ────────────────────────────────────────────────
      case 'approve_and_publish': {
        const postId = typeof args.post_id === 'string' ? args.post_id : null;
        if (!postId) return { success: false, error: 'post_id is required' };

        const post = await getPostById(env.DB, postId);
        if (!post) return { success: false, error: `Post not found: ${postId}` };

        const dryRun = args.dry_run === true;
        const now    = Math.floor(Date.now() / 1000);

        await env.DB
          .prepare(`UPDATE posts SET status = 'ready', ready_for_automation = 1, asset_delivered = 1, updated_at = ? WHERE id = ?`)
          .bind(now, postId)
          .run();

        const job = await createPostingJob(env.DB, { triggered_by: user.userId, mode: dryRun ? 'dry_run' : 'real' });
        ctx.waitUntil(runPosting(env, { mode: dryRun ? 'dry_run' : 'real', job_id: job.id, post_ids: [postId], triggered_by: user.userId }));

        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_approve_and_publish',
          entity_type: 'post', entity_id: postId,
          new_value: { dry_run: dryRun, job_id: job.id },
        });

        return {
          success: true,
          job_id: job.id,
          summary: { post_id: postId, job_id: job.id, mode: dryRun ? 'dry_run' : 'real', platforms: post.platforms },
          action_summary: `${dryRun ? '[DRY RUN] ' : ''}Approved and posting "${post.title || postId}" — job ${job.id}`,
        };
      }

      // ── AUTONOMOUS CONTENT + IMAGE ─────────────────────────────────────────
      case 'create_content_with_image': {
        const clientSlug   = typeof args.client        === 'string'  ? args.client       : null;
        const platforms    = Array.isArray(args.platforms)            ? (args.platforms as string[]) : [];
        const contentType  = typeof args.content_type  === 'string'  ? args.content_type : 'image';
        const topic        = typeof args.topic         === 'string'  ? args.topic        : undefined;
        const sourceCaption = typeof args.source_caption === 'string' ? args.source_caption : undefined;
        const publishDate  = typeof args.publish_date  === 'string'  ? args.publish_date : undefined;
        const statusArg    = typeof args.status        === 'string'  ? args.status       : 'pending_approval';
        const notifyDc     = args.notify_discord !== false;
        const generateImage = args.generate_image === true;

        if (!clientSlug) return { success: false, error: 'client is required' };
        if (!openAiKey)  return { success: false, error: 'OpenAI API key not configured' };

        // Run content creation in background — Stability image gen can take 20-60s
        ctx.waitUntil((async () => {
          try {
            const result = await createContentWithImage(env, {
              clientSlug,
              platforms: platforms.length > 0 ? platforms : undefined,
              contentType: contentType as 'image' | 'reel' | 'video' | 'blog',
              topicOverride: topic,
              sourceCaption,
              publishDate,
              status: statusArg as 'draft' | 'pending_approval',
              notifyDiscord: notifyDc,
              triggeredBy: `agent:${user.email}`,
              generateImage,
            }, openAiKey);
            console.log(`[agent] create_content_with_image done: postId=${result.postId} imageStatus=${result.imageStatus}`);
          } catch (err) {
            console.error('[agent] create_content_with_image error:', err);
          }
        })());

        return {
          success:        true,
          action_summary: `Content creation started for "${clientSlug}" — running in background`,
          summary: {
            client:       clientSlug,
            platforms:    Array.isArray(platforms) && platforms.length > 0 ? platforms : `package-compatible ${contentType} platforms`,
            content_type: contentType,
            topic:        topic ?? 'auto-researched',
            source_caption: sourceCaption ? 'provided' : 'none',
            publish_date: publishDate ?? 'today at 10:00',
            status:       statusArg,
            generate_image: generateImage,
          },
          suggestions: [
            generateImage
              ? 'Content is being written and the AI image generator will run.'
              : 'Content is being written. A Spanish designer prompt will be saved; designer asset delivery remains required.',
            notifyDc
              ? 'You will receive a Discord notification with preview when ready.'
              : 'Check /approvals in a moment to review the created post.',
          ],
        };
      }

      // ── BATCH CONTENT CREATION ─────────────────────────────────────────────
      case 'batch_create_content': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client)    return { success: false, error: `Client not found: ${slug}` };
        if (!openAiKey) return { success: false, error: 'OpenAI API key not configured' };

        const contentType = (typeof args.content_type === 'string' ? args.content_type : 'image') as
          'image' | 'reel' | 'video' | 'blog';
        const platforms = Array.isArray(args.platforms) && args.platforms.length > 0
          ? (args.platforms as string[])
          : undefined;
        const statusArg = typeof args.status === 'string' ? args.status : 'pending_approval';
        const explicitTopics = Array.isArray(args.topics) ? (args.topics as string[]).filter(Boolean) : [];
        const useQueue = args.use_queue === true;
        const singleTopic = typeof args.topic === 'string' && args.topic.trim() ? args.topic.trim() : null;
        const requestedCount = typeof args.count === 'number' ? Math.max(1, Math.min(60, Math.floor(args.count))) : null;

        const startDate = typeof args.start_date === 'string' ? args.start_date : new Date().toISOString().slice(0, 10);
        const spacing   = typeof args.spacing_days === 'number' ? Math.max(0, Math.min(30, args.spacing_days)) : 1;

        // Build the slot list: { topic, topicRow?, publishDate }
        type Slot = { topic: string | undefined; topicId: string | null; publishDate: string };
        const slots: Slot[] = [];

        const addDays = (ymd: string, d: number) => {
          const t = new Date(ymd + 'T00:00:00Z');
          t.setUTCDate(t.getUTCDate() + d);
          return t.toISOString().slice(0, 10);
        };

        if (explicitTopics.length > 0) {
          const limit = Math.min(60, explicitTopics.length);
          for (let i = 0; i < limit; i++) {
            slots.push({ topic: explicitTopics[i], topicId: null, publishDate: `${addDays(startDate, i * spacing)}T10:00` });
          }
        } else if (useQueue) {
          const pending = await listClientTopics(env.DB, client.id, 'pending', Math.min(60, requestedCount ?? 60));
          const limit = Math.min(60, requestedCount ?? pending.length);
          for (let i = 0; i < Math.min(limit, pending.length); i++) {
            slots.push({ topic: pending[i].topic, topicId: pending[i].id, publishDate: `${addDays(startDate, i * spacing)}T10:00` });
          }
          if (slots.length === 0) {
            return { success: false, error: 'Topic queue is empty for this client — add_client_topics first or pass topics[] directly' };
          }
        } else if (singleTopic) {
          const n = requestedCount ?? 1;
          for (let i = 0; i < n; i++) {
            slots.push({ topic: singleTopic, topicId: null, publishDate: `${addDays(startDate, i * spacing)}T10:00` });
          }
        } else if (requestedCount) {
          for (let i = 0; i < requestedCount; i++) {
            slots.push({ topic: undefined, topicId: null, publishDate: `${addDays(startDate, i * spacing)}T10:00` });
          }
        } else {
          return { success: false, error: 'Provide topics[] OR use_queue:true OR topic+count OR count' };
        }

        if (slots.length === 0) return { success: false, error: 'No slots resolved' };

        const endDate = slots[slots.length - 1]?.publishDate.slice(0, 10) ?? startDate;
        const run = await createGenerationRun(env.DB, {
          triggered_by: user.userId,
          date_range: `${startDate}:${endDate}`,
          client_filter: JSON.stringify([slug]),
          overwrite_existing: false,
        });
        await storeGenerationPlan(env.DB, run.id, slots.map((slot) => ({
          client_slug: slug,
          date: slot.publishDate.slice(0, 10),
          publish_date: slot.publishDate,
          content_type: contentType,
          topic: slot.topic ?? null,
          topic_id: slot.topicId,
        })), '10:00');
        await updateGenerationProgress(env.DB, run.id, {
          current_client: client.canonical_name,
          current_post: slots[0] ? `${slots[0].publishDate} / ${contentType}` : '',
          completed: 0,
          total_estimated: slots.length,
          errors: 0,
          clients_done: 0,
          clients_total: 1,
        });

        ctx.waitUntil(runAgentBatchContent(env, openAiKey, {
          clientSlug: slug,
          contentType,
          platforms,
          status: statusArg as 'draft' | 'pending_approval',
          slots,
          runId: run.id,
          userEmail: user.email,
        }));

        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_batch_create_content',
          entity_type: 'client', entity_id: client.id,
          new_value: { slots: slots.length, content_type: contentType, start_date: startDate, spacing, run_id: run.id },
        });

        return {
          success: true,
          job_id: run.id,
          summary: {
            client:       slug,
            count:        slots.length,
            content_type: contentType,
            start_date:   startDate,
            end_date:     endDate,
            spacing_days: spacing,
            source:       explicitTopics.length ? 'explicit' : useQueue ? 'queue' : singleTopic ? 'shared_topic' : 'auto',
            platforms:    Array.isArray(platforms) && platforms.length > 0 ? platforms : `default ${contentType} platforms`,
            run_id:       run.id,
          },
          suggestions: [
            `Queued ${slots.length} planned slot${slots.length !== 1 ? 's' : ''} — check /api/run/generate/runs/${run.id} for created, skipped, and failed results.`,
          ],
          action_summary: `Batch of ${slots.length} ${contentType} post${slots.length !== 1 ? 's' : ''} queued for ${client.canonical_name} — run ${run.id}`,
        };
      }

      // ── CREATE CONTENT REQUEST ─────────────────────────────────────────────
      case 'create_content_request': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const recurrence = typeof args.recurrence === 'string' ? args.recurrence : '';
        const VALID_REC = new Set(['daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'once']);
        if (!VALID_REC.has(recurrence)) {
          return { success: false, error: `Invalid recurrence. Use one of: ${[...VALID_REC].join(', ')}` };
        }

        const requestType   = typeof args.request_type   === 'string' ? args.request_type   : 'social';
        const contentType   = typeof args.content_type   === 'string' ? args.content_type   : null;
        const platformsArr  = Array.isArray(args.platforms) ? (args.platforms as string[]) : null;
        const platformsStr  = platformsArr && platformsArr.length > 0 ? JSON.stringify(platformsArr) : null;
        const dayOfWeek     = typeof args.day_of_week    === 'number' ? args.day_of_week    : null;
        const timeOfDay     = typeof args.time_of_day    === 'string' ? args.time_of_day    : null;
        const perRun        = typeof args.per_run        === 'number' ? Math.max(1, Math.min(10, args.per_run)) : 1;
        const topicStrategy = typeof args.topic_strategy === 'string' ? args.topic_strategy : 'queue';
        const fixedTopic    = typeof args.fixed_topic    === 'string' ? args.fixed_topic    : null;
        const nextRunDate   = typeof args.next_run_date  === 'string' ? args.next_run_date  : new Date().toISOString().slice(0, 10);
        const notes         = typeof args.notes          === 'string' ? args.notes          : null;

        if (topicStrategy === 'fixed' && !fixedTopic) {
          return { success: false, error: 'topic_strategy=fixed requires fixed_topic' };
        }

        const row = await createContentRequest(env.DB, {
          client_id:      client.id,
          request_type:   requestType,
          content_type:   contentType,
          platforms:      platformsStr,
          recurrence,
          day_of_week:    dayOfWeek,
          time_of_day:    timeOfDay,
          per_run:        perRun,
          topic_strategy: topicStrategy,
          fixed_topic:    fixedTopic,
          next_run_date:  nextRunDate,
          active:         1,
          paused:         0,
          notes,
          created_by:     user.userId,
        });

        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_create_content_request',
          entity_type: 'content_request', entity_id: row.id,
          new_value: { client: slug, recurrence, day_of_week: dayOfWeek, time_of_day: timeOfDay, per_run: perRun },
        });

        return {
          success: true,
          items: [row],
          summary: {
            request_id:    row.id,
            client:        slug,
            recurrence,
            day_of_week:   dayOfWeek,
            time_of_day:   timeOfDay,
            per_run:       perRun,
            next_run_date: nextRunDate,
          },
          action_summary: `Recurring ${recurrence} schedule created for ${client.canonical_name}${dayOfWeek != null ? ` on day ${dayOfWeek}` : ''}${timeOfDay ? ` at ${timeOfDay} UTC` : ''}`,
        };
      }

      // ── LIST CONTENT REQUESTS ──────────────────────────────────────────────
      case 'list_content_requests': {
        let clientId: string | undefined;
        if (typeof args.client === 'string' && args.client) {
          const c = await resolveClientSlug(env.DB, args.client);
          if (!c) return { success: false, error: `Client not found: ${args.client}` };
          clientId = c.id;
        }
        const rows = await listContentRequests(env.DB, {
          clientId,
          activeOnly: args.active_only === true,
        });

        // Enrich with client slug for display
        const clientIds = [...new Set(rows.map(r => r.client_id))];
        const nameMap = new Map<string, string>();
        if (clientIds.length) {
          const ph = clientIds.map(() => '?').join(',');
          const cl = await env.DB
            .prepare(`SELECT id, canonical_name, slug FROM clients WHERE id IN (${ph})`)
            .bind(...clientIds).all<{ id: string; canonical_name: string; slug: string }>();
          for (const c of cl.results) nameMap.set(c.id, `${c.canonical_name} (${c.slug})`);
        }

        const items = rows.map(r => ({
          id:             r.id,
          client:         nameMap.get(r.client_id) ?? r.client_id,
          request_type:   r.request_type,
          content_type:   r.content_type,
          platforms:      r.platforms,
          recurrence:     r.recurrence,
          day_of_week:    r.day_of_week,
          time_of_day:    r.time_of_day,
          per_run:        r.per_run,
          topic_strategy: r.topic_strategy,
          next_run_date:  r.next_run_date,
          last_triggered_at: r.last_triggered_at,
          active:         r.active,
          paused:         r.paused,
        }));

        return {
          success: true,
          items,
          summary: { total: items.length, active: items.filter(i => i.active && !i.paused).length },
          action_summary: `${items.length} content request${items.length !== 1 ? 's' : ''} found`,
        };
      }

      // ── UPDATE CONTENT REQUEST ─────────────────────────────────────────────
      case 'update_content_request': {
        const requestId = typeof args.request_id === 'string' ? args.request_id : null;
        if (!requestId) return { success: false, error: 'request_id is required' };

        const before = await getContentRequestById(env.DB, requestId);
        if (!before) return { success: false, error: `Content request not found: ${requestId}` };

        const fields = (args.fields ?? {}) as Record<string, unknown>;
        const ALLOWED = new Set([
          'request_type', 'content_type', 'platforms', 'recurrence', 'day_of_week',
          'time_of_day', 'per_run', 'topic_strategy', 'fixed_topic',
          'next_run_date', 'active', 'paused', 'notes',
        ]);
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (!ALLOWED.has(k)) continue;
          // Normalize platforms array to JSON
          if (k === 'platforms' && Array.isArray(v)) safe[k] = JSON.stringify(v);
          else if (typeof v === 'boolean') safe[k] = v ? 1 : 0;
          else safe[k] = v;
        }
        if (Object.keys(safe).length === 0) {
          return { success: false, error: 'No valid fields to update' };
        }

        await updateContentRequest(env.DB, requestId, safe);
        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_update_content_request',
          entity_type: 'content_request', entity_id: requestId,
          new_value: safe,
        });

        const after = await getContentRequestById(env.DB, requestId);
        return {
          success: true,
          items: after ? [after] : [],
          summary: { request_id: requestId, updated_fields: Object.keys(safe) },
          action_summary: `Content request ${requestId} updated: ${Object.keys(safe).join(', ')}`,
        };
      }

      // ── CANCEL CONTENT REQUEST ─────────────────────────────────────────────
      case 'cancel_content_request': {
        const requestId = typeof args.request_id === 'string' ? args.request_id : null;
        if (!requestId) return { success: false, error: 'request_id is required' };

        const before = await getContentRequestById(env.DB, requestId);
        if (!before) return { success: false, error: `Content request not found: ${requestId}` };

        await updateContentRequest(env.DB, requestId, { active: 0 });
        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_cancel_content_request',
          entity_type: 'content_request', entity_id: requestId,
          new_value: { active: 0 },
        });

        return {
          success: true,
          summary: { request_id: requestId },
          action_summary: `Content request ${requestId} cancelled (active=0)`,
        };
      }

      // ── ADD CLIENT TOPICS ──────────────────────────────────────────────────
      case 'add_client_topics': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const rawTopics = Array.isArray(args.topics) ? args.topics : [];
        const defaultContentType = typeof args.content_type === 'string' ? args.content_type : null;
        const defaultPlatforms = Array.isArray(args.platforms) && args.platforms.length > 0
          ? JSON.stringify(args.platforms as string[])
          : null;
        const defaultPriority = typeof args.priority === 'number' ? args.priority : 0;
        const defaultTargetDate = typeof args.target_date === 'string' ? args.target_date : null;

        // Accept either string[] or {topic, priority?, ...}[]
        const normalized: Array<{
          topic: string; content_type?: string | null; platforms?: string | null;
          target_date?: string | null; priority?: number; notes?: string | null;
        }> = [];
        for (const raw of rawTopics) {
          if (typeof raw === 'string') {
            if (raw.trim()) normalized.push({
              topic: raw.trim(),
              content_type: defaultContentType,
              platforms: defaultPlatforms,
              target_date: defaultTargetDate,
              priority: defaultPriority,
            });
          } else if (raw && typeof raw === 'object') {
            const r = raw as Record<string, unknown>;
            const t = typeof r['topic'] === 'string' ? (r['topic'] as string).trim() : '';
            if (!t) continue;
            normalized.push({
              topic: t,
              content_type: typeof r['content_type'] === 'string' ? (r['content_type'] as string) : defaultContentType,
              platforms:    Array.isArray(r['platforms']) ? JSON.stringify(r['platforms']) : defaultPlatforms,
              target_date:  typeof r['target_date'] === 'string' ? (r['target_date'] as string) : defaultTargetDate,
              priority:     typeof r['priority'] === 'number' ? (r['priority'] as number) : defaultPriority,
              notes:        typeof r['notes'] === 'string' ? (r['notes'] as string) : null,
            });
          }
        }

        if (normalized.length === 0) return { success: false, error: 'No valid topics in input' };

        const result = await addClientTopics(env.DB, client.id, normalized, user.userId);
        await writeAuditLog(env.DB, {
          user_id: user.userId, action: 'agent_add_client_topics',
          entity_type: 'client', entity_id: client.id,
          new_value: { inserted: result.inserted, content_type: defaultContentType },
        });

        return {
          success: true,
          summary: { client: slug, inserted: result.inserted, attempted: normalized.length, content_type: defaultContentType },
          suggestions: [
            `Call batch_create_content { client: "${slug}", use_queue: true, count: ${result.inserted} } to generate posts now.`,
            `Or call create_content_request { client: "${slug}", recurrence: "weekly", topic_strategy: "queue" } to drip them over time.`,
          ],
          action_summary: `Added ${result.inserted} topic${result.inserted !== 1 ? 's' : ''} to ${client.canonical_name}'s queue`,
        };
      }

      // ── LIST CLIENT TOPICS ─────────────────────────────────────────────────
      case 'list_client_topics': {
        const slug = typeof args.client === 'string' ? args.client : '';
        const client = await getClientBySlug(env.DB, slug);
        if (!client) return { success: false, error: `Client not found: ${slug}` };

        const statusRaw = typeof args.status === 'string' ? args.status : 'pending';
        const VALID_STATUS = new Set(['pending', 'used', 'skipped', 'all']);
        const status = VALID_STATUS.has(statusRaw) ? statusRaw : 'pending';
        const limit  = typeof args.limit === 'number' ? Math.max(1, Math.min(200, args.limit)) : 50;

        const rows = await listClientTopics(env.DB, client.id, status as 'pending' | 'used' | 'skipped' | 'all', limit);

        return {
          success: true,
          items: rows.map(r => ({
            id:           r.id,
            topic:        r.topic,
            content_type: r.content_type,
            platforms:    r.platforms,
            target_date:  r.target_date,
            priority:     r.priority,
            status:       r.status,
            used_post_id: r.used_post_id,
          })),
          summary: { client: slug, total: rows.length, status },
          action_summary: `${rows.length} ${status} topic${rows.length !== 1 ? 's' : ''} for ${client.canonical_name}`,
        };
      }

      case 'sync_post_urls': {
        const jobId = crypto.randomUUID().replace(/-/g, '').toLowerCase();
        ctx.waitUntil(runFetchUrls(env, jobId));
        return {
          success: true,
          job_id: jobId,
          action_summary: 'sync_post_urls job enqueued',
          summary: { job_id: jobId, status: 'enqueued' },
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

export async function buildSystemPrompt(env: Env): Promise<string> {
  let clients: { canonical_name: string; slug: string }[] = [];
  try {
    const all = await listClients(env.DB, 'active');
    clients = all.map(c => ({ canonical_name: c.canonical_name, slug: c.slug }));
  } catch { /* non-fatal */ }

  const today = new Date().toISOString().split('T')[0];
  const clientList = clients.map(c => `  ${c.canonical_name} → "${c.slug}"`).join('\n');

  return `You are WebXni Assistant powered by Hermes — the WebXni Marketing Platform AI agent.
TODAY'S DATE: ${today}

## ACTIVE CLIENTS
${clientList}

${AGENT_SKILLS}
${NL_INTENT_MAP}
${AGENT_MEMORY}
${QUALITY_REVIEW_RULES}
${CLIENT_EXPERTISE}
${BUYER_PERSONAS}
${RESPONSE_RULES}

Discord-specific interpretation rules:
- If the user sends plain text like "/weekly-content client:all provider:terminal", treat it as a weekly content generation request.
- For slash-like weekly content messages without an explicit date range, default to this week.
- If Marvin asks for today's content for all customers/clients, call generate_content with date_from and date_to set to today's date, client_slugs empty, provider terminal, and overwrite_existing false.
- Weekly content generation always uses the approved terminal workflow, not OpenAI.
- If the user asks what backend or model is being used, answer truthfully: the Discord bot is Hermes-first and uses OpenAI only as fallback when Hermes is unavailable.
- For one-off post/reel creation with pasted source copy, call create_content_with_image once with source_caption. Do not pass platforms unless Marvin named exact platforms; let the backend choose package-compatible connected platforms.
- When Marvin explicitly asks to create a new client profile, call create_client_profile first, then add/update services, service areas, intelligence, platforms, offers, or events as needed.
- If a requested client profile update fails because the client does not exist, ask whether to create the client profile or call create_client_profile when the same message clearly requested a new client.
- For messy client updates, first infer the client, then split facts by destination:
  Profile = legal name, package, contact info, website/WP base URL, state, industry, CTA, colors, logo, license, hours, payment methods, ownership, operational notes.
  Platforms = platform usernames, profile URLs, page/account/location/board/channel IDs, pause state, privacy settings, connection notes, Google Guarantee or verification notes.
  Intelligence + Plan = brand voice, audience, service priorities, SEO keywords, prohibited phrases, approved CTAs, content goals, local SEO themes, monthly/seasonal strategy.
  Services = service/category additions, renames, descriptions, deactivations, or removals.
  Areas = cities, counties, ZIPs, primary hub, radius, rotation/geo-targeting notes.
  Google Business = offers, events, GBP CTA fields, coupons, validity dates, recurring GBP items, GBP location-specific notes.
- Apply clear updates without asking for a structured form. Ask one concise follow-up only when the target client or destructive intent is ambiguous.
- When Marvin asks to pull/sync connected Upload-Post accounts, or during onboarding after upload_post_profile is set, call sync_upload_post_platforms for that client.
- Preserve uncertain or no-column facts in profile notes, platform notes, feedback_summary, or local_seo_themes rather than dropping them. Examples: Google Guarantee status goes to the Google Business platform notes unless Marvin gives a dedicated GBP location/update target.
- Never delete or archive a client, platform, service, area, offer, or event unless Marvin explicitly asks and confirms it. Use confirmed=true only after that confirmation.`;
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

  // Up to 8 iterations — allows create → review → improve autonomous cycles.
  // (e.g. "add these topics then generate 5 posts" → add_client_topics +
  // batch_create_content + get_posts (quality review) + update_post + final message)
  for (let iter = 0; iter < 8; iter++) {
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
            model: 'gpt-4o',
            messages,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            temperature: 0.3,
            max_tokens: 2000,
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
        result = await executeTool(toolName, toolArgs, env, user, baseUrl, ctx, openAiKey);
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

export async function logInteraction(db: D1Database, user: SessionData, message: string, result: AgentStructuredResponse) {
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
// MCP bridge — bearer-authenticated public route for terminal agents
// ─────────────────────────────────────────────────────────────────────────────

aiRoutes.post('/mcp/run', async (c) => {
  if (!requireMcpBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { message?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> };
  try { body = (await c.req.json()) as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const userMessage = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!userMessage) return c.json({ error: 'message is required' }, 400);

  const openAiKey = await resolveAgentOpenAiKey(c.env);
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
      systemPrompt,
      openAiKey,
      env: c.env,
      user: MCP_AGENT_USER,
      baseUrl,
      ctx: c.executionCtx,
    });

    c.executionCtx.waitUntil(logInteraction(c.env.DB, MCP_AGENT_USER, userMessage, result));
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ai/mcp/run] error:', msg);
    return c.json({ error: msg }, 500);
  }
});

aiRoutes.post('/mcp/execute-tool', async (c) => {
  if (!requireMcpBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { tool_name?: string; args?: Record<string, unknown> };
  try { body = (await c.req.json()) as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const toolName = typeof body?.tool_name === 'string' ? body.tool_name.trim() : '';
  if (!toolName) return c.json({ error: 'tool_name is required' }, 400);

  const openAiKey = await resolveAgentOpenAiKey(c.env);
  if (!openAiKey) return c.json({ error: 'OpenAI API key not configured' }, 503);

  let baseUrl = 'https://marketing.webxni.com';
  try { baseUrl = new URL(c.req.url).origin; } catch { /* keep default */ }

  try {
    const result = await executeTool(toolName, body.args ?? {}, c.env, MCP_AGENT_USER, baseUrl, c.executionCtx, openAiKey);
    c.executionCtx.waitUntil(logInteraction(c.env.DB, MCP_AGENT_USER, `${toolName} ${JSON.stringify(body.args ?? {})}`, {
      message: result.action_summary ?? result.error ?? toolName,
      summary: result.summary,
      items: result.items,
      actions_taken: result.action_summary ? [result.action_summary] : [],
      suggestions: result.suggestions,
      errors: result.error ? [result.error] : [],
      tools_used: [toolName],
      job_id: result.job_id,
    }));
    return c.json({ ok: result.success, tool_name: toolName, ...result }, result.success ? 200 : 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ai/mcp/execute-tool] error:', msg);
    return c.json({ error: msg }, 500);
  }
});

aiRoutes.post('/mcp/heartbeat', async (c) => {
  if (!requireMcpBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: {
    status?: 'ok' | 'warning' | 'error';
    title?: string;
    message?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
  try { body = (await c.req.json()) as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (!c.env.DISCORD_BOT_TOKEN || !c.env.DISCORD_CHANNEL_ID) {
    return c.json({ error: 'Discord channel/token is not configured' }, 400);
  }

  const status = body?.status === 'warning' || body?.status === 'error' ? body.status : 'ok';
  const color = status === 'error'
    ? DISCORD_COLORS.error
    : status === 'warning'
      ? DISCORD_COLORS.warning
      : DISCORD_COLORS.success;

  await discordSend({
    channelId: c.env.DISCORD_CHANNEL_ID,
    token: c.env.DISCORD_BOT_TOKEN,
    embeds: [{
      title: body?.title?.trim() || 'WebXni MCP Agent',
      description: body?.message?.trim() || 'Sin detalles adicionales.',
      color,
      fields: body?.fields?.slice(0, 10),
      timestamp: new Date().toISOString(),
      footer: { text: 'WebXni MCP Agent' },
    }],
  });

  return c.json({ ok: true, status });
});

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
      systemPrompt = `You are WebXni Assistant powered by Hermes. Today is ${new Date().toISOString().split('T')[0]}. ${RESPONSE_RULES}`;
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
