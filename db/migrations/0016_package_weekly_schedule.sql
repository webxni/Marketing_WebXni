-- Migration 0016: Add weekly_schedule to packages
-- weekly_schedule: JSON object mapping weekday names to content-type arrays
-- e.g. {"monday":["video"],"tuesday":["image"],"wednesday":["blog","reel"]}
-- When set, automation uses this as the definitive content plan per day.
-- posting_days is derived from schedule keys; posting_frequency (weekly/biweekly) still applies.

ALTER TABLE packages ADD COLUMN weekly_schedule TEXT;

-- ── Seed weekday schedules for the three standard packages ─────────────────

-- Basic (Mon/Wed/Fri): image, video, image
UPDATE packages SET
  weekly_schedule = '{"monday":["image"],"wednesday":["video"],"friday":["image"]}',
  posting_days    = '["monday","wednesday","friday"]',
  updated_at      = unixepoch()
WHERE slug = 'basic';

-- Medium (Mon–Fri): video, image, reel, image+blog, video
-- = 2 vid + 2 img + 1 reel + 1 blog per week = 6 posts/week ≈ 26/month
UPDATE packages SET
  weekly_schedule = '{"monday":["video"],"tuesday":["image"],"wednesday":["reel"],"thursday":["image","blog"],"friday":["video"]}',
  posting_days    = '["monday","tuesday","wednesday","thursday","friday"]',
  updated_at      = unixepoch()
WHERE slug = 'medium';

-- Premium (Mon–Sat): heavy video/reel cadence
-- mon: vid+reel, tue: img, wed: vid+blog, thu: reel+img, fri: vid+reel, sat: img
-- = 3 vid + 3 img + 3 reel + 1 blog per week = 10 posts/week ≈ 43/month
UPDATE packages SET
  weekly_schedule = '{"monday":["video","reel"],"tuesday":["image"],"wednesday":["video","blog"],"thursday":["reel","image"],"friday":["video","reel"],"saturday":["image"]}',
  posting_days    = '["monday","tuesday","wednesday","thursday","friday","saturday"]',
  updated_at      = unixepoch()
WHERE slug = 'premium';
