-- Salary inputs: days to take off a person's pay on top of what attendance gives (the accountant's decision while working out the salary).
-- Used when the accountant's sheet pays fewer days than the attendance marks (CLAUDE.md section 44).
ALTER TABLE payroll_inputs ADD COLUMN extra_unpaid_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (extra_unpaid_days >= 0 AND extra_unpaid_days <= 31);
