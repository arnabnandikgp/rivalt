# Engineering reliability and operational readiness

P16A explains measured availability and verifies targeted engineering changes. D42 keeps continuous 24-hour qualification **Deferred** for much later. No replacement long soak is imposed. P15B/P16B remain separate external gates; this work does not authorize a funded pilot.

## What 71.19% actually measured

The preserved P12 run is `.local/load/20261023T062413Z-43283`, source `c8fd613` with the separately disclosed history-stage indexer pause. Its `attempts.jsonl` SHA-256 is `a601e3983c3a0386981bc3e0804e2179c90a2ead548e03a2c27d4db9e8b6d29b`. Reconstruct the populations without altering the source:

```sh
source ops/env.sh
pnpm report:availability .local/load/20261023T062413Z-43283/attempts.jsonl .local/new-availability-report.json
```

The input is retained local evidence, not a runtime dependency. New runs write the same attempt schema; the analyzer and bounded unit vectors work without historical files.

| Population | Actual offers | Returned eligible quotes | Signed submissions | Finalized fills | Unsigned refusals | Failed / unknown signed |
|---|---:|---:|---:|---:|---:|---:|
| All | 1,802 | 1,249 | 1,249 | 1,249 | 553 | 0 / 0 |
| Outside declared fault windows | 1,680 | 1,196 | 1,196 | 1,196 | 484 | 0 / 0 |
| Inside declared fault windows | 122 | 53 | 53 | 53 | 69 | 0 / 0 |

The historical “normal” label means **outside the driver's declared fault windows**. It does not establish that the oracle was in Normal mode for each offer. The configured minimum was 1,800 offers at one per second; the driver extended until both wall and monotonic clocks reached the required interval, recording 1,802 actual unique offers over 1,801.940 wall / 1,801.967 monotonic seconds. A scheduled offer is counted once when the driver records it, including account-busy/unavailable outcomes; missing schedules and repeated unsigned readiness polls are not silently invented as offers.

71.190476…% = **1,196 signed submissions / 1,680 actual offers outside fault windows**. In this particular run every returned quote was signed and every signed trade finalized, so quote availability and finalized-fill availability happen to have the same numerator. Submitted success is separately **1,196 / 1,196 = 100%**. Fault-window availability is 53/122; all-window availability is 1,249/1,802. These metrics are neither venue wall-clock uptime nor a guarantee that a future offered trade lands.

| Unsigned reason | Outside faults | Inside faults | Interpretation supported by recorded code |
|---|---:|---:|---|
| `observation-update-due` | 380 | 36 | Next scheduled sample is inside the configured one-second dispatch margin |
| `risk-increase-restricted` | 82 | 17 | Oracle mode forbids new risk; original refusals lack the mode/clock details needed to distinguish the underlying cause |
| `observation-not-confirmed` | 11 | 0 | Preview context is behind the observation's valid-from slot |
| `observation-update-pending` | 7 | 3 | Pending sample lacks sufficient exact confirmed-preview evidence |
| `quote-expiring` | 4 | 0 | Remaining expiry is at most ten processed slots |
| `source-unavailable` | 0 | 13 | No credible price bounds |
| Total | **484** | **69** | All recorded unavailable offers classified by their observed guard; deeper causes remain unknown where uncaptured |

The largest population, 380/1,680 outside-window offers, is deliberately rejected by a scheduling safeguard. Removing that guard or extending risk validity solely to improve this percentage would change protection, not prove reliability. The existing data does not establish a financial bug or justify a risk relaxation. Failed operator races elsewhere in the P12 journal remain separate from its zero failed submitted load trades.

## Actionable fixes and bounded verification

The old `normalEligible` statistic counted signed submissions, hiding eligible quotes that failed client validation or were deliberately left unsigned. It now counts actual `eligible` records; `normalSubmitted`, `normalQuoteAvailability` and `normalFinalizedAvailability` make each denominator explicit. The existing `normalAvailability` retains signed submissions/offers, and success retains finalized/submitted. The historical P12 values remain unchanged because its populations coincide. The analyzer rejects duplicate offers and impossible unsigned/signed outcome labels, preserves failed/unknown outcomes and reports null ratios for empty populations.

Quote refusals now include public read-only confirmed-preview diagnostics: slot, sequence, observation, source mode/status, chain/sample time and validity slots. The API preserves its existing reason code/message and the load recorder retains these diagnostics. No observation, authority, pending-proof, expiry, confidence, funding, margin or settlement check changes. Older missing diagnostics are not backfilled with guesses. Local operator checkouts and tool caches are explicitly excluded from Vitest discovery so retained files cannot inflate fresh test counts.

Run `pnpm test:readiness` after the explicit local artifact build. It creates fresh Surfpool/PostgreSQL state, records pinned revision/artifacts/toolchain, samples unsigned quote admission, stops controlled source publication until actual NoCredibleBounds refusal, and restores the unchanged qualification rules. It kills the actual indexer and executor, drops a real submission acknowledgement, blocks the original signature's RPC reads/rebroadcast for 15 seconds and verifies the exact same signed deposit lands once. It then proves direct complete-cohort withdrawal while the indexer is offline, backfills the original projection and compares a fresh RPC-derived PostgreSQL projection. Actual WS observations, fee/result identity, unknown-job count, elapsed time and measured resource scope are retained. These checks target diagnosis, recovery and exit; the quote samples are deliberately unsigned and are not trading throughput or a new availability benchmark.

The supervisor requires the existing local ports and at least enough free storage for a new database/log directory. It fails rather than taking another process's port and stops only owned services. Use the measured P12 storage figures below for longer-run sizing; a single free-space reading cannot prove capacity for an arbitrary duration. No automatic full-day run or scheduled automation exists.

## Incident and exit procedure

1. Record chain/genesis/market/domain, last finalized checkpoint, actual source mode and each original signed request/signature. Keep unknown signatures and fee reservations intact. Stop new risk or quote publication where the existing guard/authority permits; do not change risk thresholds to restore a green metric.
2. For RPC/acknowledgement/executor loss, restart the executor on the same database and run binding. Fetch the original signature and exact transaction; rebroadcast only its same persisted bytes while allowed. A successful outcome must appear once. Unknown is neither failed nor permission to re-sign.
3. For indexer loss, restore PostgreSQL and the original run binding, then finalized RPC backfill. Check failed transaction retention, contiguous critical events, participant/vault reconciliation and zero unexplained pending jobs. A separate empty projection rebuilt from RPC must agree; never copy the old projection as proof of replay.
4. For source loss, preserve publish times and restrictive actions, restore the actual source/funding service and wait for the unchanged recovery interval. Confirm direct RPC state and newly available quotes; process liveness alone does not prove price usability.
5. Stop maker discovery, resolve outstanding intents and use venue-authorized quarantine or actual epoch expiry to stop standing quotes. Close exposed positions only through admissible liquidity, settle eligible whole claims, retain unpaid fractions, obtain complete-cohort proofs and withdraw admissible cash through direct RPC/SDK. Proof and mutation are separate transactions. Source/solvency constraints can block exposed exits; follow complete-cohort resolution rather than force a withdrawal.

## Measured limits and provisional assumptions

The attributed P12 measurement remains the throughput/resource evidence: 33.658 ms quote p95, 34.991 ms validation p95, 1,767.926 ms observed finalized p95; largest immediate route 298,361 CU / 884 bytes / 18 accounts under a 400,000-CU budget. Fresh replay fetched 12,454 actual transactions in 65.787 seconds; the default 10,000-history ceiling deliberately failed without a checkpoint. These are one host/profile/run, not production guarantees.

P12 database storage grew 8.97→57.67 MB over its trading interval. Including history/rebuild, primary/replay databases were 161.11/151.84 MB and WAL 285.21 MB. Owned RSS measurements can overlap shared pages; PostgreSQL had a separate 512 MiB VM cap. P16A's bounded run reports its own end-state database/driver values, without relabeling P12 data as new evidence or claiming peak memory/leak freedom.

The selected local profile still uses one BTC market, test collateral, six participants in this fixture (capacity 64), at most two makers, four order slots, 400,000-CU routes, five-second sampling and one-second quote dispatch margin. The 20-second local source-age ceiling, six-second recovery, confidence/conversion/divergence checks and funding coverage remain unchanged; the previously authorized 30-second devnet ceiling is a separate test profile. Positive unpaid P&L receives zero margin credit. Internal collateral, curve depths/inventory limits, margins, reserve budgets, source/guard independence and hypothetical hedge costs remain provisional test assumptions, not calibrated funded-market settings.

P15A's actual maker cash/fees/funding evidence and P13/P14's bounded devnet/provider/wallet evidence retain their original scope. External maker economics, independent source/review assurance, funded risk calibration and pilot authorization remain P15B/P16B. Revisit the deferred endurance question only when that later work is scoped.
