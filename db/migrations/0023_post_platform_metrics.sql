-- Migration 0023: Persist per-platform published IDs and reporting metrics
ALTER TABLE post_platforms ADD COLUMN platform_post_id TEXT;
ALTER TABLE post_platforms ADD COLUMN metrics_json TEXT;
ALTER TABLE post_platforms ADD COLUMN metrics_source TEXT;
ALTER TABLE post_platforms ADD COLUMN metrics_error TEXT;
ALTER TABLE post_platforms ADD COLUMN profile_snapshot_json TEXT;
ALTER TABLE post_platforms ADD COLUMN profile_snapshot_latest_json TEXT;
ALTER TABLE post_platforms ADD COLUMN profile_snapshot_latest_date TEXT;
ALTER TABLE post_platforms ADD COLUMN metrics_synced_at INTEGER;
