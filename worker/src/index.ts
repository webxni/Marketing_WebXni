/**
 * Marketing_WebXni — Cloudflare Worker entry point
 * Router: Hono
 * Auth: SESSION KV (cookie-based)
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, SessionData } from './types';

// Route handlers
import { authRoutes } from './routes/auth';
import { clientRoutes } from './routes/clients';
import { postRoutes } from './routes/posts';
import { assetRoutes } from './routes/assets';
import { runRoutes } from './routes/run';

const app = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE — all /api/* except /api/auth/*
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  // Skip auth for login/logout
  if (c.req.path.startsWith('/api/auth/')) {
    return next();
  }

  const sessionId = getCookie(c, 'session');
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const raw = await c.env.SESSION.get(`session:${sessionId}`);
  if (!raw) {
    return c.json({ error: 'Session expired' }, 401);
  }

  let session: SessionData;
  try {
    session = JSON.parse(raw) as SessionData;
  } catch {
    return c.json({ error: 'Invalid session' }, 401);
  }

  c.set('user', session);
  return next();
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────
app.route('/api/auth', authRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/posts', postRoutes);
app.route('/api/assets', assetRoutes);
app.route('/api/run', runRoutes);

app.get('/api/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// ─────────────────────────────────────────────────────────────────────────────
// CRON HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = event.cron;

    if (cron === '0 7 * * 0') {
      // Sunday 7AM — weekly Phase 1 content generation
      ctx.waitUntil(
        env.LOADER.fetch(
          new Request('https://loader/run-generation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phase: 1, triggered_by: 'cron' }),
          }),
        ),
      );
    } else if (cron === '0 2 * * *') {
      // Daily 2AM — fetch real URLs from Upload-Post history
      ctx.waitUntil(
        env.LOADER.fetch(
          new Request('https://loader/fetch-urls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ triggered_by: 'cron' }),
          }),
        ),
      );
    } else if (cron === '0 */6 * * *') {
      // Every 6 hours — posting check (only posts ready entries)
      ctx.waitUntil(
        env.LOADER.fetch(
          new Request('https://loader/run-posting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'real', triggered_by: 'cron', limit: 50 }),
          }),
        ),
      );
    }
  },
};
