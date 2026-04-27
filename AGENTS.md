# AGENTS.md

Canonical brief for AI collaborators (Claude Code, Codex, Gemini, etc.) working
in this repository. Read this entire file **before** writing code. For setup
and user-facing usage docs, see `README.md`. For Discord bot specifics, see
`BOT.md`.

---

## What this platform is

A production marketing automation SaaS for the WebXni agency. Manages ~9
active client accounts and automates posts to Facebook, Instagram, LinkedIn,
TikTok, Pinterest, Google Business, YouTube, X, Threads, Bluesky, and
WordPress blogs. Plus AI content generation (OpenAI worker path **and**
terminal Claude Code path) with topic research and per-platform captions.

- **Live URL:** https://marketing.webxni.com
- **Stack:** Cloudflare Workers (Hono + TypeScript) + D1 (SQLite) + R2 + KV +
  SvelteKit 2 (Svelte 5 runtime, legacy-syntax components) + TailwindCSS
- **Deploy:** GitHub Actions on push to `main` (single source of truth)
- **External services:** Upload-Post API, WordPress REST, Notion API, OpenAI

---

## Hard rules — do not violate

1. **Additive only.** This is an additive-upgrade project. Preserve existing
   flows, forms, layouts, and patterns. The dark UI, sidebar nav, current page
   structure, and Google-Blue (`#1a73e8`) accent are intentional. Do not
   redesign. Do not "modernize" working code.
2. **No new columns in `db/schema.sql`.** Add a file under `db/migrations/` in
   sequence. **Current sequence: `0029` — next is `0030`.** Use
   `ALTER TABLE ... ADD COLUMN`.
3. **All SQL through `worker/src/db/queries.ts`** with prepared statements
   (`.prepare(...).bind(...)`). No string-interpolated SQL anywhere.
4. **No raw `fetch` in Svelte components.** All API calls go through typed
   wrappers in `frontend/src/lib/api/`.
5. **Svelte 4 legacy syntax** (`bind:value`, `on:click`, `$:`). Not Svelte 5
   runes (`$state`, `$effect`). The codebase runs on the Svelte 5 runtime in
   legacy mode.
6. **Type sync rule.** A new DB column must be added to **both**
   `worker/src/types.ts` and `frontend/src/lib/types.ts`. If it's a settable
   client field, also add it to `CLIENT_WRITABLE_FIELDS` in
   `worker/src/routes/clients.ts`.
7. **Claude weekly content uses terminal Claude Code, not the Anthropic API.**
   See "Content generation flow" below — generation must enqueue an
   `approved_command_jobs` row, never call `planGeneration` for
   `provider: 'claude'`.
8. **No speculative abstractions, no backwards-compat shims, no half-finished
   features, no comments that just describe what the code does.**
9. **Touch the minimum needed.** A bug fix doesn't need surrounding cleanup.
   When in doubt, don't change working code.

---

## Critical modules — do not modify their core logic

These are working in production. Touch only when the task explicitly requires
it.

| Module | File | What it does |
|--------|------|-------------|
| Posting loop | `worker/src/loader/posting-run.ts` | Reads ready posts, runs preflight, submits to Upload-Post |
| Preflight | `worker/src/modules/preflight.ts` | 12-check validation before any post is sent |
| Upload-Post client | `worker/src/services/uploadpost.ts` | API client for upload-post.com |
| Auth middleware | `worker/src/middleware/auth.ts` | Session-based auth via KV |
| Rate limiter | `worker/src/middleware/rateLimit.ts` | Prevents abuse |
| Idempotency | `worker/src/modules/idempotency.ts` | Prevents double-posting |
| Caption mapper | `worker/src/modules/captions.ts` | Maps platform → caption field |
| WordPress service | `worker/src/services/wordpress.ts` | WP REST API client + renderer |
| Notion service | `worker/src/services/notion.ts` | Notion import/export |

---

## Architecture

```
Browser → SvelteKit (Cloudflare Assets)
       ↓ /api/*
Hono router (Cloudflare Worker) → D1 (SQLite) / R2 / KV
       ↓
Upload-Post  |  WordPress REST  |  Notion  |  OpenAI  |  Discord (bot + slash)
```

Background work runs via `ctx.waitUntil()` inside the Worker. Long-lived
Claude generation runs are handled by the **local Discord bot**
(`discord-bot/bot.js`, `pm2: webxni-bot`) which polls the
`approved_command_jobs` queue and spawns `scripts/run-approved-claude-job.mjs`
to invoke the `claude` CLI per slot.

### Cron schedule (`wrangler.toml`)

| Schedule | Trigger |
|----------|---------|
| `0 7 * * SUN` | Sunday 7AM — weekly AI generation (stub: wire to `runGeneration`) |
| `0 2 * * *` | Daily 2AM — fetch real URLs from Upload-Post history |
| `0 */6 * * *` | Every 6h — automated posting check (calls recurring GBP run first, then main posting loop) |

### Cloudflare bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 | Primary database |
| `MEDIA` | R2 | User-uploaded media (designer assets) |
| `IMAGES` | R2 | Generated/system images |
| `KV_BINDING` | KV | Sessions + `settings:system` config |
| `ASSETS` | Static | SvelteKit frontend build |
| `SELF` | Worker service binding | For internal `/internal/gen-step` self-dispatch |

### Cloudflare secrets (set via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| `UPLOAD_POST_API_KEY` | Upload-Post API auth |
| `OPENAI_API_KEY` | AI content generation + topic research |
| `NOTION_API_TOKEN` | Notion import/export |
| `ANTHROPIC_API_KEY` | Optional — only used by the worker-API Claude path. Terminal Claude doesn't need it |

---

## Database (D1 / SQLite)

| Table | Purpose |
|-------|---------|
| `users` | Admin/operator/viewer accounts |
| `clients` | Client accounts (9 active) |
| `client_platforms` | Per-client platform credentials |
| `client_gbp_locations` | ETB's 3 Google Business locations |
| `client_restrictions` | Forbidden terms per client |
| `client_intelligence` | Brand voice, SEO strategy, content angles |
| `client_feedback` | Positive/negative content feedback |
| `client_categories` / `client_services` / `client_service_areas` | Business detail |
| `client_offers` / `client_events` | Recurring GBP offers and events |
| `posts` | All posts (draft → posted lifecycle) |
| `post_platforms` | Per-platform posting status + tracking IDs |
| `post_versions` | Edit history snapshots |
| `assets` | R2 media registry |
| `posting_jobs` / `posting_attempts` | Posting run records and per-attempt logs |
| `generation_runs` | AI content generation run records (incl. `post_slots` plan) |
| `approved_command_jobs` | Whitelisted terminal-job queue (Claude Code etc.) |
| `audit_logs` | All significant actions |
| `packages` | Content packages (posts/mo, freq, platforms, weekly schedule) |
| `wp_templates` | Per-client WordPress template configs |

### Migration rules

1. Never edit `db/schema.sql` to add columns.
2. Write `db/migrations/XXXX_description.sql` with `ALTER TABLE ADD COLUMN` (D1
   uses SQLite syntax). Sequence is currently at `0029`; next is `0030`.
3. Run remotely:
   ```bash
   npx wrangler d1 execute webxni-db --file=db/migrations/XXXX_xxx.sql --remote
   ```
4. Sync `worker/src/types.ts` and `frontend/src/lib/types.ts`.
5. If it's a client-writable field, add to `CLIENT_WRITABLE_FIELDS` in
   `worker/src/routes/clients.ts`.

---

## Post status lifecycle

```
draft → pending_approval → approved → ready → scheduled → posted
                                           ↘ failed
                                           ↘ cancelled
```

Gates before automation can post:

- `ready_for_automation = 1` (all required content fields present)
- `asset_delivered = 1` (designer uploaded the media)
- `status = 'ready'`
- Preflight passes for each platform (12 checks in `preflight.ts`)

---

## Content generation flow

Two providers, two paths. Both use the same prompt builder and the same posts
schema; results are saved by `saveGeneratedSlotResult` in either case.

```
provider: openai                    provider: claude
────────────────                    ────────────────
POST /api/run/generate              POST /api/run/generate
  ↓ planGeneration() (waitUntil)      ↓ prepareGenerationPlan() (sync)
  ↓ /internal/gen-step (per slot)     ↓ createApprovedCommandJob()
  ↓ generateWithOpenAI()              ↓ (worker stops here)
  ↓ saveGeneratedSlotResult()
                                    Local Discord bot polls
                                    `/internal/discord/approved-jobs/claim`
                                      ↓ spawns scripts/run-approved-claude-job.mjs
                                      ↓ which runs `claude -p ...` per slot
                                      ↓ POSTs result back to /save-slot
                                      ↓ saveGeneratedSlotResult()
```

### Resume

`POST /api/run/generate/runs/:id/resume` detects the provider from the slot
plan. For `provider: 'claude'`, it re-queues an `approved_command_jobs` row
(starting at `current_slot_idx`) instead of triggering `/internal/gen-step`.
The bot's `/approved-jobs/:id/context` endpoint resumes from
`current_slot_idx`.

### Topic research

`buildSlotGenerationRequest` runs `researchTopicWithProvider` to attach
non-repetitive, SEO-aware topic + keyword + format to each slot prompt. When
provider is Claude and no Anthropic key is set, **research falls back to
OpenAI** so the prompt sent to terminal Claude still carries research data.

### Approved-jobs queue (security)

Discord must never run arbitrary shell. Only whitelisted `command_name`
values are accepted by the bot runner:

- `weekly_content_claude` → `scripts/run-approved-claude-job.mjs`
- `regenerate_content_claude` → `scripts/run-approved-claude-job.mjs`

Whitelist is enforced in `discord-bot/bot.js`, `worker/src/routes/discord.ts`,
and `worker/src/db/queries.ts`. The runner spawns fixed scripts with fixed
args.

### Claude self-review

`scripts/run-approved-claude-job.mjs` runs **two passes per slot**:

1. Generate draft via `claude -p` with the JSON schema.
2. Run a review/improvement pass via `claude -p` against the same schema,
   feeding in the draft.
3. Save only the final improved JSON.

### No-image default

Weekly content does **not** auto-generate images. Only content + design
prompts are saved. Images are generated only when explicitly requested or
when a specific workflow requires it.

### Reliability rules

- Slot work runs inline inside `/internal/gen-step`. Only the quick
  next-step dispatch is queued in `waitUntil()`.
- Do not put a second long network hop after a long OpenAI call inside the
  same `waitUntil()` chain. Reference incident: April 14, 2026 — a 19-slot
  run reached 14/19 then crashed at slot 15 because the next-step dispatch
  ran inside `waitUntil()` after OpenAI completed.
- Treat per-slot generation/save errors as partial-run errors, not
  orchestration-killing failures. Record in `error_log` and continue.
- Run statuses:
  - `completed` — all planned slots reached, no recorded errors
  - `completed_with_errors` — all reachable slots processed but at least one
    slot/dispatch error recorded
  - `failed` — planning failed, or dispatch broke before any progress

### Platform-content compatibility

Platform defaults are content-type-first, not package-first.

| Content type | Allowed platforms |
|--------------|-------------------|
| `image` | facebook, instagram, linkedin, x, threads, pinterest, bluesky, google_business |
| `reel` | instagram, facebook, tiktok, youtube, threads |
| `video` | facebook, instagram, youtube, linkedin, optional x |
| `blog` | website_blog only |

Package/client platforms are intersected with the slot's content type.
Manual editing can keep an incompatible platform only with explicit override
(`platform_manual_override = 1`).

### Slot key + rerun behavior

Each automation slot gets a deterministic `automation_slot_key`. Rerun
matches existing posts by that key (with a fallback to client + date +
content_type for older posts).

- existing post complete + overwrite off → skip
- existing post incomplete + overwrite off → fill missing fields only
- overwrite on → refresh generated fields

Generated post metadata: `scheduled_by_automation`, `generation_run_id`,
`automation_slot_key`, `platform_manual_override`.

### Designer prompts (always Spanish)

`ai_image_prompt` and `ai_video_prompt` are written for the designer
(Skarleth) and are **always in Spanish** regardless of client language.

| Content type | Asset | Dimensions |
|---|---|---|
| `reel` | VIDEO VERTICAL | 1080 × 1920 (9:16) |
| `video` | VIDEO HORIZONTAL | 1920 × 1080 (16:9) |
| `image` (Instagram only) | IMAGE SQUARE | 1080 × 1080 |
| `image` (Pinterest only) | IMAGE VERTICAL | 1000 × 1500 (2:3) |
| `image` (default) | IMAGE HORIZONTAL | 1200 × 628 |
| `blog` | (no image prompt) | — |

---

## Designer / Media workflow

The designer (Skarleth) uploads finished assets directly from the **Diseño**
tab on the post detail page (`frontend/src/routes/(app)/posts/[id]/+page.svelte`).
Uploading auto-sets `asset_delivered = 1`. The "Mark delivered / Ready for
Automation" panel was intentionally removed from the overview tab — the
Diseño-tab upload replaces it.

After all platforms for a post are sent successfully (zero failures), the R2
asset is deleted from the MEDIA bucket and `asset_r2_key` is nulled. If any
platform fails, the asset is preserved for retries.

`R2_MEDIA_PUBLIC_URL` env var controls the public preview URL for uploaded
assets — currently blank, so previews return null even though uploads work.

---

## Blog publishing & repair

The blog renderer lives in `worker/src/services/wordpress.ts`. Rules:

- Inline styles only — do not reintroduce `<style>` blocks.
- Visual direction: minimalist, editorial, large titles, generous horizontal
  padding, main column + support/CTA side rail on desktop.
- Templates vary by business type via `inferBusinessTemplateKey()` /
  `getTemplateChrome()`.

Blog repair (`worker/src/loader/repair-blogs.ts`,
`extractStructuredBlogContent()`):

- Strip duplicate CTA/footer fragments.
- Strip nested `.wx-blog-section-body` wrappers.
- Strip stale `wx-blog-*` chrome from prior renders.
- Normalize, do not preserve broken HTML.

After any renderer/extractor change, run the production repair job:

```bash
curl -sS -X POST https://marketing.webxni.com/internal/repair-blogs \
  -H 'x-repair-key: repair-posts-2026-04-14-webxni'
```

Then verify at least one repaired post in remote D1 (`posts.blog_content`).

`/api/blog/publish` updates the existing WP post when `wp_post_id` is
already present (no duplicates). Published posts show **Replace Published
Blog**; the edit screen offers **Save & Replace Published Blog**.

---

## Active clients

| Slug | Domain | Notes |
|------|--------|-------|
| `caliview-builders` | caliviewbuilders.com | |
| `americas-professional-builders` | americasprofessionalbuildersinc.com | |
| `daniels-locksmith` | danielslockkey.com | |
| `unlocked-pros` | unlockedpros.com | |
| `247-lockout-pasadena` | 247lockoutpasadena.com | |
| `golden-touch-roofing` | goldentouch-roofing.com | |
| `724-locksmith-ca` | 724locksmithca.com | |
| `marvin-solis` | marvinsolis.com | |
| `elite-team-builders` | eliteteambuildersinc.com | 3 GBP locations: LA, WA, OR |

### ETB multi-location GBP

Caption fields per location: `cap_gbp_la`, `cap_gbp_wa`, `cap_gbp_or`. Each
location has its own `upload_post_location_id`. Posting loop reads
`client_gbp_locations` and routes captions automatically. Generation creates
a shared GBP caption plus location-specific overrides when multi-location is
active.

---

## Frontend conventions (`frontend/src/`)

```
routes/(app)/
  dashboard/   posts/   clients/   automation/   packages/
  calendar/    approvals/   reports/   settings/   users/   logs/

lib/
  api/         # typed wrappers per resource — never raw fetch in pages
  components/  # shared UI
  stores/      # auth.ts, ui.ts (toasts)
  types.ts     # frontend mirror of DB row types
```

- Svelte 4 syntax (`bind:value`, `on:click`, `$:`). No runes.
- `toast.success()` / `toast.error()` from `$lib/stores/ui` for feedback.
- No TypeScript casts (`as Type`) inside Svelte templates — use helper
  functions.
- `class:variant` directives with `/` in the name break Svelte — use a
  ternary string instead.
- Color accent: Google Blue `#1a73e8`. Not purple.

---

## Worker conventions (`worker/src/`)

- One file per API group in `routes/`. Routes export a `Hono` instance, registered in `index.ts`.
- Auth check via `authMiddleware` on `/api/*`.
- Audit important actions with `writeAuditLog()` from `db/queries.ts`.
- Return `c.json({ error: '...' }, 4xx)` for client errors.
- Wrap DB calls in `try/catch` if the query might fail due to schema state.

---

## Deploy

**Single source of truth: GitHub Actions** (`.github/workflows/deploy.yml`).
Push to `main` triggers the deploy. Cloudflare's "Workers Builds" auto-deploy
is **disabled** — do not re-enable it (causes duplicate races and confusing
build failures from rolled tokens).

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — Workers + D1 + R2 + KV permissions on the account
- `CLOUDFLARE_ACCOUNT_ID` — `f0488d50718e6e50e4049a7d34143ec6`

What CI does **not** do:

- Run D1 migrations
- Restart `pm2: webxni-bot` (the local Discord bot)

### Standard sequence

```bash
# 1. TypeScript check (must be zero errors)
cd worker && npx tsc --noEmit

# 2. Frontend check + build
cd frontend && npm run check && npm run build

# 3. Commit
git add <files>
git commit -m "Short description"

# 4. Push (triggers CI deploy)
git push

# 5. Run pending D1 migrations explicitly (only if schema changed)
npx wrangler d1 execute webxni-db --file=db/migrations/XXXX_xxx.sql --remote

# 6. After bot.js changes
pm2 restart webxni-bot
```

### Manual local deploy (only if CI is broken)

```bash
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

Or `bash deploy.sh` for the full local sequence (installs + frontend build +
deploy).

---

## Verification before declaring "done"

- Worker change: `cd worker && npx tsc --noEmit` (zero errors).
- Frontend change: `cd frontend && npm run check && npm run build`.
- UI / frontend feature: actually use it in a browser. Type checks verify
  code, not feature correctness. If you can't test in the browser, say so
  explicitly — do not claim success.
- Blog renderer change: deploy, then run the production repair endpoint, then
  inspect at least one affected `posts.blog_content` row in remote D1.
- DB migration: confirm `wrangler d1 execute --remote` succeeded before
  deploying code that depends on the new column.

---

## Common tasks

### Add a new API route

1. `worker/src/routes/my-feature.ts` — Hono instance.
2. Register in `worker/src/index.ts`: `app.route('/api/my-feature', myRoutes)`.
3. Add typed wrapper in `frontend/src/lib/api/my-feature.ts`.
4. Export from `frontend/src/lib/api/index.ts`.

### Add a new DB column

See "Migration rules" above. Always migrations, never `schema.sql` edits.

### Add a new platform

1. Add to `allPlatforms` in `frontend/src/routes/(app)/posts/new/+page.svelte`.
2. Migration: `ALTER TABLE posts ADD COLUMN cap_newplatform TEXT`.
3. Update `PostRow` in `worker/src/types.ts`.
4. Update `Post` in `frontend/src/lib/types.ts`.
5. Add caption extraction in `worker/src/modules/captions.ts`.
6. Add `PLATFORM_META` entry in `frontend/src/lib/types.ts`.
7. Add platform to OpenAI prompt builder in `worker/src/services/openai.ts`.

---

## Owner cares about

- **Skarleth (designer)** uploads from the Diseño tab. Auto-sets `asset_delivered = 1`. Spanish prompts only.
- **Marvin (owner)** approves posts before they go Ready. Workflow: draft → submit for review → approve → (Skarleth uploads) → ready → automated cron posts it.
- Generation is **package-driven** but platform selection is **content-type-first**.
- Google Blue accent (`#1a73e8`) — not purple. Explicit design choice.
- This is a real production system with real clients. Be conservative — when in doubt, don't change working code.

---

## Platform badge colors (intentional, dark UI)

| Platform | Color |
|----------|-------|
| facebook | `#1877F2` |
| instagram | `#E1306C` (or gradient) |
| x | `#E7E9EA` (light on dark) |
| threads | `#AAAAAA` |
| tiktok | `#EE1D52` |
| linkedin | `#0A66C2` |
| youtube | `#FF0000` |
| pinterest | `#E60023` |
| bluesky | `#0085FF` |
| google_business | `#4285F4` |

Never `#000000` — invisible on dark background.

---

## Before touching any file — checklist

- [ ] Read this file end-to-end? Read `BOT.md` if touching the bot or weekly content?
- [ ] Read the specific file(s) you're about to edit?
- [ ] Is the change additive (not a rewrite)?
- [ ] Does it break any "Critical modules" entry above?
- [ ] DB change → migration file in sequence + both type files + (if client field) `CLIENT_WRITABLE_FIELDS`?
- [ ] `npx tsc --noEmit` and (if frontend) `npm run build` clean?
- [ ] Long-lived background work routes through the right path (worker for OpenAI, terminal for Claude)?

---

## What is NOT yet implemented (do not remove the stubs)

1. **Sunday generation cron** — `0 7 * * SUN` triggers but doesn't yet call `runGeneration` for all active clients.
2. **WordPress blog auto-post during posting runs** — `wp_post_url` field exists, service is ready, posting loop doesn't create WP drafts yet.
3. **Approval workflow notifications** — no email/Slack on submit-for-approval.
4. **Canva API** — links stored as reference only.
5. **PDF monthly reports** — data available, export not built.
6. **Notion auto-sync on cron** — manual via API only.
7. **Real-time posting status** — currently requires page refresh.
8. **`R2_MEDIA_PUBLIC_URL`** — not configured; uploads work but preview URLs are null.
9. **Offer/Event image upload** — `asset_r2_key` column exists, upload UI not yet wired.
