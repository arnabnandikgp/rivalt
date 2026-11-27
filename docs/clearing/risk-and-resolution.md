# Risk, liquidation and default

Clearing uses independent index prices for risk. A keeper can submit a forced trade, while the on-chain program enforces its price, margin and authority. Default is a separate transition that resolves funded cash and unpaid claims across the complete frozen cohort.

## Risk sources and account admission

Risk uses independent index bounds, never maker execution prices or attested impact
prices. Each root accrues both positions and refreshes all remaining reservations.
Equity is funded cash plus negative adverse claims only; IM/MM are additive 10%/5%
with conservative per-position ceilings. These are provisional test parameters,
not production leverage calibration. Isolated mode rejects any other-market state.

The six local source PDAs bind distinct primary/guard signer identities: BTC feeds
1/3, shared collateral 2/4, ETH 5/6. Authenticate owner, PDA, exact schema/length,
verifier identity, verification level 2, exponent -6 and monotone source sequence.
Wrong supplied accounts reject; invalid values from the actual bound sources cause
policy failure. Sources are signed test fixtures, not independent upstream oracles.

| Policy | Current local bound |
|---|---|
| Asset USD values | Positive checked i64 micro-USD values; ETH value/confidence multiplied by ten before reference and complete interval admission |
| Asset / collateral confidence | At most 50 / 25 bps |
| Collateral USD range / Normal | 0.5–1.5 / both sources 0.95–1.05 |
| Source age / future skew | At most 20 / 2 seconds at on-chain Clock |
| Primary/guard divergence | At most 1% of primary converted reference |
| Reference / risk price | 2–909,090 / finite 1–1,000,000 atoms per lot; reject rather than clip the full interval |
| Risk envelope | Confidence interval plus 1% model envelope, union with guard; valid primary with missing/invalid guard gives at least ±3% and Degraded |
| Recovery / hold | Six seconds sustained qualified samples; gaps at most six seconds |
| Funding outage / catch-up | Risk increase blocked after 12 seconds; unverified catch-up at most 30 seconds |

Normal also requires qualified funding/recovery. Credible Degraded bounds permit
only admissible reductions/liquidation; no credible bounds blocks exposed ordinary
execution. Flat fixed claims do not invent price exposure. Derive required markets
from actual positions, claims, live orders/protections and the operation. Never let
a caller omit a losing market; empty unrelated slots need no fresh price. Shared
collateral sources remain relevant to exposed collateral-denominated positions.
Cancellation outside frozen ownership needs no source or maker quote.

### Risk equations in code

| Question | Calculation and source |
|---|---|
| What does one position owe? | `Position::unpaid` applies the signed funding change since its checkpoint to virtual quote, then adds signed lots × price × scale. A flat position retains its fixed claim. [Position accounting](../../crates/clearing-accounting/src/lib.rs) |
| Which claim counts toward margin? | `Account::risk_equity` counts cash once, selects lower for long and upper for short, and adds only negative claims across the permitted markets. [Risk engine](../../crates/risk-engine/src/lib.rs) |
| Can a trade or withdrawal proceed? | `Account::admissible` requires that equity cover all reservations plus the sum of each position’s initial margin rounded up in whole atoms. `ReservationRate` bounds price loss, remaining fees and initial margin on an order. [Account admission](../../crates/risk-engine/src/lib.rs), [order reservations](../../crates/risk-engine/src/orders.rs) |
| Does a forced reduction help? | `Account::deficit` is the positive shortfall between maintenance margin and risk equity. The funded-receiver candidate checks the target’s deficit again after charging the fee, then the adapter refreshes both books and checks receiver capacity. [Paired liquidation](../../crates/financial-core/src/margin.rs), [program adapter](../../programs/clearing/src/engine/risk.rs) |

For a withdrawal, start at `withdraw`, which authenticates the owner and guard.
`withdraw_candidate` accrues funding, refreshes the book and calls the account
risk check. The handler commits the candidate and SPL transfer within the same
transaction. For liquidation, `liquidate` verifies the caller and both accounts,
constructs the funded transfer, and commits the accepted pair. [Withdrawal handler](../../programs/clearing/src/instructions/account_cash/cash.rs),
[withdrawal candidate](../../programs/clearing/src/instructions/account_cash/engine.rs),
[liquidation handler](../../programs/clearing/src/instructions/account_safety/risk.rs)

### Withdrawal risk across occupied markets

Current clearing enumerates the four BTC/ETH funding corners. The width
comparison uses the same two requirements after accruing positions and refreshing
order reservations. At current funding, retained cash must cover negative claims,
per-market initial margin rounded up in atoms, and remaining order reservations.
Across the held funding window, retained cash must cover negative claims. Keep
fractional losses at full scale until comparing them to whole cash atoms.

At a fixed adverse index price, increasing the funding index decreases a long's
claim and increases a short's claim. Taking only the negative part preserves
that ordering. With independent funding windows, the worst simultaneous loss
is therefore the sum obtained by choosing high funding for each long and low
funding for each short. A flat debt is fixed and a positive unpaid claim
contributes zero. This lets one pass over the occupied markets calculate both
cash requirements. The argument depends on the current additive risk rule and
independent windows.

The risk kernel takes occupied slots in market-ID order. Its funding windows cover every open position. The original signed width comparison uses read-only synthetic inputs. The [funded custody qualification](accounts.md#funded-custody-qualification) derives the required observations from persisted slots on both roots, including order-only markets, before applying the same kernel and moving test collateral. The production oracle adapter and general order lifecycle still need wider integration.
[Risk calculation](../../crates/risk-engine/src/withdrawal.rs) · [Qualification](../operations/qualification-scorecard.md#withdrawal-risk-at-two-four-and-eight-markets)

## Orders and protection

Four records and two protective pairs are embedded in each root. Inclusive start,
exclusive expiry; order lifetime and placement horizon at most 216,000 slots;
quantity 1–100,000,000 lots; per-lot all-in limit 1–1,000,000 atoms; lifetime fee budget
at most 1,000,000,000,000,000 atoms (the existing cash domain); index triggers 2–909,090 atoms. Each stored-order
subfill is exact-base atomic with at most two distinct maker capitals. Ordinary market orders have a separate [wider execution contract](../liquidity/routing.md#wider-atomic-fills).

For each remaining risk-increasing buy lot reserve `ceil(upper/10) + max(limit-lower,0)`;
for sell use `ceil(upper/10) + max(upper-limit,0)`, plus unspent fee budget. Reduce-only
orders add no directional IM but retain execution-loss and fee reservation. Sum
remaining orders conservatively; missing credible bounds use the finite full risk
range. Recompute before admission/withdrawal/payment and after fills. A reservation
is not a fill guarantee. Actual funding publication has no hypothetical reservation
or maker-margin check; the [publisher contract](../liquidity/funding.md) owns that boundary.

Partial fills retain version; replace increments it while retaining cumulative
filled quantity, gross and fee prefix. Checked order IDs prevent reused slots from
reviving old authority. States are Empty/Open/PartiallyFilled/Filled/Cancelled/
Expired/Invalidated. On-chain order decides cancel/replace/fill races.

TP/SL needs an existing nonzero position. Its two orders share a generation-bound
allowance no larger than current exposure. Creation thresholds straddle current
index; partial TP reduces SL allowance, manual reductions clip it, and flat/flip
invalidates the generation. Reopen cannot revive it. Cancelling one child leaves
the sibling; replacing a child advances group version so old group cancel rejects.
Replacement cannot grow shared allowance or change generation/trigger direction.
No entry-linked growth, trailing stop, trigger latch or keeper-created user authority.

## Liquidation

A receiver signs consent and supplies funded capital; verify its canonical root,
current version, full funding/reservations and final IM. Target must have a positive
whole-account MM deficit. Transfer 1–100,000,000 lots within held quantity, without flipping,
at a price inside 90–110% of independent reference. Cancel target risk orders
atomically; their cancelled authority cannot create a false extra source dependency.
Receiver surviving orders still count. Fee is `min(ceil(notional/2000), 10,000,
target cash)` atoms, transferred to receiver, with no additional insurance tax.
After fees, selected absolute exposure and whole-account MM deficit must both
strictly decrease. Mere exposure reduction is insufficient. Failure rolls back
funding, orders, positions and fee. No forced unfunded receiver or hidden subsidy.

### Funded receiver on a sparse cross account

The local width fixture lets any fee payer submit a transfer signed by the receiving cross trader. The target owner supplies no signature. The program reads the current observations for both accounts, the selected position and surviving orders. A target order that increases risk is cancelled atomically. Orders on the receiver still reserve collateral. A reduce-only order can execute only against the remaining eligible quantity in its original position generation.

The target’s maintenance shortfall includes its flat debts and the negative claim on each open position at its current funding index and adverse price. Each market’s maintenance requirement rounds up separately. The signed transfer price must fall within the existing receiver price band. The target transfers signed lots to the receiver at the agreed price. Each account updates its own entry cost. The target pays the receiver fee from funded cash. The transaction succeeds only if the resulting shortfall is strictly smaller and the receiver’s funded equity supports its initial margin and remaining orders. The result returns the before and after shortfall in scaled atoms and the fee in whole atoms. [Receiver implementation](../../tests/programs/default-proof/src/slot_trading/liquidation.rs)

### Maker liquidation

`liquidate_liquidity_route` shares the existing maker route's quote authentication,
one- or two-capital limit, solvency checks, funding, fee split and atomic commit.
Any signer can pay to submit it on the local deployment. The target's guard
and reduce-only generation bind the precise position it may reduce.
The target must be below maintenance with nonnegative conservative equity.
The selected market and any market with surviving position exposure or a live
order must have current qualified sources. A risk-increasing order that the
fill cancels still requires its authenticated market account for input validation.
That order alone does not require a fresh price for its market.

For a long, each maker's gross proceeds must be at least lots times the lower
risk price. For a short, gross cost must be at most lots times the upper risk
price. Clearing cancels the target's active risk-increasing orders in the same
transaction. It checks whole-account equity and deficit again after charging
the fee. If a multi-lot close would restore maintenance, try a smaller close and
finish with one lot. A rejected candidate preserves balances, orders and depth.

The maker-liquidation submitter pays its transaction fee. A consenting receiver earns up to 10,000 collateral atoms per transfer, or 0.01 collateral tokens. Its actual capacity and willingness to hold the risk determine whether it participates. A failed attempt alone cannot authorize default.

## Complete default

For account `i` and market `m`, write positive claim `w_i,m = max(U_i,m,0)` and
debt `d_i,m = max(-U_i,m,0)`. The clearing contract uses these priorities:

1. Collect available **own** cash against total negative claims, apportioned by
   those market debts. Other accounts' healthy cash is never a reserve.
2. Apply recovered positive claims to that same account's remaining opposite-market
   debt before granting any cash entitlement. The transfer is capped at the debt;
   failure to recover the source claim does not erase the destination obligation.
3. Each market supplies at most its own insurance against the resulting debt.
   Existing settlement cash and collected losses are used first. Retained fees and
   foreign insurance are excluded.
4. Every unpaid creditor in a market receives the same exact recovery fraction
   before terminal atom rounding. Complete residual debtor writeoffs equal that
   market's creditor impairment. This includes claims pledged by cross accounts.

## Residual clearing equations

### Gate for a third cross market

The local protocol resolves BTC/ETH. A third cross market introduces a choice
the two-market rules never have to make. Suppose a flat cross account has no
cash, is owed 180 atoms on SOL and owes 150 on BTC and 120 on ETH. One flat
creditor is owed each destination balance. SOL has collected all 180 atoms.
The balances reconcile in all three markets before resolution.

| Allocation of recovered SOL proceeds | BTC creditor | ETH creditor | BTC insurance spent |
|---|---:|---:|---:|
| Proportional to destination debts (150:120), no insurance | 100 | 80 | 0 |
| ETH debt paid first, no insurance | 60 | 120 | 0 |
| Proportional, with 150 atoms of BTC insurance available | 150 | 80 | 50 |
| ETH debt paid first, same BTC insurance available | 150 | 120 | 90 |

The approved successor rule splits recovered proceeds in proportion to the
debtor's frozen remaining destination debts, before destination insurance. The
split is independent of market labels, transaction order and reserve size. In
the same book, if SOL recovers only 90 atoms, BTC receives 50 and ETH 40 before
insurance. If it recovers one atom, their exact shares are 5/9 and 4/9 of an
atom. Preserve those fractions until the complete book is rounded. Cap total
debt discharge at 270 even if more proceeds become available.

Letting destination insurance influence the split can increase aggregate recovery
and spend more of one market's reserve, as the alternative rows illustrate.
Before activation, qualify cycles, multiple sources, fractional ownership,
terminal rounding, forced reductions, insurance use and every final withdrawal
against a complete independent book. [Finding 11](../operations/qualification-scorecard.md#payout-and-cross-margin-work)

### Settlement across a frozen set of markets

The native engine takes the expected market IDs and member roster, the market snapshots, and each member’s funded cash and signed market claims after index valuation and funding. It checks both rosters for completeness, orders by stable ID, checks that each market's net claim equals its settlement pool, and reconciles cash, pools, reserves and retained fees to the vault. An on-chain caller still has to authenticate these inputs at the same freeze.

First collect each debtor’s own cash up to its total debt rounded down to whole atoms. Split that collection by the original exact debt proportions. At a given set of market recovery rates, sum everything the account actually recovers. Forward those proceeds by the frozen proportions among destinations that still have unpaid debt. Whenever a destination reaches its cap, the remaining destinations divide the next proceeds by their relative original weights. The debtor keeps any excess once all debts are paid.

For example, with debts of 150, 120 and 30 in three markets, 150 recovered atoms from a fourth market cover 75, 60 and 15. If the first destination holds 25 insurance atoms, its creditor receives 100. Each destination’s reserve covers only its own shortfall.

**How the native solver verifies the rates.** Each market pays at most its face claims and the resources available from its pool, own-cash collections, incoming recoveries and insurance. The engine finds the greatest rates satisfying those constraints simultaneously. This permits reciprocal claims to offset in a cashless cycle while every outside creditor still participates at its market’s rate. With the original debt proportions, one linear allocation per linked debtor suffices. Unequal debt caps after reductions can create several successive allocations per debtor. The engine checks the feasible combinations using exact rational linear programs, then verifies the winning rates against the original cash flows. Runtime can grow with the product of those choices. The present implementation uses a dense matrix in host memory. [Rate calculation](../../crates/financial-core/src/clearing/market_settlement/rates.rs)

Each fractional reserve draw reduces that market’s budget to its whole-atom floor and triggers a fresh solve. A reserve can be clipped once, so a book with `M` markets needs at most `M + 1` budget passes. Round terminal cash flows over the complete member-and-market network in stable ID order. Reconcile each market's residual writeoffs to its creditor impairments and the complete whole-atom settlement to the original vault. [Native qualification](../operations/qualification-scorecard.md#one-settlement-engine-across-market-widths)

For simultaneous forced reductions, clearing must evaluate all concessions against the same original lot and debtor budgets, preserve the division of funded cash and verify all protected payouts before application. The native engine can compare a nominated package. The signed local verifier covers its previously qualified five-member cases. Wider plan selection, verification and venue activation remain open. [Default comparisons](default-plan-verification.md#comparing-reductions-in-several-markets)

### Current two-market equations

For the set of claims being settled, let `W_m` be the sum of positive claims in a market, and `B_m` its initial P plus
own-cash collections. A mixed-sign account creates one link from its positive-claim
market to its remaining-debt market. For a link with face `w` and debt cap `d`, its
transfer at source recovery rate `r_source` is `min(d, w * r_source)`.

For each market, solve simultaneously:

```text
r_m = min(1, (B_m + I_m + incoming_link_recoveries) / W_m)
```

If `W_m = 0`, define its rate as one; reconciliation then gives no debt or pool to
pay. Of multiple fixed points, choose the **greatest** componentwise solution.
The insurance budget participates in the capacity equation, but actual consumption
is only `max(0, r_m*W_m - B_m - incoming_link_recoveries)`. Unneeded insurance stays
in its original reserve. Funding a cycle is not an extra entitlement.

Two cashless accounts with `(100,-100)` and `(-100,100)` illustrate why the greatest
solution matters. Rates `(1,1)` discharge the reciprocal claims with transfers
100/100 and **zero cash payout and zero insurance use**. The rates describe claim
discharge, not 200 atoms of new money. Starting from zero and waiting for a positive
cash inflow would miss this valid closed setoff. Conversely, when a cycle includes
external creditors, the complete equations retain those creditors; a keeper may
not cancel only a convenient pair and ignore the rest of the market.

Own cash collection is whole `min(C, floor(total scaled debt / S))`; apportion it
exactly by market debt. Use the greatest rates, starting with full snapshotted I.
Fractional insurance consumption clips that market's effective capacity to its
floor; each market clips at most once, at most three complete evaluations.

Round the complete claim/cash flow graph within each edge's floor/ceiling while
conserving every account and market node. Never give a global cross-market dust
award. Record each signed adjustment; each market's sum is zero, each adjustment
has magnitude below one atom, and final account cash differs by less than one atom
from the final whole-collection, clipped-capacity benchmark. Retained own cash
cannot be seized by rounding. This error bound does not describe the earlier
unclipped rational benchmark; uncollected sub-atom debt and clipped insurance
remain separately reported.

[Frozen profit and verification](default-plan-verification.md) explains how permitted forced reductions change creditor claims before the residual payout calculation. Clearing binds each member's payout to a complete plan, applies it once, and reconciles balances, market pools and SPL custody before resolved withdrawals. [Recovery measurements](../operations/validation.md)
