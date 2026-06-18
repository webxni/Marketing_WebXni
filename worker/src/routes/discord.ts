/**
 * Discord routes
 *
 * POST /api/discord/interact   — Discord interactions endpoint (slash commands)
 *                                Set this as your Interactions Endpoint URL in the
 *                                Discord Developer Portal.
 *                                No auth middleware — Discord signs requests with Ed25519.
 *
 * POST /internal/discord/register — One-time: register slash commands with Discord.
 * POST /internal/discord/notify   — Send a manual notification to the channel.
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import {
  verifyDiscordSignature,
  discordSend, discordPatchInteraction, discordDM,
  registerSlashCommands,
  DISCORD_COLORS,
} from '../services/discord';
import { runAgent } from './ai';
import {
  appendGenerationLog,
  appendStructuredGenerationError,
  appendApprovedCommandJobError,
  finalizeGenerationRun,
  createApprovedCommandJob,
  createGenerationRun,
  claimNextApprovedCommandJob,
  getGenerationRunById,
  getApprovedCommandJobById,
  completeApprovedCommandJob,
  markApprovedCommandJobRunning,
  updateApprovedCommandJobProgress,
  listAgencyOverview,
  listAgentDefinitions,
  createAgentTask,
  updateAgentTask,
  appendAgencyLog,
} from '../db/queries';
import { prepareGenerationPlan, prebuildApprovedTerminalSlotRequests, buildSlotGenerationRequest, saveGeneratedSlotResult, type PreparedApprovedSlotRequest, type SlotTopicSelection } from '../loader/generation-run';
import { createContentWithImage } from '../loader/autonomous-content';
import type { GeneratedPost } from '../services/openai';

// ── Types ──────────────────────────────────────────────────────────────────────

const DISCORD_AGENCY_BACKEND_PRIORITY: Record<string, string[]> = {
  'agency-orchestrator': ['hermes', 'claude_code', 'codex', 'openai'],
  'system-reliability': ['hermes', 'claude_code', 'codex', 'openai'],
  'security-sentinel': ['hermes', 'claude_code', 'codex', 'openai'],
  'client-research': ['hermes', 'gemini_cli', 'openai'],
  strategy: ['hermes', 'claude_code', 'codex', 'openai'],
  'social-copy': ['hermes', 'claude_code', 'codex', 'openai'],
  'blog-writer': ['hermes', 'claude_code', 'codex', 'openai'],
  'editorial-review': ['hermes', 'claude_code', 'codex', 'openai'],
};

interface DiscordInteractionOption {
  name:    string;
  type:    number;
  value?:  string | number | boolean;
}

interface DiscordInteraction {
  id:              string;
  application_id:  string;
  type:            number; // 1=PING, 2=APPLICATION_COMMAND
  token:           string; // interaction token (used for follow-up, expires 15min)
  guild_id?:       string;
  channel_id?:     string;
  member?: {
    user: { id: string; username: string; global_name?: string };
  };
  user?: {
    id: string; username: string; global_name?: string;
  };
  data?: {
    name:     string;
    options?: DiscordInteractionOption[];
  };
}

interface ApprovedTerminalJobArgs {
  run_id: string;
  client_slugs: string[];
  period_start: string;
  period_end: string;
  content_only: true;
  generate_images: false;
  provider: 'terminal';
  requested_in: 'discord';
  prepared_slots?: PreparedApprovedSlotRequest[];
}

const DISCORD_AGENCY_AGENTS: Record<string, string> = {
  orchestrator: 'agency-orchestrator',
  system: 'system-reliability',
  security: 'security-sentinel',
  research: 'client-research',
  strategy: 'strategy',
  social: 'social-copy',
  blog: 'blog-writer',
  editorial: 'editorial-review',
};

const DISCORD_AGENCY_COMMANDS: Record<string, string> = {
  'agency-orchestrator': 'agency_orchestrator',
  'system-reliability': 'agency_system_review',
  'security-sentinel': 'agency_security_review',
  'client-research': 'agency_client_research',
  strategy: 'agency_strategy',
  'social-copy': 'agency_social_generation',
  'blog-writer': 'agency_blog_generation',
  'editorial-review': 'agency_editorial_review',
};

// ── Routes ─────────────────────────────────────────────────────────────────────

export const discordInteractRoute = new Hono<{ Bindings: Env }>();
export const discordInternalRoute = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/discord/interact
// Discord sends all slash commands here. Must respond within 3s.
// ─────────────────────────────────────────────────────────────────────────────

discordInteractRoute.post('/interact', async (c) => {
  const body      = await c.req.text();
  const signature = c.req.header('x-signature-ed25519') ?? '';
  const timestamp = c.req.header('x-signature-timestamp') ?? '';

  // Discord public key — required for signature verification
  const publicKey = c.env.DISCORD_PUBLIC_KEY ?? '';
  if (!publicKey) {
    console.error('[discord] DISCORD_PUBLIC_KEY not set');
    return c.json({ error: 'Not configured' }, 500);
  }

  const valid = await verifyDiscordSignature(body, signature, timestamp, publicKey);
  if (!valid) {
    console.warn('[discord] invalid signature');
    return c.json({ error: 'Invalid request signature' }, 401);
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // ── PING — Discord verifies our endpoint with this on first setup ──
  if (interaction.type === 1) {
    return c.json({ type: 1 });
  }

  // ── APPLICATION_COMMAND ────────────────────────────────────────────
  if (interaction.type === 2) {
    const commandName = interaction.data?.name ?? '';
    const discordUser = (interaction.member?.user ?? interaction.user);
    const username    = discordUser?.global_name ?? discordUser?.username ?? 'Discord user';

    // Idempotency — Discord retries interactions if our endpoint is slow,
    // which could cause duplicate post creation for /create-post, /create-blog, etc.
    // Key by interaction.id (unique per user-triggered command); skip on replay.
    const idemKey = `discord:interact:${interaction.id}`;
    try {
      const existing = await c.env.KV_BINDING.get(idemKey);
      if (existing) {
        console.log(`[discord] duplicate interaction ${interaction.id} — skipping`);
        return c.json({ type: 5 });
      }
      await c.env.KV_BINDING.put(idemKey, '1', { expirationTtl: 900 });
    } catch (err) {
      console.warn(`[discord] idempotency check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log(`[discord] /${commandName} from ${username}`);

    // Defer immediately — we have max 3s before Discord times out
    // Then run the real work in waitUntil()
    c.executionCtx.waitUntil(
      handleCommand(interaction, commandName, username, c.env, c.executionCtx),
    );

    // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE — shows "Bot is thinking…"
    return c.json({ type: 5 });
  }

  return c.json({ type: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handle slash commands in background
// ─────────────────────────────────────────────────────────────────────────────

async function handleCommand(
  interaction: DiscordInteraction,
  commandName: string,
  username:    string,
  env:         Env,
  ctx:         ExecutionContext,
): Promise<void> {
  const appId    = env.DISCORD_APPLICATION_ID ?? '';
  const botToken = env.DISCORD_BOT_TOKEN ?? '';
  const token    = interaction.token;

  if (!appId || !botToken) {
    await discordPatchInteraction({
      applicationId: appId || 'unknown',
      token, botToken,
      content: '❌ Discord is not fully configured (missing APPLICATION_ID or BOT_TOKEN).',
    });
    return;
  }

  // Resolve the user message for agent-backed commands
  let agentMessage: string | null = null;

  if (commandName === 'ask') {
    agentMessage = (interaction.data?.options?.find(o => o.name === 'message')?.value as string) ?? '';
    if (!agentMessage.trim()) {
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: '❌ Please provide a message.' });
      return;
    }
  } else if (commandName === 'status') {
    agentMessage = 'Run a system health check and tell me what issues you find.';
  } else if (commandName === 'queue') {
    agentMessage = 'Show me the current posting queue with overdue/due-soon counts.';
  } else if (commandName === 'failed') {
    agentMessage = 'Show me all failed posts grouped by client.';
  } else if (commandName === 'create-post' || commandName === 'create-blog') {
    const opts         = interaction.data?.options ?? [];
    const clientSlug   = (opts.find(o => o.name === 'client')?.value       as string | undefined) ?? '';
    const platformsRaw = (opts.find(o => o.name === 'platforms')?.value    as string | undefined) ?? '';
    const contentType  = commandName === 'create-blog'
      ? 'blog'
      : ((opts.find(o => o.name === 'content_type')?.value as string | undefined) ?? 'image');
    const topic        = (opts.find(o => o.name === 'topic')?.value        as string | undefined)
                      ?? (opts.find(o => o.name === 'question')?.value     as string | undefined);
    const publishDate  = (opts.find(o => o.name === 'publish_date')?.value as string | undefined)
                      ?? (opts.find(o => o.name === 'date')?.value         as string | undefined);

    if (!clientSlug) {
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: '❌ `client` is required.' });
      return;
    }

    const openAiKey = await resolveOpenAiKey(env);
    if (!openAiKey) {
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: '❌ OpenAI API key not configured.' });
      return;
    }

    const platforms = platformsRaw
      ? platformsRaw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean)
      : [];

    // Acknowledge immediately — creation takes 20-60 seconds
    const typeLabel = contentType === 'blog' ? 'blog post' : `${contentType} post`;
    await discordPatchInteraction({
      applicationId: appId, token, botToken,
      content: `⏳ Creating ${typeLabel} for **${clientSlug}**${topic ? ` about "${topic}"` : ' (auto-researched topic)'}…\nThis takes ~30 seconds. A new notification will appear when ready.`,
    });

    // Run full orchestration (deferred — already ack'd above)
    try {
      const result = await createContentWithImage(env, {
        clientSlug,
        platforms: platforms.length > 0 ? platforms : undefined,
        contentType: contentType as 'image' | 'reel' | 'video' | 'blog',
        topicOverride: topic,
        publishDate,
        status:        'pending_approval',
        notifyDiscord: true,
        triggeredBy:   `discord:${username}`,
      }, openAiKey);

      const imageNote = result.imageStatus === 'generated'
        ? `🖼️ Image generated (${result.imageAttempts} attempt${result.imageAttempts !== 1 ? 's' : ''})`
        : result.imageStatus === 'skipped'
          ? '🎨 Designer prompt saved — asset still requires designer delivery'
        : result.imageStatus === 'no_key'
          ? '⚠️ No STABILITY_API_KEY — no image'
          : `⚠️ Image generation failed after ${result.imageAttempts} attempts`;

      const platformStr = result.platforms.join(', ') || '—';
      await discordPatchInteraction({
        applicationId: appId, token, botToken,
        content: `✅ **${result.title}** created for **${clientSlug}**\n${imageNote}\n📱 ${platformStr}\n🔗 https://marketing.webxni.com/posts/${result.postId}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: `❌ Content creation failed: ${msg.slice(0, 200)}` });
    }
    return;

  } else if (commandName === 'batch') {
    const opts         = interaction.data?.options ?? [];
    const clientSlug   = (opts.find(o => o.name === 'client')?.value       as string | undefined) ?? '';
    const count        = (opts.find(o => o.name === 'count')?.value        as number | undefined) ?? null;
    const topic        = (opts.find(o => o.name === 'topic')?.value        as string | undefined) ?? null;
    const topicsRaw    = (opts.find(o => o.name === 'topics')?.value       as string | undefined) ?? null;
    const useQueue     = (opts.find(o => o.name === 'use_queue')?.value    as boolean| undefined) ?? false;
    const contentType  = (opts.find(o => o.name === 'content_type')?.value as string | undefined) ?? 'image';
    const platformsRaw = (opts.find(o => o.name === 'platforms')?.value    as string | undefined) ?? '';
    const startDate    = (opts.find(o => o.name === 'start_date')?.value   as string | undefined) ?? null;
    const spacing      = (opts.find(o => o.name === 'spacing_days')?.value as number | undefined) ?? null;

    const topics = topicsRaw
      ? topicsRaw.split(/\||\n/).map(s => s.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean)
      : [];
    const platforms = platformsRaw
      ? platformsRaw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean)
      : [];

    const parts: string[] = [`client: ${clientSlug}`];
    if (topics.length) parts.push(`${topics.length} topics`);
    else if (useQueue) parts.push('from queue');
    else if (topic)    parts.push(`topic: "${topic}"`);
    if (count && !topics.length) parts.push(`count=${count}`);
    if (contentType && contentType !== 'image') parts.push(contentType);
    if (platforms.length) parts.push(`platforms=${platforms.join(',')}`);

    agentMessage = `Use batch_create_content to create posts: ${parts.join(', ')}.` +
      ` Build it as: batch_create_content {\n` +
      `  "client": "${clientSlug}",\n` +
      (topics.length ? `  "topics": ${JSON.stringify(topics)},\n` : '') +
      (useQueue && !topics.length ? `  "use_queue": true,\n` : '') +
      (topic && !topics.length && !useQueue ? `  "topic": ${JSON.stringify(topic)},\n` : '') +
      (count && !topics.length ? `  "count": ${count},\n` : '') +
      `  "content_type": "${contentType}"` +
      (platforms.length ? `,\n  "platforms": ${JSON.stringify(platforms)}` : '') +
      (startDate ? `,\n  "start_date": "${startDate}"` : '') +
      (spacing != null ? `,\n  "spacing_days": ${spacing}` : '') +
      `\n}`;

  } else if (commandName === 'schedule') {
    const opts = interaction.data?.options ?? [];
    const clientSlug    = (opts.find(o => o.name === 'client')?.value         as string | undefined) ?? '';
    const recurrence    = (opts.find(o => o.name === 'recurrence')?.value     as string | undefined) ?? 'weekly';
    const dayOfWeek     = (opts.find(o => o.name === 'day_of_week')?.value    as number | undefined) ?? null;
    const timeOfDay     = (opts.find(o => o.name === 'time_of_day')?.value    as string | undefined) ?? null;
    const contentType   = (opts.find(o => o.name === 'content_type')?.value   as string | undefined) ?? null;
    const platformsRaw  = (opts.find(o => o.name === 'platforms')?.value      as string | undefined) ?? '';
    const perRun        = (opts.find(o => o.name === 'per_run')?.value        as number | undefined) ?? null;
    const topicStrategy = (opts.find(o => o.name === 'topic_strategy')?.value as string | undefined) ?? null;
    const fixedTopic    = (opts.find(o => o.name === 'fixed_topic')?.value    as string | undefined) ?? null;
    const nextRunDate   = (opts.find(o => o.name === 'next_run_date')?.value  as string | undefined) ?? null;

    const platforms = platformsRaw
      ? platformsRaw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean)
      : [];

    const toolArgs: Record<string, unknown> = {
      client: clientSlug,
      recurrence,
    };
    if (dayOfWeek   != null) toolArgs.day_of_week    = dayOfWeek;
    if (timeOfDay)           toolArgs.time_of_day    = timeOfDay;
    if (contentType)         toolArgs.content_type   = contentType;
    if (platforms.length)    toolArgs.platforms      = platforms;
    if (perRun      != null) toolArgs.per_run        = perRun;
    if (topicStrategy)       toolArgs.topic_strategy = topicStrategy;
    if (fixedTopic)          toolArgs.fixed_topic    = fixedTopic;
    if (nextRunDate)         toolArgs.next_run_date  = nextRunDate;
    if (contentType === 'blog' && !toolArgs.request_type) toolArgs.request_type = 'blog';

    agentMessage = `Call create_content_request with exactly these arguments: ${JSON.stringify(toolArgs)}`;

  } else if (commandName === 'topics') {
    const opts = interaction.data?.options ?? [];
    const clientSlug  = (opts.find(o => o.name === 'client')?.value       as string | undefined) ?? '';
    const listRaw     = (opts.find(o => o.name === 'list')?.value         as string | undefined) ?? '';
    const contentType = (opts.find(o => o.name === 'content_type')?.value as string | undefined) ?? null;
    const priority    = (opts.find(o => o.name === 'priority')?.value     as number | undefined) ?? null;

    const topics = listRaw
      .split(/\||\n/)
      .map(s => s.replace(/^[-*\d.\s]+/, '').trim())
      .filter(Boolean);

    if (!clientSlug || topics.length === 0) {
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: '❌ Provide client and at least one topic.' });
      return;
    }

    const toolArgs: Record<string, unknown> = { client: clientSlug, topics };
    if (contentType)     toolArgs.content_type = contentType;
    if (priority != null) toolArgs.priority    = priority;

    agentMessage = `Call add_client_topics with exactly these arguments: ${JSON.stringify(toolArgs)}`;

  } else if (commandName === 'schedules') {
    const opts        = interaction.data?.options ?? [];
    const clientSlug  = (opts.find(o => o.name === 'client')?.value      as string | undefined) ?? '';
    const activeOnly  = (opts.find(o => o.name === 'active_only')?.value as boolean | undefined) ?? false;

    const toolArgs: Record<string, unknown> = {};
    if (clientSlug) toolArgs.client = clientSlug;
    if (activeOnly) toolArgs.active_only = true;

    agentMessage = `Call list_content_requests with exactly these arguments: ${JSON.stringify(toolArgs)}`;

  } else if (commandName === 'weekly-content') {
    const opts      = interaction.data?.options ?? [];
    const clientArg = (opts.find(o => o.name === 'client')?.value  as string | undefined) ?? '';
    const weekArg   = ((opts.find(o => o.name === 'date_range')?.value as string | undefined)
                    ?? (opts.find(o => o.name === 'week')?.value       as string | undefined)
                    ?? 'this_week');
    const modeArg   = (opts.find(o => o.name === 'mode')?.value    as string | undefined) ?? 'standard';
    const provider  = 'terminal';
    const isHQ      = modeArg === 'high-quality';

    try {
      const { start, end } = resolveWeekRange(weekArg);
      const clientSlugs: string[] = clientArg ? [clientArg] : [];

      const run = await createGenerationRun(env.DB, {
        triggered_by:       `discord:${username}`,
        date_range:         `${start}:${end}`,
        client_filter:      clientSlugs.length > 0 ? JSON.stringify(clientSlugs) : null,
        overwrite_existing: false,
      });

      const params = {
        run_id:             run.id,
        client_slugs:       clientSlugs,
        period_start:       start,
        period_end:         end,
        triggered_by:       `discord:${username}`,
        publish_time:       null,
        overwrite_existing: false,
        high_quality:       true,
        provider,
      } as const;
      await prepareGenerationPlan(env, params).then(async ({ slots, clients }) => {
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
        await appendGenerationLog(env.DB, run.id, 'START', `Terminal AI job queued — ${start} → ${end}`);
      });
      const preparedSlots = await prebuildApprovedTerminalSlotRequests(env, run.id);

      const args: ApprovedTerminalJobArgs = {
        run_id: run.id,
        client_slugs: clientSlugs,
        period_start: start,
        period_end: end,
        content_only: true,
        generate_images: false,
        provider: 'terminal',
        requested_in: 'discord',
        prepared_slots: preparedSlots,
      };
      await createApprovedCommandJob(env.DB, {
        generation_run_id: run.id,
        command_name: 'weekly_content_terminal',
        provider: 'terminal',
        requested_by: `discord:${username}`,
        args_json: JSON.stringify(args),
      });

      const modeLabel = isHQ ? 'high-quality prompt profile' : 'terminal workflow';
      const clientLabel = clientArg ? `**${clientArg}**` : 'all active clients';
      await discordPatchInteraction({
        applicationId: appId, token, botToken,
        content: `🚀 Weekly content queued for ${clientLabel}\nProvider: **Terminal AI** (${modeLabel})\nWeek: **${start} → ${end}**\nMode: content only, no image generation by default\nRun ID: \`${run.id}\`\nA whitelisted backend job will start shortly.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: `❌ Failed to start generation: ${msg.slice(0, 200)}` });
    }
    return;
  } else if (commandName === 'agency-status') {
    const overview = await listAgencyOverview(env.DB);
    const agents = await listAgentDefinitions(env.DB);
    const activeLines = agents
      .filter((agent) => ['running', 'failed', 'waiting'].includes(agent.status))
      .slice(0, 5)
      .map((agent) => `- ${agent.name}: ${agent.status}${agent.current_task ? `, ${agent.current_task}` : ''}`)
      .join('\n') || '- No active agent work right now.';

    await discordPatchInteraction({
      applicationId: appId, token, botToken,
      content: [
        '**AI Agency Status**',
        '',
        `Active agents: **${overview.active_agents}**`,
        `Running tasks: **${overview.running_tasks}**`,
        `Waiting for Marvin approval: **${overview.waiting_marvin_approval}**`,
        `Waiting for designer assets: **${overview.waiting_designer_assets}**`,
        `Failed agent jobs: **${overview.failed_agent_jobs}**`,
        '',
        '**Today**',
        activeLines,
        '',
        '**Next action**',
        overview.waiting_marvin_approval > 0
          ? 'Marvin approval queue needs attention.'
          : overview.waiting_designer_assets > 0
            ? 'Designer asset queue needs attention.'
            : 'Run `/agency-run agent:orchestrator` to plan the next batch.',
      ].join('\n'),
    });
    return;
  } else if (commandName === 'agency-run') {
    const opts = interaction.data?.options ?? [];
    const agentChoice = ((opts.find(o => o.name === 'agent')?.value as string | undefined) ?? '').trim();
    const agentSlug = DISCORD_AGENCY_AGENTS[agentChoice] ?? agentChoice;
    const command = DISCORD_AGENCY_COMMANDS[agentSlug];
    if (!command) {
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: '❌ Unknown agency agent.' });
      return;
    }

    const agents = await listAgentDefinitions(env.DB);
    const agent = agents.find((item) => item.slug === agentSlug);
    if (!agent || agent.enabled !== 1) {
      await discordPatchInteraction({ applicationId: appId, token, botToken, content: '❌ Agency agent is disabled or missing.' });
      return;
    }

    const task = await createAgentTask(env.DB, {
      agent_slug: agentSlug,
      title: `${agent.name} requested from Discord`,
      input_json: JSON.stringify({ requested_from: 'discord_slash', username }),
    });
    const job = await createApprovedCommandJob(env.DB, {
      generation_run_id: null,
      command_name: command,
      provider: agent.default_backend,
      requested_by: `discord:${username}`,
      args_json: JSON.stringify({
        agent_slug: agentSlug,
        task_id: task.id,
        source: 'discord_slash',
        backend_priority: DISCORD_AGENCY_BACKEND_PRIORITY[agentSlug] ?? ['hermes', 'openai'],
        safety: {
          no_arbitrary_shell: true,
          preserve_marvin_approval: true,
          preserve_designer_gate: true,
        },
      }),
    });
    await updateAgentTask(env.DB, task.id, { approved_job_id: job.id, status: 'queued', progress: 0 });
    await appendAgencyLog(env.DB, {
      agent_slug: agentSlug,
      task_id: task.id,
      job_id: job.id,
      status: 'queued',
      step: 'discord',
      summary: `${agent.name} queued from Discord slash command as ${command}.`,
      backend: agent.default_backend,
    });

    await discordPatchInteraction({
      applicationId: appId, token, botToken,
      content: `✅ Queued **${agent.name}** through approved command \`${command}\`.\nTask ID: \`${task.id}\`\nJob ID: \`${job.id}\`\nNo arbitrary shell, publishing, approval, or designer gate bypass is allowed.`,
    });
    return;
  }

  if (agentMessage) {
    try {
      const result = await runAgent({
        message: agentMessage,
        history: [],
        env,
        user: {
          userId:   `discord:${interaction.member?.user?.id ?? interaction.user?.id ?? 'bot'}`,
          email:    `discord:${username}`,
          name:     username,
          role:     'admin',
          clientId: null,
        },
        baseUrl: 'https://marketing.webxni.com',
        ctx,
        openAiKey: await resolveOpenAiKey(env),
        systemPrompt: await buildDiscordSystemPrompt(env),
      });

      // Format response for Discord — short, no markdown headings
      let reply = result.message || '(no response)';

      // Append action summary if there are items
      if (result.actions_taken.length > 0 && !reply.includes(result.actions_taken[0])) {
        reply += `\n\n📋 **Actions:** ${result.actions_taken.join(' | ')}`;
      }

      // Show top items
      if (result.items && result.items.length > 0) {
        const MAX = 8;
        const items = result.items.slice(0, MAX);
        const lines = items.map((item) => {
          const o = item as Record<string, unknown>;
          const title = (o['title'] ?? o['name'] ?? o['type'] ?? o['id'] ?? '—') as string;
          const meta: string[] = [];
          if (o['status'])       meta.push(String(o['status']));
          if (o['client'])       meta.push(String(o['client']));
          if (o['publish_date']) meta.push(String(o['publish_date']).slice(0, 10));
          return `• ${title}${meta.length ? ` — ${meta.join(', ')}` : ''}`;
        });
        reply += '\n\n```\n' + lines.join('\n') + (result.items.length > MAX ? `\n…+${result.items.length - MAX} more` : '') + '\n```';
      }

      // Suggestions
      if (result.suggestions?.length) {
        reply += `\n\n💡 ${result.suggestions[0]}`;
      }

      // Errors
      if (result.errors.length > 0) {
        reply += `\n\n⚠️ Errors: ${result.errors.join('; ')}`;
      }

      // Discord message limit is 2000 chars
      if (reply.length > 1900) reply = reply.slice(0, 1900) + '…';

      await discordPatchInteraction({ applicationId: appId, token, botToken, content: reply });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[discord] command handler error:', msg);
      await discordPatchInteraction({
        applicationId: appId, token, botToken,
        content: `❌ Agent error: ${msg.slice(0, 200)}`,
      });
    }
    return;
  }

  await discordPatchInteraction({
    applicationId: appId, token, botToken,
    content: `❓ Unknown command: \`/${commandName}\``,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/discord/upload-asset
// Bot uploads a Discord attachment here (multipart, bearer auth).
// Stores in R2 MEDIA bucket, optionally links to a post.
// Body (multipart): file, post_id?, client_id?
// ─────────────────────────────────────────────────────────────────────────────

discordInternalRoute.post('/upload-asset', async (c) => {
  if (!(await requireDiscordBotSecret(c))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let formData: FormData;
  try { formData = await c.req.formData(); }
  catch { return c.json({ error: 'Invalid multipart data' }, 400); }

  const file     = formData.get('file') as File | null;
  const postId   = (formData.get('post_id')   as string | null) || null;
  const clientId = (formData.get('client_id') as string | null) || null;

  if (!file) return c.json({ error: 'file is required' }, 400);

  // Resolve client_id from post if not provided
  let resolvedClientId = clientId;
  if (!resolvedClientId && postId) {
    const row = await c.env.DB
      .prepare('SELECT client_id FROM posts WHERE id = ?')
      .bind(postId).first<{ client_id: string }>();
    resolvedClientId = row?.client_id ?? null;
  }
  if (!resolvedClientId) return c.json({ error: 'client_id or valid post_id required' }, 400);

  const filename    = file.name ?? 'upload.bin';
  const ext         = (filename.split('.').pop() ?? 'bin').toLowerCase();
  const assetId     = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  const r2Key       = `${resolvedClientId}/${postId ?? 'unlinked'}/${assetId}.${ext}`;
  const contentType = file.type || (/^(mp4|mov|webm|avi)$/.test(ext) ? 'video/mp4' : 'image/jpeg');
  const isVideo     = contentType.startsWith('video/') || /^(mp4|mov|webm|avi)$/.test(ext);
  const assetType   = isVideo ? 'video' : 'image';

  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { clientId: resolvedClientId, postId: postId ?? '', originalName: filename, source: 'discord' },
  });

  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB
      .prepare(`INSERT INTO assets (id, post_id, client_id, r2_key, r2_bucket, filename, content_type, size_bytes, source, created_at)
                VALUES (?, ?, ?, ?, 'MEDIA', ?, ?, ?, 'discord', ?)`)
      .bind(assetId, postId, resolvedClientId, r2Key, filename, contentType, file.size, now)
      .run();
  } catch { /* non-fatal — asset still uploaded to R2 */ }

  if (postId) {
    await c.env.DB
      .prepare(`UPDATE posts SET asset_r2_key = ?, asset_r2_bucket = 'MEDIA', asset_type = ?, asset_delivered = 1, updated_at = ? WHERE id = ?`)
      .bind(r2Key, assetType, now, postId)
      .run();
  }

  const mediaUrl = `https://marketing.webxni.com/media/${r2Key}`;
  console.log(`[discord] asset uploaded: ${r2Key} (${assetType}, ${file.size} bytes)`);

  return c.json({ ok: true, r2_key: r2Key, asset_id: assetId, asset_type: assetType, url: mediaUrl, linked_post_id: postId }, 201);
});

discordInternalRoute.post('/approved-jobs/claim', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { runner_id?: string } = {};
  try { body = await c.req.json(); } catch { /* optional */ }
  const runnerId = body.runner_id?.trim() || 'discord-bot-runner';
  const job = await claimNextApprovedCommandJob(c.env.DB, runnerId);
  return c.json({ ok: true, job });
});

discordInternalRoute.get('/approved-jobs/:id/context', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const job = await getApprovedCommandJobById(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  const args = JSON.parse(job.args_json) as ApprovedTerminalJobArgs;
  const run = await c.env.DB.prepare('SELECT post_slots, total_slots, current_slot_idx, status FROM generation_runs WHERE id = ?')
    .bind(args.run_id)
    .first<{ post_slots: string | null; total_slots: number | null; current_slot_idx: number | null; status: string }>();
  if (!run) return c.json({ error: 'Generation run not found' }, 404);
  const startIdx = Math.max(0, run.current_slot_idx ?? 0);
  const cachedSlots = Array.isArray(args.prepared_slots) ? args.prepared_slots : [];
  const slotSummaries = cachedSlots.length > 0
    ? cachedSlots.map((slot) => ({
      slot_idx: slot.slot_idx,
      client_slug: slot.client_slug,
      publish_date: slot.publish_date,
      content_type: slot.content_type,
    }))
    : (JSON.parse(run.post_slots ?? '[]') as Array<{ client_slug?: string; date?: string; content_type?: string }>)
      .slice(startIdx)
      .map((slot, offset) => ({
        slot_idx: startIdx + offset,
        client_slug: slot.client_slug ?? '',
        publish_date: slot.date ?? '',
        content_type: slot.content_type ?? '',
      }));
  return c.json({ ok: true, job, run, slots: slotSummaries });
});

discordInternalRoute.get('/approved-jobs/:id/slot-request/:slotIdx', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  const job = await getApprovedCommandJobById(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'Not found' }, 404);
  const args = JSON.parse(job.args_json) as ApprovedTerminalJobArgs;
  const slotIdx = Number.parseInt(c.req.param('slotIdx'), 10);
  if (!Number.isInteger(slotIdx) || slotIdx < 0) return c.json({ error: 'Invalid slot index' }, 400);
  try {
    const cached = Array.isArray(args.prepared_slots)
      ? args.prepared_slots.find((slot) => slot.slot_idx === slotIdx)
      : null;
    if (cached) {
      return c.json({
        ok: true,
        slot_idx: cached.slot_idx,
        client_slug: cached.client_slug,
        client_name: cached.client_name,
        publish_date: cached.publish_date,
        content_type: cached.content_type,
        topic_selection: cached.topic_selection,
        prompt: cached.prompt,
        schema: cached.schema,
        plan: cached.plan,
      });
    }
    const built = await buildSlotGenerationRequest(c.env, args.run_id, slotIdx);
    if (!built) {
      return c.json({
        ok: true,
        skipped: true,
        slot_idx: slotIdx,
        reason: 'no compatible platforms',
      });
    }
    return c.json({
      ok: true,
      slot_idx: slotIdx,
      client_slug: built.slot.client_slug,
      client_name: built.clientName,
      publish_date: built.slot.date,
      content_type: built.slot.content_type,
      topic_selection: built.topicSelection,
      prompt: built.request.prompt,
      schema: built.request.schema.schema,
      plan: built.request.plan,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

discordInternalRoute.post('/approved-jobs/:id/start', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { command_line?: string } = {};
  try { body = await c.req.json(); } catch { /* optional */ }
  await markApprovedCommandJobRunning(c.env.DB, c.req.param('id'), body.command_line ?? '');
  const job = await getApprovedCommandJobById(c.env.DB, c.req.param('id'));
  const runId = job ? (JSON.parse(job.args_json) as Partial<ApprovedTerminalJobArgs>).run_id ?? job.generation_run_id ?? null : null;
  if (runId) {
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `UPDATE generation_runs
       SET status = 'running', completed_at = NULL, last_activity_at = ?
       WHERE id = ?`,
    ).bind(now, runId).run();
  }
  return c.json({ ok: true });
});

discordInternalRoute.post('/approved-jobs/:id/log', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { run_id?: string; level?: 'INFO' | 'AI' | 'SAVED' | 'WARN' | 'ERROR' | 'START' | 'DONE'; message?: string } = {};
  try { body = await c.req.json(); } catch { /* */ }
  const level = body.level ?? 'INFO';
  const message = body.message?.slice(0, 2000) ?? '';
  if (!message) return c.json({ error: 'message required' }, 400);
  // Logging is best-effort: a transient D1 write conflict (many concurrent
  // slots appending to the same generation_runs row) must NOT 500 back to the
  // runner, or it would flip an already-saved slot to "failed" (the 80/81 bug).
  try {
    if (body.run_id) await appendGenerationLog(c.env.DB, body.run_id, level, message);
    await updateApprovedCommandJobProgress(c.env.DB, c.req.param('id'), message);
  } catch (err) {
    console.warn(`[approved-jobs/log] swallowed write error: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({ ok: true, logged: false });
  }
  return c.json({ ok: true });
});

discordInternalRoute.post('/approved-jobs/:id/save-slot', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { run_id?: string; slot_idx?: number; post?: GeneratedPost | null; topic_selection?: SlotTopicSelection | null } = {};
  try { body = await c.req.json(); } catch { /* */ }
  if (!body.run_id || typeof body.slot_idx !== 'number' || !body.post) return c.json({ error: 'run_id, slot_idx, and post required' }, 400);
  const result = await saveGeneratedSlotResult(c.env, body.run_id, body.slot_idx, body.post, body.topic_selection ?? null);
  const outcomeLabel = result.outcome === 'skipped' ? 'skipped' : 'saved';
  await appendGenerationLog(c.env.DB, body.run_id, result.outcome === 'skipped' ? 'WARN' : 'SAVED', `Terminal slot ${body.slot_idx + 1} ${outcomeLabel}`);
  return c.json({ ok: true, result });
});

discordInternalRoute.post('/approved-jobs/:id/error', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { run_id?: string; client?: string; client_slug?: string; slot_idx?: number; provider?: string; failing_step?: string; message?: string; details?: string } = {};
  try { body = await c.req.json(); } catch { /* */ }
  if (!body.run_id) return c.json({ error: 'run_id required' }, 400);

  const jobId = c.req.param('id');
  const job = await getApprovedCommandJobById(c.env.DB, jobId);
  const record = {
    kind: 'generation_error' as const,
    run_id: body.run_id,
    command_job_id: jobId,
    client: body.client ?? body.client_slug ?? null,
    client_slug: body.client_slug ?? body.client ?? null,
    slot_idx: typeof body.slot_idx === 'number' ? body.slot_idx : null,
    provider: body.provider ?? job?.provider ?? null,
    failing_step: body.failing_step ?? 'unknown',
    message: body.message?.slice(0, 2000) ?? 'Unknown generation failure',
    details: body.details?.slice(0, 4000) ?? null,
  };

  await appendStructuredGenerationError(c.env.DB, body.run_id, record);
  await appendApprovedCommandJobError(c.env.DB, jobId, record);
  return c.json({ ok: true });
});

discordInternalRoute.post('/approved-jobs/:id/complete', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { result_json?: Record<string, unknown> | null } = {};
  try { body = await c.req.json(); } catch { /* */ }
  const result = body.result_json ?? {};
  await completeApprovedCommandJob(c.env.DB, c.req.param('id'), 'completed', JSON.stringify(result), null);
  const runId = typeof result.run_id === 'string' ? result.run_id : '';
  const completedSlots = typeof result.completed_slots === 'number' ? result.completed_slots : null;
  const requestedSlots = typeof result.requested_slots === 'number' ? result.requested_slots : null;
  if (runId && completedSlots !== null && requestedSlots !== null && completedSlots > 0) {
    const now = Math.floor(Date.now() / 1000);
    const finalStatus = completedSlots >= requestedSlots ? 'completed' : 'completed_with_errors';
    await c.env.DB.prepare(
      `UPDATE generation_runs
       SET status = ?,
           current_slot_idx = CASE WHEN ? = 'completed' THEN COALESCE(total_slots, current_slot_idx) ELSE current_slot_idx END,
           completed_at = ?,
           last_activity_at = ?,
           error_log = CASE WHEN ? = 'completed' THEN NULL ELSE error_log END
       WHERE id = ?`,
    ).bind(finalStatus, finalStatus, now, now, finalStatus, runId).run();
    if (finalStatus === 'completed_with_errors') {
      const errorRecord = {
        kind: 'generation_error' as const,
        run_id: runId,
        command_job_id: c.req.param('id'),
        client: null,
        client_slug: null,
        slot_idx: completedSlots,
        provider: typeof result.provider === 'string' ? result.provider : 'terminal',
        failing_step: 'terminal_complete',
        message: `Terminal job completed with partial success: ${completedSlots}/${requestedSlots}`,
        details: JSON.stringify(result),
      };
      await appendStructuredGenerationError(c.env.DB, runId, errorRecord);
      await appendApprovedCommandJobError(c.env.DB, c.req.param('id'), errorRecord);
    }
    await appendGenerationLog(c.env.DB, runId, 'DONE', `Terminal job complete: saved ${completedSlots}/${requestedSlots} slot(s), status=${finalStatus}`);
  }
  return c.json({ ok: true });
});

discordInternalRoute.post('/approved-jobs/:id/fail', async (c) => {
  if (!(await requireDiscordBotSecret(c))) return c.json({ error: 'Unauthorized' }, 401);
  let body: { run_id?: string; error?: string } = {};
  try { body = await c.req.json(); } catch { /* */ }
  const error = body.error?.slice(0, 4000) ?? 'Unknown failure';
  await completeApprovedCommandJob(c.env.DB, c.req.param('id'), 'failed', null, error);
  if (body.run_id) {
    const job = await getApprovedCommandJobById(c.env.DB, c.req.param('id'));
    const errorRecord = {
      kind: 'generation_error' as const,
      run_id: body.run_id,
      command_job_id: c.req.param('id'),
      client: null,
      client_slug: null,
      slot_idx: null,
      provider: job?.provider ?? 'terminal',
      failing_step: 'terminal_fail',
      message: error,
      details: null,
    };
    await appendStructuredGenerationError(c.env.DB, body.run_id, errorRecord);
    await appendApprovedCommandJobError(c.env.DB, c.req.param('id'), errorRecord);
    const run = await getGenerationRunById(c.env.DB, body.run_id);
    if (run && run.status === 'running') {
      await finalizeGenerationRun(
        c.env.DB,
        body.run_id,
        run.posts_created > 0 ? 'completed_with_errors' : 'failed',
        run.posts_created,
        run.error_log ? `${run.error_log}\n${error}` : error,
      );
    }
  }
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/discord/register
// Call once to register slash commands with Discord.
// ─────────────────────────────────────────────────────────────────────────────

discordInternalRoute.post('/register', async (c) => {
  const appId    = c.env.DISCORD_APPLICATION_ID ?? '';
  const botToken = c.env.DISCORD_BOT_TOKEN      ?? '';

  if (!appId || !botToken) {
    return c.json({ error: 'DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set' }, 400);
  }

  try {
    await registerSlashCommands(appId, botToken);
    return c.json({ ok: true, message: 'Slash commands registered: /ask, /status, /queue, /failed, /create-post, /create-blog, /weekly-content, /batch, /schedule, /schedules, /topics, /agency-status, /agency-run' });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/discord/notify
// Send a manual message to the configured Discord channel.
// Body: { content?, embed?: { title, description, color, fields[] } }
// ─────────────────────────────────────────────────────────────────────────────

discordInternalRoute.post('/notify', async (c) => {
  const channelId = c.env.DISCORD_CHANNEL_ID ?? '';
  const botToken  = c.env.DISCORD_BOT_TOKEN  ?? '';

  if (!channelId || !botToken) {
    return c.json({ error: 'DISCORD_CHANNEL_ID or DISCORD_BOT_TOKEN not configured' }, 400);
  }

  let body: { content?: string; embed?: { title?: string; description?: string; color?: number; fields?: Array<{ name: string; value: string; inline?: boolean }> } };
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  try {
    await discordSend({
      channelId,
      token:   botToken,
      content: body.content,
      embeds:  body.embed ? [{
        ...body.embed,
        color: body.embed.color ?? DISCORD_COLORS.info,
        timestamp: new Date().toISOString(),
        footer: { text: 'WebXni Marketing Platform' },
      }] : undefined,
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /internal/discord/dm
// Send a direct message to the owner (DISCORD_OWNER_ID) or any user ID.
// Body: { content, user_id? }  — user_id defaults to DISCORD_OWNER_ID
// ─────────────────────────────────────────────────────────────────────────────

discordInternalRoute.post('/dm', async (c) => {
  const botToken = c.env.DISCORD_BOT_TOKEN ?? '';
  const ownerId  = c.env.DISCORD_OWNER_ID  ?? '';

  if (!botToken) return c.json({ error: 'DISCORD_BOT_TOKEN not configured' }, 400);

  let body: { content?: string; user_id?: string };
  try { body = await c.req.json() as typeof body; }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const userId  = body.user_id ?? ownerId;
  const content = body.content ?? '';
  if (!userId)  return c.json({ error: 'No user_id and DISCORD_OWNER_ID not set' }, 400);
  if (!content) return c.json({ error: 'content is required' }, 400);

  try {
    await discordDM({ userId, token: botToken, content });
    return c.json({ ok: true, user_id: userId });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOpenAiKey(env: Env): Promise<string> {
  let key = env.OPENAI_API_KEY || '';
  if (!key) {
    try {
      const raw = await env.KV_BINDING.get('settings:system');
      const s: Record<string, string> = raw ? JSON.parse(raw) as Record<string, string> : {};
      key = s['ai_api_key'] || '';
    } catch { /* ignore */ }
  }
  return key;
}

function resolveWeekRange(weekStr: string): { start: string; end: string } {
  const normalized = weekStr.trim().toLowerCase().replace(/_/g, '-');
  const today    = new Date();
  const dayOfWeek = today.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const monday   = new Date(today);
  monday.setUTCHours(12, 0, 0, 0);

  if (normalized === 'next-week') {
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    monday.setUTCDate(today.getUTCDate() + daysUntilNextMonday);
  } else if (normalized === 'this-week') {
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setUTCDate(today.getUTCDate() + daysToMonday);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const d = new Date(normalized + 'T12:00:00Z');
    monday.setTime(d.getTime());
  } else {
    // Default: next week
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    monday.setUTCDate(today.getUTCDate() + daysUntilNextMonday);
  }

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().split('T')[0],
    end:   sunday.toISOString().split('T')[0],
  };
}

async function buildDiscordSystemPrompt(env: Env): Promise<string> {
  const today = new Date().toISOString().split('T')[0];
  let clients = '';
  try {
    const rows = await env.DB
      .prepare('SELECT canonical_name, slug FROM clients WHERE status = ? ORDER BY canonical_name LIMIT 20')
      .bind('active').all<{ canonical_name: string; slug: string }>();
    clients = rows.results.map(c => `  ${c.canonical_name} → "${c.slug}"`).join('\n');
  } catch { /* non-fatal */ }

  return `You are the WebXni Marketing Platform AI Agent responding via Discord.
TODAY'S DATE: ${today}

ACTIVE CLIENTS:
${clients}

Response rules for Discord:
- Be very brief — 1-2 sentences max in your main message
- Never use markdown headings (## ###) — Discord renders these awkwardly
- Data goes in the items array, not in your message text
- Bold (**text**) is fine in Discord for emphasis
- Be direct and operational
- For weekly content requests, default provider to terminal unless the user explicitly asks for OpenAI
- For weekly content requests without a date range, default to this week`;
}

async function requireDiscordBotSecret(c: { req: { header(name: string): string | undefined }; env: Env }): Promise<string | null> {
  const authHeader  = c.req.header('Authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  let botSecret = '';
  try {
    const raw = await c.env.KV_BINDING.get('settings:system');
    const s = raw ? JSON.parse(raw) as Record<string, string> : {};
    botSecret = s['discord_bot_secret'] || '';
  } catch { /* ignore */ }

  if (!botSecret || bearerToken !== botSecret) return null;
  return botSecret;
}
