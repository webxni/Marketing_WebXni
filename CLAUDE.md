# CLAUDE.md — AI Collaboration Guide for Marketing_WebXni

This file tells Claude (and any future AI assistant) how to work with this codebase effectively.
Read this before making any changes.

---

## What this app is

A full-stack marketing automation platform for a social media agency.
It manages multiple client accounts and automates posting to Facebook, Instagram, LinkedIn, TikTok, Pinterest, Google Business, YouTube, X, Threads, Bluesky, and WordPress blogs.

**Core workflow:**
1. Content is created/imported (posts table)
2. Posts go through an approval pipeline: draft → approved → ready → scheduled → posted
3. Automation reads ready posts and submits them to Upload-Post API
4. WordPress blog posts are drafted via WP REST API
5. Notion is used as a source of truth for some content; we import from it and write status back

---

## Critical constraints — always follow these

### Never rewrite working code
- This is an **additive upgrade** project. Preserve existing flows, forms, and patterns.
- If something works, don't touch it. Add alongside, not on top.
- The dark UI, sidebar nav, and current page layouts are intentional — do not redesign.

### Database changes go in migrations
- Never edit `db/schema.sql` to add new columns. Write a new migration file in `db/migrations/`.
- Name migrations `XXXX_short_description.sql` in sequence.
- Migrations use `ALTER TABLE ADD COLUMN` — D1 supports SQLite syntax.
- Run: `wrangler d1 execute webxni-db --file=db/migrations/0005_xxx.sql --remote`

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
- Use `bind:value` for form state, `on:click` for events (Svelte 4/5 legacy syntax)
- All types are in `frontend/src/lib/types.ts` — keep them in sync with `worker/src/types.ts`

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
Upload-Post API   WordPress REST API   Notion API
```

The LOADER worker runs posting jobs in the background via `ctx.waitUntil()`.
The main worker handles all HTTP traffic.

---

## Key files

| File | What it does |
|------|-------------|
| `worker/src/index.ts` | Router — register new routes here |
| `worker/src/types.ts` | All DB row types + Env bindings |
| `worker/src/db/queries.ts` | Every DB query — add new ones here |
| `worker/src/modules/preflight.ts` | Pre-posting validation (12 checks) |
| `worker/src/services/uploadpost.ts` | Upload-Post API client |
| `worker/src/services/wordpress.ts` | WordPress REST API client |
| `worker/src/services/notion.ts` | Notion API client + helpers |
| `worker/src/loader/posting-run.ts` | The automation posting loop |
| `frontend/src/lib/types.ts` | Frontend type definitions |
| `frontend/src/lib/api/clients.ts` | All client-related API calls |
| `frontend/src/lib/api/posts.ts` | All post-related API calls |
| `db/schema.sql` | Canonical schema (DO NOT edit to add columns) |
| `db/migrations/` | Add columns here |
| `wrangler.toml` | Bindings, crons, domains |

---

## Post status lifecycle

```
draft → approved → ready → scheduled → posted
                        ↘ failed
                        ↘ cancelled
```

Gates before a post can be sent:
- `ready_for_automation = 1` (all content fields present)
- `asset_delivered = 1` (media file uploaded to R2)
- Status = `ready`
- Preflight validation passes for each platform

---

## Current clients (WordPress sites)

| Slug                            | Domain |
|---------------------------------|--------|
| caliview-builders               | caliviewbuilders.com |
| americas-professional-builders  | americasprofessionalbuildersinc.com |
| daniels-locksmith               | danielslockkey.com |
| unlocked-pros                   | unlockedpros.com |
| 247-lockout-pasadena            | 247lockoutpasadena.com |
| golden-touch-roofing            | goldentouch-roofing.com |
| 724-locksmith-ca                | 724locksmithca.com |
| marvin-solis                    | marvinsolis.com |
| elite-team-builders             | eliteteambuildersinc.com |

---

## GBP multi-location (Elite Team Builders)

ETB has 3 GBP locations — LA, WA, OR.
These are stored in `client_gbp_locations` table.
Captions: `cap_gbp_la`, `cap_gbp_wa`, `cap_gbp_or` on the post.
Each location has its own `upload_post_location_id`.

---

## Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| `UPLOAD_POST_API_KEY` | Upload-Post API auth |
| `OPENAI_API_KEY` | AI content generation |
| `NOTION_API_TOKEN` | Notion import/export (optional) |

---

## What's NOT implemented yet (future work)

- AI content generation (Phase 1/2 cron runs) — stubs exist in `index.ts` + `generation_runs` table
- Automatic WordPress post creation during posting runs — `wp_post_url` field exists, service is ready
- Fetch real URLs from Upload-Post history (daily 2AM cron) — stub exists
- Notion auto-sync on cron schedule (currently manual via API)
- PDF export for monthly reports
- Canva API integration (links are stored reference-only)

---

## Common tasks

### Add a new API route
1. Create `worker/src/routes/my-feature.ts` with a Hono instance
2. Import and register in `worker/src/index.ts`
3. Add typed fetch wrapper in `frontend/src/lib/api/`

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

### Test WordPress connection for a client
```bash
curl -X POST https://marketing.webxni.com/api/clients/elite-team-builders/wordpress/test \
  -H "Cookie: session=YOUR_SESSION"
```

### Run Notion import
```bash
curl -X POST https://marketing.webxni.com/api/notion/import/clients \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION" \
  -d '{
    "database_id": "YOUR_NOTION_DB_ID",
    "prop_map": {
      "name": "Business Name",
      "upload_post_profile": "Upload-Post Profile"
    }
  }'
```

---

## What to check before deploying

- [ ] `wrangler d1 execute` any pending migrations
- [ ] All new secrets are set via `wrangler secret put`
- [ ] `cd frontend && npm run build` completes without errors
- [ ] TypeScript compiles: `cd worker && npx tsc --noEmit`
- [ ] Test connection works for at least one WordPress client
- [ ] Dashboard `/api/reports/overview` returns 200

---

## Deployment

```bash
bash deploy.sh
```

Or manually:
```bash
cd frontend && npm run build && cd ..
wrangler deploy
```
