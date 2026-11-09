-- How a company's paid days are worked out.
--   'marked'       : days marked present, plus weekly offs and holidays marked in attendance (the original method).
--   'velite_table' : days present, plus Sundays and national holidays granted by the attendance table, plus paid leave
--                    (lib/paid-days-rules.ts). Joiners after the 7th and leavers get working days only.
-- Switched on for Others 1 only. To switch a company later:  UPDATE business_heads SET paid_days_rule='velite_table' WHERE name='Others 2';
ALTER TABLE business_heads ADD COLUMN paid_days_rule text NOT NULL DEFAULT 'marked' CHECK (paid_days_rule IN ('marked', 'velite_table'));
UPDATE business_heads SET paid_days_rule = 'velite_table' WHERE name = 'Others 1';

-- The national holidays of a salary month (typed on the Salary inputs panel); they decide the working days and the holidays granted.
ALTER TABLE payroll_periods ADD COLUMN national_holidays date[] NOT NULL DEFAULT '{}';
