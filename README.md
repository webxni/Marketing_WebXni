# Marketing_WebXni

Full-stack marketing automation platform for the WebXni agency. Manages
multi-client social media posting, WordPress blog drafting, content approvals,
scheduling, and AI-assisted content generation.

**Live URL:** https://marketing.webxni.com
**AI agents:** read [`AGENTS.md`](AGENTS.md) before changing code.
Discord bot details: [`BOT.md`](BOT.md).

---

## Stack

| Layer        | Technology                                |
|--------------|--------------------------------------------|
| Backend      | Cloudflare Workers, Hono (TypeScript)      |
| Database     | Cloudflare D1 (SQLite)                     |
| File storage | Cloudflare R2 (`MEDIA` + `IMAGES` buckets) |
| Sessions     | Cloudflare KV                              |
| Frontend     | SvelteKit 2 + Svelte 5 (legacy syntax) + TailwindCSS 3 |
| Posting      | Upload-Post API                            |
| Blog         | WordPress REST API (per client)            |
| Import       | Notion API                                 |
| AI           | OpenAI (worker path) + Claude Code CLI (terminal path via Discord bot) |
| Auth         | HTTP-only session cookie + RBAC (5 roles)  |

---

## Repository layout

```
Marketing_WebXni/
├── AGENTS.md              # Canonical brief for AI collaborators
├── BOT.md                 # Discord bot architecture + Claude routing rules
├── README.md              # This file (setup + usage)
├── deploy.sh              # Manual local deploy helper
├── wrangler.toml          # Main worker config (bindings, crons, domain)
├── wrangler.loader.toml   # LOADER worker config
├── db/
│   ├── schema.sql                    # Canonical schema (DO NOT add columns here)
│   └── migrations/                   # 0001..0029 — next is 0030
├── worker/src/
│   ├── index.ts                      # Hono app entry + cron handler
│   ├── types.ts                      # DB row types + Env bindings
│   ├── middleware/                   # auth.ts, rateLimit.ts
│   ├── db/queries.ts                 # All D1 prepared statements
│   ├── routes/                       # One file per API group
│   ├── services/                     # uploadpost, wordpress, notion, openai, content-provider, discord
│   ├── modules/                      # preflight, captions, idempotency, etc.
│   └── loader/                       # posting-run, generation-run, recurring-gbp-run, repair-blogs
├── frontend/src/
│   ├── lib/
│   │   ├── api/                      # Typed fetch wrappers per resource
│   │   ├── components/               # Shared UI
│   │   ├── stores/                   # auth.ts, ui.ts (toasts)
│   │   └── types.ts                  # Frontend type mirror
│   └── routes/(app)/                 # dashboard, posts, clients, automation, etc.
├── discord-bot/
│   └── bot.js                        # Local Discord gateway bot (pm2: webxni-bot)
├── scripts/
│   └── run-approved-claude-job.mjs   # Terminal Claude Code runner
└── .github/workflows/
    └── deploy.yml                    # CI deploy (push-to-main triggers it)
```

---

## First-time setup

### 1. Clone + install

```bash
git clone https://github.com/webxni/Marketing_WebXni
cd Marketing_WebXni
npm install --prefix worker
npm install --prefix frontend
```

### 2. Create Cloudflare resources

```bash
wrangler d1 create webxni-db
wrangler r2 bucket create webxni-media
wrangler r2 bucket create webxni-images
wrangler kv namespace create KV_BINDING
```

Update the IDs in `wrangler.toml` after creation.

### 3. Apply schema + migrations

```bash
wrangler d1 execute webxni-db --file=db/schema.sql --remote
for f in db/migrations/*.sql; do
  wrangler d1 execute webxni-db --file="$f" --remote
done
```

### 4. Set Cloudflare secrets

```bash
wrangler secret put UPLOAD_POST_API_KEY     # upload-post.com dashboard
wrangler secret put OPENAI_API_KEY          # AI generation + topic research
wrangler secret put NOTION_API_TOKEN        # optional
wrangler secret put ANTHROPIC_API_KEY       # optional — only for worker-API Claude path
```

LOADER worker also needs the same Upload-Post + OpenAI keys:

```bash
wrangler secret put UPLOAD_POST_API_KEY --config wrangler.loader.toml
wrangler secret put OPENAI_API_KEY      --config wrangler.loader.toml
```

### 5. Set GitHub secrets (for CI deploys)

```bash
gh secret set CLOUDFLARE_API_TOKEN     # Workers + D1 + R2 + KV scope
gh secret set CLOUDFLARE_ACCOUNT_ID    # f0488d50718e6e50e4049a7d34143ec6
```

### 6. Deploy

Push to `main` and GitHub Actions deploys both workers (LOADER first, then
main). For a manual deploy:

```bash
bash deploy.sh
```

### 7. First login

Hit `/api/setup` with credentials to create the first admin user.

### 8. Run the local Discord bot (optional, only for terminal Claude content)

```bash
cd discord-bot
npm install
pm2 start bot.js --name webxni-bot
```

---

## Local development

```bash
# Worker (port 8787)
npx wrangler dev

# Frontend (port 5173, proxies /api/* to :8787)
cd frontend && npm run dev
```

---

## Deploy

GitHub push to `main` deploys to Cloudflare automatically via
`.github/workflows/deploy.yml`. The workflow builds the frontend, deploys the
LOADER worker, then deploys the main worker. **Cloudflare's "Workers Builds"
auto-deploy is intentionally disabled** — keep it that way.

What CI does **not** do:

- Run D1 migrations (must run with `wrangler d1 execute --remote`).
- Restart the local Discord bot (`pm2 restart webxni-bot` after `bot.js` changes).

---

## RBAC roles

| Role     | Permissions |
|----------|-------------|
| admin    | Everything |
| manager  | Create/edit clients, approve posts, run posting |
| editor   | Create/edit posts |
| reviewer | Approve/reject posts |
| operator | Trigger posting runs, view logs |

---

## WordPress integration (per client)

Each client stores independent credentials. Configure via
**Clients → Edit → WordPress Integration**.

| Field                      | Description |
|----------------------------|-------------|
| `wp_base_url`              | Site URL e.g. `https://example.com` |
| `wp_username`              | WordPress login username |
| `wp_application_password`  | WP Admin → Users → Application Passwords |
| `wp_default_post_status`   | `draft` (safe default) or `publish` |
| `wp_default_author_id`     | Use the **Pull Authors** button to find |
| `wp_default_category_ids`  | JSON array, e.g. `[1, 5, 12]` |
| `wp_template_key`          | References a `wp_templates` entry for HTML formatting |

Test connection:

```bash
curl -X POST https://marketing.webxni.com/api/clients/<slug>/wordpress/test \
  -H "Cookie: session=YOUR_SESSION"
```

### Template tokens

Templates use `{{token}}` syntax:

```
{{title}}            post.title
{{content}}          post.blog_content
{{excerpt}}          post.blog_excerpt
{{keyword}}          post.target_keyword
{{meta_description}} post.meta_description
{{client_name}}      client.canonical_name
{{cta}}              cta text from brand_json
{{phone}}            phone from brand_json
{{primary_color}}    primary_color from brand_json
```

### Blog repair (after renderer changes)

```bash
curl -sS -X POST https://marketing.webxni.com/internal/repair-blogs \
  -H 'x-repair-key: repair-posts-2026-04-14-webxni'
```

Then verify a repaired row in remote D1 (`posts.blog_content`).

---

## Notion import

### Import clients

```bash
POST /api/notion/import/clients/full
{
  "database_id": "87e495b2-350a-45eb-a343-f6441dafa6cb",
  "active_only": true,
  "notion_id_to_app_slug": { "<notion_page_id>": "<app_slug>", ... }
}
```

Use `force_sub_tables: true` to re-import services / areas / offers for
existing clients.

### Import posts

```bash
POST /api/notion/import/posts
{
  "database_id": "<CONTENT_DB_ID>",
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

**Safety:** Notion import never overwrites a non-empty local field with an
empty Notion value.

---

## Upload-Post integration

Set `upload_post_profile` on each client to the exact profile slug. Per-platform
IDs live in `client_platforms`:

| Platform        | Required field              |
|-----------------|-----------------------------|
| Facebook        | `page_id`                   |
| LinkedIn        | `page_id`                   |
| Pinterest       | `upload_post_board_id`      |
| Google Business | `upload_post_location_id`   |

---

## Google Business Profile — advanced post fields

When `google_business` is selected in the post composer, the GBP panel
appears:

| Field                  | Values / Notes |
|------------------------|----------------|
| `gbp_topic_type`       | STANDARD / EVENT / OFFER |
| `gbp_cta_type`         | LEARN_MORE / BOOK / ORDER / SHOP / SIGN_UP / CALL |
| `gbp_cta_url`          | Required for all CTA types except CALL |
| `gbp_event_title`      | Required for EVENT |
| `gbp_event_start_date` | Required for EVENT (YYYY-MM-DD) |
| `gbp_event_end_date`   | Required for EVENT |
| `gbp_coupon_code`      | OFFER posts |
| `gbp_redeem_url`       | OFFER posts |
| `gbp_terms`            | OFFER posts |

Recurring GBP offers/events are configured per client (Offers and Events
tabs) and run automatically as the first step of the every-6h cron in
`worker/src/loader/recurring-gbp-run.ts`.

---

## Preflight validation (12 checks)

Before any post is sent to Upload-Post:

| # | Check | Tag |
|---|-------|-----|
| 1 | `upload_post_profile` configured | SKIP |
| 2 | Client not manual-only | BLOCKED |
| 3 | Platform configured for client | SKIP |
| 4 | Platform not paused | SKIP |
| 5 | Caption not empty | SKIP |
| 6 | Pinterest board ID set | SKIP |
| 7 | GBP location ID set | SKIP |
| 8 | GBP CTA URL present when CTA type set | BLOCKED |
| 9 | GBP EVENT required fields present | BLOCKED |
| 10 | GBP OFFER has coupon or redeem URL | SKIP |
| 11 | `publish_date` not more than 7 days old | SKIP |
| 12 | Caption passes content restriction scan | BLOCKED |

`BLOCKED` = hard stop, never retry without human review.
`SKIP` = skip this platform this run, retry later after config fix.

---

## Cron schedule

| Schedule        | Action |
|-----------------|--------|
| `0 7 * * SUN`   | Sunday 7AM — weekly AI generation (stub) |
| `0 2 * * *`     | Daily 2AM — fetch real post URLs from Upload-Post |
| `0 */6 * * *`   | Every 6h — recurring GBP run, then automated posting check |

---

## API reference (key endpoints)

```
GET    /api/clients                              List clients
POST   /api/clients                              Create client
GET    /api/clients/:slug                        Client detail (+ platforms, GBP, restrictions)
PUT    /api/clients/:slug                        Update client (incl. WP credentials)
GET    /api/clients/:slug/wordpress/status       WP connection status
POST   /api/clients/:slug/wordpress/test         Test WP credentials live
GET    /api/clients/:slug/wordpress/categories   Pull WP categories
GET    /api/clients/:slug/wordpress/authors      Pull WP authors
POST   /api/clients/:slug/wordpress/templates    Save WP template
POST   /api/notion/import/clients/full           Full Notion client import
POST   /api/notion/import/posts                  Notion post import
POST   /api/notion/export/post/:id               Export posting status to Notion
GET    /api/reports/overview                     Dashboard stats
POST   /api/run/posting                          Trigger posting job
POST   /api/run/generate                         Trigger AI generation (provider: openai|claude)
POST   /api/run/generate/runs/:id/resume         Resume a partial run
GET    /api/run/queue                            Real actionable posting queue
POST   /api/posts/:id/generate-caption           Generate caption for new platform
POST   /api/posts/:id/translate                  Translate context to Spanish for designer
POST   /api/blog/publish                         Publish (or replace) WP blog
POST   /internal/repair-blogs                    Production blog repair job
GET    /api/health                               Health check
```

---

## Discord bot (terminal Claude Code path)

The local Discord bot (`pm2: webxni-bot`) provides:

- Slash commands for content creation and weekly generation.
- Natural-language chat with an AI agent.
- A polling runner that claims `approved_command_jobs` and spawns
  `claude -p` per slot via `scripts/run-approved-claude-job.mjs`.

Full architecture and routing rules: [`BOT.md`](BOT.md).

---

## Where to dig next

- **Adding a feature, fixing a bug, refactoring:** start with [`AGENTS.md`](AGENTS.md).
- **Touching the Discord bot or weekly content generation:** start with [`BOT.md`](BOT.md).
- **Onboarding a new client:** Notion full import (above) + WP credentials in the dashboard.
