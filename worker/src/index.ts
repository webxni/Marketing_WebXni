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
import { assetRoutes }       from './routes/assets';
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
import { gbpRoutes }         from './routes/gbp';

const app = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

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
app.route('/api/posts',     blogRoutes);    // /api/posts/:id/publish-blog, /unpublish-blog
app.route('/api/assets',    assetRoutes);
app.route('/api/run',       runRoutes);
app.route('/api/users',     userRoutes);
app.route('/api/reports',   reportRoutes);
app.route('/api/packages',  packageRoutes);
app.route('/api/logs',      logRoutes);
app.route('/api/settings',  settingsRoutes);
app.route('/api/notion',    notionRoutes);
app.route('/api/portal',    portalRoutes);

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
import { runFetchUrls } from './routes/run';

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
      // Top of every hour — recurring GBP offers/events only
      ctx.waitUntil((async () => {
        try {
          const gbpStats = await runRecurringGbp(env as any);
          if (gbpStats.offers_posted > 0 || gbpStats.events_posted > 0) console.log('Recurring GBP stats:', gbpStats);
        } catch (err) {
          console.error('Recurring GBP error:', err);
        }
      })());
    } else if (event.cron === '*/1 * * * *') {
      // Every minute — exact-time posting (only runs if cron_enabled=true in settings)
      ctx.waitUntil((async () => {
        try {
          const raw = await (env as unknown as { KV_BINDING: KVNamespace }).KV_BINDING.get('settings:system');
          const settings: Record<string, string> = raw ? JSON.parse(raw) : {};

          if (settings['cron_enabled'] === 'false') return;

          await runPosting(env as any, { mode: 'real', triggered_by: 'cron', limit: 50 });
        } catch (err) {
          console.error('Cron posting error:', err);
        }
      })());
    }
  },
};
