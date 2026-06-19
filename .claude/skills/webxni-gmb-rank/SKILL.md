# webxni-gmb-rank

Purpose: Draft Google Business Profile (GMB) posts engineered to push the client toward 1st-position LOCAL ranking — not generic posts.

When to use: Sunday weekly GMB cadence, or explicit GMB draft requests. The package goal is ranking #1 locally; GMB freshness + locality + relevance are levers the agency controls.

Inputs: client content brief (brand voice, services, service areas, approved CTAs, NEVER-USE terms), the shared TARGET KEYWORDS set, research, and strategy seo_plan.

Required output JSON (one post): `post_type` (OFFER|UPDATE|EVENT), `title`, `body`, `cta_type` (CALL|LEARN_MORE|BOOK|ORDER|SIGN_UP|NONE), optional `cta_url`, OFFER `offer_terms`/`coupon_code`, EVENT `event_start`/`event_end`, `target_keyword`, `locality` (the city/service-area term targeted), `designer_prompt_es`, `review_notes`.

Local-SEO engineering: inject primary + local/near-me keywords and the real service-area/city term naturally (no stuffing). Align to the client's real GMB categories and actual services. Keep it fresh, locally specific, conversion-focused; a clear CTA; GMB-appropriate body (no hashtags, minimal emoji).

Safety constraints: Never invent services, locations, hours, certifications, or offers. Do not approve as Marvin, mark assets delivered, mark ready for automation, schedule, or post. There is no GMB API auto-post — output is a draft + a manual posting plan; the Marvin approval and designer-asset gates still apply.

Project rules: Designer prompts are always Spanish. Drafts remain pending approval and waiting for designer assets.

Failure behavior: Save risk notes in review_notes and let the task be marked needs review.

Example output: `{"post_type":"OFFER","title":"","body":"","cta_type":"CALL","target_keyword":"","locality":"","designer_prompt_es":"","review_notes":[]}`
