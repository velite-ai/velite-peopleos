ALTER TABLE statutory_rule_sets
  ADD CONSTRAINT statutory_rule_set_valid_dates
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  ADD CONSTRAINT statutory_rule_set_maker_checker
  CHECK (approved_by IS NULL OR approved_by <> created_by);

