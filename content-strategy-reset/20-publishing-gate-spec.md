# Publishing Gate Specification

Immediately before each destination submission:

1. Re-run the full portfolio readiness gate for the post month.
2. Require the current destination's verified provider mapping.
3. For GBP, require verified business name, phone, and market; multi-profile locations are checked individually.
4. Require an editorial review whose content hash matches the current post, status is approved, disposition is reviewed, and severity is below high.
5. Re-scan all copy, scripts, blog HTML, and design prompts for prohibited services and unapproved claims.
6. For attached media, require the authenticated Diseño-tab confirmation that usage rights are authorized and excluded locksmith services are not depicted. Any media change resets this confirmation.
7. Run existing media, link, formatting, platform, schedule, and idempotency checks.

Any unresolved blocker/high finding, destination ambiguity, semantic violation, stale review, or portfolio readiness failure returns `BLOCKED` and no provider call occurs.
