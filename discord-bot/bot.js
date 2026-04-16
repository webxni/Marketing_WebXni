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
  const parts = [];

  // Main message
  if (data.message) parts.push(data.message);

  // Items list (max 8)
  if (Array.isArray(data.items) && data.items.length > 0) {
    const MAX = 8;
    const lines = data.items.slice(0, MAX).map((item, i) => {
      const title  = item.title ?? item.name ?? item.type ?? item.id ?? '—';
      const status = item.status ? ` · ${item.status}` : '';
      const client = item.client ? ` · ${item.client}` : '';
      const date   = item.publish_date ? ` · ${String(item.publish_date).slice(0, 10)}` : '';
      return `${i + 1}. **${title}**${status}${client}${date}`;
    });
    if (data.items.length > MAX) lines.push(`…+${data.items.length - MAX} more`);
    parts.push(lines.join('\n'));
  }

  // Summary stats (scalar values only)
  if (data.summary && typeof data.summary === 'object') {
    const statParts = Object.entries(data.summary)
      .filter(([, v]) => v !== null && typeof v !== 'object')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: **${v}**`);
    if (statParts.length) parts.push('> ' + statParts.join(' · '));
  }

  // Actions taken
  if (Array.isArray(data.actions_taken) && data.actions_taken.length > 0) {
    parts.push('✅ ' + data.actions_taken.join('\n✅ '));
  }

  // First suggestion only
  if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
    parts.push(`💡 ${data.suggestions[0]}`);
  }

  // Errors
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    parts.push('⚠️ ' + data.errors.join('\n⚠️ '));
  }

  let reply = parts.filter(Boolean).join('\n\n');

  // Discord message limit
  if (reply.length > 1900) reply = reply.slice(0, 1900) + '…';

  return reply || '(no response)';
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
    const data  = await askAgent(text, userId, username);
    const reply = formatResponse(data);
    await message.reply({ content: reply, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error('[bot] error:', err);
    await message.reply({ content: '❌ Agent error — please try again.', allowedMentions: { repliedUser: false } });
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
process.on('SIGINT',  () => { client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });

client.login(BOT_TOKEN);
