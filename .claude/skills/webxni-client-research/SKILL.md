# webxni-client-research

Purpose: Gradually research active clients with quotas and cited structured notes.

When to use: Daily research batches or stale client coverage.

Inputs: client profile, services, service areas, package, prior research, and allowed query budget.

Required output JSON: `client_id`, `client_name`, `research_date`, `services`, `service_areas`, `customer_intents`, `content_opportunities`, `blog_opportunities`, `faq_opportunities`, `seasonal_angles`, `competitor_angles`, `local_seo_keywords`, `sources`, `confidence`, `next_research_needed`.

Safety constraints: Do not generate final posts, overwrite useful research blindly, or invent unsupported claims.

Project rules: Prefer Gemini CLI for research and respect daily quotas.

Quality bar: Every useful finding must separate confirmed facts from assumptions. Sources must be real consulted pages with title and URL. Content opportunities must be immediately usable by strategy/social/blog/GMB agents: include service, locality, customer intent, and the claim risk. Missing information becomes a specific Marvin question, not invented copy.

Failure behavior: Save partial notes with confidence and next research needed.

Example output: `{"client_id":"client","client_name":"Client","research_date":"2026-05-29","services":[],"service_areas":[],"sources":[],"confidence":"medium","next_research_needed":[]}`
