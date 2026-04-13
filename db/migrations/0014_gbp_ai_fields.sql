-- Migration 0014: AI image prompt + missing asset fields on GBP offers/events
-- Run: wrangler d1 execute webxni_db --file=db/migrations/0014_gbp_ai_fields.sql --remote

ALTER TABLE client_offers ADD COLUMN ai_image_prompt TEXT;
ALTER TABLE client_events ADD COLUMN ai_image_prompt TEXT;
