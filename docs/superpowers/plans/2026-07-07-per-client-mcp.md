# Per-Client MCP Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each active client a secure, isolated MCP endpoint at `https://marketing.webxni.com/mcp/<clientname>` where external AI agents can manage only that client's marketing under enforced allowlists, publish limits, and audit.

**Architecture:** A new self-contained MCP layer on the existing Cloudflare Worker. A Hono route `/mcp/:slug` authenticates a per-client bearer token, forces `client_id` from the token, and dispatches MCP JSON-RPC (`tools/list`, `tools/call`, `resources/*`, `prompts/*`) to the existing `executeTool` via a restricted allowlist, with KV-backed per-day publish caps and `audit_logs` writes. No changes to existing `/api/*` or `/internal/*` behavior.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1 (SQLite), Workers KV, Web Crypto (SHA-256), vitest (new, node env, for pure-logic tests).

## Global Constraints

- Endpoint host/path (verbatim): `https://marketing.webxni.com/mcp/<clientname>`; handle = client slug.
- Migrations are **additive only** (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`); never drop/rewrite existing tables. Prod D1 name: `webxni_db`.
- Token comparison MUST be timing-safe. Store only SHA-256 hashes; never store raw tokens.
- `client_id` is resolved ONLY from the token; any `client`/`client_id`/`slug` argument from the caller is overridden. Cross-client access must be structurally impossible.
- Tenant tool access is an explicit allowlist. Destructive/credential/admin tools are never exposed.
- Auto-publish is capped per client/day and per platform/day; over-limit routes to `pending_approval`. Media posts require `asset_delivered=1` to auto-publish.
- Default caps: 10 social/day, 3 per-platform/day, 2 blog/day, 5 GBP/day (per-client tunable).
- Every tenant call writes `audit_logs` with `action='mcp.<tool>'`.
- Deploy with `CLOUDFLARE_API_TOKEN=… npx wrangler deploy` from repo root; apply migrations with `npx wrangler d1 execute webxni_db --remote --file=…`.
- Existing `executeTool` signature (do not change): `executeTool(name, args, env, user: SessionData, baseUrl, ctx: ExecutionContext, openAiKey?)` → `ToolResult { success: boolean; error?: string; action_summary?: string; summary?: unknown; items?: unknown; suggestions?: unknown; job_id?: string }`.

---

## File Structure

- `worker/vitest.config.ts` (new) — node-env vitest for pure modules.
- `worker/src/mcp/tokens.ts` (new) — token generate/hash/timing-safe verify.
- `worker/src/mcp/scope.ts` (new) — tool allowlist + client-scope forcing.
- `worker/src/mcp/limits.ts` (new) — publish caps, KV counters, media guardrail.
- `worker/src/mcp/protocol.ts` (new) — MCP JSON-RPC dispatcher (pure, injected `exec`).
- `worker/src/mcp/resources.ts` (new) — client resources builder.
- `worker/src/mcp/prompts.ts` (new) — MCP prompt catalog.
- `worker/src/db/mcp-queries.ts` (new) — token + limits D1 queries + provisioning.
- `worker/src/routes/mcp.ts` (new) — Hono `/mcp/:slug` route: auth → protocol → audit.
- `worker/src/types.ts` (modify) — add `ClientMcpTokenRow`, `ClientMcpLimitRow`.
- `worker/src/index.ts` (modify) — mount `/mcp` before `/api/*` auth middleware.
- `db/migrations/0049_client_mcp.sql` (new) — tables + `clients.mcp_enabled`.
- `scripts/provision-client-mcp-tokens.mjs` (new) — mint tokens for active clients.
- `worker/src/routes/reports.ts` or new cron hook (modify/new) — daily MCP report.
- `worker/src/routes/mcp-config.ts` (new) — per-client config/discovery page.

---

## Task 1: Add vitest (node env) test harness

**Files:**
- Create: `worker/vitest.config.ts`
- Modify: `worker/package.json`
- Test: `worker/src/mcp/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` (vitest) runnable in `worker/`.

- [ ] **Step 1: Add vitest config**

Create `worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Add scripts + devDeps to `worker/package.json`**

In `"scripts"` add `"test": "vitest run"` and `"test:watch": "vitest"`. In `"devDependencies"` add `"vitest": "^2.1.0"`. Then install:

Run: `cd worker && npm install`
Expected: vitest present in `node_modules/.bin/vitest`.

- [ ] **Step 3: Write smoke test**

Create `worker/src/mcp/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd worker && npm test`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add worker/vitest.config.ts worker/package.json worker/package-lock.json worker/src/mcp/__tests__/smoke.test.ts
git commit -m "test: add vitest node harness for MCP modules"
```

---

## Task 2: Migration + types for MCP tokens and limits

**Files:**
- Create: `db/migrations/0049_client_mcp.sql`
- Modify: `worker/src/types.ts`

**Interfaces:**
- Produces: tables `client_mcp_tokens`, `client_mcp_limits`; column `clients.mcp_enabled`; types `ClientMcpTokenRow`, `ClientMcpLimitRow`.

- [ ] **Step 1: Write the migration**

Create `db/migrations/0049_client_mcp.sql`:

```sql
-- 0049: Per-client MCP workspaces — tenant tokens, publish limits, kill switch.
-- Additive only.

CREATE TABLE IF NOT EXISTS client_mcp_tokens (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,             -- SHA-256 hex of the raw token
  token_prefix TEXT NOT NULL,             -- first 8 chars for display
  label        TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_mcp_token_hash ON client_mcp_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_client_mcp_tokens_client ON client_mcp_tokens(client_id, active);

CREATE TABLE IF NOT EXISTS client_mcp_limits (
  client_id            TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  social_per_day       INTEGER NOT NULL DEFAULT 10,
  per_platform_per_day INTEGER NOT NULL DEFAULT 3,
  blog_per_day         INTEGER NOT NULL DEFAULT 2,
  gbp_per_day          INTEGER NOT NULL DEFAULT 5,
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

ALTER TABLE clients ADD COLUMN mcp_enabled INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Apply migration to prod D1**

Run: `CLOUDFLARE_API_TOKEN=$TOK npx wrangler d1 execute webxni_db --remote --file=db/migrations/0049_client_mcp.sql`
Expected: `changed_db: true`.

- [ ] **Step 3: Add row types to `worker/src/types.ts`**

Append:

```ts
export interface ClientMcpTokenRow {
  id: string;
  client_id: string;
  token_hash: string;
  token_prefix: string;
  label: string | null;
  active: number;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export interface ClientMcpLimitRow {
  client_id: string;
  social_per_day: number;
  per_platform_per_day: number;
  blog_per_day: number;
  gbp_per_day: number;
  updated_at: number;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0049_client_mcp.sql worker/src/types.ts
git commit -m "feat: schema for per-client MCP tokens and limits"
```

---

## Task 3: Token module (generate / hash / timing-safe verify)

**Files:**
- Create: `worker/src/mcp/tokens.ts`
- Test: `worker/src/mcp/tokens.test.ts`

**Interfaces:**
- Produces:
  - `generateMcpToken(): { token: string; prefix: string }` — token format `wxmcp_<43url-safe-chars>`.
  - `hashMcpToken(token: string): Promise<string>` — SHA-256 hex.
  - `timingSafeEqualHex(a: string, b: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `worker/src/mcp/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateMcpToken, hashMcpToken, timingSafeEqualHex } from './tokens';

describe('mcp tokens', () => {
  it('generates a prefixed token and matching prefix', () => {
    const { token, prefix } = generateMcpToken();
    expect(token.startsWith('wxmcp_')).toBe(true);
    expect(token.length).toBeGreaterThan(30);
    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBe(8);
  });

  it('hashes deterministically to 64 hex chars', async () => {
    const h1 = await hashMcpToken('wxmcp_abc');
    const h2 = await hashMcpToken('wxmcp_abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashMcpToken('wxmcp_xyz')).not.toBe(h1);
  });

  it('timing-safe compare matches equal, rejects unequal and length-mismatch', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/mcp/tokens.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `worker/src/mcp/tokens.ts`:

```ts
/** Per-client MCP token helpers. Raw tokens are shown once; only hashes persist. */

const PREFIX = 'wxmcp_';

export function generateMcpToken(): { token: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // URL-safe base64 without padding.
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = `${PREFIX}${b64}`;
  return { token, prefix: token.slice(0, 8) };
}

export async function hashMcpToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings of equal expected length. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/mcp/tokens.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/tokens.ts worker/src/mcp/tokens.test.ts
git commit -m "feat: MCP token generate/hash/timing-safe verify"
```

---

## Task 4: Scope module (tool allowlist + forced client scope)

**Files:**
- Create: `worker/src/mcp/scope.ts`
- Test: `worker/src/mcp/scope.test.ts`

**Interfaces:**
- Produces:
  - `MCP_READ_TOOLS`, `MCP_DRAFT_TOOLS`, `MCP_PUBLISH_TOOLS: readonly string[]`.
  - `isToolAllowed(name: string): boolean`.
  - `isPublishTool(name: string): boolean`.
  - `forceClientScope(args: Record<string, unknown>, clientSlug: string): Record<string, unknown>` — returns a copy with `client`/`client_id`/`slug`/`client_slug` overridden to `clientSlug`, and `client_slugs` set to `[clientSlug]`.

- [ ] **Step 1: Write the failing test**

Create `worker/src/mcp/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isToolAllowed, isPublishTool, forceClientScope } from './scope';

describe('mcp scope', () => {
  it('allows read/draft/publish tools, blocks admin/destructive', () => {
    expect(isToolAllowed('get_posts')).toBe(true);
    expect(isToolAllowed('create_content_with_image')).toBe(true);
    expect(isToolAllowed('publish_post')).toBe(true);
    expect(isToolAllowed('delete_client_profile')).toBe(false);
    expect(isToolAllowed('update_client_platforms')).toBe(false);
    expect(isToolAllowed('sync_upload_post_platforms')).toBe(false);
    expect(isToolAllowed('delete_post')).toBe(false);
    expect(isToolAllowed('not_a_tool')).toBe(false);
  });

  it('flags publish tools', () => {
    expect(isPublishTool('publish_post')).toBe(true);
    expect(isPublishTool('get_posts')).toBe(false);
  });

  it('overrides any client argument with the token client', () => {
    const out = forceClientScope(
      { client: 'attacker-client', client_id: 'x', slug: 'y', title: 'ok' },
      'golden-touch-roofing',
    );
    expect(out.client).toBe('golden-touch-roofing');
    expect(out.client_id).toBe('golden-touch-roofing');
    expect(out.slug).toBe('golden-touch-roofing');
    expect(out.client_slugs).toEqual(['golden-touch-roofing']);
    expect(out.title).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/mcp/scope.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `worker/src/mcp/scope.ts`:

```ts
/** Tenant tool allowlist + forced client scoping for the per-client MCP. */

export const MCP_READ_TOOLS = [
  'get_client_details', 'get_posts', 'get_queue', 'get_report',
  'list_client_topics', 'list_content_requests',
] as const;

export const MCP_DRAFT_TOOLS = [
  'generate_content', 'create_content_with_image', 'batch_create_content',
  'generate_captions', 'add_client_topics', 'create_content_request',
  'update_post', 'update_blog_post', 'create_offer', 'create_event',
  'attach_asset_to_post',
] as const;

export const MCP_PUBLISH_TOOLS = [
  'approve_and_publish', 'publish_post', 'publish_bulk', 'publish_blog',
  'set_post_status',
] as const;

const ALLOWED = new Set<string>([
  ...MCP_READ_TOOLS, ...MCP_DRAFT_TOOLS, ...MCP_PUBLISH_TOOLS,
]);
const PUBLISH = new Set<string>(MCP_PUBLISH_TOOLS);

export function isToolAllowed(name: string): boolean {
  return ALLOWED.has(name);
}

export function isPublishTool(name: string): boolean {
  return PUBLISH.has(name);
}

const CLIENT_KEYS = ['client', 'client_id', 'slug', 'client_slug'];

export function forceClientScope(
  args: Record<string, unknown>,
  clientSlug: string,
): Record<string, unknown> {
  const next = { ...args };
  for (const key of CLIENT_KEYS) next[key] = clientSlug;
  next.client_slugs = [clientSlug];
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/mcp/scope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/scope.ts worker/src/mcp/scope.test.ts
git commit -m "feat: MCP tool allowlist + forced client scope"
```

---

## Task 5: MCP D1 queries + provisioning

**Files:**
- Create: `worker/src/db/mcp-queries.ts`

**Interfaces:**
- Consumes: `hashMcpToken`, `generateMcpToken` (Task 3); `ClientMcpTokenRow`, `ClientMcpLimitRow` (Task 2).
- Produces:
  - `getActiveMcpTokenByHash(db, hash): Promise<ClientMcpTokenRow | null>` — active, not revoked, not expired.
  - `touchMcpTokenUsage(db, id): Promise<void>`.
  - `provisionMcpToken(db, clientId, label): Promise<{ token: string; row: ClientMcpTokenRow }>`.
  - `revokeMcpToken(db, id): Promise<void>`.
  - `getClientMcpLimits(db, clientId): Promise<ClientMcpLimitRow>` — returns defaults if no row.

- [ ] **Step 1: Write implementation**

Create `worker/src/db/mcp-queries.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add worker/src/db/mcp-queries.ts
git commit -m "feat: MCP token + limits D1 queries and provisioning"
```

---

## Task 6: MCP protocol dispatcher (initialize / tools/list / tools/call)

**Files:**
- Create: `worker/src/mcp/protocol.ts`
- Test: `worker/src/mcp/protocol.test.ts`

**Interfaces:**
- Consumes: `isToolAllowed`, `forceClientScope` (Task 4).
- Produces:
  - `type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any }`.
  - `type ToolExec = (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string; action_summary?: string; summary?: unknown; items?: unknown }>`.
  - `interface McpDeps { clientSlug: string; clientName: string; exec: ToolExec; onCall?: (name: string, ok: boolean) => void }`.
  - `handleMcpRpc(rpc: JsonRpc, deps: McpDeps): Promise<object>` — returns a JSON-RPC response object.
  - `MCP_TOOL_DEFS: Array<{ name: string; description: string; inputSchema: object }>`.

- [ ] **Step 1: Write the failing test**

Create `worker/src/mcp/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleMcpRpc } from './protocol';

const deps = (exec: any) => ({ clientSlug: 'acme', clientName: 'Acme', exec });

describe('mcp protocol', () => {
  it('initialize returns protocol + server info', async () => {
    const res: any = await handleMcpRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, deps(async () => ({ success: true })));
    expect(res.result.serverInfo.name).toContain('acme');
    expect(res.result.protocolVersion).toBeTruthy();
  });

  it('tools/list returns only allowlisted tools', async () => {
    const res: any = await handleMcpRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps(async () => ({ success: true })));
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('publish_post');
    expect(names).not.toContain('delete_client_profile');
  });

  it('tools/call rejects a non-allowlisted tool without invoking exec', async () => {
    let called = false;
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_client_profile', arguments: {} } },
      deps(async () => { called = true; return { success: true }; }),
    );
    expect(called).toBe(false);
    expect(res.result.isError).toBe(true);
  });

  it('tools/call forces client scope before exec', async () => {
    let seen: any = null;
    const res: any = await handleMcpRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_posts', arguments: { client: 'evil' } } },
      deps(async (_n: string, a: any) => { seen = a; return { success: true, action_summary: 'ok' }; }),
    );
    expect(seen.client).toBe('acme');
    expect(res.result.isError).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/mcp/protocol.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `worker/src/mcp/protocol.ts`:

```ts
import { isToolAllowed, MCP_READ_TOOLS, MCP_DRAFT_TOOLS, MCP_PUBLISH_TOOLS, forceClientScope } from './scope';

export type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
export type ToolExec = (
  name: string, args: Record<string, unknown>,
) => Promise<{ success: boolean; error?: string; action_summary?: string; summary?: unknown; items?: unknown }>;

export interface McpDeps {
  clientSlug: string;
  clientName: string;
  exec: ToolExec;
  onCall?: (name: string, ok: boolean) => void;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/mcp/protocol.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/protocol.ts worker/src/mcp/protocol.test.ts
git commit -m "feat: MCP JSON-RPC dispatcher (initialize/tools) with forced scope"
```

---

## Task 7: Route `/mcp/:slug` with auth + audit; mount in index

**Files:**
- Create: `worker/src/routes/mcp.ts`
- Modify: `worker/src/index.ts` (mount before `/api/*` auth middleware, near line 41)

**Interfaces:**
- Consumes: `getActiveMcpTokenByHash`, `touchMcpTokenUsage` (Task 5); `hashMcpToken`, `timingSafeEqualHex` (Task 3); `handleMcpRpc` (Task 6); `executeTool` (existing, `../routes/ai`); `getClientById`, `writeAuditLog` (existing `../db/queries`).
- Produces: mounted route handling `POST /mcp/:slug`.

- [ ] **Step 1: Write the route**

Create `worker/src/routes/mcp.ts`:

```ts
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { executeTool } from './ai';
import { getClientById, getClientBySlug, writeAuditLog } from '../db/queries';
import { getActiveMcpTokenByHash, touchMcpTokenUsage } from '../db/mcp-queries';
import { hashMcpToken } from '../mcp/tokens';
import { handleMcpRpc, type JsonRpc } from '../mcp/protocol';
import { resolveAgentOpenAiKey } from './ai';

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
  try { rpc = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  c.executionCtx.waitUntil(touchMcpTokenUsage(c.env.DB, tokenRow.id));

  const actor: SessionData = {
    userId: `mcp:${tokenRow.id}`,
    email: `mcp+${client.slug}@webxni`,
    role: 'agent',
  } as unknown as SessionData;

  const openAiKey = await resolveAgentOpenAiKey(c.env);

  const response = await handleMcpRpc(rpc, {
    clientSlug: client.slug,
    clientName: client.canonical_name,
    exec: async (name, args) => executeTool(
      name, args, c.env, actor, `https://marketing.webxni.com`, c.executionCtx, openAiKey,
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
```

> Note: confirm `SessionData` field names by reading `worker/src/types.ts`; adjust the `actor` object to the real shape (the existing `INTERNAL_AGENT_USER` in `worker/src/routes/ai.ts` is the reference — copy its shape). If `resolveAgentOpenAiKey` is not exported, export it from `ai.ts`.

- [ ] **Step 2: Verify SessionData shape + export helper**

Run: `grep -n 'INTERNAL_AGENT_USER =' worker/src/routes/ai.ts` and `grep -n 'interface SessionData' worker/src/types.ts`
Action: Make the `actor` object match `INTERNAL_AGENT_USER` exactly. Ensure `resolveAgentOpenAiKey` and `executeTool` are exported from `ai.ts` (executeTool already is).

- [ ] **Step 3: Mount route in `worker/src/index.ts`**

After the line `app.route('/media', publicAssetRoutes);` (~line 41), add:

```ts
import { mcpRoutes } from './routes/mcp';
// ...
app.route('/mcp', mcpRoutes); // per-client MCP; self-authenticates via bearer token
```

(Place the import with the other route imports at the top; place the `app.route('/mcp', …)` BEFORE `app.use('/api/*', authMiddleware)` so it is not subject to session auth.)

- [ ] **Step 4: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: exit 0. Fix any `SessionData` mismatch until clean.

- [ ] **Step 5: Deploy + smoke test isolation**

```bash
CLOUDFLARE_API_TOKEN=$TOK npx wrangler deploy
# no token → 401
curl -s -X POST https://marketing.webxni.com/mcp/golden-touch-roofing -d '{}' | head
```
Expected: `{"error":"Missing bearer token"}`. (Full call tested after Task 8 provisions a token.)

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/mcp.ts worker/src/index.ts
git commit -m "feat: /mcp/:slug route with token auth, forced scope, audit"
```

---

## Task 8: Provision tokens + enable MCP for active clients

**Files:**
- Create: `scripts/provision-client-mcp-tokens.mjs`

**Interfaces:**
- Consumes: prod D1 (`webxni_db`) via wrangler; `client_mcp_tokens`, `clients.mcp_enabled`.
- Produces: one active token per active client (printed once), `mcp_enabled=1` for active clients.

- [ ] **Step 1: Write provisioning as SQL-through-wrangler helper**

Create `scripts/provision-client-mcp-tokens.mjs`:

```js
#!/usr/bin/env node
// Provisions one MCP token per ACTIVE client and enables MCP for them.
// Usage: CLOUDFLARE_API_TOKEN=... node scripts/provision-client-mcp-tokens.mjs
import { execFileSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';

const DB = 'webxni_db';
const d1 = (sql) => JSON.parse(execFileSync('npx', [
  'wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));

const genToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  const b64 = Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `wxmcp_${b64}`;
};
const sha256hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

const clients = d1("SELECT id, slug FROM clients WHERE status='active' ORDER BY slug;")[0].results;
for (const cl of clients) {
  const has = d1(`SELECT COUNT(*) n FROM client_mcp_tokens WHERE client_id='${cl.id}' AND active=1;`)[0].results[0].n;
  d1(`UPDATE clients SET mcp_enabled=1 WHERE id='${cl.id}';`);
  if (has > 0) { console.log(`${cl.slug}: already has an active token (skipped)`); continue; }
  const token = genToken();
  const hash = await sha256hex(token);
  const prefix = token.slice(0, 8);
  d1(`INSERT INTO client_mcp_tokens (client_id, token_hash, token_prefix, label) VALUES ('${cl.id}','${hash}','${prefix}','initial');`);
  console.log(`${cl.slug}: ${token}`);
}
console.log('\nStore these tokens now — they are not recoverable.');
```

- [ ] **Step 2: Run provisioning**

Run: `CLOUDFLARE_API_TOKEN=$TOK node scripts/provision-client-mcp-tokens.mjs`
Expected: one `slug: wxmcp_…` line per active client. Save the output securely.

- [ ] **Step 3: Smoke-test a real workspace**

```bash
curl -s -X POST https://marketing.webxni.com/mcp/golden-touch-roofing \
  -H "Authorization: Bearer <golden-touch token>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 500
```
Expected: JSON with a `tools` array; `delete_client_profile` absent.

Then verify isolation (wrong slug for that token):
```bash
curl -s -X POST https://marketing.webxni.com/mcp/elite-team-builders \
  -H "Authorization: Bearer <golden-touch token>" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: `{"error":"Workspace not available"}` (403).

- [ ] **Step 4: Commit**

```bash
git add scripts/provision-client-mcp-tokens.mjs
git commit -m "feat: provision per-client MCP tokens for active clients"
```

---

## Task 9: Publish limits + media guardrail (pure logic)

**Files:**
- Create: `worker/src/mcp/limits.ts`
- Test: `worker/src/mcp/limits.test.ts`

**Interfaces:**
- Consumes: `ClientMcpLimitRow` (Task 2).
- Produces:
  - `platformCategory(platform: string): 'blog' | 'gbp' | 'social'`.
  - `counterKey(clientId: string, bucket: string, dateIso: string): string`.
  - `capFor(limits: ClientMcpLimitRow, category: 'blog'|'gbp'|'social'): number`.
  - `type PublishDecision = { allowed: boolean; reason?: string }`.
  - `decidePublish(input: { category: 'blog'|'gbp'|'social'; usedForCategory: number; usedForPlatform: number; limits: ClientMcpLimitRow; hasDeliveredMedia: boolean; isMedia: boolean }): PublishDecision`.

- [ ] **Step 1: Write the failing test**

Create `worker/src/mcp/limits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { platformCategory, capFor, decidePublish } from './limits';

const limits = { client_id: 'c', social_per_day: 10, per_platform_per_day: 3, blog_per_day: 2, gbp_per_day: 5, updated_at: 0 };

describe('mcp limits', () => {
  it('categorizes platforms', () => {
    expect(platformCategory('website_blog')).toBe('blog');
    expect(platformCategory('google_business')).toBe('gbp');
    expect(platformCategory('facebook')).toBe('social');
  });

  it('caps per category', () => {
    expect(capFor(limits, 'blog')).toBe(2);
    expect(capFor(limits, 'gbp')).toBe(5);
    expect(capFor(limits, 'social')).toBe(10);
  });

  it('allows under caps with media delivered', () => {
    const d = decidePublish({ category: 'social', usedForCategory: 1, usedForPlatform: 0, limits, hasDeliveredMedia: true, isMedia: true });
    expect(d.allowed).toBe(true);
  });

  it('blocks over category cap', () => {
    const d = decidePublish({ category: 'blog', usedForCategory: 2, usedForPlatform: 0, limits, hasDeliveredMedia: true, isMedia: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/daily/i);
  });

  it('blocks over per-platform cap', () => {
    const d = decidePublish({ category: 'social', usedForCategory: 4, usedForPlatform: 3, limits, hasDeliveredMedia: false, isMedia: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/platform/i);
  });

  it('blocks media post without delivered asset', () => {
    const d = decidePublish({ category: 'social', usedForCategory: 0, usedForPlatform: 0, limits, hasDeliveredMedia: false, isMedia: true });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/designer|asset/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && npx vitest run src/mcp/limits.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `worker/src/mcp/limits.ts`:

```ts
import type { ClientMcpLimitRow } from '../types';

export type Category = 'blog' | 'gbp' | 'social';
export type PublishDecision = { allowed: boolean; reason?: string };

export function platformCategory(platform: string): Category {
  if (platform === 'website_blog' || platform === 'blog') return 'blog';
  if (platform === 'google_business' || platform.startsWith('gbp')) return 'gbp';
  return 'social';
}

export function counterKey(clientId: string, bucket: string, dateIso: string): string {
  return `mcp:pub:${clientId}:${bucket}:${dateIso}`;
}

export function capFor(limits: ClientMcpLimitRow, category: Category): number {
  if (category === 'blog') return limits.blog_per_day;
  if (category === 'gbp') return limits.gbp_per_day;
  return limits.social_per_day;
}

export function decidePublish(input: {
  category: Category;
  usedForCategory: number;
  usedForPlatform: number;
  limits: ClientMcpLimitRow;
  hasDeliveredMedia: boolean;
  isMedia: boolean;
}): PublishDecision {
  if (input.isMedia && !input.hasDeliveredMedia) {
    return { allowed: false, reason: 'Media posts require a delivered designer asset before auto-publishing.' };
  }
  if (input.usedForCategory >= capFor(input.limits, input.category)) {
    return { allowed: false, reason: `Daily ${input.category} publish limit reached.` };
  }
  if (input.category === 'social' && input.usedForPlatform >= input.limits.per_platform_per_day) {
    return { allowed: false, reason: 'Daily per-platform publish limit reached.' };
  }
  return { allowed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && npx vitest run src/mcp/limits.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/limits.ts worker/src/mcp/limits.test.ts
git commit -m "feat: MCP publish-limit + media guardrail decision logic"
```

---

## Task 10: Enforce limits in the publish path

**Files:**
- Modify: `worker/src/mcp/protocol.ts` (add publish guard hook)
- Modify: `worker/src/routes/mcp.ts` (supply the guard using KV + D1)
- Test: `worker/src/mcp/protocol.test.ts` (add a guard test)

**Interfaces:**
- Consumes: `isPublishTool` (Task 4); `decidePublish`, `platformCategory`, `counterKey`, `capFor` (Task 9); `getClientMcpLimits` (Task 5).
- Produces: `McpDeps.publishGuard?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>`; when a publish tool is denied, `handleMcpRpc` returns `isError:true` and does NOT call `exec`.

- [ ] **Step 1: Add guard test to `worker/src/mcp/protocol.test.ts`**

```ts
it('publish tool blocked by guard does not call exec', async () => {
  let called = false;
  const res: any = await handleMcpRpc(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'publish_post', arguments: {} } },
    {
      clientSlug: 'acme', clientName: 'Acme',
      exec: async () => { called = true; return { success: true }; },
      publishGuard: async () => ({ allowed: false, reason: 'Daily limit reached.' }),
    } as any,
  );
  expect(called).toBe(false);
  expect(res.result.isError).toBe(true);
  expect(res.result.content[0].text).toMatch(/Daily limit/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/mcp/protocol.test.ts`
Expected: FAIL (publishGuard not honored).

- [ ] **Step 3: Wire the guard into `handleMcpRpc`**

In `worker/src/mcp/protocol.ts`, extend `McpDeps` with `publishGuard?: (name: string, args: Record<string, unknown>) => Promise<{ allowed: boolean; reason?: string }>;` and import `isPublishTool`. In `tools/call`, after `forceClientScope` and before `deps.exec`:

```ts
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
```

Update the `import { isToolAllowed, ... } from './scope'` line to also import `isPublishTool`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npx vitest run src/mcp/protocol.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Supply the guard in `worker/src/routes/mcp.ts`**

Add imports:

```ts
import { getClientMcpLimits } from '../db/mcp-queries';
import { decidePublish, platformCategory, counterKey, capFor } from '../mcp/limits';
```

Before building the `handleMcpRpc` call, add a guard that reads the KV counters and the post's media/platforms. Insert into the `handleMcpRpc(rpc, { … })` deps object:

```ts
publishGuard: async (_name, args) => {
  const limits = await getClientMcpLimits(c.env.DB, client.id);
  const today = new Date().toISOString().slice(0, 10);
  // Determine target platform + whether media, from the post being published.
  const postId = String((args.post_id ?? args.id ?? '') || '');
  let platform = String(args.platform ?? '');
  let isMedia = false;
  let hasDeliveredMedia = false;
  if (postId) {
    const row = await c.env.DB.prepare(
      'SELECT platforms, content_type, asset_delivered FROM posts WHERE id = ? AND client_id = ?',
    ).bind(postId, client.id).first<{ platforms: string | null; content_type: string | null; asset_delivered: number | null }>();
    if (row) {
      if (!platform) { try { platform = (JSON.parse(row.platforms ?? '[]')[0] ?? ''); } catch { platform = ''; } }
      isMedia = row.content_type === 'image' || row.content_type === 'video' || row.content_type === 'reel';
      hasDeliveredMedia = row.asset_delivered === 1;
    }
  }
  const category = platformCategory(platform || 'facebook');
  const kv = c.env.KV_BINDING;
  const catKey = counterKey(client.id, category, today);
  const platKey = counterKey(client.id, `plat:${platform}`, today);
  const usedForCategory = Number((await kv.get(catKey)) ?? '0');
  const usedForPlatform = Number((await kv.get(platKey)) ?? '0');
  const decision = decidePublish({ category, usedForCategory, usedForPlatform, limits, hasDeliveredMedia, isMedia });
  if (decision.allowed) {
    // Optimistically reserve a slot; TTL ~2 days so counters self-expire.
    await kv.put(catKey, String(usedForCategory + 1), { expirationTtl: 172800 });
    await kv.put(platKey, String(usedForPlatform + 1), { expirationTtl: 172800 });
  }
  return decision;
},
```

> Note: confirm the KV binding name in `worker/wrangler.toml` (the deploy output showed `env.KV_BINDING`). If different, use that binding.

- [ ] **Step 6: Typecheck + deploy**

Run: `cd worker && npx tsc --noEmit` (expect 0), then `cd .. && CLOUDFLARE_API_TOKEN=$TOK npx wrangler deploy`.

- [ ] **Step 7: Commit**

```bash
git add worker/src/mcp/protocol.ts worker/src/mcp/protocol.test.ts worker/src/routes/mcp.ts
git commit -m "feat: enforce per-client publish caps + media guardrail in MCP"
```

---

## Task 11: MCP resources (client context)

**Files:**
- Create: `worker/src/mcp/resources.ts`
- Modify: `worker/src/mcp/protocol.ts` (handle `resources/list`, `resources/read`)
- Test: `worker/src/mcp/resources.test.ts`

**Interfaces:**
- Produces:
  - `MCP_RESOURCE_DEFS: Array<{ uri: string; name: string; mimeType: string }>` for `client://profile|offers|events|approved-content|keywords`.
  - `buildResource(uri: string, ctx: { db: D1Database; clientId: string }): Promise<{ uri: string; mimeType: string; text: string } | null>`.
- Consumes in protocol: `MCP_RESOURCE_DEFS`, `buildResource`.

- [ ] **Step 1: Write the failing test (list only; read is D1-bound, verified via deploy)**

Create `worker/src/mcp/resources.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MCP_RESOURCE_DEFS } from './resources';

describe('mcp resources', () => {
  it('exposes the five client resources', () => {
    const uris = MCP_RESOURCE_DEFS.map((r) => r.uri);
    expect(uris).toEqual([
      'client://profile', 'client://offers', 'client://events',
      'client://approved-content', 'client://keywords',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/mcp/resources.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `worker/src/mcp/resources.ts`**

```ts
export const MCP_RESOURCE_DEFS = [
  { uri: 'client://profile', name: 'Business profile', mimeType: 'application/json' },
  { uri: 'client://offers', name: 'Active offers', mimeType: 'application/json' },
  { uri: 'client://events', name: 'Events', mimeType: 'application/json' },
  { uri: 'client://approved-content', name: 'Approved content library', mimeType: 'application/json' },
  { uri: 'client://keywords', name: 'Keywords + internal links', mimeType: 'application/json' },
];

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...binds).all<T>();
  return r.results ?? [];
}

export async function buildResource(
  uri: string, ctx: { db: D1Database; clientId: string },
): Promise<{ uri: string; mimeType: string; text: string } | null> {
  const { db, clientId } = ctx;
  let data: unknown;
  switch (uri) {
    case 'client://profile': {
      const client = await db.prepare(
        'SELECT canonical_name, industry, state, phone, cta_text, brand_json, website_url, wp_base_url FROM clients WHERE id = ?',
      ).bind(clientId).first();
      const services = await all(db, 'SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order', clientId);
      const areas = await all(db, 'SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order', clientId);
      const socials = await all(db, 'SELECT platform, profile_url, username FROM client_platforms WHERE client_id = ?', clientId);
      data = { client, services, areas, socials };
      break;
    }
    case 'client://offers':
      data = await all(db, 'SELECT title, description, cta_text, valid_until FROM client_offers WHERE client_id = ? AND active = 1', clientId);
      break;
    case 'client://events':
      data = await all(db, 'SELECT title, description, valid_until FROM client_events WHERE client_id = ?', clientId);
      break;
    case 'client://approved-content':
      data = await all(db, "SELECT id, title, content_type, master_caption, wp_post_url, publish_date FROM posts WHERE client_id = ? AND status IN ('approved','ready','scheduled','posted') ORDER BY publish_date DESC LIMIT 50", clientId);
      break;
    case 'client://keywords': {
      const keywords = await all(db, "SELECT keyword, kw_type, locality FROM client_keywords WHERE client_id = ? AND status='active'", clientId);
      const links = await all(db, 'SELECT url, anchor_keyword FROM client_internal_links WHERE client_id = ? AND active = 1', clientId);
      data = { keywords, internal_links: links };
      break;
    }
    default:
      return null;
  }
  return { uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) };
}
```

> Note: verify column names `website_url`, `client_events`, `client_offers` against `worker/src/types.ts`/schema; adjust to real columns before deploy (drop any that don't exist).

- [ ] **Step 4: Handle resources in `protocol.ts`**

Extend `McpDeps` with `readResource?: (uri: string) => Promise<{ uri: string; mimeType: string; text: string } | null>;`. Add cases:

```ts
case 'resources/list':
  return ok(rpc.id, { resources: MCP_RESOURCE_DEFS });
case 'resources/read': {
  const uri = String(rpc.params?.uri ?? '');
  const res = deps.readResource ? await deps.readResource(uri) : null;
  if (!res) return err(rpc.id, -32602, `Unknown resource: ${uri}`);
  return ok(rpc.id, { contents: [res] });
}
```

Add `import { MCP_RESOURCE_DEFS } from './resources';` at the top of `protocol.ts`.

In `worker/src/routes/mcp.ts`, add to the deps object:
```ts
readResource: (uri) => buildResource(uri, { db: c.env.DB, clientId: client.id }),
```
and `import { buildResource } from '../mcp/resources';`.

- [ ] **Step 5: Run unit test + typecheck + deploy + verify**

```bash
cd worker && npx vitest run src/mcp/resources.test.ts && npx tsc --noEmit
cd .. && CLOUDFLARE_API_TOKEN=$TOK npx wrangler deploy
curl -s -X POST https://marketing.webxni.com/mcp/golden-touch-roofing \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"client://profile"}}' | head -c 400
```
Expected: JSON profile for Golden Touch only.

- [ ] **Step 6: Commit**

```bash
git add worker/src/mcp/resources.ts worker/src/mcp/resources.test.ts worker/src/mcp/protocol.ts worker/src/routes/mcp.ts
git commit -m "feat: MCP client-context resources"
```

---

## Task 12: MCP prompts

**Files:**
- Create: `worker/src/mcp/prompts.ts`
- Modify: `worker/src/mcp/protocol.ts` (handle `prompts/list`, `prompts/get`)
- Test: `worker/src/mcp/prompts.test.ts`

**Interfaces:**
- Produces:
  - `MCP_PROMPT_DEFS: Array<{ name: string; description: string; arguments: Array<{ name: string; required: boolean }> }>`.
  - `renderPrompt(name: string, args: Record<string, string>, clientName: string): { description: string; messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } | null`.

- [ ] **Step 1: Write the failing test**

Create `worker/src/mcp/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MCP_PROMPT_DEFS, renderPrompt } from './prompts';

describe('mcp prompts', () => {
  it('lists the expected prompts', () => {
    expect(MCP_PROMPT_DEFS.map((p) => p.name)).toEqual([
      'platform-post', 'adapt-ad-for-channel', 'seo-blog', 'gbp-post', 'daily-report',
    ]);
  });
  it('renders a prompt with client + args interpolated', () => {
    const r = renderPrompt('platform-post', { platform: 'instagram', topic: 'roof leaks' }, 'Golden Touch');
    expect(r).not.toBeNull();
    expect(r!.messages[0].content.text).toContain('Golden Touch');
    expect(r!.messages[0].content.text).toContain('instagram');
    expect(r!.messages[0].content.text).toContain('roof leaks');
  });
  it('returns null for unknown prompt', () => {
    expect(renderPrompt('nope', {}, 'X')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npx vitest run src/mcp/prompts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `worker/src/mcp/prompts.ts`**

```ts
type PromptDef = { name: string; description: string; arguments: Array<{ name: string; required: boolean }>; template: (a: Record<string, string>, client: string) => string };

const DEFS: PromptDef[] = [
  {
    name: 'platform-post',
    description: 'Draft a platform-specific social post for this client.',
    arguments: [{ name: 'platform', required: true }, { name: 'topic', required: true }],
    template: (a, client) => `Write a ${a.platform} post for ${client} about "${a.topic}". Match the brand voice, include one clear call to action, and respect ${a.platform} conventions and length.`,
  },
  {
    name: 'adapt-ad-for-channel',
    description: 'Adapt an ad concept to a specific channel.',
    arguments: [{ name: 'channel', required: true }, { name: 'offer', required: true }],
    template: (a, client) => `Adapt this offer for ${client} into a ${a.channel} ad: "${a.offer}". Produce headline, primary text, and CTA suited to ${a.channel}.`,
  },
  {
    name: 'seo-blog',
    description: 'Outline + draft an SEO blog post for this client.',
    arguments: [{ name: 'keyword', required: true }],
    template: (a, client) => `Write an SEO blog post for ${client} targeting the keyword "${a.keyword}". Include title, meta description, H2 outline, and body; weave in the client's services, service areas, and internal links from the workspace resources.`,
  },
  {
    name: 'gbp-post',
    description: 'Draft a Google Business Profile post.',
    arguments: [{ name: 'topic', required: true }],
    template: (a, client) => `Write a Google Business Profile post for ${client} about "${a.topic}". Keep it local, concise, with a LEARN_MORE-style CTA.`,
  },
  {
    name: 'daily-report',
    description: 'Summarize the day\'s marketing actions for this client.',
    arguments: [],
    template: (_a, client) => `Summarize today's created, edited, scheduled, published, and failed marketing actions for ${client} using the get_report tool. Be concise and flag anything that needs human attention.`,
  },
];

export const MCP_PROMPT_DEFS = DEFS.map(({ name, description, arguments: args }) => ({ name, description, arguments: args }));

export function renderPrompt(name: string, args: Record<string, string>, clientName: string) {
  const def = DEFS.find((d) => d.name === name);
  if (!def) return null;
  return {
    description: def.description,
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: def.template(args, clientName) } }],
  };
}
```

- [ ] **Step 4: Handle prompts in `protocol.ts`**

Add `import { MCP_PROMPT_DEFS, renderPrompt } from './prompts';` and cases:

```ts
case 'prompts/list':
  return ok(rpc.id, { prompts: MCP_PROMPT_DEFS });
case 'prompts/get': {
  const name = String(rpc.params?.name ?? '');
  const rendered = renderPrompt(name, (rpc.params?.arguments ?? {}) as Record<string, string>, deps.clientName);
  if (!rendered) return err(rpc.id, -32602, `Unknown prompt: ${name}`);
  return ok(rpc.id, rendered);
}
```

- [ ] **Step 5: Run tests + typecheck + deploy**

Run: `cd worker && npx vitest run && npx tsc --noEmit` (all pass, exit 0); then deploy.

- [ ] **Step 6: Commit**

```bash
git add worker/src/mcp/prompts.ts worker/src/mcp/prompts.test.ts worker/src/mcp/protocol.ts
git commit -m "feat: MCP prompt catalog"
```

---

## Task 13: Daily per-client MCP report (cron)

**Files:**
- Create: `worker/src/mcp/daily-report.ts`
- Modify: the Worker scheduled handler (find with `grep -n "scheduled" worker/src/index.ts`) to call the report once daily.

**Interfaces:**
- Consumes: `audit_logs`, `listClients` (existing).
- Produces: `buildDailyMcpReport(env, dateIso): Promise<Array<{ slug: string; created: number; edited: number; scheduled: number; published: number; failed: number }>>` and `sendDailyMcpReport(env)`.

- [ ] **Step 1: Implement `worker/src/mcp/daily-report.ts`**

```ts
import type { Env } from '../types';
import { listClients } from '../db/queries';
import { discordSend } from '../services/discord';

const CATEGORY_SQL = `
  SELECT
    SUM(CASE WHEN action IN ('mcp.create_content_with_image','mcp.batch_create_content','mcp.generate_content') THEN 1 ELSE 0 END) created,
    SUM(CASE WHEN action IN ('mcp.update_post','mcp.update_blog_post') THEN 1 ELSE 0 END) edited,
    SUM(CASE WHEN action IN ('mcp.create_content_request','mcp.set_post_status') THEN 1 ELSE 0 END) scheduled,
    SUM(CASE WHEN action IN ('mcp.publish_post','mcp.publish_bulk','mcp.publish_blog','mcp.approve_and_publish') AND json_extract(new_value,'$.success')=1 THEN 1 ELSE 0 END) published,
    SUM(CASE WHEN action LIKE 'mcp.%' AND json_extract(new_value,'$.success')=0 THEN 1 ELSE 0 END) failed
  FROM audit_logs
  WHERE entity_type='client' AND entity_id = ? AND action LIKE 'mcp.%'
    AND created_at >= unixepoch(?) AND created_at < unixepoch(?) + 86400`;

export async function buildDailyMcpReport(env: Env, dateIso: string) {
  const clients = await listClients(env.DB, 'active');
  const out: Array<{ slug: string; created: number; edited: number; scheduled: number; published: number; failed: number }> = [];
  for (const cl of clients) {
    const r = await env.DB.prepare(CATEGORY_SQL).bind(cl.id, dateIso, dateIso)
      .first<{ created: number; edited: number; scheduled: number; published: number; failed: number }>();
    const row = { slug: cl.slug, created: r?.created ?? 0, edited: r?.edited ?? 0, scheduled: r?.scheduled ?? 0, published: r?.published ?? 0, failed: r?.failed ?? 0 };
    if (row.created + row.edited + row.scheduled + row.published + row.failed > 0) out.push(row);
  }
  return out;
}

export async function sendDailyMcpReport(env: Env): Promise<void> {
  const dateIso = new Date().toISOString().slice(0, 10);
  const rows = await buildDailyMcpReport(env, dateIso);
  if (!rows.length || !env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID) return;
  const lines = rows.map((r) => `**${r.slug}** — created ${r.created}, edited ${r.edited}, scheduled ${r.scheduled}, published ${r.published}, failed ${r.failed}`);
  await discordSend({
    channelId: env.DISCORD_CHANNEL_ID,
    token: env.DISCORD_BOT_TOKEN,
    embeds: [{ title: `MCP daily report — ${dateIso}`, description: lines.join('\n'), timestamp: new Date().toISOString() }],
  });
}
```

> Note: confirm `discordSend` signature against `worker/src/services/discord.ts` (used in `internal.ts`); match it exactly.

- [ ] **Step 2: Call it from the daily cron**

In the Worker `scheduled` handler, add a branch for the daily cron (the `0 9 * * *` trigger shown in deploy output). Example:

```ts
if (event.cron === '0 9 * * *') {
  ctx.waitUntil(sendDailyMcpReport(env));
}
```
Add `import { sendDailyMcpReport } from './mcp/daily-report';`.

- [ ] **Step 3: Typecheck + deploy**

Run: `cd worker && npx tsc --noEmit` (0), then deploy.

- [ ] **Step 4: Manual trigger check (optional)**

Since the cron fires daily, verify by temporarily calling `sendDailyMcpReport` from an existing authenticated internal route, or wait for the 09:00 run and confirm the Discord embed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp/daily-report.ts worker/src/index.ts
git commit -m "feat: daily per-client MCP action report to Discord"
```

---

## Task 14: Per-client config/discovery page

**Files:**
- Create: `worker/src/routes/mcp-config.ts`
- Modify: `worker/src/index.ts` (mount `/mcp-config` under existing auth, admin-only)

**Interfaces:**
- Consumes: `getClientBySlug` (existing), `client_mcp_tokens` (prefix only).
- Produces: `GET /api/clients/:slug/mcp-config` returning the connection snippet (URL + how to add), never the raw token.

- [ ] **Step 1: Implement the route**

Create `worker/src/routes/mcp-config.ts`:

```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { getClientBySlug } from '../db/queries';

export const mcpConfigRoutes = new Hono<{ Bindings: Env }>();

mcpConfigRoutes.get('/:slug/mcp-config', async (c) => {
  const slug = c.req.param('slug');
  const client = await getClientBySlug(c.env.DB, slug);
  if (!client) return c.json({ error: 'Client not found' }, 404);
  const url = `https://marketing.webxni.com/mcp/${slug}`;
  const tokenInfo = await c.env.DB.prepare(
    'SELECT token_prefix, active, last_used_at FROM client_mcp_tokens WHERE client_id = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(client.id).first();
  return c.json({
    url,
    enabled: (client as any).mcp_enabled === 1,
    token: tokenInfo ? { prefix: `${(tokenInfo as any).token_prefix}…`, active: (tokenInfo as any).active === 1, last_used_at: (tokenInfo as any).last_used_at } : null,
    config_snippet: {
      mcpServers: {
        [`webxni-${slug}`]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer ${WEBXNI_MCP_TOKEN}'],
        },
      },
    },
    note: 'Set WEBXNI_MCP_TOKEN to the token issued for this client. The raw token is only shown at provisioning time.',
  });
});
```

- [ ] **Step 2: Mount under authenticated API in `worker/src/index.ts`**

After the other `app.route('/api/clients', …)` lines add:

```ts
import { mcpConfigRoutes } from './routes/mcp-config';
// ...
app.route('/api/clients', mcpConfigRoutes);
```

- [ ] **Step 3: Typecheck + deploy + verify (authenticated)**

Run typecheck (0), deploy, then GET `/api/clients/golden-touch-roofing/mcp-config` with a valid admin session; expect the URL + snippet, prefix only, no raw token.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/mcp-config.ts worker/src/index.ts
git commit -m "feat: per-client MCP config/discovery endpoint"
```

---

## Final verification

- [ ] `cd worker && npm test` — all vitest suites pass.
- [ ] `cd worker && npx tsc --noEmit` — exit 0.
- [ ] Isolation: a token for client A returns 403 on `/mcp/<clientB>`; `tools/call` with `{client:"other"}` still acts on A only (check `audit_logs`).
- [ ] Allowlist: `tools/list` excludes destructive/credential tools; calling one returns `isError`.
- [ ] Limits: publishing past the daily cap returns the limit message and does not post.
- [ ] Media guardrail: an image post with `asset_delivered=0` is blocked from auto-publish.
- [ ] Audit: each call appears in `audit_logs` as `mcp.<tool>`.
- [ ] `git push` and confirm deploy version.

## Self-Review notes (author)

- Spec coverage: §3 flow → Tasks 6/7; §4 auth/isolation → Tasks 2/3/5/7 + provisioning 8; §5 tools/resources/prompts → Tasks 6/11/12; §6 governance → Tasks 9/10; §7 policy note → caps=0 supported via `client_mcp_limits`; §8 audit/report → Tasks 7/13; §9 rollout is the task order; §10 testing → per-task tests + Final verification.
- Known verification-required assumptions (flagged inline): `SessionData` shape, KV binding name, `discordSend` signature, `resolveAgentOpenAiKey` export, and exact columns for `client_offers`/`client_events`/`website_url`. Each has a Note telling the implementer to confirm against the codebase before deploy.
