ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip_address inet,
  succeeded boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_guard_idx ON login_attempts(email,attempted_at DESC) WHERE succeeded=false;

CREATE UNIQUE INDEX IF NOT EXISTS leave_ledger_reference_unique
  ON leave_ledger(reference_type,reference_id,leave_policy_id)
  WHERE reference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS loan_transactions_payroll_unique
  ON loan_transactions(loan_id,payroll_period_id,transaction_type)
  WHERE payroll_period_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payroll_results_employee_idx ON payroll_results(employee_id,payroll_period_id);
CREATE INDEX IF NOT EXISTS employee_events_timeline_idx ON employee_events(employee_id,effective_date DESC);

CREATE TABLE IF NOT EXISTS document_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE,
  business_head_id uuid REFERENCES business_heads(id),
  employee_id uuid REFERENCES employees(id),
  candidate_id uuid REFERENCES candidates(id),
  category text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  expires_on date,
  requested_by uuid NOT NULL REFERENCES users(id),
  upload_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((employee_id IS NOT NULL)::int + (candidate_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS document_upload_intents_expiry_idx ON document_upload_intents(upload_expires_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_head_id uuid REFERENCES business_heads(id),
  calendar_event_id uuid REFERENCES hr_calendar_events(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  action_path text,
  deliver_on date NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_user_id,calendar_event_id,deliver_on)
);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(recipient_user_id,created_at DESC) WHERE read_at IS NULL;

ALTER TABLE payroll_results DROP CONSTRAINT IF EXISTS payroll_results_nonnegative;
ALTER TABLE payroll_results ADD CONSTRAINT payroll_results_nonnegative CHECK (
  calendar_days >= 0 AND payable_days >= 0 AND absent_days >= 0 AND
  gross_earnings >= 0 AND deductions >= 0 AND net_pay >= 0 AND employer_cost >= 0
);
