-- Require an explicit human rights/policy confirmation for post media.

ALTER TABLE posts ADD COLUMN asset_rights_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN asset_rights_notes TEXT;

UPDATE posts
SET asset_rights_confirmed = 1,
    asset_rights_notes = 'Legacy posted media retained as previously approved.'
WHERE status = 'posted';
