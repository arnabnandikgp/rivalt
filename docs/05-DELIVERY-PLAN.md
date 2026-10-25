# Delivery plan
Rivalt · baseline R1 · 20 October 2026

Six milestone families, with M5 explicitly split into local and devnet gates, retain **16 parent phase IDs**, with P15/P16 explicitly split into engineering A and external-validation B deliverables under D41. Each phase is a cohesive, independently reviewable PR-sized outcome; it depends on the preceding baseline rather than being a standalone application. A phase may take several work sessions. The live status is only in [WORKLOG](WORKLOG.md).

## Milestones

| Milestone | Phases | What it delivers | Exit gate |
|---|---|---|---|
| M1 | P01–P02 | Reproducible stack, economic core and custody | Locked signed RPC/SDK path plus independent exact accounting/custody evidence |
| M2 | P03–P04 | Competing makers and atomic execution | Separate A/B modules; valid split; complete rollback and measured resource fit |
| M3 | P05–P06 | Real services and full trade lifecycle | Indexed deposit→split→cross-maker close→funded settle→withdraw; durable retry/recovery |
| M4 | P07–P10 | Funding, orders, risk recovery and usable UI | Sources/funding, TP/SL, liquidation/default and browser/direct-exit gates |
| M5a | P11–P12 | Complete local engineering evidence | Whole fault matrix, measured load, bounded qualification and >10,000-transaction RPC replay (D35) |
| M5b | P13–P14 | Focused real-cluster parity | Actual dependency verification, wallet/core lifecycle and provider recovery |
| M6 | P15A/P16A + P15B/P16B | Standalone maker tooling/reliability, followed by independent commercial/pilot readiness | A: reproducible operator qualification and bounded, change-focused reliability/operations evidence. B: independent observations/review, calibrated funded risk and a separate pilot decision. All four must close for M6 closure |

M1–M5b are the engineering MVP. M5a completes the local end-to-end prototype. M6 engineering extensions P15A/P16A can proceed with explicitly internal makers and test assets. P15B/P16B require independent people/data/review and separate funded authorization. Completing A never closes B or establishes funded readiness.

## Phase sequence

| Phase | Milestone | PR-sized outcome | Dependency | Acceptance IDs |
|---|---|---|---|---|
| P01 | M1 | Toolchain, SDK and RPC spine | None | A01 |
| P02 | M1 | Financial core and custody | P01 | A02 |
| P03 | M2 | Maker programs and capital authorization | P02 | A03 |
| P04 | M2 | Atomic routes and allocation | P03 | A04, A05 |
| P05 | M3 | Indexer, database and read API | P04 | A06 |
| P06 | M3 | Maker daemons and complete service lifecycle | P05 | A07, A08, A05 |
| P07 | M4 | Oracle policy and authenticated funding | P06 | A09, A10 |
| P08 | M4 | Persistent orders and TP/SL | P07 | A11, A12 |
| P09 | M4 | Liquidation and resumable default | P08 | A13, A14 |
| P10 | M4 | Trading UI and direct exit experience | P09 | A15 |
| P11 | M5a | Integrated fault and reconciliation matrix | P10 | A16 and regression A01–A15 |
| P12 | M5a | Resource budgets, load and bounded qualification | P11 | A17 plus affected invariants |
| P13 | M5b | Devnet deployment and real dependency verification | P12 | A18 |
| P14 | M5b | Devnet lifecycle, wallet and provider recovery | P13 | A19 |
| P15A | M6 | Maker integration kit and economics tooling | P14 | A20A |
| P16A | M6 | Engineering reliability and operational readiness | P15A verified baseline | A21A |
| P15B | M6 | Independent maker validation | P15A + actual independent participation | A20B (original A20) |
| P16B | M6 | Independent review and funded-pilot readiness | P16A + P15B + real review/authorization inputs | A21B (original A21 external gate) |

The engineering path is P01–P14 → P15A → P16A. External P15B/P16B do not block the authorized A work; their own prerequisites remain mandatory. Do not reopen architecture research or ask to start every phase. A concrete access/credential/external decision may block dependent work; record it and continue genuinely independent authorized work where useful. No fabricated substitute closes a gate.

Workflow amendment, 20 October 2026: submit ready-to-review PRs using `gh stack submit --auto --open`. Once a phase's deliverable and acceptance checks pass, continue its dependent phase on top of those exact commits without waiting for merge. `gh stack` manages the chain and PR bases. An unmerged phase remains Review; this removes a development scheduling barrier, not the integration requirement for Closed. D41 originally required keeping the new PRs stacked and open; D44 records the user's subsequent explicit authorization to address reviews and merge PRs #20/#21. WORKLOG records verified integration.

## PR contract

A phase PR explains the concrete problem, new behavior, relevant decision/config gates, meaningful executed tests, evidence, operational impact and remaining limitations. Include code, affected specs and WORKLOG together. No “tests pass” without the actual command/result/revision. No assertion that all research is reproduced when only new cases ran.

Keep phases cohesive. Do not create a separate PR for every account field or test. If a phase grows beyond reviewable size, justify a small split in WORKLOG and preserve its parent acceptance gate. For local-only repositories, a reviewable commit set and verified baseline integration can fulfill the same unit; do not block ordinary development just to fabricate a hosted PR URL.

A milestone closes only when every child phase closes and the milestone exit gate passes. The initial status is Open for all implementation phases. Documentation consolidation is recorded separately as R000.

## P01 — Toolchain, SDK and RPC spine

Milestone: **M1**. Depends on: **None**.

**Deliverable:** Pinned workspace; minimal Anchor instruction; generated SDK and isolated conformance client; signed Surfpool round trip.

**PR scope:** Inspect existing code and environment; establish Rust/Anchor and pnpm workspaces; generate and compare a minimal IDL client; start Surfpool and probe submission/state/event/history/WS surfaces. Record exact dependency and host/SBF pins. Reuse available source selectively; do not require research archives.

**Configuration closure:** G01; G06 foundations.

**Acceptance:** A01 passes: clean locked build; actual signed transaction independently fetched and decoded; canonical instruction/PDA/flags/value parity; no legacy objects in the production dependency graph. Record unsupported RPC behavior concretely.

**Runnable demonstration:** One documented smoke command builds/deploys the minimal program, sends a signed instruction and reads the resulting account/event via standard RPC.

**Expected artifacts:** Workspace, lockfiles, minimal program/SDK, tests/anchor-conformance, tests/rpc-contract and ops bootstrap.

## P02 — Financial core and custody

Milestone: **M1**. Depends on: **P01**.

**Deliverable:** Exact financial model, checked core, participant/vault state, deposit/withdraw and ledger transition primitives.

**PR scope:** Freeze units/scales/bounds, initial synthetic risk profile, account/event/error contracts and role authority. Implement financial transitions, cumulative fees, reservations primitives and deterministic fractional accounting. Implement actual SPL custody and guarded participant registration. Establish independent golden/reference assertions including default-allocation math. Later execution/risk instruction families stay disabled until implemented.

**Configuration closure:** G02, G03.

**Acceptance:** A02 passes: V01–V05 expectations represented at the relevant model level; exact cash/exposure/claims; meaningful overflow/fraction tests; authorized deposit/withdraw and wrong-owner/mint/alias rejection on built programs. Pure default math is tested here, paginated operational default remains P09.

**Runnable demonstration:** Deposit test tokens, read funded balance, reject an inadmissible transfer, and withdraw an admissible amount through SDK/RPC; run independent economic transition checks.

**Expected artifacts:** crates/financial-core; clearing custody/accounts; financial/SVM tests; versioned local profile and schema docs.

## P03 — Maker programs and capital authorization

Milestone: **M2**. Depends on: **P02**.

**Deliverable:** A/B pricing programs, registry/capital binding, cumulative curve interface and quote parity.

**PR scope:** Deploy A and B separately with different shallow/deep strategies; register funded maker capital and config/authority epochs; implement bounded quote CPI and equivalent off-chain evaluation. Specify updates/expiry/consumption/reset policy and upgrade/quarantine controls. No private RFQ path.

**Configuration closure:** G04.

**Acceptance:** A03 passes for both sides, size boundaries, inventory skew and capacity. Wrong capital, module, epoch, alias or response producer is rejected. Pricing has no vault or arbitrary clearing write authority.

**Runnable demonstration:** Show A winning a small order and B a larger order from one labeled snapshot, with exact off-chain/on-chain quote parity.

**Expected artifacts:** programs/maker-a, programs/maker-b, crates/maker-interface, reference quoting library and qualification fixtures.

## P04 — Atomic routes and allocation

Milestone: **M2**. Depends on: **P03**.

**Deliverable:** One/two-maker FOK execution and bounded off-chain routing.

**PR scope:** Integrate maker CPI into clearing, signed limits/nonces/fee bounds, paired deltas and post-health/capacity checks. Implement one/two-maker route selection with an independent bounded comparator. Add hostile test module and full rollback evidence; measure compiled transaction cost.

**Configuration closure:** G05.

**Acceptance:** A04/A05 pass: split required by size, split beneficial by price, same-maker aliases rejected, changed capacity/epochs revalidated, second-leg failure leaves no venue residue, cumulative curve and fee rules preserved. Actual message/account/CU budgets recorded.

**Runnable demonstration:** Execute a size neither maker can fill alone; force the second maker to fail and show identical pre/post venue state.

**Expected artifacts:** Clearing route entry points; services/quote-router core; signed SDK route builders; split and malicious-CPI tests.

## P05 — Indexer, database and read API

Milestone: **M3**. Depends on: **P04**.

**Deliverable:** Actual RPC/WS ingestion, durable PostgreSQL projections/checkpoints and read endpoints.

**PR scope:** Freeze events/endpoints; decode critical events/inner instructions; implement subscription buffering, history pagination, commitment reconciliation, uniqueness and atomic projection/checkpoint writes. Expose balances/orders/market/trade reads. Use actual chain transactions as inputs.

**Configuration closure:** G06 complete.

**Acceptance:** A06 passes: duplicate/reordered/failed logs do not create duplicate balances; disconnect/backfill and fresh database rebuild reconcile to chain/vault; missing history is explicit. A new Surfpool run cannot inherit incompatible database state.

**Runnable demonstration:** Stop the indexer while real local transactions execute, restart it and compare recovered API balances with chain state.

**Expected artifacts:** packages/indexer (separately runnable workspace service), PostgreSQL migration, read API and RPC history/recovery evidence. Exact P05 contract: [INDEXER](P05-INDEXER.md).

## P06 — Maker daemons and complete service lifecycle

Milestone: **M3**. Depends on: **P05**.

**Deliverable:** Two maker daemons, quote/submission API, executor and settlement worker through a full trade loop.

**PR scope:** Run distinct maker keys/processes; wire actual quoting/execution and transaction persistence/reconciliation. Add loss collection/gain settlement scheduling under existing rules. Pin fee payer and funded operator budgets. Provide a CLI or thin wallet harness; full trading UI is P10.

**Configuration closure:** G07.

**Acceptance:** A07/A08 and relevant A05 pass through production SDK/services/RPC/PostgreSQL: deposit, split trade, cross-maker close, funded settlement and withdraw. Ambiguous acknowledgement, expiry and worker restart do not duplicate economic effects. Maker outage/return is visible.

**Runnable demonstration:** `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` rebuilds/regresses the baseline and runs separate service processes through the independently reconciled lifecycle. [LIFECYCLE](P06-LIFECYCLE.md) specifies guarded ordinary exits, role configuration and G07.

**Expected artifacts:** Maker daemon launcher/configs; executor/quote API; settlement scheduler; full-service smoke scenarios.

## P07 — Oracle policy and authenticated funding

Milestone: **M4**. Depends on: **P06**.

**Deliverable:** Source validation/action modes and common on-chain validated funding integration.

**PR scope:** Replace ad hoc local price controls with explicit source profiles and finite mode parameters. Implement complete-maker impact sampling, causal time accounting, skipped gaps and participant fractions. Worker posts/schedules data; clearing validates it. Use controlled local dependencies here; actual devnet verification is P13.

**Configuration closure:** G08.

**Acceptance:** A09/A10 pass: malformed/wrong/stale/future/divergent/collateral-shock data; incomplete maker set; cap/time/gap behavior; turnover and same-account close/reopen fractions. Funding failure cannot disable otherwise permitted cancellation.

**Runnable demonstration:** Run valid funding, remove required input, observe zero new invalid-interval accrual/restrictive mode, then recover under the recorded policy.

**Expected artifacts:** Oracle adapters/policy, observation/funding state, worker role, fault scenarios and funding precision report. The finite local contract is [ORACLE-AND-FUNDING](P07-ORACLE-AND-FUNDING.md); its acceptance status remains in WORKLOG.

## P08 — Persistent orders and TP/SL

Milestone: **M4**. Depends on: **P07**.

**Deliverable:** On-chain order slots, reservations, cancel/replace, stop-limit and existing-position TP/SL.

**PR scope:** Implement keeper discovery/execution against stored authority; persistent partial atomic subfills; cumulative quantity/notional/fee and reserve recomputation. Add two-slot shared protective group and checked position generation. Use the selected current trigger observation. No entry-linked brackets/general IOC.

**Configuration closure:** G09.

**Acceptance:** A11/A12 pass in both race orderings: partial fill then cancel, old cancel versus replace, duplicate keepers, withdraw versus fill, TP versus SL and position close/reopen. No overfill, reversed exposure, resurrected intent or fee-prefix reset.

**Runnable demonstration:** Place a TP/SL pair, partially fill TP, show clipped SL allowance, then close/reopen and reject the old SL.

**Expected artifacts:** Order instructions/SDK, reservation logic, order keeper and race/E2E cases.

## P09 — Liquidation and resumable default

Milestone: **M4**. Depends on: **P08**.

**Deliverable:** Funded receiver liquidations and complete-cohort paginated resolution/recovery.

**PR scope:** Integrate deficit-progress/fee policy, receiver capital, detection and safe escalation. Freeze membership/funding/claims; implement credible valuation, collection, insurance, deterministic impairment/rounding and settlement stages with restartable progress. Disable new deposits/registration during freeze. Add operational recovery controls.

**Configuration closure:** G10.

**Acceptance:** A13/A14 pass: receiver limits, non-improving liquidation rejection, no invented valuation, duplicate/foreign/omitted pages rejected, concurrent progress once-only, full cohort before finalize, identical payout across legal page sizes/restarts. Final exact cash/claims reconcile.

**Runnable demonstration:** Drive the V03-style bankruptcy, stop between resolution pages, restart and complete the same final payout with a recorded epoch change.

**Expected artifacts:** Risk worker, liquidation/default instructions, resolution progress API and operational recovery tests.

## P10 — Trading UI and direct exit experience

Milestone: **M4**. Depends on: **P09**.

**Deliverable:** Practical React/Vite wallet UI, actual-fill chart, order/cash views and operations states.

**PR scope:** Wire real SDK/API state for deposit/trade/orders/position/settlement/withdrawal, labeled index/risk/last-trade data and per-leg results. Show cash versus unpaid claims and pending/confirmed/finalized status. Implement operations health/default views and direct SDK examples.

**Configuration closure:** No additional configuration gate; all applicable G08–G10 must already close.

**Acceptance:** A15 and essential browser paths across A07/A11/A12 pass: wallet reject/switch/wrong cluster, stale quote, unpaid profit and API outage. Direct admissible withdrawal/cancel works without the venue API.

**Runnable demonstration:** A browser lifecycle plus an API-stopped direct SDK exit, with matching chain and UI evidence.

**Expected artifacts:** apps/trader, browser tests, charts from actual fills and direct-user recovery guide.

## P11 — Integrated fault and reconciliation matrix

Milestone: **M5a**. Depends on: **P10**.

**Deliverable:** Reproducible whole-system acceptance harness and consolidated evidence report.

**PR scope:** Run A02–A16 through actual deployed local programs/services, not only unit substitutes. Include competing workers, maker outage, RPC/indexer disconnect, ambiguous retries, database rebuild and default restarts. Fix concrete integration defects within this phase and retain seeds/config identity.

**Configuration closure:** All local feature gates G01–G10 resolved.

**Acceptance:** A16 passes with no unexplained drift; each required scenario reports pass/fail/not-run on the actual integrated revision. Finalized chain, database/API and vault reconcile; rejected/unfilled/pending cases remain visible.

**Runnable demonstration:** One matrix command produces a scenario-by-scenario report and rerunnable failure seeds.

**Expected artifacts:** tests/e2e orchestration, fault profiles and docs/evidence integrated acceptance report.

## P12 — Resource budgets, load and bounded qualification

Milestone: **M5a**. Depends on: **P11**.

**Deliverable:** Measured local performance envelope and sustained recovery evidence.

**PR scope:** Measure bytes/accounts/CU and account contention; start offered-load sweeps at 1/5/10 attempts per second with declared account mix. Under D35, retain the interrupted endurance evidence, address availability/recovery/resource findings, run a real 1,800-second Surfpool full-system qualification with affected outages, and separately prove >10,000-transaction RPC reconstruction into fresh PostgreSQL. Optimize only measured bottlenecks; rerun affected gates after fixes.

**Configuration closure:** Recorded host/profile/load/resource budgets.

**Acceptance:** A17 reports actual elapsed run and complete metrics; target quote p95 <=200 ms, normal eligible success >=99% and >=20% CU headroom for declared worst cases, or explicit unresolved failure that prevents closure. D35 additionally requires >=50% normal offered availability, actual final withdrawal/reconciliation and >10,000 fetched history transactions. Preserve the prior six-fault evidence and repeat affected funding/executor-RPC/indexer recoveries. D42 keeps continuous 24-hour endurance Deferred for separately scoped future work, outside current P16A acceptance; this bounded gate does not satisfy endurance.

**Runnable demonstration:** Reproducible report covering latency distributions, success/failure causes, load saturation, outages and final balances.

**Expected artifacts:** Load/soak commands, measured budgets, logs/summary pointers and local-MVP completion report.

## P13 — Devnet deployment and real dependency verification

Milestone: **M5b**. Depends on: **P12**.

**Deliverable:** Separate test-cluster deployment, real oracle update verification and collateral/authority preflight.

**PR scope:** Obtain secure RPC access when needed. Under D36 use sponsored Pyth Core on-chain accounts without a paid API or custom pusher. Pin genesis/features, program/IDL hashes, test mint authorities and live feed/verifier identities. Independently fetch/decode actual sponsored signed-update verification transactions and consume their authenticated state; do not inject verified-looking bytes. Document independent-guard provenance or the remaining limitation. Preserve source-age/funding restrictions and report observed sponsored-feed availability.

**Configuration closure:** G11.

**Acceptance:** A18 passes for the declared profile, including the real primary update-verification path. Fixture-only primary verification cannot close this phase. An explicitly operator-controlled guard may support this limited engineering profile; record that limitation and carry independent-source assurance into G12 before funded-pilot readiness. Do not claim independent oracle security.

**Runnable demonstration:** Live test-cluster verified source update followed by accepted/rejected protocol actions and readable deployment evidence.

**Expected artifacts:** Devnet manifest/preflight/deployment scripts, verification tests and dependency provenance report.

D37 makes this a bounded dependency/action check. Intermittent sponsored updates and a missed live log remain reported limitations; finalized original-signature RPC/WS recovery may resolve the latter. Do not repeat source waits to imply continuous availability or hide the original failed harness report. [Actual P13 evidence](evidence/P13.md) records the scoped assessment.

## P14 — Devnet lifecycle, wallet and provider recovery

Milestone: **M5b**. Depends on: **P13**.

**Deliverable:** Focused actual-cluster end-to-end parity and engineering MVP report.

**PR scope:** Run core lifecycle and selected orders/funding/recovery on test assets with real wallet signing and provider RPC/WS. Exercise confirmation/expiry/rate-limit/backfill semantics. Separate local and devnet metrics; no mainnet throughput extrapolation.

**Configuration closure:** All engineering gates G01–G11 complete.

**Acceptance:** A19 passes, discrepancies against local behavior resolved or explicitly retained as blockers; actual test funds and dependency identity recorded. M5b exit report distinguishes prototype readiness from funded-pilot readiness.

**Runnable demonstration:** One actual-cluster lifecycle with wallet signing and a provider disconnect/recovery report.

**Expected artifacts:** Focused devnet suite, actual wallet smoke evidence and engineering-MVP completion report.

Under D37, run one bounded lifecycle/recovery demonstration, without a load/endurance or continuous free-feed availability target. The approved devnet-only 30-second source-age setting needs explicit configuration/boundary evidence if enabled; P13's existing deployment and accepted trade use 20 seconds. Other recovery/funding/risk constraints are unchanged.

## P15A — Maker integration kit and economics tooling

Milestone: **M6 engineering extension**. Depends on: **P14**.

**Deliverable:** A self-contained operator kit around the actual reference maker bot and SDK, reproducible qualification and explicit economics reports.

**PR scope:** Package runnable reference-bot configuration and SDK examples for permissions, participant/capital setup, funding, quote/epoch management, reconciliation, stop-quoting and admissible exit. Document current program/authority limitations; do not invent permissionless module admission, key rotation or deregistration. Provide a fresh-environment path with exact tool/dependency pins and explicit deployment configuration, independent of retained acceptance dumps or private development keys. Use actual Surfpool RPC/WS and PostgreSQL for integrated qualification.

**Configuration closure:** Operator/configuration/schema/units/fee-budget/qualification profile are explicit P15A deliverables. G12's independent maker/source and funded-risk decisions remain P15B/P16B.

**Acceptance — A20A:** A fresh operator environment runs documented setup → quote/publication → actual fills → inventory/funding reconciliation → funded settlement/admissible exit. Record instructions and exact executable commands, tested revision, artifact identities and actual pass/fail outcomes. Economics tooling reports fills/notional, inventory, funding, funded cash/P&L versus unpaid claims, network costs and funding injections separately. Hedge cost is either observed with provenance or an explicitly labelled assumption; internal makers, synthetic prices and simulated hedges never count as independent/observed evidence. Meaningful independent vectors reject duplicate/dropped effects, wrong costs and cash/unpaid conflation.

**Expected artifacts:** Operator guide/config examples, executable SDK examples, reference-bot entrypoint, fresh-environment qualification harness and independently checked economics report. Publish one cohesive ready PR; D44 authorizes integration after review remediation and verification.

## P16A — Engineering reliability and operational readiness

Milestone: **M6 engineering extension**. Depends on: **P15A's exact verified baseline**, including an open Review PR.

**Deliverable:** Explained availability, actionable reliability improvements and bounded operational checks with measured technical limits. D42 keeps continuous 24-hour qualification deferred for later; it is not a current P16A gate.

**PR scope:** Reconstruct the reported 71.19% offered availability from its actual retained P12 population. Define offered/scheduled/eligible/submitted/finalized denominators and fault exclusions; classify each unavailable/rejected/failed/unknown case, retaining unknown causes when evidence cannot establish them. Improve actionable service/scheduling/resource defects without weakening source freshness, confidence, recovery, authority, solvency, margin or replay safeguards to raise metrics. Pin the revision, program/artifact/config identities and relevant account/resource/fee profiles for each actual check. Select duration and workload to exercise a concrete changed behavior; no replacement long soak is introduced automatically.

**Configuration closure:** Explicit bounded-check profiles, relevant host/storage preflight, incident/recovery/reconciliation/exit criteria, measured technical limits and provisional risk assumptions. No production calibration or G12 closure follows.

**Acceptance — A21A:** Explain the actual P12 availability population and classifications, then verify actionable fixes with targeted tests and bounded real Surfpool RPC/WS/PostgreSQL checks. Include affected incident/recovery paths, durable original-signature reconciliation and an actual admissible exit when the changed behavior can affect them. Report measured durations, successful/rejected/unknown populations, resource/latency limits and provisional risk assumptions. Unexplained accounting/authority faults or unresolved signed outcomes cannot be waived. Preserve risk/oracle admission safeguards and clearly label synthetic/internal inputs. Unchanged inherited checks retain their recorded evidence. Continuous 24-hour qualification stays Deferred under D42; neither the earlier 2h44m interruption nor bounded checks are a full-day pass.

**Expected artifacts:** Availability diagnosis, focused fixes/tests and bounded verification report, incident/recovery/exit runbooks, measured technical/provisional-risk limits and an explicit deferred-endurance item. Move to Review only after scoped engineering acceptance passes; D44 authorizes integration after review remediation and verification. P16A completion does not claim long-duration endurance or close P15B/P16B.

## P15B — Independent maker validation

Milestone: **M6 external gate**. Depends on: **P15A + genuine independent operator participation**.

**Deliverable:** Actual independent qualification and observed maker-economics records with provenance.

**Acceptance — A20B (original A20):** Qualify a genuinely independently operated maker and evaluate observed quotes/fills/inventory/capital/funding/costs. Label missing hedge observations; internal operators, paper hedges and P15A's synthetic data do not satisfy this gate. Independent participation is the first external portion of G12. Outreach, recruiting, paid services and external hedging still require their own authorization. Keep Open until separately undertaken; only mark Blocked after a concrete access attempt is blocked.

## P16B — Independent review and funded-pilot readiness

Milestone: **M6 external gate**. Depends on: **P16A + P15B + actual independent review/risk inputs**.

**Deliverable:** Independent review/remediation, calibrated funded-risk/insurance/cost assumptions and an explicit bounded pilot go/no-go package.

**Acceptance — A21B:** Real independent review and source/guard assurance, measured external liquidity/capital inputs, resolved material findings, calibrated caps/margin/liquidation/reserve budgets and actual pilot authorization determine readiness. Reuse P16A's attributed bounded reliability/incident evidence when applicable; revisit deferred endurance separately before any funded-readiness claim; A completion cannot fabricate external review or funded calibration. G12 closes here only when its independent conditions are met. A recorded No-go does not mean funded deployment is ready or approved. No funded deployment is authorized by completing either A phase.

## Required closeout record

For each completed phase record: integrated commit/revision, actual PR if any, config/IDL/program identity where relevant, commands and pass/fail/not-run outcomes, evidence paths, gate resolutions and one next task. Use the template in WORKLOG. Keep live status there; this file remains the scope/acceptance authority.

