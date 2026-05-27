# Blog Template And Generation System

The blog system now resolves a client-specific editorial template before blog
content is rendered or published. The resolver lives in
`worker/src/modules/blog-templates.ts` and covers every active client currently
in production. If a client is not listed, the resolver falls back to an
industry-specific template instead of failing.

## Template Resolution

Template inputs:

- client slug
- canonical name
- industry
- state / service region
- brand JSON colors
- WordPress template key
- CTA text

Template output:

- template key
- editorial label
- industry label
- audience and tone
- author/company label
- category label
- primary/accent colors
- quick facts
- related services
- social-share metadata label

The existing `wp_template_key` and `wp_templates` table remain supported for
future per-client overrides. No schema change was added.

## Rendering

`renderStructuredBlogHtml()` renders structured content into an editorial
article with:

- SEO title/deck area
- author/company/date/category metadata
- featured image area
- article intro
- structured sections
- keyword focus box
- quick information box
- related services
- FAQ
- CTA
- social share metadata

Images are wrapped with responsive sizing, lazy loading, decoding hints, and
object-fit behavior for full-width featured-image presentation.

## Generation And Validation

Blog prompts now receive the resolved template profile so the AI writes for the
client's audience, tone, service focus, and related services. Publishing
preflight validates:

- required blog SEO fields
- target keyword match
- active service/category/location match
- duplicate headings
- duplicate paragraphs
- duplicate FAQ questions
- duplicate CTA blocks
- duplicate images
- unrelated service-family mixing

Blog-to-social distribution still creates a separate pending approval post for
non-video platforms only, using the published blog URL in platform-specific
captions.

## Tests

Run:

```bash
node scripts/test-blog-system.mjs
```

This checks active-client template coverage, editorial rendering, responsive
image markup, duplicate prevention, service mismatch validation, social caption
URL handling, and non-video platform filtering.
