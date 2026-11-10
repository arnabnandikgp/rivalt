# Architecture constraint audit

Reviewed 10 November 2026 against **`2a77c2419a6b80acf452a8604ba0fe904d3f35ff`**,
the accepted P49 stack tip. This is a source/provenance review and proposed work,
not authorization to alter risk or economics. Component contracts remain normative.
No new runtime measurements or financial tests are claimed by this audit.

The recurring issue is that engineering profile values, arithmetic safety bounds,
product limits and operational budgets are often encoded as the same kind of
constant. Several original decisions explicitly called them fixtures. Changing
4,096/4,608 exposed this distinction; removing every other bound would be unsafe.

## Highest-priority findings

### 1. The venue has 64 lifetime margin-account slots

`MAX_MEMBERS=64` includes traders, makers and liquidation receivers. Registration
appends a stable ID and increments membership; there is no member removal/reuse
instruction. Six configured maker capitals leave 58 slots for everybody else,
before receivers. A zero-cash account consumes a slot: there is no deposit or
venue-authority signature requirement for ordinary owner registration. In an
opened public deployment, owners paying registration rent could exhaust capacity.
This is a capacity consequence of the code, not an observed attack.

Sources: [identity](../../programs/clearing/src/state/identity.rs),
[register handler](../../programs/clearing/src/instructions/account_custody/mod.rs),
[contexts](../../programs/clearing/src/instructions/account_custody/contexts.rs).

This is **not a constant-only fix**. Stable membership governs profit-backing scans,
complete default, two-row resolution pages, bitsets/flow graphs and the 96-limb
exact arithmetic proof. Merely paging the registry does not make settlement
unbounded. Design account retirement/admission and scalable complete-cohort
resolution together; preserve claim ownership and market loss attribution.
Creating new loss-sharing groups would be an economic redesign, not a transparent
storage optimization. Acceptance needs substantially larger active cohorts,
registration exhaustion/recovery and independent complete-default accounting.

### 2. Test price ranges are still trading policy

Authenticated underlying input is hard-bounded to BTC **$10,000–$100,000** and
ETH **$1,000–$10,000**. After collateral normalization, reference must also be
10,000–100,000 quote atoms per lot. A valid fresh oracle outside these ranges fails
the current policy. Stored limits are 9,000–110,000 atoms/lot and triggers
10,000–100,000. These are much narrower than the arithmetic price ceiling of
1,000,000 atoms/lot. The same assumptions appear in SDK funding/source checks.

Sources: [oracle](../../crates/financial-core/src/oracle.rs),
[order terms](../../programs/clearing/src/engine/book.rs),
[source decoder](../../packages/sdk/src/funding-sources.ts).

Separate audited numeric bounds from per-market price/order policy. Preserve
freshness, confidence, independent source agreement and adverse valuation; do not
respond to legitimate price moves by disabling those safeguards. Revisit all
related oracle, funding, order, liquidation and SDK conditions together. Acceptance
needs prices immediately inside/outside old boundaries, depegs, bad sources and
still-reachable safe reduction/default paths. A wider range is not itself a risk
model or permission to accept arbitrary prices.

### 3. Funding measures approximately $6 of published depth

`REFERENCE_NOTIONAL=6_000_000` means six six-decimal collateral tokens, not six
million dollars. `Q=ceil(6_000_000/reference)` is 60–600 lots. At the fixture
$60,000 BTC reference it is 100 lots, or 0.0001 BTC. Rounding can make the actual
notional slightly greater than six tokens. This can reflect tiny displayed quotes
while ignoring the shape encountered by a materially larger trade.

Sources: [funding constants](../../crates/financial-core/src/oracle.rs),
[on-chain report validation](../../programs/clearing/src/instructions/maker_liquidity/publisher/validation.rs),
[off-chain impact allocator](../../packages/sdk/src/funding-impact.ts).

The funding allocator still enumerates every quantity through Q and rejects
Q>600; P48's scalable **trade** allocator did not change this separate path. Pick
a defensible per-market impact notional and scale its off-chain exact search at
the same time. Preserve the agreed published-depth model without hypothetical
maker-margin admission. This is economic calibration: it changes funding inputs,
so it needs independent exact pricing, manipulation/coverage scenarios and causal
funding acceptance, not just an enlarged constant.

### 4. The liquidation reward is capped at one cent

The consenting receiver receives `min(ceil(notional/2000), 10_000, target cash)`
atoms: 5 bps, capped at **0.01 collateral token**. At approximately $1 collateral,
the cap binds at $20 notional. P49's larger liquidation sizes retain this cap.
The receiver also needs funded capital and takes inventory; the current reward
has not established independently sustainable liquidation economics.

Sources: [liquidation](../../crates/financial-core/src/liquidation.rs),
[whole-account candidate](../../crates/financial-core/src/margin.rs).

Calibrate receiver compensation and capital availability explicitly. Keep funded
payment, receiver consent/IM and strict target progress **after fees**. Increasing
fees can prevent otherwise useful liquidations, so testing must cover both
incentive sufficiency and mathematical progress. This is separate from Rivalt's
protected 2 bps taker / zero provider schedule.

### 5. A backlog can exceed recovery limits before the checkpoint advances

The finalized indexer reads complete produced blocks from its checkpoint to the
current finalized head. It counts **all block transactions**, including unrelated
programs, against a default 10,000 recovery limit (configurable up to 200,000).
It separately rejects more than **4,096 Rivalt invocations** before advancing the
financial projection/checkpoint. Raw observations may already be persisted.
It reconciles the accumulated projection before advancing the durable checkpoint.
An oversized unchanged backlog therefore retries from the same old checkpoint;
this is not automatic bounded-progress pagination. Three reconciliation catch-ups
also bound progress while relevant accounts continue changing.

Sources: [finalized ingest](../../packages/indexer/src/finalized-indexer.ts),
[scoped ordering](../../packages/indexer/src/scoped-history.ts).

Design restartable intermediate coverage/checkpointing and reconciliation fences,
or an equivalently complete streaming architecture. Keep finalized ordering,
authenticated per-entity history, omission detection and atomic financial
projection; silently ignoring unrelated blocks is not a complete substitute.
Acceptance should exceed both old ceilings, include heavy unrelated chain traffic,
crash between chunks and replay identically while relevant state advances.

### 6. Maker integration is three sealed slots and two named programs

Each market must seal exactly three instances, including at least one A and one B.
Config validation accepts only those two program IDs and their canonical curve
layout/capability. Sealed membership cannot onboard a fourth maker or replace a
capital through an ordinary registry lifecycle. Funding requires the complete
configured set: one missing/stale/disabled/quarantined required publication can
make funding coverage unavailable even when other makers could fill Q. Trading
can classify/exclude an unavailable maker; do not conflate the two policies.

Sources: [seal/register](../../programs/clearing/src/instructions/maker_liquidity/mod.rs),
[admitted program/layout](../../programs/clearing/src/instructions/maker_liquidity/validation.rs),
[SDK authentication](../../packages/sdk/src/liquidity-adapter.ts),
[funding reader](../../packages/sdk/src/funding-publisher.ts).

Separate admitted maker population and controlled membership changes from the
deliberate maximum of **two selected execution legs**. Dynamic admission needs
approved capabilities/code, epoch-bound snapshots, funding membership semantics
and cross-program integration tests. Making the complete funding set configurable
must not let a publisher omit inconvenient quotes after seeing prices.

## Further limits and assumptions

| Constraint | Present consequence | Assessment / next design requirement |
|---|---|---|
| [Global gross 200m lots](../../programs/clearing/src/engine/routes.rs), [position 100m](../../crates/financial-core/src/lib.rs) | Paired zero-sum positions imply at most 100m lots of one-sided market open interest: **100 BTC or 1,000 ETH**. One maximum P49 position can consume that market's complete envelope. | Inherited arithmetic/test bounds, not measured venue capacity. Separate operational OI/position limits from proved numeric maxima; larger numeric maxima require new overflow/default proofs. |
| [IM 10%, MM 5%](../../crates/financial-core/src/lib.rs) | Same rates for both markets and all position sizes; no size/liquidity-sensitive margin schedule. | Explicit synthetic risk parameters. Calibrate per market with liquidation capacity and concentration; preserve no correlation discounts or positive unpaid-profit credit. |
| [Cumulative funding magnitude 10^15](../../crates/financial-core/src/oracle.rs) | A sufficiently sustained one-direction funding index eventually makes `endpoint` reject. No rebase/reset path was found; default recovery preserves the index. | Lifecycle arithmetic bound. At constant 60,000 atoms/lot and uninterrupted positive 50 bps hourly cap, the theoretical bound is reached in about **139 days**, ignoring tiny truncation differences. This is a constructed bound, not a normal-market forecast. Design exact index rebasing or a longer proven domain, including every checkpoint/held interval. |
| [Four portfolios; children 0–8](../../programs/clearing/src/state/identity.rs) | At most four cross and 32 isolated accounts per owner; cross must be child 0, isolated a positive child. No account reuse/live mode conversion. | Original UI/account-organization choice; u16 indices do not inherently mean four/eight. The child bitmap, namespace checks, SDK/UI and global registry lifecycle must agree. Live mode conversion remains outside agreed scope. |
| [Four order slots / two protective pairs](../../programs/clearing/src/state/records.rs) | Two TP/SL pairs occupy all four child-order slots, leaving none for independent resting entries. | Embedded fixed-size book chosen for bounded resources. More capacity requires a layout/resource decision, potentially separate order pages with bounded aggregate reservations. |
| [216,000-slot order horizon](../../programs/clearing/src/constants.rs), [delegate horizon](../../packages/sdk/src/account-client.ts) | No true indefinite GTC order/delegate; wall-clock lifetime depends on slot duration. At 400ms/slot this is 24h; at the local 50ms fixture it is 3h. | Product/session policy, not a mathematical requirement. Configure/document expiry semantics separately from replay authority and fresh quote lifetime. |
| [Six-second maker lifetime](../../crates/maker-interface/src/canonical.rs), [20s source age / 6s hold / 12s funding outage / 50bps hourly cap](../../crates/financial-core/src/oracle.rs), [report lag <=2s](../../programs/clearing/src/instructions/maker_liquidity/publisher/validation.rs) | Availability and update cost depend on a tightly coupled timing/risk policy; the supported worker funding interval is 2–5s. | Risk/calibration parameters, not targets to loosen for better availability. Measure end-to-end latency and failure recovery, then choose a coherent policy. Historical devnet's 30s source exception does not activate this local profile on devnet. |
| [Zero priority fee and exact action CU budgets](../../packages/services/src/account-ingress.ts), [wallet envelope](../../packages/sdk/src/account-client.ts) | The supported wallet/service refuses alternative compute/priority settings, even for valid financial instructions. This is a client/service restriction, not a clearing rule forbidding Solana priority fees. | Local qualification policy. Support reviewed bounded fee bidding/simulation budgets while preserving original signed bytes, fee reservations and ambiguous-send recovery. |
| [One-second reference-maker repricing](../../packages/services/src/liquidity-workers.ts) | Internal bot refreshes even if price is unchanged, and reads snapshots before testing whether a refresh is due. | Demonstration strategy, not optimized maker economics. Schedule against price/control/expiry needs, preserving required liveness and updater-only authority. |
| [One worker lease per role](../../packages/services/src/account-worker-main.ts), [two dispatch lanes](../../packages/services/src/dispatch.ts), [two risk roots per pass](../../packages/services/src/account-risk-worker.ts) | One pending role-budget intent blocks new role work; risk scanning and sends have small fixed concurrency. Orders/settlement scan members from the beginning. | Operational scheduling choices. Add fairness/deadline metrics and configurable bounded concurrency without releasing unresolved originals or allowing conflicting sends. No throughput guarantee follows from simply increasing lane counts. |
| [Complete profit-backing certificates](../../programs/clearing/src/instructions/account_cash/), [worker fence](../../packages/services/src/account-settlement-worker.ts) | Selected-market profit payment needs complete backing progress under relevant membership/liability/source fences; ongoing relevant changes can interrupt a multi-page scan. Ordinary funded withdrawal is account-local and does **not** require this certificate. | Deliberate accounting/liveness tradeoff, not a removable number. Preserve funded cash versus unpaid claims; revisit scalable proof/progress before expanding the cohort. |
| [Eight curve regions](../../crates/maker-interface/src/canonical.rs), [48-key snapshot](../../packages/sdk/src/funding-publisher.ts), [32 scoped entities](../../programs/clearing/src/scoped_history.rs) | More strategy segments or published makers can exceed off-chain/account/event envelopes before exceeding a trade's two-leg bound. | Explicit measured/storage bounds. Inventory the coupled snapshots, layouts, wire and CU before expanding; Solana transaction/runtime limits remain separate. |

## Concrete vestiges

- `TransportConfig.pageSize` is still accepted/validated in
  [finalized-indexer.ts](../../packages/indexer/src/finalized-indexer.ts), but the
  active block-range loop uses literal 1,000 and never reads that option. Changing
  the configuration currently does not tune its advertised history pagination.
- [Rust `best_sample_pair`](../../crates/financial-core/src/liquidity.rs) and its
  14,424-byte sampling-table contract have no current program callers. Uses found
  are native tests and `liquidity-sample-driver`. They should be explicitly retained
  as reference tooling or moved there; they do not describe current on-chain
  funding-report CU. `PreparedMakerRisk` in the same module **is** live execution
  code and must not be removed with the retired sampling path.

These are smaller cleanup candidates, not substitutes for the capacity and policy
work above. No retention or API change is made by this audit.

## Provenance and interpretation

Targeted local Git inspection confirms rather than assumes the origin:

- P02 `16f52aa` introduced the current gross/funding numeric constants. D19/D20
  explicitly called the numeric and 10%/5% risk values engineering fixtures and
  retained 64 participants after an SBF fixed-array stack problem.
- D24 in the P07 ancestor `988a884` calls the 10,000–100,000 price range and risk
  envelopes finite local fixtures. That P07 implementation introduced the $6
  funding notional and source/funding timing policy.
- P08 D29 selected four embedded orders, two groups and the 216,000-slot lifetime.
  P09 `ef6e4bb` / D30 selected capped funded liquidation; this was expressly not
  funded-pilot calibration.
- P17 `5a4dc84`/`6389c3e` introduced the portfolio/subaccount bounds; P22B/P23
  carried those identities into the account-centric design.
- P30 `c7dd9d9` introduced the sealed canonical maker lifecycle; later publisher
  work moved impact calculation off chain while retaining its small Q domain.

These decisions were reasonable bounded implementation choices. Their existence
is not evidence of a financial bug, and some now underpin proofs that must be
replaced before expansion. The risk is treating a completed local phase as proof
that those same defaults are suitable operating policy indefinitely.

## Recommended work order

1. Define the intended operating envelope: active accounts, simultaneous makers,
   market OI, order counts, funding impact notional, update cadence and fee budget.
   Distinguish compiled numeric proof limits, versioned market/risk parameters and
   ordinary service configuration. Do not replace old unexplained numbers with
   larger unexplained numbers.
2. Address price-policy coupling and indexer bounded progress as separate scoped
   changes. Together these remove a legitimate-price availability cliff and a
   deterministic backlog cliff without redesigning loss attribution.
3. Design membership/account lifecycle and complete settlement scaling together;
   treat this as the largest architectural item. Decide maker-population changes
   alongside it, preserving two-leg execution and explicit funding-set epochs.
4. Calibrate impact notional, liquidation incentives, risk/OI limits and timing;
   then qualify long-running funding-index maintenance and operational fee bidding.
5. Expand order/account convenience limits and remove confirmed vestiges once the
   core operating envelope is supported.

Two initial markets, one collateral mint, isolated maker capital, no positive
unpaid-profit margin credit, no correlation discounts, 2 bps/zero provider fees,
25% insurance, two selected makers, existing-position protection and complete
default remain deliberate protected scope. Current fixture-only/local activation
and P15B/P16B are explicit gates, not accidental obstacles to remove. This audit
does not authorize live conversion, paid services, outreach or funded deployment.
