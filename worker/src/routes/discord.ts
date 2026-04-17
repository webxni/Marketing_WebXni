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

// ── Types ──────────────────────────────────────────────────────────────────────

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
  // Verify bot secret
  const authHeader  = c.req.header('Authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  let botSecret = '';
  try {
    const raw = await c.env.KV_BINDING.get('settings:system');
    const s   = raw ? JSON.parse(raw) as Record<string, string> : {};
    botSecret  = s['discord_bot_secret'] || '';
  } catch { /* ignore */ }

  if (!botSecret || bearerToken !== botSecret) {
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
    return c.json({ ok: true, message: 'Slash commands registered: /ask, /status, /queue, /failed' });
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
- Be direct and operational`;
}
