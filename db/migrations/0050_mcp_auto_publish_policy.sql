-- 0050: Per-client MCP auto-publish policy + asset origin tagging.
-- Additive only. Lets AI-generated and text-only posts auto-publish for opted-in
-- clients while designer-gating external uploads. See mcp/limits.ts (isMediaApproved).

-- Origin of a post's image/video asset: 'designer' | 'ai_generated' | 'external_upload'.
-- NULL = legacy / text-only; the gate treats delivered NULL-source media as designer.
ALTER TABLE posts ADD COLUMN asset_source TEXT;

-- Per-client gate: 'strict' (designer-delivered assets only — legacy behavior) or
-- 'ai_and_text' (AI-generated + text-only auto-publish; external uploads still gated).
ALTER TABLE clients ADD COLUMN auto_publish_policy TEXT NOT NULL DEFAULT 'strict';

-- CaliView Builders opts into the relaxed policy.
UPDATE clients SET auto_publish_policy = 'ai_and_text' WHERE slug = 'caliview-builders';
