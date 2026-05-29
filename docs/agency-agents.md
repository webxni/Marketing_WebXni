# AI Agency Agents

## Agency Orchestrator Agent

Backend: Claude Code. Coordinates weekly work, detects bottlenecks, creates follow-up tasks, and summarizes progress. It cannot approve, publish, or mark assets delivered.

## System Reliability Agent

Backend: Claude Code. Reviews failed jobs, stuck generation runs, queue health, and consistency signals. It creates findings only; it does not edit code or restart services automatically.

## Security Sentinel Agent

Backend: Claude Code. Defensive-only review of auth and audit signals. It redacts secrets and never performs offensive scanning, credential dumping, or exploit generation.

## Client Research Agent

Backend: Gemini CLI. Runs gradually with daily quotas. Stores cited structured research and does not generate final posts.

## Strategy Agent

Backend: Claude Code. Converts research into weekly/monthly strategy. Output is reviewable and cannot publish.

## Social Copy Agent

Backend: Claude Code. Drafts social posts using existing client/package context. Drafts remain pending Marvin approval and waiting for designer assets.

## Blog Writer Agent

Backend: Claude Code. Drafts SEO blog content for review. It never publishes to WordPress.

## Editorial Review Agent

Backend: Claude Code. Reviews posts/blogs for quality, factual risk, client restrictions, platform fit, and repetition. It cannot approve as Marvin.
