/**
 * Per-client MCP bridge — POST /mcp/:slug
 *
 * Bearer-token authenticated JSON-RPC endpoint for tenant-scoped MCP clients
 * (e.g. Claude Desktop / Claude Code configured per client workspace).
 *
 * - Self-authenticates via a per-client token (see `mcp/tokens.ts`, `db/mcp-queries.ts`).
 *   This route is intentionally mounted OUTSIDE `authMiddleware` / session auth.
 * - Forces client scope for every tool call (see `mcp/protocol.ts` → `forceClientScope`).
 * - Every tool call is audited via `writeAuditLog`.
 */
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { executeTool, resolveAgentOpenAiKey } from './ai';
import { getClientById, writeAuditLog } from '../db/queries';
import { getActiveMcpTokenByHash, touchMcpTokenUsage } from '../db/mcp-queries';
import { hashMcpToken } from '../mcp/tokens';
import { handleMcpRpc, type JsonRpc } from '../mcp/protocol';

export const mcpRoutes = new Hono<{ Bindings: Env }>();

mcpRoutes.post('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const auth = c.req.header('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) return c.json({ error: 'Missing bearer token' }, 401);

  const hash = await hashMcpToken(token);
  const tokenRow = await getActiveMcpTokenByHash(c.env.DB, hash);
  if (!tokenRow) return c.json({ error: 'Invalid or revoked token' }, 401);

  const client = await getClientById(c.env.DB, tokenRow.client_id);
  if (!client || client.slug !== slug || (client as any).mcp_enabled !== 1) {
    return c.json({ error: 'Workspace not available' }, 403);
  }

  let rpc: JsonRpc;
  try {
    rpc = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  c.executionCtx.waitUntil(touchMcpTokenUsage(c.env.DB, tokenRow.id));

  // Client-scoped actor identity for this token. Deliberately NOT the global
  // admin/null-clientId shape used by ai.ts's MCP_AGENT_USER — this actor
  // represents a single tenant's token, so role/clientId reflect that scope
  // even though executeTool's own scoping is enforced via `forceClientScope`
  // (mcp/scope.ts) rewriting the tool args before dispatch, not via this actor.
  const actor: SessionData = {
    userId: `mcp:${tokenRow.id}`,
    email: `mcp+${client.slug}@webxni.internal`,
    name: `MCP Token (${client.canonical_name})`,
    role: 'client',
    clientId: client.id,
  };

  const openAiKey = await resolveAgentOpenAiKey(c.env);

  let baseUrl = 'https://marketing.webxni.com';
  try {
    baseUrl = new URL(c.req.url).origin;
  } catch {
    /* keep default */
  }

  const response = await handleMcpRpc(rpc, {
    clientSlug: client.slug,
    clientName: client.canonical_name,
    exec: async (name, args) => executeTool(
      name, args, c.env, actor, baseUrl, c.executionCtx, openAiKey,
    ),
    onCall: (name, success) => {
      c.executionCtx.waitUntil(writeAuditLog(c.env.DB, {
        user_id: actor.userId,
        action: `mcp.${name}`,
        entity_type: 'client',
        entity_id: client.id,
        new_value: { success, token_prefix: tokenRow.token_prefix },
        ip: c.req.header('cf-connecting-ip') ?? undefined,
      }));
    },
  });

  return c.json(response);
});
