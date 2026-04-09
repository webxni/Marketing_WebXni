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
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const dispatch = (path: string, body: Record<string, unknown>) =>
      env.LOADER.fetch(new Request(`https://loader${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }));

    if (event.cron === '0 7 * * 0') {
      // Sunday 7AM — Phase 1 content generation
      ctx.waitUntil(dispatch('/run-generation', { phase: 1, triggered_by: 'cron' }));
    } else if (event.cron === '0 2 * * *') {
      // Daily 2AM — fetch real post URLs from Upload-Post history
      ctx.waitUntil(dispatch('/fetch-urls', { triggered_by: 'cron' }));
    } else if (event.cron === '0 */6 * * *') {
      // Every 6h — automated posting check
      ctx.waitUntil(dispatch('/run-posting', { mode: 'real', triggered_by: 'cron', limit: 50 }));
    }
  },
};
