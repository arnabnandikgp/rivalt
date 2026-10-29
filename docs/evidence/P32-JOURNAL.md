# P32 prototype PostgreSQL journal checkpoint

Scoped pass on clean client `5d265614773f879c9f2c607899be9e5da824ecde` and unchanged
clean SBF `6437f7d7b5d941dd29e3da7aeaccb4401722aa2d`:
`RIVALT_RPC_PORT=18951 RIVALT_WS_PORT=18952 bash ops/liquidity-journal-smoke.sh`.

Local raw evidence:
`.local/liquidity-execution/runs/20261029T155732Z-35413/`.
It includes original signed/fetched transactions and WS observations, summary,
PostgreSQL 18.6/image identity, and the retained local database. Credentials are
restricted and ignored. Only this run's container/runtime was stopped and removed;
database files, evidence and keys remain local.

The run records 120 finalized RPC/WS outcomes (116 success / four expected rejection).
Custody-address RPC pagination independently fetches 90 relevant transactions and
authenticates 72 critical clearing events. PostgreSQL has 72 events, 72 outbox entries,
four failed transactions and zero unresolved jobs. New event populations include
26 funding reports and two canonical route events.

The production generic `JournalStore` is exercised with a deliberately test-only
schema-4 sequence/digest projection. This does not enable production account views
or substitute for P33's full balance projection and durable workers. Existing
schema-3 consumers explicitly reject its binding.

Verified behaviors:

- A corrupted sequence rolls back the complete SQL transaction/event/checkpoint batch.
- An actual fill while the SQL lease/pool is closed is recovered by finalized RPC history.
- A two-instruction withdrawal fails after emitting an inner event; fetched failure
  status excludes that event despite the known Surfpool log-WS status discrepancy.
- Original event identity/bytes deduplicate; conflicting payloads and journal mutation reject.
- A separate empty PostgreSQL database reconstructs the identical sequence, event
  digest and event-kind counts from refetched RPC transactions.
- Independent final account totals preserve zero aggregate lots/scaled claims and
  8,000,000 deposited atoms. Exact fees 26 split insurance 6 / protocol 20 / carry 2.

No production API/UI compatibility, worker recovery, throughput, endurance or external
review is claimed. Those remain separate owning-phase gates; P32's bounded comparative
continuation is still pending.
