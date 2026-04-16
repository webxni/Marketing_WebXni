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
  const parts   = [];
  const embeds  = [];
  const assetUrls = []; // collected from items for image embeds

  // Main message — skip if it's just a repeat of actions_taken
  const actionsJoined = (data.actions_taken ?? []).join(' ');
  const msg = data.message ?? '';
  if (msg && msg !== actionsJoined) parts.push(msg);

  // Items list
  if (Array.isArray(data.items) && data.items.length > 0) {
    const MAX = 6;
    const lines = [];

    for (let i = 0; i < Math.min(data.items.length, MAX); i++) {
      const item   = data.items[i];
      const title  = item.title ?? item.name ?? item.type ?? item.id ?? '—';
      const status = item.status       ? ` · \`${item.status}\`` : '';
      const client = item.client       ? ` · ${item.client}`     : '';
      const date   = item.publish_date ? ` · ${String(item.publish_date).slice(0, 10)}` : '';
      lines.push(`**${i + 1}. ${title}**${status}${client}${date}`);

      // Caption
      if (item.master_caption) {
        const cap = String(item.master_caption).slice(0, 200);
        lines.push(`> ${cap}${item.master_caption.length > 200 ? '…' : ''}`);
      }

      // Collect asset URL — will be shown as embed image below
      if (item.asset_url) assetUrls.push({ url: item.asset_url, type: item.asset_type ?? '', title });
    }

    if (data.items.length > MAX) lines.push(`…+${data.items.length - MAX} more`);
    parts.push(lines.join('\n'));
  }

  // Summary stats (scalar values only, skip obvious ones already in items)
  if (data.summary && typeof data.summary === 'object') {
    const skip = new Set(['total', 'shown']);
    const statParts = Object.entries(data.summary)
      .filter(([k, v]) => !skip.has(k) && v !== null && typeof v !== 'object')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: **${v}**`);
    if (statParts.length) parts.push('> ' + statParts.join(' · '));
  }

  // Actions — only show if they add info beyond the message
  if (Array.isArray(data.actions_taken) && data.actions_taken.length > 0) {
    const unique = data.actions_taken.filter(a => a !== msg);
    if (unique.length > 0) parts.push('✅ ' + unique.join('\n✅ '));
  }

  // First suggestion only
  if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
    parts.push(`💡 ${data.suggestions[0]}`);
  }

  // Errors
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    parts.push('⚠️ ' + data.errors.join('\n⚠️ '));
  }

  let content = parts.filter(Boolean).join('\n\n');
  if (content.length > 1900) content = content.slice(0, 1900) + '…';

  // Build Discord embeds for images/videos (max 4 embeds)
  for (const asset of assetUrls.slice(0, 4)) {
    const isVideo = asset.type === 'video' || asset.type === 'reel' ||
                    /\.(mp4|mov|webm)$/i.test(asset.url);
    if (isVideo) {
      // Discord can't embed video natively in embeds — just show the URL as a link
      content += `\n\n📹 **Video:** ${asset.url}`;
    } else {
      // Image — use embed so Discord renders it inline
      embeds.push({ title: asset.title, image: { url: asset.url }, color: 0x1a73e8 });
    }
  }

  return { content: content || '(no response)', embeds };
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

  if (!text) return;

  const userId   = message.author.id;
  const username = message.author.globalName ?? message.author.username;

  console.log(`[bot] message from ${username} (${isDM ? 'DM' : 'channel'}): ${text.slice(0, 80)}`);

  // Show typing indicator
  try { await message.channel.sendTyping(); } catch { /* ignore */ }

  try {
    const data = await askAgent(text, userId, username);
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
