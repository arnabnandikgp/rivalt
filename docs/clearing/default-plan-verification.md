# Profit attribution and default verification

Clearing keeps two bounds on the average entry of each open position. Exceptional resolution can charge only eligible unpaid open gains. A second market can have a claim on the same debtor's funded cash.

## Entry, payment and partial close

Increasing exposure weights old and new inventory at their execution prices. A partial reduction retains average entry for the surviving lots. A close clears entry, and a flip starts the residual position at the execution basis. The trader receives the aggregate route price and each maker receives its own leg price. Any unpaid fixed claim stays with the account.

Ordinary payments draw only on the fixed component and are capped by the total positive market claim. An ordinary payment leaves the surviving lots' entry intact. All fresh margin slots are 40 bytes per market, including after repeated mixed-price increases. For frozen selection, clearing uses the highest possible entry for a long or the lowest for a short. It converts that endpoint to a canonical per-lot fraction on chain. The keeper proposes against the same fraction. This bounds the winner charge even when qualified exact histories would give different whole-atom outcomes. [Ordinary payout arithmetic](accounting.md#ordinary-payouts-on-closed-quantity) · [On-chain storage admission](../../programs/clearing/src/profit_attribution.rs)

The earlier RVPROF01 deployment permitted open-price payments after fixed claims. It reserved space to distribute those payments across the surviving lots. Its historical frozen records retain that interpretation. [Earlier attribution and storage bound](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md#storage-reserved-at-trade-admission)

## What clearing verifies

1. **Freeze.** Bind the venue, episode, complete Financial membership, original cash, accrued claims and position histories, market prices, pools, insurance and retained fees. Preserve the original division of each cross debtor's funded cash between markets.
2. **Establish baseline payouts.** Value the full book and derive the original creditor receipts and insurance use. During forced reduction, a winner’s eligible charge is bounded by its unpaid open price gain, whole-account market claim, matched lots and the attributable shortfall.
3. **Compare allowed reductions.** BTC and ETH can form a joint plan when the complete result protects other-market receipts and insurance. Maximize permitted recovery, apply the market-balance and proportional charge rules, then the lot and frozen-episode ordering rules. A proposed feasible schedule alone is insufficient.
4. **Apply and reconcile.** Clearing authenticates the selected schedule and market movements, checks conserving whole-atom payouts, applies each original member once, and verifies final custody before allowing resolved withdrawals. A keeper can submit or resume work. Its signature, database, simulation or proposed plan cannot authorize a different payout.

The local runtime selects an exhaustive or paged verifier from frozen inputs. A book that cannot be verified stays frozen. Tested recovery size, resources and restarts apply to the specific books in [validation](../operations/validation.md).

[Selection and ordering](../../crates/default-plan-selection/src/) · [Settlement verifier](../../crates/financial-core/src/clearing/) · [On-chain controller](../../programs/clearing/src/instructions/account_safety/settlement/) · [Detailed equations, ranking and proof families](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md)
