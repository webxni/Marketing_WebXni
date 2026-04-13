/**
 * Auth routes — login / logout / me / 2FA / profile
 * Sessions stored in KV with 24h TTL.
 * Login attempts recorded in login_audit table.
 */
import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { verifyPassword, hashPassword } from './users';
import { generateTotpSecret, verifyTotp, totpUri } from '../modules/totp';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { user: SessionData } }>();

const SESSION_TTL = 24 * 60 * 60; // 24h

// ─────────────────────────────────────────────────────────────────────────────

async function writeAudit(
  db: D1Database,
  data: { user_id?: string; email: string; ip?: string; ua?: string; success: boolean; fail_reason?: string },
) {
  try {
    await db
      .prepare('INSERT INTO login_audit (id, user_id, email, ip, user_agent, success, fail_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID().replace(/-/g, ''), data.user_id ?? null, data.email, data.ip ?? null, data.ua ?? null, data.success ? 1 : 0, data.fail_reason ?? null, Math.floor(Date.now() / 1000))
      .run();
  } catch { /* table may not exist yet */ }
}

function clientIp(c: { req: { header(h: string): string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

type UserRow = {
  id: string; email: string; name: string; role: string;
  password_hash: string; is_active: number;
  totp_enabled: number; totp_secret: string | null;
  client_id: string | null;
};

authRoutes.post('/login', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);

  const { email, password } = parsed.data;
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') ?? '';

  const user = await c.env.DB
    .prepare('SELECT id, email, name, role, password_hash, is_active, totp_enabled, totp_secret, client_id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<UserRow>()
    .catch(() => null);

  if (!user || user.is_active === 0) {
    await writeAudit(c.env.DB, { email, ip, ua, success: false, fail_reason: 'invalid_credentials' });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash).catch(() => false);
  if (!valid) {
    await writeAudit(c.env.DB, { user_id: user.id, email, ip, ua, success: false, fail_reason: 'wrong_password' });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // 2FA: issue a short-lived pending token — client must call /2fa/verify
  if (user.totp_enabled === 1) {
    const tempToken = crypto.randomUUID().replace(/-/g, '');
    await c.env.KV_BINDING.put(
      `2fa_pending:${tempToken}`,
      JSON.stringify({ userId: user.id, email: user.email, name: user.name, role: user.role, client_id: user.client_id }),
      { expirationTtl: 300 },
    );
    return c.json({ ok: true, requires_2fa: true, totp_token: tempToken });
  }

  // No 2FA — create full session
  const sessionId = crypto.randomUUID();
  const sessionData: SessionData = {
    userId: user.id, email: user.email, name: user.name,
    role: user.role as SessionData['role'], clientId: user.client_id,
  };
  await c.env.KV_BINDING.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: SESSION_TTL });
  setCookie(c, 'session', sessionId, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: SESSION_TTL });

  await writeAudit(c.env.DB, { user_id: user.id, email, ip, ua, success: true });
  await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), user.id).run().catch(() => {});

  return c.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, client_id: user.client_id } });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/2fa/verify — second factor: complete login
// ─────────────────────────────────────────────────────────────────────────────
authRoutes.post('/2fa/verify', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const { totp_token, code } = body as { totp_token?: string; code?: string };
  if (!totp_token || !code) return c.json({ error: 'totp_token and code required' }, 400);

  const raw = await c.env.KV_BINDING.get(`2fa_pending:${totp_token}`);
  if (!raw) return c.json({ error: 'Invalid or expired token' }, 401);

  const pending = JSON.parse(raw) as { userId: string; email: string; name: string; role: string; client_id: string | null };

  const userRow = await c.env.DB
    .prepare('SELECT totp_secret, is_active FROM users WHERE id = ?')
    .bind(pending.userId)
    .first<{ totp_secret: string | null; is_active: number }>();

  if (!userRow || !userRow.totp_secret || userRow.is_active === 0) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  if (!await verifyTotp(userRow.totp_secret, code.trim())) {
    await writeAudit(c.env.DB, { user_id: pending.userId, email: pending.email, ip: clientIp(c), success: false, fail_reason: 'invalid_totp' });
    return c.json({ error: 'Invalid authentication code' }, 401);
  }

  await c.env.KV_BINDING.delete(`2fa_pending:${totp_token}`);

  const sessionId = crypto.randomUUID();
  const sessionData: SessionData = {
    userId: pending.userId, email: pending.email, name: pending.name,
    role: pending.role as SessionData['role'], clientId: pending.client_id,
  };
  await c.env.KV_BINDING.put(`session:${sessionId}`, JSON.stringify(sessionData), { expirationTtl: SESSION_TTL });
  setCookie(c, 'session', sessionId, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/', maxAge: SESSION_TTL });

  await writeAudit(c.env.DB, { user_id: pending.userId, email: pending.email, ip: clientIp(c), success: true });
  await c.env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), pending.userId).run().catch(() => {});

  return c.json({ ok: true, user: { id: pending.userId, email: pending.email, name: pending.name, role: pending.role, client_id: pending.client_id } });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2FA management — authenticated endpoints
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/auth/2fa/status */
authRoutes.get('/2fa/status', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB
    .prepare('SELECT totp_enabled FROM users WHERE id = ?')
    .bind(user.userId).first<{ totp_enabled: number }>();
  return c.json({ enabled: row?.totp_enabled === 1 });
});

/** GET /api/auth/2fa/setup — generate a new secret for the QR code */
authRoutes.get('/2fa/setup', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const secret = generateTotpSecret();
  await c.env.KV_BINDING.put(`2fa_setup:${user.userId}`, secret, { expirationTtl: 600 });
  return c.json({ secret, uri: totpUri(user.email, secret) });
});

/** POST /api/auth/2fa/enable — confirm code then persist secret */
authRoutes.post('/2fa/enable', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const { code } = body as { code?: string };
  if (!code) return c.json({ error: 'code required' }, 400);
  const secret = await c.env.KV_BINDING.get(`2fa_setup:${user.userId}`);
  if (!secret) return c.json({ error: 'Setup session expired — restart setup' }, 400);
  if (!await verifyTotp(secret, code.trim())) return c.json({ error: 'Invalid code' }, 400);
  await c.env.KV_BINDING.delete(`2fa_setup:${user.userId}`);
  await c.env.DB.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, updated_at = ? WHERE id = ?')
    .bind(secret, Math.floor(Date.now() / 1000), user.userId).run();
  return c.json({ ok: true });
});

/** POST /api/auth/2fa/disable — require a valid code to disable */
authRoutes.post('/2fa/disable', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const { code } = body as { code?: string };
  if (!code) return c.json({ error: 'Verification code required' }, 400);
  const row = await c.env.DB.prepare('SELECT totp_secret FROM users WHERE id = ?')
    .bind(user.userId).first<{ totp_secret: string | null }>();
  if (!row?.totp_secret) return c.json({ error: '2FA is not enabled' }, 400);
  if (!await verifyTotp(row.totp_secret, code.trim())) return c.json({ error: 'Invalid code' }, 400);
  await c.env.DB.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), user.userId).run();
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────

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

authRoutes.put('/profile', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);
  await c.env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
    .bind(parsed.data.name, Math.floor(Date.now() / 1000), user.userId).run();
  return c.json({ ok: true });
});

authRoutes.post('/change-password', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Not authenticated' }, 401);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = z.object({ current_password: z.string().min(1), new_password: z.string().min(8) }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input' }, 400);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.userId).first<{ password_hash: string }>();
  if (!row) return c.json({ error: 'User not found' }, 404);
  if (!await verifyPassword(parsed.data.current_password, row.password_hash)) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(parsed.data.new_password), Math.floor(Date.now() / 1000), user.userId).run();
  return c.json({ ok: true });
});
