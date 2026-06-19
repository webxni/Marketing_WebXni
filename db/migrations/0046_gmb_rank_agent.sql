-- 0046: Register the GMB Rank agent (§2). Additive, idempotent.
-- Enabled, but actual drafting is still flag-gated by AGENCY_GMB_ENABLED in the
-- runner, and every draft passes the quality gate + Marvin/designer gates.
INSERT OR IGNORE INTO agent_definitions
  (slug, name, purpose, schedule_kind, default_backend, skills_json, command_name)
VALUES
  ('gmb-rank',
   'GMB Rank Agent',
   'Drafts Google Business Profile posts (Offers/Updates/Events) engineered for 1st-position local ranking, using the shared keyword set and service-area terms. Drafts only — never auto-posts.',
   'weekly',
   'hermes',
   '["webxni-gmb-rank"]',
   'agency_gmb_rank');
