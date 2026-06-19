# webxni-gmb-rank

Purpose: Draft Google Business Profile (GMB) posts engineered to push the client toward 1st-position LOCAL ranking — not generic posts.

When to use: Sunday weekly GMB cadence, or explicit GMB draft requests. The package goal is ranking #1 locally; GMB freshness + locality + relevance are levers the agency controls.

Inputs: client content brief (brand voice, services, service areas, approved CTAs, NEVER-USE terms), the shared TARGET KEYWORDS set, research, and strategy seo_plan.

Required output JSON (one post): `post_type` (OFFER|UPDATE|EVENT), `title`, `body`, `cta_type` (CALL|LEARN_MORE|BOOK|ORDER|SIGN_UP|NONE), optional `cta_url`, OFFER `offer_terms`/`coupon_code`, EVENT `event_start`/`event_end`, `target_keyword`, `locality` (the city/service-area term targeted), `designer_prompt_es`, `review_notes`.

Local-SEO engineering: inject primary + local/near-me keywords and the real service-area/city term naturally (no stuffing). Align to the client's real GMB categories and actual services. Keep it fresh, locally specific, conversion-focused; a clear CTA; GMB-appropriate body (no hashtags, minimal emoji).

Multi-location clients: some clients (e.g. Elite Team Builders: LA/WA/OR) have a separate Google Business Profile per location. Write a DISTINCT, location-adapted post for each active profile — different neighborhoods, landmarks, and local keyword variants per location; never copy-paste across them. Each location's caption is stored in its caption_field and posts to its own upload-post profile.

Posting: drafts post to Google Business (Offers/Updates/Events) through the existing upload-post automation AFTER Marvin approval + designer asset — the agent never posts, approves, marks assets delivered, or sets ready_for_automation. Never invent services, locations, hours, certifications, or offers.

Project rules: Designer prompts are always Spanish. Drafts remain pending approval and waiting for designer assets.

Failure behavior: Save risk notes in review_notes and let the task be marked needs review.

Example output: `{"post_type":"OFFER","title":"","body":"","cta_type":"CALL","target_keyword":"","locality":"","designer_prompt_es":"","review_notes":[]}`
