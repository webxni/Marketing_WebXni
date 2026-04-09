/**
 * One-time setup endpoint — creates the first admin user.
 * Automatically disabled once any admin exists in the DB.
 *
 * POST /api/setup
 * Body: { "email": "...", "password": "...", "name": "..." }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { hashPassword } from './users';

export const setupRoutes = new Hono<{ Bindings: Env }>();

setupRoutes.post('/', async (c) => {
  // Check if any admin already exists — if so, permanently disable
  const existing = await c.env.DB
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .first<{ id: string }>();

  if (existing) {
    return c.json({ error: 'Setup already complete. This endpoint is disabled.' }, 403);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const { email, password, name } = body as { email?: string; password?: string; name?: string };

  if (!email || !password || !name) {
    return c.json({ error: 'email, password, and name are required' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const hash = await hashPassword(password);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  await c.env.DB
    .prepare('INSERT INTO users (id, email, name, role, password_hash, is_active) VALUES (?, ?, ?, ?, ?, 1)')
    .bind(id, email.toLowerCase().trim(), name.trim(), 'admin', hash)
    .run();

  return c.json({ ok: true, message: `Admin user created for ${email}. This endpoint is now disabled.` });
});
