ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS personal_details_encrypted bytea;

CREATE TABLE employee_sensitive_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  requested_changes_encrypted bytea NOT NULL,
  changed_fields text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES users(id),
  request_reason text NOT NULL,
  decided_by uuid REFERENCES users(id),
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(changed_fields) > 0),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE UNIQUE INDEX employee_sensitive_change_one_pending_idx
  ON employee_sensitive_change_requests(employee_id) WHERE status = 'pending';

CREATE INDEX employee_sensitive_change_queue_idx
  ON employee_sensitive_change_requests(status, created_at DESC);

ALTER TABLE employee_emergency_contacts
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE employee_emergency_contacts
  ADD CONSTRAINT employee_emergency_contacts_priority_check
  CHECK (priority BETWEEN 1 AND 20);

CREATE INDEX employee_emergency_contacts_employee_idx
  ON employee_emergency_contacts(employee_id, active, priority);

ALTER TABLE generated_letters
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS request_reason text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE generated_letters
SET requested_by = generated_by,
    request_reason = COALESCE(request_reason, 'Legacy letter record')
WHERE requested_by IS NULL OR request_reason IS NULL;

ALTER TABLE generated_letters
  ALTER COLUMN requested_by SET NOT NULL,
  ALTER COLUMN request_reason SET NOT NULL,
  ADD CONSTRAINT generated_letters_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'issued', 'cancelled')),
  ADD CONSTRAINT generated_letters_distinct_approver_check
  CHECK (approved_by IS NULL OR approved_by <> requested_by);

CREATE INDEX generated_letters_employee_status_idx
  ON generated_letters(employee_id, status, generated_at DESC);

CREATE UNIQUE INDEX generated_letters_one_live_request_idx
  ON generated_letters(employee_id, letter_type, effective_date)
  WHERE status IN ('pending', 'approved', 'issued');

ALTER TABLE employee_skills
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT employee_skills_proficiency_check
  CHECK (proficiency IS NULL OR proficiency BETWEEN 0 AND 5),
  ADD CONSTRAINT employee_skills_target_proficiency_check
  CHECK (target_proficiency IS NULL OR target_proficiency BETWEEN 0 AND 5);

ALTER TABLE development_plans
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE development_plans
SET created_by = owner_id
WHERE created_by IS NULL AND owner_id IS NOT NULL;

ALTER TABLE development_plans
  ADD CONSTRAINT development_plans_actions_array_check
  CHECK (jsonb_typeof(actions) = 'array'),
  ADD CONSTRAINT development_plans_distinct_approver_check
  CHECK (approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);

CREATE INDEX development_plans_employee_status_idx
  ON development_plans(employee_id, status, due_date);

CREATE INDEX employee_skills_employee_active_idx
  ON employee_skills(employee_id, active);
