/**
 * Internal Worker-to-Worker routes — no auth middleware.
 * Only reachable via the SELF service binding (not the public internet).
 */
import { Hono, type Context } from 'hono';
import type { Env, SessionData } from '../types';
import { executeSlotWork, planGeneration, prepareGenerationPlan, triggerStep } from '../loader/generation-run';
import { isRepairKeyValid, repairExistingBlogs } from '../loader/repair-blogs';
import { planBlogRegen, executeBlogRegenSlot, triggerBlogRegenStep } from '../loader/blog-regen';
import { cleanupLegacyInvalidPlatformAttempts, repairOrphanScheduledPosts, syncPublishedUrls } from '../modules/published-urls';
import { getClientProfileAnalytics } from '../modules/reporting-metrics';
import { discordSend, DISCORD_COLORS } from '../services/discord';
import { buildSystemPrompt, executeTool, logInteraction, runAgent } from './ai';
import {
  appendGenerationError,
  appendGenerationLog,
  createGenerationRun,
  finalizeGenerationRun,
  getAgentClientReportSummary,
  getAgentSystemHealthSnapshot,
  getGenerationRunById,
  getLatestAuditMarker,
  getClientPlatforms,
  listClients,
  createApprovedCommandJob,
  writeAuditLog,
} from '../db/queries';

export const internalRoutes = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();

function detail(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message;
  return String(err);
}

function requireAgentBearer(c: Context<{ Bindings: Env; Variables: Record<string, unknown> }>): boolean {
  const expected = c.env.AGENT_INTERNAL_TOKEN?.trim();
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return !!expected && token === expected;
}

function parseClientFilter(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function makeAgentExecutionKey(prefix: string, from: string, to: string, clientSlugs: string[]): string {
  const scope = clientSlugs.length > 0 ? clientSlugs.sort().join(',') : 'all-active';
  return `${prefix}:${from}:${to}:${scope}`;
}

interface ApprovedClaudeJobArgs {
  run_id: string;
  client_slugs: string[];
  period_start: string;
  period_end: string;
  content_only: true;
  generate_images: false;
  provider: 'claude';
  requested_in: 'agent_mcp';
}

const INTERNAL_AGENT_USER: SessionData = {
  userId: 'agent-mcp',
  email: 'agent-mcp@internal.webxni',
  name: 'WebXni MCP Agent',
  role: 'admin',
  clientId: null,
};

async function resolveAgentOpenAiKey(env: Env): Promise<string> {
  let openAiKey = env.OPENAI_API_KEY || '';
  if (!openAiKey) {
    try {
      const raw = await env.KV_BINDING.get('settings:system');
      const settings: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
      openAiKey = settings['ai_api_key'] || '';
    } catch { /* ignore */ }
  }
  return openAiKey;
}

function getRequestBaseUrl(c: Context<{ Bindings: Env; Variables: Record<string, unknown> }>): string {
  try { return new URL(c.req.url).origin; } catch { return 'https://marketing.webxni.com'; }
}

/**
 * POST /internal/gen-step   body: { run_id, slot_idx }
 *
 * Sequential slot runner:
 *   1. Execute exactly one slot in this request.
 *   2. If more work remains, queue the next self-dispatch in waitUntil.
 *   3. The queued task performs only the next-hop dispatch and logging.
 */
internalRoutes.post('/gen-step', async (c) => {
  let body: { run_id?: string; slot_idx?: number } = {};
  try { body = await c.req.json<{ run_id?: string; slot_idx?: number }>(); } catch { /* ignore */ }

  const { run_id, slot_idx } = body;
  if (!run_id || typeof run_id !== 'string' || typeof slot_idx !== 'number') {
    console.error('[gen-step] invalid body:', JSON.stringify(body));
    return c.json({ error: 'run_id and slot_idx (number) required' }, 400);
  }

  const runId = run_id;
  const slotIdx = slot_idx;
  const baseUrl = new URL(c.req.url).origin;

  async function log(level: 'INFO' | 'AI' | 'SAVED' | 'WARN' | 'ERROR' | 'START' | 'DONE', message: string) {
    try { await appendGenerationLog(c.env.DB, runId, level, message); } catch { /* ignore */ }
  }

  async function logError(message: string) {
    try { await appendGenerationError(c.env.DB, runId, message); } catch { /* ignore */ }
  }

  try {
    const run = await c.env.DB
      .prepare('SELECT status, total_slots FROM generation_runs WHERE id = ?')
      .bind(runId)
      .first<{ status: string; total_slots: number }>();

    if (!run || run.status !== 'running') {
      console.log(`[gen-step] slot${slotIdx} skipped — status: ${run?.status ?? 'not found'}`);
      return c.json({ ok: true, skipped: true });
    }

    await log('INFO', `Route entered: /internal/gen-step slot ${slotIdx + 1}/${run.total_slots}`);

    const result = await executeSlotWork(c.env, runId, slotIdx);

    await log('INFO', `Route complete: /internal/gen-step slot ${slotIdx + 1}/${run.total_slots} outcome=${result.outcome}`);

    if (result.outcome === 'continue' && typeof result.nextSlot === 'number' && typeof result.totalSlots === 'number') {
      await log('INFO', `Next-step queued: slot ${result.nextSlot + 1}/${result.totalSlots}`);
      c.executionCtx.waitUntil((async () => {
        try {
          await log('INFO', `Next-step dispatch start: slot ${result.nextSlot! + 1}/${result.totalSlots!}`);
          await triggerStep(c.env, baseUrl, runId, result.nextSlot!);
          await log('INFO', `Next-step dispatch success: slot ${result.nextSlot! + 1}/${result.totalSlots!}`);
        } catch (err) {
          const msg = `Trigger failed for slot ${result.nextSlot! + 1}: ${err instanceof Error ? err.message : String(err)}`;
          await log('ERROR', msg);
          await logError(`Dispatch failure after slot ${slotIdx}\n${detail(err)}`);

          const latest = await getGenerationRunById(c.env.DB, runId);
          if (latest && latest.status === 'running') {
            const errorLog = latest.error_log
              ? `${latest.error_log}\n${msg}`
              : msg;
            const finalStatus = latest.posts_created > 0 ? 'completed_with_errors' : 'failed';
            await finalizeGenerationRun(c.env.DB, runId, finalStatus, latest.posts_created, errorLog);
          }
        }
      })());
    }

    return c.json({ ok: true, outcome: result.outcome, next_slot: result.nextSlot ?? null });
  } catch (err) {
    console.error(`[gen-step] slot${slotIdx} route crash:`, err);
    await log('ERROR', `Route crash: slot ${slotIdx} — ${err instanceof Error ? err.message : String(err)}`);
    await logError(`Route crash: slot ${slotIdx}\n${detail(err)}`);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

internalRoutes.post('/repair-blogs', async (c) => {
  if (!isRepairKeyValid(c.req.header('x-repair-key'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const stats = await repairExistingBlogs(c.env);
    return c.json({ ok: true, stats });
  } catch (err) {
    console.error('[repair-blogs] failed:', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

/**
 * POST /internal/regen-blogs
 *
 * Starts a full blog regeneration run using the high-quality SEO system.
 * Body (optional JSON): { client_slugs?: string[] }
 * Auth: x-repair-key header
 *
 * Returns immediately with { ok, run_id, total }.
 * Processing runs asynchronously via chained /internal/blog-regen-step calls.
 *
 * Monitor at: GET /api/run/generate/runs/:run_id
 */
internalRoutes.post('/regen-blogs', async (c) => {
  if (!isRepairKeyValid(c.req.header('x-repair-key'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: { client_slugs?: string[] } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const clientSlugs: string[] = Array.isArray(body.client_slugs) ? body.client_slugs : [];

  const run = await createGenerationRun(c.env.DB, {
    triggered_by:  'blog-regen',
    date_range:    'all-blogs',
    client_filter: clientSlugs.length > 0 ? JSON.stringify(clientSlugs) : null,
    overwrite_existing: true,
  });

  const baseUrl = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    planBlogRegen(c.env, run.id, { clientSlugs }, baseUrl),
  );

  return c.json({ ok: true, run_id: run.id, message: 'Blog regen started — check /api/run/generate/runs/:run_id for progress' }, 202);
});

/**
 * POST /internal/blog-regen-step   body: { run_id, slot_idx }
 *
 * Processes exactly one blog post, then queues the next step via waitUntil.
 * Internal only — called via SELF service binding.
 */
internalRoutes.post('/blog-regen-step', async (c) => {
  let body: { run_id?: string; slot_idx?: number } = {};
  try { body = await c.req.json<{ run_id?: string; slot_idx?: number }>(); } catch { /* ignore */ }

  const { run_id, slot_idx } = body;
  if (!run_id || typeof run_id !== 'string' || typeof slot_idx !== 'number') {
    return c.json({ error: 'run_id and slot_idx (number) required' }, 400);
  }

  const runId   = run_id;
  const slotIdx = slot_idx;
  const baseUrl = new URL(c.req.url).origin;

  const log = async (level: Parameters<typeof appendGenerationLog>[2], msg: string) => {
    try { await appendGenerationLog(c.env.DB, runId, level, msg); } catch { /* */ }
  };
  const logErr = async (msg: string) => {
    try { await appendGenerationError(c.env.DB, runId, msg); } catch { /* */ }
  };

  try {
    const run = await c.env.DB
      .prepare('SELECT status, total_slots FROM generation_runs WHERE id = ?')
      .bind(runId)
      .first<{ status: string; total_slots: number }>();

    if (!run || run.status !== 'running') {
      return c.json({ ok: true, skipped: true });
    }

    await log('INFO', `Route entered: blog-regen-step slot ${slotIdx + 1}/${run.total_slots}`);

    const result = await executeBlogRegenSlot(c.env, runId, slotIdx);

    await log('INFO', `Route complete: slot ${slotIdx + 1}/${run.total_slots} outcome=${result.outcome}`);

    if (result.outcome === 'continue' && typeof result.nextSlot === 'number') {
      c.executionCtx.waitUntil((async () => {
        try {
          await log('INFO', `Dispatching next: slot ${result.nextSlot! + 1}/${result.total}`);
          await triggerBlogRegenStep(c.env, baseUrl, runId, result.nextSlot!);
        } catch (err) {
          const msg = `Dispatch failed after slot ${slotIdx}: ${err instanceof Error ? err.message : String(err)}`;
          await log('ERROR', msg);
          await logErr(msg);
          const latest = await getGenerationRunById(c.env.DB, runId);
          if (latest && latest.status === 'running') {
            await finalizeGenerationRun(c.env.DB, runId, 'completed_with_errors', 0, msg);
          }
        }
      })());
    }

    return c.json({ ok: true, outcome: result.outcome, next_slot: result.nextSlot ?? null });
  } catch (err) {
    console.error(`[blog-regen-step] slot${slotIdx} crash:`, err);
    await log('ERROR', `Route crash: ${err instanceof Error ? err.message : String(err)}`);
    await logErr(`Route crash slot${slotIdx}`);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

internalRoutes.post('/repair-posting-state', async (c) => {
  if (!isRepairKeyValid(c.req.header('x-repair-key'))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const [cleanup, sync, orphan] = await Promise.all([
      cleanupLegacyInvalidPlatformAttempts(c.env.DB),
      syncPublishedUrls(c.env),
      repairOrphanScheduledPosts(c.env.DB),
    ]);
    return c.json({ ok: true, cleanup, sync, orphan });
  } catch (err) {
    console.error('[repair-posting-state] failed:', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

internalRoutes.post('/agent/check-system-health', async (c) => {
  if (!requireAgentBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { lookback_hours?: number; stale_user_days?: number } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  try {
    const snapshot = await getAgentSystemHealthSnapshot(c.env.DB, {
      lookbackHours: body.lookback_hours,
      staleUserDays: body.stale_user_days,
    });
    return c.json({ ok: true, snapshot });
  } catch (err) {
    console.error('[agent/check-system-health] failed:', err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

internalRoutes.post('/agent/run-weekly-marketing-pipeline', async (c) => {
  if (!requireAgentBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: {
    period_start?: string;
    period_end?: string;
    client_slugs?: string[];
    overwrite_existing?: boolean;
    publish_time?: string;
    provider?: 'openai' | 'claude';
    force?: boolean;
  } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const periodStart = body.period_start?.trim();
  const periodEnd = body.period_end?.trim() ?? periodStart;
  if (!periodStart || !periodEnd) return c.json({ error: 'period_start and period_end are required' }, 400);

  const clientSlugs = parseClientFilter(body.client_slugs);
  const provider = body.provider === 'openai' ? 'openai' : 'claude';
  const executionKey = makeAgentExecutionKey(`weekly-pipeline:${provider}`, periodStart, periodEnd, clientSlugs);
  const previous = await getLatestAuditMarker(c.env.DB, 'agent.weekly_pipeline.queued', 'agent_execution', executionKey);
  if (previous && body.force !== true) {
    return c.json({ ok: true, skipped: true, reason: 'already_queued', execution_key: executionKey, previous });
  }

  const run = await createGenerationRun(c.env.DB, {
    triggered_by: 'agent-mcp',
    date_range: `${periodStart}:${periodEnd}`,
    client_filter: clientSlugs.length > 0 ? JSON.stringify(clientSlugs) : null,
    overwrite_existing: body.overwrite_existing === true,
  });

  const publishTime = typeof body.publish_time === 'string' && /^\d{2}:\d{2}$/.test(body.publish_time)
    ? body.publish_time
    : null;
  const baseUrl = new URL(c.req.url).origin;

  if (provider === 'claude') {
    const params = {
      run_id: run.id,
      client_slugs: clientSlugs,
      period_start: periodStart,
      period_end: periodEnd,
      triggered_by: 'agent-mcp',
      publish_time: publishTime,
      overwrite_existing: body.overwrite_existing === true,
      high_quality: true,
      provider,
    } as const;
    const { slots, clients } = await prepareGenerationPlan(c.env, params);
    await c.env.DB.prepare(
      `UPDATE generation_runs
       SET post_slots = ?, total_slots = ?, current_slot_idx = 0, publish_time = ?, progress_json = ?, last_activity_at = ?
       WHERE id = ?`,
    ).bind(
      JSON.stringify(slots),
      slots.length,
      publishTime ?? '10:00',
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
    await appendGenerationLog(c.env.DB, run.id, 'START', `Claude terminal job queued from MCP agent — ${periodStart} → ${periodEnd}`);

    const args: ApprovedClaudeJobArgs = {
      run_id: run.id,
      client_slugs: clientSlugs,
      period_start: periodStart,
      period_end: periodEnd,
      content_only: true,
      generate_images: false,
      provider: 'claude',
      requested_in: 'agent_mcp',
    };
    const job = await createApprovedCommandJob(c.env.DB, {
      generation_run_id: run.id,
      command_name: 'weekly_content_claude',
      provider: 'claude',
      requested_by: 'agent-mcp',
      args_json: JSON.stringify(args),
    });

    await writeAuditLog(c.env.DB, {
      action: 'agent.weekly_pipeline.queued',
      entity_type: 'agent_execution',
      entity_id: executionKey,
      new_value: {
        run_id: run.id,
        job_id: job.id,
        provider,
        period_start: periodStart,
        period_end: periodEnd,
        client_slugs: clientSlugs,
      },
    });

    return c.json({
      ok: true,
      mode: 'approved_terminal_job',
      provider,
      run_id: run.id,
      approved_job_id: job.id,
      execution_key: executionKey,
      total_slots: slots.length,
    }, 202);
  }

  c.executionCtx.waitUntil(
    planGeneration(c.env, {
      run_id: run.id,
      client_slugs: clientSlugs,
      period_start: periodStart,
      period_end: periodEnd,
      triggered_by: 'agent-mcp',
      publish_time: publishTime,
      overwrite_existing: body.overwrite_existing === true,
      high_quality: true,
      provider,
    }, baseUrl),
  );

  await writeAuditLog(c.env.DB, {
    action: 'agent.weekly_pipeline.queued',
    entity_type: 'agent_execution',
    entity_id: executionKey,
    new_value: {
      run_id: run.id,
      provider,
      period_start: periodStart,
      period_end: periodEnd,
      client_slugs: clientSlugs,
    },
  });

  return c.json({
    ok: true,
    mode: 'worker_api',
    provider,
    run_id: run.id,
    execution_key: executionKey,
  }, 202);
});

internalRoutes.post('/agent/dispatch-client-reports', async (c) => {
  if (!requireAgentBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: {
    from?: string;
    to?: string;
    client_slugs?: string[];
    force?: boolean;
  } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const from = body.from?.trim();
  const to = body.to?.trim() ?? from;
  if (!from || !to) return c.json({ error: 'from and to are required' }, 400);

  const clientSlugs = parseClientFilter(body.client_slugs);
  const executionKey = makeAgentExecutionKey('client-reports', from, to, clientSlugs);
  const previous = await getLatestAuditMarker(c.env.DB, 'agent.client_reports.compiled', 'agent_execution', executionKey);
  if (previous && body.force !== true) {
    return c.json({ ok: true, skipped: true, reason: 'already_compiled', execution_key: executionKey, previous });
  }

  const allClients = await listClients(c.env.DB, 'active');
  const clients = clientSlugs.length > 0
    ? allClients.filter((client) => clientSlugs.includes(client.slug))
    : allClients;

  const reports = await Promise.all(clients.map(async (client) => {
    const [platforms, summary] = await Promise.all([
      getClientPlatforms(c.env.DB, client.id),
      getAgentClientReportSummary(c.env.DB, client.id, from, to),
    ]);
    const analytics = await getClientProfileAnalytics(c.env, {
      upload_post_profile: client.upload_post_profile,
      platform_page_ids: Object.fromEntries(platforms.map((platform) => [platform.platform, platform.page_id ?? platform.linkedin_urn ?? ''])),
    }, {
      from,
      to,
      platforms: platforms.map((platform) => platform.platform),
    });

    return {
      client_id: client.id,
      client_slug: client.slug,
      client_name: client.canonical_name,
      period: { from, to },
      summary,
      analytics,
    };
  }));

  await writeAuditLog(c.env.DB, {
    action: 'agent.client_reports.compiled',
    entity_type: 'agent_execution',
    entity_id: executionKey,
    new_value: {
      from,
      to,
      clients: reports.map((report) => report.client_slug),
      report_count: reports.length,
    },
  });

  return c.json({
    ok: true,
    execution_key: executionKey,
    reports,
  });
});

internalRoutes.post('/agent/send-heartbeat-notification', async (c) => {
  if (!requireAgentBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: {
    status?: 'ok' | 'warning' | 'error';
    title?: string;
    message?: string;
    dedupe_key?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const title = body.title?.trim() || 'WebXni Agent Heartbeat';
  const message = body.message?.trim() || 'Sin detalles adicionales.';
  const status = body.status === 'warning' || body.status === 'error' ? body.status : 'ok';
  const dedupeKey = body.dedupe_key?.trim() || `heartbeat:${status}:${new Date().toISOString().slice(0, 10)}`;

  const previous = await getLatestAuditMarker(c.env.DB, 'agent.heartbeat.sent', 'agent_execution', dedupeKey);
  if (previous) {
    return c.json({ ok: true, skipped: true, reason: 'already_sent', dedupe_key: dedupeKey, previous });
  }

  if (!c.env.DISCORD_BOT_TOKEN || !c.env.DISCORD_CHANNEL_ID) {
    return c.json({ error: 'Discord channel/token is not configured' }, 400);
  }

  const color = status === 'error'
    ? DISCORD_COLORS.error
    : status === 'warning'
      ? DISCORD_COLORS.warning
      : DISCORD_COLORS.success;

  await discordSend({
    channelId: c.env.DISCORD_CHANNEL_ID,
    token: c.env.DISCORD_BOT_TOKEN,
    embeds: [{
      title,
      description: message,
      color,
      fields: body.fields?.slice(0, 10),
      timestamp: new Date().toISOString(),
      footer: { text: 'WebXni MCP Agent' },
    }],
  });

  await writeAuditLog(c.env.DB, {
    action: 'agent.heartbeat.sent',
    entity_type: 'agent_execution',
    entity_id: dedupeKey,
    new_value: {
      status,
      title,
      message,
      fields: body.fields ?? [],
    },
  });

  return c.json({ ok: true, status, dedupe_key: dedupeKey });
});

internalRoutes.post('/agent/run', async (c) => {
  if (!requireAgentBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { message?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return c.json({ error: 'message is required' }, 400);

  try {
    const openAiKey = await resolveAgentOpenAiKey(c.env);
    if (!openAiKey) return c.json({ error: 'OpenAI API key not configured' }, 503);

    let systemPrompt = '';
    try { systemPrompt = await buildSystemPrompt(c.env); } catch {
      systemPrompt = `You are the WebXni Marketing Platform AI Agent. Today is ${new Date().toISOString().split('T')[0]}.`;
    }

    const result = await runAgent({
      message,
      history: Array.isArray(body.history) ? body.history : [],
      systemPrompt,
      openAiKey,
      env: c.env,
      user: INTERNAL_AGENT_USER,
      baseUrl: getRequestBaseUrl(c),
      ctx: c.executionCtx,
    });

    c.executionCtx.waitUntil(logInteraction(c.env.DB, INTERNAL_AGENT_USER, message, result));
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent/run] failed:', err);
    return c.json({ error: msg }, 500);
  }
});

internalRoutes.post('/agent/execute-tool', async (c) => {
  if (!requireAgentBearer(c)) return c.json({ error: 'Unauthorized' }, 401);

  let body: { tool_name?: string; args?: Record<string, unknown> } = {};
  try { body = await c.req.json(); } catch { /* optional */ }

  const toolName = typeof body.tool_name === 'string' ? body.tool_name.trim() : '';
  if (!toolName) return c.json({ error: 'tool_name is required' }, 400);

  try {
    const openAiKey = await resolveAgentOpenAiKey(c.env);
    if (!openAiKey) return c.json({ error: 'OpenAI API key not configured' }, 503);

    const result = await executeTool(
      toolName,
      body.args ?? {},
      c.env,
      INTERNAL_AGENT_USER,
      getRequestBaseUrl(c),
      c.executionCtx,
      openAiKey,
    );

    const logResult = result.success
      ? {
          message: result.action_summary ?? `${toolName} executed.`,
          summary: result.summary,
          items: result.items,
          actions_taken: result.action_summary ? [result.action_summary] : [],
          suggestions: result.suggestions,
          errors: [],
          tools_used: [toolName],
          job_id: result.job_id,
        }
      : {
          message: result.error ?? `${toolName} failed.`,
          actions_taken: [],
          errors: result.error ? [result.error] : [`${toolName} failed`],
          tools_used: [toolName],
        };

    c.executionCtx.waitUntil(
      logInteraction(
        c.env.DB,
        INTERNAL_AGENT_USER,
        `${toolName} ${JSON.stringify(body.args ?? {})}`,
        logResult,
      ),
    );

    return c.json({
      ok: result.success,
      tool_name: toolName,
      ...result,
    }, result.success ? 200 : 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[agent/execute-tool] failed:', err);
    return c.json({ error: msg }, 500);
  }
});
