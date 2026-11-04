-- Gift master for the Diwali register: the list of gifts (Comforter Set, Dry Fruit, ...) with a standard price each.
-- Names and prices are kept sealed (AES-256-GCM, DATA_ENCRYPTION_KEY) like the rest of the register; visible to the same people only.
CREATE TABLE diwali_gift_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  details_encrypted bytea NOT NULL,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
