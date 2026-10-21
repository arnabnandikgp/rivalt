BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rivalt/schema',0));
CREATE TABLE IF NOT EXISTS service_intents (
  run_id text NOT NULL REFERENCES runs, request_id text NOT NULL,
  signature text NOT NULL, wire text NOT NULL, blockhash text NOT NULL,
  authority jsonb, budget text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','unresolved','finalized','failed','expired-unexecuted')),
  attempts integer NOT NULL DEFAULT 0, result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  next_attempt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,request_id), UNIQUE(run_id,signature)
);
CREATE TABLE IF NOT EXISTS service_budgets (
  run_id text NOT NULL REFERENCES runs, name text NOT NULL, wallet text NOT NULL,
  cap bigint NOT NULL CHECK(cap>0), committed bigint NOT NULL DEFAULT 0 CHECK(committed>=0),
  spent bigint NOT NULL DEFAULT 0 CHECK(spent>=0),
  PRIMARY KEY(run_id,name), CHECK(committed+spent<=cap)
);
CREATE TABLE IF NOT EXISTS maker_heartbeats (
  run_id text NOT NULL REFERENCES runs, maker_id integer NOT NULL CHECK(maker_id IN (0,1)),
  owner text NOT NULL, process_id integer NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL, PRIMARY KEY(run_id,maker_id)
);
CREATE OR REPLACE FUNCTION immutable_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.run_id,NEW.request_id,NEW.signature,NEW.wire,NEW.blockhash,NEW.authority,NEW.budget)
    IS DISTINCT FROM (OLD.run_id,OLD.request_id,OLD.signature,OLD.wire,OLD.blockhash,OLD.authority,OLD.budget)
  THEN RAISE EXCEPTION 'immutable signed intent'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='service_intent_immutable') THEN
    CREATE TRIGGER service_intent_immutable BEFORE UPDATE ON service_intents FOR EACH ROW EXECUTE FUNCTION immutable_intent();
  END IF;
END $$;
COMMIT;
