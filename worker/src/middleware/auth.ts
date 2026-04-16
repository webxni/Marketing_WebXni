/**
 * Auth + RBAC middleware — 3-role system: admin | designer | client
 *
 * Usage:
 *   app.use('/api/*', authMiddleware)          — require valid session
 *   route.post('/', requirePermission('posts.create'), handler)
 *   route.get('/',  requireClientAccess(),     handler)  — client data isolation
 */
import { getCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import type { Env, SessionData } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Permission definitions
// ─────────────────────────────────────────────────────────────────────────────

export type Permission =
  | 'posts.view' | 'posts.create' | 'posts.edit' | 'posts.approve'
  | 'posts.publish' | 'posts.delete'
  | 'clients.view' | 'clients.create' | 'clients.edit' | 'clients.delete'
  | 'users.view' | 'users.manage'
  | 'reports.view' | 'reports.download'
  | 'automation.trigger' | 'automation.generate'
  | 'assets.upload' | 'assets.delete'
  | 'settings.view' | 'settings.edit'
  | 'logs.view'
  | 'portal.view';

const ROLE_PERMISSIONS: Record<SessionData['role'], Permission[]> = {
  admin: [
    'posts.view', 'posts.create', 'posts.edit', 'posts.approve', 'posts.publish', 'posts.delete',
    'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
    'users.view', 'users.manage',
    'reports.view', 'reports.download',
    'automation.trigger', 'automation.generate',
    'assets.upload', 'assets.delete',
    'settings.view', 'settings.edit',
    'logs.view',
    'portal.view',
  ],
  designer: [
    'posts.view', 'posts.create', 'posts.edit',
    'clients.view',
    'reports.view',
    'automation.generate',
    'assets.upload', 'assets.delete',
  ],
  client: [
    'portal.view',
    'reports.view',
  ],
};

export function hasPermission(role: SessionData['role'], permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware — validates SESSION KV cookie, injects user into context
// ─────────────────────────────────────────────────────────────────────────────
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: { user: SessionData } }>,
  next: Next,
): Promise<Response | void> {
  if (c.req.path.startsWith('/api/auth/'))         return next();
  if (c.req.path.startsWith('/api/setup'))         return next();
  if (c.req.path === '/api/ai/dispatch')           return next(); // bot_token auth inside

  const sessionId = getCookie(c, 'session');
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

  const raw = await c.env.KV_BINDING.get(`session:${sessionId}`);
  if (!raw) return c.json({ error: 'Session expired' }, 401);

  let session: SessionData;
  try {
    session = JSON.parse(raw) as SessionData;
  } catch {
    return c.json({ error: 'Invalid session' }, 401);
  }

  c.set('user', session);
  return next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission guard factory — use on individual routes
// ─────────────────────────────────────────────────────────────────────────────
export function requirePermission(permission: Permission) {
  return async (
    c: Context<{ Bindings: Env; Variables: { user: SessionData } }>,
    next: Next,
  ): Promise<Response | void> => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    if (!hasPermission(user.role, permission)) {
      return c.json({ error: 'Forbidden', required: permission }, 403);
    }
    return next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client isolation guard — enforces client users only see their own data.
// Pass the clientId param name (e.g. 'clientId' from URL) or use user.clientId.
// ─────────────────────────────────────────────────────────────────────────────
export function requireClientAccess(clientIdParam?: string) {
  return async (
    c: Context<{ Bindings: Env; Variables: { user: SessionData } }>,
    next: Next,
  ): Promise<Response | void> => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Unauthorized' }, 401);

    // Admin and designer see everything
    if (user.role === 'admin' || user.role === 'designer') return next();

    // Client role: must have clientId in session
    if (!user.clientId) return c.json({ error: 'Client account not linked' }, 403);

    // If a URL param identifies the target client, verify it matches
    if (clientIdParam) {
      const target = c.req.param(clientIdParam);
      if (target && target !== user.clientId) {
        return c.json({ error: 'Forbidden' }, 403);
      }
    }

    return next();
  };
}
