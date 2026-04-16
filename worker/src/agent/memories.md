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
