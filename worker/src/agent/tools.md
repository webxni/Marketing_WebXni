# Agent tools — quick reference

All client/post mutations are automatically audit-logged. Always use these exact tool names.

## Reads
- `get_posts { client?, status?, date_from?, date_to?, platform?, limit? }`
- `get_queue` — ready posts awaiting automation
- `get_client_details { client }` — profile, platforms, intelligence, services, areas, offers, events
- `get_report { client?, date_from?, date_to? }`
- `get_system_status`
- `list_content_requests { client?, active_only? }`
- `list_client_topics { client, status?, limit? }`

## Single-post creation
- `create_post_for_platform { client, platform, title, caption?, publish_date?, content_type? }` — manual stub (no image)
- `create_content_with_image { client, platforms?, content_type?, topic?, publish_date?, status? }` — full orchestration (content + image + Discord notify)

## Batch + recurring creation
- `batch_create_content { client, count?, content_type?, platforms?, topic?, topics[]?, use_queue?, start_date?, spacing_days?, status? }` — up to 20 posts in one call.
- `create_content_request { client, request_type, content_type?, platforms?, recurrence, day_of_week?, time_of_day?, per_run?, topic_strategy?, fixed_topic?, next_run_date? }`
- `update_content_request { request_id, fields{} }`
- `cancel_content_request { request_id }`

## Topic queue
- `add_client_topics { client, topics[], content_type?, platforms? }` — pass `string[]` or `{topic, priority?, target_date?}[]`
- `list_client_topics`

## Post ops (existing)
- `update_post`, `bulk_update_posts`, `set_post_status`, `publish_post`, `publish_bulk`, `fix_failed_posts`, `delete_post`
- Blog: `update_blog_post`, `publish_blog`
- Media: `attach_asset_to_post`
- Captions: `generate_captions { post_id, platforms[] }`
- Fast-track: `approve_and_publish { post_id }`

## Client ops
- `update_client_profile`, `update_client_intelligence`, `update_client_platforms`
- `add_client_service`, `add_client_area`, `add_client_feedback`

## GBP
- `create_offer`, `update_offer`, `create_event`, `update_event`

## Generation
- `generate_content { client_slugs[], date_from, date_to }` — reads the client's package schedule
- `resume_generation_run { run_id }`

---

## Decision cheatsheet

| User says … | Tool |
|---|---|
| "one post right now" / "LinkedIn-only post about X" | `create_content_with_image` |
| "5 posts this week about X" | `batch_create_content { count: 5, topic: 'X' }` |
| "here's a list of topics" | `add_client_topics` then `batch_create_content { use_queue: true }` |
| "10 blogs from this list" | `add_client_topics { content_type: 'blog' }` + `batch_create_content { content_type: 'blog', use_queue: true, count: 10 }` |
| "every Monday at 9am" | `create_content_request { recurrence: 'weekly', day_of_week: 1, time_of_day: '09:00' }` |
| "every weekday" | `create_content_request { recurrence: 'weekdays', time_of_day: '09:00' }` |
| "every other Tuesday" | `create_content_request { recurrence: 'biweekly', day_of_week: 2 }` |
| "pause the weekly LinkedIn post" | `update_content_request { fields: { paused: 1 } }` |
| "for all clients …" | call `generate_content { client_slugs: [] }` for the batch path; for batch_create_content, loop per client |
| "what's scheduled to auto-post?" | `list_content_requests` |

## Topic-list intake format
Accept either:
- plain array of strings: `['How much does X cost', 'Signs you need Y', ...]`
- structured: `[{ topic: 'string', priority?: number, content_type?: 'blog', target_date?: 'YYYY-MM-DD' }, ...]`

If the user pastes a numbered/bulleted list in chat, parse line-by-line, strip `1.` / `-` / `*` prefixes.
