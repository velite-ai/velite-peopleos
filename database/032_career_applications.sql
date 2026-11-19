-- Applications from the careers form on www.velite.in (POST /api/public/careers, CLAUDE.md section 45).
-- One row per application with everything the applicant typed; the candidate in Hiring is created from it (candidate_id).
-- hub_*: the task created in Velite Hub (Supabase function hub_careers_task); the worker retries it when the Hub could not be reached.
CREATE TABLE career_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  position text NOT NULL,
  city text,
  message text,
  consented_at timestamptz NOT NULL,
  business_head_id uuid NOT NULL REFERENCES business_heads(id),
  candidate_id uuid REFERENCES candidates(id),
  source_origin text,
  ip_hash text,
  user_agent text,
  hub_status text NOT NULL DEFAULT 'off' CHECK (hub_status IN ('off','pending','sending','retrying','sent','failed')),
  hub_attempts integer NOT NULL DEFAULT 0,
  hub_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  hub_lease_owner text,
  hub_leased_until timestamptz,
  hub_task_id uuid,
  hub_sent_at timestamptz,
  hub_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX career_applications_ip_idx ON career_applications (ip_hash, created_at DESC);
CREATE INDEX career_applications_hub_idx ON career_applications (hub_next_attempt_at) WHERE hub_status IN ('pending','retrying','sending');

-- A website application is not entered by a logged-in person, so its first stage entry has no "changed by".
ALTER TABLE candidate_stage_events ALTER COLUMN changed_by DROP NOT NULL;
