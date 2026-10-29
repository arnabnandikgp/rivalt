BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rivalt/schema',0));
CREATE TABLE IF NOT EXISTS liquidity_maker_heartbeats (
  run_id text NOT NULL REFERENCES runs, market_index integer NOT NULL CHECK(market_index IN (0,1)),
  instance integer NOT NULL CHECK(instance BETWEEN 0 AND 2), registration text NOT NULL,
  updater text NOT NULL, process_id integer NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL, PRIMARY KEY(run_id,market_index,instance), UNIQUE(run_id,registration)
);
-- Shared code/input bytes are retained once by content hash, not once per tick.
CREATE TABLE IF NOT EXISTS liquidity_input_blobs (digest text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS liquidity_intent_inputs (
  run_id text NOT NULL, request_id text NOT NULL, input_digest text NOT NULL, context_slot numeric(20,0) NOT NULL,
  account_refs jsonb NOT NULL, calculation jsonb NOT NULL,
  PRIMARY KEY(run_id,request_id), FOREIGN KEY(run_id,request_id) REFERENCES service_intents
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='liquidity_inputs_immutable') THEN
    CREATE TRIGGER liquidity_inputs_immutable BEFORE UPDATE OR DELETE ON liquidity_intent_inputs FOR EACH ROW EXECUTE FUNCTION immutable_journal();
    CREATE TRIGGER liquidity_blobs_immutable BEFORE UPDATE OR DELETE ON liquidity_input_blobs FOR EACH ROW EXECUTE FUNCTION immutable_journal();
  END IF;
END $$;
COMMIT;
