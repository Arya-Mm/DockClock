-- Money/audit tables are append-only (PLAN §3). App code may only INSERT.
-- WebhookEvent allows a single UPDATE that sets processedAt from NULL (dedupe + forward-only, M9).
CREATE OR REPLACE FUNCTION dc_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON "EvidenceEvent" FOR EACH ROW EXECUTE FUNCTION dc_forbid_mutation();
CREATE TRIGGER plan_append_only BEFORE UPDATE OR DELETE ON "Plan" FOR EACH ROW EXECUTE FUNCTION dc_forbid_mutation();
CREATE TRIGGER agent_action_append_only BEFORE UPDATE OR DELETE ON "AgentAction" FOR EACH ROW EXECUTE FUNCTION dc_forbid_mutation();

CREATE OR REPLACE FUNCTION dc_webhook_forward_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WebhookEvent is append-only'; END IF;
  IF OLD."processedAt" IS NOT NULL OR NEW."eventId" <> OLD."eventId" OR NEW."rawBody" <> OLD."rawBody" THEN
    RAISE EXCEPTION 'WebhookEvent may only set processedAt once';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER webhook_forward_only BEFORE UPDATE OR DELETE ON "WebhookEvent" FOR EACH ROW EXECUTE FUNCTION dc_webhook_forward_only();
