/**
 * Marketing_WebXni — Cloudflare Worker entry point
 * Router: Hono | Auth: SESSION KV | RBAC: permission-based
 */
import { Hono } from 'hono';
import type { Env, SessionData } from './types';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';

// Routes
import { authRoutes }        from './routes/auth';
import { clientRoutes }      from './routes/clients';
import { postRoutes }        from './routes/posts';
import { assetRoutes, publicAssetRoutes } from './routes/assets';
import { runRoutes }         from './routes/run';
import { userRoutes }        from './routes/users';
import { reportRoutes }      from './routes/reports';
import { serviceRoutes }     from './routes/services';
import { intelligenceRoutes } from './routes/intelligence';
import { packageRoutes }     from './routes/packages';
import { logRoutes }         from './routes/logs';
import { settingsRoutes }    from './routes/settings';
import { setupRoutes }       from './routes/setup';
import { wordpressRoutes }   from './routes/wordpress';
import { notionRoutes }      from './routes/notion';
import { portalRoutes }      from './routes/portal';
import { blogRoutes }        from './routes/blog';
import { blogImageRoutes }   from './routes/blog-images';
import { gbpRoutes }         from './routes/gbp';
import { internalRoutes }    from './routes/internal';
import { aiRoutes }          from './routes/ai';
import { agencyRoutes, agencyInternalRoutes } from './routes/agency';
import { discordInteractRoute, discordInternalRoute } from './routes/discord';

const app = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ─── Internal routes (no auth — Worker-to-Worker only) ───────────────────────
app.route('/internal', internalRoutes);
app.route('/internal/discord', discordInternalRoute); // register/notify
app.route('/internal/agency', agencyInternalRoutes);
app.route('/media', publicAssetRoutes);

// Discord interaction endpoint — NO auth middleware (Discord signs with Ed25519)
app.route('/api/discord', discordInteractRoute);

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('/api/*', rateLimitMiddleware);
app.use('/api/*', authMiddleware);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.route('/api/auth',      authRoutes);
app.route('/api/clients',   clientRoutes);
app.route('/api/clients',   serviceRoutes);      // /api/clients/:slug/services, /areas, etc.
app.route('/api/clients',   intelligenceRoutes); // /api/clients/:slug/intelligence, /platform-links, /platforms/:p (DELETE)
app.route('/api/clients',   wordpressRoutes);    // /api/clients/:slug/wordpress/*
app.route('/api/clients',   gbpRoutes);          // /api/clients/:slug/gbp/*
app.route('/api/posts',     postRoutes);
app.route('/api/posts',     blogRoutes);      // /api/posts/:id/publish-blog, /unpublish-blog
app.route('/api/posts',     blogImageRoutes); // /api/posts/:id/blog-images/*
app.route('/api/assets',    assetRoutes);
app.route('/api/run',       runRoutes);
app.route('/api/users',     userRoutes);
app.route('/api/reports',   reportRoutes);
app.route('/api/packages',  packageRoutes);
app.route('/api/logs',      logRoutes);
app.route('/api/settings',  settingsRoutes);
app.route('/api/notion',    notionRoutes);
app.route('/api/portal',    portalRoutes);
app.route('/api/ai',        aiRoutes);
app.route('/api/agency',    agencyRoutes);

app.get('/api/health', (c) =>
  c.json({ status: 'ok', ts: Date.now(), version: '2.0.0' }),
);

// One-time setup — disabled automatically after first admin is created
app.route('/api/setup', setupRoutes);

// ─── Static assets & SPA fallback ─────────────────────────────────────────────
app.all('/*', async (c) => {
  // If it's an API route that reached here, it's a 404
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  // Otherwise, serve from Cloudflare Assets
  return c.env.ASSETS.fetch(c.req.raw);
});

// ─── Scheduled cron handler ───────────────────────────────────────────────────
import { runPosting } from './loader/posting-run';
import { runRecurringGbp } from './loader/recurring-gbp-run';
import { runContentRequests } from './loader/content-request-run';
import { runFetchUrls } from './routes/run';
import { notifyPostingComplete, discordDM, discordSend, DISCORD_COLORS } from './services/discord';
import { runPlatformHealthCheck, buildHealthDiscordMessage } from './modules/platform-health';
import { getLatestAuditMarker, writeAuditLog } from './db/queries';

async function resolveOpenAiKeyCron(env: Env): Promise<string> {
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

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 7 * * SUN') {
      // Sunday 7AM — Phase 1 content generation (not yet implemented)
      console.log('Generation cron triggered');
    } else if (event.cron === '0 2 * * *') {
      // Daily 2AM — fetch real post URLs from Upload-Post history
      ctx.waitUntil((async () => {
        try {
          const jobId = crypto.randomUUID().replace(/-/g, '');
          await runFetchUrls(env as Parameters<typeof runFetchUrls>[0], jobId);
          console.log('Fetch URLs cron completed, job:', jobId);
        } catch (err) {
          console.error('Fetch URLs cron error:', err);
        }
      })());
    } else if (event.cron === '0 * * * *') {
      // Top of every hour — recurring GBP offers/events + recurring content requests
      ctx.waitUntil((async () => {
        try {
          const gbpStats = await runRecurringGbp(env as any);
          if (gbpStats.offers_posted > 0 || gbpStats.events_posted > 0) console.log('Recurring GBP stats:', gbpStats);
        } catch (err) {
          console.error('Recurring GBP error:', err);
        }
      })());
      ctx.waitUntil((async () => {
        try {
          const key = await resolveOpenAiKeyCron(env);
          if (!key) { console.log('Content requests skipped — no OpenAI key'); return; }
          const stats = await runContentRequests(env, key);
          if (stats.posts_created > 0 || stats.errors > 0) {
            console.log('Content request stats:', stats);
          }
        } catch (err) {
          console.error('Content request run error:', err);
        }
      })());
    } else if (event.cron === '*/1 * * * *') {
      // Every minute — exact-time posting (only runs if cron_enabled=true in settings)
      ctx.waitUntil((async () => {
        try {
          const kv = (env as unknown as { KV_BINDING: KVNamespace }).KV_BINDING;
          const raw = await kv.get('settings:system');
          const settings: Record<string, string> = raw ? JSON.parse(raw) : {};

          if (settings['cron_enabled'] === 'false') return;

          const jobId = crypto.randomUUID().replace(/-/g, '');
          await runPosting(env as any, { mode: 'real', triggered_by: 'cron', limit: 50, job_id: jobId });

          // Discord notification — only if bot token and channel are configured
          const botToken  = env.DISCORD_BOT_TOKEN;
          const channelId = env.DISCORD_CHANNEL_ID;
          if (botToken && channelId) {
            // Check for failures after the run
            try {
              const job = await env.DB
                .prepare('SELECT stats_json FROM posting_jobs WHERE id = ? LIMIT 1')
                .bind(jobId).first<{ stats_json: string | null }>();
              const stats: Record<string, number> = job?.stats_json ? JSON.parse(job.stats_json) : {};
              const sent    = stats['sent']    ?? 0;
              const failed  = stats['failed']  ?? 0;
              const skipped = stats['skipped'] ?? 0;
              // Only notify if something happened
              if (sent > 0 || failed > 0) {
                await notifyPostingComplete({ channelId, token: botToken, sent, failed, skipped, jobId, triggered: 'cron' });
              }
              // DM the owner directly on failures
              const ownerId = env.DISCORD_OWNER_ID;
              if (ownerId && failed > 0) {
                await discordDM({
                  userId:  ownerId,
                  token:   botToken,
                  content: `⚠️ **${failed} post${failed !== 1 ? 's' : ''} failed** in the last posting run. Use \`/failed\` to see details or \`/ask "fix failed posts"\` to reset them.`,
                });
              }
            } catch { /* non-fatal */ }
          }
        } catch (err) {
          console.error('Cron posting error:', err);
        }
      })());
    } else if (event.cron === '0 9 * * *') {
      // Daily 9AM — platform health check + Discord notification if issues
      ctx.waitUntil((async () => {
        try {
          const summary = await runPlatformHealthCheck(env as any);
          const msg = buildHealthDiscordMessage(summary);

          // Always notify on issues; on clean days, only send on Sundays
          const today = new Date();
          const isSunday = today.getUTCDay() === 0;
          if (summary.total_failed > 0 || isSunday) {
            const channelId = env.DISCORD_CHANNEL_ID;
            const token = env.DISCORD_BOT_TOKEN;
            if (channelId && token) {
              const dedupeKey = `platform-health:${today.toISOString().slice(0, 13)}`;
              const previous = await getLatestAuditMarker(env.DB, 'agent.platform_health.sent', 'agent_execution', dedupeKey);
              if (!previous) {
                const color = msg.status === 'error'
                  ? DISCORD_COLORS.error
                  : msg.status === 'warning'
                    ? DISCORD_COLORS.warning
                    : DISCORD_COLORS.success;
                await discordSend({
                  channelId,
                  token,
                  embeds: [{
                    title: msg.title,
                    description: msg.description,
                    color,
                    fields: msg.fields,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'WebXni Platform Health — Heartbeat diario' },
                  }],
                });
                await writeAuditLog(env.DB, {
                  action: 'agent.platform_health.sent',
                  entity_type: 'agent_execution',
                  entity_id: dedupeKey,
                  new_value: { status: msg.status, clients_checked: summary.clients_checked, total_failed: summary.total_failed },
                });
              }
            }
          }
          console.log(`Platform health cron: ${summary.clients_checked} clients, ${summary.total_failed} failed`);
        } catch (err) {
          console.error('Platform health cron error:', err);
        }
      })());
    }
  },
};
