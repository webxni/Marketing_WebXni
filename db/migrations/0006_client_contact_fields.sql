-- Migration 0006: First-class contact and identity fields on clients
-- These were previously buried in brand_json; promoting to real columns
-- so the AI prompt builder and reports can reference them directly.
-- Run: wrangler d1 execute webxni-db --file=db/migrations/0006_client_contact_fields.sql --remote

ALTER TABLE clients ADD COLUMN phone      TEXT;
ALTER TABLE clients ADD COLUMN email      TEXT;
ALTER TABLE clients ADD COLUMN owner_name TEXT;
ALTER TABLE clients ADD COLUMN cta_text   TEXT;   -- e.g. "Call for a free estimate"
ALTER TABLE clients ADD COLUMN cta_label  TEXT;   -- e.g. "Free Estimate"
ALTER TABLE clients ADD COLUMN industry   TEXT;   -- "Locksmith" | "Construction" | "Roofing" | ...
ALTER TABLE clients ADD COLUMN state      TEXT;   -- "CA" | "CA / OR / WA" (primary state)

CREATE INDEX IF NOT EXISTS idx_clients_industry ON clients(industry);
CREATE INDEX IF NOT EXISTS idx_clients_state    ON clients(state);
