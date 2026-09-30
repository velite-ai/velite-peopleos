CREATE TABLE grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_head_id uuid REFERENCES business_heads(id),
  code text NOT NULL, name text NOT NULL, band_min numeric(14,2), band_mid numeric(14,2), band_max numeric(14,2),
  active boolean NOT NULL DEFAULT true, UNIQUE (business_head_id, code)
);

CREATE TABLE employee_dependants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  full_name text NOT NULL, relationship text NOT NULL, date_of_birth date, details_encrypted bytea, active boolean NOT NULL DEFAULT true
);
CREATE TABLE employee_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  full_name text NOT NULL, relationship text, phone_encrypted bytea NOT NULL, priority integer NOT NULL DEFAULT 1
);
CREATE TABLE employee_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  institution text NOT NULL, qualification text NOT NULL, specialization text, start_year integer, end_year integer,
  document_id uuid REFERENCES documents(id), verified_at timestamptz, verified_by uuid REFERENCES users(id)
);
CREATE TABLE employee_experience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  employer text NOT NULL, position text NOT NULL, start_date date NOT NULL, end_date date, description text, document_id uuid REFERENCES documents(id)
);

CREATE TABLE holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_head_id uuid REFERENCES business_heads(id),
  work_location_id uuid REFERENCES work_locations(id), holiday_date date NOT NULL, name text NOT NULL,
  optional boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  UNIQUE (business_head_id, work_location_id, holiday_date, name)
);
CREATE TABLE weekly_off_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_head_id uuid NOT NULL REFERENCES business_heads(id),
  name text NOT NULL, pattern jsonb NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE (business_head_id, name)
);
CREATE TABLE raw_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  punched_at timestamptz NOT NULL, direction text, device_id text, source text NOT NULL, external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_head_id uuid REFERENCES business_heads(id),
  import_type text NOT NULL, file_name text NOT NULL, status text NOT NULL DEFAULT 'uploaded',
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb, summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  previewed_at timestamptz, committed_at timestamptz, rolled_back_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_job_rows (
  id bigserial PRIMARY KEY, import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number integer NOT NULL, source_data jsonb NOT NULL, normalized_data jsonb, errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  committed_record_type text, committed_record_id uuid, UNIQUE (import_job_id, row_number)
);

CREATE TABLE workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  record_type text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id),
  version integer NOT NULL, scope jsonb NOT NULL DEFAULT '{}'::jsonb, trigger_config jsonb NOT NULL,
  steps jsonb NOT NULL, effective_from date NOT NULL, effective_to date, status workflow_status NOT NULL DEFAULT 'draft',
  change_reason text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workflow_definition_id, version)
);
CREATE TABLE workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id),
  business_head_id uuid REFERENCES business_heads(id), record_type text NOT NULL, record_id uuid NOT NULL,
  current_step text, status workflow_status NOT NULL DEFAULT 'pending', context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE workflow_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_instance_id uuid NOT NULL REFERENCES workflow_instances(id),
  step_code text NOT NULL, action text NOT NULL, actor_user_id uuid REFERENCES users(id), comments text,
  due_at timestamptz, acted_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE approval_matrices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, business_head_id uuid REFERENCES business_heads(id),
  record_type text NOT NULL, conditions jsonb NOT NULL DEFAULT '{}'::jsonb, approver_chain jsonb NOT NULL,
  effective_from date NOT NULL, effective_to date, version integer NOT NULL, status workflow_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id), UNIQUE (code, version)
);
CREATE TABLE notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, channel text NOT NULL,
  subject_template text, body_template text NOT NULL, locale text NOT NULL DEFAULT 'en-IN', version integer NOT NULL,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (code, channel, locale, version)
);

CREATE TABLE custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_type text NOT NULL, code text NOT NULL,
  label text NOT NULL, data_type text NOT NULL, validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility jsonb NOT NULL DEFAULT '{}'::jsonb, required boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  UNIQUE (record_type, code)
);
CREATE TABLE custom_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES custom_field_definitions(id),
  record_id uuid NOT NULL, value jsonb NOT NULL, updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, record_id)
);

CREATE TABLE generated_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  letter_type text NOT NULL, template_version text NOT NULL, effective_date date NOT NULL,
  snapshot jsonb NOT NULL, document_id uuid REFERENCES documents(id), status text NOT NULL DEFAULT 'draft',
  generated_by uuid NOT NULL REFERENCES users(id), generated_at timestamptz NOT NULL DEFAULT now(), issued_at timestamptz
);

CREATE TABLE skill_catalogue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  category text, description text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  skill_id uuid NOT NULL REFERENCES skill_catalogue(id), proficiency numeric(4,2), target_proficiency numeric(4,2),
  evidence text, assessed_at timestamptz, assessed_by uuid REFERENCES users(id), UNIQUE (employee_id, skill_id)
);
CREATE TABLE development_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id), cycle_id uuid REFERENCES performance_cycles(id),
  title text NOT NULL, actions jsonb NOT NULL DEFAULT '[]'::jsonb, due_date date, status workflow_status NOT NULL DEFAULT 'draft',
  owner_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE continuous_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  author_employee_id uuid REFERENCES employees(id), feedback_type text NOT NULL, content text NOT NULL,
  private_to_managers boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_head_id uuid REFERENCES business_heads(id),
  title text NOT NULL, anonymous boolean NOT NULL DEFAULT false, questions jsonb NOT NULL,
  opens_at timestamptz NOT NULL, closes_at timestamptz NOT NULL, status workflow_status NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE TABLE survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), survey_id uuid NOT NULL REFERENCES surveys(id),
  employee_id uuid REFERENCES employees(id), answers jsonb NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id, employee_id)
);
CREATE TABLE recognitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_employee_id uuid NOT NULL REFERENCES employees(id),
  sender_employee_id uuid REFERENCES employees(id), recognition_type text NOT NULL, message text NOT NULL,
  public boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tax_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  financial_year text NOT NULL, regime text NOT NULL, declarations jsonb NOT NULL DEFAULT '{}'::jsonb,
  status workflow_status NOT NULL DEFAULT 'draft', submitted_at timestamptz, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  UNIQUE (employee_id, financial_year)
);
CREATE TABLE tax_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tax_declaration_id uuid NOT NULL REFERENCES tax_declarations(id),
  section_code text NOT NULL, amount numeric(14,2) NOT NULL, document_id uuid REFERENCES documents(id),
  status workflow_status NOT NULL DEFAULT 'pending', reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, remarks text
);
CREATE TABLE compliance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_head_id uuid NOT NULL REFERENCES business_heads(id),
  compliance_type text NOT NULL, period text NOT NULL, due_date date NOT NULL, amount numeric(14,2),
  status text NOT NULL DEFAULT 'pending', reference_number text, completed_at timestamptz,
  owner_id uuid REFERENCES users(id), UNIQUE (business_head_id, compliance_type, period)
);
CREATE TABLE payroll_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  source_payroll_period_id uuid REFERENCES payroll_periods(id), target_payroll_period_id uuid REFERENCES payroll_periods(id),
  component_code text NOT NULL, amount numeric(14,2) NOT NULL, adjustment_type text NOT NULL,
  reason text NOT NULL, status workflow_status NOT NULL DEFAULT 'pending', approved_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE final_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), separation_id uuid NOT NULL UNIQUE REFERENCES separations(id),
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb, gross_payable numeric(14,2) NOT NULL DEFAULT 0,
  recoveries numeric(14,2) NOT NULL DEFAULT 0, net_payable numeric(14,2) NOT NULL DEFAULT 0,
  status workflow_status NOT NULL DEFAULT 'draft', approved_by uuid REFERENCES users(id), paid_at timestamptz, payment_reference text
);

CREATE TABLE export_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES users(id),
  export_type text NOT NULL, business_head_id uuid REFERENCES business_heads(id), filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer, checksum text, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE retention_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_type text NOT NULL UNIQUE, retain_months integer NOT NULL CHECK (retain_months > 0),
  anonymise_after boolean NOT NULL DEFAULT true, legal_hold_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true, approved_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE integration_logs (
  id bigserial PRIMARY KEY, integration_code text NOT NULL, direction text NOT NULL,
  event_type text NOT NULL, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), status text NOT NULL,
  request_summary jsonb, response_summary jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX raw_punch_employee_time_idx ON raw_punches(employee_id, punched_at);
CREATE INDEX import_jobs_status_idx ON import_jobs(status, created_at DESC);
CREATE INDEX workflow_instances_record_idx ON workflow_instances(record_type, record_id, status);
CREATE INDEX compliance_due_idx ON compliance_items(status, due_date);
CREATE INDEX export_events_actor_idx ON export_events(actor_user_id, created_at DESC);
