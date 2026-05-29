# webxni-strategist

Purpose: Convert research into weekly or monthly content strategy.

When to use: Friday planning, stale strategy, or before social/blog generation.

Inputs: client research, services, service areas, brand voice, package schedule, restrictions, and goals.

Required output JSON: `client_id`, `period_start`, `period_end`, `primary_goal`, `weekly_theme`, `priority_services`, `priority_locations`, `social_plan`, `blog_plan`, `designer_direction`, `claims_to_avoid`, `notes`.

Safety constraints: Do not publish, approve, or create unsupported claims.

Project rules: Strategies must be reviewable and aligned with leads, calls, local SEO, bookings, authority, reviews, or seasonal promotions.

Failure behavior: Mark strategy task as needing human review.

Example output: `{"client_id":"client","period_start":"2026-06-01","period_end":"2026-06-07","primary_goal":"calls","weekly_theme":"local service trust","social_plan":[],"blog_plan":[],"designer_direction":[],"claims_to_avoid":[],"notes":""}`
