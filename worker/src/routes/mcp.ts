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
import { getActiveMcpTokenByHash, touchMcpTokenUsage, getClientMcpLimits } from '../db/mcp-queries';
import { hashMcpToken } from '../mcp/tokens';
import { handleMcpRpc, type JsonRpc } from '../mcp/protocol';
import { decidePublish, platformCategory, counterKey } from '../mcp/limits';
import { buildResource } from '../mcp/resources';

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
  if (!client || client.slug !== slug || client.mcp_enabled !== 1) {
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

  // Captured by publishGuard, read by the audit logger, so the live record always
  // shows whether a published image was designer-delivered or AI-generated.
  let publishOrigin: { asset_source: string | null; policy: string; is_media: boolean } | undefined;

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
        new_value: {
          success,
          token_prefix: tokenRow.token_prefix,
          token_id: tokenRow.id,
          token_label: tokenRow.label,
          ...(publishOrigin ? { asset_source: publishOrigin.asset_source, auto_publish_policy: publishOrigin.policy, is_media: publishOrigin.is_media } : {}),
        },
        ip: c.req.header('cf-connecting-ip') ?? undefined,
      }));
    },
    publishGuard: async (_name, args) => {
      const limits = await getClientMcpLimits(c.env.DB, client.id);
      const today = new Date().toISOString().slice(0, 10);
      // Determine target platform + whether media, from the post being published.
      const postId = String((args.post_id ?? args.id ?? '') || '');
      let platform = String(args.platform ?? '');
      let isMedia = false;
      let hasDeliveredMedia = false;
      let assetSource: string | null = null;
      if (postId) {
        const row = await c.env.DB.prepare(
          'SELECT platforms, content_type, asset_delivered, asset_source FROM posts WHERE id = ? AND client_id = ?',
        ).bind(postId, client.id).first<{ platforms: string | null; content_type: string | null; asset_delivered: number | null; asset_source: string | null }>();
        if (row) {
          if (!platform) { try { platform = (JSON.parse(row.platforms ?? '[]')[0] ?? ''); } catch { platform = ''; } }
          isMedia = row.content_type === 'image' || row.content_type === 'video' || row.content_type === 'reel';
          hasDeliveredMedia = row.asset_delivered === 1;
          assetSource = row.asset_source;
        }
      }
      const policy = (client.auto_publish_policy === 'ai_and_text' ? 'ai_and_text' : 'strict');
      publishOrigin = { asset_source: assetSource, policy, is_media: isMedia };
      const category = platformCategory(platform || 'facebook');
      const kv = c.env.KV_BINDING;
      const catKey = counterKey(client.id, category, today);
      const platKey = counterKey(client.id, `plat:${platform}`, today);
      const usedForCategory = Number((await kv.get(catKey)) ?? '0');
      const usedForPlatform = Number((await kv.get(platKey)) ?? '0');
      const decision = decidePublish({ category, usedForCategory, usedForPlatform, limits, hasDeliveredMedia, isMedia, assetSource, policy });
      if (decision.allowed) {
        // Optimistically reserve a slot; TTL ~2 days so counters self-expire.
        await kv.put(catKey, String(usedForCategory + 1), { expirationTtl: 172800 });
        await kv.put(platKey, String(usedForPlatform + 1), { expirationTtl: 172800 });
      }
      return decision;
    },
    readResource: (uri) => buildResource(uri, { db: c.env.DB, clientId: client.id }),
  });

  return c.json(response);
});
