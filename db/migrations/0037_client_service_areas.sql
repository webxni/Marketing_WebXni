-- Migration 0037: Client Service Areas (Geographic Coverage)
-- Adds per-client geographic areas for local SEO validation

CREATE TABLE IF NOT EXISTS client_service_areas (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city           TEXT NOT NULL,
  state          TEXT,
  zip_codes      TEXT,
  -- JSON array of ZIP codes served, if applicable
  primary_area   INTEGER NOT NULL DEFAULT 0,
  -- 1 = primary service area (weighted heavily in generation)
  secondary_area INTEGER NOT NULL DEFAULT 0,
  -- 1 = secondary service area
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, city, state)
);

CREATE INDEX IF NOT EXISTS idx_client_service_areas_client ON client_service_areas(client_id);
CREATE INDEX IF NOT EXISTS idx_client_service_areas_client_primary ON client_service_areas(client_id, primary_area DESC, sort_order ASC);
