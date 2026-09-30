ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employee_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS employees_head_code_unique
  ON employees(business_head_id, employee_code);

CREATE TABLE IF NOT EXISTS salary_register_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  period_month date NOT NULL,
  source_file_name text NOT NULL,
  source_sha256 text NOT NULL UNIQUE,
  imported_by uuid REFERENCES users(id),
  record_count integer NOT NULL CHECK (record_count >= 0),
  totals jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_head_id, period_month, source_sha256)
);

CREATE TABLE IF NOT EXISTS salary_register_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES salary_register_imports(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  register_type text NOT NULL CHECK (register_type IN ('salary','wages')),
  source_page integer,
  source_serial integer,
  attendance_days numeric(6,2) NOT NULL,
  monthly_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  earned_dues jsonb NOT NULL DEFAULT '{}'::jsonb,
  deductions jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_dues numeric(14,2) NOT NULL,
  total_deductions numeric(14,2) NOT NULL,
  net_payable numeric(14,2) NOT NULL,
  raw_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (import_id, employee_id)
);

CREATE INDEX IF NOT EXISTS salary_register_imports_head_period_idx
  ON salary_register_imports(business_head_id, period_month DESC);
CREATE INDEX IF NOT EXISTS salary_register_lines_employee_idx
  ON salary_register_lines(employee_id, import_id);
