/**
 * User management routes (admin only)
 * GET    /api/users
 * POST   /api/users
 * PUT    /api/users/:id
 * DELETE /api/users/:id
 * POST   /api/users/:id/deactivate
 * POST   /api/users/:id/reactivate
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';

export const userRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const VALID_ROLES = ['admin', 'manager', 'editor', 'reviewer', 'operator'] as const;

const createUserSchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  role:     z.enum(VALID_ROLES),
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(VALID_ROLES).optional(),
  password: z.string().min(8).optional(),
});

/** GET /api/users */
userRoutes.get('/', requirePermission('users.view'), async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT id, email, name, role, is_active, last_login, created_at FROM users ORDER BY name')
    .all<{ id: string; email: string; name: string; role: string; is_active: number; last_login: number | null; created_at: number }>()
  return c.json({ users: rows.results });
});

/** POST /api/users */
userRoutes.post('/', requirePermission('users.manage'), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const { email, name, role, password } = parsed.data;

  // Check duplicate
  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string }>();
  if (existing) return c.json({ error: 'Email already in use' }, 409);

  // Hash password — PBKDF2 via WebCrypto (faster than bcrypt on Workers)
  const hash = await hashPassword(password);
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare('INSERT INTO users (id, email, name, role, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, email.toLowerCase(), name, role, hash, now, now)
    .run();

  return c.json({ user: { id, email, name, role } }, 201);
});

/** PUT /api/users/:id */
userRoutes.put('/:id', requirePermission('users.manage'), async (c) => {
  const userId = c.req.param('id');
  const self = c.get('user');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  // Guard: cannot demote yourself from admin
  if (self.userId === userId && parsed.data.role && parsed.data.role !== 'admin') {
    const me = await c.env.DB
      .prepare('SELECT role FROM users WHERE id = ?')
      .bind(userId)
      .first<{ role: string }>();
    if (me?.role === 'admin') return c.json({ error: 'Cannot demote yourself from admin' }, 400);
  }

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (parsed.data.name)     { updates.push('name = ?');          binds.push(parsed.data.name); }
  if (parsed.data.role)     { updates.push('role = ?');          binds.push(parsed.data.role); }
  if (parsed.data.password) {
    const hash = await hashPassword(parsed.data.password);
    updates.push('password_hash = ?');
    binds.push(hash);
  }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);

  const now = Math.floor(Date.now() / 1000);
  updates.push('updated_at = ?');
  binds.push(now, userId);

  await c.env.DB
    .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return c.json({ ok: true });
});

/** POST /api/users/:id/deactivate */
userRoutes.post('/:id/deactivate', requirePermission('users.manage'), async (c) => {
  const self = c.get('user');
  if (self.userId === c.req.param('id')) return c.json({ error: 'Cannot deactivate yourself' }, 400);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?')
    .bind(now, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

/** POST /api/users/:id/reactivate */
userRoutes.post('/:id/reactivate', requirePermission('users.manage'), async (c) => {
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?')
    .bind(now, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PBKDF2 password hashing (WebCrypto — native to Workers runtime, no npm dep)
// ─────────────────────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const hashArr = Array.from(new Uint8Array(bits));
  const saltArr = Array.from(salt);
  // Format: pbkdf2$<saltHex>$<hashHex>
  return `pbkdf2$${saltArr.map((b) => b.toString(16).padStart(2, '0')).join('')}$${hashArr.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Support both pbkdf2$ format and legacy bcrypt ($2b$) from bcryptjs
  if (stored.startsWith('$2')) {
    // legacy bcrypt — use dynamic import for backwards compat
    try {
      const { compare } = await import('bcryptjs');
      return compare(password, stored);
    } catch { return false; }
  }
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const derived = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return derived === hashHex;
}
