-- Durable approval and verification state for governed content generation.

ALTER TABLE clients ADD COLUMN profile_approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE clients ADD COLUMN profile_approved_by TEXT;
ALTER TABLE clients ADD COLUMN profile_approved_at INTEGER;

ALTER TABLE client_research_notes ADD COLUMN brand_name TEXT;
ALTER TABLE client_research_notes ADD COLUMN source_url TEXT;
ALTER TABLE client_research_notes ADD COLUMN source_domain TEXT;
ALTER TABLE client_research_notes ADD COLUMN source_title TEXT;
ALTER TABLE client_research_notes ADD COLUMN entity_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_research_notes ADD COLUMN geography_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_research_notes ADD COLUMN service_match INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_research_notes ADD COLUMN prohibited_service_detected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_research_notes ADD COLUMN confidence TEXT NOT NULL DEFAULT 'low';
ALTER TABLE client_research_notes ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE client_research_notes ADD COLUMN reviewed_by TEXT;
ALTER TABLE client_research_notes ADD COLUMN reviewed_at INTEGER;
ALTER TABLE client_research_notes ADD COLUMN expires_at TEXT;
ALTER TABLE client_research_notes ADD COLUMN notes TEXT;

ALTER TABLE client_services ADD COLUMN normalized_name TEXT;
ALTER TABLE client_services ADD COLUMN service_pillar TEXT;
ALTER TABLE client_services ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE client_services ADD COLUMN approved_by TEXT;
ALTER TABLE client_services ADD COLUMN approved_at INTEGER;
ALTER TABLE client_services ADD COLUMN editorial_notes TEXT;

ALTER TABLE client_service_areas ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE client_service_areas ADD COLUMN approved_by TEXT;
ALTER TABLE client_service_areas ADD COLUMN approved_at INTEGER;
ALTER TABLE client_service_areas ADD COLUMN editorial_notes TEXT;

ALTER TABLE client_keywords ADD COLUMN normalized_keyword TEXT;
ALTER TABLE client_keywords ADD COLUMN service_pillar TEXT;
ALTER TABLE client_keywords ADD COLUMN brand_owner TEXT;
ALTER TABLE client_keywords ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE client_keywords ADD COLUMN approved_by TEXT;
ALTER TABLE client_keywords ADD COLUMN approved_at INTEGER;

ALTER TABLE client_monthly_content_plans ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE client_monthly_content_plans ADD COLUMN expected_slots INTEGER NOT NULL DEFAULT 26;
ALTER TABLE client_monthly_content_plans ADD COLUMN approved_by TEXT;
ALTER TABLE client_monthly_content_plans ADD COLUMN approved_at INTEGER;

ALTER TABLE client_monthly_topics ADD COLUMN slot_number INTEGER;
ALTER TABLE client_monthly_topics ADD COLUMN content_pillar TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN working_title TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN primary_service TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN primary_area TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN supporting_keywords TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN format TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN offer_or_event TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN image_requirement TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN proof_requirement TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN claim_requirement TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE client_monthly_topics ADD COLUMN approved_by TEXT;
ALTER TABLE client_monthly_topics ADD COLUMN approved_at INTEGER;

ALTER TABLE client_platforms ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE client_platforms ADD COLUMN provider_destination_id TEXT;
ALTER TABLE client_platforms ADD COLUMN verified_business_name TEXT;
ALTER TABLE client_platforms ADD COLUMN verified_phone TEXT;
ALTER TABLE client_platforms ADD COLUMN verified_market TEXT;
ALTER TABLE client_platforms ADD COLUMN verified_at INTEGER;
ALTER TABLE client_platforms ADD COLUMN verification_notes TEXT;

ALTER TABLE client_gbp_locations ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE client_gbp_locations ADD COLUMN verified_business_name TEXT;
ALTER TABLE client_gbp_locations ADD COLUMN verified_phone TEXT;
ALTER TABLE client_gbp_locations ADD COLUMN verified_address TEXT;
ALTER TABLE client_gbp_locations ADD COLUMN verified_market TEXT;
ALTER TABLE client_gbp_locations ADD COLUMN verified_at INTEGER;
ALTER TABLE client_gbp_locations ADD COLUMN verification_notes TEXT;

ALTER TABLE content_review_notes ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE content_review_notes ADD COLUMN finding_type TEXT;
ALTER TABLE content_review_notes ADD COLUMN source_record_type TEXT;
ALTER TABLE content_review_notes ADD COLUMN source_record_id TEXT;
ALTER TABLE content_review_notes ADD COLUMN recommended_source_fix TEXT;
ALTER TABLE content_review_notes ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE content_review_notes ADD COLUMN reviewed_by TEXT;
ALTER TABLE content_review_notes ADD COLUMN resolved_at INTEGER;

CREATE TABLE IF NOT EXISTS client_approved_claims (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  claim_key      TEXT NOT NULL,
  claim_text     TEXT NOT NULL,
  claim_category TEXT NOT NULL DEFAULT 'brand_fact',
  evidence_url   TEXT,
  evidence_notes TEXT,
  review_status  TEXT NOT NULL DEFAULT 'pending',
  reviewed_by    TEXT,
  reviewed_at    INTEGER,
  expires_at     TEXT,
  notes          TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, claim_key)
);

CREATE INDEX IF NOT EXISTS idx_research_review_status
  ON client_research_notes(client_id, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_services_approval
  ON client_services(client_id, active, approval_status, sort_order);
CREATE INDEX IF NOT EXISTS idx_areas_approval
  ON client_service_areas(client_id, approval_status, sort_order);
CREATE INDEX IF NOT EXISTS idx_keywords_approval
  ON client_keywords(client_id, status, approval_status, kw_type);
CREATE INDEX IF NOT EXISTS idx_monthly_plan_approval
  ON client_monthly_content_plans(client_id, plan_month, status);
CREATE INDEX IF NOT EXISTS idx_monthly_topic_approval
  ON client_monthly_topics(client_id, plan_month, approval_status, slot_number);
CREATE INDEX IF NOT EXISTS idx_platform_verification
  ON client_platforms(client_id, verification_status, paused);
CREATE INDEX IF NOT EXISTS idx_gbp_location_verification
  ON client_gbp_locations(client_id, verification_status, paused);
CREATE INDEX IF NOT EXISTS idx_claims_approval
  ON client_approved_claims(client_id, review_status, claim_key);
CREATE INDEX IF NOT EXISTS idx_review_source_repair
  ON content_review_notes(client_id, review_status, finding_type, created_at DESC);
