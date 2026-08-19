ALTER TABLE posts ADD COLUMN owner_approval_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN owner_approved_by TEXT;
ALTER TABLE posts ADD COLUMN owner_approved_at INTEGER;

