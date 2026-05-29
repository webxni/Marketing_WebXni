# AI Agency Implementation Log

## 2026-05-29 Foundation Deployed

Commit: `8a61295 Add AI agency operating system foundation`

Implemented:

- `/agency` dashboard with overview cards, agent status, timeline, task board, approval pipeline, client coverage, findings, skills, harness flow, and logs.
- Remote D1 migration `0033_ai_agency_foundation.sql`.
- Protected `/api/agency/*` frontend endpoints.
- Protected `/internal/agency/*` runner endpoints.
- Discord slash commands `/agency-status` and `/agency-run`.
- Gateway bot natural-language routing for agency status and fixed agent runs.
- Fixed `agency_*` approved command names in the Discord bot whitelist.
- Local `.claude/skills/webxni-*` and `.claude/agents/*` definitions.
- Redaction helpers for Worker and script-side agency logs.

Production actions completed:

- Pushed `main`.
- GitHub Actions deploy succeeded.
- Applied migration to remote D1 database `webxni_db`.
- Restarted `pm2: webxni-bot`.
- Registered Discord slash commands.
- Verified `/internal/agency/status` returns live status.

## Current Runner Behavior

`scripts/run-approved-agency-job.mjs` is conservative by default. It does not call Claude Code, Gemini CLI, OpenAI, Anthropic API, or Codex unless `AGENCY_EXECUTE_AI=1` is set in the bot environment.

It now:

- claims only whitelisted `agency_*` jobs through the existing approved job poller
- reads a protected agency snapshot from `/internal/agency/snapshot`
- builds structured JSON output from current platform data
- creates agent findings for system/security/orchestrator issues
- can run agent-specific JSON-schema prompts through terminal Gemini, Claude, or Codex when explicitly enabled
- can save client research, strategy plans, content review notes, and draft posts through protected internal endpoints
- updates agent task/run/log records
- completes or fails the approved command job cleanly

Draft content creation has a second explicit gate: `AGENCY_ALLOW_DRAFT_POSTS=1`. Without it, social/blog agents can analyze and report but will not create draft posts.

## Protected Internal Save Endpoints

- `POST /internal/agency/research-note` -> `client_research_notes`
- `POST /internal/agency/strategy-plan` -> `client_strategy_plans`
- `POST /internal/agency/content-review` -> `content_review_notes`
- `POST /internal/agency/draft-post` -> `posts` with `status='draft'`, `ready_for_automation=0`, and `asset_delivered=0`

All endpoints require the Discord bot bearer secret and redact through existing query helpers.

## Scheduler State

`worker/src/loader/agency-scheduler.ts` is wired into the Worker scheduled handler, but it is disabled unless one of these is true:

- Worker env var `AGENCY_SCHEDULER_ENABLED=true`
- KV setting `settings:system.agency_scheduler_enabled=true`

When enabled, daily cron queues `security-sentinel`, `system-reliability`, and `client-research`. Sunday also queues `strategy`, `blog-writer`, `social-copy`, `editorial-review`, and `agency-orchestrator`. It dedupes per agent/day with audit markers.

## Safety Guarantees Preserved

The AI Agency system does not:

- run arbitrary shell commands from Discord or the frontend
- approve posts as Marvin
- mark designer assets delivered
- set posts ready for automation
- schedule or publish content
- publish WordPress blogs
- print secrets in agency logs or findings

All agent runs still go through `approved_command_jobs` and fixed script mapping in `discord-bot/bot.js`.

## Next Phases

1. Enable `AGENCY_EXECUTE_AI=1` in the bot environment after CLI credentials are confirmed.
2. Run one manual `client-research` job and inspect the saved note.
3. Run one manual `strategy` job and inspect the saved draft plan.
4. Enable `AGENCY_ALLOW_DRAFT_POSTS=1` only after draft quality is accepted.
5. Enable `agency_scheduler_enabled=true` only after manual runs are proven safe.
6. Add deeper UI task detail drawers and retry controls.

## Manual Verification Commands

```bash
cd /home/marvinesu/projects/Marketing_WebXni

cd worker && npx tsc --noEmit

cd ../frontend && npm run check && npm run build

cd ..
node --check discord-bot/bot.js
node --check scripts/run-approved-agency-job.mjs
node --check scripts/lib/agency-redaction.mjs

CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
  npx wrangler d1 execute webxni_db --remote \
  --command "SELECT slug, status, default_backend, command_name FROM agent_definitions ORDER BY created_at;"

pm2 restart webxni-bot --update-env
pm2 logs webxni-bot --lines 100
```
