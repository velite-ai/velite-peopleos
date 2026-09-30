ALTER TABLE documents ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'pending'
  CHECK (scan_status IN ('pending','clean','infected','error','not_configured'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS scanned_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS scan_details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX documents_scan_queue_idx ON documents(scan_status,created_at) WHERE scan_status IN ('pending','error');
