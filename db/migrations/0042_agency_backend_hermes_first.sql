-- Migration 0042: Make Hermes the primary backend for AI Agency.
-- Preserve existing fallback stacks for resilience, but route all agency agents through Hermes first.

UPDATE agent_definitions
SET default_backend = 'hermes',
    backend_priority = '["hermes","claude_code","codex","openai"]',
    updated_at = unixepoch()
WHERE slug IN (
  'agency-orchestrator',
  'system-reliability',
  'security-sentinel',
  'strategy',
  'social-copy',
  'blog-writer',
  'editorial-review',
  'client-onboarding'
);

UPDATE agent_definitions
SET default_backend = 'hermes',
    backend_priority = '["hermes","gemini_cli","openai"]',
    updated_at = unixepoch()
WHERE slug = 'client-research';
