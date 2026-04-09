/**
 * KV-backed sliding window rate limiter
 *
 * Default: 120 requests / minute per session (or IP for unauthenticated)
 * Auth endpoints: 10 requests / minute (brute-force protection)
 */
import type { Context, Next } from 'hono';
import type { Env, SessionData } from '../types';

const DEFAULT_LIMIT = 120;
const AUTH_LIMIT = 10;
const WINDOW_SEC = 60;

export async function rateLimitMiddleware(
  c: Context<{ Bindings: Env; Variables: { user: SessionData } }>,
  next: Next,
): Promise<Response> {
  const isAuth = c.req.path.startsWith('/api/auth/');
  const limit = isAuth ? AUTH_LIMIT : DEFAULT_LIMIT;

  // Key: session ID if logged in, else IP
  const sessionId = c.req.header('Cookie')?.match(/session=([^;]+)/)?.[1];
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
  const bucketKey = sessionId ? `session:${sessionId}` : `ip:${ip}`;

  const minute = Math.floor(Date.now() / (WINDOW_SEC * 1000));
  const rlKey = `rl:${bucketKey}:${minute}`;

  try {
    const raw = await c.env.SESSION.get(rlKey);
    const count = raw ? parseInt(raw, 10) : 0;

    if (count >= limit) {
      return c.json(
        { error: 'Rate limit exceeded', retry_after: WINDOW_SEC },
        429,
        { 'Retry-After': String(WINDOW_SEC), 'X-RateLimit-Limit': String(limit) },
      );
    }

    // Increment — TTL slightly over window so old buckets expire automatically
    await c.env.SESSION.put(rlKey, String(count + 1), { expirationTtl: WINDOW_SEC + 5 });
  } catch {
    // KV failure → fail open (never block legitimate traffic on KV hiccup)
  }

  c.res.headers.set('X-RateLimit-Limit', String(limit));
  return next();
}
