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

- **D16 / G01:** Pin host Rust/Cargo 1.97.1, Anchor 1.2.1 (default solana-v3), Agave distribution 4.1.2 (bundled cargo-build-sbf 4.1.0), explicit SBF platform-tools v1.52/rustc 1.89.0-dev/SBPF v0, Surfpool 1.6.1, Node 24.22.0 and pnpm 10.23.0. Archive checksums are in `ops/toolchain-downloads.json`; complete JS pins and runtime distinctions are in [P01-SPINE](P01-SPINE.md). [Clean acceptance evidence](evidence/P01.md) satisfies this gate on `9170a38`; phase closure still requires integration as recorded in WORKLOG.
- **Supersession:** Do not inherit Anchor 1.2.1's platform-tools v1.57 / SBPF v3 defaults. The v1.57 download hit ENOSPC on this host; existing v1.52 failed for v3 because that target is absent, then successfully compiled this program for v0. This is a recorded compatible build profile, not a change to protocol economics or a claim that the tool versions are interchangeable.
- **D17 / G06 foundation:** The sole initial instruction is an explicitly nonfinancial local probe. Use generated event codecs plus the Anchor event-CPI inner-instruction envelope, successful transaction metadata and run-scoped identity. Its local schema does not freeze future financial account/event layouts. G06's SQL and operational recovery contract remains due in P05.
- **Dependency isolation:** Production SDK/web3.js 3.1.1/Kit 8.5.0 and wallet-adapter 3.1.1 use their installed modern graph. Legacy Anchor 1.2.1/web3.js 1.99.0 lives in a separate pnpm root/lockfile and process; canonical bytes/address/integer strings alone cross the boundary. No forced overrides. Wallet provider import and dependency compatibility are P01 checks; user wallet behavior is P10.

## 20 October 2026 — user-directed stacked review workflow

- **D18:** Supersede the draft-PR and wait-for-merge workflow. All new phase PRs are ready for review. Use the installed `github/gh-stack` extension to adopt/create branches, publish with `gh stack submit --auto --open`, and maintain parent/base relationships. P01 PR #1 was converted to ready for review.
- A verified predecessor in Review may be the implementation baseline for its dependent phase, provided the child includes those exact commits and records the dependency. Keep implementing after each verified phase without waiting for merges. Phase/milestone Closed status still requires integration and the applicable acceptance/exit gates; external M6 gates and funded-use authorization are unchanged.

## 20 October 2026 — P02 precision and custody

- **D19 / G02:** Adopt [profile 1](../scenarios/local-profile-v1.json) and the bounded integer implementation in financial-core: 100-satoshi lots, one-atom-per-lot price ticks, 10^9 scaled units per quote atom, signed i128 virtual quote/funding, checked ranges and exact participant accrual. Use exact overflow-safe proportional division. For complete-cohort default, allocate insurance and impairment in scaled units; only whole insurance cash moves; residual fractional debt enters impairment. Final cash uses largest remainders with stable-ID ties and explicit zero-sum terminal entitlement adjustments, each below one atom. This resolves C06's fractional extension; it does not enable ordinary upward-rounded settlement or operational default. Rationale, bounds and independent reference are in [P02 contract](P02-ACCOUNTING-AND-CUSTODY.md).
- **D20 / G03:** Adopt the versioned synthetic IM/MM (10%/5%), quantity/cash/price/admission limits and schema 1 in that contract. The real on-chain profile is custody-only, initialized by the deployed program's verified upgrade authority. Bind classic SPL mint/vault/owner and reject role aliases. Keep 64 stable participants in a bounded vector after an actual fixed-array SBF stack failure; four empty order-ID slots reserve future order authority without inventing it. Classify unsolicited surplus explicitly to insurance under market authority, never to selected participant cash; deficits reject.
- **Scope of these decisions:** Numeric limits are engineering fixtures, not M6 calibration. G08 source/funding policy, G09 order reservation policy, G10 operational default and G11 deployment identity checks remain due in their owning phases. No funded deployment is authorized by these decisions.
- **Evidence:** [Clean committed P02 acceptance](evidence/P02.md) verifies G02/G03 on `3d9c8c3`; phase/milestone integration status remains in WORKLOG.


## 21 October 2026 — review-driven acceptance amendment

- **D21 / G01 verification:** Deterministic generation alone is insufficient after a build overwrites generated files. Acceptance also compares the regenerated SDK/IDL against Git HEAD and rejects staged, unstaged and untracked output changes. Surfpool readiness fails explicitly after bounded HTTP attempts or early process exit. The SBF stack guard uses system grep and treats checker errors as rejection. This strengthens D16/D17 verification without changing pins or protocol behavior; [fresh review evidence](evidence/R004-REVIEW.md) records both passing paths and failure checks.

## 21 October 2026 — P03 maker qualification

- **D22 / G04:** Select the exact A/B curves, integral marginal-lot rounding, synthetic capacity bounds, 64–3,600-slot lifetime, expired-only epoch publication and permissionless checked sync in [MAKER-CONTRACT](P03-MAKER-CONTRACT.md). Only expired new epochs reset side consumption. Registration binds one owner-funded participant to one of two fixed modules; an additional capital PDA prevents alias reuse. Module/config identities and whole ProgramData SHA-256 are checked before clearing quotes; hash changes reject pending joint market/capital-owner approval. Quarantine never removes liability membership.
- **Phase boundary:** Preview is read-only, uses an explicitly indicative reference, and exposes no financial execution. Actual maker CPI gets only one read-only config. P04 must integrate consumption, risk and paired transitions atomically; G08's authenticated source policy is unchanged. A03 verification is recorded in WORKLOG, not inferred from this configuration choice.
- **G04 evidence:** [P03 acceptance](evidence/P03.md) passes on clean `e05a20e`; exact ABI, funded-capital isolation, expiry/reset controls, actual upgrade rejection/reapproval and measured one-config CPI budgets are verified. P03 remains Review until integration; G05 and M2's cross-phase exit remain P04.

## 21 October 2026 — P04 route and test-risk configuration

- **D23 / G05:** Pin the immediate 4,608-lot / two-distinct-maker / 150-slot envelope, one aggregate fee, 400,000-CU submitted budget with ≥20% measured headroom, 1,232-byte / 20-account envelope and exact ≤513-split bigint allocator in [ATOMIC-ROUTES](P04-ATOMIC-ROUTES.md). Current adverse post-fee health, exposure caps and consumption are authoritative; optional reduce-only generation is checked on chain. ABI and runtime acceptance must verify these bounds before G05 is considered satisfied.
- **D24 / staged risk authority:** Supersede P02/P03's custody-only execution boundary only in the explicit local-test-profile build. Default SBF rejects test-route activation/execution. The synthetic observation authority, 10,000–100,000 reference range, ±1% risk interval, ±10% execution VWAP band and 64–3,600-slot validity are finite local fixtures, not authenticated sources or M6 calibration. P07 still owns G08 and P13 real dependency checks. Trading-mode withdrawals remain disabled pending guarded settlement/exit implementation; exposed deposits, maker approval and expiry sync remain available under the implemented checks. No fee, custody, loss-bearer or production authorization changes.

- **G05 evidence:** [P04 clean acceptance](evidence/P04.md) passes on `b8e5fb8`: exact independent allocation, actual one/two-maker RPC fills, full hostile/transaction rollback and ≤255,777 CU / 972 bytes / 19 accounts for successful routes. G05 and M2's engineering cross-phase check are verified; integration status remains in WORKLOG.

## 21 October 2026 — P05 canonical read model

- **D25 / G06:** Complete D17's foundation with the version-1 custody/maker/test-risk/aggregate-route event-CPI schemas, finalized-only projection, explicit initialization-transaction run binding and PostgreSQL 18.6 transaction/uniqueness/append-only rules in [INDEXER](P05-INDEXER.md). Confirmed WS data is an observed hint, never balance authority. Unknown schemas, missing history/metadata and incompatible runs fail closed; unresolved statuses never authorize economic retries. One route produces one aggregate fill/candle contribution. No on-chain ABI or economics changes.
- **Storage/runtime:** Pin Fastify 5.12.7 and pg/@types/pg 8.23.1; use the existing Apple container runtime with the pinned official arm64 PostgreSQL digest. A bounded snapshot for at most 64 participants plus two makers is updated atomically with canonical events, outbox and checkpoint. Detailed raw observations remain append-only. This is a measured local engineering profile, not a production history-retention or throughput claim.
- **Phase boundary:** Cash, unpaid profit, adverse risk and withdrawal capability remain distinct. The test-route profile has no enabled withdrawals, settlement, orders or authenticated funding. P06 owns submission bytes/intent and execution retry policy; P07/P08 own their future financial projections. Actual acceptance and integration status are recorded in WORKLOG; this decision alone does not close G06/P05.

- **G06 evidence:** [P05 clean acceptance](evidence/P05.md) passes on `fb2606f`: 18 RPC/PostgreSQL recovery checks, five actual-chain-reset/CLI checks, complete chain/vault reconciliation and fresh database reconstruction. G06 is verified; P05 remains Review until integration and M3 requires P06.


## 21 October 2026 — P06 ordinary exits and durable workers

- **D26 / settlement boundary:** Supersede D24/D25's disabled ordinary-settlement/trading-withdrawal boundary only for the explicit local-test-profile. Select [LIFECYCLE](P06-LIFECYCLE.md)'s 1–8-member paginated, exact-registry, market-sequence/observation-bound ExitGuard. A complete conservative solvent cohort and fresh observation precede gains/exits; each action retains entitlement, available P and post-action margin checks. Collection can proceed without a certificate. No change to first-admissible ordinary settlement, zero unpaid margin credit, fee rules or exceptional complete-cohort default. Distress/no-credible-bound handling remains P07/P09.
- **D27 / G07:** User pays user-initiated network fees; each maker pays its own epoch/sync transactions. A separately funded keeper pays scan/collection/settlement fees. Pin local run caps to 1,000,000 lamports per maker and 5,000,000 for the keeper, with 20,000 reserved per immutable signed intent, bounded by RPC estimated and finalized actual fees. No user sponsorship, collateral fee deduction or automatic top-up. Unresolved jobs retain reservations. Initial deployment/rent provisioning is explicit fixture setup outside worker fee budgets.
- **Durable retry:** Commit exact signed bytes, signature, blockhash and economic authority before broadcast. Retry only those bytes. Unique request identity rejects different bytes; concurrent row locks/stable keeper identities plus on-chain sequences prevent duplicate effects. Finalized status and independently fetched transaction are required to report success/failure. Expiry needs invalid finalized blockhash plus unchanged finalized monotonic authority to establish nonexecution; otherwise preserve unresolved status. No automatic user re-signing.
- **Maker availability:** A/B run distinct owner keys/processes, publish only expired epochs, and report observed inventory/cost state. Three-second heartbeat expiry excludes a daemon from the quote service's labeled candidate universe; it does not revoke standing on-chain authority. No independent maker, external hedge, profitable economics or production readiness is claimed.
- **Acceptance:** Configuration is selected here; actual A05/A07/A08/G07 and M3 exit results and integration status remain in WORKLOG/evidence.

- **G07 evidence:** [P06 clean acceptance](evidence/P06.md) passes on `2578327`: 49 signed cohort/settlement cases and 15 actual RPC/WS/PostgreSQL service checks, including explicit payer/cap accounting, unknown failed-transaction fees, real expiry and worker recovery. G07 and M3's engineering exit are verified; integration remains Review in WORKLOG.


## 21 October 2026 — P07 source policy and funding

- **D28 / G08:** Select the finite controlled source, mark, trigger-reference, funding coverage/cap/time/recovery profile in [ORACLE-AND-FUNDING](P07-ORACLE-AND-FUNDING.md). Four immutable signed local fixture feeds provide primary/guard BTC and collateral conversion. No upstream verifier or economic source independence is claimed; G11/G12 remain later gates. Market mode 2 disables the earlier ad hoc setter.
- **Causal accounting:** Prior qualified observations alone determine covered funding. Accrue before q changes, retain exact participant fractions through flat/reopen, preserve materialized obligations when discarding unverified pending intervals, and expose coverage gaps. Complete-cohort exits check conservative held-index endpoints and fully checkpoint-adjusted claims. No fee, loss-bearer or collateral authority changes.
- **Bounded sampling:** Qualify both required modules on both sides and derive a conservative funded depth prefix before exact fixed-curve impact search. This limits compute and can intentionally reject marginal funding coverage while a reducing ordinary route remains possible. Reuse module authentication only within the same read-only transaction; every quoted response remains checked.
- **Status:** Selected configuration is not acceptance. Actual G08/A09/A10 results, source identities and measured resources must be recorded before P07 becomes Review.

- **G08 evidence:** [P07 acceptance](evidence/P07.md) verifies A09/A10/G08 on clean `83f70d4`, with unchanged financial trees from the passing P01–P06 regression at `f072147`. All 258 signed P07 SVM scenarios and 11 real RPC/WS/PostgreSQL checks pass; maximum sampling cost is 660,691 CU / 781 bytes / 20 accounts. The full wrapper stopped at a subsequently fixed TCP preflight; targeted P07 acceptance exits zero. P07 remains Review pending integration.

## 21 October 2026 — P08 order configuration (implementation in progress)

- **D29 / G09:** Select [ORDERS](P08-ORDERS.md)'s embedded four-slot/two-group authority, 216,000-slot lifetime, finite all-in prices/fee budgets, conservative reserve sums, exact cumulative fee prefix and generation-bound existing-position TP/SL. Keep immediate owner signatures and use a separate stored-authority keeper instruction. Maker renewals revalidate current commitments without resetting user budgets.
- **Boundary:** No economic fee, margin-credit, loss-bearer, custody or order-type expansion. Cancellation/cleanup remains independent of pricing availability. Default build and later liquidation/default remain disabled. Configuration selection is not acceptance; A11/A12 and measured ABI/resource evidence are still required.

- **G09 evidence:** [P08 acceptance](evidence/P08.md) verifies A11/A12/G09 across clean `1f27fa8` and harness-only child `cd2b8fa`, with identical financial/service trees. 203 signed P08 transactions plus 45 setup transactions and ten real RPC/WS/PostgreSQL checks pass. The fully populated split uses 298,776 CU / 824 bytes / 18 accounts. P08 remains Review until integration; no full-wrapper exit-zero, load, devnet or external-review claim follows.


## 21 October 2026 — P09 risk/default configuration (implementation in progress)

- **D30 / G10:** Select the finite local liquidation, default-entry, 1–4-member page, staged rounding and recovery policy in [RESOLUTION](P09-RESOLUTION.md). Liquidation pays a capped 5 bps funded fee to a consenting non-maker receiver, with no duplicate ordinary taker fee; current index-derived bands, strict post-fee deficit/exposure improvement and receiver IM/reservations remain mandatory.
- **Complete cohort:** Preserve D19's exact scaled insurance/impairment and terminal rounding. Persist bounded floor/remainder/award passes and a complete payout plan before payment; explicitly reconcile mixed applied/unapplied frozen representations. No new cash asset, selected haircut cohort, stale discretionary mark or liquidation-capital assumption is introduced.
- **Status:** G10 selections are implementation choices, not acceptance or M6 calibration. Measured signed/RPC resource limits, A13/A14 and recovery evidence remain required. Unimplemented financial paths stay disabled.

- **D30 implementation refinement:** Preserve the last credible source deadline through restrictive samples for the 30-second emergency grace proof; status/validity continue blocking pricing. Freeze rereads immutable authenticated sources. Resolution collection keeps ordinary v frozen and uses explicit collected adjustments, preserving P02 derived-claim headroom. Compact page events specify deterministic final book cleanup; fresh signed/account reconstruction remains required.

- **D30 representation supersession:** PROTOCOL §10's former shorthand physically zeroed q while valuing each account. P09 instead stores those exact valued claims in its frozen ledger and delays physical q/v finalization until the complete plan is applied. This preserves D19's payout/rounding semantics, supports derived-claim headroom and makes partially applied cohorts explicitly reconcilable. It does not introduce another loss-bearer or margin-credit rule.

- **D30 funding coverage:** Close the prior sampler's diagnostic interval at freeze and count the full frozen interval as skipped at resume. Preserve exactly the materialized F and original charges. Resetting sampler state must not silently discard coverage counters or backfill funding across resolution.

- **D30 replay correction:** The first clean full run reached post-collection reconstruction and exposed shared nested order-book references between candidate projection and canonical events. Projection now copies each event payload before retaining mutable state. Journaled historical payloads must remain immutable through later resolution cleanup; the regression fails without this boundary. This fixes the indexer, not the on-chain payout rule. Fresh acceptance remains required.

- **G10 evidence:** [P09 acceptance](evidence/P09.md) verifies A13/A14 on clean `8e8f371` with a full P01–P09 wrapper exit zero. All legal page sizes agree with independent Python; the 64-member case, real funded liquidation, post-collection crash/rebuild, source emergency, full payout/reconciliation and separate resume authority pass. Largest page is 255,514 CU / 561 bytes / 13 accounts; the account is 8,031 bytes. The first clean run's event-aliasing defect and failing regression remain recorded. P09 is Review pending integration; this is no M6 calibration or funded-use authorization.

## 21 October 2026 — P10 user interface and direct recovery (implementation in progress)

- **D31:** Use the [TRADER](P10-TRADER.md) wallet/configuration/transaction boundary with the existing React/Vite/Wallet Standard stack. The browser verifies canonical accounts and reconstructs quotes; public local deployment identity is separate from venue API availability. Store exact signed bytes before broadcast and preserve unresolved status when history is inconclusive. API and browser share exact labeled balance arithmetic. No custody authority, economic fee, margin-credit or order promise changes.
- Direct cancel/withdraw/settlement use existing generated instructions and current cohort/source/margin gates. Cohort checks require explicit preceding verification transactions: Solana promotes writability across the whole message, so combining a read-only proof containing the exiting participant with its cash mutation would violate the existing proof contract. P10 preserves that on-chain contract and requires a fresh preview/signature for each proof and exit. UI previews never authorize a bypass. A15 and actual browser/RPC/PostgreSQL evidence remain pending.

- **D31 local scheduling:** P10 browser acceptance declares a five-second funding-worker cadence, with service default two seconds and accepted configuration 2–5. The existing on-chain minimum, held funding, source validity and qualification are unchanged. Development captures show Surfpool can expose risk-account contents ahead of its reported finalized context slot; previews continue to reject `slot < validFrom`. The harness records explicit unsigned retries and never silently resigns. Real-cluster read/finality parity remains P13/P14.

- **D31 submission correction:** Direct RPC follows the existing relay’s submission policy after the reviewed unsigned simulation: exact verified/persisted signed bytes use `skipPreflight:true`, retaining full on-chain validation and fee accounting. A second preflight can reject an already signed transaction without a historical result, as observed in the clean stopped-API withdrawal run. No automatic signature replacement or negative inference from missing history is introduced.

- **23 October — D31 local acceptance correction:** Keep full integrated acceptance at 50 ms. After actual five-attempt upload exhaustion, local program provisioning/upgrade commands use a bounded 20 CLI signing attempts. The 100 ms full run demonstrated that sequential manual publication/finalization can exceed G08's six-second recovery-gap limit; its restrictive result is retained as a failed harness profile. Neither on-chain recovery/source rules nor financial unknown-outcome handling changes. Browser-only acceptance at 100 ms remains separately recorded.

- **D31 acceptance:** [P10 targeted acceptance](evidence/P10.md) passes all 15 browser checks on clean `881ae54`, including exact signed-byte reconciliation, unpaid-versus-cash, durable orders/protection and API-stopped direct cancel/withdraw. Six responsive theme captures and independent Python integer reconciliation pass. The preceding full regression was intentionally stopped after orders at the user's request; no full-wrapper success is claimed. G08–G10 and unchanged Rust programs retain their recorded predecessor evidence. P10 and M4 are Review pending integration.

## 23 October 2026 — verification scope

- **D32:** Explicit user direction supersedes the convention of rerunning all inherited acceptance before each PR. Run checks needed for the actual change and phase gate; prefer supported CI for broad regression. Do not spend local time repeating unrelated financial suites or represent absent CI as validation. P11 still owns the integrated fault matrix, P12 the real 24-hour soak, and P13/P14 actual cluster parity. This changes verification scheduling, not economic rules or acceptance standards.

## 23 October 2026 — integrated evidence (implementation in progress)

- **D33:** Select [MATRIX](P11-MATRIX.md)'s seven-stage, clean-source, unique-environment evidence contract. A16 requires every A01–A15 row, explicit fault observations and independent exact reconciliation; missing or interrupted work is not-run/fail, never inferred from old counts. Preserve rejected/unfilled/unresolved populations and immutable wire hashes. All G01–G10 selections remain their existing local profiles; no economic or authority rule changes.
- Use change-scoped hosted PR checks on the actual stacked diff. The repository has no self-hosted runtime runner, so do not claim full runtime CI or create paid infrastructure. Local A16 acceptance remains pending until the new command actually passes. P12's real elapsed soak remains a separate gate.

- **D33 acceptance:** The fresh seven-stage matrix passes all A01–A16 rows, 23 named faults and six independent integer reconciliations on clean `8067159`; [evidence](evidence/P11.md) records the actual 2,885.331-second run and non-success populations. This supersedes the pending local acceptance statement above. P11 is Review pending integration; M5a remains In progress until P12. Hosted CI execution is still pending publication.
