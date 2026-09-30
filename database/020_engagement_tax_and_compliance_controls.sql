ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS survey_type text NOT NULL DEFAULT 'pulse',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT surveys_valid_window CHECK (closes_at > opens_at),
  ADD CONSTRAINT surveys_maker_checker CHECK (approved_by IS NULL OR approved_by <> created_by);

ALTER TABLE survey_responses
  ADD COLUMN IF NOT EXISTS respondent_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_respondent_hash_unique
  ON survey_responses(survey_id, respondent_hash) WHERE respondent_hash IS NOT NULL;

ALTER TABLE recognitions
  ADD COLUMN IF NOT EXISTS business_head_id uuid REFERENCES business_heads(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','pending','published','rejected','withdrawn'));

UPDATE recognitions r SET business_head_id=e.business_head_id
FROM employees e WHERE e.id=r.recipient_employee_id AND r.business_head_id IS NULL;

ALTER TABLE tax_declarations
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT tax_declarations_regime_check CHECK (regime IN ('old','new')),
  ADD CONSTRAINT tax_declarations_reviewer_check CHECK (reviewed_by IS NULL OR reviewed_by <> created_by);

ALTER TABLE tax_proofs
  ADD CONSTRAINT tax_proofs_amount_check CHECK (amount >= 0),
  ADD CONSTRAINT tax_proofs_document_unique UNIQUE (tax_declaration_id, document_id);

ALTER TABLE compliance_items
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS evidence_document_id uuid REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE compliance_items
  ADD CONSTRAINT compliance_items_status_check
  CHECK (status IN ('pending','in_progress','filed','completed','overdue','cancelled'));

CREATE INDEX IF NOT EXISTS surveys_scope_status_idx ON surveys(business_head_id,status,opens_at,closes_at);
CREATE INDEX IF NOT EXISTS tax_declarations_review_idx ON tax_declarations(status,financial_year);
CREATE INDEX IF NOT EXISTS recognitions_head_created_idx ON recognitions(business_head_id,created_at DESC);
