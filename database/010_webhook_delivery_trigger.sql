CREATE OR REPLACE FUNCTION queue_audit_webhooks() RETURNS trigger AS $$
BEGIN
  INSERT INTO webhook_deliveries (webhook_id,event_type,event_id,payload)
  SELECT w.id,NEW.action,NEW.id,jsonb_build_object(
    'id',NEW.id,'occurredAt',NEW.occurred_at,'action',NEW.action,'entityType',NEW.entity_type,
    'entityId',NEW.entity_id,'businessHeadId',NEW.business_head_id,'correlationId',NEW.correlation_id
  )
  FROM outbound_webhooks w WHERE w.active=true AND w.event_types ? NEW.action
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_queue_webhooks AFTER INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION queue_audit_webhooks();
