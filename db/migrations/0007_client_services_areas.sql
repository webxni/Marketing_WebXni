-- Migration 0007: Add client_categories, client_services, client_service_areas tables

CREATE TABLE IF NOT EXISTS client_categories (
  id         TEXT    PRIMARY KEY,
  client_id  TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS client_services (
  id          TEXT    PRIMARY KEY,
  client_id   TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category_id TEXT    REFERENCES client_categories(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS client_service_areas (
  id           TEXT    PRIMARY KEY,
  client_id    TEXT    NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city         TEXT    NOT NULL,
  state        TEXT,
  zip          TEXT,
  primary_area INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_client_categories_client  ON client_categories(client_id);
CREATE INDEX IF NOT EXISTS idx_client_services_client    ON client_services(client_id);
CREATE INDEX IF NOT EXISTS idx_client_svc_areas_client   ON client_service_areas(client_id);
