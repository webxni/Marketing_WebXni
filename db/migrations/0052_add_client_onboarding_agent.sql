-- Register the supported manual onboarding agent that was absent from the
-- original agency seed data.

INSERT OR IGNORE INTO agent_definitions
  (slug, name, purpose, schedule_kind, default_backend, skills_json, command_name, backend_priority)
VALUES
  ('client-onboarding',
   'Client Onboarding Agent',
   'Syncs approved client platform connections and prepares missing client research profiles without publishing content.',
   'manual',
   'hermes',
   '["webxni-agency-orchestrator"]',
   'agency_client_onboarding',
   '["hermes","claude_code","codex","openai"]');
