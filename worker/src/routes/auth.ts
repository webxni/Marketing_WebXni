/**
 * Auth routes — login / logout / me
 * Sessions stored in SESSION KV with 7-day TTL.
 */
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { verifyPassword } from './users';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

authRoutes.post('/login', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);

  const { email, password } = parsed.data;

  let user: { id: string; email: string; name: string; role: string; password_hash: string; is_active: number } | null;
  try {
    user = await c.env.DB
      .prepare('SELECT id, email, name, role, password_hash, is_active FROM users WHERE email = ?')
      .bind(email.toLowerCase())
      .first<{ id: string; email: string; name: string; role: string; password_hash: string; is_active: number }>();
  } catch (e) {
    console.error('DB SELECT failed:', e);
    return c.json({ error: 'Database error', detail: String(e) }, 500);
  }

  if (!user || user.is_active === 0) return c.json({ error: 'Invalid credentials' }, 401);

  let valid: boolean;
  try {
    valid = await verifyPassword(password, user.password_hash);
  } catch (e) {
    console.error('verifyPassword failed:', e);
    return c.json({ error: 'Auth error', detail: String(e) }, 500);
  }
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  // Update last login (best-effort — don't fail login if column missing)
  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();
  } catch { /* last_login column may not exist yet — ignore */ }

  const sessionId = crypto.randomUUID();
  const sessionData: SessionData = {
    userId: user.id,
    email:  user.email,
    name:   user.name,
    role:   user.role as SessionData['role'],
  };

  try {
    await c.env.KV_BINDING.put(`session:${sessionId}`, JSON.stringify(sessionData), {
      expirationTtl: 7 * 24 * 60 * 60,
    });
  } catch (e) {
    console.error('KV session write failed:', e);
    return c.json({ error: 'Session error', detail: String(e) }, 500);
  }

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure:   true,
    sameSite: 'Strict',
    path:     '/',
    maxAge:   7 * 24 * 60 * 60,
  });

  return c.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) await c.env.KV_BINDING.delete(`session:${sessionId}`);
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);
  return c.json({ user });
});

/** PUT /api/auth/profile — update display name */
authRoutes.put('/profile', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const schema = z.object({ name: z.string().min(1).max(100) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);

  await c.env.DB
    .prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
    .bind(parsed.data.name, Math.floor(Date.now() / 1000), user.userId)
    .run();

  return c.json({ ok: true });
});

/** POST /api/auth/change-password */
authRoutes.post('/change-password', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const schema = z.object({
    current_password: z.string().min(1),
    new_password:     z.string().min(8),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);

  const row = await c.env.DB
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.userId)
    .first<{ password_hash: string }>();

  if (!row) return c.json({ error: 'User not found' }, 404);

  const valid = await verifyPassword(parsed.data.current_password, row.password_hash);
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401);

  const { hashPassword } = await import('./users');
  const newHash = await hashPassword(parsed.data.new_password);

  await c.env.DB
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(newHash, Math.floor(Date.now() / 1000), user.userId)
    .run();

  return c.json({ ok: true });
});
