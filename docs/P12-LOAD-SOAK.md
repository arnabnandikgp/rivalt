# P12 measured local resources

Implementation in progress. No A17 or 24-hour completion claim; WORKLOG owns live status.

## Focused load command

After the pinned programs are built, use a clean committed tree:

```sh
source ops/env.sh
pnpm test:load --sweep-seconds 60
```

This command provisions a fresh real clearing/maker A/maker B/oracle-fixture deployment, classic six-decimal collateral and PostgreSQL 18.6. Provisioning creates actual accounts, deposits and signed source updates; it does not run the unrelated inherited financial/browser matrix. Source/binary/lock identities and actual commands are recorded. An explicit `--development` permits dirty-source diagnosis, never acceptance evidence.

The initial sweep offers 1, 5 and 10 attempts/second over three funded trader owners and two shared maker participants. Round-robin attempts open one lot, or 100 every tenth offered attempt, then close the actual resulting exposure. Each owner has at most one unresolved signed action. Busy accounts, unavailable quotes, driver admission limits, failed and unresolved submissions remain in the offered population. The normal eligible submitted denominator includes every normally quoted/submitted attempt, including chain rejection. No automatic replacement signature follows an unknown outcome. Fault populations must be explicitly labeled separately.

Actual quote HTTP latency, signing, submission acknowledgement, first processed/confirmed/finalized polling observations, bytes/accounts/CU and actual fees are retained. Polling observations are latency upper bounds; synthetic signing is not human wallet delay. All metrics are local and cannot establish devnet/mainnet throughput. Quote latency includes unavailable responses, with complete per-attempt records for further grouping.

Each successful fill is independently fetched and decoded over RPC. Coherent chain snapshots pass a separate Python integer checker; final PostgreSQL history and a fresh projection rebuild must agree with actual accounts/vault. A deliberately too-small history bound must fail without advancing its checkpoint. Operator fee totals must equal actual SOL payer balance changes and journal fees, with no outstanding reservation silently released. Further long-history, resource and soak instrumentation remains to be implemented before A17.

## Explicit synthetic resource profile

`RIVALT_BUDGET_PROFILE=soak24` is an explicit loopback-only choice, shared by all services for a run. Operator roles each have a separate 500,000,000-lamport cap; each maker has 5,000,000. Payer/cap identity is immutable in PostgreSQL. The original smoke caps remain the default. Fixtures provision actual synthetic SOL up front; no automatic top-up, collateral deduction or new sponsorship is added. Source publication and deployment are separate fixture costs and must also be retained.

At the unchanged two-second sampler floor, 24 hours contains at most 43,200 ordinary samples, or 216,000,000 lamports at the observed 5,000 fee. The cap provides bounded headroom; actual runtime exhaustion still stops discovery. This initial load profile uses the already supported five-second sampler cadence. On-chain source qualification, holds, expiry and recovery are unchanged.

`RIVALT_HISTORY_LIMIT` selects a validated bounded recovery limit, default 10,000 and maximum 200,000 transactions. The load harness declares 200,000 with a 1,000-signature page size for its in-process rebuild. The ordinary CLI still uses its existing page size. Every missing/contradictory history item and final account mismatch still blocks checkpoint advancement. Raising the ceiling is not evidence that a large rebuild fits memory or succeeds; the real long run must demonstrate it.

## Remaining phase gate

Select a sustainable baseline from measured 1/5/10 sweeps, retain saturation/failure causes, verify quote p95 <=200 ms, normal eligible success >=99% and >=20% measured CU headroom for the declared worst cases. Record resource growth and reserve enough disk/memory before starting a real 86,400-second full-system soak with maker/worker/indexer outages, periodic and final reconciliation. Real elapsed runtime is required; no accelerated clock or scheduled automation substitutes. A target failure prevents phase closure until resolved. M5a remains In progress.

## First measurement and scoped correction

The clean `f2415ad` probe (`.local/load/20261022T225134Z-28214`) finishes all 1/5/10 sweeps and final reconciliation but exits 2. Baseline success is 40/43 (93.023%), below target, with quote p95 25.125 ms and maximum 298,176 CU. Stress populations remain fully recorded. No 24-hour run has started.

The first optimization targets measured scheduling delay: PostgreSQL delivers a run-scoped notification only after the immutable signed intent commits. The separate executor wakes promptly and keeps its existing 250 ms durable fallback scan. Notifications carry no financial authority; missed notifications or lost connections cannot replace signatures or release reservations. The API remains a persistence ingress. Safe quote reason codes distinguish source/finality/expiry/paused/account restrictions. Revalidation and new measurements remain pending.

Before measuring load, the same fresh environment now tests a real one-atom deposit committed while the executor/listener is stopped. Startup must discover it without the lost notification; the RPC proxy forwards its actual transaction, drops acknowledgement and kills the executor. A restart and duplicate request must reconcile the original signature and exactly one cash atom, while changed bytes under the same request ID reject. This targets the scheduling change directly without an unrelated inherited suite.

Targeted qualification may select `--rates 1 --sweep-seconds 300` after the required full sweep, avoiding repeated unchanged stress cases. Supported declared candidate rates are 0.25, 0.5, 1, 5 and 10; durations 10–3,600 seconds remain finite qualification, never a soak. Structured executor broadcast-attempt logs allow exact signed-ready→attempt timing; processed/confirmed observations remain separate polling bounds. The wake-up probe improved first-observed processing p95 to 127.013 ms but its 42/43 baseline success still fails 99%. Longer qualification is pending, and the prior failed samples remain part of the evidence.
