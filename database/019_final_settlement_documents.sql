ALTER TABLE final_settlements
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES documents(id);

ALTER TABLE document_generation_jobs
  DROP CONSTRAINT IF EXISTS document_generation_jobs_job_type_check;

ALTER TABLE document_generation_jobs
  ADD CONSTRAINT document_generation_jobs_job_type_check
  CHECK (job_type IN ('payslip', 'letter', 'final_settlement'));

CREATE INDEX IF NOT EXISTS final_settlements_document_idx
  ON final_settlements(document_id) WHERE document_id IS NOT NULL;
