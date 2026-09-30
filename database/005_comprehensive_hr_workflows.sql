INSERT INTO roles (code, name) VALUES
  ('EMPLOYEE', 'Employee Self Service'),
  ('IT_FACILITIES', 'IT and Facilities')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE attendance_months (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'review', 'locked')),
  employee_count integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  locked_at timestamptz,
  locked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_head_id, period_month)
);

CREATE TABLE timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date date NOT NULL,
  project_code text NOT NULL,
  minutes integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description text,
  billable boolean NOT NULL DEFAULT false,
  status workflow_status NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date, project_code)
);

CREATE TABLE statutory_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  registration_type text NOT NULL,
  registration_number_encrypted bytea NOT NULL,
  jurisdiction text,
  effective_from date NOT NULL,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_head_id, registration_type, effective_from)
);

CREATE TABLE statutory_rule_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  code text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL,
  configuration jsonb NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status workflow_status NOT NULL DEFAULT 'draft',
  change_reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_result_id uuid NOT NULL UNIQUE REFERENCES payroll_results(id) ON DELETE CASCADE,
  document_id uuid REFERENCES documents(id),
  snapshot jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid REFERENCES users(id)
);

CREATE TABLE payroll_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id),
  export_type text NOT NULL CHECK (export_type IN ('bank', 'accounting', 'statutory', 'payroll_register')),
  file_name text NOT NULL,
  row_count integer NOT NULL,
  checksum text NOT NULL,
  generated_by uuid NOT NULL REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  offer_number text NOT NULL UNIQUE,
  offered_position text NOT NULL,
  offered_ctc numeric(14,2) NOT NULL CHECK (offered_ctc > 0),
  proposed_joining_date date NOT NULL,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'issued', 'accepted', 'declined', 'withdrawn')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  issued_at timestamptz,
  responded_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE background_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  check_type text NOT NULL,
  provider text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'clear', 'review', 'failed', 'cancelled')),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result_summary text,
  document_id uuid REFERENCES documents(id),
  created_by uuid NOT NULL REFERENCES users(id),
  UNIQUE (candidate_id, check_type)
);

CREATE TABLE policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  code text NOT NULL,
  title text NOT NULL,
  version integer NOT NULL,
  document_id uuid REFERENCES documents(id),
  content text,
  effective_from date NOT NULL,
  mandatory boolean NOT NULL DEFAULT true,
  status workflow_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_document_id uuid NOT NULL REFERENCES policy_documents(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  UNIQUE (policy_document_id, employee_id)
);

CREATE TABLE asset_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  employee_id uuid REFERENCES employees(id),
  transaction_type text NOT NULL CHECK (transaction_type IN ('assign', 'return', 'repair', 'retire', 'lost')),
  condition_notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  performed_by uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  name text NOT NULL,
  legal_name text NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'IN',
  tax_identifier_encrypted bytea,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (business_head_id, legal_name)
);

CREATE TABLE work_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  code text NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (business_head_id, code)
);

CREATE TABLE cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  code text NOT NULL,
  name text NOT NULL,
  department_id uuid REFERENCES departments(id),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (business_head_id, code)
);

CREATE TABLE job_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  department_id uuid REFERENCES departments(id),
  code text NOT NULL,
  title text NOT NULL,
  grade text,
  reports_to_position_id uuid REFERENCES job_positions(id),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (business_head_id, code)
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS legal_entity_id uuid REFERENCES legal_entities(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location_id uuid REFERENCES work_locations(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES cost_centres(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_position_id uuid REFERENCES job_positions(id);

CREATE INDEX attendance_month_status_idx ON attendance_months(period_month, status);
CREATE INDEX timesheets_employee_date_idx ON timesheets(employee_id, work_date);
CREATE INDEX offers_candidate_idx ON candidate_offers(candidate_id, status);
CREATE INDEX asset_transactions_asset_idx ON asset_transactions(asset_id, occurred_at DESC);
CREATE INDEX policy_ack_employee_idx ON policy_acknowledgements(employee_id, acknowledged_at DESC);
