-- Register of the one-click printed letters (offer, appointment, confirmation, salary revision, employment verification,
-- acceptance of resignation, relieving, experience).
-- One row per person, letter type and day, so printing the same letter again the same day reuses its reference number.
-- The reference number is company / financial year / month / day / serial, e.g. VH/2026-27/05/13/1.
CREATE TABLE printed_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  letter_type text NOT NULL CHECK (letter_type IN ('offer', 'appointment', 'confirmation', 'salary_revision', 'employment_verification', 'acceptance', 'relieving', 'experience')),
  letter_date date NOT NULL,
  serial integer NOT NULL CHECK (serial > 0),
  reference_no text NOT NULL UNIQUE,
  printed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, letter_type, letter_date),
  UNIQUE (business_head_id, letter_date, serial)
);
CREATE INDEX printed_letters_employee_idx ON printed_letters(employee_id, created_at DESC);
