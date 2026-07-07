# Per-Client MCP Workspaces — Design Spec

**Date:** 2026-07-07
**Status:** Approved (design); pending implementation plan
**Scope:** Active clients only (12 at time of writing)

## 1. Goal

Give each active client its own **secure, multi-tenant MCP endpoint** so external
AI agents (Claude, Codex, other assistants) can manage that client's marketing —
and *only* that client's marketing. Each per-client MCP exposes the client's
business context, approved content, and content-creation/publishing tools, under
enforced permission rules, publishing limits, full audit, and a daily report.

This is an **isolation + scoping + governance layer** over the app's existing
`executeTool` surface (~50 tools) — not a rebuild of the tools.

## 2. Decisions (locked)

- **Trust boundary:** External per-client access (multi-tenant). Each client gets
  a revocable credential to a workspace locked to their `client_id`.
- **Publish authority:** Auto-publish **within limits** (a deliberate change from
  the prior "every post Marvin+designer gated" policy — see §7 risk note).
- **Hosting/isolation (Approach A):** Native MCP endpoint on the existing
  Cloudflare Worker. No new dependency, no Durable Objects.
- **Endpoint shape:** `https://marketing.webxni.com/mcp/<clientname>` on the
  existing app domain — **no DNS/custom-domain step**. `mcp.webxni.com` can be
  aliased later with no code change. Handle = client slug (vanity handles optional
  later).

## 3. Architecture & request flow

New route: `ALL /mcp/:slug` on the Worker, speaking **MCP Streamable HTTP**
(JSON-RPC 2.0 over POST; SSE optional for streaming). Self-contained; no changes
to existing `/api/*` or `/internal/*` routes.

```
request → auth (Bearer token → client_id) → path check (:slug == token client)
       → governance (tool allowlist + publish limits + kill switch)
       → executeTool(tool, args) with client_id FORCED from token
       → audit_logs
       → JSON-RPC response
```

Clients connect natively or via:
`npx mcp-remote https://marketing.webxni.com/mcp/<clientname> --header "Authorization: Bearer <token>"`

## 4. Auth & tenant isolation (security core)

New table `client_mcp_tokens`:

| column | notes |
|--------|-------|
| id | pk |
| client_id | FK clients(id) ON DELETE CASCADE |
| token_hash | SHA-256 of the token; raw token shown once at provisioning |
| token_prefix | first chars, for display/lookup |
| label | e.g. "Client-facing agent", "VA-Maria" |
| active | 1/0 kill switch |
| created_at, last_used_at, expires_at, revoked_at | lifecycle |

Rules:
- The resolved `client_id` comes **only** from the token. Every tool call is
  forced to that client; any `client`/`slug`/`client_id` argument a tenant passes
  is ignored/overridden. Cross-client access is structurally impossible.
- `:slug` in the path must resolve to the same client as the token, else `403`.
- Token comparison is **timing-safe** (consistent with existing admin-token
  handling). Only the hash is stored.
- Revocation (`active=0`), expiry, and a per-client `mcp_enabled` flag are checked
  on every call.

## 5. Tenant surface: tools / resources / prompts

**Tools — allowlist ONLY** (mapped to existing `executeTool`):
- *Read/context:* `get_client_details`, `get_posts`, `get_queue`, `get_report`,
  `list_client_topics`, `list_content_requests`
- *Draft/create:* `generate_content`, `create_content_with_image`,
  `batch_create_content`, `generate_captions`, `add_client_topics`,
  `create_content_request`, `update_post`, `update_blog_post`, `create_offer`,
  `create_event`, `attach_asset_to_post`
- *Publish (governed by §6):* `approve_and_publish`, `publish_post`,
  `publish_bulk`, `publish_blog`, `set_post_status`

**Never exposed to tenants** (admin/credential/cross-client/destructive):
`create_client_profile`, `delete_client_profile`, `update_client_platforms`,
`sync_upload_post_platforms` (hold Upload-Post credentials), `delete_post`,
`delete_client_service`, `delete_client_area`, `delete_client_platform`,
`bulk_update_posts` (destructive form), `resume_generation_run`, system/internal
tools. The allowlist is defined in one place and enforced server-side.

**Resources (read-only context):**
- `client://profile` — business profile, services, locations, brand voice,
  website, social links
- `client://offers`, `client://events`
- `client://approved-content` — approved posts/captions/blogs/GBP posts
- `client://keywords` — keywords + internal links (SEO)

**Prompts (industry-flavored from blog-templates / client-expertise):**
`platform-post`, `adapt-ad-for-channel`, `seo-blog`, `gbp-post`, `daily-report`.

## 6. Governance: permissions, approval, limits

- **Publish caps per client/day** (defaults, all tunable per client in a new
  `client_mcp_limits` table): 10 social, 3 per-platform, 2 blog, 5 GBP.
- Enforced via **KV date-counters** keyed by `client_id + platform + YYYY-MM-DD`,
  checked **before** any publish tool runs. Over-limit → the post is routed to
  `pending_approval` (drafted) instead of publishing, and the response says so.
- **Media guardrail:** image/video posts require a **delivered designer asset**
  (`asset_delivered=1`) to auto-publish; text-only can auto-publish within caps.
  Keeps brand imagery human-gated.
- **Content safety reuse:** existing blog preflight/quality gate + platform
  compatibility checks still apply. Forced client scope prevents wrong-client
  content (cf. prior Unlock'D Pros incident).
- **Kill switch:** per-client `mcp_enabled` flag + token revocation = instant
  shutoff.

## 7. Risk note — policy change

Enabling auto-publish for external tenants departs from the established
"every post stays Marvin+designer gated / no auto-posting" policy. Mitigations:
per-day/per-platform caps, media-asset gate, full audit, instant revocation,
forced client scope, restricted allowlist. Marvin can revert any client to
draft-only by setting its caps to 0 (all publishing then routes to
`pending_approval`).

## 8. Audit & daily report

- **Audit:** every tenant call writes `audit_logs` (`action=mcp.<tool>`,
  `entity_type`/`entity_id`, actor = token label/id, `ip`). Reuses the existing
  table.
- **Daily report:** a scheduled job per active client rolls the day's audit into
  **created / edited / scheduled / published / failed**, reusing
  `dispatch_client_reports` + `get_report`. Delivered **to Marvin only** for now;
  per-client tenant delivery can be enabled later.

## 9. Rollout (active clients only)

- **Phase 1 — Isolation foundation:** `/mcp/:slug` endpoint + `client_mcp_tokens`
  + auth + forced client scope + allowlist + audit. Read/draft tools only. Behind
  a flag. Provision tokens for the 12 active clients.
- **Phase 2 — Governed publishing:** `client_mcp_limits` + KV counters + publish
  tools + media guardrail + kill switch.
- **Phase 3 — Context & reporting:** MCP resources + prompts + daily report + a
  per-client config/discovery page (mirrors the Novamira config page: shows the
  tenant their URL + how to add it).

## 10. Testing

No real posting in tests — Upload-Post mocked.
- **Unit:** token hash/verify (timing-safe); scope-forcing (cross-client arg
  ignored); allowlist rejection (blocked tool → error); limit counter increments +
  cap enforcement; over-limit → draft; media guardrail (no asset → not published);
  audit row written.
- **Integration:** a tenant token can only read/act on its own client; mismatched
  `:slug`/token → 403; revoked/expired token → 401; `mcp_enabled=0` → denied.

## 11. Non-goals (YAGNI)

- No Durable Objects / Agents SDK (Approach B) this round.
- No new social integrations — reuse Upload-Post, GBP, WordPress paths as-is.
- No vanity `mcp.webxni.com` host initially (alias later, no code change).
- No tenant self-service token rotation UI initially (Marvin provisions/revokes).

## 12. Active clients (provisioning targets)

247-lockout-pasadena, 724-locksmith-ca, americas-professional-builders,
caliview-builders, caliview-landscape, daniels-locksmith, elite-team-builders,
golden-touch-roofing, modern-vision-remodeling, nova-home-builders-llc,
unlocked-pros, webxni.

Note: some of these lack stored WordPress publishing credentials (blog tools will
draft but not publish until creds are set) — see the internal-links audit.
