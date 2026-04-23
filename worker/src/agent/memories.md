# Operational Memory

## Business Rules
- Posts go: draft → pending_approval → approved → ready → scheduled → posted
- Also terminal states: failed, cancelled
- A post needs ready_for_automation=1 AND asset_delivered=1 to be picked up by automation
- The designer (Skarleth) uploads media externally — do not ask about media in post creation
- Blog posts use content_type='blog' and are excluded from social posting automation
- WordPress blogs are published via /api/posts/:id/publish-blog

## Client Notes
- Elite Team Builders (elite-team-builders) has 3 GBP locations: LA, WA, OR
- GBP captions use cap_gbp_la, cap_gbp_wa, cap_gbp_or fields
- Some clients are Spanish-language — check client.language field
- Unlocked Pros slug: unlocked-pros
- 247 Lockout Pasadena slug: 247-lockout-pasadena

## Platform Rules
- Reels are vertical video only (9:16)
- Blogs never go to social media automation
- Pinterest requires a board_id configured on the platform
- LinkedIn requires a page_id configured on the platform

## Safety Rules
- bulk_update_posts defaults to dry_run=true — always confirm before real execution
- Never delete posts without explicit user confirmation
- Publishing blog to WordPress is irreversible without manual WP editing
- Never create more than 20 posts in a single `batch_create_content` call without explicit user confirmation

## Recurring Content Requests
- Separate from GBP offers/events (which only drive Google Business)
- Lives in content_requests table; processed by the hourly cron
- Recurrence: daily | weekdays | weekly | biweekly | monthly | once
- "Every Monday at 9am" = recurrence='weekly' day_of_week=1 time_of_day='09:00'
- "Every weekday" = recurrence='weekdays' (skips Sat/Sun)
- "Every other Tuesday" = recurrence='biweekly' day_of_week=2
- time_of_day is UTC HH:MM; the request won't fire until the current UTC hour ≥ that hour
- Recurrence='once' deactivates itself after first firing

## Topic Queue
- client_topics is a per-client topic backlog
- Consumed by recurring schedules (priority DESC, FIFO) and by batch_create_content(use_queue=true)
- Empty queue falls through to auto research — NOT an error
- When user pastes a list without naming a client, ask for the client slug before inserting

## Client Expertise (load on demand)
- Always call get_client_details before writing for an unfamiliar client
- Match client.industry against the playbook headings in the prompt (locksmith, builder, roofing, marketing agency, default)
- Use buyer-persona framing to pick the hook + CTA
- Platform caption rules apply AFTER the industry playbook — layer them

## Dates
- Always normalize dates to YYYY-MM-DD
- "Today" = use the TODAY'S DATE from context
- "Next week" = 7 days from tomorrow
- "This month" = first to last day of current month

## Response Behavior
- Never repeat data already shown in items/summary fields
- Be direct: "Updated 3 posts" not "I have successfully updated a total of 3 posts as requested"
- Ask for confirmation before bulk destructive actions
- Never use markdown headings or bullet lists in the message field
