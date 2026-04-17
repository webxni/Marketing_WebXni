/**
 * WebXni AI Agent — Discord Gateway Bot
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

// ── Config ─────────────────────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN;
const BOT_SECRET   = process.env.DISCORD_BOT_SECRET;    // matches KV settings:system.discord_bot_secret
const OWNER_ID     = process.env.DISCORD_OWNER_ID    || '1468394932837552248';
const CHANNEL_ID   = process.env.DISCORD_CHANNEL_ID  || '1242943323828916234';
const API_BASE_URL = process.env.API_BASE_URL         || 'https://marketing.webxni.com';

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
async function askAgent(userMessage, userId, username) {
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

  // Update history with this exchange
  pushHistory(userId, 'user', userMessage);
  if (data.message) pushHistory(userId, 'assistant', data.message);

  return data;
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
  c.user.setActivity('WebXni Platform', { type: ActivityType.Watching });
});

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

  // Upload attachments to R2 (up to 3 media files)
  const uploadedAssets = [];
  for (const att of mediaAttachments.slice(0, 3)) {
    const uploaded = await uploadAttachmentToWorker(att);
    if (uploaded) uploadedAssets.push(uploaded);
  }

  // Augment the message with attachment context for the agent
  let agentMessage = text;
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
