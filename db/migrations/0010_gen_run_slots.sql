-- Migration 0010: Add slot-based generation plan columns to generation_runs
-- Enables chained-invocation architecture: one post per fresh Worker request

ALTER TABLE generation_runs ADD COLUMN post_slots    TEXT;               -- JSON: PostSlot[]
ALTER TABLE generation_runs ADD COLUMN total_slots   INTEGER DEFAULT 0;  -- cached length of post_slots
ALTER TABLE generation_runs ADD COLUMN current_slot_idx INTEGER DEFAULT 0; -- next slot to process
ALTER TABLE generation_runs ADD COLUMN publish_time  TEXT;               -- HH:MM, e.g. "10:00"
