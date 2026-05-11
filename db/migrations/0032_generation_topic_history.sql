-- Migration 0032: generation topic history + duplicate tracking

ALTER TABLE posts ADD COLUMN topic_fingerprint TEXT;
ALTER TABLE posts ADD COLUMN monthly_topic_id TEXT;
ALTER TABLE posts ADD COLUMN topic_service_category TEXT;

ALTER TABLE client_monthly_topics ADD COLUMN skip_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_client_topic_fingerprint
  ON posts(client_id, topic_fingerprint, publish_date);

CREATE INDEX IF NOT EXISTS idx_posts_client_topic_service
  ON posts(client_id, topic_service_category, publish_date);
