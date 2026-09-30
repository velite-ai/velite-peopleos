-- A source record owns one calendar milestone of each event type.  Dates are
-- deliberately excluded so rescheduling updates an existing reminder instead
-- of leaving an obsolete duplicate behind.
DELETE FROM hr_calendar_events stale
USING hr_calendar_events keep
WHERE stale.source_record_id IS NOT NULL
  AND stale.source_record_type = keep.source_record_type
  AND stale.source_record_id = keep.source_record_id
  AND stale.event_type = keep.event_type
  AND (stale.created_at, stale.id) < (keep.created_at, keep.id);

DROP INDEX IF EXISTS hr_calendar_source_event_unique;

CREATE UNIQUE INDEX hr_calendar_source_event_unique
  ON hr_calendar_events(source_record_type, source_record_id, event_type)
  WHERE source_record_id IS NOT NULL;

