/**
 * User management routes (admin only)
 * GET    /api/users
 * POST   /api/users
 * PUT    /api/users/:id
 * POST   /api/users/:id/deactivate
 * POST   /api/users/:id/reactivate
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { requirePermission } from '../middleware/auth';

export const userRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const VALID_ROLES = ['admin', 'designer', 'client'] as const;

const createUserSchema = z.object({
  email:     z.string().email(),
  name:      z.string().min(1).max(100),
  role:      z.enum(VALID_ROLES),
  password:  z.string().min(8),
  client_id: z.string().optional(), // required when role = 'client'
});

const updateUserSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  role:      z.enum(VALID_ROLES).optional(),
  password:  z.string().min(8).optional(),
  client_id: z.string().nullable().optional(),
});

/** GET /api/users */
userRoutes.get('/', requirePermission('users.view'), async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT u.id, u.email, u.name, u.role, u.is_active, u.client_id,
                     u.totp_enabled, u.last_login, u.created_at,
                     cl.canonical_name as client_name
              FROM users u
              LEFT JOIN clients cl ON cl.id = u.client_id
              ORDER BY u.role, u.name`)
    .all<{
      id: string; email: string; name: string; role: string;
      is_active: number; client_id: string | null; totp_enabled: number;
      last_login: number | null; created_at: number; client_name: string | null;
    }>();
  return c.json({ users: rows.results });
});

/** POST /api/users */
userRoutes.post('/', requirePermission('users.manage'), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const { email, name, role, password, client_id } = parsed.data;

  // client role requires a client_id
  if (role === 'client' && !client_id) {
    return c.json({ error: 'client_id is required for role=client' }, 400);
  }

  // Validate client_id exists
  if (client_id) {
    const cl = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(client_id).first<{ id: string }>();
    if (!cl) return c.json({ error: 'client_id not found' }, 400);
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string }>();
  if (existing) return c.json({ error: 'Email already in use' }, 409);

  const hash = await hashPassword(password);
  const id   = crypto.randomUUID().replace(/-/g, '');
  const now  = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare('INSERT INTO users (id, email, name, role, password_hash, client_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .bind(id, email.toLowerCase(), name, role, hash, client_id ?? null, now, now)
    .run();

  return c.json({ user: { id, email, name, role, client_id: client_id ?? null } }, 201);
});

/** PUT /api/users/:id */
userRoutes.put('/:id', requirePermission('users.manage'), async (c) => {
  const userId = c.req.param('id');
  const self   = c.get('user');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  // Guard: cannot demote yourself from admin
  if (self.userId === userId && parsed.data.role && parsed.data.role !== 'admin') {
    const me = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>();
    if (me?.role === 'admin') return c.json({ error: 'Cannot demote yourself from admin' }, 400);
  }

  // If changing to client role, client_id must be set
  if (parsed.data.role === 'client' && parsed.data.client_id === undefined) {
    const cur = await c.env.DB.prepare('SELECT client_id FROM users WHERE id = ?').bind(userId).first<{ client_id: string | null }>();
    if (!cur?.client_id) return c.json({ error: 'client_id required for role=client' }, 400);
  }

  const updates: string[] = [];
  const binds: unknown[]  = [];

  if (parsed.data.name     !== undefined) { updates.push('name = ?');          binds.push(parsed.data.name); }
  if (parsed.data.role     !== undefined) { updates.push('role = ?');          binds.push(parsed.data.role); }
  if (parsed.data.client_id !== undefined) { updates.push('client_id = ?');   binds.push(parsed.data.client_id); }
  if (parsed.data.password !== undefined) {
    updates.push('password_hash = ?');
    binds.push(await hashPassword(parsed.data.password));
  }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  updates.push('updated_at = ?');
  binds.push(Math.floor(Date.now() / 1000), userId);

  await c.env.DB
    .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return c.json({ ok: true });
});

/** POST /api/users/:id/deactivate */
userRoutes.post('/:id/deactivate', requirePermission('users.manage'), async (c) => {
  if (c.get('user').userId === c.req.param('id')) return c.json({ error: 'Cannot deactivate yourself' }, 400);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?').bind(now, c.req.param('id')).run();
  return c.json({ ok: true });
});

/** POST /api/users/:id/reactivate */
userRoutes.post('/:id/reactivate', requirePermission('users.manage'), async (c) => {
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?').bind(now, c.req.param('id')).run();
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PBKDF2 password hashing (WebCrypto — native to Workers runtime)
// ─────────────────────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256);
  const hex  = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) {
    try { const { compare } = await import('bcryptjs'); return compare(password, stored); } catch { return false; }
  }
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('') === hashHex;
}
