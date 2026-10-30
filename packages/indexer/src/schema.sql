BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rivalt/schema',0));
CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY CHECK (version = 2));
DO $$ BEGIN
  IF to_regclass('schema_version') IS NOT NULL AND EXISTS (SELECT 1 FROM schema_version WHERE version <> 2) THEN
    RAISE EXCEPTION 'Fresh schema-5 journal database required; retained schema-1 originals cannot migrate';
  END IF;
END $$;
INSERT INTO schema_version VALUES (2) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS runs (
  run_id text PRIMARY KEY, binding jsonb NOT NULL, state jsonb NOT NULL,
  checkpoint text, checkpoint_slot bigint, synced_at timestamptz, error text
);
CREATE TABLE IF NOT EXISTS observations (
  run_id text NOT NULL REFERENCES runs, digest text NOT NULL, signature text NOT NULL,
  source text NOT NULL CHECK (source IN ('ws-confirmed','rpc-finalized')),
  payload jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, digest)
);
CREATE TABLE IF NOT EXISTS blocks (
  run_id text NOT NULL REFERENCES runs, slot bigint NOT NULL, blockhash text NOT NULL,
  parent_slot bigint NOT NULL, previous_blockhash text NOT NULL, signature_digest text NOT NULL,
  signatures jsonb NOT NULL, PRIMARY KEY(run_id,slot), UNIQUE(run_id,blockhash)
);
CREATE TABLE IF NOT EXISTS transactions (
  run_id text NOT NULL REFERENCES runs, signature text NOT NULL, slot bigint NOT NULL,
  transaction_index integer NOT NULL, failed boolean NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (run_id, signature)
);
CREATE TABLE IF NOT EXISTS envelopes (
  run_id text NOT NULL, signature text NOT NULL, outer_index integer NOT NULL,
  invocation integer NOT NULL, payload jsonb NOT NULL, bytes text NOT NULL,
  PRIMARY KEY(run_id,signature,outer_index,invocation),
  FOREIGN KEY(run_id,signature) REFERENCES transactions
);
CREATE TABLE IF NOT EXISTS entity_revisions (
  run_id text NOT NULL REFERENCES runs, account text NOT NULL, kind integer NOT NULL,
  revision numeric(20,0) NOT NULL, PRIMARY KEY(run_id,account)
);
CREATE TABLE IF NOT EXISTS events (
  run_id text NOT NULL, signature text NOT NULL, outer_index integer NOT NULL,
  inner_index integer NOT NULL, invocation integer NOT NULL, ordinal integer NOT NULL, sequence numeric(20,0) NOT NULL,
  kind text NOT NULL, payload jsonb NOT NULL, bytes text NOT NULL,
  slot bigint NOT NULL, block_time bigint,
  PRIMARY KEY (run_id, signature, outer_index, inner_index, ordinal),
  UNIQUE (run_id, sequence), FOREIGN KEY (run_id, signature) REFERENCES transactions
);
CREATE TABLE IF NOT EXISTS jobs (
  run_id text NOT NULL REFERENCES runs, signature text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','finalized','failed','unresolved')),
  attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, signature)
);
-- Durable read-stream outbox. Publishing/submitting economic intents belongs to P06.
CREATE TABLE IF NOT EXISTS outbox (
  run_id text NOT NULL, sequence numeric(20,0) NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY (run_id, sequence), FOREIGN KEY (run_id, sequence) REFERENCES events(run_id, sequence)
);
CREATE OR REPLACE FUNCTION immutable_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only journal'; END $$;
CREATE OR REPLACE FUNCTION immutable_run_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.binding IS DISTINCT FROM OLD.binding OR NEW.run_id IS DISTINCT FROM OLD.run_id THEN
    RAISE EXCEPTION 'immutable run binding';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'run_binding_immutable') THEN
    CREATE TRIGGER run_binding_immutable BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION immutable_run_binding();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'observations_immutable') THEN
    CREATE TRIGGER observations_immutable BEFORE UPDATE OR DELETE ON observations FOR EACH ROW EXECUTE FUNCTION immutable_journal();
    CREATE TRIGGER blocks_immutable BEFORE UPDATE OR DELETE ON blocks FOR EACH ROW EXECUTE FUNCTION immutable_journal();
    CREATE TRIGGER envelopes_immutable BEFORE UPDATE OR DELETE ON envelopes FOR EACH ROW EXECUTE FUNCTION immutable_journal();
    CREATE TRIGGER transactions_immutable BEFORE UPDATE OR DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION immutable_journal();
    CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION immutable_journal();
    CREATE TRIGGER outbox_immutable BEFORE UPDATE OR DELETE ON outbox FOR EACH ROW EXECUTE FUNCTION immutable_journal();
  END IF;
END $$;
COMMIT;
