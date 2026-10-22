# P11 integrated fault and reconciliation matrix

Implementation contract; [fresh A01–A16 acceptance](evidence/P11.md) passes on clean `8067159`. WORKLOG owns live status. This phase adds evidence orchestration and hosted fast checks, with no program, custody, economic or source-policy change.

## Run the explicit integration gate

After the pinned bootstrap, commit the coherent source, then run:

```sh
source ops/env.sh
RIVALT_SLOT_TIME=50 pnpm test:matrix
```

`pnpm smoke` invokes the same command. This is P11's broad gate, not a prerequisite for every PR. Ordinary changes use the affected test commands and their phase acceptance criteria under D32.

The command creates a unique `.local/matrix/<UTC-pid>/` root. Sequential stages are locked build/static/compiled checks, RPC/indexer/reset, service lifecycle, authenticated sources/funding, orders, liquidation/default and browser/direct recovery. Each service stage deploys real programs into fresh Surfpool, uses standard RPC/WS and a separate PostgreSQL 18.6 container/data volume. Unique directory basenames also become unique service run IDs. Existing output directories are rejected; no prior reports are silently reused as a fresh run.

`run.json` records source revision, host, elapsed wall time, commands/exits, per-stage logs/hashes, lock/IDL/config/fixture identities, all five local program binary hashes, deterministic key namespaces and the independent arithmetic seed. Local time is real; replay preserves fixture/fault definitions and assertions, not identical wall-clock timestamps or signatures. Slot cadence is explicitly 50 ms, ordinary funding discovery two seconds and the browser profile five seconds. Existing G08 source/recovery limits are unchanged.

`matrix.json` and `matrix.md` are updated as each stage finishes. A01–A15 map to required fresh artifacts; A16 requires all scenario observations, the fault catalog and six independent final-state reconciliations. A17–A21 remain not-run. Missing/dirty/stale reports, changed artifact hashes, inconsistent binaries and empty required observations cannot pass. A failed or interrupted stage retains its exit/log; subsequent stages remain not-run. The process group belongs only to that stage; cancellation and timeouts stop its children and let the existing supervisors clean up their own containers.

To reproduce just a failed environment on the same committed revision and already-built matching artifacts:

```sh
pnpm test:matrix --stage orders
```

The selected stage can exit zero while the consolidated result remains not-run; that is a targeted rerun, never A16 acceptance. The JSON keeps the selection and every skipped stage. A source fix requires its affected checks before final acceptance; older source-stamped compiled reports do not become current evidence merely because they were copied.

## Independent accounting and complete populations

The report checker uses Python integers, importing no production SDK/indexer/Rust arithmetic. It checks the actual cohort/count, stable participant IDs, nonnegative cash/pools, sum(C), C+P+I+T against allocated/actual vault, zero net q and gross exposure. Fully accrued aggregate claims are computed as `sum(vScaled + q * checkpointScaled) = P * 1e9`; the common mark and funding terms cancel only after zero net exposure is verified. Explicit unallocated surplus is named and reconciled, never silently absorbed.

The actual RPC harness separately verifies each chain account, database checkpoint and fresh replay. Browser evidence includes the full chain snapshot for field-by-field comparison. Funding/order/default reports now retain the actual registry members and public durable intent rows. P09's independently computed frozen payout and mixed-state reconstruction remain required in its live harness; ordinary final-state equations are not incorrectly applied to a partially applied frozen ledger.

Expected on-chain rejections, compiled-program cases, durable pending/unresolved/expired-unexecuted/failed/finalized intents, wallet receipts, unsigned preview rejection and every retained order state remain visible. Wire hashes identify immutable intent bytes without exporting private keys. Fault populations are not normal eligible execution denominators and do not establish P12's success-rate or latency targets.

Hash representation is report-specific: the inherited lifecycle report hashes the base64 wire text; the new public-intent exporter and browser receipts hash decoded serialized bytes. Both bind the saved transaction, but their hashes must not be compared across these representations. The matrix does not make that comparison.

The fault catalog covers lost acknowledgement and executor kill, maker/funding/source outage, competing settlement/order workers, actual expiry, hidden failed fees, SQL rollback, duplicate/reordered events, pruned/missing RPC metadata, WS disconnect, database restart/rebuild, actual chain reset, interrupted default, source emergency, browser reload and actual API-stopped exits. These are completed named assertions from the real harnesses, not inferred from test counts.

## Focused CI

`.github/workflows/pr-checks.yml` uses `pull_request`, read-only contents permission, no persisted checkout credentials, pinned official checkout/setup-node commits and free standard `ubuntu-24.04` runners for this public repository. Its scope selector compares the actual PR base SHA to checkout HEAD, so stacked changes are evaluated against their parent. It runs affected client/build/ABI tests, financial-core/reference tests, report tests and shell syntax checks. Workflow changes exercise those jobs; docs-only changes do not start this workflow. Node 24.22.0, pnpm 10.23.0 and host Rust 1.97.1 retain the project pins; Ubuntu's Python version is printed and report logic uses only its standard library.

This hosted workflow does not claim SBF deployment, Surfpool/Apple Containers, browser/provider or full-matrix acceptance. Program changes still require their affected compiled-program/RPC checks locally. The repository had zero self-hosted runners when inspected; no paid runner or external infrastructure is configured. Broad runtime CI can use the same matrix command once a supported runner is actually provisioned. A YAML file is not a successful CI run; actual job URLs/outcomes belong in the evidence record after publication.

Official references: [PR workflow triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request) and [runner selection](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job). GitHub API resolved checkout v7.0.1 to `3d3c42e5aac5ba805825da76410c181273ba90b1` and setup-node v7.1.0 to `949feb2413d6458794dcd2491c4babbbce0c15c1` on 23 October 2026.

## Evidence publication

Publish allowlisted reports, matrix/run manifests and selected logs only after checking for credentials. Keys, deployment buffers, database environment files and volumes stay local. Keep failures with their actual revision/status. The independent reference seed, deterministic fixture source hashes, exact commands and unique paths permit targeted reproduction. P12's offered-load sweep and real 24-hour soak, P13/P14's actual cluster/wallet parity and M6 external gates remain separate.
