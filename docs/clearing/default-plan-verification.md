# Profit attribution and default verification

When a profitable position receives cash, clearing needs to know how much unpaid profit remains on the lots that survive. A later forced close may charge only eligible gains. A second market can have a claim on the same debtor's funded cash.

## Entry, payment and partial close

Clearing stores average entry and previously paid open profit per surviving lot as two numerators with a shared denominator. Increasing a position weights old and new inventory. A same-side reduction preserves both per-lot values. Closing clears this record, while any remaining aggregate market claim stays on the root. Flipping starts a new basis for the residual side. A trader sees the aggregate route price and each maker sees its own leg.

Let `q` be absolute lots, `g` signed per-lot price gain, `p` previously paid per lot, `C` accrued claim and `A` the backed payment, using scaled units. The fixed component is `F = C − q × (g − p)`. The payment adds `max(0, A − max(0, F)) / q` to paid open profit per lot. Closed gains therefore get paid first. [Attribution implementation](../../crates/clearing-accounting/src/attribution.rs)

A new or increased position must leave enough room for later partial closes interleaved with gain payments. Clearing uses a conservative bound on numerator and denominator growth. The position can occupy very few bytes at entry and still fail this reserve check. [On-chain admission](../../programs/clearing/src/profit_attribution.rs) · [Storage-bound derivation](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md#storage-reserved-at-trade-admission)

## What clearing verifies

1. **Freeze.** Bind the venue, episode, complete Financial membership, original cash, accrued claims and position histories, market prices, pools, insurance and retained fees. Preserve the original division of each cross debtor's funded cash between markets.
2. **Establish baseline payouts.** Value the full book and derive the original creditor receipts and insurance use. During forced reduction, a winner’s eligible charge is bounded by its unpaid open price gain, whole-account market claim, matched lots and the attributable shortfall.
3. **Compare allowed reductions.** BTC and ETH can form a joint plan when the complete result protects other-market receipts and insurance. Maximize permitted recovery, apply the market-balance and proportional charge rules, then the lot and frozen-episode ordering rules. A proposed feasible schedule alone is insufficient.
4. **Apply and reconcile.** Clearing authenticates the selected schedule and market movements, checks conserving whole-atom payouts, applies each original member once, and verifies final custody before allowing resolved withdrawals. A keeper can submit or resume work. Its signature, database, simulation or proposed plan cannot authorize a different payout.

The local runtime selects an exhaustive or paged verifier from frozen inputs. A book that cannot be verified stays frozen. Tested recovery size, resources and restarts apply to the specific books in [validation](../operations/validation.md).

[Selection and ordering](../../crates/default-plan-selection/src/) · [Settlement verifier](../../crates/financial-core/src/clearing/) · [On-chain controller](../../programs/clearing/src/instructions/account_safety/settlement/) · [Detailed equations, ranking and proof families](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md)
