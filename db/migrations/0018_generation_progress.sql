-- Track real-time progress for generation runs
ALTER TABLE generation_runs ADD COLUMN progress_json TEXT;
