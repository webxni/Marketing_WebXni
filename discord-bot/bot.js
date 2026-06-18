/**
 * WebXni Assistant — Discord Gateway Bot powered by Hermes
 *
 * Enables natural chat with the AI agent in Discord:
 *  • Type anything in the configured channel → agent responds
 *  • DM the bot directly → agent responds
 *  • @mention the bot anywhere → agent responds
 *
 * Slash commands (/ask, /status, /queue, /failed) still work via
 * the Cloudflare Worker interaction endpoint — this bot adds natural
 * conversation on top of that.
 *
 * Deploy: Railway, Render, fly.io, or just `node bot.js` locally.
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

// ── Config ─────────────────────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN;
const BOT_SECRET   = process.env.DISCORD_BOT_SECRET;    // matches KV settings:system.discord_bot_secret
const OWNER_ID     = process.env.DISCORD_OWNER_ID    || '1468394932837552248';
const CHANNEL_ID   = process.env.DISCORD_CHANNEL_ID  || '1242943323828916234';
const API_BASE_URL = process.env.API_BASE_URL         || 'https://marketing.webxni.com';
const RUNNER_ID    = process.env.DISCORD_RUNNER_ID    || `${os.hostname()}:discord-bot`;
const PROJECT_ROOT = path.resolve(__dirname, '..');

if (!BOT_TOKEN)  { console.error('DISCORD_BOT_TOKEN is required'); process.exit(1); }
if (!BOT_SECRET) { console.error('DISCORD_BOT_SECRET is required'); process.exit(1); }

// ── Deduplication — prevent processing the same message twice ──────────────────
// Happens on gateway reconnects or after bot restarts while Discord still has
// an open session. Track processed message IDs for 60s.
const processedMessages = new Set();

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 60_000);
  return false;
}

// ── Per-user conversation history (last 6 turns, resets on bot restart) ────────
const histories = new Map(); // userId → [{role, content}]

function getHistory(userId) {
  if (!histories.has(userId)) histories.set(userId, []);
  return histories.get(userId);
}

function pushHistory(userId, role, content) {
  const h = getHistory(userId);
  h.push({ role, content });
  if (h.length > 12) h.splice(0, h.length - 12); // keep last 6 turns
}

function resolveWeeklyDateRange(rangeRaw) {
  const normalized = String(rangeRaw || 'this_week').trim().toLowerCase();
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const monday = new Date(today);
  monday.setUTCHours(12, 0, 0, 0);

  if (normalized === 'next_week' || normalized === 'next-week') {
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    monday.setUTCDate(today.getUTCDate() + daysUntilNextMonday);
  } else if (normalized === 'this_week' || normalized === 'this-week') {
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setUTCDate(today.getUTCDate() + daysToMonday);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    monday.setTime(new Date(`${normalized}T12:00:00Z`).getTime());
  } else {
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setUTCDate(today.getUTCDate() + daysToMonday);
  }

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

// ── Upload a Discord attachment to the WebXni worker ─────────────────────────
async function uploadAttachmentToWorker(attachment) {
  try {
    const isImage = (attachment.contentType ?? '').startsWith('image/') ||
                    /\.(png|jpg|jpeg|gif|webp)$/i.test(attachment.name ?? '');
    const isVideo = (attachment.contentType ?? '').startsWith('video/') ||
                    /\.(mp4|mov|webm|avi)$/i.test(attachment.name ?? '');
    if (!isImage && !isVideo) return null;

    console.log(`[bot] downloading attachment: ${attachment.name} (${attachment.size} bytes)`);
    const fileRes = await fetch(attachment.url);
    if (!fileRes.ok) throw new Error(`Discord CDN ${fileRes.status}`);
    const buffer = await fileRes.arrayBuffer();

    const contentType = attachment.contentType ??
      (/\.(mp4|mov|webm)$/i.test(attachment.name ?? '') ? 'video/mp4' : 'image/jpeg');

    const blob = new Blob([buffer], { type: contentType });
    const form = new FormData();
    form.append('file', blob, attachment.name ?? 'upload.bin');

    const res = await fetch(`${API_BASE_URL}/internal/discord/upload-asset`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${BOT_SECRET}` },
      body:    form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[bot] upload failed ${res.status}:`, errText.slice(0, 200));
      return null;
    }

    const data = await res.json();
    console.log(`[bot] uploaded → ${data.r2_key} (${data.asset_type})`);
    return data;
  } catch (err) {
    console.error('[bot] attachment upload error:', err.message);
    return null;
  }
}

// ── Call the WebXni AI agent ───────────────────────────────────────────────────
let terminalAgentModulePromise = null;

async function loadTerminalAgentModule() {
  if (!terminalAgentModulePromise) {
    const moduleUrl = pathToFileURL(path.join(PROJECT_ROOT, 'scripts/lib/terminal-json-agent.mjs')).href;
    terminalAgentModulePromise = import(moduleUrl);
  }
  return terminalAgentModulePromise;
}

async function askHermesAgent(userMessage, userId, username) {
  const history = getHistory(userId);
  const { runTerminalJsonAgent } = await loadTerminalAgentModule();
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['message', 'summary', 'items', 'actions_taken', 'suggestions', 'errors'],
    properties: {
      message: { type: 'string' },
      summary: { anyOf: [{ type: 'object' }, { type: 'null' }] },
      items: { type: 'array', items: { type: 'object' } },
      actions_taken: { type: 'array', items: { type: 'string' } },
      suggestions: { type: 'array', items: { type: 'string' } },
      errors: { type: 'array', items: { type: 'string' } },
    },
  };

  const prompt = [
    'You are WebXni Assistant powered by Hermes.',
    'Reply in JSON only and keep the response short, clear, and practical.',
    'You are speaking with a Discord user inside the WebXni marketing platform.',
    'Truthfulness rule: the Discord bot runs Hermes first and falls back to OpenAI only when Hermes is unavailable. If the user asks about the backend, say that directly.',
    `Discord user: ${username}`,
    'Use the recent conversation history for context.',
    'If you do not know a platform-specific or app-specific fact, say so instead of inventing it.',
    'Do not include markdown, prose outside JSON, or code fences.',
    '',
    'Recent conversation history:',
    JSON.stringify(history.slice(-6), null, 2),
    '',
    'User message:',
    userMessage,
  ].join('\n');

  const result = await runTerminalJsonAgent({
    prompt,
    schema,
    preferredBackend: ['hermes', 'openai'],
  });

  return result.output;
}

async function askWorkerAgent(userMessage, userId, username) {
  const history = getHistory(userId);

  const res = await fetch(`${API_BASE_URL}/api/ai/dispatch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source:       'discord',
      bot_token:    BOT_SECRET,
      message:      userMessage,
      history:      history.slice(-6),
      discord_user: username,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[agent] dispatch ${res.status}:`, err.slice(0, 200));
    throw new Error(`Agent returned ${res.status}`);
  }

  const data = await res.json();

  // Update history — include numbered item list so the agent can resolve
  // ordinal references like "approve the 8th post" in the next turn.
  pushHistory(userId, 'user', userMessage);
  let assistantEntry = data.message || '';
  if (Array.isArray(data.items) && data.items.length > 0) {
    const itemLines = data.items.map((item, i) => {
      const id    = item.id    ?? '?';
      const title = item.title ?? item.name ?? '—';
      return `${i + 1}. [id:${id}] ${title}`;
    });
    assistantEntry += `\n\n[Items shown in this response:\n${itemLines.join('\n')}]`;
  }
  pushHistory(userId, 'assistant', assistantEntry);

  return data;
}

async function askAgent(userMessage, userId, username) {
  try {
    const data = await askHermesAgent(userMessage, userId, username);
    pushHistory(userId, 'user', userMessage);
    let assistantEntry = data.message || '';
    if (Array.isArray(data.items) && data.items.length > 0) {
      const itemLines = data.items.map((item, i) => {
        const id    = item.id    ?? '?';
        const title = item.title ?? item.name ?? '—';
        return `${i + 1}. [id:${id}] ${title}`;
      });
      assistantEntry += `\n\n[Items shown in this response:\n${itemLines.join('\n')}]`;
    }
    pushHistory(userId, 'assistant', assistantEntry);
    return data;
  } catch (hermesErr) {
    console.warn('[agent] Hermes path failed; falling back to OpenAI worker dispatch:', hermesErr.message);
    const data = await askWorkerAgent(userMessage, userId, username);
    pushHistory(userId, 'user', userMessage);
    let assistantEntry = data.message || '';
    if (Array.isArray(data.items) && data.items.length > 0) {
      const itemLines = data.items.map((item, i) => {
        const id    = item.id    ?? '?';
        const title = item.title ?? item.name ?? '—';
        return `${i + 1}. [id:${id}] ${title}`;
      });
      assistantEntry += `\n\n[Items shown in this response:\n${itemLines.join('\n')}]`;
    }
    pushHistory(userId, 'assistant', assistantEntry);
    return data;
  }
}

// ── Format agent response for Discord ─────────────────────────────────────────
function formatResponse(data) {
  const parts  = [];
  const embeds = [];

  // Deduplicate items by ID (agent may call get_posts twice across iterations)
  let items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 0) {
    const seen = new Set();
    items = items.filter(item => {
      const key = item.id ?? item.title ?? JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Main message (skip if it just echoes action_taken) ────────────────────
  const actionsText = (data.actions_taken ?? []).join(' ');
  const msg = (data.message ?? '').trim();
  // Only show message if it's a real sentence, not a repeat of the action summary
  if (msg && msg !== actionsText && !actionsText.includes(msg)) {
    parts.push(msg);
  }

  // ── Items ─────────────────────────────────────────────────────────────────
  if (items.length === 1) {
    // Single post — rich format with caption + image
    const item   = items[0];
    const title  = item.title ?? item.name ?? '—';
    const status = item.status       ? `\`${item.status}\`` : '';
    const client = item.client       ? item.client.split(' (')[0] : ''; // strip slug
    const date   = item.publish_date ? String(item.publish_date).slice(0, 10) : '';
    const meta   = [status, client, date].filter(Boolean).join(' · ');

    parts.push(`**${title}**\n${meta}`);

    if (item.master_caption) {
      const cap = String(item.master_caption);
      parts.push(`>>> ${cap.slice(0, 900)}${cap.length > 900 ? '…' : ''}`);
    }

    if (item.asset_url) {
      const isVideo = /\.(mp4|mov|webm)$/i.test(item.asset_url) ||
                      item.asset_type === 'video' || item.asset_type === 'reel';
      if (isVideo) {
        parts.push(`📹 ${item.asset_url}`);
      } else {
        embeds.push({
          color: 0x1a73e8,
          image: { url: item.asset_url },
        });
      }
    } else if (item.asset === 0 || item.asset === false) {
      parts.push('_No media uploaded yet_');
    }

  } else if (items.length > 1) {
    // Multiple posts — compact numbered list
    const MAX   = 8;
    const lines = items.slice(0, MAX).map((item, i) => {
      const title  = item.title ?? item.name ?? item.type ?? '—';
      const status = item.status       ? ` \`${item.status}\`` : '';
      const date   = item.publish_date ? ` · ${String(item.publish_date).slice(0, 10)}` : '';
      const client = item.client       ? ` · ${item.client.split(' (')[0]}` : '';
      return `${i + 1}. **${title}**${status}${date}${client}`;
    });
    if (items.length > MAX) lines.push(`_…+${items.length - MAX} more_`);
    parts.push(lines.join('\n'));
  }

  // ── Summary bar (only interesting non-obvious stats) ─────────────────────
  if (data.summary && typeof data.summary === 'object' && items.length !== 1) {
    const skip = new Set(['total', 'shown', 'dry_run']);
    const stats = Object.entries(data.summary)
      .filter(([k, v]) => !skip.has(k) && v !== null && typeof v !== 'object')
      .map(([k, v]) => `**${v}** ${k.replace(/_/g, ' ')}`);
    if (stats.length) parts.push('`' + stats.join(' · ') + '`');
  }

  // ── Mutation confirmations ────────────────────────────────────────────────
  const uniqueActions = (data.actions_taken ?? []).filter(a => a !== actionsText && a !== msg);
  if (uniqueActions.length > 0) {
    parts.push('✅ ' + uniqueActions.join('\n✅ '));
  }

  // ── Suggestion ───────────────────────────────────────────────────────────
  if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
    parts.push(`💡 ${data.suggestions[0]}`);
  }

  // ── Errors ────────────────────────────────────────────────────────────────
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    parts.push('⚠️ ' + data.errors.join('\n⚠️ '));
  }

  let content = parts.filter(Boolean).join('\n\n');
  if (content.length > 1900) content = content.slice(0, 1900) + '…';

  return { content: content || '…', embeds };
}

// ── Discord client ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // required for reading message text
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] Ready as ${c.user.tag}`);
  c.user.setActivity('WebXni Assistant powered by Hermes', { type: ActivityType.Watching });
  startApprovedJobPoller().catch((err) => console.error('[jobs] poller init error:', err));
});

// Concurrency cap for approved jobs. Default 1 preserves today's one-at-a-time
// behavior (terminal jobs already run 10 slots concurrently, so raising this
// multiplies machine load — opt in via MAX_CONCURRENT_JOBS only if the host
// can take it). Lets a quick agency job avoid being stuck behind a long run.
const MAX_CONCURRENT_JOBS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS || '1', 10));
let approvedJobsInFlight = 0;

async function postInternal(pathname, body) {
  const res = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BOT_SECRET}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${pathname} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const VALID_AGENT_SLUGS = new Set([
  'agency-orchestrator', 'system-reliability', 'security-sentinel',
  'client-research', 'strategy', 'social-copy', 'blog-writer', 'editorial-review',
  'client-onboarding',
]);

function parseAgencyRequest(text) {
  const raw = String(text || '').trim();
  const normalized = raw
    .toLowerCase()
    .replace(/^webxni[,:\s]+/, '')
    .replace(/^\//, '')
    .trim();

  // Platform sync: "webxni, sync platforms" / "webxni, sync platforms for caliview-landscape"
  if (/\bsync\b.*\bplatform\b|\bplatform\b.*\bsync\b|\bonboard\b/.test(normalized)) {
    const slugMatch = normalized.match(/(?:client|for)[:\s]+([a-z0-9-]+)/);
    return { kind: 'sync_platforms', client_slug: slugMatch ? slugMatch[1] : null };
  }

  // Slash-style heartbeat commands: /agency-heartbeat, /agency-health, /agency-stale, /agency-ping agent:<slug>
  if (/^agency-heartbeat\b/.test(normalized) || /\bheartbeat\b/.test(normalized)) {
    return { kind: 'heartbeat' };
  }
  if (/^agency-health\b/.test(normalized) || /\bagent.?health\b/.test(normalized)) {
    return { kind: 'health' };
  }
  if (/^agency-stale\b/.test(normalized) || /\bstale.agent\b/.test(normalized)) {
    return { kind: 'stale' };
  }
  const pingMatch = normalized.match(/^agency-ping\s+agent:([a-z-]+)/);
  if (pingMatch || /\bagency.?ping\b/.test(normalized)) {
    const slugFromCmd = pingMatch ? pingMatch[1] : null;
    const slugFromText = normalized.match(/\bagent:([a-z-]+)/)?.[1] ?? null;
    const slug = slugFromCmd ?? slugFromText ?? null;
    return { kind: 'ping', agent_slug: slug && VALID_AGENT_SLUGS.has(slug) ? slug : null };
  }

  // Existing agency commands
  if (!/\bagency\b|\bsecurity check\b|\bsystem review\b|\bclient research\b|\beditorial review\b|\bweekly strategy\b/.test(normalized)) {
    return null;
  }
  if (/\b(status|progress|week)\b/.test(normalized)) {
    return { kind: 'status' };
  }
  if (/\bsecurity\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'security-sentinel' };
  }
  if (/\bsystem\b|\breliability\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'system-reliability' };
  }
  if (/\bresearch\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'client-research' };
  }
  if (/\bstrategy\b|\bplan\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'strategy' };
  }
  if (/\bsocial\b|\bdrafts?\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'social-copy' };
  }
  if (/\bblog\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'blog-writer' };
  }
  if (/\beditorial\b|\breview\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'editorial-review' };
  }
  if (/\borchestrator\b|\bcontinue\b/.test(normalized)) {
    return { kind: 'run', agent_slug: 'agency-orchestrator' };
  }
  return null;
}

function formatHeartbeatStatus(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return 'No agents found.';
  const lines = agents.map((a) => {
    const dot = a.heartbeat_status === 'healthy' || a.heartbeat_status === 'running' ? '🟢'
      : a.heartbeat_status === 'stale' || a.heartbeat_status === 'failed' ? '🔴'
      : a.heartbeat_status === 'warning' ? '🟡'
      : '⚪';
    const last = a.last_heartbeat_at
      ? `${Math.floor((Date.now() / 1000 - a.last_heartbeat_at) / 60)}m ago`
      : 'never';
    return `${dot} **${a.name}** — \`${a.heartbeat_status}\` · last: ${last}`;
  });
  return `**Agent Heartbeat Status**\n\n${lines.join('\n')}`;
}

async function handleAgencyRequest(parsed, username) {
  if (parsed.kind === 'status') {
    const result = await postInternal('/internal/agency/status', {});
    return result.content || 'AI Agency status unavailable.';
  }
  if (parsed.kind === 'sync_platforms') {
    const body = parsed.client_slug ? { client_slug: parsed.client_slug } : {};
    const result = await postInternal('/internal/agency/sync-client-platforms', body);
    return result.content || 'Platform sync complete.';
  }
  if (parsed.kind === 'heartbeat') {
    const result = await postInternal('/internal/agency/stale-check', {});
    const agents = result.agents || [];
    return formatHeartbeatStatus(agents);
  }
  if (parsed.kind === 'health') {
    const result = await postInternal('/internal/agency/stale-check', {});
    const stale = result.stale_count ?? 0;
    const failed = result.failed_count ?? 0;
    const lines = [
      '**Agent Health Summary**',
      '',
      result.content || 'Health check complete.',
      '',
      `Stale: **${stale}** | Failed: **${failed}**`,
    ];
    if (stale === 0 && failed === 0) lines.push('✅ All agents are healthy or idle.');
    return lines.join('\n');
  }
  if (parsed.kind === 'stale') {
    const result = await postInternal('/internal/agency/stale-check', {});
    const marked = result.marked || [];
    if (marked.length === 0) return '✅ No stale agents detected.';
    return `**Stale Agents** (just marked)\n\n${marked.map((s) => `• \`${s}\``).join('\n')}`;
  }
  if (parsed.kind === 'ping') {
    if (!parsed.agent_slug) return '❌ Unknown agent slug. Use: `agent:<slug>` with a valid agent name.';
    const result = await postInternal('/internal/agency/ping', { agent_slug: parsed.agent_slug });
    return result.content || `Pinged ${parsed.agent_slug}.`;
  }
  const result = await postInternal('/internal/agency/enqueue', {
    agent_slug: parsed.agent_slug,
    requested_by: `discord:${username}`,
    source: 'discord_natural_language',
  });
  return result.content || `Queued ${parsed.agent_slug}.`;
}

async function runApprovedJob(job) {
  const allowed = {
    weekly_content_terminal: ['scripts/run-approved-terminal-job.mjs'],
    regenerate_content_terminal: ['scripts/run-approved-terminal-job.mjs'],
    weekly_content_claude: ['scripts/run-approved-terminal-job.mjs'],
    regenerate_content_claude: ['scripts/run-approved-terminal-job.mjs'],
    agency_system_review: ['scripts/run-approved-agency-job.mjs'],
    agency_security_review: ['scripts/run-approved-agency-job.mjs'],
    agency_client_research: ['scripts/run-approved-agency-job.mjs'],
    agency_strategy: ['scripts/run-approved-agency-job.mjs'],
    agency_social_generation: ['scripts/run-approved-agency-job.mjs'],
    agency_blog_generation: ['scripts/run-approved-agency-job.mjs'],
    agency_editorial_review: ['scripts/run-approved-agency-job.mjs'],
    agency_orchestrator: ['scripts/run-approved-agency-job.mjs'],
    agency_client_onboarding: ['scripts/run-approved-agency-job.mjs'],
  };
  const scriptPathParts = allowed[job.command_name];
  if (!scriptPathParts) throw new Error(`Unapproved command: ${job.command_name}`);

  const scriptPath = path.join(PROJECT_ROOT, ...scriptPathParts);
  const args = [
    scriptPath,
    '--job-id', job.id,
    '--runner-id', RUNNER_ID,
    '--api-base-url', API_BASE_URL,
    '--bot-secret', BOT_SECRET,
  ];
  const commandLine = `node ${path.relative(PROJECT_ROOT, scriptPath)} --job-id ${job.id}`;

  await postInternal(`/internal/discord/approved-jobs/${job.id}/start`, { command_line: commandLine });

  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      API_BASE_URL,
      DISCORD_BOT_SECRET: BOT_SECRET,
      DISCORD_RUNNER_ID: RUNNER_ID,
      TERMINAL_AGENT: process.env.TERMINAL_AGENT || process.env.TERMINAL_AI_BACKEND || '',
    },
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Approved job exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function startApprovedJobPoller() {
  setInterval(async () => {
    if (approvedJobsInFlight >= MAX_CONCURRENT_JOBS) return;
    let claimed;
    try {
      claimed = await postInternal('/internal/discord/approved-jobs/claim', { runner_id: RUNNER_ID });
    } catch (err) {
      console.error('[jobs] claim error:', err.message);
      return;
    }
    if (!claimed.job) return;
    approvedJobsInFlight++;
    console.log(`[jobs] claimed ${claimed.job.id} (${claimed.job.command_name}) — ${approvedJobsInFlight}/${MAX_CONCURRENT_JOBS} in flight`);
    // Run without blocking the poll loop so additional jobs can be claimed up
    // to the concurrency cap. Each job tracks its own completion.
    runApprovedJob(claimed.job)
      .catch((err) => console.error('[jobs] runner error:', err.message))
      .finally(() => { approvedJobsInFlight--; });
  }, 10000);
}

client.on(Events.MessageCreate, async (message) => {
  // Ignore other bots
  if (message.author.bot) return;

  const isDM         = message.channel.type === 1; // DM_CHANNEL
  const isOurChannel = message.channelId === CHANNEL_ID;
  const isMention    = message.mentions.has(client.user);

  // Only respond in: our channel, DMs to the bot, or @mentions elsewhere
  if (!isDM && !isOurChannel && !isMention) return;

  // Skip duplicates (gateway reconnect can re-deliver events)
  if (isDuplicate(message.id)) return;

  // Strip @mention prefix if present
  let text = message.content
    .replace(`<@${client.user.id}>`, '')
    .replace(`<@!${client.user.id}>`, '')
    .trim();

  // Check for media attachments (images / videos)
  const mediaAttachments = [...message.attachments.values()].filter(a => {
    const isImage = (a.contentType ?? '').startsWith('image/') ||
                    /\.(png|jpg|jpeg|gif|webp)$/i.test(a.name ?? '');
    const isVideo = (a.contentType ?? '').startsWith('video/') ||
                    /\.(mp4|mov|webm|avi)$/i.test(a.name ?? '');
    return isImage || isVideo;
  });

  // If no text and no media, ignore
  if (!text && mediaAttachments.length === 0) return;

  const userId   = message.author.id;
  const username = message.author.globalName ?? message.author.username;

  console.log(`[bot] message from ${username} (${isDM ? 'DM' : 'channel'}): ${text.slice(0, 80)}${mediaAttachments.length ? ` + ${mediaAttachments.length} attachment(s)` : ''}`);

  // Show typing indicator
  try { await message.channel.sendTyping(); } catch { /* ignore */ }

  const agencyRequest = parseAgencyRequest(text);
  if (agencyRequest) {
    try {
      const content = await handleAgencyRequest(agencyRequest, username);
      await message.reply({ content, allowedMentions: { repliedUser: false } });
    } catch (err) {
      console.error('[bot] agency command error:', err);
      await message.reply({ content: '❌ Agency command failed — check bot logs.', allowedMentions: { repliedUser: false } });
    }
    return;
  }

  // Upload attachments to R2 (up to 3 media files)
  const uploadedAssets = [];
  for (const att of mediaAttachments.slice(0, 3)) {
    const uploaded = await uploadAttachmentToWorker(att);
    if (uploaded) uploadedAssets.push(uploaded);
  }

  // Augment the message with attachment context for the agent
  let agentMessage = text;
  const pseudoWeekly = text.match(/^\/weekly-content\b([\s\S]*)/i);
  if (pseudoWeekly) {
    const rawArgs = pseudoWeekly[1] ?? '';
    const clientMatch = rawArgs.match(/\bclient:([^\s]+)/i);
    const providerMatch = rawArgs.match(/\bprovider:([^\s]+)/i);
    const rangeMatch = rawArgs.match(/\bdate_range:([^\s]+)/i);
    const clientArg = (clientMatch?.[1] ?? 'all').trim();
    const providerArg = (providerMatch?.[1] ?? 'terminal').trim().toLowerCase();
    const rangeArg = (rangeMatch?.[1] ?? 'this_week').trim().toLowerCase();
    const { start, end } = resolveWeeklyDateRange(rangeArg);
    const clientPhrase = clientArg === 'all' ? 'all active clients' : clientArg;
    agentMessage = `Call generate_content with exactly these arguments: ${JSON.stringify({
      client_slugs: clientArg === 'all' ? [] : [clientArg],
      date_from: start,
      date_to: end,
      provider: ['terminal', 'claude', 'codex', 'gemini'].includes(providerArg) ? 'terminal' : 'openai',
      overwrite_existing: false,
    })}. Content only, no image generation unless explicitly requested.`;
  }
  if (uploadedAssets.length > 0) {
    const attContext = uploadedAssets
      .map(a => `[Media uploaded to R2: key="${a.r2_key}", url="${a.url}", type="${a.asset_type}"]`)
      .join(' ');
    agentMessage = text
      ? `${text}\n\nATTACHMENTS: ${attContext}`
      : `I attached a file. Please help me post it.\n\nATTACHMENTS: ${attContext}`;
  }

  // If we uploaded something, let the user know we received it
  if (uploadedAssets.length > 0) {
    const typeLabel = uploadedAssets[0].asset_type === 'video' ? '📹 video' : '🖼️ image';
    try {
      await message.channel.send({
        content: `✅ Got your ${typeLabel} — uploading to platform…`,
        allowedMentions: { repliedUser: false },
      });
    } catch { /* ignore */ }
  }

  try {
    const data = await askAgent(agentMessage, userId, username);
    const { content, embeds } = formatResponse(data);
    await message.reply({ content, embeds, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error('[bot] error:', err);
    await message.reply({ content: '❌ Agent error — please try again.', allowedMentions: { repliedUser: false } });
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });

client.login(BOT_TOKEN);
