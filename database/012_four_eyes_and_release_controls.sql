CREATE TABLE payroll_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('reviewer', 'finance')),
  decision text NOT NULL CHECK (decision IN ('approve', 'return')),
  active boolean NOT NULL DEFAULT true,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payroll_approval_stage_approved_unique
  ON payroll_approval_steps(payroll_period_id, stage) WHERE decision = 'approve' AND active = true;
CREATE INDEX payroll_approval_history_idx
  ON payroll_approval_steps(payroll_period_id, created_at DESC);

CREATE TABLE payroll_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id),
  export_type text NOT NULL CHECK (export_type IN ('bank', 'accounting', 'statutory', 'payroll_register')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'generated')),
  requested_by uuid NOT NULL REFERENCES users(id),
  request_reason text NOT NULL,
  approved_by uuid REFERENCES users(id),
  approval_reason text,
  approved_at timestamptz,
  payroll_export_id uuid REFERENCES payroll_exports(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE INDEX payroll_export_request_queue_idx
  ON payroll_export_requests(status, created_at DESC);

CREATE TABLE permission_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES users(id),
  proposed_roles jsonb NOT NULL,
  previous_roles jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  request_reason text NOT NULL,
  decided_by uuid REFERENCES users(id),
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX permission_change_one_pending_per_user
  ON permission_change_requests(target_user_id) WHERE status = 'pending';

CREATE TABLE document_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('payslip', 'letter')),
  source_record_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  document_id uuid REFERENCES documents(id),
  requested_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (job_type, source_record_id)
);
CREATE INDEX document_generation_job_queue_idx
  ON document_generation_jobs(status, created_at) WHERE status IN ('pending', 'failed');

CREATE TABLE attendance_post_lock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_correction_id uuid NOT NULL UNIQUE REFERENCES attendance_corrections(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  original_period_month date NOT NULL,
  requested_values jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'applied', 'cancelled')),
  target_payroll_period_id uuid REFERENCES payroll_periods(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX attendance_post_lock_adjustment_queue_idx
  ON attendance_post_lock_adjustments(status, created_at) WHERE status IN ('pending', 'scheduled');

ALTER TABLE attendance_months
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reopen_reason text;

ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS calculated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_active_user_idx
  ON auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE user_mfa
  ADD COLUMN IF NOT EXISTS pending_secret_encrypted bytea,
  ADD COLUMN IF NOT EXISTS pending_created_at timestamptz;

CREATE UNIQUE INDEX employee_compensation_effective_start_unique
  ON employee_compensation(employee_id, effective_from);
ALTER TABLE employee_compensation
  ADD CONSTRAINT employee_compensation_valid_dates
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE payroll_rules
  ADD CONSTRAINT payroll_rule_valid_dates
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
