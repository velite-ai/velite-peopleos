ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS weekly_off_pattern_id uuid REFERENCES weekly_off_patterns(id);

ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS status workflow_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE leave_policies
  ADD CONSTRAINT leave_policy_valid_dates
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS start_day_fraction numeric(3,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS end_day_fraction numeric(3,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS derived_work_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calendar_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_request_valid_dates CHECK (end_date >= start_date),
  ADD CONSTRAINT leave_request_valid_fractions CHECK (
    start_day_fraction IN (0.5, 1) AND end_day_fraction IN (0.5, 1)
  );

ALTER TABLE leave_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS reverses_entry_id uuid REFERENCES leave_ledger(id);

CREATE UNIQUE INDEX leave_ledger_idempotency_unique
  ON leave_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX leave_ledger_one_opening_balance
  ON leave_ledger(employee_id, leave_policy_id) WHERE transaction_type = 'opening_balance';

ALTER TABLE leave_ledger
  ADD CONSTRAINT leave_ledger_nonzero_quantity CHECK (quantity <> 0),
  ADD CONSTRAINT leave_ledger_transaction_type_check CHECK (transaction_type IN (
    'opening_balance', 'accrual', 'leave_taken', 'leave_cancelled',
    'manual_adjustment', 'carry_forward', 'year_end_expiry',
    'reversal', 'final_encashment'
  ));

CREATE OR REPLACE FUNCTION prevent_leave_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Leave ledger entries are append-only; post a reversal instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_ledger_no_update
BEFORE UPDATE OR DELETE ON leave_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_leave_ledger_mutation();

CREATE TABLE leave_accrual_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  leave_policy_id uuid NOT NULL REFERENCES leave_policies(id),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  action text NOT NULL CHECK (action IN ('accrual', 'year_end_rollover')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE OR REPLACE FUNCTION prevent_leave_accrual_run_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Leave accrual runs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_accrual_runs_no_update
BEFORE UPDATE OR DELETE ON leave_accrual_runs
FOR EACH ROW EXECUTE FUNCTION prevent_leave_accrual_run_mutation();

ALTER TABLE final_settlements
  ADD COLUMN IF NOT EXISTS calculation_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculation_checksum text,
  ADD COLUMN IF NOT EXISTS statutory_rule_set_id uuid REFERENCES statutory_rule_sets(id),
  ADD COLUMN IF NOT EXISTS attendance_month_id uuid REFERENCES attendance_months(id),
  ADD COLUMN IF NOT EXISTS compensation_id uuid REFERENCES employee_compensation(id),
  ADD COLUMN IF NOT EXISTS source_payroll_period_id uuid REFERENCES payroll_periods(id),
  ADD COLUMN IF NOT EXISTS calculated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE final_settlements
  ADD CONSTRAINT final_settlement_maker_checker CHECK (
    approved_by IS NULL OR calculated_by IS NULL OR approved_by <> calculated_by
  ),
  ADD CONSTRAINT final_settlement_payment_state CHECK (
    paid_at IS NULL OR (status = 'completed' AND paid_by IS NOT NULL AND payment_reference IS NOT NULL)
  ),
  ADD CONSTRAINT final_settlement_totals_check CHECK (
    gross_payable >= 0 AND recoveries >= 0 AND net_payable = gross_payable - recoveries
  );

CREATE TABLE final_settlement_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  final_settlement_id uuid NOT NULL REFERENCES final_settlements(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('calculate', 'submit', 'approve', 'return', 'mark_paid')),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX final_settlement_actions_history_idx
  ON final_settlement_actions(final_settlement_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_final_settlement_action_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Final settlement actions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER final_settlement_actions_no_update
BEFORE UPDATE OR DELETE ON final_settlement_actions
FOR EACH ROW EXECUTE FUNCTION prevent_final_settlement_action_mutation();
