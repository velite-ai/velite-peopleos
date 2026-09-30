ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'pending'
  CHECK (email_status IN ('pending','delivered','failed','not_configured'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_delivered_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_error text;
CREATE INDEX notifications_email_queue_idx ON notifications(email_status,deliver_on) WHERE email_status IN ('pending','failed');
