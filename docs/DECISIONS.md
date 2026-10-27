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
| G12 | Independent live source/guard assurance, liquidity, risk limits, insurance budgets, operational costs, review findings and pilot limits | P15B/P16B; A phases supply engineering inputs only | Independent observations/review; unresolved guard independence blocks funded-pilot readiness; funded use needs separate authorization |
| G13 | Schema-2 identities/layouts, group terms, authority, immutable modes and successor migration contract | P17 | Code-to-contract audit, bounded serialization/identity checks; no financial activation |
| G14 | Two-market source/lot/config identity, isolated capital, event/ABI and group custody/exit/default profile | P18A–C | Signed custody, isolated market lifecycles, independent accounting and measured complete-group recovery |
| G15 | Whole-account funding/health/reserves, transfer/netting/delegation and cross activation | P19/P20 | Independent vectors, adversarial full-dependency checks and liquidation/default acceptance before enablement |
| G16 | Group service/indexer/SDK/UI interfaces, operational budgets and bounded successor qualification | P21A–B | Actual RPC/WS/PostgreSQL/browser lifecycle, fresh replay, budget/contention and complete failure populations |
| G17 | Exact account-centric financial contract, loss ownership, cross-market netting, source/funding dependencies and fresh-profile versioning | P22B | Concrete transitions/invariants/authority/layout bounds; independent model vectors and counterexamples; explicit economic decisions before dependent implementation |
| G18 | New registry/account/custody ABI, immutable eligibility/mode, token ownership and deployment identity | P23 | Generated/legacy parity, signed SBF/RPC custody and negative authority/alias checks; no trading activation |
| G19 | Whole-account risk/orders/funding, relevant validity dependencies, settlement ledger and atomic cash exits | P24/P25 | Independent real-implementation checks, signed rollback/conservation/fractions and live-sampler exit cases; ordinary new-profile activation still disabled |
| G20 | Complete selected liability cohort, loss/insurance allocation, liquidation/default/recovery and activation | P26 | Independent maximum-cohort/shared-debtor/cycle cases, post-fee progress, real signed runtime reconciliation and activation gates |
| G21 | Account-centric services/events/UI, operator budgets and bounded concurrent qualification | P27/P28 | Actual RPC/WS/PostgreSQL/browser/replay, normal background exits, complete populations and measured resource/contention limits |

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

## 21 October 2026 — P08 order configuration

- **D29 / G09:** Select [ORDERS](P08-ORDERS.md)'s embedded four-slot/two-group authority, 216,000-slot lifetime, finite all-in prices/fee budgets, conservative reserve sums, exact cumulative fee prefix and generation-bound existing-position TP/SL. Keep immediate owner signatures and use a separate stored-authority keeper instruction. Maker renewals revalidate current commitments without resetting user budgets.
- **Boundary:** No economic fee, margin-credit, loss-bearer, custody or order-type expansion. Cancellation/cleanup remains independent of pricing availability. Default build and later liquidation/default remain disabled. Configuration selection is not acceptance; A11/A12 and measured ABI/resource evidence are still required.

- **G09 evidence:** [P08 acceptance](evidence/P08.md) verifies A11/A12/G09 across clean `1f27fa8` and harness-only child `cd2b8fa`, with identical financial/service trees. 203 signed P08 transactions plus 45 setup transactions and ten real RPC/WS/PostgreSQL checks pass. The fully populated split uses 298,776 CU / 824 bytes / 18 accounts. P08 remains Review until integration; no full-wrapper exit-zero, load, devnet or external-review claim follows.


## 21 October 2026 — P09 risk/default configuration

- **D30 / G10:** Select the finite local liquidation, default-entry, 1–4-member page, staged rounding and recovery policy in [RESOLUTION](P09-RESOLUTION.md). Liquidation pays a capped 5 bps funded fee to a consenting non-maker receiver, with no duplicate ordinary taker fee; current index-derived bands, strict post-fee deficit/exposure improvement and receiver IM/reservations remain mandatory.
- **Complete cohort:** Preserve D19's exact scaled insurance/impairment and terminal rounding. Persist bounded floor/remainder/award passes and a complete payout plan before payment; explicitly reconcile mixed applied/unapplied frozen representations. No new cash asset, selected haircut cohort, stale discretionary mark or liquidation-capital assumption is introduced.
- **Status:** G10 selections are implementation choices, not acceptance or M6 calibration. Measured signed/RPC resource limits, A13/A14 and recovery evidence remain required. Unimplemented financial paths stay disabled.

- **D30 implementation refinement:** Preserve the last credible source deadline through restrictive samples for the 30-second emergency grace proof; status/validity continue blocking pricing. Freeze rereads immutable authenticated sources. Resolution collection keeps ordinary v frozen and uses explicit collected adjustments, preserving P02 derived-claim headroom. Compact page events specify deterministic final book cleanup; fresh signed/account reconstruction remains required.

- **D30 representation supersession:** PROTOCOL §10's former shorthand physically zeroed q while valuing each account. P09 instead stores those exact valued claims in its frozen ledger and delays physical q/v finalization until the complete plan is applied. This preserves D19's payout/rounding semantics, supports derived-claim headroom and makes partially applied cohorts explicitly reconcilable. It does not introduce another loss-bearer or margin-credit rule.

- **D30 funding coverage:** Close the prior sampler's diagnostic interval at freeze and count the full frozen interval as skipped at resume. Preserve exactly the materialized F and original charges. Resetting sampler state must not silently discard coverage counters or backfill funding across resolution.

- **D30 replay correction:** The first clean full run reached post-collection reconstruction and exposed shared nested order-book references between candidate projection and canonical events. Projection now copies each event payload before retaining mutable state. Journaled historical payloads must remain immutable through later resolution cleanup; the regression fails without this boundary. This fixes the indexer, not the on-chain payout rule. Fresh acceptance remains required.

- **G10 evidence:** [P09 acceptance](evidence/P09.md) verifies A13/A14 on clean `8e8f371` with a full P01–P09 wrapper exit zero. All legal page sizes agree with independent Python; the 64-member case, real funded liquidation, post-collection crash/rebuild, source emergency, full payout/reconciliation and separate resume authority pass. Largest page is 255,514 CU / 561 bytes / 13 accounts; the account is 8,031 bytes. The first clean run's event-aliasing defect and failing regression remain recorded. P09 is Review pending integration; this is no M6 calibration or funded-use authorization.

## 21 October 2026 — P10 user interface and direct recovery

- **D31:** Use the [TRADER](P10-TRADER.md) wallet/configuration/transaction boundary with the existing React/Vite/Wallet Standard stack. The browser verifies canonical accounts and reconstructs quotes; public local deployment identity is separate from venue API availability. Store exact signed bytes before broadcast and preserve unresolved status when history is inconclusive. API and browser share exact labeled balance arithmetic. No custody authority, economic fee, margin-credit or order promise changes.
- Direct cancel/withdraw/settlement use existing generated instructions and current cohort/source/margin gates. Cohort checks require explicit preceding verification transactions: Solana promotes writability across the whole message, so combining a read-only proof containing the exiting participant with its cash mutation would violate the existing proof contract. P10 preserves that on-chain contract and requires a fresh preview/signature for each proof and exit. UI previews never authorize a bypass. A15 and actual browser/RPC/PostgreSQL evidence remain pending.

- **D31 local scheduling:** P10 browser acceptance declares a five-second funding-worker cadence, with service default two seconds and accepted configuration 2–5. The existing on-chain minimum, held funding, source validity and qualification are unchanged. Development captures show Surfpool can expose risk-account contents ahead of its reported finalized context slot; previews continue to reject `slot < validFrom`. The harness records explicit unsigned retries and never silently resigns. Real-cluster read/finality parity remains P13/P14.

- **D31 submission correction:** Direct RPC follows the existing relay’s submission policy after the reviewed unsigned simulation: exact verified/persisted signed bytes use `skipPreflight:true`, retaining full on-chain validation and fee accounting. A second preflight can reject an already signed transaction without a historical result, as observed in the clean stopped-API withdrawal run. No automatic signature replacement or negative inference from missing history is introduced.

- **23 October — D31 local acceptance correction:** Keep full integrated acceptance at 50 ms. After actual five-attempt upload exhaustion, local program provisioning/upgrade commands use a bounded 20 CLI signing attempts. The 100 ms full run demonstrated that sequential manual publication/finalization can exceed G08's six-second recovery-gap limit; its restrictive result is retained as a failed harness profile. Neither on-chain recovery/source rules nor financial unknown-outcome handling changes. Browser-only acceptance at 100 ms remains separately recorded.

- **D31 acceptance:** [P10 targeted acceptance](evidence/P10.md) passes all 15 browser checks on clean `881ae54`, including exact signed-byte reconciliation, unpaid-versus-cash, durable orders/protection and API-stopped direct cancel/withdraw. Six responsive theme captures and independent Python integer reconciliation pass. The preceding full regression was intentionally stopped after orders at the user's request; no full-wrapper success is claimed. G08–G10 and unchanged Rust programs retain their recorded predecessor evidence. P10 and M4 are Review pending integration.

## 23 October 2026 — verification scope

- **D32:** Explicit user direction supersedes the convention of rerunning all inherited acceptance before each PR. Run checks needed for the actual change and phase gate; prefer supported CI for broad regression. Do not spend local time repeating unrelated financial suites or represent absent CI as validation. P11 still owns the integrated fault matrix, P12 the real 24-hour soak, and P13/P14 actual cluster parity. This changes verification scheduling, not economic rules or acceptance standards.

## 23 October 2026 — integrated evidence

- **D33:** Select [MATRIX](P11-MATRIX.md)'s seven-stage, clean-source, unique-environment evidence contract. A16 requires every A01–A15 row, explicit fault observations and independent exact reconciliation; missing or interrupted work is not-run/fail, never inferred from old counts. Preserve rejected/unfilled/unresolved populations and immutable wire hashes. All G01–G10 selections remain their existing local profiles; no economic or authority rule changes.
- Use change-scoped hosted PR checks on the actual stacked diff. The repository has no self-hosted runtime runner, so do not claim full runtime CI or create paid infrastructure. Local A16 acceptance remains pending until the new command actually passes. P12's real elapsed soak remains a separate gate.

- **D33 acceptance:** The fresh seven-stage matrix passes all A01–A16 rows, 23 named faults and six independent integer reconciliations on clean `8067159`; [evidence](evidence/P11.md) records the actual 2,885.331-second run and non-success populations. This supersedes the pending local acceptance statement above. P11 is Review pending integration; M5a remains In progress until P12. Hosted CI execution is still pending publication.

- **D33 hosted validation:** Ready PR #13 and its [first scoped CI run](https://github.com/arnabnandikgp/rivalt/actions/runs/39866000756) are verified; all five jobs pass on `6d24616`. Full runtime acceptance remains the separately recorded local matrix; no self-hosted runtime CI claim.

- **D33 hosted timeout refinement:** The exhaustive 600-vector allocation reference exceeded Vitest's 5-second default on a hosted rerun. Give only this test 15 seconds; retain all vectors/assertions. This is a bounded correctness-test runner allowance, not a relaxed P12 latency target or changed economic implementation.

## 23 October 2026 — long-run local resources (P12 in progress)

- **D34:** Add an explicit loopback-only `soak24` fee-budget profile: 500,000,000 lamports per separately funded operator role and 5,000,000 per maker. Default smoke caps remain unchanged. Persisted payer/cap identity, reservation, actual-fee reconciliation and unresolved-intent rules still apply. No automatic funding or collateral deductions. These synthetic caps are not production budgets.
- Indexer recovery remains bounded and reconciled before advancing its checkpoint; an explicit configuration may raise the default 10,000-transaction ceiling to at most 200,000 for the declared long-run profile. Missing history/metadata still blocks readiness. Actual >10,000 recovery and resource viability must be demonstrated, not inferred from this option.
- P12 begins with actual 1/5/10 offered-attempt sweeps and complete populations. Select the sustained profile from measured results, retain failed targets, and run real elapsed 24 hours only after resource preflight. No simulated acceleration or scheduled automation.

- **D34 measured scheduling refinement:** The first completed sweep fails the 99% baseline success target (40/43 at 1/s) while quote p95 is 25.125 ms. First observed processing takes roughly 200–400 ms with a 250 ms executor polling interval. Wake the existing executor using a transactional PostgreSQL notification after signed-byte persistence; keep periodic durable scanning for lost notifications/restarts and preserve exact-byte/unknown-outcome rules. Validate actual lost-ack/restart behavior and remeasure before accepting this optimization. Safe quote-unavailability codes improve cause reporting without changing admission.

- **D34 dispatch boundaries:** The 300-second baseline still fails (193/196) despite 33 ms p95 actual dispatch; two trades follow a new funding observation and one reaches a maker expiry. Quote service refuses pending operator-budgeted observation changes and <=10 remaining processed slots. P12 explicitly selects a one-second unsigned preparation margin before its five-second sampler; default margin remains zero. This conservatively lowers availability, which must be reported across all offered attempts, rather than extending on-chain validity or hiding failed submissions. Worker identities are reserved at public ingress, and pending worker queries bind their persisted budget rather than a caller-controlled prefix. Verify in the focused actual-RPC probe before accepting.

- **D34 sustained preparation:** Boundary qualification passes 107/107 on `7dc9f1c`, at a reported 35.7% offered availability; this supersedes pending verification only. Select a declared 0.25/s sustained candidate for measured disk/rebuild capacity on the current host, retaining 1/5/10 evidence. The harness distinguishes a 900-second outage exercise from a genuine 86,400-second continuous run, records the complete normal/fault/censored populations, and requires fresh-database replay and >10,000 actual history fetches for long acceptance. Source publication uses a separate capped prefunded synthetic payer. Public audit inputs enable independent per-lot load-quote checks without modifying program economics. These features are not yet executed soak evidence.

- **D34 sustained findings:** The first active exercise verifies both maker expiries/recoveries and loaded executor retry, then stops on a harness-only ordinary-order generation error. Preserve those partial results and verify the remaining work with a 360-second tail exercise. Its UI measurements also identify a real SQL alias-ordering defect above sequence 99: public decimal-string serialization must not change numeric event chronology. Qualify `events.sequence` in trade/event pagination and candles; verify against actual PostgreSQL rows with an independent numeric reference. Neither financial programs nor event authority changes.

- **D34 audit completeness:** The tail exercise passes the remaining worker faults and real order reopening, then stops because the new independent quote audit omitted maker epoch validity. Public audit inputs must include version/start/exclusive expiry, and the independent fixed-profile reference must enforce them. Incomplete old audit captures are not retroactively labeled passing. Retain the completed fault evidence and use a separate 180-second final-check probe for the remaining audit/withdrawal/read/rebuild paths. Candle extreme comparisons use exact rational equivalence, preserving actual first/last fills and integer volume.

- **D34 finalization/clock refinement:** Complete independent quote audit now passes 59 actual inputs. The next harness failure is a correctly rejected attempt to rewind an existing exit certificate; finalization must reuse/resume the current bound certificate. Measured ~48 ppm host clock slew supersedes the provisional cumulative two-second drift gate: retain 10-second heartbeat and two-second per-sample jump limits, allow at most two seconds plus 100 ppm cumulative slew, and require both wall and monotonic clocks to reach the full duration. The steady offer loop extends conservatively for a lagging wall clock. Offline analysis runs after live financial work, and numeric API pagination checks target each reached decimal boundary rather than repetitively scanning all pages. These are measurement/finalization corrections, not financial-rule changes or a soak completion claim.

- **D34 final-path verification:** Clean `2e76c7b` passes 60 complete quote audits, actual one-atom withdrawal, numeric API/candle comparisons and fresh-database replay of 189 fetched transactions. Capacity preflight records 4.707 GB free and a short-run 2.347 GB primary-plus-replay projection at the selected 0.25 offers/s. This supports starting the guarded full-day run; it does not establish elapsed 24-hour acceptance or >10,000-transaction recovery. No further financial/program regression run is required for this evidence-only checkpoint.

- **D31 manual access:** Add a bounded manual local launcher reusing the existing deployed-program/service fixture and production-built UI. It opens visible Chrome with the same instrumented Wallet Standard adapter, 100 deposited test USD and 50 additional actual minted test tokens. Signing stays in Node and is restricted to the demo's main-frame origin and funded fixture accounts. No HTTP signing endpoint, app-bundled secret, automatic trade loop or external wallet/provider claim. Close the tab or reach the 60-minute default limit to stop owned resources; no soak acceptance follows from this mode.


## 23 October 2026 — authorized bounded MVP qualification

- **D35 / supersedes D32–D34's blocking P12 duration requirement:** After reviewing the interrupted 2h44m evidence and its limitations, the user explicitly approved fixing the observed issues, testing the missing recovery/history paths, and replacing the P12 full-day gate with bounded qualification. A continuous 24-hour endurance run remains required before a positive funded-pilot readiness decision in P16/M6. It is deferred, not passed; interrupted periods cannot be added together to claim it.
- Revised A17 retains the measured 1/5/10 sweeps and all failure populations, independent financial checks, declared worst-case resource budgets and actual six-fault evidence. Add a clean 1,800-second real Surfpool/RPC/WS/PostgreSQL/UI qualification at one offer/s, repeating the affected funding, executor/RPC and indexer recoveries. Require quote p95 <=200 ms, >=99% normally submitted success, >=50% normal offered availability, >=20% CU headroom, zero unexplained accounting differences and a real final withdrawal. The 50% availability floor is declared before the new measurement; it is an MVP improvement floor, not a production service objective.
- Separately build at least 10,001 real, uniquely signed collateral deposits, fetch/decode each and check the exact token/cash/network-fee deltas. Reconstruct the whole resulting history over RPC into a fresh PostgreSQL database, actually fetching >10,000 transactions and comparing full state and balances. This is history/recovery coverage, not simulated elapsed endurance or trading throughput. Keep offers, custody history and fault populations distinct.
- Diagnose the interrupted signature from retained evidence without rewriting its original unresolved attempt. Exercise missed notification, lost acknowledgement, worker death and 15 seconds of submission-RPC unavailability with the same persisted wire/signature and exactly one deposit. Record owned PostgreSQL heap/index/WAL, run archives/logs, host swap and free disk separately; filesystem residuals remain unattributed. Do not claim leak freedom from a bounded run.
- **Confirmed quote previews:** Surfpool 1.6.1 reproduces current account contents with a finalized context about 31 slots behind. Use explicitly labeled confirmed snapshots only for route preparation and independent client quote validation. Default balance/exit/worker snapshots, finalized indexer projections, receipts and fee reconciliation remain finalized. A pending funding intent permits quoting only after its exact independently fetched confirmed transaction decodes to the current observation, market/domain/config/terms, validity and funding state at or before the preview context. Unknown/conflicting evidence still refuses quotes. No intent becomes finalized and no fee reservation is released from this preview evidence. A reverted/stale preview must reject under the existing on-chain observation/nonce/epoch/price constraints. Keep the dispatch margin, source rules and expiry limits unchanged.
- Publication remains conditional on actual revised acceptance. No A17, full-day endurance, independent review, funded readiness or P12 PR is claimed by this amendment alone.

- **D35 resource preparation:** The interrupted run's first owned-process sample attributes about 1.91 GiB RSS to Surfpool alone (shared-page/RSS caveats apply). The pinned executable exposes `--disable-instruction-profiling`; select it for load/manual supervisors because instruction-profile retention is unused by these checks. Keep standard signed execution, transaction metadata/logs, event decoding, RPC/WS history and CU assertions. Measure the actual revised footprint; do not assume this setting solves host pressure.

- **D35 fault scope correction:** The first probe's broad 15-second proxy interruption also expired an unrelated unbroadcast funding intent. Retain that failure and its held fee reservation; do not infer fee absence or automatically replace the transaction. Scope the intended recovery proof to the already-broadcast original signature's status/transaction reads and exact-wire retry. This proves that signed transaction's recovery, not complete provider-outage liveness; unavailable/expired operator intents may still stop discovery safely.

- **D35 preview verification:** Clean `cc43694` passes the 300-second probe at 216/216 submitted success and 72% normal offered availability, with 216 independent quote audits, actual client reconstruction, scoped interruption recovery and 417-transaction projection replay. This verifies the preview refinement at the measured profile; the bounded full-system qualification, fresh-database >10,000 history and terminal withdrawal remain pending.

- **D35 bounded acceptance:** The recorded `c8fd613` run passes 30 real minutes, 1,249/1,249 submitted trades, 71.19% normal offered availability, affected recoveries, actual final exit and 12,454-transaction fresh PostgreSQL reconstruction. The separate history stage includes an explicitly recorded graceful indexer stop; the final harness automates it before dense generation. This avoids redundant moving-tip work without removing full primary/fresh reconstruction or any assertion. [P12 evidence](evidence/P12.md) records the intervention, actual scope and unchanged financial artifacts. P12/M5a move to Review pending integration; 24-hour endurance, real-cluster parity and external/funded gates are not claimed.

## 23 October 2026 — sponsored Core for the engineering MVP

- **D36:** The user approves sponsored Pyth Core on-chain price accounts for P13/P14 and defers paid Pro integration. This supersedes requiring Rivalt to obtain Hermes API access or post every upstream update itself. A sponsor-executed signed update is acceptable only with independently fetched/decoded successful upstream verification transactions, bound price accounts and actual Rivalt consumption. Account existence, recent read-only references or injected fixture bytes alone cannot close A18. Select exact account/program identities from real devnet evidence before deployment.
- Retain the 20-second source-age limit, two-second future skew, confidence/conversion/divergence and funding-gap/recovery rules. Intermittent trading availability is acceptable for this test-asset MVP, but must be reported. Reuse existing restrictions/UI rather than adding a pusher or duplicate stale handling. Any timing/risk relaxation still needs a separate justified decision; no availability or economic independence is inferred from the sponsored feed listing.
- P13 remains real source/deployment/provenance and accepted/rejected protocol actions. P14 remains focused wallet/lifecycle/order/funding/provider parity; no additional load or endurance gate is added. P15/P16 retain independent source/maker/review, funded-risk calibration and deferred continuous 24-hour endurance. Neither paid services nor funded deployment/outreach is authorized.

- **D36 implementation selection:** The clean three-minute public devnet observation finds both compatible feeds eligible in 3/37 samples per commitment, versus 1/37 for the original pair; these are sampled source checks, not executable trading availability. Select the compatible receiver and fixed shard-zero accounts in `ops/devnet-profile.json`, preserving all G08 timing limits. Independently decode the actual successful VAA verification, sponsored push and receiver CPI messages. Prepare a separately keyed `devnet-test-profile`; its zero-valued route bootstrap creates no executable synthetic observation, and its ad hoc setter remains disabled. The operator guard mirrors the declared primary with original publish times and supplies no independent economic assurance. Actual A18 consumption/deployment remains pending.

- **D36 acceptance scheduling:** Confirmed guard/sample observations may prepare the next sample and quote, consistent with existing confirmed quote previews. They remain explicitly provisional. A18 requires all original wires/events to reconcile identically at finalized commitment; no successful result is inferred from WS or confirmed status alone. Keep guard writes separate from read-only sampling and retain on-chain source timing, fees and authority unchanged.

- **D36 atomic acceptance composition:** Existing sample and route instructions may share a transaction with the route bound to the next observation sequence. Actual on-chain time must satisfy the unchanged recovery/source gates; otherwise both instructions roll back. This removes the network gap between the final observation and trade without introducing a new instruction, oracle authority or relaxed timing rule. Guard publication remains a separate write because source sampling requires read-only inputs.

## 23 October 2026 — proportionate devnet qualification

- **D37 / A18–A19:** The user explicitly directs engineering testing to account for intermittent free sponsored devnet feeds, rather than repeatedly seeking an ideal continuously fresh run. A18 closes on actual deployment/source/mint/authority verification, an independently reconciled accepted trade and actual restrictive actions. Preserve failures and availability limits. A missing live trade log may be resolved through the original signature's actual finalized HTTP history and fresh WS subscription; this is recovery evidence, not uninterrupted notification delivery. The original failed report remains failed. P14 retains one bounded real service/wallet lifecycle and provider/backfill recovery, with no load/endurance or continuous sponsored-feed availability target. Correct accounting, authentication, authority, stale-input restrictions and unknown-signature handling remain mandatory.
- **Devnet timing authorization:** The user approves a 30-second source-age ceiling for devnet only. P13's successful action and deployed artifacts still use 20 seconds; do not relabel them. An enabled 30-second configuration must be explicitly versioned and boundary-tested in P14, leaving local/default profiles, six-second recovery, funding, confidence and other rules unchanged. This authorization permits a test setting, not a production risk calibration or a claim that free feeds are continuously usable.
- **G11 evidence:** [P13](evidence/P13.md) records actual deployments and exact consumed primary verification, the explicitly operator-controlled guard, test mint/authorities, configured provider access, finalized accepted/rejected actions and independent integer reconciliation. G11 is satisfied for this limited engineering profile. Independent-guard/source assurance remains G12.

- **D37 P14 implementation:** Profile `p14-sponsored-core-test-assets-v2` implements the authorized 30-second ceiling through an explicit devnet adapter selection shared by sampling and resolution rereads. Local/default policy stays at 20 seconds; funding/recovery and other source checks are unchanged. Targeted host boundary checks pass; SBF boundary execution, upgrade and actual lifecycle evidence remain pending. P13's current deployment and historical proof are still the 20-second profile until a recorded upgrade.

- **D37 P14 recovery method:** Exercise a deliberately closed real provider WS plus an actual broadcast whose acknowledgement is discarded locally. Persist signed bytes in PostgreSQL before submission; new service/indexer instances must recover the original signature and backfill its missed event with one cash effect/outbox entry. This controlled fault proves recovery under that condition, not a naturally occurring provider outage. Provisioned test tokens are separate from the actual signed deposit. Recovery acceptance remains pending the recorded run.

- **D37 flat-cohort service parity:** Respect clearing's existing P07 mode-2 flat-cohort settlement/exit path after source expiry. The worker's unconditional stale-source return unnecessarily stranded this admissible path; restrict that return to cohorts with exposure. Keep pause/freeze, complete-cohort certification, sequence stamps, exact fractions and funding limits unchanged. P14 demonstrates its bounded lifecycle by closing the retained A position so the full cohort is flat; it does not relabel this as an actual devnet cross-maker close.

- **D37 external-wallet budget:** The user's actual Phantom diagnostic shows unchanged payer, blockhash and registration, with added 200,000-CU limit / 375,000 micro-lamports-per-CU price. Preserve strict returned-message equality and specify the existing 400,000-CU limit plus zero priority price before simulation/fee preview/signing. Ingress accepts only that zero-price extension to its existing budget profile. This is preparation compatibility, not permission to accept wallet-modified messages or a priority-fee policy change. A real external-wallet landing remains required; tests alone do not establish Phantom compatibility.


## 23 October 2026 — local evidence and reviewable phase diffs

- **D38:** The user directs removing bulky raw evidence from Git tracking while leaving every existing local file at its original path. No bundles, downloads, uploads or release assets are requested. Keep concise acceptance summaries, original tested identities, audit code and necessary small regression inputs tracked; explain that raw references are local-only and unavailable in a fresh clone.
- Ordinary tests use deliberate field projections under `tests/fixtures/`; full retained-run audits still consume the unchanged local reports. Deployment configuration is explicit in `ops/`, independent of historical run output. Enforce the tracked-evidence/fixture budget in scoped CI. A fixture replay is not new acceptance evidence.
- Add cleanup commits to each existing phase, including the cleaned preceding phase as an ancestor. Preserve the exact original tested commits and their source history. This supersedes any implication that raw evidence must remain in the current source tree, not the acceptance requirements or recorded failures. No financial program behavior, economic setting, milestone status or funded authorization changes.

## 23 October 2026 — stack review remediation

- **D39:** Authenticate maker config initialization against clearing's existing owner/market participant derivation without changing PDA seeds or instruction/account layouts. Bound operator retries to 16 immutable signed attempts per request, only after independently proven failure/nonexecution. Maker registration epochs provide the publication/sync nonexecution stamp; unknown fees retain reservations. No automatic wallet replacement signing is introduced.
- Limit automatic Complete-stage recovery checks to eight persisted attempts per epoch and stop after qualification. Further source qualification and resume are explicit authority operations; on-chain freshness, six-second recovery, frozen accounting and fee budgets are unchanged.
- Treat mismatched indexer identity as a venue-data error while preserving independently validated direct RPC exits. Add targeted regressions for review findings, preserve original evidence and perform no new load/soak qualification. Remediation is a focused maintenance PR atop the existing phases, to merge atomically with the full stack.


## 24 October 2026 — human-readable program organization

- **D40:** At the user's request, separate clearing instruction handlers/contexts from persistent state, extract root constants/errors/events, and replace terse implementation variables with domain names. Split the oracle impact calculation and resolution page ledger from their entrypoint modules; provide a source map. Keep published account fields, instruction arguments, discriminants, seeds and error codes intact. This is a maintenance refactor, not a new economic phase or a devnet upgrade.
- Verify freshly generated IDLs against the existing wire ABI, both normal/CPI compilation and affected compiled-program scenarios. Unchanged service/browser/load/soak suites are outside this PR's validation scope. Original phase evidence retains its recorded identities; current verification belongs to R029.

## 25 October 2026 — D39/D40 deployment follow-up

- R030 rolls the reviewed D39 A/B initialization authentication onto test-only devnet, jointly reapproves exact deployed ProgramData hashes and verifies the affected owner binding. Clearing remains on its recorded P14 artifact; D40's clearing source reorganization is not described as a deployed binary. No economics, source-age limit, key authority or paid/funded scope changes.
- Existing-market test configuration uses the market's stored domain. A renamed operator profile cannot redefine that authority. Preserve R030's failed derived-domain fixture and its separately valid approval/accounting evidence; the corrected ownership-only continuation supplies the missing valid initialization checks. The [closeout report](evidence/R030-DEVNET-CLOSEOUT.md) records actual identities, limits and commands.

## 25 October 2026 — standalone engineering extensions and separate external gates

- **D41 / supersedes the combined P15/P16 sequencing and D35's placement of endurance:** At the user's request, split P15 into P15A (maker kit/economics tooling) and P15B (independent maker validation), and P16 into P16A (engineering endurance/operational readiness) and P16B (independent review/funded-pilot readiness). Engineering work proceeds P14 → P15A → P16A without waiting for external participation. Completing A never closes B or G12. P01–P14 acceptance and selected economics are unchanged.
- P15A must work from a fresh operator environment and keep internal makers, synthetic sources, hedge assumptions, funded cash/P&L, unpaid claims and actual network costs explicitly distinct. P16A owns the actual uninterrupted 24-hour test, availability-denominator/cause analysis, justified fixes and measured technical/provisional-risk limits. Do not relax risk/oracle safeguards to improve metrics. The earlier 71.19%/30-minute evidence and interrupted 2h44m run retain their original scope.
- Keep new PRs ready for review, stacked with `gh stack`, and **open** under the user's latest instruction. A verified open predecessor permits dependent implementation; integration is still required for Closed. No autonomous merge of this new stack. External outreach, paid services, external hedging, independent review claims and funded deployment retain their separate authorization/evidence gates.

## 25 October 2026 — keep long endurance deferred

- **D42 / supersedes D41's P16A full-day requirement:** The user immediately corrects the new request: the 24-hour qualification was included mistakenly and should remain deferred until much later. Remove it from current P16A acceptance; no full-day run has started. Do not impose a different long soak as an automatic substitute.
- P16A now covers availability-denominator/cause analysis, actionable fixes with unchanged safeguards, targeted bounded real-runtime recovery/reconciliation/exit checks, measured technical limits and provisional risk assumptions. Choose each check's scope/duration from the behavior being verified and retain its actual limitations. Continuous 24-hour endurance remains a separately labelled Deferred future item, never a completed result; revisit endurance when later funded-readiness work is actually scoped. P15A and the open external P15B/P16B gates are unchanged, and new PRs remain stacked/open.

- **D41 P15A implementation profile:** Package the existing A/B maker runtime and shared PostgreSQL/executor arrangement; do not imply independent operational isolation, adaptive quoting, key rotation or deregistration. Use the existing `smoke` fee budgets and unchanged on-chain risk/authority rules. Qualification begins with 1,024-slot local epochs to exercise actual expiry/publication, then the bot's existing 3,600-slot epochs. Report ordinary finalized lifecycle economics independently, with capital injections, funded versus unpaid profit, actual SOL fees and hypothetical hedge costs separate. Historical marks are stale and unsupported liquidation/default attribution rejects. The fresh lab proves a bounded workflow and one-atom admissible exit per maker, not independent economics or full capital evacuation.

- **D43 / P16A measurement clarification:** P12's 71.19% is 1,196 signed offers / 1,680 offers outside declared fault windows, not proof of oracle Normal mode or wall-clock uptime. Keep historical results and all 484 unsigned refusals attributed. Separate returned eligible quotes, signed submissions and finalized fills; retain failed/unknown outcomes and absent-population nulls. Add read-only confirmed-preview context to future refusals without changing any guard, ordering or financial rule. Validate only affected reporting and a bounded source/signature/indexer recovery/direct-exit workflow; no new throughput or endurance claim. D42 and the independent B gates remain unchanged.

## 25 October 2026 — maker-kit review and authorized stack integration

- **D44:** The user explicitly authorizes addressing the posted findings and merging PRs #20/#21, superseding D41's keep-open instruction for this stack. Both phases remain Review until actual integration is verified. P15B/P16B remain external Open gates; D42's deferred endurance and all funded/outreach restrictions are unchanged.
- Bind an opening economics checkpoint to the configured maker's owner and live capital before capture, in addition to the existing run/market/domain checks. Log a bounded failure reason once per maker outage, redacting the configured database URL and incidental URLs before truncation. No on-chain authority, economic arithmetic, signing, retry, fee or oracle policy changes. Verify the affected CLI boundary and diagnostic redaction; retain prior integrated-flow evidence with its original attribution instead of rerunning unrelated suites.

## 25 October 2026 — authorized isolated/cross successor

- **D45 / explicit supersession for schema 2 only:** The user authorizes the supplied isolated/cross proposal as the direction for a bounded test prototype, not an audited current specification. Supersede D02's isolated-only trader scope, D03's one-market limit, D12's market-only account/coordination boundary and D15's original 16-phase ceiling. Add P17–P21 and M7 without renumbering completed work or closing M6. Inspect actual `b005478`, not the proposal's uninspected `366b09d`. P17 records the concrete gap matrix and normative successor contract.
- **D46 / G13:** Adopt group → owner portfolio → immutable margin-root identities in fresh versioned PDAs, two canonical position slots, 64 stable group members, portfolio indexes 0–3 and child indexes 0–8. Child zero is cross; positive children are isolated to one immutable market. Maker capital stays isolated with one registration binding. One six-decimal mint; BTC/ETH lot sizes 1,000,000/100,000 per unit; retain synthetic 10%/5% IM/MM and existing fixed-point bounds. Account-specific owner-set expiring delegate may trade/cancel but cannot transfer/withdraw/net claims; revocation increments an immediately checked epoch. No account deletion, role/mode conversion, automatic family collateral or owner rotation.
- **D47 / intentional economic supersessions:** Generalize D07/D19/D20 to count funded cash once and sum negative market risk claims, with additive margin and remaining reservations. No positive open-gain offset or correlation credit. Add explicit owner-authorized flat-only same-root/group closed-claim cancellation with exact fractions and no cash creation. Generalize D10/D26/D30 from market-local to complete-group settlement/default: shared P/I/T/vault, complete group exit proof, terminal account-net claims before existing insurance/impairment/rounding waterfall. Normal settlement stays first-admissible; paid gains are not clawed back; sibling funded cash is not a guarantee. Conservative negative risk equity alone never proves default. Preserve strict post-fee whole-account liquidation progress and funded receiver requirements.
- **D48 / activation and evidence:** Fresh local test deployment/domain; no V1 byte migration or devnet upgrade. Old funds move only through separately admissible owner withdrawal and explicit new deposit; never relabel claims, fractions or reserves. P18 isolated activation waits for its liquidation/group-default checks; cross activation is compile-time disabled until P20's actual acceptance, plus explicit successor local profile. Independent golden cases must test the real code, then signed SBF and actual Surfpool/RPC/WS/PostgreSQL flows. Measure packet/CU/account bounds and contention. P16A or proposal arithmetic is not successor acceptance. D42 remains Deferred; P15B/P16B stay Open and external/funded/outreach authorization is unchanged.

- **D46 P18A custody realization / G14 custody:** Owner-selected immutable role is validated at registration; maker admission remains a separate future authority operation. Initialize BTC then ETH with fixed identities before portfolios. Custody mode permits real deposits, owner exits and explicit same-owner/same-group transfers only with canonical empty financial fields, plus authority pause and surplus-to-insurance classification. Default/devnet cannot activate this successor profile. Critical group events use nullable actual-vault observations rather than a fake zero for operations that did not read it. [P18A](P18A-GROUP-CUSTODY.md) pins the ABI/profile and focused checks; [A23A evidence](evidence/P18A.md) records custody acceptance on `6389c3e`. G14 trading/recovery remains pending.


### D49 — Successor two-market test primitives (P18B / G14 trading)

BTC source prices retain the USD 10,000–100,000 range and 1,000,000 lots/unit.
ETH uses USD 1,000–10,000 and 100,000 lots/unit: checked multiplication of both
asset value and confidence by ten precedes the existing conservative ratio and
interval rounding. Collateral remains six-decimal classic SPL. Both therefore use
the bounded 10,000–100,000 quote-atoms/lot reference range, existing strategy and
execution bands, order bounds and 10%/5% synthetic margin. These are provisional
local test limits, not calibrated production parameters or correlation discounts.

Six signed local fixture accounts bind primary/guard BTC IDs 1/3, shared collateral
2/4 and primary/guard ETH 5/6. V1/devnet adapters are unchanged. Local age remains
20 seconds; no new freshness relaxation. Each market has its own observation,
held premium, funding index and recovery history. Pre-activation samples cannot
charge funding. Maker config/requests carry version 2 and the group identity;
read-only CPI still receives only the config, with actual ProgramData hash approval.
Four distinct isolated capital bindings serve two A/B markets, using unchanged
strategy arithmetic and 2 bps taker/zero provider fees. Approval is joint owner /
group authority, epoch sync owner-only and quarantine authority-only.

This implements D45–D48's selected scope; it does not supersede their activation,
netting, liquidation/default or external-gate rules. Isolated activation remains
false through P18B; cross activation remains false through P19. See
[P18B primitives](P18B-ISOLATED-PRIMITIVES.md) and the actual acceptance status in
WORKLOG; the choice of parameters alone closes no gate.

D49 verification: [A23B](evidence/P18B.md) passes on `286cb4e` with actual signed
source/maker setup and compiled gate rejection. This verifies G14 trading
primitives only; G14 closes after P18C safety and activated lifecycle acceptance.

## D50 — successor isolated safety lifecycle and dormant cross cash

P18C retains the D45–D49 economics and resolves the ordinary lifecycle detail that
schema-2 child zero can already exist and hold cash before cross activation.
Include these dormant cross roots in complete-group certification/default and
permit explicit owner cash allocation/withdrawal after isolated activation. Reject
any exposure, claim, active order/protection or delegate on them until their own
phase permits it. Activating isolated mode must not lock their previously deposited
cash or grant cross trading authority.

Keep bounded source qualification at activation and resume; reset held funding so
no custody/frozen interval is charged. Registration and authority pause/surplus
classification work in unfrozen isolated mode; frozen default blocks them. A pause
does not block credible insolvency or qualified emergency default. Existing T
moves to I only via an explicit authority instruction. Actual SPL donations plus
surplus classification remain the insurance funding route. Permissionless order
cleanup requires a real state/reserve change; other order changes retain owner
authority. None of these choices supersedes fees, positive-unpaid-credit exclusion,
complete-group loss ownership or external P15B/P16B gates. See
[P18C](P18C-GROUP-SAFETY.md). [A23C/G14](evidence/P18C.md) is verified on
`b43261f` for the explicit isolated local profile. This grants no cross or
default/devnet activation and does not close P15B/P16B.

## D51 — whole-account core and explicit delegated authority (P19 / G15 core)

Implement P17's complete two-slot funding/health/reservations using the existing
root layout and accounting engine. Authenticate both canonical group market
dependencies; price availability is required only for relevant exposure/authority
and the selected operation. Explicit transfer admits the donor after refreshed
reserves and accrues both recipient slots without granting recipient trading rights.
Flat-only opposite-claim cancellation preserves exact fractions and all cash pools;
owner/group/active-order checks belong to clearing, not the arithmetic helper.

Per-root delegate grants use exclusive expiry bounded by the existing 216,000-slot
order lifetime. Every owner change/revocation advances both delegate epoch and
route nonce, so revoking and regranting the same key cannot revive an old signed
immediate intent. Owner orders use epoch zero; delegated orders require the live
grant epoch. No cash allocation/netting/maker-config authority is delegated.
Historical protection allowance with no live child is inactive; no stored stale
field can revive an order on another market or generation.

These are ordinary realizations of D46–D48, not new collateral or fee economics.
[P19](P19-CROSS-CORE.md) has [A24/G15 core acceptance](evidence/P19.md) on `4274d28`. Cross
activation remains false until P20's actual liquidation/default checks. The phase
does not authorize any new deployment outside the fresh local test profile.

D51 authority realization deliberately supersedes D50's temporary no-delegate
restriction on dormant cross cash roots. A grant does not permit cross exposure,
claims or orders while activation is false, and it cannot lock an otherwise valid
owner cash exit. Allow owner grants/revocation in qualified unfrozen financial
mode, including while paused; reject custody and frozen resolution mutation.
Owner replacement reauthorizes an order at epoch zero; a delegate replacement
adopts the live grant epoch so its edits cannot survive revocation as owner authority.

D51 funding realization: whole-account mutations materialize both canonical market
funding prefixes at one Clock snapshot, even when only BTC exposure changes. A
read-only ETH endpoint applied to a root could otherwise be forgotten after the
hold expires and later reverse that previously applied debit. This requires both
market write locks for whole-account instructions; measure that contention in
P20/P21. Existing single-market isolated entrypoints retain their footprint. P17
G02's no-write wording describes pending-funding valuation, not a permission to
omit an authoritative prefix when committing a whole-account mutation. Require
Normal for every relevant market on increases and credible bounds for reductions;
empty unrelated slots need no fresh price. No oracle deadline is relaxed.


## D52 — whole-account safety realization (P20)

Extend the existing consenting-receiver liquidation candidate to both root modes,
including all pending funding and surviving receiver reservations. Preserve
credible-bound liquidation in degraded mode and the strict post-fee whole-account
MM-deficit decrease. Target risk orders cancelled atomically by the liquidation
cannot make an otherwise empty market a required price input; target exposure and
all remaining receiver authority still require credible bounds. No fee, margin,
source deadline or default loss ownership changes. Runtime cross liquidation keeps
the same explicit release gate while pure candidates are verified.

[P20](P20-CROSS-SAFETY.md) owns complete-group net default, missing-price recovery,
full endpoint certification and signed qualification before cross release. P19
acceptance does not close these checks. P15B/P16B remain Open and D42 remains Deferred.

D52 candidate verification: the ordinary cross release constant remains false.
A separately named `cross-safety-qualification` local build executes the actual
safety instructions solely in the bounded P20 harness before release promotion;
default, devnet and ordinary successor artifacts retain their rejection boundary.
Do not cite candidate build/host checks as signed A25 acceptance. No unsafe profile
is added to a general runtime launcher. The existing local/devnet feature exclusion
also rejects combining the candidate with devnet.

D52 activation/recovery realization: explicit authority promotion from isolated to
cross mode requires both markets Normal and complete current certification. Keep
already-earned funding and materialize both prefixes; do not reuse custody's
funding reset. Resolved groups return to isolated mode, and require fresh Normal
observations/certification and authority promotion before cross resumes. Recovery
never changes a root's immutable margin mode. The funding-endpoint certificate
must cover mode 2 and all adverse mixed corners. No layout migration is required.

D52 transaction envelope: the maximum four-order cross book makes an atomic
owner transfer plus two-maker route exceed the 20% headroom threshold under the
standalone 600,000-CU budget. Give that combined path an explicit 700,000-CU SDK
budget. Preserve 600,000 for standalone routes and 1,200,000 for source sampling
and default pages. This changes a client resource declaration, not fees, margin,
source safeguards or bounded account/order capacity. Final actual RPC measurements
and qualification status belong in WORKLOG/evidence.

D52 qualified release supersedes its temporary candidate-only wording above:
[A25/G15](evidence/P20.md) passes on pinned core and focused maximum-book runs.
`CROSS_TRADING_IMPLEMENTED` now reflects the explicit
`cross-safety-qualification` feature; retain the historical name for reproducibility.
The ordinary isolated successor, default and devnet profiles keep cross disabled.
This preserves the existing isolated environment while P21 explicitly selects the
qualified cross artifact for new local groups. Rebuilding the release marker with
preserved code locations produces byte-identical clearing artifacts in all three
profiles; no financial opcode changes accompany this promotion. Six scoped host
identity/profile checks pass. This qualifies local engineering only, not P21,
M7 completion or any external/funded gate.

## D53 — versioned successor service boundary (P21A)

Reuse the append-only PostgreSQL journal and finalized recovery machinery through
an explicit protocol projection adapter. SQL journal schema 1 remains compatible;
immutable `binding.schema=2` selects the fresh group contract and rejects V1 access
to that run. Group events use one global sequence across both markets. Reconcile
every projected account and exact frozen ledger before checkpoint advance; include
the group in every bounded RPC account chunk to detect intervening mutations.

Expose `/v2` group/portfolio/root/history reads, with finalized projection identity
and separate on-chain Clock context for pending funding/reservation previews. Cash
is counted once per margin account; neither positive unpaid open claims nor a
portfolio-wide aggregate grants risk credit. Local cash headroom is not permission
to withdraw: require complete-group certification and actual simulation. This is
an interface choice, not a change to financial/on-chain authority or economics.
P21A's direct clients, immutable worker budgets/recovery and complete fresh
qualification remain required before Review; prior P20/P16A evidence is not a
substitute. P15B/P16B stay Open and D42 stays Deferred.

D53 group execution realization: keep the existing immutable queue and 16-attempt
operator ceiling. Extend expiry proofs with explicit V2 schema/group identity and
separate account nonce, group sequence and market maker-epoch stamps. Incomplete
history never releases an unknown fee reservation. Group wallet ingress admits
only a reviewed single action or the explicit transfer/route pair under P20's
measured compute declarations. Per-market maker/funding heartbeat and SOL budget
identities are separate; the fixed local caps in P21A-INTERFACES fund infrastructure
only and do not alter collateral, fee economics or external authorization. Actual
process recovery and full service qualification remain evidence gates.

D53 direct-client realization: share V1's immutable message/signature/fee recovery
transport while binding schema-2 snapshots to the configured group and exact
initialization transaction hash. Repeat group bytes across bounded account requests
and reject mixed snapshots. Keep complete-group certificate pages separate from
cash mutations because Solana promotes writability across a transaction. Preserve
stale-source cancellation and already-authorized flat-cohort exits without changing
source deadlines, funding, reservations or owner authority. Direct SDK checkpoints
do not close A26A's financial workers or A26B's UI/contention gates.

D53 market-worker realization: use four distinct maker liveness identities and two
funding budgets even when internal operator keys are shared across markets. Bind
actual config, isolated capital and approved ProgramData independently of daemon
liveness. Owner publication/sync never grants approval authority. Continue signed
source sampling during stale/unavailable inputs so clearing records restrictive
modes; retaining its original cadence and freshness checks is mandatory. This adds
service discovery only, not new economics or an external-maker claim.

D53 quote realization: retain the fixed A/B search and pricing strategies, replacing
only its explicitly selected group admission callback with full-root funding,
negative-claim equity and remaining reservations. Match a pending confirmed oracle
sample to its exact group/market snapshot before using it for quote availability;
queue effects/fees still require original-signature finality. Direct SDK messages
bind both observations and group sequence and sign exact reviewed fee/all-in bounds.
Client candidate tests do not replace new signed A26A financial integration evidence.


D53 ordinary-settlement realization: use a separate group-wide fee budget and
confirmed snapshots for unsigned claim/proof preparation, retaining finalized
original-signature effects and fees. Whole-atom collection/payment preserves
fractions, full-root funding/reservations and owner-only closed netting. Canonical
read-only certificate pages remain separate from cash mutations; all funding
corners and complete-group authority stay on chain. Busy global sequences may
invalidate progress; no sampler cadence or freshness relaxation is authorized.


D53 risk-worker realization: ordinary bankruptcy candidates authenticate current
source accounts through actual program simulation, including under pause; bounded
discovery never turns conservative risk equity into a default proof. Receivers
are explicit owned funded non-maker accounts. Frozen work uses canonical complete
registry pages, durable originals and existing budgets; automatic emergency freeze,
resume and cross reactivation remain unavailable. One-second discovery, two default
probes per iteration and bounded 64-lot liquidation search are local operational
choices to measure in P21, not financial guarantees. Guard-only proof transactions
have no group-sequence nonexecution inference because they do not advance it.


D53 maker-publication correction: supersede the R044 combined publication/sync
service envelope. Actual P21A expiry execution rejects it because publishing
promotes config writability while clearing requires that account read-only. Use
two separately persisted original transactions, publication then finalized owner
sync; an intermediate unsynchronized maker stays unavailable. Publication cannot
use the unchanged registration epoch to infer nonexecution. No program/read-only
CPI, approval, risk or source safeguard changes.


D53 artifact binding: name the exact P20-qualified four-program test deployment as
`p20-qualified-local-v1`; pin code hashes/lengths, canonical loader identity, zero
padding and the local group authority as upgrade authority. Live SDK, execution
and indexing reject unqualified code and older unbound execution journals. Cache
full bytes only after a strictly later finalized context, rechecking current
headers/authority/allocated size and context on every use; unfinalized or same-slot
changes must be rehashed. No binary/profile, V1 history, source or economic rule
changes, and no new deployment authority is granted.

D53 A26A verification: [P21A evidence](evidence/P21A.md) records fresh incremental
SDK/service/RPC/WS/PostgreSQL acceptance through `882f832`, with corrected raw-byte
auditor `ac828f6`. The full 64-member risk run and separate missing-price recovery
qualify these interfaces, not UI, busy-group availability or M7 completion. P21B
retains those gates; P15B/P16B and D42 are unchanged.


D53 review recovery clarification (R052): strictly newer authenticated finalized
sequences permit at most three tail extensions before reconciliation/commit;
the cumulative history bound still applies. Older sequences, missing events or
financial mismatches cannot advance a checkpoint. Apply this scanner rule to
both versioned adapters. Funding expiry authority is the selected market's
observation sequence, superseding group sequence for newly signed funding intents.
Samples increment both counters; unrelated group writes cannot obscure an
unchanged market stamp. Original bytes/authority remain immutable and unknown
fees remain reserved even after proven economic nonexecution. Existing broader
stamps are not rewritten. No risk, oracle cadence, financial or fee rule changes.

## D54 — successor wallet presentation and qualification boundary (P21B)

Select the explicit schema-2 local deployment in the existing trader shell.
Portfolio zero presents owner trader accounts with immutable modes/markets and
explicit allocation. Empty portfolio discovery authenticates its canonical PDA;
wallet collateral reads authenticate classic token owner/mint/layout. No pooled
portfolio risk, live conversion or new signing authority is added. SDK-rebuilt
messages, scoped reviews and saved original bytes remain mandatory. Recent
finalized history adds bounded latest ordering alongside unchanged cursor reads.

[P21B](P21B-QUALIFICATION.md) separates actual sequential browser acceptance from
the required 300-second/0.5-offer-per-second concurrent qualification, complete
outcome populations and independent reconciliation. No inherited P16A/P21A result
closes those checks; external gates and deferred endurance are unchanged.

D54 browser realization: preserve the program's distinct ordinary-order generation
zero and live reduction generation, immutable replacement fields and charged fee
prefixes. Validate persistent limit/trigger bounds in each market's UI units before
review; do not loosen the program or source policy to accept malformed inputs.

D54 history realization: order on the underlying numeric event sequence, then
serialize it as a decimal string. A textual SELECT alias must not turn cursor or
latest history into lexicographic order. Certification/withdrawal stay on direct
RPC; service ingress authority is unchanged by the workload harness correction.

D54 qualification limits: confirmed state supplies provisional unsigned reviews;
displayed balances stay finalized. R051 measures certificate invalidation under
continuous group updates (0/3 exits) and actual quiescent exits (3/3). Preserve the
read-only proof-page contract and all source/sequence guards; document an explicit
maintenance window for this bounded test profile. A live exit-availability redesign
is separately scoped future work, not a stronger claim from A26B or a funded gate
waiver. The independent audit canonically orders decimal event sequences and rejects
missing/duplicate entries; no accepted financial event is discarded to improve metrics.


D54 receipt concurrency clarification (R052): saved receipt memory advances only
at explicit save/reload/clear writes, synchronously with the queued presentation
update. React renders cannot roll it back to an older presentation state. Polling
merges against the latest written list; storage must still succeed before broadcast.
This preserves immutable originals through concurrent rendering without changing
wallet authority or treating client fixtures as financial acceptance.


## D55 — successor integration and deferred exit follow-up (R053)

On 26 October 2026 the user explicitly authorizes reviewing and merging the whole
open successor stack, superseding the earlier instruction to keep it open. This
covers ready PRs #23/#24/#26/#27/#28/#29/#30/#31 after addressing actionable reviews
and checking their existing acceptance/CI; D44 concerned the earlier #20/#21 stack.
The user explicitly postpones the atomic check/withdrawal and busy-group exit
redesign discussed after R052. D54's measured limitation stays visible: bounded
local integration is not evidence of continuously available exits or funded safety.
No source/risk/authority safeguard is relaxed, no new financial path is enabled,
and P15B/P16B remain separate external gates. D42's 24-hour deferral is unchanged.
WORKLOG records actual merge hashes and status; this is authorization/scope, not
new runtime or independent-review evidence.

## D56 — account-centric clearing direction and gated contract (P22–P28)

On 26 October 2026 the user approves separating account risk, market eligibility,
funded cash exits and settlement/default responsibilities, and requests diagrams,
PR-sized phases and a durable design document. Add M8/P22–P28 under
[P22's roadmap](P22-ACCOUNT-CENTRIC-CLEARING.md). P22A records that direction and
P22B resolves exact economics, state transitions, layouts/authority, dependency
proofs, independent expected cases and deployment/versioning before implementation.
This small split prevents a planning document from being called a finished contract.

This supersedes D55's deferral of busy-group exit work for the newly scoped local
redesign, and the prior prohibition on reopening these specific architecture
boundaries. It does not erase D54/R053's measured limitations or supersede existing
V1/V2 economics. The target replaces fixed account/group market bundles with
explicit market eligibility and separates ordinary funded exits from broad group
certificate invalidation where a complete account/custody/safety proof permits it.

Market-attributed loss/default handling is an option to evaluate, not a claim that
isolated profits become guaranteed. G17 must resolve cash/pool/insurance ownership,
shared-debtor allocation, cross-market closed-claim netting/cycles, payment timing
and freeze scope. Material changes to loss bearers, credit guarantees or margin
economics require a concrete recorded product decision before implementing them.
No invisible cross-market receivable may become cash; no keeper selects a convenient
haircut subset. Preserve current fees/routing/TP-SL, one test mint/two markets,
isolated maker capital, zero positive unpaid credit and source/risk safeguards.

Use a fresh versioned local profile and preserve V1/V2 bytes/deployments. No live
conversion or automatic migration of positions, claims or reserves. New financial
activation stays disabled until P26 liquidation/default acceptance; P27/P28 own
fresh services and bounded concurrent exit qualification. P15B/P16B remain external
and D42 endurance stays Deferred. No funded deployment, outreach, paid service or
external hedging authorization follows. Phoenix documentation/reconstruction is
comparative reference, not implementation evidence or a substitute financial spec.

Ready-to-review PRs remain stacked with verified predecessors; retain the new stack
open pending review/merge direction. WORKLOG records actual publication/integration,
not this authorization. Existing acceptance IDs/hashes are not reused as new tests.

### D56 execution checkpoint — P22B financial decision

The user explicitly approves proceeding through the roadmap with each phase
stacked above its predecessor. P22B starts above PR #32's `64615a4`; no routine
phase-start confirmation is needed. The [developing contract](P22B-FINANCIAL-CONTRACT.md)
provides a separate funded-exit proof and independently checked loss/netting cases.
It recommends market-attributed losses, but has not selected that new loss policy:
the concrete example pays BTC/ETH winners 100/0 instead of V2's common 50/50.
G17 therefore retains a material product decision before changed loss ownership
or its dependent layouts/implementation. The common alternative would leave the
isolated unpaid-profit contagion concern unchanged; do not quietly select it as
an implementation convenience. No new production code or activation is implied.

## D57 — selected market-attributed losses and insurance assessment (P22B)

On 26 October 2026 the user explicitly selects option 2, market-attributed losses,
after the concrete common-versus-market comparison, then asks how insurance exists,
is funded and connects to that model. This resolves B04 and supersedes D56's pending
product choice. It authorizes the harder accounting work, not an implicit return
to the common haircut because implementation would be simpler.

For the fresh profile, attribute settlement/insurance backing and creditor losses
by market. P22B example B must yield BTC 100 / ETH 0 instead of the existing common
50 / 50. Shared cross debtors and explicit netting obligations can still transmit
losses; no unconditional isolated-profit guarantee is selected. Finish G17's exact
allocation, cycles, fractions, payment priority, safety/freeze scope and layouts
before P23. D47's common account-net settlement/default is deliberately superseded
only for this future profile's selected direction; existing V1/V2 bytes, balances,
deployments and normative contracts remain unchanged.

The code assessment in [P22B section 7](P22B-FINANCIAL-CONTRACT.md) verifies existing
insurance seeding/surplus classification and explicit fee allocation. All collected
2 bps taker fees still initially enter T; no automatic split or reserve size is
selected. Seed capital plus fee replenishment is a recommendation, not approval
to fund a reserve. Continue engineering with explicit authorized allocation; no
missing automatic percentage blocks that work. Market attribution must prevent
double-counting or silently spending another market's dedicated insurance. G17
still owns exact reserve authority and transitions.

The supplied Quicknode teaching model and pinned Percolator sources are targeted
references, not imported economic authority, deployed-code verification or Rivalt
test evidence. Do not adopt their pooled LP loss bearer, realizable positive-P&L
credit, fee parameters or insurance-funded ordinary payouts. Current routing,
2 bps/zero-provider fees, maker isolation and zero positive unpaid margin credit
remain. P15B/P16B stay Open, endurance Deferred and new-profile financial activation
disabled until the designated P26 acceptance. Keep the new PR stack open.

## D58 — approved reserve funding and 25% fee allocation (P22B)

On 26 October 2026 the user approves the market-attributed insurance model and
seed-capital-plus-fee replenishment, then explicitly selects 25% of collected fees
for insurance. This supersedes D57's unselected-percentage checkpoint for the
fresh P22–P28 profile. Existing V1/V2 accounting/deployments remain unchanged.

Keep the total taker fee at 2 bps and provider fee at zero. Allocate 25% of the
actual collected taker fee to that market's I and retain 75% in its T, with exact
whole-atom cumulative rounding. This is allocation of an existing fee, not an
additional charge or positive unpaid-profit credit. The rate is fixed at 2500/10000
in the fresh profile; changing it requires a later recorded policy/version.

[P22B section 7](P22B-FINANCIAL-CONTRACT.md) specifies the modulo-four per-market
carry, separate original fee assessment, cash invariants, authority boundaries,
reserve exhaustion and owning phase checks. No per-fill floor that starves
insurance on small fees, no reset on account/order churn or reserve consumption,
and no carry shared between markets. Actual seed capital and optional extra
authorized T-to-I allocation remain separate from automatic fee contributions.

G17 still owes the general netting/default/fraction contract, exact layouts and
terminal recovery rules. The independent reserve reference is specification
evidence only. No new profile is enabled, seed amount chosen or real capital
transfer/deployment authorized. P15B/P16B stay external; endurance stays Deferred.

## D59 — complete-cohort clearing and whole-atom output references (P22B)

Continue the selected D57/D58 direction with an independent two-market clearing
benchmark that retains mixed-sign accounts and all cyclic obligations. Own cash
services proportional market debts; recovered positive claims service the same
account's remaining debt before payout. Market insurance only covers its actual
residual and cannot be spent twice or drawn merely to fund a circular setoff.
Complete market creditors share the exact recovery fraction, with corresponding
debtor writeoffs. These are terminal reference semantics, not positive unpaid
margin credit or an implemented normal netting instruction.

[P22B's clearing reference](P22B-CLEARING-REFERENCE.md) uses the greatest exact
fixed point, enumerated from two piecewise-affine response curves. A closed cashless
cycle cancels without insurance; external creditors remain in the equations.
Literal/closed-form cases and conservation assertions supply model evidence only.

The raw reference can produce fractional C/I even from integer inputs. A separate
whole-atom output candidate collects only whole own cash, floors fractional reserve
capacity with at most two market clips, and uses deterministic constrained flow
rounding. Per-market rounding sums remain zero; no unrelated market supplies a
rounding atom, and cash retained after whole debt collection stays protected.
Each account's final rounding error is below one atom relative to the final
whole-collection/clipped-capacity reference, not the unrestricted ideal. Every
fractional adjustment is attributed; no keeper selects rounding beneficiaries.

This prospective refinement of D19's single-pool allocation uses remainder-priority
paths and stable IDs subject to all market/account conservation constraints. It is
not a change to current V1/V2 rounding. The new reference still uses arbitrary-size
rationals: do not call it an executable financial contract or close A27B/G17 until
bounded numeric representation, source/stage/recovery authority, normal payment/
netting and layout obligations are satisfied. Disabled new-profile activation and
all fee/risk/external gates remain unchanged.

## D60 — complete schema-3 financial contract and bounded verification (P22B)

27 October 2026. Complete G17's contract in
[P22B-EXECUTABLE-CONTRACT](P22B-EXECUTABLE-CONTRACT.md). D57 market attribution and
D58's 25% fee insurance remain unchanged. Independent models and inert layouts are
specification evidence; phase acceptance and runtime activation are separate.

For schema 3 only, supersede D47's group-bound identity/common pools/account-net
waterfall/unfunded closed-claim cancellation and D51/D53's universal group validity/
funded-exit certificate. Venue eligibility, account risk, market P/I/T and safety
are separate. Ordinary funded exit checks that account atomically; normal profit
payment still requires a complete scoped backing certificate. Flat cross netting
moves actually funded source P to destination P in whole atoms; unpaid claims and
fractions remain when backing is absent. Underfunded shared debtors cannot pay a
keeper-selected market first. Complete exceptional clearing still owns cashless
cycles. No implicit inter-market loan, positive unpaid margin credit or profit
guarantee is added. Preserve V1/V2 and their historical evidence.

D59's exact terminal economics have a bounded representation: at most 64 proportional
collection factors yield a shared denominator below 2^5632; the specified schedule's
intermediates stay below 2^6016 in 96 checked u64 limbs. A keeper proposes two rates;
complete on-chain equations plus a right-slope test establish the greatest fixed
point, rejecting smaller circular solutions. Verify prescribed insurance clipping,
then deterministic conserving atom rounding. Exact writeoffs can remain factored;
no fractional entitlement is silently truncated. This replaces arbitrary-precision
internals as the executable contract, not as a claim of measured SBF cost.

Freeze remains complete-venue operationally while losses are market-attributed.
In addition to net bankruptcy/source emergency, a fully flat account with unfunded
gross closed obligations may trigger complete clearing; mere exposed negative risk
equity is not bankruptcy. Recovery requires full discharge/reconciliation, authority
and qualified sources; normal trading resumes only through the qualified profile.
Insurance has no live withdrawal. Irreversible liability-free retirement permits
reserve-authority transfer to its immutable designated owner, without harming C/T.

Exact version-3 layouts, PDA seeds, bounds, roles, dependency/invalidation matrix,
stages, finite continuation, old-withdraw/new-deposit migration and phase-owned
acceptance are pinned in the contract. P23 custody, P24/P25 harness execution and
P26 safety activation retain distinct gates. P27/P28 require fresh actual services/
UI qualification. Keep the stack open; P15B/P16B and deferred endurance are unchanged.

## D61 — schema-3 custody realization and unchanged wire storage (P23)

Implement D60's initial custody under an explicit `account-test-profile`, mutually
exclusive with devnet. Venue initialization pins separate fee/reserve authorities
and reserve destination; registry initialization is a separate bounded instruction.
BTC/ETH admission fixes both markets cross-eligible but supplies no trading authority.
Register immutable roots, use actual SPL deposits/withdrawals and same-owner cash
allocations, seed one market's insurance with donor plus reserve authority, and
classify actual surplus once into an explicit attributed reserve. No active reserve
withdrawal or other unfinished financial instruction is exposed.

The 11 new instructions and `AccountCustodyChangedV3` event are additive; existing
V1/V2 IDL definitions remain identical. D60 wire layouts remain unchanged after
moving each 96-limb array into fixed-size heap ownership: the first actual SBF
build rejected generated resolution stack frames, and a Box preserves the exact
768-byte wire record while avoiding those oversized frames. This is representation
hardening, not P26 arithmetic/resource qualification. P23's actual G18 results,
profile rejection and packet/CU headroom must pass before Review.


## D62 — schema-3 trading candidates and scoped authority (P24)

Implement D60's risk/funding/order/routing contract in the explicit local
`account-trading-qualification` artifact. This does not change
`v3::TRADING_IMPLEMENTED = false`, enable the default/devnet/custody builds, or
satisfy P26 safety. The qualification transition requires the existing authenticated
source recovery and resets pre-activation funding. No admin bypass is introduced.

Schema-3 immediate and stored executions bind account nonce/state, safety and venue
terms plus market terms/config, maker authority/quote epochs and each selected
side's consumed quantity. Routine observation/event-sequence changes are not
signed prerequisites; the landed complete relevant risk dependencies are checked
again. Separate venue-bound maker envelopes reuse the unchanged reference curves.
Whole-account funding, conservative reservations and shared existing-position
TP/SL continue through the same pure financial/order engine. V1/V2 account handlers
and wire contracts remain separate. Cancel/revoke can release authority while
paused; frozen ownership remains immutable.

Apply D58's per-market 25% I / 75% T allocation once after the existing cumulative
2 bps taker fee. Emit gross fee, I/T credits and carry before/after. Borrowed event
views avoid copying fixed account snapshots on SBF's non-reclaiming bump heap;
exact IDL serialization parity is checked. Nested context validation and separated
event construction address observed stack limits. Maker release compilation uses
size optimization (`opt-level = "z"`) with checked arithmetic/fat LTO retained,
because every route still authenticates complete ProgramData bytes. Do not replace
that hash with a cached slot or weaken risk rules to meet a compute target.

The provisional 600,000 route CU / 20% headroom / 1,232-byte packet limits remain
in force, including full books on the trader and both maker roots. Current scoped
checks and limitations belong to WORKLOG; no acceptance follows just from these
implementation choices. P25 cash/claims/exits, P26 safety, P27 services and P28
qualification remain separate gates, as do P15B/P16B and deferred endurance.


## D63 — schema-3 funded exits and scoped payment certificates (P25)

Implement D60 in the separate `account-cash-qualification` artifact. Account-local
cash withdrawal/transfer reuses current full IM/reservation admission and adds all
held-funding corner solvency checks before the atomic actual token/cash movement.
No global solvency certificate or historical event/sample ID is a funded-exit
argument. Complete canonical source/funding/root/safety checks remain mandatory.

Normal gain payment and explicit flat-only netting continue to require actual
market P and a complete selected-market backing certificate. Its bounded canonical
scan checks each selected debtor's own gross obligations across both markets, with
no positive-claim or insurance credit. Liability invalidation follows economic
exposure/claim dependencies; irrelevant market-only accounts do not create a common
profit-payment veto. The [P25 contract](P25-ACCOUNT-CASH.md) specifies retained
certificate fields and the acceptance scope. No new loss bearer, queue, funded
profit guarantee or old-profile behavior is introduced. Ordinary activation still
requires P26, with P15B/P16B and deferred endurance unchanged.

D63 implementation clarification: flat netting excludes live refreshed orders,
including TP/SL. Cancelled/invalidated protection records are historical and do
not carry standalone executable authority; a nonzero historical allowance cannot
permanently prevent settlement. Active identity admission invalidates membership
certificates, and actual deposits/reserve donations remain source-independent.
No active insurance withdrawal is introduced.

## D64 — bounded implementation of D60 safety (P26)

Implement the existing 96-limb complete-clearing contract with caller-owned scratch
buffers and bounded continuation work. The [P26 sequence](P26-ACCOUNT-SAFETY.md)
preserves the exact greatest-rate, insurance-clipping, market-conserving rounding
and whole-account liquidation requirements. A passing primitive or host model is
not activation authority; keep new ordinary trading disabled until full A31/G20
program/RPC acceptance. This selects an allocation discipline, not a new financial
policy or relaxation of the frozen cohort. P15B/P16B remain external gates.

D64 implementation continuation: the existing fixed work layout now names its
flow-plan/rounding registers and verifies untrusted complete remainder permutations
before deterministic DFS. Exact arithmetic skips provably zero work after a measured
FlowPlan CU overrun; no financial equation, insurance use, safety limit, heap or CU
ceiling changes. The [P26 contract](P26-ACCOUNT-SAFETY.md) records these details.
Participant application/recovery and maximum-width/RPC acceptance remain required.

D64 application continuation: partial Apply uses the original frozen aggregate
ledger plus explicit remaining/applied rows. Participant bytes cannot become
spendable until complete application and a separate full reconciliation. Debit
planned market insurance once, retain fee/carry ownership, clear old authority,
and preserve the forbidden zero slot of isolated roots. Resolved/Retired own-cash
withdrawal has no new source/funding dependency. This realizes D60's existing
terminal accounting; recovery/retirement and full acceptance remain outstanding.


D64 recovery/retirement continuation: implement sustained source observations,
authority-only Resolved→Custody and separately qualified candidate activation,
retaining earned F, fee carry and historical root generations. Historical nonces/
generations cannot block otherwise liability-free custody cash access. Add an
80-byte schema-3 retirement certificate for the already-required complete flat
scan; bind its safety/membership/global mutation stamps, with exact restart rules.
That global administrative proof never gates ordinary owner withdrawals. Retirement
is irreversible; only afterward may the distinct reserve authority withdraw I to
the immutable destination owner's canonical classic SPL ATA. C/T remain backed.
Existing layouts, V1/V2, economic loss ownership and ordinary activation gating
are unchanged. Full P26 maximum-cohort/resource/RPC acceptance remains required.


D64 measured resource amendment: two 5,592-bit row-flow calculations consume
1,011,805 CU in an isolated arithmetic SBF fixture, before clearing context costs.
Supersede the initial universal one/two-row instruction envelope: Verify/FlowPlan
now process one row, and complete rate/insurance equations run in a separate exact
continuation at Verify/count. Two-row storage and other stages remain unchanged.
Keep 1.2M CU, 32 KiB heap, 20% headroom, exact financial equations and complete
membership. The fixture is pure resource evidence, not a fabricated financial
state or whole-venue acceptance. Full-context phase acceptance still gates activation.

D64 qualified activation continuation: the pinned candidate safety matrix covers
complete 64-root default, both-market funding/liquidation, reciprocal claim cycles,
source emergency, recovery/retirement, default-artifact rejection and the unchanged
wide resource envelope. Add authority-only `activate_accounts_v3` under the retained
`account-safety-qualification` feature. Require all 32 canonical pages precreated,
idle zero-epoch resolution storage, no prior resolution, fresh Normal sources/makers
and the existing initial zero-exposure/funding/pool/fee conditions. The earlier
candidate activation entrypoint rejects in this profile; recovered venues use
separate recovery/reactivation. This supersedes candidate-only activation wording
for the explicitly selected local artifact, subject to its final pinned activation
verification in WORKLOG. Default/devnet remain disabled; no fee, claim, loss-bearer,
source-risk or old-profile economics change. P27/P28 and external P15B/P16B remain
separate gates.


## D65 — schema-3 service reconstruction boundary (P27)

Reuse the immutable PostgreSQL journal/transport with a separate schema-3 binding,
qualified local artifact set and financial projection. Authenticate all critical
CPI schemas and reconcile canonical accounts at one custody discovery sequence.
Partial Apply retains the frozen aggregate buckets plus original/applied root
partitions until the completion event adopts new C/P/I. Preserve per-market claims
and fee carry. Solver scratch is continuation state; it is not spendable cash or
an off-chain-authorized payout. Ordinary SDK intents do not acquire a global event
sequence prerequisite or an exit certificate. This implements D56/D60/D64 without
changing economics, authority or V1/V2. A32 and P28 still require their own evidence.


D65 direct-SDK continuation: ordinary account actions read one/two selected roots
and their immutable portfolios, then a single coherent financial RPC batch. Use
root-local guards rather than the custody discovery sequence; no venue-wide scan
is introduced for own-cash exit/allocation. Explicit closed-claim netting retains
its market backing certificate. Existing on-chain funding/risk/held-window checks
and wallet original-signature recovery remain authoritative. This changes no
financial rule or previously qualified artifact.


D65 implementation clarification (R068): shared SDK financial arithmetic does not
merge schema-2 group authority with schema-3 account authority. Ordinary V3 cash
reads remain selected-root only; trade reads add the selected market's authenticated
maker dependencies in the same final financial batch. Indicative cash headroom
includes all mixed held-funding corners, and is explicitly not withdrawal
permission. This changes interfaces only; D60–D64 on-chain economics and authority
remain unchanged.


D65 implementation clarification (R069): the schema-3 service rate proposer is
untrusted and reads complete current frozen chain pages. It emits only candidate
rate bytes for the current evaluation; on-chain verification/clipping/rounding
remain the financial authority under D64. Test reference processes and retained
acceptance captures are not runtime dependencies. No economic decision changes.


D65 implementation clarification (R070): schema-3 durable retry proofs use only
canonical monotone action-relevant account stamps after finalized blockhash expiry.
An unchanged stamp cannot release fees for an unseen failed transaction. Wallet
ingress keeps the currently measured one-action SDK envelope and explicit zero
priority price; operator budgets remain separate test lamports. This extends
interfaces without changing chain authority, routing economics or risk rules.


D65 worker clarification (R071): V3 funding samples are not a quote barrier; current
source/whole-account checks govern the signed account intent. Settlement workers
never auto-net closed claims. Default continuation follows authenticated current
chain cursors and untrusted exact proposals, with no new loss/risk authority.
Consenting liquidation receivers and explicit operator lamport budgets remain
required; automatic emergency freeze or authority recovery is excluded.

D65 reconstruction correction (R071): completion-event fee carries are decoded
from their journal hex-byte representation, preserving the existing on-chain
modulo-four values. Unexpected intermediate reconciliation failures invalidate
service qualification even if a later full event snapshot restores final parity.
No financial policy or program artifact changes.


## D66 — account UI and bounded concurrent acceptance (P28)

Expose owner portfolios and immutable isolated/cross accounts without a technical
settlement-group selector. Discover bounded owner children independently of
selected-root financial snapshots. Show funded cash, unpaid claims, funding and
market insurance separately; indicative headroom is not withdrawal permission.
Reuse original wallet receipts and direct RPC cancellation/exits. The P28 contract
pins a fresh five-minute population and six busy exits before execution, alongside
browser and complete recovery/replay checks. No economics, source safeguards,
program artifact, V1/V2 authority, external gates or endurance decision changes.

D66 qualification clarification: classify live maker expiry/unsynchronized renewal
separately from offline/admission and capacity/health refusals. The first load
attempt exposed driver finality backpressure and a real renewal at closeout.
Before rerun, count missed driver slots explicitly within the original five-minute
window and retain separate bounded closeout attempts. This changes observation
and harness timing, never trading, oracle, loss ownership or authority rules.

D66 history recovery clarification: fresh concurrent qualification observes a
repeated pagination signature and a transient missing critical sequence during
multi-request finalized reads. Discard the entire uncommitted candidate and allow
at most two full rescans from the durable checkpoint. Each rescan retains its
original transaction/page limits and must authenticate/decode/reconcile all state
before committing. Persistent pagination/gaps still fail closed; duplicated
critical sequences, chain identity, unknown schemas, older state and economic
mismatches do not gain this retry exception. Count restarts separately from
sequence-ahead tail extensions. This shared transport correction applies to V1/V2
consumers too, without changing their accounting, authority or readiness rules.


## D67 — authorized M8 stack review and integration

The user authorizes addressing all open P22–P28 review findings and merging the
complete stack; this supersedes the earlier keep-open instruction. Preserve the
phase-specific qualification pins and integrate the coherent final tree atomically
with `gh stack`, after scoped remediation checks and actual hosted checks. A finding
already corrected in a descendant is resolved against that descendant, without
claiming the earlier phase head contained its later implementation.

R073 binds liquidation nonexecution proof to the signed consenting receiver’s
monotone state version under the existing D65 finalized-expiry rules. Unknown
history never refunds a transaction fee; permissionless resolution work gets no
invented proof. Owner UI discovery retains operator slots for cash visibility with
role-labelled trader restrictions, and V3 latest/cursor exclusivity matches the
existing read contract. These are service/UI corrections, not new financial rules,
authority, program binaries or deployment qualification. P15B/P16B remain external;
continuous 24-hour endurance remains Deferred.


D67 integration result (R073): all eight phase PRs merge atomically at `0916b9d`,
with a tree identical to reviewed/remediated `e6ba2cf`. Scoped local and hosted
checks pass, all inline findings are resolved, and the independent PR metadata
confirms integration. This closes P22–P28/M8 only within their qualified local scope;
it does not close external gates or authorize a funded deployment/endurance run.
