# CODEX.md — AI Agent Collaboration Guide for Marketing_WebXni

**Role:** You are acting as a principal product architect, senior UX auditor,
full-stack systems designer, and AI workflow engineer for this platform.

**First rule:** Read this entire file before making any changes. Then read
`CLAUDE.md`. Then audit the specific files mentioned before touching them.

---

## What this platform is

A production marketing automation SaaS for a social media agency (WebXni).
It manages ~9 active client accounts and automates social media posting to
Facebook, Instagram, LinkedIn, TikTok, Pinterest, Google Business, YouTube,
X (Twitter), Threads, Bluesky, and WordPress blogs.

**Live URL:** https://marketing.webxni.com  
**Stack:** Cloudflare Workers (Hono) + D1 (SQLite) + SvelteKit 4 + R2 + KV  
**Deployment:** `npx wrangler deploy` (no CI/CD auto-deploy from GitHub push)

---

## CRITICAL — DO NOT BREAK THESE

These modules are working in production. Do not modify their core logic
unless the task explicitly requires it.

| Module | File | What it does |
|--------|------|-------------|
| Posting loop | `worker/src/loader/posting-run.ts` | Reads ready posts, runs preflight, submits to Upload-Post API |
| Preflight | `worker/src/modules/preflight.ts` | 12-check validation before any post is sent |
| Upload-Post client | `worker/src/services/uploadpost.ts` | API client for upload-post.com |
| Auth middleware | `worker/src/middleware/auth.ts` | Session-based auth via KV |
| Rate limiter | `worker/src/middleware/rateLimit.ts` | Prevents abuse |
| Idempotency | `worker/src/modules/idempotency.ts` | Prevents double-posting |
| Caption mapper | `worker/src/modules/captions.ts` | Maps platform → caption field |
| All `/api/auth/*` routes | `worker/src/routes/auth.ts` | Login/logout/session |
| Client CRUD | `worker/src/routes/clients.ts` | Full client management |
| Post CRUD | `worker/src/routes/posts.ts` | Post lifecycle management |
| Asset upload | `worker/src/routes/assets.ts` | R2 media handling |
| WordPress service | `worker/src/services/wordpress.ts` | WP REST API client |
| Notion service | `worker/src/services/notion.ts` | Notion import/export |

---

## Architecture

```
Browser → SvelteKit (Cloudflare Assets) 
       ↓ /api/*
Hono router (Cloudflare Worker) → D1 (SQLite) / R2 / KV
       ↓
Upload-Post API  |  WordPress REST API  |  Notion API  |  OpenAI API
```

### Cron schedule (wrangler.toml)
| Schedule | Trigger | Status |
|----------|---------|--------|
| `0 7 * * SUN` | Sunday 7AM — weekly AI generation | Partially implemented |
| `0 2 * * *` | Daily 2AM — fetch real URLs from Upload-Post | Working |
| `0 */6 * * *` | Every 6h — automated posting check | Working |

---

## Database tables (D1 / SQLite)

| Table | Purpose |
|-------|---------|
| `users` | Admin/operator/viewer accounts |
| `clients` | Client accounts (9 active) |
| `client_platforms` | Per-client platform credentials |
| `client_gbp_locations` | ETB's 3 Google Business locations |
| `client_restrictions` | Forbidden terms per client |
| `posts` | All posts (draft → posted lifecycle) |
| `post_platforms` | Per-platform posting status + tracking IDs |
| `post_versions` | Edit history snapshots |
| `assets` | R2 media registry |
| `posting_jobs` | Posting run job records |
| `posting_attempts` | Per-post-platform attempt log |
| `generation_runs` | AI content generation run records |
| `audit_logs` | All significant actions |
| `packages` | Content packages (posts/mo, freq, platforms) |
| `client_intelligence` | Brand voice, SEO strategy, content angles |
| `client_feedback` | Positive/negative content feedback |
| `client_categories` | Business categories |
| `client_services` | Service offerings |
| `client_service_areas` | Service areas |
| `client_offers` | Special offers |
| `settings` | System config in KV (`settings:system`) |
| `wp_templates` | WordPress template configs |

### Migration rules (ALWAYS follow these)
1. **Never edit `db/schema.sql`** to add columns
2. Write `db/migrations/XXXX_description.sql` with `ALTER TABLE ADD COLUMN`
3. Run: `wrangler d1 execute webxni-db --file=db/migrations/XXXX.sql --remote`
4. Update `worker/src/types.ts` (the interface)
5. Update `frontend/src/lib/types.ts` (the frontend type)
6. If it's a client field: add to `CLIENT_WRITABLE_FIELDS` in `worker/src/routes/clients.ts`

---

## Post status lifecycle

```
draft → pending_approval → approved → ready → scheduled → posted
                                           ↘ failed
                                           ↘ cancelled
```

Gates before automation can post:
- `ready_for_automation = 1`
- `asset_delivered = 1`  
- `status = 'ready'`
- Preflight passes for each platform

---

## Frontend structure

```
frontend/src/routes/(app)/
  dashboard/     — overview stats
  posts/         — post list + [id] detail + [id]/edit + new
  clients/       — client list + [slug] detail (complex)
  automation/    — AI generation + posting controls + run history
  packages/      — content package management
  calendar/      — post calendar view
  approvals/     — approval queue
  reports/       — client reports
  settings/      — system settings
  users/         — user management
  logs/          — audit log viewer

frontend/src/lib/api/
  auth.ts        — login, logout, session
  clients.ts     — client CRUD + platforms + intelligence
  posts.ts       — post CRUD + approve/reject/ready
  packages.ts    — package CRUD
  run.ts         — trigger generation/posting, list runs
  reports.ts     — reports
  users.ts       — user management
  index.ts       — re-exports all
```

### Frontend coding rules
- Svelte 4 legacy syntax: `bind:value`, `on:click`, `$:` reactivity
- All API calls use typed wrappers in `$lib/api/` — never raw `fetch()` in pages
- Use `toast.success()` / `toast.error()` from `$lib/stores/ui` for feedback
- Types live in `frontend/src/lib/types.ts` — keep in sync with `worker/src/types.ts`
- CSS uses Tailwind + custom classes defined in `frontend/src/app.css`
- Color accent is Google Blue `#1a73e8` — not purple

---

## AI Content Generation (implemented)

**Route:** `POST /api/run/generate`  
**File:** `worker/src/loader/generation-run.ts`  
**OpenAI service:** `worker/src/services/openai.ts`

### What it does
1. Reads client's package from DB (posts/mo, content type mix, frequency, platforms)
2. Builds a content-type sequence (images/videos/reels/blogs evenly interleaved)
3. Builds publish dates based on `posting_frequency` (daily/3x_week/twice_weekly/weekly/biweekly/monthly)
4. Stores a full slot plan in `generation_runs.post_slots`
5. Dispatches slot `0` to `/internal/gen-step`
6. Each `/internal/gen-step` request executes exactly one slot, saves the post, updates progress, then queues the next slot
7. Creates post as `status = 'draft'` in DB

### Reliability notes
- Do not dispatch the next generation step from inside slot work after the long OpenAI request completes
- The April 14, 2026 production failure was a mid-run self-dispatch crash after slot 14/19 (`Trigger failed for slot 14: gen-step returned 500`)
- Current design is sequential: slot work runs inline in `/internal/gen-step`; only the quick next-hop dispatch is queued in `waitUntil()`
- One slot failure should be recorded in `error_log` and the run should continue unless dispatch itself becomes impossible
- Run status rules:
  - `completed` = all planned slots reached, no recorded errors
  - `completed_with_errors` = all reachable slots processed but one or more slot/dispatch errors were recorded
  - `failed` = planning failed or dispatch/orchestration failed before any useful completion

### Designer prompts (always in Spanish)
- `ai_image_prompt` — detailed image/design brief for the designer (Midjourney/Canva style)
- `ai_video_prompt` — video direction for Reels/TikTok/Shorts
- These are ALWAYS generated in Spanish regardless of client language

### Frontend trigger
`frontend/src/routes/(app)/automation/+page.svelte`
- 3-column layout: Clients | Period (month+year) | Summary+Action
- Shows generation run history below

### Post detail designer tab
`frontend/src/routes/(app)/posts/[id]/+page.svelte`
- Tab "🎨 Diseño" — asset upload section (designer uploads finished file here, auto-marks `asset_delivered = 1`)
- Shows `ai_image_prompt` (image/design brief) and `ai_video_prompt` (video brief) in Spanish
- **Translate button** in Contexto del Post — calls `POST /api/posts/:id/translate` to render Spanish translations of title + master_caption inline
- Context card shows post metadata for the designer's reference

### AI prompt rules by content type
Prompts include asset type, orientation, exact dimensions, platform context, and brand colors:

| Content type | Asset type | Dimensions |
|---|---|---|
| `reel` | VIDEO VERTICAL | 1080 × 1920 (9:16) |
| `video` | VIDEO HORIZONTAL | 1920 × 1080 (16:9) |
| `image` (Instagram only) | IMAGE SQUARE | 1080 × 1080 |
| `image` (Pinterest only) | IMAGE VERTICAL | 1000 × 1500 (2:3) |
| `image` (default) | IMAGE HORIZONTAL | 1200 × 628 |
| `blog` | No prompt generated | — |

### Caption generation for new platforms
`POST /api/posts/:id/generate-caption { platform: string }`
- Generates a platform-specific caption using GPT-4o-mini
- Reads client brand voice + intelligence from DB
- Saves caption to post + adds platform to `post.platforms` JSON array
- UI: dropdown at bottom of Captions tab showing only platforms not yet on the post

---

## Clients (current active)

| Slug | Domain | WP |
|------|--------|----|
| `caliview-builders` | caliviewbuilders.com | Yes |
| `americas-professional-builders` | americasprofessionalbuildersinc.com | Yes |
| `daniels-locksmith` | danielslockkey.com | Yes |
| `unlocked-pros` | unlockedpros.com | Yes |
| `247-lockout-pasadena` | 247lockoutpasadena.com | Yes |
| `golden-touch-roofing` | goldentouch-roofing.com | Yes |
| `724-locksmith-ca` | 724locksmithca.com | Yes |
| `marvin-solis` | marvinsolis.com | Yes |
| `elite-team-builders` | eliteteambuildersinc.com | Yes + 3 GBP |

### ETB multi-location GBP
ETB has 3 Google Business locations: LA, WA, OR.
- Caption fields: `cap_gbp_la`, `cap_gbp_wa`, `cap_gbp_or`
- Each location has its own `upload_post_location_id` in `client_gbp_locations`
- Posting loop handles these automatically via `client_gbp_locations` table

---

## Secrets (Cloudflare — set via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| `UPLOAD_POST_API_KEY` | Upload-Post API auth |
| `OPENAI_API_KEY` | AI content generation |
| `NOTION_API_TOKEN` | Notion import/export |

---

## Notion full-client import (implemented — migration 0006)

**Route:** `POST /api/notion/import/clients/full`  
**File:** `worker/src/routes/notion.ts`

Reads the WebXni Notion Clients DB and populates all 8 client tabs in one call.

**Migration 0006** added first-class columns to `clients`:
`phone`, `email`, `owner_name`, `cta_text`, `cta_label`, `industry`, `state`

**Notion DB ID:** `87e495b2-350a-45eb-a343-f6441dafa6cb`

**Known Notion → app slug map** (use as `notion_id_to_app_slug` body param):
```json
{
  "1503627b-21c7-80ea-bc2b-d225d3829a67": "724-locksmith-ca",
  "1e43627b-21c7-80cf-a316-e10315125274": "247-lockout-pasadena",
  "2363627b-21c7-809c-a659-e06f0a90bc4e": "unlocked-pros",
  "28d3627b-21c7-809f-a6d9-c3229a856a98": "daniels-locksmith",
  "2f33627b-21c7-80b6-87fa-f66a889e8112": "elite-team-builders",
  "2f33627b-21c7-80bb-8e98-d5333bb1bdfe": "americas-professional-builders",
  "3353627b-21c7-8154-b7af-f96b2faac314": "caliview-builders",
  "a1466972-fc09-4449-bb3e-cc5a7c49df26": "golden-touch-roofing",
  "9b4731c8-67ba-45e8-9311-3b94b4ce84e0": "webxni",
  "19943730-826e-4110-9753-ca29531c221d": "ketty-s-robles-accounting",
  "3273627b-21c7-80c8-bba6-dae846a35c57": "jaz-makeup-artist",
  "0533eada-a7f2-4798-8359-38a99cbbd53f": "modern-vision-remodeling-experts"
}
```

Tabs populated per client: `profile`, `intelligence`, `social_links`, `platforms`, `restrictions`, `services`, `areas`, `offers`. Sub-tables are skipped if already populated (use `force_sub_tables: true` to re-import).

**Run the import** (after login to get session cookie):
```bash
curl -b /tmp/wc.txt -X POST https://marketing.webxni.com/api/notion/import/clients/full \
  -H "Content-Type: application/json" \
  -d '{"database_id":"87e495b2-350a-45eb-a343-f6441dafa6cb","active_only":true,"notion_id_to_app_slug":{...}}'
```

---

## Automation page — date modes (implemented)

**File:** `frontend/src/routes/(app)/automation/+page.svelte`

Three date modes (toggle between them):

| Mode | Description |
|------|-------------|
| **Monthly** (default) | Month + Year pickers → full calendar month |
| **Custom Range** | Start + End date pickers, validates max 92 days |
| **Presets** | This Week / Next 7 / Next 14 / Next 30 days |

Post estimate formula: `Math.round(posts_per_month * rangeDays / 30)`

Content breakdown per client (shown in summary): `images`, `videos`, `blogs` proportional to package ratios.

Client selection: All active | Select (with search + package filter) | By Package

---

## What is NOT yet implemented (future work)

These are explicitly unfinished — do not remove stubs:

1. **Sunday generation cron** — `0 7 * * SUN` in wrangler.toml triggers but doesn't
   run generation yet. Wire it to call `runGeneration` for all active clients.

2. **WordPress blog auto-post** — `wp_post_url` field exists, `wordpress.ts` service
   is ready, but posting loop doesn't create WP drafts yet.

3. **Approval workflow notifications** — no email/Slack notifications when a post
   is submitted for approval.

4. **Canva API** — links stored as reference only, no API integration.

5. **PDF monthly reports** — report data is available, PDF export not built.

6. **Notion auto-sync on cron** — manual only via API for now.

7. **Real-time posting status** — currently requires page refresh to see updates.

8. **R2_MEDIA_PUBLIC_URL** — env var not configured in wrangler.toml; asset upload works
   but `url` field in upload response is null so preview doesn't render in Create Post form.

---

## How to add a new feature

### New API route
1. `worker/src/routes/my-feature.ts` — Hono instance
2. Register in `worker/src/index.ts`: `app.route('/api/my-feature', myRoutes)`
3. Add typed API wrapper in `frontend/src/lib/api/my-feature.ts`
4. Export from `frontend/src/lib/api/index.ts`

### New DB column
See "Migration rules" above — always migrations, never schema.sql edits.

### New platform
1. Add to `allPlatforms` in `frontend/src/routes/(app)/posts/new/+page.svelte`
2. Migration: `ALTER TABLE posts ADD COLUMN cap_newplatform TEXT`
3. Update `PostRow` in `worker/src/types.ts`
4. Update `Post` in `frontend/src/lib/types.ts`
5. Add to caption extraction in `worker/src/modules/captions.ts`
6. Add to `PLATFORM_META` in `frontend/src/lib/types.ts`
7. Add to OpenAI prompt in `worker/src/services/openai.ts`

---

## How to deploy — FULL sequence every time

GitHub push does NOT deploy to Cloudflare. You must run wrangler manually.
Always follow this exact order:

```bash
# Step 1 — TypeScript check (must pass, zero errors)
cd worker && npx tsc --noEmit && cd ..

# Step 2 — Build frontend (must pass)
cd frontend && npm run build && cd ..

# Step 3 — Deploy to Cloudflare (uploads frontend assets + worker code)
npx wrangler deploy

# Step 4 — Run any pending DB migrations (only if schema changed)
npx wrangler d1 execute webxni-db --file=db/migrations/XXXX_description.sql --remote

# Step 5 — Commit all changes to git
git add <changed files>
git commit -m "Short description of what changed"

# Step 6 — Push to GitHub
git push
```

**Why this order matters:**
- Deploy before commit — if wrangler fails, nothing is committed as "done"
- TypeScript and build checks catch errors before they reach production
- GitHub is source of truth for code history, Cloudflare is the live runtime
- They are independent — both must be done after every change

Or use the deploy script (does steps 1-3 only — still commit/push manually):
```bash
bash deploy.sh
```

---

## Before touching any file — checklist

- [ ] Have you read this file and CLAUDE.md?
- [ ] Have you read the specific file(s) you're about to edit?
- [ ] Are you making an additive change (not a rewrite)?
- [ ] Will your change break any existing working module?
- [ ] Does a DB change need a migration file?
- [ ] Are both `worker/src/types.ts` and `frontend/src/lib/types.ts` updated?
- [ ] Did you run `npx tsc --noEmit` and `npm run build` before deploying?

---

## Code style rules

### Worker (TypeScript / Hono)
- Prepared statements only: `.prepare('...').bind(...).run()`
- New DB queries go in `worker/src/db/queries.ts`, not inline
- Return `c.json({ error: '...' }, 4xx)` for errors
- Audit important actions: `writeAuditLog(db, { ... })`
- Wrap `waitUntil()` for background tasks
- For generation orchestration, never put a second network hop after a long OpenAI call inside the same `waitUntil()` chain

### Frontend (Svelte 4)
- Svelte 4 syntax — NOT Svelte 5 runes (`$state`, `$effect`, etc.)
- `bind:value` for inputs, `on:click` for events
- No TypeScript casts in template (`as Type`) — use helper functions
- `class:variant` directives with `/` cause issues — use ternary string instead

### General
- No speculative abstractions — build only what is needed
- No backwards-compat shims
- Keep types in sync between worker and frontend
- Emojis only if user asked for them

---

## Platform badge colors (dark background)

These colors are intentional for visibility on dark UI:

| Platform | Color |
|----------|-------|
| facebook | `#1877F2` |
| instagram | gradient / `#E1306C` |
| x (twitter) | `#E7E9EA` (light on dark) |
| threads | `#AAAAAA` |
| tiktok | `#EE1D52` |
| linkedin | `#0A66C2` |
| youtube | `#FF0000` |
| pinterest | `#E60023` |
| bluesky | `#0085FF` |
| google_business | `#4285F4` |

Do NOT use `#000000` for any platform badge — invisible on dark background.

---

## Key things the owner cares about

1. **The designer (Skarleth)** can upload finished assets directly from the Diseño tab
   of any post. Uploading auto-sets `asset_delivered = 1`. The "Mark delivered / Ready
   for Automation" operational panel was intentionally REMOVED from the overview tab —
   the upload in Diseño tab replaces it. All designer instructions are in Spanish.

2. **Content is approved by the owner (Marvin)** before being marked Ready.
   The workflow: draft → submit for review → approve → (Skarleth adds media) → ready → auto-posted by cron.

3. **Spanish design prompts** are for Skarleth the designer, not for the client.
   Always generate them in Spanish regardless of client language.

4. **Generation is package-driven.** Never ask the user to pick content types
   or frequencies manually — read from the client's package.

5. **Google Blue accent** (`#1a73e8`), not purple. This was an explicit design choice.

6. **This is a real production system** with real clients. Be conservative.
   When in doubt, don't change working code.
