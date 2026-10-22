-- The printed-letter register now also covers (1) offer letters printed from the Hiring screen, which belong to a candidate's offer
-- and not to an employee, and (2) the trainee experience certificate.
ALTER TABLE printed_letters ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE printed_letters ADD COLUMN offer_id uuid REFERENCES candidate_offers(id);
ALTER TABLE printed_letters ADD CONSTRAINT printed_letters_one_owner CHECK ((employee_id IS NOT NULL)::int + (offer_id IS NOT NULL)::int = 1);
ALTER TABLE printed_letters DROP CONSTRAINT printed_letters_letter_type_check;
ALTER TABLE printed_letters ADD CONSTRAINT printed_letters_letter_type_check
  CHECK (letter_type IN ('offer', 'appointment', 'confirmation', 'salary_revision', 'employment_verification', 'acceptance', 'relieving', 'experience', 'trainee_certificate'));
CREATE UNIQUE INDEX printed_letters_offer_unique ON printed_letters(offer_id, letter_type, letter_date) WHERE offer_id IS NOT NULL;
