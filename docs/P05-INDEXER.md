# P05 indexer and read contract

The implemented profile is the P02 custody/P03 makers/P04 synthetic-risk venue. `packages/indexer` owns a separately restartable Node service; it does not sign transactions or enable settlement, funding, orders or authenticated oracle inputs. Current acceptance status belongs to WORKLOG; [clean acceptance evidence](evidence/P05.md) records A06/G06 verification.

## Exact runtime and local operation

Node 24.22.0, Fastify 5.12.7, pg/@types/pg 8.23.1 and PostgreSQL 18.6 are pinned. The existing Apple container CLI 1.4.1 runs the official Linux arm64 PostgreSQL image, manifest `sha256:89f747171c4b0af0eacf5984550060be79786dbe286eb60cfa691d79d1e8b23f` (index `77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873`). Pull with `container image pull --platform linux/arm64 docker.io/library/postgres:18.6-alpine`; omitting the platform downloads/unpacks all architectures. The host's PostgreSQL 14 is not used or replaced.

`source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` builds and runs the full acceptance path. `bash ops/rpc-smoke.sh` is the targeted RPC/service path using already-built binaries; it does not independently prove their build provenance. Both start a fresh offline Surfpool, deploy actual programs, provision real SPL custody and start a dedicated database through `ops/postgres.sh`. HTTP/WS ports default to 18899/18900 and PostgreSQL to 15432; occupied ports reject. PostgreSQL uses a bound per-run data directory, two CPUs and 512 MiB. Password files are random, mode 0600 and ignored under `.local/`; they are never copied into evidence. Cleanup stops only the recorded Surfpool PID and named database container, retaining database files for diagnosis.

To operate the service against an existing local run, securely configure `RIVALT_DATABASE_URL`, `RIVALT_RPC_URL`, `RIVALT_WS_URL`, `RIVALT_RUN_ID`, `RIVALT_MARKET` and `RIVALT_INIT_SIGNATURE`, then run `pnpm indexer`. Optional `RIVALT_API_PORT` defaults to 18080. The API binds loopback only. The service migrates/binds, subscribes before recovery, then polls every second. SIGINT/SIGTERM finish the current bounded operation and release the listener/database lease. No financial keys are required. The isolated reset acceptance uses `RIVALT_RESET_API_PORT` (default 18082); full smoke checks all required listeners before building and leaves unrelated services untouched.

## Canonical journal and recovery

The explicit run name is bound to genesis hash, clearing program, market, domain, initialization signature and SHA-256 of that transaction. The anchor must decode to custody initialization sequence 1. Startup and every indexing cycle verify chain identity. A changed run must use a fresh identity/database; a missing anchor or checkpoint fails closed. Deterministic market PDAs or domains alone are insufficient to identify a local chain.

1. Subscribe at confirmed commitment and buffer up to 5,000 notifications. Buffer overflow or disconnect makes the service unready and requires resubscription/backfill. Journal notifications as provisional hints; they never directly change balances.
2. Page `getSignaturesForAddress` at finalized commitment, using `before`, until the durable checkpoint (or initialization on first build). Default pages contain 100 signatures, acceptance uses three to force pagination. The boundary must actually be found. Repeated pages, missing boundaries and more than 10,000 new transactions in one local recovery batch are explicit failures, not skipped history. Large archive/bootstrap support remains an operational limitation for later scale work.
3. Independently fetch each transaction with `getTransaction`, JSON encoding and maximum version 0. Verify signature, slot, error metadata and inner instruction availability. Journal failed transactions, but decode no financial effects from them, even when their logs/inner instructions contain reverted events.
4. Require clearing as producer, the Anchor event-CPI envelope `e445a52e51cb9a1d`, its single canonical event-authority account, known discriminator/version and exact payload length. Only the nonfinancial P01 probe is ignored. Decode the version-1 custody, maker, test-risk and aggregate-route events through generated codecs. Any unknown critical schema blocks projection.
5. Sort critical events by market sequence, require every next sequence, and apply all paired effects of one aggregate route once. Route legs are constituent details, not additional aggregate fills. Validate cash conservation and zero net lots. Reconcile every participant, stable registry membership, maker epochs/consumption, risk state and market against a single finalized `getMultipleAccounts` response. The token vault must cover allocated cash; unallocated surplus is reported separately. Concurrent chain progress triggers another history pass, never a partial ready projection.

The schema is [`schema.sql`](../packages/indexer/src/schema.sql). `runs` contains the immutable binding, bounded participant/maker projection snapshot and checkpoint. Monetary JSONB fields are decimal strings, sequence columns are `numeric(20,0)` and slots are PostgreSQL bigint. `observations` records immutable confirmed-WS and finalized-RPC inputs. `transactions` retains canonical successful/failed metadata. `events` is unique by `(run, signature, outer instruction, inner instruction, ordinal)` and separately by `(run, sequence)`. SQL triggers reject journal/outbox updates or deletes.

One SQL transaction commits canonical transactions, deduplicated events, all projection changes, outbox records and checkpoint. A rollback retains observations but none of those effects. A PostgreSQL advisory lease permits one indexer per run; a lost lease fails closed and requires a service restart; the checkpoint row is also locked. Every event's outbox entry is the durable read-stream record. `jobs` holds observed signatures and pending/finalized/failed/unresolved finality state, retry attempts and next attempt time. Missing status stays unresolved; it is never treated as proof of nonexecution or a fork. A finalized observation missing from the canonical scan blocks readiness. Submission bytes, economic intent, quote candidates and execution retry policy belong to P06/G07 and have no success-returning placeholder endpoints here.

## Read API version 1

All financial integers are decimal strings, with explicit units and finalized as-of sequence/signature/slot. No endpoint turns unpaid profit into withdrawable cash. The current funding index/checkpoints/reservations/order slots remain their implemented zero state. Test-route mode always reports zero withdrawable cash; custody mode follows its pause gate. Risk reads use the current processed slot to label the stored test observation Fresh/Expired, while financial state remains finalized. Positive unpaid-P&L margin credit is zero; adverse negative liability rounds upward to whole atoms, and initial margin uses the upper risk bound. This is a read of the synthetic profile, not source independence or P07 funding acceptance.

| Endpoint | Contract |
|---|---|
| `/live` | Process liveness |
| `/ready` | 200 only after successful reconciliation, active WS and a sync less than 10 seconds old; otherwise 503 |
| `/metrics` | Cycle, page, transaction, notification, reconnect and failure counters |
| `/v1/market` | Buckets, mode, pause, risk observation/freshness and maker projections |
| `/v1/balances/:participant` | C, q, virtual quote, unpaid P&L, adverse liability/equity, initial margin, reserved and withdrawable cash separately |
| `/v1/orders` | Explicit `supported:false`; no order lifecycle is claimed |
| `/v1/trades?after=0&limit=50` | Actual aggregate route fills, ascending exclusive sequence cursor, limit 1–100; leg details retained |
| `/v1/events?after=0&limit=50` | All canonical critical events with the same pagination |
| `/v1/candles?from=...&to=...` | Actual aggregate-fill 60-second buckets, at most one-day request window; exact rational OHLC prices and integer base/quote volumes |

Trade/event/candle reads use a repeatable-read SQL snapshot with their envelope. Empty candle buckets are not forward-filled; transactions without block time are explicitly counted as unplaced. No quote/preview price is a fill or candle. Invalid input returns 400, unknown participant 404, and stale/gapped/disconnected projections return 503. Internal transport/database errors are not exposed or logged with credentials. Operational metrics are extended to Prometheus text in this phase; labels never contain signatures or secrets.

## Verification boundary

Acceptance must exercise actual signed deposits, maker controls and routes; WS ingestion; multi-page history; SQL checkpoint rollback; duplicate/reordered events; retained-but-reverted failed events; WS disconnect; missing history/metadata; process/database restart; fresh database rebuild; chain/vault reconciliation; HTTP reads and invalid cursors. Fault injection may remove real RPC responses or fail a SQL commit; it must not invent successful financial state. Hand-calculated long/short/fractional-loss vectors separately check risk reads.

This phase does not claim P06 lifecycle settlement/withdrawal, consensus finality, production availability, load/soak, devnet, external review or funded readiness.

P10 interface addendum: read envelopes expose public `deployment:{genesis,anchor,domain}` binding so browser history cannot be mixed with another local run. Trades/events support bounded `latest=true` (limit 1–100), returning the newest window in ascending sequence order with `next:null`; combining it with `after` rejects. Default ascending exclusive cursor semantics are unchanged. P08 supersedes the original unsupported-order row above with actual durable order projections. These additions retain finalized repeatable-read snapshots and explicit unavailable states.
