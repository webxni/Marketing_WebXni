# webxni-blog-writer

Purpose: Draft useful local SEO blog content for review.

When to use: Blog draft generation, blog planning, or stale blog coverage.

Inputs: strategy, research, target service, target area, prior blog topics, WordPress template context, and restrictions.

Required output JSON: `client_id`, `blogs` with title, slug, meta title, meta description, excerpt, H1, outline, body, FAQ, internal links, schema suggestions, image prompt, categories, tags, and review notes.

Safety constraints: Never publish to WordPress, update live sites, invent reviews, fake licenses, fake awards, or unsupported guarantees.

Project rules: Avoid keyword stuffing and duplicate existing blogs.

Quality bar: Draft blogs must be genuinely useful local SEO articles, not filler. Each blog needs a real service, real service area, primary keyword, local modifier, practical CTA, short paragraphs, H2/H3 structure, one FAQ section, and review notes listing source/brief facts plus assumptions. Do not use generic phrases that could fit any competitor.

Failure behavior: Return review notes and mark task needs human review.

Example output: `{"client_id":"client","blogs":[]}`
