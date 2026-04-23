/**
 * Discord notification service
 * Uses Discord REST API v10 with bot token auth.
 * No Gateway/WebSocket — notifications + slash command responses only.
 */

const DISCORD_API = 'https://discord.com/api/v10';

// ── Embed colors ───────────────────────────────────────────────────────────────
export const DISCORD_COLORS = {
  success: 0x1a73e8, // Google Blue — matches platform accent
  warning: 0xf59e0b, // Amber
  error:   0xef4444, // Red
  info:    0x6b7280, // Slate gray
  purple:  0x7c3aed, // Generation
} as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DiscordField {
  name:    string;
  value:   string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?:       string;
  description?: string;
  color?:       number;
  fields?:      DiscordField[];
  footer?:      { text: string };
  timestamp?:   string;
  url?:         string;
}

// ── Core send functions ────────────────────────────────────────────────────────

/** Send a plain text or embed message to a channel. */
export async function discordSend(opts: {
  channelId: string;
  token:     string;
  content?:  string;
  embeds?:   DiscordEmbed[];
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts.content) body['content'] = opts.content;
  if (opts.embeds?.length) body['embeds'] = opts.embeds;

  try {
    const res = await fetch(`${DISCORD_API}/channels/${opts.channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${opts.token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[discord] send failed ${res.status}:`, err.slice(0, 120));
    }
  } catch (err) {
    console.error('[discord] send error:', err);
  }
}

/** PATCH an existing interaction response (for deferred slash commands). */
export async function discordPatchInteraction(opts: {
  applicationId: string;
  token:         string;      // interaction token (NOT bot token)
  botToken:      string;
  content?:      string;
  embeds?:       DiscordEmbed[];
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts.content) body['content'] = opts.content;
  if (opts.embeds?.length) body['embeds'] = opts.embeds;

  try {
    const res = await fetch(
      `${DISCORD_API}/webhooks/${opts.applicationId}/${opts.token}/messages/@original`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bot ${opts.botToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error(`[discord] patch interaction failed ${res.status}:`, err.slice(0, 120));
    }
  } catch (err) {
    console.error('[discord] patch error:', err);
  }
}

// ── Notification helpers ───────────────────────────────────────────────────────

export async function notifyPostingComplete(opts: {
  channelId:  string;
  token:      string;
  sent:       number;
  failed:     number;
  skipped:    number;
  jobId:      string;
  triggered:  string;
}): Promise<void> {
  const { sent, failed, skipped, jobId, triggered } = opts;
  const allGood = failed === 0;

  await discordSend({
    channelId: opts.channelId,
    token:     opts.token,
    embeds: [{
      title:  allGood ? '✅ Posting run complete' : '⚠️ Posting run finished with failures',
      color:  allGood ? DISCORD_COLORS.success : DISCORD_COLORS.error,
      fields: [
        { name: 'Sent',      value: String(sent),      inline: true },
        { name: 'Failed',    value: String(failed),    inline: true },
        { name: 'Skipped',   value: String(skipped),   inline: true },
        { name: 'Triggered', value: triggered,         inline: true },
        { name: 'Job ID',    value: `\`${jobId}\``,    inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'WebXni Marketing Platform' },
    }],
  });
}

export async function notifyGenerationComplete(opts: {
  channelId:  string;
  token:      string;
  created:    number;
  runId:      string;
  dateRange:  string;
  clients:    string;
}): Promise<void> {
  const { created, runId, dateRange, clients } = opts;

  await discordSend({
    channelId: opts.channelId,
    token:     opts.token,
    embeds: [{
      title:  '🤖 AI Generation complete',
      color:  DISCORD_COLORS.purple,
      fields: [
        { name: 'Posts created', value: String(created), inline: true },
        { name: 'Date range',    value: dateRange,       inline: true },
        { name: 'Clients',       value: clients || 'all active', inline: false },
        { name: 'Run ID',        value: `\`${runId}\``,  inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'WebXni Marketing Platform' },
    }],
  });
}

export async function notifyFailedPosts(opts: {
  channelId: string;
  token:     string;
  count:     number;
  posts:     Array<{ title: string | null; client_slug: string }>;
}): Promise<void> {
  const { count, posts } = opts;
  const preview = posts.slice(0, 5)
    .map(p => `• **${p.client_slug}** — ${p.title ?? '(no title)'}`)
    .join('\n');

  await discordSend({
    channelId: opts.channelId,
    token:     opts.token,
    embeds: [{
      title:       `🔴 ${count} failed post${count !== 1 ? 's' : ''} detected`,
      description: preview + (count > 5 ? `\n…and ${count - 5} more` : ''),
      color:       DISCORD_COLORS.error,
      footer:      { text: 'Use /ask "fix failed posts" to reset them' },
      timestamp:   new Date().toISOString(),
    }],
  });
}

// ── Direct messages ────────────────────────────────────────────────────────────

/**
 * Send a DM to a Discord user by their user ID.
 * Creates the DM channel first (idempotent — Discord returns the same channel
 * if it already exists), then sends the message.
 */
export async function discordDM(opts: {
  userId:  string;
  token:   string;
  content?: string;
  embeds?:  DiscordEmbed[];
}): Promise<void> {
  const { userId, token } = opts;

  try {
    // Step 1 — open/retrieve the DM channel
    const chanRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!chanRes.ok) {
      const err = await chanRes.text();
      console.error(`[discord] DM channel open failed ${chanRes.status}:`, err.slice(0, 120));
      return;
    }

    const chan = await chanRes.json() as { id: string };

    // Step 2 — send the message into the DM channel
    await discordSend({ channelId: chan.id, token, content: opts.content, embeds: opts.embeds });
  } catch (err) {
    console.error('[discord] DM error:', err);
  }
}

// ── Ed25519 signature verification ─────────────────────────────────────────────

function hexToUint8(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

export async function verifyDiscordSignature(
  body:      string,
  signature: string,
  timestamp: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const enc         = new TextEncoder();
    const signedData  = enc.encode(timestamp + body);
    const sigBytes    = hexToUint8(signature);
    const pkBytes     = hexToUint8(publicKey);

    const key = await crypto.subtle.importKey(
      'raw', pkBytes,
      { name: 'Ed25519' },
      false, ['verify'],
    );
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, signedData);
  } catch (err) {
    console.error('[discord] signature verify error:', err);
    return false;
  }
}

// ── Slash command registration ─────────────────────────────────────────────────

export const SLASH_COMMANDS = [
  {
    name:        'ask',
    description: 'Ask the WebXni AI Agent anything about the platform',
    options: [{
      name:        'message',
      description: 'Your question or command',
      type:        3, // STRING
      required:    true,
    }],
  },
  {
    name:        'status',
    description: 'Get a quick system health check',
  },
  {
    name:        'queue',
    description: 'Show the current posting queue',
  },
  {
    name:        'failed',
    description: 'Show all failed posts',
  },
  {
    name:        'create-post',
    description: 'Create a post with AI content + Stability image for a client',
    options: [
      { name: 'client',        description: 'Client slug', type: 3, required: true },
      { name: 'platforms',     description: 'Comma-separated: facebook,instagram,google_business,linkedin,etc.', type: 3, required: false },
      { name: 'content_type',  description: 'image (default), reel, video', type: 3, required: false },
      { name: 'topic',         description: 'Specific topic or question (optional — auto-researched if blank)', type: 3, required: false },
      { name: 'publish_date',  description: 'YYYY-MM-DD or YYYY-MM-DDTHH:MM (default: today)', type: 3, required: false },
    ],
  },
  {
    name:        'create-blog',
    description: 'Create a long-form SEO blog post with AI image for a client',
    options: [
      { name: 'client',   description: 'Client slug', type: 3, required: true },
      { name: 'question', description: 'Blog question or topic to answer (optional)', type: 3, required: false },
      { name: 'date',     description: 'Publish date YYYY-MM-DD (default: today)', type: 3, required: false },
    ],
  },
  {
    name:        'weekly-content',
    description: 'Trigger AI content generation for a week',
    options: [
      {
        name:        'client',
        description: 'Client slug (omit for all active clients)',
        type:        3, // STRING
        required:    false,
      },
      {
        name:        'week',
        description: 'Which week: this-week, next-week, or YYYY-MM-DD (Monday)',
        type:        3,
        required:    false,
      },
      {
        name:        'mode',
        description: 'Generation mode: standard (default) or high-quality',
        type:        3,
        required:    false,
        choices: [
          { name: 'standard',     value: 'standard' },
          { name: 'high-quality', value: 'high-quality' },
        ],
      },
    ],
  },
];

export async function registerSlashCommands(applicationId: string, botToken: string): Promise<void> {
  const res = await fetch(
    `${DISCORD_API}/applications/${applicationId}/commands`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(SLASH_COMMANDS),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to register commands: ${res.status} ${err.slice(0, 200)}`);
  }
}
