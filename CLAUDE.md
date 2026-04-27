# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Also read `CODEX.md` for the full architecture audit before making changes.

---

## Recent context to preserve

The current project state includes active work on WordPress blog publishing, repair, and template normalization.

Read these files first if the task touches blogs, WordPress sync, or published-post editing:

- `worker/src/services/wordpress.ts`
- `worker/src/routes/blog.ts`
- `worker/src/loader/repair-blogs.ts`
- `frontend/src/routes/(app)/posts/[id]/+page.svelte`
- `frontend/src/routes/(app)/posts/[id]/edit/+page.svelte`

### Current blog workflow assumptions

- If a post already has `wp_post_id`, publishing should update/replace the existing WP post rather than create a duplicate
- Published posts show `Replace Published Blog` in the detail view
- The edit screen supports `Save & Replace Published Blog`
- Existing broken blog markup is repaired by rerendering structured content, not by preserving old malformed HTML

### Blog renderer rules

- The renderer lives in `worker/src/services/wordpress.ts`
- Use inline styles only for blog content sent to WordPress
- Do not reintroduce `<style>` tags in blog post HTML
- Keep the visual direction minimalist and professional:
  - bigger titles
  - more horizontal padding
  - editorial/newspaper-like layout
  - main content column with a support/CTA side rail on desktop

### Blog repair rules

- `extractStructuredBlogContent()` must strip:
  - duplicate CTA/footer fragments
  - nested repeated `.wx-blog-section-body` wrappers
  - stale `wx-blog-*` layout chrome from prior renders
- After renderer changes, run the production repair job so old posts are normalized

### Production repair command

```bash
curl -sS -X POST https://marketing.webxni.com/internal/repair-blogs \
  -H 'x-repair-key: repair-posts-2026-04-14-webxni'
```

### Verification after blog/template changes

```bash
cd worker && npm run typecheck
cd frontend && npm run check
cd frontend && npm run build
npx wrangler deploy
```

Then verify remote D1 `posts.blog_content` for at least one repaired post.

---

## Commands

```bash
# TypeScript check (worker)
cd worker && npx tsc --noEmit

# Type check (frontend — Svelte-specific)
cd frontend && npm run check

# Build frontend
cd frontend && npm run build

# Local dev (run both in separate terminals)
npx wrangler dev                  # Worker on :8787
cd frontend && npm run dev        # SvelteKit on :5173 (proxies /api/* to :8787)

# Deploy — full sequence
bash deploy.sh                    # Steps 1-3 (tsc + build + wrangler deploy)
git add <files> && git commit ... && git push  # Steps 4-5
```

---

## What this app is

A full-stack marketing automation platform for a social media agency (WebXni).
It manages ~9 active client accounts and automates posting to Facebook, Instagram, LinkedIn,
TikTok, Pinterest, Google Business, YouTube, X, Threads, Bluesky, and WordPress blogs.

**Live URL:** https://marketing.webxni.com  
**Deploy:** `npx wrangler deploy` (no auto-deploy from GitHub push)

**Core workflow:**
1. Content is AI-generated or manually created (posts table) as `draft`
2. Posts go through an approval pipeline: `draft → pending_approval → approved → ready → scheduled → posted`
3. The designer (Skarleth) adds media externally and submits for approval
4. Marvin approves posts → marks Ready
5. Automation cron (every 6h) reads `ready` posts and submits to Upload-Post API
6. WordPress blog posts are drafted via WP REST API
7. Notion is used as a source of truth for some content; we import from it

---

## Critical constraints — always follow these

### Never rewrite working code
- This is an **additive upgrade** project. Preserve existing flows, forms, and patterns.
- If something works, don't touch it. Add alongside, not on top.
- The dark UI, sidebar nav, and current page layouts are intentional — do not redesign.
- Color accent is **Google Blue `#1a73e8`** — not purple.

### Database changes go in migrations
- Never edit `db/schema.sql` to add new columns. Write a new migration file in `db/migrations/`.
- Name migrations `XXXX_short_description.sql` in sequence. Current sequence is at `0005` — next is `0006`.
- Migrations use `ALTER TABLE ADD COLUMN` — D1 supports SQLite syntax.
- Run: `wrangler d1 execute webxni-db --file=db/migrations/XXXX_xxx.sql --remote`

### All SQL uses prepared statements
- File: `worker/src/db/queries.ts`
- No string interpolation in SQL. Always `.bind(...)`.
- When adding new DB operations, add a function to `queries.ts` rather than writing inline SQL in route handlers.

### Backend follows Hono route pattern
- One file per API group in `worker/src/routes/`
- Routes export a `Hono` instance, registered in `worker/src/index.ts`
- Auth check is via `authMiddleware` on `/api/*` — all routes are already protected
- Audit important actions with `writeAuditLog()` from `db/queries.ts`
- Return `c.json({ error: '...' }, 4xx)` for client errors
- Wrap DB calls in `try/catch` if the query might fail due to schema state

### Frontend follows SvelteKit patterns
- Pages are in `frontend/src/routes/(app)/...`
- All API calls go through typed wrappers in `frontend/src/lib/api/`
- Never fetch directly with `fetch()` in page components — use the API modules
- Use `toast.success()` / `toast.error()` from `$lib/stores/ui` for feedback
- Use `bind:value` for form state, `on:click` for events (**Svelte 4** legacy syntax — NOT Svelte 5 runes)
- All types are in `frontend/src/lib/types.ts` — keep them in sync with `worker/src/types.ts`
- No TypeScript casts (`as Type`) inside Svelte templates — use helper functions
- `class:some/variant` directives with `/` in the name break Svelte — use ternary string instead

### Type sync rule
When you add a column to the DB:
1. Add it to `worker/src/types.ts` (ClientRow or PostRow)
2. Add it to `frontend/src/lib/types.ts` (Client or Post)
3. Add it to the `CLIENT_WRITABLE_FIELDS` set in `worker/src/routes/clients.ts` if it should be settable via API

---

## Architecture in 30 seconds

```
Browser → SvelteKit frontend (Cloudflare Assets)
       ↓ /api/*
Hono router (Cloudflare Worker)
       ↓
D1 (SQLite)   R2 (media files)   KV (sessions)
       ↓
Upload-Post API   WordPress REST API   Notion API   OpenAI API
```

Background tasks run via `ctx.waitUntil()` inside the Worker.

### Cron schedule
| Cron | When | Function |
|------|------|---------|
| `0 7 * * SUN` | Sunday 7AM | Weekly AI generation (wire to runGeneration) |
| `0 2 * * *` | Daily 2AM | Fetch real URLs from Upload-Post history |
| `0 */6 * * *` | Every 6h | Automated posting check |

---

## Key files

| File | What it does |
|------|-------------|
| `worker/src/index.ts` | Router — register new routes here |
| `worker/src/types.ts` | All DB row types + Env bindings |
| `worker/src/db/queries.ts` | Every DB query — add new ones here |
| `worker/src/modules/preflight.ts` | Pre-posting validation (12 checks) — DO NOT modify |
| `worker/src/modules/captions.ts` | Platform → caption field mapping |
| `worker/src/modules/idempotency.ts` | Prevents double-posting |
| `worker/src/services/uploadpost.ts` | Upload-Post API client |
| `worker/src/services/wordpress.ts` | WordPress REST API client |
| `worker/src/services/notion.ts` | Notion API client + helpers |
| `worker/src/services/openai.ts` | GPT-4o content generation |
| `worker/src/loader/posting-run.ts` | The automation posting loop — DO NOT modify core |
| `worker/src/loader/generation-run.ts` | AI content generation loop |
| `frontend/src/lib/types.ts` | Frontend type definitions |
| `frontend/src/lib/api/clients.ts` | All client-related API calls |
| `frontend/src/lib/api/posts.ts` | All post-related API calls |
| `frontend/src/lib/api/run.ts` | Generation/posting trigger API calls |
| `db/schema.sql` | Canonical schema (DO NOT edit to add columns) |
| `db/migrations/` | Add columns here |
| `wrangler.toml` | Bindings, crons, domains |

---

## Post status lifecycle

```
draft → pending_approval → approved → ready → scheduled → posted
                                           ↘ failed
                                           ↘ cancelled
```

Gates before a post can be sent:
- `ready_for_automation = 1` (all content fields present)
- `asset_delivered = 1` (media file attached)
- Status = `ready`
- Preflight validation passes for each platform

**Important:** The designer (Skarleth) uploads media externally. The "Mark delivered / Ready
for Automation" operational panel was intentionally removed from the post detail overview tab.
That section is NOT needed — Skarleth submits for approval when she's done.

---

## AI Content Generation

**Trigger:** `POST /api/run/generate` → creates `generation_run` record → planning runs in `waitUntil()`  
**Files:** `worker/src/loader/generation-run.ts` + `worker/src/services/openai.ts`

- Reads client's package from DB to determine: posts/mo, content type mix, frequency, platforms
- Stores a full slot plan in `generation_runs.post_slots`
- Starts generation by dispatching slot `0` to `/internal/gen-step`
- `/internal/gen-step` executes one slot inline, updates run progress/state, then queues the next self-dispatch
- Generates platform-specific captions for each platform the client uses
- Spanish designer prompts (`ai_image_prompt`, `ai_video_prompt`) — ALWAYS in Spanish
- Posts created as `status = 'draft'`
- Frontend: `frontend/src/routes/(app)/automation/+page.svelte`
- Designer view: "🎨 Diseño" tab on `posts/[id]/+page.svelte`

### Generation reliability rule
- Do not dispatch the next generation step from inside post-generation slot work after the OpenAI request finishes
- Real production evidence on April 14, 2026: a 19-slot run reached 14/19, then failed at `Next-step dispatch start: slot 15/19` with `gen-step returned 500`
- Treat per-slot generation/save errors as partial-run errors, not orchestration-killing failures
- Dispatch failures must be logged immediately to both `execution_log` and `error_log`

---

## Current clients (WordPress sites)

| Slug | Domain |
|------|--------|
| caliview-builders | caliviewbuilders.com |
| americas-professional-builders | americasprofessionalbuildersinc.com |
| daniels-locksmith | danielslockkey.com |
| unlocked-pros | unlockedpros.com |
| 247-lockout-pasadena | 247lockoutpasadena.com |
| golden-touch-roofing | goldentouch-roofing.com |
| 724-locksmith-ca | 724locksmithca.com |
| marvin-solis | marvinsolis.com |
| elite-team-builders | eliteteambuildersinc.com |

---

## GBP multi-location (Elite Team Builders)

ETB has 3 GBP locations — LA, WA, OR.
These are stored in `client_gbp_locations` table.
Captions: `cap_gbp_la`, `cap_gbp_wa`, `cap_gbp_or` on the post.
Each location has its own `upload_post_location_id`.

---

## Cloudflare bindings

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1 | Primary database |
| `MEDIA` | R2 | Client media uploads (user-uploaded assets) |
| `IMAGES` | R2 | Generated/system images |
| `KV_BINDING` | KV | Sessions + `settings:system` config |
| `ASSETS` | Static | SvelteKit frontend build |

`R2_MEDIA_PUBLIC_URL` var must be set in wrangler.toml after enabling public access on the MEDIA bucket.

---

## Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| `UPLOAD_POST_API_KEY` | Upload-Post API auth |
| `OPENAI_API_KEY` | AI content generation |
| `NOTION_API_TOKEN` | Notion import/export (optional) |

---

## Platform badge colors (dark background — do not change)

| Platform | Color |
|----------|-------|
| facebook | `#1877F2` |
| instagram | `#E1306C` |
| x (twitter) | `#E7E9EA` (light on dark) |
| threads | `#AAAAAA` |
| tiktok | `#EE1D52` |
| linkedin | `#0A66C2` |
| youtube | `#FF0000` |
| pinterest | `#E60023` |
| bluesky | `#0085FF` |
| google_business | `#4285F4` |

Do NOT use `#000000` — invisible on dark background.

---

## Notion full-client import

**Run after login:**
```bash
curl -b /tmp/wc.txt -X POST https://marketing.webxni.com/api/notion/import/clients/full \
  -H "Content-Type: application/json" \
  -d '{"database_id":"87e495b2-350a-45eb-a343-f6441dafa6cb","active_only":true,"notion_id_to_app_slug":{SEE CODEX.md}}'
```
Use `force_sub_tables: true` to re-import services/areas/offers for existing clients.

Migration sequence is now at **0009** (next is 0010).

---

## Designer / Media workflow (implemented)

**Diseño tab** (`frontend/src/routes/(app)/posts/[id]/+page.svelte`):
- Asset upload section at top — designer can upload finished image/video directly from Diseño tab
- `🌐 Traducir al Español` button in Contexto del Post — translates title + master_caption via GPT-4o-mini
- Shows AI-generated image brief (`ai_image_prompt`) and video brief (`ai_video_prompt`) with dimensions/orientation

**AI prompt rules by content type** (`worker/src/services/openai.ts`):
| Content type | Asset type | Dimensions |
|---|---|---|
| `reel` | VIDEO VERTICAL | 1080 × 1920 (9:16) |
| `video` | VIDEO HORIZONTAL | 1920 × 1080 (16:9) |
| `image` (Instagram only) | IMAGE SQUARE | 1080 × 1080 (1:1) |
| `image` (Pinterest only) | IMAGE VERTICAL | 1000 × 1500 (2:3) |
| `image` (default) | IMAGE HORIZONTAL | 1200 × 628 (1.91:1) |
| `blog` | No image prompt generated | — |

**R2 asset cleanup** (`worker/src/loader/posting-run.ts`):
After all platforms for a post are sent successfully (zero failures), the R2 asset is deleted from the MEDIA bucket and `asset_r2_key` is nulled in DB. If any platform fails, asset is preserved for retries.

**Asset public URL**: `R2_MEDIA_PUBLIC_URL` env var must be set in wrangler.toml for asset preview URLs to work. Currently blank — upload works but preview returns null.

---

## Post caption generation (implemented)

**Generate caption for a new platform** — `POST /api/posts/:id/generate-caption { platform }`  
Available in the Captions tab of any post. Dropdown shows only platforms NOT already on the post. Generates via GPT-4o-mini, saves caption + adds platform to post's platform list.

**Translate context for designer** — `POST /api/posts/:id/translate`  
Translates `title` + `master_caption` to Spanish. Used by the 🌐 button in the Diseño tab.

---

## GBP Offers & Events automation (implemented — migration 0009)

**Client > Offers tab**: full GBP offer config — `gbp_cta_type`, `gbp_cta_url`, `gbp_coupon_code`, `gbp_redeem_url`, `gbp_terms`, `gbp_location_id`, `recurrence` (none/weekly/biweekly/monthly), `next_run_date`, pause/resume.

**Client > Events tab**: new — `gbp_event_title`, start/end date+time, CTA, recurrence, pause/resume.

**Automation** (`worker/src/loader/recurring-gbp-run.ts`):
- Runs as first step of the `0 */6 * * *` cron before the main posting loop
- Detects active non-paused offers/events with `next_run_date <= today`
- Creates `ready` posts (status=ready, ready_for_automation=1) with all GBP fields set
- Advances `next_run_date` based on recurrence rule; deactivates one-time items after first post
- Expires events automatically when `gbp_event_end_date` is in the past
- Duplicate guard via `last_posted_at` — skips if already posted today

**GBP CTA in post creation/editing**:
- Create Post form: GBP section already existed — now sends all CTA/event/offer fields to API
- Post detail > Captions tab: new "Google Business Profile Settings" card (view + edit all GBP fields inline)
- `buildExtraParams` forwards all GBP fields to Upload-Post API
- Caption generation is CTA-aware: CALL → include phone, LEARN_MORE → educational tone, etc.

**New table**: `client_events` (migration 0009).  
**Extended table**: `client_offers` + `posts.gbp_location_id` (migration 0009).

---

## What's NOT implemented yet (future work)

- **Sunday generation cron** — stub exists in index.ts, needs to call `runGeneration` for all clients
- **Automatic WordPress post creation** during posting runs — `wp_post_url` field exists, service is ready
- **Notion auto-sync on cron** — currently manual via API
- **PDF export** for monthly reports — data available, export not built
- **Canva API integration** — links stored as reference-only
- **Real-time posting status** — currently requires page refresh
- **R2_MEDIA_PUBLIC_URL** — not configured yet; asset upload works but preview URLs are null
- **Offer/Event image upload** — `asset_r2_key` column exists but upload UI not yet wired to offer/event forms

---

## Common tasks

### Add a new API route
1. Create `worker/src/routes/my-feature.ts` with a Hono instance
2. Import and register in `worker/src/index.ts`
3. Add typed fetch wrapper in `frontend/src/lib/api/my-feature.ts`
4. Export from `frontend/src/lib/api/index.ts`

### Add a new DB column
1. Write `db/migrations/XXXX_description.sql` with `ALTER TABLE ADD COLUMN`
2. Update `worker/src/types.ts`
3. Update `frontend/src/lib/types.ts`
4. If client field: add to `CLIENT_WRITABLE_FIELDS` in `worker/src/routes/clients.ts`
5. Run migration: `wrangler d1 execute webxni-db --file=db/migrations/XXXX... --remote`

### Add a new platform
1. Add to `allPlatforms` array in `frontend/src/routes/(app)/posts/new/+page.svelte`
2. Add `cap_platform` column via migration (posts table)
3. Update `PostRow` in `worker/src/types.ts`
4. Update `Post` in `frontend/src/lib/types.ts`
5. Add caption extraction in `worker/src/modules/captions.ts`
6. Add platform meta in `frontend/src/lib/types.ts` (`PLATFORM_META`)
7. Add platform to OpenAI prompt builder in `worker/src/services/openai.ts`

### Test WordPress connection for a client
```bash
curl -X POST https://marketing.webxni.com/api/clients/elite-team-builders/wordpress/test \
  -H "Cookie: session=YOUR_SESSION"
```

---

## What to check before deploying

- [ ] `wrangler d1 execute` any pending migrations
- [ ] All new secrets are set via `wrangler secret put`
- [ ] TypeScript compiles: `cd worker && npx tsc --noEmit`
- [ ] `cd frontend && npm run build` completes without errors
- [ ] Dashboard `/api/reports/overview` returns 200

---

## Deployment — FULL sequence every time

**GitHub push to `main` DOES deploy to Cloudflare via `.github/workflows/deploy.yml`.**
That workflow builds the frontend, deploys the LOADER worker first, then deploys the main worker.
What it does **not** do:
- run D1 migrations
- restart the local `discord-bot` process if you host it outside GitHub Actions

```bash
# 1. TypeScript check (must pass — zero errors)
cd worker && npx tsc --noEmit && cd ..

# 2. Build frontend
cd frontend && npm run build && cd ..

# 3. Run pending DB migrations (only if schema changed)
npx wrangler d1 execute webxni-db --file=db/migrations/XXXX_description.sql --remote

# 4. Commit your changes
git add <changed files>
git commit -m "Description of what changed"

# 5. Push to GitHub (this triggers the Cloudflare deploy workflow)
git push
```

Do steps 1–2 first, then commit + push, and run D1 migrations for any schema changes.
If the GitHub Actions deploy fails, the code is pushed but not live.
If the D1 migration is skipped, the new runtime may deploy successfully but fail at runtime on missing schema.

Or: `bash deploy.sh` for a manual local deploy when CI is not being used.
