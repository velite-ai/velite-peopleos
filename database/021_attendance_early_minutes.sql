ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS early_minutes integer NOT NULL DEFAULT 0;
