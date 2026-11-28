-- Feedback type + email delivery tracking (Nov 2026). Run once on the live database:
--   wrangler d1 execute wardology-qbank --remote --file qbank/migrations/0002_feedback_email.sql
ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';
ALTER TABLE feedback ADD COLUMN emailed INTEGER;
ALTER TABLE feedback ADD COLUMN email_error TEXT;
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, created_at);
