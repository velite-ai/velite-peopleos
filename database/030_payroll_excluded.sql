-- People who are on the staff list but are never paid a salary through the app (for example the owner and family).
-- A person with payroll_excluded = true is left out of: the attendance month summary / lock, the Salary inputs panel and the salary calculation.
-- Everything else about the record is unchanged. Set or clear it with scripts/set-payroll-exclusion.mjs (CLAUDE.md section 42).
ALTER TABLE employees ADD COLUMN payroll_excluded boolean NOT NULL DEFAULT false;
