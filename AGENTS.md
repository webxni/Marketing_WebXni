# AGENTS.md

Shared brief for AI collaborators (Claude Code, Codex, Gemini, others) working in
this repository. Read this **before** writing code. Then read the deeper docs
listed below for the area you are touching.

---

## What this app is — in one paragraph

A multi-tenant marketing automation platform for the WebXni agency. Cloudflare
Workers backend (Hono + TypeScript) → D1 (SQLite) → R2 (media) → Upload-Post API,
WordPress REST, Notion. SvelteKit 2 frontend served as Cloudflare Assets. A
local Discord bot (`pm2: webxni-bot`) provides chat-based control and runs
approved terminal jobs (Claude Code CLI for content generation). Live URL:
`https://marketing.webxni.com`.

---

## Read these before changing anything

| File        | Read when you are touching…                                          |
|-------------|----------------------------------------------------------------------|
| `CLAUDE.md` | Anything. This is the canonical project rulebook (constraints, conventions, common tasks). |
| `CODEX.md`  | Architecture-level changes. Full audit of the system.                |
| `BOT.md`    | Discord bot, weekly content generation, terminal Claude Code routing.|
| `README.md` | First-time orientation, stack overview, deploy sequence.             |

If your change is non-trivial and you have not read `CLAUDE.md`, stop and read it.

---

## Hard rules (do not violate)

These are summarised from `CLAUDE.md` — see that file for the long form.

1. **Additive only.** Preserve existing flows, forms, and patterns. The dark UI,
   sidebar nav, Google-Blue (`#1a73e8`) accent, and current page layouts are
   intentional. Do not redesign.
2. **No new columns in `db/schema.sql`.** Add a new file under `db/migrations/`
   in sequence (currently at `0029` — next is `0030`). After adding a column,
   sync `worker/src/types.ts` and `frontend/src/lib/types.ts`.
3. **No string-interpolated SQL.** Every query lives in `worker/src/db/queries.ts`
   using prepared statements with `.bind(...)`.
4. **No raw `fetch` in Svelte components.** All API calls go through typed
   wrappers in `frontend/src/lib/api/`.
5. **Svelte 4 syntax only** (`bind:value`, `on:click`). Not Svelte 5 runes.
6. **Claude weekly content uses terminal Claude Code, not the Anthropic API.**
   See `BOT.md` for the routing rules — generation must enqueue an
   `approved_command_jobs` row, never call `planGeneration` for
   `provider: 'claude'`.
7. **Do not regenerate working code to "improve" it.** Touch the minimum needed
   for the task at hand.

---

## How content generation flows

Two providers, two paths:

```
provider: openai                    provider: claude
────────────────                    ────────────────
/api/run/generate                   /api/run/generate
  ↓ planGeneration() (waitUntil)      ↓ prepareGenerationPlan()
  ↓ /internal/gen-step (per slot)     ↓ createApprovedCommandJob()
  ↓ generateWithOpenAI()              ↓ (worker stops here)
  ↓ saveGeneratedSlotResult()
                                    Local Discord bot polls
                                    `/internal/discord/approved-jobs/claim`
                                      ↓ spawns scripts/run-approved-claude-job.mjs
                                      ↓ which runs `claude -p ...` (terminal CLI)
                                      ↓ POSTs result back to /save-slot
```

The Resume button (`POST /api/run/generate/runs/:id/resume`) detects the
provider from the slot plan and re-routes Claude resumes back into the
approved-jobs queue rather than hitting the worker API path.

Topic-research stage runs OpenAI as a fallback when generation provider is
Claude and no Anthropic key is configured — so the prompt fed to terminal
Claude still carries researched topic / keyword / format data.

---

## Deploy

The **only** deploy path is GitHub Actions (`.github/workflows/deploy.yml`).
Push to `main` triggers it. Cloudflare's "Workers Builds" auto-deploy is
disabled — do not re-enable it (causes duplicate races and confusing build
failures from rolled tokens).

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — token with Workers, D1, R2, KV permissions on the
  account.
- `CLOUDFLARE_ACCOUNT_ID` — `f0488d50718e6e50e4049a7d34143ec6`.

Local manual deploy (only if CI is broken):

```bash
cd worker && npx tsc --noEmit          # must pass
cd frontend && npm run build           # must pass
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

D1 migrations are **not** run by CI. After merging a migration:

```bash
npx wrangler d1 execute webxni-db --file=db/migrations/XXXX_xxx.sql --remote
```

After changing `discord-bot/bot.js`:

```bash
pm2 restart webxni-bot
```

---

## Verification before declaring "done"

For any change touching the worker:

```bash
cd worker && npx tsc --noEmit          # zero errors required
```

For any change touching the frontend:

```bash
cd frontend && npm run check && npm run build
```

For UI/frontend changes: actually use the feature in the browser. Type checks
verify code, not feature correctness. If you cannot test in the browser, say so
explicitly — do not claim success.

For changes touching blog rendering: run the production repair endpoint after
deploy (see `CLAUDE.md` → "Production repair command").

---

## Operational pointers

- Active clients, cron schedule, secrets, R2/KV bindings: `CLAUDE.md`
- Posting pipeline, status lifecycle, preflight: `CLAUDE.md` + `CODEX.md`
- Approved-jobs queue, runner script, security whitelist: `BOT.md`
- WordPress publishing + repair conventions: `CLAUDE.md` (top section)

---

## What to ask before changing things

- Is the user reporting a bug? Get the symptom and a recent run id; do not
  refactor the surrounding area.
- Is this a new feature? Confirm scope. Do not introduce abstractions or
  feature flags for hypothetical future requirements.
- Is the change cross-cutting (DB + worker + frontend)? List the files you will
  touch and the migration number you will use, then confirm before editing.
- Will the change affect a deployed cron, posting flow, or weekly content run
  that is in progress? Cancel or wait for the run to settle before deploying.
