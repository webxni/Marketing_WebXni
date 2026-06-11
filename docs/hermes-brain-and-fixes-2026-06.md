# Hermes-as-Brain + Platform/Generation Fixes — June 2026

Session review of three reported issues plus hardening of the Hermes-first
agency backend. Read alongside `agency-operating-system.md` and
`agency-security-model.md`.

---

## 1. Wrong Facebook target (Nova Home Builders → Caliview's page)

### Root cause
Posting sends `facebook_page_id` from `client_platforms.page_id` for the post's
client (`worker/src/modules/posting.ts:27`), under `client.upload_post_profile`.
If a client's stored Facebook `page_id` (or `account_id`) points at another
client's page, posts land on the wrong account.

The **Refresh / "Sync Upload-Post"** button
(`POST /api/clients/:slug/platforms/sync-upload-post` →
`syncUploadPostClientPlatforms`) was **non-destructive by design**: it used
`COALESCE(?, page_id)` and only ran the UPDATE when a field was *blank*
(`hasBetterData = value && !existing`). So it could **never correct an
already-populated but wrong ID** — it only filled blanks. That's why clicking
Refresh did not fix Nova on its own.

### Fix (this session)
Added a **Force re-sync** mode that overwrites stored IDs with the current live
Upload-Post values when they differ:

- `syncUploadPostClientPlatforms(env, { force: true })` — computes `hasChange`
  (live value present **and** differs from stored) and runs the overwrite.
- Route `sync-upload-post` accepts `{ force: true }` and audits it.
- Frontend client page has a **Force re-sync** button (with confirm) next to the
  normal **Sync Upload-Post** button. Normal sync still only fills blanks.

Files: `worker/src/modules/uploadpost-platform-sync.ts`,
`worker/src/routes/clients.ts`, `frontend/src/lib/api/clients.ts`,
`frontend/src/routes/(app)/clients/[slug]/+page.svelte`.

### Operator action for Nova
1. Confirm Nova's Facebook page is connected correctly in the Upload-Post
   account for Nova's `upload_post_profile`.
2. On Nova's client page → platforms → click **Force re-sync**. This pulls the
   current `page_id`/`account_id` from Upload-Post and overwrites the stale one.
3. If Nova and Caliview accidentally share the same `upload_post_profile`, that
   must be corrected first (profiles must be distinct per client) — force re-sync
   only fixes the per-platform IDs, not a shared profile.

---

## 2. Generated posts with no content / per-client "template" not applied

### Root cause
The agency Social Copy + Blog paths generated drafts from only the thin
`snapshot.coverage` client object — **not** the client's `client_intelligence`
(brand voice, services, service areas, approved CTAs, forbidden terms). The
`socialWeeklyBatch` prompt told the model to "use the client's REAL services"
but those were never in the prompt → generic or empty captions. And
`/internal/agency/draft-post` saved whatever it received with **no empty-content
guard**, so contentless drafts were persisted.

"Template per client" = the client's **brand voice / intelligence brief** (same
fields the weekly OpenAI/terminal path uses).

### Fix (this session)
- New `getAgencyClientContentBrief(db, clientId)` in `worker/src/db/queries.ts`
  builds a compact brief from `clients` + `client_intelligence` +
  `client_service_areas` + `client_services` + `client_restrictions`, and
  returns `{ brief, hasBrief }`. `hasBrief` is false when only the business name
  exists (no voice/services/areas) — not enough to generate quality content.
- New internal endpoint `GET /internal/agency/client-brief/:clientId`.
- The agency runner (`scripts/run-approved-agency-job.mjs`) fetches the brief per
  client for **social-copy** and **blog-writer**, **skips clients with no
  brief** (logs "needs client research/intelligence first"), and injects the
  brief into the prompt.
- `buildAgencyPrompt` surfaces it as a labeled **CLIENT CONTENT BRIEF** block
  (`scripts/lib/agency-agent-prompts.mjs`).
- **Empty-content guard** added in `/internal/agency/draft-post`
  (`worker/src/routes/agency.ts`): blogs need body text; other types need a
  master caption or ≥1 platform caption. Empty → logged + skipped, never saved.
  Runner also skips empty AI output before posting (defense in depth).

### Operator note
Clients with no `client_intelligence` (e.g. brand voice / services) will now be
**skipped** by the agency social/blog agents rather than producing empty drafts.
Run client research → strategy first, or fill the client's intelligence profile.

---

## 3. Hermes as the brain of the system

### Reality discovered
- Hermes CLI **v0.16.0 is installed** at `~/.local/bin/hermes`.
- It is authenticated via **OpenAI Codex (OAuth), model `gpt-5.4-mini`**. No
  Anthropic/OpenAI API keys are set (`hermes status`).
- All 8 `webxni-*` agency skills are **installed and enabled** in Hermes.
- Migration `0042_agency_backend_hermes_first.sql` + the `backend_priority`
  arrays in `routes/agency.ts`, `routes/discord.ts`, `loader/agency-scheduler.ts`
  already route every agent **`['hermes', …]` first**.

### The bug that made Hermes never actually run
`runHermes` in `scripts/lib/terminal-json-agent.mjs` **hard-forced**
`--provider anthropic --model claude-3-5-sonnet-20241022` on every call. Hermes
has **no Anthropic credentials**, so every Hermes attempt failed auth and
silently fell through to Claude/Codex/OpenAI. Hermes was "first" on paper but
**never executed** — a likely contributor to the agency dashboard's recurring
"backend fallback used" / timeout findings.

### Fix (this session)
`runHermes` now only passes `--provider`/`--model` when `HERMES_PROVIDER` /
`HERMES_MODEL` / `HERMES_BLOG_MODEL` env vars are set. Otherwise it lets Hermes
use its own authenticated default (`gpt-5.4-mini` via OpenAI Codex).

### Verified end-to-end
- `hermes -z '...json...'` returns clean JSON to stdout, exit 0, no chrome.
- Running the real `runTerminalJsonAgent({ preferredBackend:['hermes',…],
  skills:['webxni-social-copywriter'] })` returns
  `BACKEND: hermes | fallback_used: false` with valid schema JSON. Confirmed
  Hermes is now the true executor.

### Optional overrides (env, on the bot host / PM2 env)
- `HERMES_PROVIDER`, `HERMES_MODEL`, `HERMES_BLOG_MODEL` — force a specific
  provider/model only if you want something other than Hermes's configured
  default.
- `AGENCY_TERMINAL_AGENT=hermes` — pin every agency call to Hermes (no fallback
  chain) for debugging.

### Future work for a true "orchestrator brain"
Not built this session (scope = verify & harden). To make Hermes decompose work
and delegate to gemini/claude as sub-agents, add an orchestration step that
runs a planning Hermes call → emits sub-tasks → dispatches each to the
appropriate backend. Keep it inside the approved-job/whitelist model
(`agency-security-model.md`): no user-supplied shell, fixed command names only.

---

## Deploy steps for this session's changes

```bash
# 1. Worker type check (clean)
cd worker && npx tsc --noEmit

# 2. Frontend check + build
cd frontend && npm run check && npm run build

# 3. Run migration 0042 (Hermes-first backend priority) if not already applied
npx wrangler d1 execute webxni-db \
  --file=db/migrations/0042_agency_backend_hermes_first.sql --remote

# 4. Commit + push (GitHub Actions deploys the Worker + frontend)
git add -A && git commit -m "..." && git push

# 5. Restart the local Discord bot so the runner picks up the .mjs changes
pm2 restart webxni-bot
```

> The `scripts/` runner changes (Hermes provider fix, content brief, empty-content
> guards) run **on the bot host**, not in the Worker — they take effect on
> `pm2 restart webxni-bot`, independent of the Cloudflare deploy.

## Cloudflare token note
The Cloudflare deploy uses the `CLOUDFLARE_API_TOKEN` GitHub secret (Workers + D1
+ R2 + KV). Cloudflare's "Workers Builds" auto-deploy is intentionally disabled —
do not re-enable it (causes duplicate races / rolled-token failures). See
`AGENTS.md` → Deploy.
