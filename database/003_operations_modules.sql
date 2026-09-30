CREATE TABLE leave_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  code text NOT NULL,
  name text NOT NULL,
  paid boolean NOT NULL DEFAULT true,
  annual_entitlement numeric(6,2) NOT NULL DEFAULT 0,
  accrual_frequency text NOT NULL DEFAULT 'monthly',
  carry_forward_limit numeric(6,2) NOT NULL DEFAULT 0,
  encashable boolean NOT NULL DEFAULT false,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date NOT NULL,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_head_id, code, effective_from)
);

ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_policy_id uuid REFERENCES leave_policies(id);

CREATE TABLE leave_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  leave_policy_id uuid NOT NULL REFERENCES leave_policies(id),
  transaction_date date NOT NULL,
  quantity numeric(7,2) NOT NULL,
  transaction_type text NOT NULL,
  reference_type text,
  reference_id uuid,
  remarks text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leave_ledger_balance_idx ON leave_ledger(employee_id, leave_policy_id, transaction_date);

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  code text NOT NULL,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0,
  grace_minutes integer NOT NULL DEFAULT 0,
  half_day_minutes integer NOT NULL,
  full_day_minutes integer NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(business_head_id, code)
);

CREATE TABLE shift_rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  shift_id uuid NOT NULL REFERENCES shifts(id),
  roster_date date NOT NULL,
  published_at timestamptz,
  published_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, roster_date)
);

CREATE TABLE overtime_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  attendance_date date NOT NULL,
  requested_minutes integer NOT NULL CHECK (requested_minutes > 0),
  approved_minutes integer CHECK (approved_minutes >= 0),
  reason text NOT NULL,
  status workflow_status NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, attendance_date)
);

CREATE TABLE learning_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  mandatory boolean NOT NULL DEFAULT false,
  validity_months integer,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES learning_courses(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  status text NOT NULL DEFAULT 'assigned',
  progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  completed_at timestamptz,
  certificate_expires_on date,
  assigned_by uuid REFERENCES users(id),
  UNIQUE(course_id, employee_id, assigned_at)
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  asset_code text NOT NULL UNIQUE,
  category text NOT NULL,
  description text NOT NULL,
  serial_number text,
  status text NOT NULL DEFAULT 'available',
  assigned_employee_id uuid REFERENCES employees(id),
  assigned_at timestamptz,
  returned_at timestamptz,
  condition_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expense_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number text NOT NULL UNIQUE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  category text NOT NULL,
  claim_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  status workflow_status NOT NULL DEFAULT 'pending',
  approved_amount numeric(14,2),
  approver_id uuid REFERENCES users(id),
  approved_at timestamptz,
  receipt_document_id uuid REFERENCES documents(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employee_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  loan_type text NOT NULL,
  principal numeric(14,2) NOT NULL CHECK (principal > 0),
  outstanding numeric(14,2) NOT NULL CHECK (outstanding >= 0),
  instalment_amount numeric(14,2) NOT NULL CHECK (instalment_amount > 0),
  start_month date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loan_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES employee_loans(id),
  payroll_period_id uuid REFERENCES payroll_periods(id),
  transaction_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  transaction_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE benefit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  employer_cost numeric(14,2) NOT NULL DEFAULT 0,
  employee_cost numeric(14,2) NOT NULL DEFAULT 0,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE benefit_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_plan_id uuid NOT NULL REFERENCES benefit_plans(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  effective_from date NOT NULL,
  effective_to date,
  nominees jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  UNIQUE(benefit_plan_id, employee_id, effective_from)
);

CREATE INDEX roster_date_idx ON shift_rosters(roster_date, shift_id);
CREATE INDEX learning_due_idx ON learning_enrolments(status, due_date);
CREATE INDEX asset_assignment_idx ON assets(assigned_employee_id, status);
CREATE INDEX expense_queue_idx ON expense_claims(status, claim_date);
