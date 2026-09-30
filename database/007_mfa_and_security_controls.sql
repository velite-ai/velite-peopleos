CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted bytea NOT NULL,
  active boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  last_counter bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  owner_id uuid REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text
);

CREATE TABLE access_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL UNIQUE,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status workflow_status NOT NULL DEFAULT 'pending',
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_id uuid REFERENCES users(id),
  completed_at timestamptz
);
