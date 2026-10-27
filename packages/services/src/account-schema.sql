BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('rivalt/schema',0));
CREATE TABLE IF NOT EXISTS account_maker_heartbeats (
  run_id text NOT NULL REFERENCES runs,
  market_index integer NOT NULL CHECK(market_index IN (0,1)),
  maker_id integer NOT NULL CHECK(maker_id IN (0,1)),
  registration text NOT NULL, owner text NOT NULL, process_id integer NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL,
  PRIMARY KEY(run_id,market_index,maker_id), UNIQUE(run_id,registration)
);
COMMIT;
