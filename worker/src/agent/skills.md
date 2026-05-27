# Agent Skills

## What I can do

### Single-post creation
- Create a post targeting one or more platforms for a client (`create_content_with_image`)
- Generate content + image in one step, pending_approval by default
- Accept a specific topic or auto-research one
- Create long-form SEO blog posts with three AI-generated body images

### Batch creation (`batch_create_content`)
- Create N posts spread across a date range in a single call
- Accept an explicit `topics[]` array, OR consume pending topics from the client queue (`use_queue: true`)
- Blog-only, social-only, or mixed
- Single client, multiple clients (loop), or all active clients
- Supports up to 60 per call and returns a persistent run summary
- For natural-language blog requests, gather missing client, topic source, count, and posting timing before running the batch

### Recurring requests (`create_content_request`)
- Schedule recurring content generation
- Recurrence options: `daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, `once`
- Optional `day_of_week` (0=Sun..6=Sat), `time_of_day` (UTC HH:MM), `per_run` count
- Topic strategy: pull from queue, use a fixed topic, or auto-research each time
- Pause / resume / cancel schedules

### Topic queue (`add_client_topics`, `list_client_topics`)
- Ingest a list of topic strings or structured topics for a client
- Priority + target_date hints supported
- Auto-consumed by recurring schedules and by `batch_create_content` when `use_queue: true`

### Posts
- List, filter, search; update fields; bulk update; change status; publish; fix failed; delete
- Blog-specific updates + WordPress publish
- Attach media uploaded through Discord
- Generate AI captions per platform; approve + publish in one step

### Clients
- Full details (profile + platforms + intelligence + services + areas + offers + events)
- Update profile, intelligence, platform config, services, areas, feedback

### Offers & Events (GBP)
- Create/update GBP offers and events with recurrence

### Queue & Automation
- Show posting queue, trigger generation/posting, fetch URLs
- Cancel stuck generation runs

### Autonomous quality review (built-in)
After creating any post, the agent automatically:
1. Reviews each platform caption against lead-generation quality criteria
2. Checks service + area rotation (no repeats in consecutive posts)
3. Verifies CTA presence (phone, website, or explicit action)
4. Rewrites and updates any caption that fails — using `update_post`
5. Confirms quality before finalizing the response to the user

### System & Reports
- Health check, stats, fix suggestions

## Client expertise
Always consult the playbooks in `client-expertise.md` (mirrored into the agent prompt) for industry-specific caption angles and blog topics. Cross-reference `buyer-personas.md` when choosing hooks + CTAs. Load `get_client_details` before writing for an unfamiliar client so you have services, areas, and intelligence on hand.

## Working as a real content agent

The agent operates with full strategic autonomy:
- **Plan first**: check `get_client_details` and recent posts before creating anything
- **Create strategically**: rotate services, areas, content types, and buyer persona hooks
- **Review output**: always self-check content quality — if a caption is weak, rewrite it
- **Track what works**: use `get_report` to see which content drove the most engagement and adapt
- **Lead generation focus**: every post must have a path to conversion (call, website, DM, book)

Terminal agents (Claude Code, Codex, Gemini CLI) use the same tool layer — any tool call from the MCP bridge or Discord bot routes through the same executeTool function with full DB access and audit logging.
