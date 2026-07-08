import type { ClientMcpLimitRow, ClientMcpTokenRow } from '../types';
import { generateMcpToken, hashMcpToken } from '../mcp/tokens';

export async function getActiveMcpTokenByHash(
  db: D1Database, hash: string,
): Promise<ClientMcpTokenRow | null> {
  const row = await db.prepare(
    `SELECT * FROM client_mcp_tokens
     WHERE token_hash = ? AND active = 1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > unixepoch())`,
  ).bind(hash).first<ClientMcpTokenRow>();
  return row ?? null;
}

export async function touchMcpTokenUsage(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE client_mcp_tokens SET last_used_at = unixepoch() WHERE id = ?')
    .bind(id).run();
}

export async function provisionMcpToken(
  db: D1Database, clientId: string, label: string,
): Promise<{ token: string; row: ClientMcpTokenRow }> {
  const { token, prefix } = generateMcpToken();
  const hash = await hashMcpToken(token);
  const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  await db.prepare(
    `INSERT INTO client_mcp_tokens (id, client_id, token_hash, token_prefix, label)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, clientId, hash, prefix, label).run();
  const row = await db.prepare('SELECT * FROM client_mcp_tokens WHERE id = ?')
    .bind(id).first<ClientMcpTokenRow>();
  return { token, row: row! };
}

export async function revokeMcpToken(db: D1Database, id: string): Promise<void> {
  await db.prepare(
    'UPDATE client_mcp_tokens SET active = 0, revoked_at = unixepoch() WHERE id = ?',
  ).bind(id).run();
}

const DEFAULT_LIMITS = {
  social_per_day: 10, per_platform_per_day: 3, blog_per_day: 2, gbp_per_day: 5,
};

export async function getClientMcpLimits(
  db: D1Database, clientId: string,
): Promise<ClientMcpLimitRow> {
  const row = await db.prepare('SELECT * FROM client_mcp_limits WHERE client_id = ?')
    .bind(clientId).first<ClientMcpLimitRow>();
  if (row) return row;
  return { client_id: clientId, ...DEFAULT_LIMITS, updated_at: 0 };
}
