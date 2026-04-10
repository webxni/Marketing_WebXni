# Marketing_WebXni

Full-stack marketing automation platform built on Cloudflare Workers + D1 + SvelteKit.
Manages multi-client social media posting, WordPress blog drafting, content approvals, and scheduling.

---

## Stack

| Layer       | Technology                              |
|-------------|------------------------------------------|
| Backend     | Cloudflare Workers, Hono (TypeScript)    |
| Database    | Cloudflare D1 (SQLite)                   |
| File storage| Cloudflare R2 (media + images buckets)   |
| Sessions    | Cloudflare KV                            |
| Frontend    | SvelteKit 2 + Svelte 5, TailwindCSS 3   |
| Posting     | Upload-Post API                          |
| Blog        | WordPress REST API (per-client)          |
| Import      | Notion API                               |
| Auth        | HTTP-only session cookie + RBAC (5 roles)|

---

## Architecture

```
Marketing_WebXni/
├── db/
│   ├── schema.sql                    # Full D1 schema (run once on new DB)
│   └── migrations/
│       ├── 0002_accounts_map_seed.sql
│       ├── 0003_services_areas.sql
│       └── 0004_wp_gbp_notion.sql    # WordPress creds, GBP fields, Notion IDs
├── worker/
│   └── src/
│       ├── index.ts                  # Hono app entry + cron handler
│       ├── types.ts                  # Shared DB row types + Env bindings
│       ├── middleware/               # auth.ts (SESSION KV), rateLimit.ts
│       ├── db/queries.ts             # All D1 prepared statements
│       ├── routes/                   # One file per API group
│       │   ├── clients.ts            # Client CRUD + platform pause/unpause
│       │   ├── wordpress.ts          # /api/clients/:slug/wordpress/*
│       │   ├── notion.ts             # /api/notion/import|export|sync-log
│       │   ├── posts.ts              # Post lifecycle (draft→approved→ready→posted)
│       │   ├── reports.ts            # Dashboard stats + monthly reports
│       │   └── ...
│       ├── services/
│       │   ├── uploadpost.ts         # Upload-Post API client
│       │   ├── wordpress.ts          # WP REST API client + token renderer
│       │   └── notion.ts             # Notion API client + property helpers
│       ├── modules/
│       │   ├── preflight.ts          # 12-point validation before each post
│       │   ├── captions.ts           # Per-platform caption extraction
│       │   ├── posting.ts            # Tracking ID extraction
│       │   ├── media.ts              # Media type inference
│       │   └── idempotency.ts        # Idempotency key generation
│       └── loader/
│           ├── index.ts              # LOADER worker entry point
│           └── posting-run.ts        # Full automation run (Upload-Post)
└── frontend/
    └── src/
        ├── lib/
        │   ├── api/                  # Typed fetch wrappers per resource
        │   ├── components/           # Shared UI components
        │   ├── stores/               # auth.ts, ui.ts (toasts)
        │   └── types.ts              # Frontend type mirror of DB rows
        └── routes/(app)/
            ├── dashboard/            # Overview + recent jobs
            ├── clients/              # CRUD + WordPress config
            ├── posts/new             # Post composer + GBP advanced fields
            ├── approvals/
            ├── automation/
            ├── calendar/
            ├── reports/
            └── settings/
```

---

## Setup

### 1. Clone + install

```bash
git clone https://github.com/webxni/Marketing_WebXni
cd Marketing_WebXni
cd worker  && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Create Cloudflare resources

```bash
# D1 database
wrangler d1 create webxni-db

# R2 buckets
wrangler r2 bucket create webxni-media
wrangler r2 bucket create webxni-images

# KV namespace
wrangler kv namespace create KV_BINDING
```

Update the IDs in `wrangler.toml` after creation.

### 3. Apply schema + migrations

```bash
# Initial schema
wrangler d1 execute webxni-db --file=db/schema.sql --remote

# Migrations (run in order)
wrangler d1 execute webxni-db --file=db/migrations/0002_accounts_map_seed.sql --remote
wrangler d1 execute webxni-db --file=db/migrations/0003_services_areas.sql --remote
wrangler d1 execute webxni-db --file=db/migrations/0004_wp_gbp_notion.sql --remote
```

### 4. Set secrets

```bash
wrangler secret put UPLOAD_POST_API_KEY    # from upload-post.com dashboard
wrangler secret put OPENAI_API_KEY         # for AI content generation
wrangler secret put NOTION_API_TOKEN       # for Notion import (optional)
```

For the **LOADER** worker (same secrets):
```bash
wrangler secret put UPLOAD_POST_API_KEY --config wrangler.loader.toml
wrangler secret put OPENAI_API_KEY      --config wrangler.loader.toml
```

### 5. Build + deploy

```bash
bash deploy.sh
# Or manually:
cd frontend && npm run build && cd ..
wrangler deploy
```

### 6. First login

Hit `/api/setup` with your credentials to create the first admin user.

---

## WordPress Integration (per client)

Each client stores independent WordPress credentials. Configure in **Clients → Edit → WordPress Integration**.

| Field                    | Description |
|--------------------------|-------------|
| `wp_base_url`            | Site URL e.g. `https://example.com` |
| `wp_username`            | WordPress login username |
| `wp_application_password`| Generated in WP Admin → Users → Application Passwords |
| `wp_default_post_status` | `draft` (safe default) or `publish` |
| `wp_default_author_id`   | WP user ID — use "Pull Authors" to find |
| `wp_default_category_ids`| JSON array e.g. `[1, 5, 12]` — use "Pull Categories" |
| `wp_template_key`        | References a `wp_templates` entry for HTML formatting |

### Clients requiring WordPress

- caliviewbuilders.com
- americasprofessionalbuildersinc.com
- danielslockkey.com
- unlockedpros.com
- 247lockoutpasadena.com
- goldentouch-roofing.com
- 724locksmithca.com
- marvinsolis.com
- eliteteambuildersinc.com

### WordPress Template tokens

Templates use `{{token}}` syntax. Available tokens:

```
{{title}}           post.title
{{content}}         post.blog_content
{{excerpt}}         post.blog_excerpt
{{keyword}}         post.target_keyword
{{meta_description}}post.meta_description
{{client_name}}     client.canonical_name
{{cta}}             cta text from brand_json
{{phone}}           phone from brand_json
{{primary_color}}   primary_color from brand_json
```

---

## Notion Import

### Import clients
```bash
POST /api/notion/import/clients
{
  "database_id": "YOUR_NOTION_DB_ID",
  "prop_map": {
    "name":                    "Business Name",
    "upload_post_profile":     "Upload-Post Profile",
    "wp_domain":               "Website",
    "wp_username":             "WP Username",
    "wp_application_password": "WP App Password"
  }
}
```

### Import posts
```bash
POST /api/notion/import/posts
{
  "database_id": "CONTENT_DB_ID",
  "prop_map": {
    "title":          "Post Name",
    "client_name":    "Client",
    "publish_date":   "Publish Date",
    "status":         "Status",
    "platforms":      "Platforms",
    "master_caption": "Caption"
  }
}
```

### Export status back to Notion
```bash
POST /api/notion/export/post/:postId
{ "status_prop": "Posting Status", "url_prop": "Post URL" }
```

**Safety rule:** Notion import never overwrites a non-empty local field with an empty Notion value.

---

## Upload-Post Integration

Set the `upload_post_profile` field on each client to the exact profile slug in Upload-Post.

Per-platform IDs stored in `client_platforms`:

| Platform       | Required field              |
|----------------|-----------------------------|
| Facebook       | `page_id`                   |
| LinkedIn       | `page_id`                   |
| Pinterest      | `upload_post_board_id`      |
| Google Business| `upload_post_location_id`   |

---

## Google Business Profile — Advanced Post Fields

When `google_business` is selected in the post composer, the GBP panel appears:

| Field                | Values / Notes |
|----------------------|----------------|
| `gbp_topic_type`     | STANDARD / EVENT / OFFER |
| `gbp_cta_type`       | LEARN_MORE / BOOK / ORDER / SHOP / SIGN_UP / CALL |
| `gbp_cta_url`        | Required for all CTA types except CALL |
| `gbp_event_title`    | Required for EVENT posts |
| `gbp_event_start_date` | Required for EVENT (YYYY-MM-DD) |
| `gbp_event_end_date`   | Required for EVENT |
| `gbp_coupon_code`    | OFFER posts |
| `gbp_redeem_url`     | OFFER posts |
| `gbp_terms`          | OFFER posts |

---

## Preflight Validation (12 checks)

Before any post is sent to Upload-Post:

| # | Check | Tag |
|---|-------|-----|
| 1 | upload_post_profile configured | SKIP |
| 2 | Client not manual-only | BLOCKED |
| 3 | Platform configured for client | SKIP |
| 4 | Platform not paused | SKIP |
| 5 | Caption not empty | SKIP |
| 6 | Pinterest board ID set | SKIP |
| 7 | GBP location ID set | SKIP |
| 8 | GBP CTA URL present when CTA type set | BLOCKED |
| 9 | GBP EVENT required fields present | BLOCKED |
| 10 | GBP OFFER has coupon or redeem URL | SKIP |
| 11 | publish_date not more than 7 days old | SKIP |
| 12 | Caption passes content restriction scan | BLOCKED |

`BLOCKED` = hard stop, never retry without human review.
`SKIP` = skip this platform this run, retry later after config fix.

---

## RBAC Roles

| Role     | Permissions |
|----------|-------------|
| admin    | Everything |
| manager  | Create/edit clients, approve posts, run posting |
| editor   | Create/edit posts |
| reviewer | Approve/reject posts |
| operator | Trigger posting runs, view logs |

---

## API Reference (key endpoints)

```
GET    /api/clients                        List clients
POST   /api/clients                        Create client
GET    /api/clients/:slug                  Client detail (+ platforms, GBP, restrictions)
PUT    /api/clients/:slug                  Update client (incl. WP credentials)
GET    /api/clients/:slug/wordpress/status WP connection status
POST   /api/clients/:slug/wordpress/test   Test WP credentials live
GET    /api/clients/:slug/wordpress/categories  Pull WP categories
GET    /api/clients/:slug/wordpress/authors     Pull WP authors
POST   /api/clients/:slug/wordpress/templates   Save WP template
POST   /api/notion/import/clients          Import clients from Notion
POST   /api/notion/import/posts            Import posts from Notion
POST   /api/notion/export/post/:id         Write posting status to Notion
GET    /api/reports/overview               Dashboard stats
POST   /api/run/posting                    Trigger posting job
GET    /api/health                         Health check
```

---

## Cron Schedule

| Schedule     | Action |
|--------------|--------|
| `0 7 * * SUN`| Phase 1 content generation (Sunday 7AM) |
| `0 2 * * *`  | Fetch real post URLs from Upload-Post (daily 2AM) |
| `0 */6 * * *`| Automated posting check (every 6 hours) |

---

## Development

```bash
# Local development (worker)
cd worker && npx wrangler dev --local

# Local development (frontend)
cd frontend && npm run dev
```

The frontend proxies `/api/*` to the worker via Vite's `server.proxy` config.
