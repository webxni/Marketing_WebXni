/**
 * Auth + RBAC middleware
 *
 * Usage:
 *   app.use('/api/*', authMiddleware)          — require valid session
 *   route.post('/', requirePermission('posts.create'), handler)
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
  | 'automation.trigger'
  | 'assets.upload' | 'assets.delete'
  | 'settings.view' | 'settings.edit'
  | 'logs.view';

const ROLE_PERMISSIONS: Record<SessionData['role'], Permission[]> = {
  admin: [
    'posts.view', 'posts.create', 'posts.edit', 'posts.approve', 'posts.publish', 'posts.delete',
    'clients.view', 'clients.create', 'clients.edit', 'clients.delete',
    'users.view', 'users.manage',
    'reports.view', 'reports.download',
    'automation.trigger',
    'assets.upload', 'assets.delete',
    'settings.view', 'settings.edit',
    'logs.view',
  ],
  manager: [
    'posts.view', 'posts.create', 'posts.edit', 'posts.approve', 'posts.publish', 'posts.delete',
    'clients.view', 'clients.create', 'clients.edit',
    'users.view',
    'reports.view', 'reports.download',
    'automation.trigger',
    'assets.upload', 'assets.delete',
    'settings.view',
    'logs.view',
  ],
  editor: [
    'posts.view', 'posts.create', 'posts.edit',
    'clients.view',
    'reports.view',
    'assets.upload',
    'settings.view',
  ],
  reviewer: [
    'posts.view', 'posts.approve',
    'clients.view',
    'reports.view', 'reports.download',
    'settings.view',
  ],
  operator: [
    'posts.view',
    'clients.view',
    'reports.view', 'reports.download',
    'settings.view',
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
  if (c.req.path.startsWith('/api/auth/')) return next();

  const sessionId = getCookie(c, 'session');
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401);

  const raw = await c.env.SESSION.get(`session:${sessionId}`);
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
