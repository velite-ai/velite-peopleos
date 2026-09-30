-- Durable worker leases make every queue safe across multiple worker replicas.
-- External side effects remain at-least-once; stable idempotency keys let adapters
-- suppress the only unavoidable duplicate window (remote success before DB commit).

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS lease_owner uuid,
  ADD COLUMN IF NOT EXISTS leased_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_status_check;
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_status_check
  CHECK (status IN ('pending', 'processing', 'retrying', 'delivered', 'failed'));

CREATE INDEX IF NOT EXISTS webhook_delivery_claim_idx
  ON webhook_deliveries(next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing', 'retrying');

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_email_status_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_email_status_check
  CHECK (email_status IN ('pending', 'sending', 'retrying', 'delivered', 'failed', 'not_configured'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS email_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_lease_owner uuid,
  ADD COLUMN IF NOT EXISTS email_leased_until timestamptz;

CREATE INDEX IF NOT EXISTS notifications_email_claim_idx
  ON notifications(email_next_attempt_at, created_at)
  WHERE email_status IN ('pending', 'sending', 'retrying');

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_scan_status_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_scan_status_check
  CHECK (scan_status IN ('pending', 'scanning', 'clean', 'infected', 'error', 'not_configured'));

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS scan_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scan_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS scan_lease_owner uuid,
  ADD COLUMN IF NOT EXISTS scan_leased_until timestamptz;

CREATE INDEX IF NOT EXISTS documents_scan_claim_idx
  ON documents(scan_next_attempt_at, created_at)
  WHERE scan_status IN ('pending', 'scanning', 'error', 'not_configured');

ALTER TABLE document_generation_jobs
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner uuid,
  ADD COLUMN IF NOT EXISTS leased_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS document_generation_job_claim_idx
  ON document_generation_jobs(next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id uuid PRIMARY KEY,
  worker_name text NOT NULL,
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'stopping', 'stopped')),
  version text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  last_cycle_started_at timestamptz,
  last_cycle_completed_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0,
  stopped_at timestamptz
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_health_idx
  ON worker_heartbeats(state, last_heartbeat_at DESC);

