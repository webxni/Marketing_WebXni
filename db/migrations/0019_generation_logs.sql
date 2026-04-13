-- Execution audit log and activity heartbeat for generation runs
ALTER TABLE generation_runs ADD COLUMN execution_log TEXT;
ALTER TABLE generation_runs ADD COLUMN last_activity_at INTEGER;
