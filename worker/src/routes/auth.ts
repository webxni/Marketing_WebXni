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

  const user = await c.env.DB
    .prepare('SELECT id, email, name, role, password_hash, is_active FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<{ id: string; email: string; name: string; role: string; password_hash: string; is_active: number }>();

  if (!user || user.is_active === 0) return c.json({ error: 'Invalid credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

  // Update last login
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();

  const sessionId = crypto.randomUUID();
  const sessionData: SessionData = {
    userId: user.id,
    email:  user.email,
    name:   user.name,
    role:   user.role as SessionData['role'],
  };

  await c.env.SESSION.put(`session:${sessionId}`, JSON.stringify(sessionData), {
    expirationTtl: 7 * 24 * 60 * 60,
  });

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
  if (sessionId) await c.env.SESSION.delete(`session:${sessionId}`);
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);
  return c.json({ user });
});
