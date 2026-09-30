CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE employment_status AS ENUM ('candidate','preboarding','probation','active','notice_period','separated','archived');
CREATE TYPE attendance_status AS ENUM ('present','absent','half_day','paid_leave','unpaid_leave','weekly_off','holiday','work_from_home','on_duty','not_employed');
CREATE TYPE workflow_status AS ENUM ('draft','pending','approved','rejected','cancelled','completed');
CREATE TYPE payroll_status AS ENUM ('open','inputs_pending','validating','calculated','review','approved','locked','paid','cancelled');

CREATE TABLE business_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO business_heads (code, name) VALUES
  ('VEL-HC', 'Velite Healthcare'),
  ('VEL-PHARMA', 'Velite Pharmaceuticals'),
  ('VEL-INDIA', 'Velite India'),
  ('VEL-SCI', 'Velite Sciences Pvt Ltd.'),
  ('VEL-OTH-1', 'Others 1'),
  ('VEL-OTH-2', 'Others 2')
ON CONFLICT DO NOTHING;

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  name text NOT NULL,
  code text NOT NULL,
  parent_id uuid REFERENCES departments(id),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (business_head_id, code)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  full_name text NOT NULL,
  mfa_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO roles (code,name) VALUES
  ('SUPER_ADMIN','Super Administrator'),
  ('HR_ADMIN','HR Administrator'),
  ('HR_OPERATIONS','HR Operations'),
  ('RECRUITER','Recruiter'),
  ('MANAGER','Manager'),
  ('DEPARTMENT_HEAD','Department Head'),
  ('PAYROLL_ADMIN','Payroll Administrator'),
  ('FINANCE_APPROVER','Finance Approver'),
  ('LEADERSHIP','Leadership'),
  ('AUDITOR','Auditor')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  business_head_id uuid REFERENCES business_heads(id),
  department_id uuid REFERENCES departments(id)
);

CREATE UNIQUE INDEX user_roles_scope_unique ON user_roles (
  user_id,
  role_id,
  COALESCE(business_head_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL UNIQUE,
  user_id uuid UNIQUE REFERENCES users(id),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  department_id uuid REFERENCES departments(id),
  reporting_manager_id uuid REFERENCES employees(id),
  first_name text NOT NULL,
  last_name text,
  work_email text,
  personal_email text,
  phone text,
  position text NOT NULL,
  grade text,
  work_location text,
  employment_type text NOT NULL DEFAULT 'permanent',
  status employment_status NOT NULL DEFAULT 'probation',
  date_joined date NOT NULL,
  probation_end_date date,
  confirmation_date date,
  next_salary_revision_date date,
  notice_start_date date,
  last_working_date date,
  bank_details_encrypted bytea,
  statutory_details_encrypted bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employees_head_idx ON employees(business_head_id, status);
CREATE INDEX employees_department_idx ON employees(department_id, status);

CREATE TABLE employee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  event_type text NOT NULL,
  effective_date date NOT NULL,
  previous_values jsonb,
  new_values jsonb NOT NULL,
  reason text,
  approved_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  requisition_code text,
  full_name text NOT NULL,
  email text,
  phone text,
  position text NOT NULL,
  department_id uuid REFERENCES departments(id),
  stage text NOT NULL DEFAULT 'applied',
  source text,
  owner_id uuid REFERENCES users(id),
  consented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id),
  employee_id uuid REFERENCES employees(id),
  template_name text NOT NULL,
  planned_joining_date date NOT NULL,
  status workflow_status NOT NULL DEFAULT 'pending',
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  owner_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  attendance_date date NOT NULL,
  status attendance_status NOT NULL,
  first_in timestamptz,
  last_out timestamptz,
  worked_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  late_minutes integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  remarks text,
  locked_at timestamptz,
  locked_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  UNIQUE(employee_id, attendance_date)
);

CREATE INDEX attendance_date_head_idx ON attendance_days(attendance_date, employee_id);

CREATE TABLE attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_day_id uuid NOT NULL REFERENCES attendance_days(id),
  requested_values jsonb NOT NULL,
  reason text NOT NULL,
  status workflow_status NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL REFERENCES users(id),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  leave_type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(6,2) NOT NULL,
  paid boolean NOT NULL DEFAULT true,
  status workflow_status NOT NULL DEFAULT 'pending',
  reason text,
  approver_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE salary_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('earning','deduction','employer_contribution','reimbursement')),
  taxable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE payroll_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  business_head_id uuid REFERENCES business_heads(id),
  component_id uuid REFERENCES salary_components(id),
  version integer NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula jsonb NOT NULL,
  rounding_method text NOT NULL DEFAULT 'nearest_rupee',
  effective_from date NOT NULL,
  effective_to date,
  status workflow_status NOT NULL DEFAULT 'draft',
  change_reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(code, version)
);

CREATE TABLE employee_compensation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  effective_from date NOT NULL,
  effective_to date,
  annual_ctc numeric(14,2) NOT NULL,
  monthly_gross numeric(14,2) NOT NULL,
  structure jsonb NOT NULL,
  reason text NOT NULL,
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  period_month date NOT NULL,
  attendance_cutoff date NOT NULL,
  pay_date date NOT NULL,
  status payroll_status NOT NULL DEFAULT 'open',
  rules_snapshot jsonb,
  locked_at timestamptz,
  locked_by uuid REFERENCES users(id),
  UNIQUE(business_head_id, period_month)
);

CREATE TABLE payroll_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  calendar_days numeric(6,2) NOT NULL,
  payable_days numeric(6,2) NOT NULL,
  absent_days numeric(6,2) NOT NULL DEFAULT 0,
  gross_earnings numeric(14,2) NOT NULL,
  deductions numeric(14,2) NOT NULL,
  net_pay numeric(14,2) NOT NULL,
  employer_cost numeric(14,2) NOT NULL,
  calculation_trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payroll_period_id, employee_id)
);

CREATE TABLE performance_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  department_id uuid REFERENCES departments(id),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  template jsonb NOT NULL,
  status workflow_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE performance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES performance_cycles(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  reviewer_id uuid NOT NULL REFERENCES employees(id),
  review_type text NOT NULL,
  ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_rating numeric(4,2),
  comments text,
  status workflow_status NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  UNIQUE(cycle_id, employee_id, reviewer_id, review_type)
);

CREATE TABLE hr_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid REFERENCES business_heads(id),
  employee_id uuid REFERENCES employees(id),
  event_type text NOT NULL,
  title text NOT NULL,
  event_date date NOT NULL,
  source_record_type text,
  source_record_id uuid,
  status text NOT NULL DEFAULT 'upcoming',
  reminder_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_calendar_date_idx ON hr_calendar_events(event_date, business_head_id);

CREATE TABLE workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type text NOT NULL,
  record_id uuid NOT NULL,
  title text NOT NULL,
  assigned_to uuid REFERENCES users(id),
  due_at timestamptz,
  status workflow_status NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id),
  candidate_id uuid REFERENCES candidates(id),
  category text NOT NULL,
  file_name text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  expires_on date,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  business_head_id uuid REFERENCES business_heads(id),
  before_data jsonb,
  after_data jsonb,
  reason text,
  ip_address inet,
  user_agent text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX audit_entity_idx ON audit_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_actor_idx ON audit_events(actor_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
