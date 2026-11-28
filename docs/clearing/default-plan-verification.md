# Profit attribution and default verification

Clearing keeps two bounds on the average entry of each open position. Exceptional resolution can charge only eligible unpaid open gains. A second market can have a claim on the same debtor's funded cash.

## Entry, payment and partial close

Increasing exposure weights old and new inventory at their execution prices. A partial reduction retains average entry for the surviving lots. A close clears entry, and a flip starts the residual position at the execution basis. The trader receives the aggregate route price and each maker receives its own leg price. Any unpaid fixed claim stays with the account.

Ordinary payments draw only on the fixed component and are capped by the total positive market claim. An ordinary payment leaves the surviving lots' entry intact. Each position's entry-cost record stays at 40 bytes through repeated mixed-price increases. A listed market slot also carries identity and position fields. For frozen selection, clearing uses the highest possible entry for a long or the lowest for a short. It converts that endpoint to a canonical per-lot fraction on chain. The keeper proposes against the same fraction. This bounds the winner charge even when qualified exact histories would give different whole-atom outcomes. [Ordinary payout arithmetic](accounting.md#ordinary-payouts-on-closed-quantity) · [On-chain storage admission](../../programs/clearing/src/profit_attribution.rs)

The earlier RVPROF01 deployment permitted open-price payments after fixed claims. It reserved space to distribute those payments across the surviving lots. Its historical frozen records retain that interpretation. [Earlier attribution and storage bound](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md#storage-reserved-at-trade-admission)

## What clearing verifies

1. **Freeze.** Bind the venue, episode, complete Financial membership, original cash, accrued claims and position histories, market prices, pools, insurance and retained fees. Preserve the original division of each cross debtor's funded cash between markets.
2. **Establish baseline payouts.** Value the full book and derive the original creditor receipts and insurance use. During forced reduction, a winner’s eligible charge is bounded by its unpaid open price gain, whole-account market claim, matched lots and the attributable shortfall.
3. **Compare allowed reductions.** BTC and ETH can form a joint plan when the complete result protects other-market receipts and insurance. Maximize permitted recovery, apply the market-balance and proportional charge rules, then the lot and frozen-episode ordering rules. A proposed feasible schedule alone is insufficient.
4. **Apply and reconcile.** Clearing authenticates the selected schedule and market movements, checks conserving whole-atom payouts, applies each original member once, and verifies final custody before allowing resolved withdrawals. A keeper can submit or resume work. Its signature, database, simulation or proposed plan cannot authorize a different payout.

The local runtime selects an exhaustive or paged verifier from frozen inputs. A book that cannot be verified stays frozen. Recovery work and restarts were measured on specific books. [Default and wallet exits](../operations/performance.md#default-and-wallet-exits)

## Default on a funded venue with a listed market

In the local `listed-venue-default` profile anyone can submit
`freeze_listed_default` for a financial member. Clearing authenticates the
target's membership and each market in the venue directory. It prices the
target's inline and listed positions using the bound asset and collateral
feeds and the funding earned at that clock. Open exposure requires negative
economic equity. A flat account can also default when its gross unpaid debt
exceeds its funded cash. Margin failure alone cannot trigger this operation.

The episode PDA uses the seeds `["listed-default", venue]`. It records the
membership commitment and count, venue and safety epochs, allocated vault
balance, and each market's ID, reference price, funding index, gross lots,
settlement pool, insurance, retained fees and insurance carry. The freeze
advances the venue and safety epochs and pauses financial activity. It makes
no transfer from the SPL vault.

For `settle_listed_default`, anyone can supply the proposed rates, every
listed book in frozen market order and every financial margin account in
stable member order. Clearing authenticates the addresses, values every
position at the frozen indices and derives each potential winner's eligible
charge from its stored entry cost. The market-indexed verifier checks the
debt allocation, market insurance, creditor protections and selected plan.
Clearing reconciles the original and terminal cash totals to the allocated
vault before committing. One transaction clears all positions and orders,
retires the old market-capacity generations and assigns each member its funded
cash. If verified insurance covers the full shortfall in an authenticated frozen
episode, the creditors receive their full claims with no forced reductions.
A fully paid book with zero insurance spend and zero residual loss cannot use
this settlement path. After settlement each owner can withdraw that cash to its own token
account. No oracle update or keeper signature is required for the withdrawal.

The verifier accepts up to 12 financial members and eight market columns, with
whole-atom initial claims representable as signed 32-bit integers, at most
4,294,967,295 funded atoms per member and the
bounded recovery plans in the indexed verifier. A fractional initial claim can
establish insolvency even when this verifier cannot settle the resulting book.
The local qualification venue can remain frozen on unsupported books. These
bounds keep general wider trading gated. The signed venue workload uses one
listed market alongside the two inline markets.

## Creditor protection and competing reductions

A candidate charge must fit the debtor's attributable uninsured loss and the
winner's unpaid gain on opposing lots that can actually close. Two winners
competing for the same last lot share a single lot budget. Compare each plan
against the complete frozen book with the original attribution of debtor cash.

A close can affect creditors in another market through the same cross debtor.
Protect each creditor's exact and rounded recovery there and bound the use of
that market's insurance. If ordinary rounding takes away a protected atom,
recompute with protected receipts as minimums. Reject a plan whose minimum
receipts cannot be funded. Verify joint reductions together before any owner
can withdraw. [Settlement equations and ranking](risk-and-resolution.md#settlement-across-a-frozen-set-of-markets)

The standalone five-root custody fixture admitted particular single-pair and
two-winner books. Its roster and algebraic shortcuts belong to that fixture.
[Single-pair derivation](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/clearing/default-plan-verification.md#signed-three-market-default-with-one-eligible-pair) · [Two-winner derivation](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/clearing/default-plan-verification.md#signed-settlement-with-a-second-btc-winner) · [Verifier implementations](../../crates/default-plan-selection/src/)
