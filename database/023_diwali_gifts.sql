-- Diwali gift register. Visible to an unrestricted Super Administrator only (enforced in the API).
-- Everything that identifies the recipient or states a value is kept in details_encrypted (AES-256-GCM,
-- DATA_ENCRYPTION_KEY), so a database dump or backup does not show it. Only the year and status stay readable.
-- Its change log is kept here, not in audit_events, because audit_events is readable by other roles.
CREATE TABLE diwali_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_year integer NOT NULL CHECK (gift_year BETWEEN 2000 AND 2100),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','bought','handed_over')),
  details_encrypted bytea NOT NULL,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id)
);

CREATE INDEX diwali_gifts_year_idx ON diwali_gifts (gift_year, created_at) WHERE deleted_at IS NULL;

CREATE TABLE diwali_gift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL REFERENCES diwali_gifts(id),
  action text NOT NULL CHECK (action IN ('create','update','delete')),
  actor_user_id uuid REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
