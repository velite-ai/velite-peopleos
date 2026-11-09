-- Salary inputs: what the accountant decides while working out a salary month, after attendance is locked.
-- One row per person and salary month: paid leave granted, extra overtime hours, advance deducted this month,
-- and "no salary" for someone who stopped coming without informing the company.
CREATE TABLE payroll_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  paid_leave_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (paid_leave_days >= 0 AND paid_leave_days <= 31),
  overtime_hours numeric(7,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  advance_deducted numeric(12,2) NOT NULL DEFAULT 0 CHECK (advance_deducted >= 0),
  no_salary boolean NOT NULL DEFAULT false,
  note text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, employee_id)
);
CREATE INDEX payroll_inputs_period_idx ON payroll_inputs (payroll_period_id);
