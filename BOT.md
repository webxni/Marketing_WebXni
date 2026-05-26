# Discord Bot Notes

This file records the current Discord bot architecture, the terminal routing rules, and the constraints that must remain true in future work.

## Core Rule

For weekly content and approved content jobs:

- weekly generation uses the approved **terminal** workflow
- weekly generation must not use the worker OpenAI path
- the terminal backend may be `codex`, `gemini`, or `claude`, depending on what is available/authenticated

Do not regress this.

## Current Architecture

There are two Discord entry paths:

1. Native Discord slash commands handled by the Cloudflare Worker
   - route: `worker/src/routes/discord.ts`
   - slash command: `/weekly-content`

2. Natural-language / mention chat handled by the local Discord gateway bot
   - bot: `discord-bot/bot.js`
   - backend endpoint: `POST /api/ai/dispatch`

There is also a separate approved terminal job runner:

- bot poller: `discord-bot/bot.js`
- local runner script: `scripts/run-approved-terminal-job.mjs`
- queue table: `approved_command_jobs`

## Non-Negotiable Security Rules

Discord must never be allowed to run arbitrary shell commands.

Only approved internal command names may execute:

- `weekly_content_terminal`
- `regenerate_content_terminal`

Execution must stay whitelisted through:

- `worker/src/routes/discord.ts`
- `worker/src/db/queries.ts`
- `discord-bot/bot.js`

The bot runner must only spawn fixed local scripts with fixed arguments.

## Terminal Routing Rules

### Slash command flow

For `/weekly-content`:

1. Create `generation_run`
2. Build/store slot plan with `prepareGenerationPlan(...)`
3. Create `approved_command_jobs` row
4. Let local bot poller claim and execute the approved job
5. A terminal AI backend generates content in terminal
6. Save results back into existing posts system

Relevant files:

- `worker/src/routes/discord.ts`
- `worker/src/loader/generation-run.ts`
- `scripts/run-approved-terminal-job.mjs`
- `discord-bot/bot.js`

### Dashboard / Automation flow

For Automation page generation:

- must also enqueue approved terminal jobs
- must not call `planGeneration(...)` directly for weekly content

Relevant files:

- `frontend/src/routes/(app)/automation/+page.svelte`
- `worker/src/routes/run.ts`

### Agent / natural-language Discord flow

For messages like:

- `@webxni /weekly-content client:all`
- `Generate weekly content for all clients in the terminal`

The agent must route weekly generation into approved terminal jobs, not the worker API generation path.

Relevant files:

- `discord-bot/bot.js`
- `worker/src/routes/ai.ts`

## Important Behavior Already Implemented

### Approved job queue

DB migration:

- `db/migrations/0029_approved_command_jobs.sql`

Schema/table:

- `approved_command_jobs`

### Runner behavior

The local Discord bot:

- polls approved jobs every 10s
- claims one approved job at a time
- runs only whitelisted scripts
- reports progress back through internal endpoints

### Terminal self-review

`scripts/run-approved-terminal-job.mjs` does:

1. generate draft with the selected terminal backend
2. run review/improvement pass with the same backend
3. save only final improved result

### No-image default

Normal weekly content generation must remain:

- content only
- design prompts only
- no image generation by default

Only generate images when explicitly requested or when a specific workflow/package requires it.

## Date Range Rules

Current intended default for weekly content without explicit range:

- default to `this_week`

For Discord mention/text commands, do not rely on the LLM to infer week ranges from vague phrasing.
`discord-bot/bot.js` should convert pseudo-slash commands into deterministic tool-style instructions with exact ISO dates.

Example expected behavior when current date is `2026-04-27`:

- `this_week` => `2026-04-27` to `2026-05-03`
- `next_week` => `2026-05-04` to `2026-05-10`

## Known Files To Review Before Changing Bot Behavior

- `discord-bot/bot.js`
- `worker/src/routes/discord.ts`
- `worker/src/routes/ai.ts`
- `worker/src/routes/run.ts`
- `worker/src/loader/generation-run.ts`
- `scripts/run-approved-terminal-job.mjs`
- `worker/src/db/queries.ts`
- `frontend/src/routes/(app)/automation/+page.svelte`
- `worker/src/services/content-provider.ts`
- `worker/src/services/discord.ts`

## How To Continue Improving The Discord Bot

Recommended next improvements:

1. Add stronger confirmation messaging in Discord
   - always echo exact `client`, `provider`, `date_from`, `date_to`
   - explicitly say `Claude Code terminal job queued` for Claude runs

2. Add better history separation between slash-like text commands and general chat
   - pseudo-slash commands should bypass ambiguous conversational interpretation

3. Improve approved job observability
   - show queue age
   - show runner id
   - show per-slot progress
   - show final counts cleanly in Discord

4. Add retry helpers for approved terminal jobs
   - resume failed terminal runs from current slot
   - optionally expose retry action in UI

5. Add tests or at least fixture coverage for:
   - `/weekly-content client:all`
   - `/weekly-content client:all date_range:this_week`
   - `@webxni /weekly-content client:all`
   - dashboard generation through the terminal workflow

## Do Not Break These Expectations

- Weekly content uses the approved terminal workflow
- Discord cannot execute arbitrary shell
- Weekly content does not auto-generate images by default
- Same posts/content schema must be used regardless of provider
- Results must save into the existing posts system

## Deployment Notes

Current repo behavior:

- pushes to `main` trigger GitHub Actions deploy for worker/pages
- D1 migrations are still separate and must be run explicitly
- local Discord bot restart is separate and may still be required after bot changes

After changing `discord-bot/bot.js`, usually restart:

```bash
pm2 restart webxni-bot
```

After changing D1 schema, run the migration explicitly.
