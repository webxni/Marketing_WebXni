-- Migration 0003: Client business profile tables
-- Run: wrangler d1 execute webxni-db --file=db/migrations/0003_services_areas.sql

-- ─────────────────────────────────────────────────────────────
-- Extend users table
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN last_login INTEGER;

-- ─────────────────────────────────────────────────────────────
-- Client categories  (e.g. "Kitchen Remodeling", "Locksmith Emergency")
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_categories (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────
-- Client services  (individual services within a category)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_services (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES client_categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────
-- Client service areas  (cities/regions for geo-targeted content)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_service_areas (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city         TEXT NOT NULL,
  state        TEXT,
  zip          TEXT,
  radius_mi    INTEGER,
  primary_area INTEGER NOT NULL DEFAULT 0,  -- 1 = primary business location
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────
-- Client offers  (current promotions, CTAs, discounts)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_offers (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,       -- "Free In-Home Estimate"
  description TEXT,
  cta_text    TEXT,                -- "Call Now for a Free Quote"
  valid_until TEXT,                -- ISO date YYYY-MM-DD
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_client_categories  ON client_categories(client_id);
CREATE INDEX IF NOT EXISTS idx_client_services    ON client_services(client_id);
CREATE INDEX IF NOT EXISTS idx_client_services_cat ON client_services(category_id);
CREATE INDEX IF NOT EXISTS idx_client_areas       ON client_service_areas(client_id);
CREATE INDEX IF NOT EXISTS idx_client_offers      ON client_offers(client_id);
CREATE INDEX IF NOT EXISTS idx_users_active       ON users(is_active);
