# Decisions and configuration gates
Rivalt · baseline R1 · 20 October 2026

The product choices below are selected for implementation. “Selected” is not “deployed” or “runtime validated.” Later changes append a dated supersession and update the relevant specification and acceptance test.

## Selected decisions

| ID | Decision | Reason / authority |
|---|---|---|
| D01 | Name: Rivalt | Explicit user selection on 20 October 2026; no domain/trademark clearance implied |
| D02 | Common clearing, isolated maker/trader margin | Cross-maker close without separate provider contracts; preserves explicit liability |
| D03 | One BTC market, six-decimal classic SPL test collateral | Bounded end-to-end prototype |
| D04 | Clearing plus two separate maker programs; route entry in clearing | Separates pricing authority from custody/risk without redundant programs |
| D05 | Off-chain allocation; up to two makers; immediate FOK | Bounded resource envelope and atomic user outcome |
| D06 | Persistent partial subfills; existing-position TP/SL only | Practical orders without entry-linked bracket/IOC expansion |
| D07 | Zero positive unpaid-P&L margin credit; explicit cash/claims | Prevent uncollected profit financing new risk |
| D08 | Independent index/risk valuation; actual-fill candles | Distinguish risk, execution and market-data roles |
| D09 | Common authenticated depth-qualified funding, zero new accrual in invalid gaps | Fungible positions, reproducible terms and explicit liveness limits |
| D10 | Full-cohort exceptional resolution; insurance then unpaid-profit impairment | Complete loss allocation; no arbitrary keeper subset |
| D11 | 2 bps taker, zero provider fee; no quote tariff, token or tiers | User-approved tariff and selected simple MVP economics |
| D12 | Participant PDAs plus shared market coordination | Partition state without pretending economic dependencies vanish |
| D13 | Rust/Anchor, modern generated TS SDK, isolated legacy conformance, Surfpool RPC E2E | Selected development architecture with explicit compatibility gate |
| D14 | Focused implementation kit; historical research stays here | Latest user instruction supersedes mandatory archive restoration |
| D15 | WORKLOG is the implementation roadmap and run history | One live status authority; 16 PR-sized phases under existing milestones |

## Clarifications finalized in this consolidation

These complete underspecified MVP mechanics; they are not presented as previously executed behavior.

| ID | Clarification | Owner |
|---|---|---|
| C01 | One cumulative ceil fee on executed notional per economic order; preserve prefix through replace, no per-leg rounding charge | PROTOCOL, P02/P08 |
| C02 | All initial trading fee cash goes to T; insurance separately seeded; no implicit reserve split or rebate | PRODUCT/PROTOCOL, P02 |
| C03 | Ordinary eligible gain settlement is first-admissible landed execution against available P, without a promised FIFO/pro-rata queue; default uses the separate full-cohort policy | PROTOCOL, P02/P09 |
| C04 | Reject deposits and new registration during frozen resolution; no separate post-freeze receipt/escrow system in MVP | PROTOCOL, P09 |
| C05 | Funding sampling supplies the complete configured two-maker set; unavailable required modules invalidate the observation, even if a remaining maker can still fill trades under the action policy | PROTOCOL, P07 |
| C06 | Default progress is staged, paginated and deterministic; real sub-atom rules are resolved in the financial precision gate before declaring that code complete | PROTOCOL, P02/P09 |
| C07 | No mandatory predecessor archive import. Reuse source already available if useful, otherwise implement against this contract with independent expected cases and fresh validation | AGENTS, P01/P02 |
| C08 | Replace the old web3.js/wallet-adapter 3.1.0 candidate with 3.1.1 for the first build | Release observed 20 October; patch released 19 October; actual build/parity required in P01 |

For C03, early settlement can change the unpaid cohort that bears a later default. No retrospective clawback of already paid gains is implemented. The UI and pilot risk disclosure must not hide this timing dependence.

## Phase-owned configuration gates

No generic “TBD” may escape into an executable phase. Missing a gate blocks that phase's closure, not unrelated earlier work. Synthetic values must be explicitly labeled and checked; production calibration remains M6.

| Gate | Value/decision to pin | Due phase | Required evidence |
|---|---|---|---|
| G01 | Rust/SBF/Agave toolchain, generator/importer, exact npm/crate pins and wallet/SDK graph | P01 | Clean locked build, signed RPC round trip, byte/flag/PDA/decode parity |
| G02 | Base lot, price tick, funding scale, signed bounds, overflow range and deterministic fractional/default allocation | P02 | Exact independent reference, boundary proofs/checks and golden cases; later sampler uses these units |
| G03 | Synthetic margin/cap/price-envelope/minimum-order parameters; fee/quantity/account encoding, PDA seeds and errors | P02 | Versioned test profile, consistent roundtrip/schema tests; no production claims |
| G04 | Maker curves, epoch reset/expiry rules, quote interface, account budgets, registry/control binding | P03 | A/B parity, isolation and cumulative-consumption tests |
| G05 | Route size/CU/message budgets and short-list allocation algorithm | P04 | One/two-maker cases and independent bounded-route optimum comparison |
| G06 | Critical event schema, RPC/WS/history semantics and exact SQL/job/checkpoint model | P01 foundations; complete P05 | Critical-event roundtrip then disconnect/backfill/rebuild tests |
| G07 | Fee-payer/keeper budgets and retry policy; explicitly funded test sponsorship only | P06 | Persistent transaction intent and no duplicate economic effects after ambiguity |
| G08 | Oracle sources/validity, mark bounds, trigger source, funding reference size/coverage/cap/coefficient, sample interval/hold validity/catch-up and recovery window | P07 | Authenticated sample verification, missing-input/gap/turnover tests; finite profile values |
| G09 | Order reserve envelope, expiry bounds, fee budget/replace policy and TP/SL slot encoding | P08 | Partial/cancel/replace/withdraw/generation race matrix |
| G10 | Liquidation bands/fees/receiver constraints, default thresholds, page budgets and recovery authority | P09 | Strict post-fee progress, complete-cohort deterministic payouts and restart |
| G11 | Cluster IDs, mint/authorities, real primary verification programs/feed IDs, declared guard trust and RPC configuration | P13 | Actual on-chain dependency checks; an operator-controlled guard is an explicitly limited engineering profile, never proof of independence |
| G12 | Independent live source/guard assurance, liquidity, risk limits, insurance budgets, operational costs, review findings and pilot limits | P15/P16 | Independent observations/review; unresolved guard independence blocks funded-pilot readiness; funded use needs separate authorization |

G02 is an implementation precision choice, not permission to change the cash/claims rules. Program addresses, keys and endpoints are deployment outputs; this documentation must not invent them.

## Change procedure

Routine ABI names, exact compatible patches, test-only risk settings and implementation details can be resolved by the agent within these gates. Record the result, rationale, evidence and effective version here; update affected specs/worklog in the same PR.

Changes to fee policy, custody authority, loss bearer, margin model, market scope, order promises or production/funded use need an explicit product decision. Do useful preparatory analysis first and ask only for that concrete decision. Do not silently promote illustrative research values into launch configuration.

## 20 October 2026 — P01 implementation amendments

- **D16 / G01:** Pin host Rust/Cargo 1.97.1, Anchor 1.2.1 (default solana-v3), Agave distribution 4.1.2 (bundled cargo-build-sbf 4.1.0), explicit SBF platform-tools v1.52/rustc 1.89.0-dev/SBPF v0, Surfpool 1.6.1, Node 24.22.0 and pnpm 10.23.0. Archive checksums are in `ops/toolchain-downloads.json`; complete JS pins and runtime distinctions are in [P01-SPINE](P01-SPINE.md). Closure remains subject to the committed clean acceptance run in WORKLOG.
- **Supersession:** Do not inherit Anchor 1.2.1's platform-tools v1.57 / SBPF v3 defaults. The v1.57 download hit ENOSPC on this host; existing v1.52 failed for v3 because that target is absent, then successfully compiled this program for v0. This is a recorded compatible build profile, not a change to protocol economics or a claim that the tool versions are interchangeable.
- **D17 / G06 foundation:** The sole initial instruction is an explicitly nonfinancial local probe. Use generated event codecs plus the Anchor event-CPI inner-instruction envelope, successful transaction metadata and run-scoped identity. Its local schema does not freeze future financial account/event layouts. G06's SQL and operational recovery contract remains due in P05.
- **Dependency isolation:** Production SDK/web3.js 3.1.1/Kit 8.5.0 and wallet-adapter 3.1.1 use their installed modern graph. Legacy Anchor 1.2.1/web3.js 1.99.0 lives in a separate pnpm root/lockfile and process; canonical bytes/address/integer strings alone cross the boundary. No forced overrides. Wallet provider import and dependency compatibility are P01 checks; user wallet behavior is P10.

