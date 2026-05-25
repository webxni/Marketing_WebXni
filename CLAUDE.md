# CLAUDE.md

Focused implementation notes for Claude Code contributors working on content generation, blog publishing, and Discord/agent generation flows in this repository. Read `AGENTS.md` first for the full project rules. This file only adds Claude-specific workflow guidance for the parts that are easy to regress.

## Core Rules

- Weekly content with `provider=claude` must use the approved terminal job path.
- Do not call the Anthropic API path for weekly Claude runs.
- Blog publishing is a WordPress workflow first. Social/blog distribution happens after the real WordPress URL exists.
- Do not treat blog distribution as a video workflow.

## Weekly Generation

Relevant files:

- `worker/src/loader/generation-run.ts`
- `worker/src/routes/run.ts`
- `worker/src/routes/discord.ts`
- `scripts/run-approved-claude-job.mjs`
- `worker/src/db/queries.ts`

Current required behavior:

- Weekly generation must use package schedule + monthly content plan + client intelligence + services + areas + platform rules + previous history.
- Approved monthly topics are used first, then unused planned monthly topics, then researched fallback topics.
- Duplicate topics inside the recent history window must not silently create repetitive content.
- Generation logs must show per-slot client, date, content type, selected topic, selected platforms, provider, and created/skipped/failed result.

Claude-specific rule:

- `provider=claude` stops after planning and enqueues an `approved_command_jobs` row.
- The Discord bot claims the approved job and runs `scripts/run-approved-claude-job.mjs`.
- The runner sends `topic_selection` back when saving slots so monthly-topic linkage and anti-repetition metadata are preserved.

## Blog Generation

Relevant files:

- `worker/src/loader/autonomous-content.ts`
- `worker/src/services/openai.ts`
- `worker/src/modules/platform-compatibility.ts`

Current required behavior:

- `content_type='blog'` remains a `website_blog` content workflow.
- Blog generation must still create:
  - title
  - excerpt
  - blog body
  - SEO title
  - target keyword
  - secondary keywords
  - meta description
  - slug
  - Spanish designer prompt
- Blog generation must also generate short adapted distribution captions for connected non-video platforms using the `[blog_url]` placeholder:
  - `google_business`
  - `facebook`
  - `instagram`
  - `linkedin`
  - `x`
  - `threads`
  - `pinterest`
  - `bluesky`

Important:

- Do not expand the blog platform rule itself into a social/video rule.
- Keep blog generation and blog distribution as separate concerns.

## Blog Publish And Distribution

Relevant files:

- `worker/src/modules/blog-publishing.ts`
- `worker/src/routes/blog.ts`
- `worker/src/loader/blog-regen.ts`

Current required behavior:

1. Publish the main blog to WordPress.
2. Save the real published URL to `posts.wp_post_url`.
3. Replace `[blog_url]` in all generated distribution caption fields with that exact real URL.
4. Upsert a related non-video distribution post keyed by `automation_slot_key = blog_distribution:<blog_post_id>`.

Distribution post rules:

- Use connected non-video platforms only.
- Exclude failed/paused connections.
- Reuse the blog image when available.
- Use `content_type='image'` when an image exists, otherwise `content_type='text'`.
- For Google Business, set `gbp_cta_type='LEARN_MORE'` and `gbp_cta_url=<real wp url>`.

Important:

- Republishing or syncing a blog must refresh the related distribution post, not duplicate it.
- Existing published blogs must also pick up the expanded distribution-caption replacement logic through sync/regen paths.

## Agent / Chatbot Batch Blog Creation

Relevant files:

- `worker/src/routes/ai.ts`
- `worker/src/agent/context.ts`
- `worker/src/agent/skills.md`
- `worker/src/agent/tools.md`
- `worker/src/agent/memories.md`

Current required behavior:

- If the user requests `X` blog posts, the system must plan `X` slots.
- The batch path must not silently clamp counts to `20`.
- Current supported maximum is `60` slots per call.
- Batch creation must return a persistent `run_id`.
- Per-slot results must be trackable as created, skipped, or failed through `generation_runs`.
- Batch blog generation must not satisfy the request by silently updating an old similar draft unless the workflow explicitly calls for reuse.
- For natural-language blog requests with missing inputs, the agent should ask short follow-up questions to gather:
  - client
  - topics or topic source
  - count
  - when to post or whether to leave scheduling for later
- Do not guess those missing intake fields for batch blog work.

Important:

- Use the existing `generation_runs` record for batch observability.
- Keep per-slot logging append-only so operators can audit why the count created was lower than the count requested.

## Do Not Regress

- Claude weekly content uses terminal Claude Code, not API Claude.
- Blog posts publish to WordPress before distribution URLs are finalized.
- Distribution uses the exact saved WordPress URL, not a guessed slug.
- Instagram and other connected non-video platforms receive short adapted blog-promo captions when supported.
- Batch blog generation returns a real run summary instead of console-only background failures.
