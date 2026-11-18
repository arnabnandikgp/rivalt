# Clearing roadmap

18 November 2026. This is the active engineering plan for Rivalt. The starting
point is the locally qualified BTC/ETH prototype through P56. Its common clearing,
isolated maker capital, one collateral mint, index-derived risk, whole-account
funding and reservations, two-maker routes and current fees are the baseline for
the design comparison. P57–P62 from the audit plan are retired as future work.
[Status](../STATUS.md) records delivered work and [D111](../DECISIONS.md#d111--clearing-roadmap)
records the change in direction.

## Delivery order

Each row is a reviewable deliverable. Dependencies follow the financial behavior
being changed. Source extraction can proceed against today's behavior while the
selected loss rule's eligibility and execution terms are being tested.

| Deliverable | Scope | Review evidence |
|---|---|---|
| 1. Settlement and liquidation contract | Specify the actors, admissible transitions, accounting deltas and settlement finality. Build an executable comparison of today's exact settlement and a candidate with forced reductions of opposite positions (ADL) and explicit residual claims. | Independently derived balances, inventory, insurance and loss bearers for ordinary payout, price reversal, cross-market debt/cycles, fees, fractions, bankrupt makers and insufficient ADL capacity. Show the economic differences for decision. |
| 2. Functional code consolidation | Give the risk engine a crate with a small public API and each other financial operation a discoverable owner. Extract the existing behavior through the normal clearing entrypoints. Publish the equation-to-code map with the extraction. | Follow a withdrawal or liquidation from instruction to the exact rule and atomic commit. Check matched financial vectors, authorization, ABI/IDL/SDK and signed domains. Compare affected compiled stack and CU against the pre-extraction pin. |
| 3. Ordinary settlement | Measure collection of open-position losses and time from eligible claim to funded gain. Improve worker and on-chain progress, and evaluate close-and-pay where current cash and backing checks permit it. | Verified close with a different maker, delayed collections, partial payments, price changes and interruption. Report why payment waited. Show funded and pending amounts in the SDK, indexer and UI. |
| 4. Forced liquidation and backstop | Route eligible partial reductions through admitted maker quotes with independent price bounds. Integrate consent, funded capacity, compensation and unwind rules for receivers. | Whole-account deficit improves after all fees. Demonstrate no quote, insufficient receiver capacity, stale oracle, competing attempts, and preservation of the trader's remaining exposure and cash. |
| 5. Default and recovery | Implement the selected rules for debtor recoveries, market insurance, ADL and unpaid claims. Specify when the loss becomes binding, cross-market attribution, rounding, freeze scope and resumption. | Complete conservation across all affected obligations including flat accounts, no eligible opposite position and depleted insurance. Demonstrate bounded, authenticated continuation after restart. Eligibility and execution terms must pass the deliverable 1 gates. |
| 6. Shared writes and qualification | Baseline same-market locks on the existing paths, then change ownership where measurements justify it. Qualify the resulting clearing lifecycle and its effects on makers and users. | Compare matched distinct-maker and shared-maker workloads, signed Surfpool RPC/WS results, PostgreSQL replay, exit, CU, transaction sizes, costs by payer and landed throughput. Verify aggregate exposure caps, fee carry, funding history and complete payment backing. |

## Functional ownership

These are proposed destinations for deliverable 2. The links lead to today's
source. The clearing program links the pure Rust financial rules into the on-chain
binary. Workers request transactions and the indexer records finalized outcomes.

| Where to look today | Target owner | Question it answers |
|---|---|---|
| [Financial primitives](../../crates/financial-core/src/lib.rs) and [margin state](../../crates/financial-core/src/margin.rs) | Accounting module for typed cash, claims, positions, funding accrual and paired deltas | What balances and obligations changed? |
| [Whole-account margin math](../../crates/financial-core/src/margin.rs), [orders](../../crates/financial-core/src/orders.rs) and [program risk adapter](../../programs/clearing/src/engine/risk.rs) | Proposed `crates/risk-engine`, operating on typed accounting state and authenticated price/funding inputs | Can this account trade or withdraw, when is it liquidatable, and does reduction improve health after fees? |
| [Route rules](../../crates/financial-core/src/route.rs), [liquidation rules](../../crates/financial-core/src/liquidation.rs) and [maker route handler](../../programs/clearing/src/instructions/maker_liquidity/routes/) | Execution and liquidation modules calling accounting and risk | Which maker fill or receiver transfer is admissible, and what atomic update follows? |
| [Backing](../../crates/financial-core/src/backing.rs), [default solver](../../crates/financial-core/src/clearing/), [claims](../../programs/clearing/src/instructions/account_cash/) and [resolution controller](../../programs/clearing/src/instructions/account_safety/resolution/) | Settlement and resolution engine with program adapters for authenticated continuation | How does a claim become cash, and who bears a deficit? |
| [Clearing instructions](../../programs/clearing/src/instructions/), [state](../../programs/clearing/src/state/), [settlement worker](../../packages/services/src/account-settlement-worker.ts) and [indexer](../../packages/indexer/) | Thin on-chain authority/custody adapters, off-chain services grouped by domain and finalized projections | Who can call it, who signs or retries, and where can a user verify the outcome? |

Each domain's overview should identify its public functions, callers and independent
test cases. Keep dependency direction from program and workers toward domain APIs,
with accounting types shared beneath the risk and settlement calculations.

## Initial model cases

The [executable comparison](architecture-review.md#executable-settlement-and-liquidation-comparison)
reports the cash, inventory, insurance and unpaid claims under each alternative.
Its starter cases use whole collateral atoms at one frozen valuation.

- **Who bears a remaining loss?** BTC owes 60 to a flat but unpaid trader and 40
  to an eligible open winner. Debtor cash supplies 80 and BTC insurance supplies
  10. Equal recovery of unpaid claims gives them 54 and 36. A policy assigning the
  entire remaining 10 to the open winner gives them 60 and 30, assuming sufficient
  eligible position and profit. Both pay 90. When the winner can absorb only 6,
  proportional allocation of the remaining 4 produces whole payouts of 57 and 33.
- **Which market bears a cross-account loss?** One account owes 80 BTC-market
  units and 40 ETH-market units, all denominated in the same collateral. Its 90
  cash covers 60 and 30 under current proportional own-cash collection in default.
  That leaves 20 and 10 respectively before market insurance. Cross-account cash
  cannot be counted twice. Separate fixtures cover a collectible opposite-market
  claim and a cashless cycle with an external creditor.

[D112](../DECISIONS.md#d112--capped-adl-and-proportional-residual-recovery)
sets finality at funded cash and selects capped ADL with proportional residual
recovery. The [eligibility experiments](architecture-review.md#eligibility-at-the-freeze)
show charges moving across makers after a close/reopen or a subaccount split.
The [payment comparison](architecture-review.md#which-profit-an-ordinary-payment-settles)
replays both conventions through signed funding, partial closes and re-entry.
[D113](../DECISIONS.md#d113--closed-first-payment-attribution) selects payment of
the positive fixed claim first, including signed accrued funding. The next contract question concerns the
binding loss epoch for pre-freeze closes and re-entry. Keep the active proportional
settlement until the selected eligibility, epoch, pricing and continuation rules are qualified. The
[architecture review](architecture-review.md#next-deliverable-and-acceptance)
contains the transition and adversarial-case checklist.

Model ordinary payment from deposited collateral first. A settlement advance
facility requires measured timing demand plus an identified funder, repayment
priority and loss bearer. A separately funded receiver takes inventory risk.
Consider sharing realized receiver surplus with insurance only after costs and
capital needs are measured. Reserve investment, public LP capital and borrowing
are deferred. P15B independent participation and P16B independent review/funded
readiness remain external gates. Continuous 24-hour endurance remains deferred.
