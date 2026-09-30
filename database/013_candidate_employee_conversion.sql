ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS source_candidate_id uuid REFERENCES candidates(id),
  ADD COLUMN IF NOT EXISTS source_offer_id uuid REFERENCES candidate_offers(id);

CREATE UNIQUE INDEX IF NOT EXISTS employees_source_candidate_unique
  ON employees(source_candidate_id) WHERE source_candidate_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_source_offer_unique
  ON employees(source_offer_id) WHERE source_offer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_work_email_ci_unique
  ON employees(lower(btrim(work_email)))
  WHERE work_email IS NOT NULL AND btrim(work_email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS employees_personal_email_ci_unique
  ON employees(lower(btrim(personal_email)))
  WHERE personal_email IS NOT NULL AND btrim(personal_email) <> '';

ALTER TABLE onboarding_cases
  ADD COLUMN IF NOT EXISTS accepted_offer_id uuid REFERENCES candidate_offers(id),
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS converted_by uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS onboarding_candidate_conversion_idx
  ON onboarding_cases(candidate_id, employee_id, converted_at DESC);
