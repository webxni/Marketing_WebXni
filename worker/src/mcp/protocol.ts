import { isToolAllowed, isPublishTool, MCP_READ_TOOLS, MCP_DRAFT_TOOLS, MCP_PUBLISH_TOOLS, forceClientScope } from './scope';

export type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
export type ToolExec = (
  name: string, args: Record<string, unknown>,
) => Promise<{ success: boolean; error?: string; action_summary?: string; summary?: unknown; items?: unknown }>;

export interface McpDeps {
  clientSlug: string;
  clientName: string;
  exec: ToolExec;
  onCall?: (name: string, ok: boolean) => void;
  publishGuard?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>;
}

const PROTOCOL_VERSION = '2024-11-05';

// Minimal generic schema; executeTool validates args itself.
const GENERIC_SCHEMA = { type: 'object', additionalProperties: true } as const;

export const MCP_TOOL_DEFS = [...MCP_READ_TOOLS, ...MCP_DRAFT_TOOLS, ...MCP_PUBLISH_TOOLS].map((name) => ({
  name,
  description: `Marketing tool "${name}" scoped to this client.`,
  inputSchema: GENERIC_SCHEMA,
}));

function ok(id: JsonRpc['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function err(id: JsonRpc['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export async function handleMcpRpc(rpc: JsonRpc, deps: McpDeps): Promise<object> {
  switch (rpc.method) {
    case 'initialize':
      return ok(rpc.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: `webxni-mcp-${deps.clientSlug}`, version: '1.0.0' },
      });

    case 'notifications/initialized':
      return ok(rpc.id, {});

    case 'tools/list':
      return ok(rpc.id, { tools: MCP_TOOL_DEFS });

    case 'tools/call': {
      const name = String(rpc.params?.name ?? '');
      const rawArgs = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
      if (!isToolAllowed(name)) {
        deps.onCall?.(name, false);
        return ok(rpc.id, {
          isError: true,
          content: [{ type: 'text', text: `Tool "${name}" is not available in this workspace.` }],
        });
      }
      const args = forceClientScope(rawArgs, deps.clientSlug);
      if (isPublishTool(name) && deps.publishGuard) {
        const gate = await deps.publishGuard(name, args);
        if (!gate.allowed) {
          deps.onCall?.(name, false);
          return ok(rpc.id, {
            isError: true,
            content: [{ type: 'text', text: gate.reason ?? 'Publishing is not allowed right now.' }],
          });
        }
      }
      const result = await deps.exec(name, args);
      deps.onCall?.(name, result.success);
      const text = result.success
        ? (result.action_summary ?? `${name} completed.`)
        : (result.error ?? `${name} failed.`);
      return ok(rpc.id, {
        isError: !result.success,
        content: [{ type: 'text', text }],
        structuredContent: { summary: result.summary, items: result.items },
      });
    }

    default:
      return err(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}
