-- Migration 0041: Correct AI Agency backend defaults.
-- Routine agency agents should prefer Claude Code/Gemini CLI with OpenAI fallback.
-- Codex is reserved for implementation/refactor jobs explicitly approved by Marvin.

UPDATE agent_definitions
SET default_backend = 'claude_code',
    backend_priority = '["claude_code","openai"]',
    updated_at = unixepoch()
WHERE slug IN (
  'agency-orchestrator',
  'system-reliability',
  'security-sentinel',
  'strategy',
  'social-copy',
  'blog-writer',
  'editorial-review'
);

UPDATE agent_definitions
SET default_backend = 'gemini_cli',
    backend_priority = '["gemini_cli","openai"]',
    updated_at = unixepoch()
WHERE slug = 'client-research';

UPDATE agent_definitions
SET default_backend = 'claude_code',
    backend_priority = '["claude_code","openai"]',
    updated_at = unixepoch()
WHERE slug = 'client-onboarding';
