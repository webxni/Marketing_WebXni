/**
 * Marketing_WebXni — Cloudflare Worker entry point
 * Router: Hono | Auth: SESSION KV | RBAC: permission-based
 */
import { Hono } from 'hono';
import type { Env, SessionData } from './types';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';

// Routes
import { authRoutes }    from './routes/auth';
import { clientRoutes }  from './routes/clients';
import { postRoutes }    from './routes/posts';
import { assetRoutes }   from './routes/assets';
import { runRoutes }     from './routes/run';
import { userRoutes }    from './routes/users';
import { reportRoutes }  from './routes/reports';
import { serviceRoutes }  from './routes/services';
import { logRoutes }      from './routes/logs';
import { settingsRoutes } from './routes/settings';
import { setupRoutes }    from './routes/setup';

const app = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ─── Global middleware ────────────────────────────────────────────────────────
app.use('/api/*', rateLimitMiddleware);
app.use('/api/*', authMiddleware);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.route('/api/auth',    authRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/clients', serviceRoutes);   // nested: /api/clients/:slug/services, /areas, etc.
app.route('/api/posts',   postRoutes);
app.route('/api/assets',  assetRoutes);
app.route('/api/run',     runRoutes);
app.route('/api/users',   userRoutes);
app.route('/api/reports',  reportRoutes);
app.route('/api/logs',     logRoutes);
app.route('/api/settings', settingsRoutes);

app.get('/api/health', (c) =>
  c.json({ status: 'ok', ts: Date.now(), version: '2.0.0' }),
);

// One-time setup — disabled automatically after first admin is created
app.route('/api/setup', setupRoutes);

// ─── Scheduled cron handler ───────────────────────────────────────────────────
import { runPosting } from './loader/posting-run';

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 7 * * SUN') {
      // Sunday 7AM — Phase 1 content generation (not yet implemented)
      console.log('Generation cron triggered');
    } else if (event.cron === '0 2 * * *') {
      // Daily 2AM — fetch real post URLs (not yet implemented)
      console.log('Fetch URLs cron triggered');
    } else if (event.cron === '0 */6 * * *') {
      // Every 6h — automated posting check
      ctx.waitUntil(runPosting(env as any, { mode: 'real', triggered_by: 'cron', limit: 50 }));
    }
  },
};
