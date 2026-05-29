-- Migration 0035: Backend assignments, priority chains, and OpenAI orchestrator
-- Adds backend_priority column (JSON array) for automatic per-agent fallback.

ALTER TABLE agent_definitions ADD COLUMN backend_priority TEXT;

-- System Reliability → Codex primary (structured data analysis)
UPDATE agent_definitions SET default_backend = 'codex',
  backend_priority = '["codex","claude","openai"]' WHERE slug = 'system-reliability';

-- Security Sentinel → Codex primary (defensive signal analysis)
UPDATE agent_definitions SET default_backend = 'codex',
  backend_priority = '["codex","claude","openai"]' WHERE slug = 'security-sentinel';

-- Editorial Review → Codex primary
UPDATE agent_definitions SET default_backend = 'codex',
  backend_priority = '["codex","claude","openai"]' WHERE slug = 'editorial-review';

-- Agency Orchestrator → OpenAI primary (base orchestrator per user intent)
UPDATE agent_definitions SET default_backend = 'openai',
  backend_priority = '["openai","claude","codex"]' WHERE slug = 'agency-orchestrator';

-- Strategy → Claude primary, OpenAI fallback
UPDATE agent_definitions SET
  backend_priority = '["claude","openai","codex"]' WHERE slug = 'strategy';

-- Social Copy → Claude primary
UPDATE agent_definitions SET
  backend_priority = '["claude","openai","codex"]' WHERE slug = 'social-copy';

-- Blog Writer → Claude primary (best long-form)
UPDATE agent_definitions SET
  backend_priority = '["claude","openai","codex"]' WHERE slug = 'blog-writer';

-- Client Research → Gemini primary (free quota)
UPDATE agent_definitions SET
  backend_priority = '["gemini","claude","openai"]' WHERE slug = 'client-research';
