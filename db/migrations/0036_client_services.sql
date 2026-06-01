-- Migration 0036: Client Services Catalog
-- Adds per-client service listing for strict content validation

CREATE TABLE IF NOT EXISTS client_services (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id                TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  -- e.g., "Key Duplication", "Emergency Lockout", "Rekeying", "Smart Lock Installation"
  description              TEXT,
  industry_classification  TEXT,
  -- e.g., "lock_service", "installation", "emergency"
  allowed_in_content       INTEGER NOT NULL DEFAULT 1,
  -- 1 = generate content about this service, 0 = forbidden in content
  priority                 INTEGER DEFAULT 0,
  -- Sort order for display and generation weighting
  forbidden_keywords       TEXT,
  -- JSON array of terms that mark a topic as incompatible
  -- e.g. for locksmith: ["kitchen remodel", "bathroom", "construction"]
  sort_order               INTEGER DEFAULT 0,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, name)
);

CREATE INDEX IF NOT EXISTS idx_client_services_client_allowed ON client_services(client_id, allowed_in_content);
CREATE INDEX IF NOT EXISTS idx_client_services_client_priority ON client_services(client_id, priority DESC, sort_order ASC);
