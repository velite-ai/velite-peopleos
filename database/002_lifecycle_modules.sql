CREATE TABLE job_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_code text NOT NULL UNIQUE,
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  department_id uuid REFERENCES departments(id),
  position text NOT NULL,
  openings integer NOT NULL DEFAULT 1 CHECK (openings > 0),
  employment_type text NOT NULL DEFAULT 'permanent',
  budget_min numeric(14,2),
  budget_max numeric(14,2),
  hiring_manager_id uuid REFERENCES employees(id),
  recruiter_id uuid REFERENCES users(id),
  reason text NOT NULL,
  status workflow_status NOT NULL DEFAULT 'draft',
  target_date date,
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS requisition_id uuid REFERENCES job_requisitions(id);

CREATE TABLE candidate_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  notes text,
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interview_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  round_name text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 45,
  panel jsonb NOT NULL DEFAULT '[]'::jsonb,
  scorecard jsonb,
  recommendation text,
  status text NOT NULL DEFAULT 'scheduled',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id uuid NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  assigned_to uuid REFERENCES users(id),
  due_date date,
  status workflow_status NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE performance_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  parent_goal_id uuid REFERENCES performance_goals(id),
  title text NOT NULL,
  description text,
  weight numeric(5,2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  target_value numeric(14,2),
  actual_value numeric(14,2),
  progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calibration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES performance_cycles(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  scheduled_at timestamptz,
  status workflow_status NOT NULL DEFAULT 'pending',
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  locked_at timestamptz,
  locked_by uuid REFERENCES users(id),
  UNIQUE(cycle_id, department_id)
);

CREATE TABLE helpdesk_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL UNIQUE,
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  employee_id uuid REFERENCES employees(id),
  category text NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  confidential boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES users(id),
  due_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE separations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  separation_type text NOT NULL,
  submitted_date date NOT NULL,
  proposed_last_working_date date NOT NULL,
  approved_last_working_date date,
  reason text NOT NULL,
  regrettable boolean,
  rehire_eligible boolean,
  notice_days integer NOT NULL DEFAULT 0,
  status workflow_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, submitted_date)
);

CREATE TABLE separation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  separation_id uuid NOT NULL REFERENCES separations(id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  assigned_to uuid REFERENCES users(id),
  due_date date,
  status workflow_status NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX candidate_requisition_idx ON candidates(requisition_id, stage);
CREATE INDEX onboarding_status_idx ON onboarding_cases(status, planned_joining_date);
CREATE INDEX helpdesk_queue_idx ON helpdesk_cases(status, priority, due_at);
CREATE INDEX separation_status_idx ON separations(status, proposed_last_working_date);
CREATE UNIQUE INDEX hr_calendar_source_event_unique ON hr_calendar_events(source_record_type, source_record_id, event_type, event_date) WHERE source_record_id IS NOT NULL;
