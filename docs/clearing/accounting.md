# Cash, claims and ordinary settlement

## Cash, claims and normal transitions

Use the existing 10^9 claim/funding scale, i128 normal claims/checkpoints, exact
participant fractions, BTC/ETH lot sizes, quantity/price/cash bounds and 10%/5%
synthetic IM/MM. Existing source, six-second recovery, causal funding, held-window,
order/TP-SL, two-maker FOK and post-fee liquidation parameters are retained.

At a common fully accrued snapshot:

```text
allocated V = sum(C_a) + sum_m(P_m + I_m + T_m)
actual SPL vault >= allocated V; difference is unclassified surplus
sum_a(q_a,m) = 0
sum_a(U_a,m) = P_m * S
risk equity = C_a*S + sum_m(min(U_risk_a,m, 0))
```

Neither a positive claim nor a reserve is account cash. Portfolio metadata has no
balance. Each operation checks the canonical complete position/order dependency
set, checked counters/bounds, final required reservations and actual custody.

| Transition | Exact changes / eligibility |
|---|---|
| Deposit d | Owner/source token signature, d>0, unfrozen: C/V +d, actual SPL CPI. No source freshness needed and no trading permission granted |
| Funded withdrawal d | Owner/destination, d>0: C/V −d atomically after full own post-state IM/reservations and every held-funding corner. Flat fixed claims need no artificial price. No global solvency/payment certificate |
| Cash transfer d | Owner of both distinct venue roots: donor passes the withdrawal financial check, recipient accrues existing relevant funding; C_donor−d/C_recipient+d, V unchanged. No claim transfer or sibling guarantee |
| Fill | Paired q/notional-v deltas and complete final trader/maker health; preserve read-only bounded maker CPI and current routing/fee prefixes |
| Collected ordinary taker fee f | C−f; originating market I+=floor((carry+f)/4); T+=f−I_credit; carry=(carry+f)%4. No extra charge; failed route rolls back everything |
| Ordinary loss collection x | Whole x<=floor(−U_m/S), and the debtor's C*S covers **all gross negative common claims** after full accrual; C−x/v_m+x*S/P_m+x. Underfunded shared debtor goes to complete resolution, not caller-selected collection |
| Ordinary gain payment x | Whole x<=floor(U_m/S), x<=P_m, valid complete market payment certificate and recipient final health: P_m−x/v_m−x*S/C+x. No I/T use, rounding up or borrowing |
| Explicit flat netting x | Owner only, cross, both q=0, no live orders/protections, source payment certificate; x whole <=min(floor(U_source/S), floor(−U_destination/S), P_source). P_source−x/P_destination+x; v_source−x*S/v_destination+x*S; C unchanged |
| Reserve seed / extra allocation | Actual authorized donor transfer V/I_m +z, or fee authority T_m−z/I_m+z. Direct donations remain unclassified until explicit classification |
| Retained fee withdrawal | Fee authority, active/custody/resolved/retired and not paused/frozen, correct mint/destination and z<=T_m: T/V−z. Fees are excluded from creditor backing |

Normal netting is deliberately **funded**. If backing is absent, keep both claims
and their gross-negative risk requirement. The keeper automates admissible payment/
collection; it cannot promise immediate setoff. Cashless reciprocal cycles may be
discharged by complete exceptional clearing, where all external creditors and
insurance are accounted for. No new perpetual inter-market IOU or claim-purchase
facility is introduced. Ordinary fractions remain with the account, including flat
close/reopen; only terminal resolution applies explicit rational rounding.

The funded-exit proof and held-corner checks below apply to withdrawals and transfers.
Materialize each consumed relevant funding prefix in its market in the same
transaction. Signed funding indices may decrease with a new valid negative premium;
a consumed historical interval must never disappear or reverse on hold expiry.

### Ordinary payment certificate

A certificate belongs to **one market**, and scans the complete stable registry.
For every negative claim to that market, require its account's own C to cover all
of its gross negative claims, including the other market; count C once and exclude
positive receivables and insurance. Check conservative source/funding corners for
exposed debtors. Authenticate selected-market exposure/claim sums against its pool.
Insufficient liquidity still limits each payout, even if every debtor is solvent.
An unrelated insolvent ETH-only account does not block a fully backed BTC payment.
An underfunded debtor to both markets blocks ordinary payments in both.

Bind certificate progress/completion to membership version, safety epoch, relevant
liability versions and all price/funding observations required by that scan. Pages
are canonical read-only roots; a changed stamp restarts, never silently continues.
Normal payment remains first-admissible landed order, not a FIFO/pro-rata queue.
Already paid cash is not clawed back for a later price gap. Scoped certificates may
still be invalidated by relevant activity; funded withdrawals do not depend on them.
This preserves the distinction between profit-payment timing and funded-cash exit.


## Funded-exit proof and checks

At one authenticated on-chain snapshot, express claims in collateral atoms
(exact fractional values, dividing scaled storage by S), and let:

- `C` be this account's whole-atom funded cash, counted once;
- `U_m` be its fully accrued common claim in market m;
- `L_m <= U_m` be its conservative risk claim at the same funding endpoint;
- `B = sum(max(-L_m, 0))` be its conservative total negative obligations;
- `H = IM + R` be nonnegative initial margin plus refreshed remaining reservations;
- `w` be the requested whole-atom cash withdrawal after applicable cash costs.

Require `0 < w <= C` and `C - w >= B + H`. Then the account still has at least
enough cash to cover every negative common claim in full, since
`sum(max(-U_m,0)) <= B <= C-w`. Its current gross and account-net cash shortfall
are both zero. Other accounts' cash/claims and settlement/insurance/fee pools do
not change. Under `V = sum(C_a) + P + I + T`, changing this C and V by the same
`-w` preserves the identity. The same cash argument works with explicitly separate
settlement pools, provided their claim/ownership identities are maintained.

Consequently this operation does not take settlement backing from unpaid creditors
or change another account's existing shortfall. This is a current-snapshot result,
not protection against a subsequent price gap, token depeg, dishonest upgrade or
missing on-chain dependency. It does not prove a gain payment safe: payment changes
both settlement backing and the remaining unpaid creditor population.

For an internal cash transfer, first admit the donor under the same inequality,
then add the amount to the recipient without duplicating it. The vault and total
cash are unchanged. Receiving cash does not by itself grant trading permission.
Owner, domain, freeze and recipient-binding checks still apply.

### Held-funding safeguards

Funded exits also check held-funding endpoint combinations. After withdrawal, require nonnegative account risk equity at every conservative
combination of its still-valid held-funding endpoints, in addition to current
`IM + R` admission. With two positions that means at most four corners. Equivalently
for these additive claims, use the lower risk claim in each endpoint pair.

For example, cash 100 covers each diagonal `(-60,+60)` and `(+60,-60)` separately,
but not the mixed `(-60,-60)` corner. The independent reference rejects that exit.
This post-withdrawal requirement preserves the funding-window
concern without demanding proofs about unrelated members.

Funding history must be irreversible, but the signed funding index need not be
numerically increasing. If an account consumes index 5 while the market persists
only 0, later hold expiry must not return its effective index to 0 and refund the
already-applied debit. Materialize every consumed relevant market prefix in the
same transaction. New valid negative premiums can legitimately lower the index.
The reference checks both the rollback counterexample and signed fractional accrual.

### Required program preconditions

1. Derive the complete market dependency set from canonical positions, nonzero
   claims, active orders/protections and the requested operation. Never let a caller
   omit a losing market. Account mode/role/market identities remain immutable.
2. Authenticate source bounds and include every pending funding debit at one Clock
   snapshot. Materialize consumed funding prefixes where necessary: a later sampler
   expiry/config change must not reverse funding already applied to an account.
   Check post-withdrawal held-funding corners as well as current admission.
3. Recompute all remaining reservations, fee budgets and protection generations.
   Cached UI/worker equity is not authority; deposited cash is not counted twice.
4. Serialize account/custody changes with Solana write locks; apply checks, state
   changes and the actual SPL token transfer in one transaction. A failed transfer
   or second instruction rolls back the financial effects.
5. Require owner-authorized destination, canonical token/mint/vault binding,
   available actual vault balance and maintained allocated-custody accounting.
   Observe the selected safety/freeze state. No exit during frozen default unless
   the final contract explicitly qualifies such a separate path.
6. Do not bind ordinary funded withdrawal to a historical all-member solvency
   certificate or unrelated event sequence. Relevant current health/freeze changes
   can still reject it. Reconstruct the exact event/custody effect independently.


## Units and causal accrual

Collateral has six decimals; one token is 1,000,000 atoms. BTC uses 1,000,000
lots/unit and ETH 100,000. Normal funding/claims use scale S=1,000,000,000,
checked i128 arithmetic and exact participant-owned fractions. Quantity magnitude
is bounded at 100,000,000 lots; virtual scaled claim magnitude at 10^26; funding
index magnitude at 10^15; funded cash at 10^15 atoms. Check the actual
[financial bounds](../../crates/financial-core/src/lib.rs) before changing arithmetic.

For signed quantity q, virtual claim v and checkpoint F_i, accrued scaled claim
is `q*M*S + v - q*(F-F_i)`. Accrue before changing quantity or evaluating cash
rights. A flat close/reopen retains its fraction; new entrants acquire no old
fraction. Persist consumed relevant market prefixes in the same transaction.
Reconciliation uses checkpoint-adjusted claims, not the sum of stored v alone.

The held index uses `base + trunc(premiumScaled * elapsed / 3600)` with elapsed
bounded by the original valid hold. Repeated partial materialization uses that
same prefix, avoiding compounded rounding. The index can decrease under a valid
negative premium; already materialized history cannot disappear on expiry.
[Funding](../liquidity/funding.md) owns the report/source/cadence contract.

## Fee and insurance ownership

The cumulative taker fee is `ceil(total executed gross / 5000)`. A stored-order
subfill charges the difference from its existing cumulative prefix; replacement
preserves that prefix. A two-leg route assesses one fee on aggregate gross, not
one fee per leg. Aggressive maker trades also pay taker fees. Provider-side fee
is zero; there is no quote/cancel tariff or automatic rebate.

The originating market receives one quarter of each collected fee using its
persisted modulo-four carry. Carry is a rounding counter, not collateral or an
insurance claim. Seeding I and explicit T-to-I allocations do not alter carry.
Freeze/recovery preserves it. Insurance is actual dedicated cash, finite and
market-attributed: ordinary profit payment cannot spend I, and a healthy market's
reserve is not silently swept into another. No active reserve redemption exists;
terminal reserve withdrawal requires irrevocable retirement and separate authority.
Donations while frozen stay unclassified and cannot alter snapshotted resolution.

## Ordinary payment refinements

A complete backing scan processes at most two read-only canonical roots per call.
Its selected liability version changes for root cash/claim mutations with selected
exposure or claims, including cash effects caused by another market. Unrelated
ETH-only activity does not become a BTC payment dependency. Required source and
held-funding stamps are checked again on consumption.

The 234-byte certificate's cash accumulator is cash in selected-exposed/claim roots,
not a common fungible backing pool. Its lots contain both sampled sums; only the
selected sum is certified. Each debtor independently covers all gross debt.
Missing/reordered/duplicate roots or changed required stamps restart/reject.
Payment remains limited by actual selected P; an unpaid-profit certificate may
need coordination with concurrent relevant activity. Funded withdrawal needs none.

Netting requires no live orders/protections; terminal unused records do not retain
execution rights. Deposit, transfer, withdrawal, collection and gain payment all
retain exact negative/fractional claims and any required reservations. Recovered
Custody/Resolved/Retired cash exits need flat/no-claim/no-live-order state, not
virgin nonces/generations or invented fresh prices. Frozen partial resolution
permits no ordinary cash mutation.
