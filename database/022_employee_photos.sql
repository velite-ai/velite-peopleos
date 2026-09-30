ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS photo_object_key text,
  ADD COLUMN IF NOT EXISTS photo_content_type text,
  ADD COLUMN IF NOT EXISTS photo_updated_at timestamptz;
