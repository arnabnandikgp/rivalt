# Cash, claims and withdrawals

Collateral has six decimals. BTC uses 1,000,000 lots per BTC and ETH uses 100,000 lots per ETH. The internal claim and funding scale S is 10⁹. At a common price and fully accrued snapshot, C is funded cash, U is the signed market claim in scaled atoms, q is signed lots, and P, I and T are a market’s settlement, insurance and retained-fee balances.

```text
allocated V = sum(C_a) + sum_m(P_m + I_m + T_m)
actual SPL vault >= allocated V; difference is unclassified surplus
sum_a(q_a,m) = 0
sum_a(U_a,m) = P_m * S
risk equity = C_a*S + sum_m(min(U_risk_a,m, 0))
```

Neither a positive claim nor a reserve is account cash. Portfolio metadata has no
balance. Each operation checks the canonical complete position/order dependency
set, checked counters/bounds and final required reservations. Token gateways also
authenticate actual custody; internal transitions conserve root/ledger entitlements
without loading the shared token vault. Complete checkpoints independently reconcile
all root cash and market pools against allocated and actual tokens.

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

Withdrawals and donor-side transfers use the funded-exit checks.
Materialize each consumed relevant funding prefix in its market in the same
transaction. Signed funding indices may decrease with a new valid negative premium;
a consumed historical interval must never disappear or reverse on hold expiry.

## Ordinary payment certificate

A certificate belongs to **one market**, and scans the complete stable registry.
For every negative claim to that market, require its account's own C to cover all
of its gross negative claims, including the other market; count C once and exclude
positive receivables and insurance. Check conservative source/funding corners for
exposed debtors. Authenticate selected-market exposure/claim sums against its pool.
Insufficient liquidity still limits each payout, even if every debtor is solvent.
An unrelated insolvent ETH-only account does not block a fully backed BTC payment.
An underfunded debtor to both markets blocks ordinary payments in both.

The current maintained certificate binds membership, safety, terms and its
conservative region/processed epochs. Admitted changes replace processed
contributions atomically. Fresh in-region observations do not restart coverage;
new Financial membership or incompatible terms invalidate it. Complete proofs
still check current sources and every held-funding endpoint at payment. The
restart-on-every-observation behavior belonged to the schema-8 predecessor.
Payment remains first-admissible landed order, not a FIFO/pro-rata queue, and
already paid cash is not clawed back for a later gap. Funded exits use their own
whole-account admission below, not this ordinary profit-payment certificate.

### When the trader closes against a different maker

Suppose a trader buys one lot at 60,002 collateral atoms from A and sells it at
60,998 to B. The trader is flat with a fixed positive claim of 996 atoms. A stays
short and B stays long. At an index of 61,000, A owes 998 atoms and B is owed two.
The traders' and makers' claims sum to zero. Each fill charged the trader 13 atoms,
so paying the entire gain leaves the trader 970 atoms ahead of their deposit.

A keeper can collect A's loss while A is still short. Collection moves A's funded
cash into the market settlement pool. A separate, backed payment moves cash from
that pool to the trader and reduces their unpaid claim by the same amount. For
example, a 300-atom payment leaves a 696-atom claim. Only funded cash can leave the vault on withdrawal.

Clearing applies a payment closed-first and tracks the already-paid price profit on surviving lots. [Attribution](default-plan-verification.md)

### Candidate for ordinary payouts on closed quantity

In the native model, selling part of a long or buying back part of a short makes the price profit on that quantity eligible. The remaining lots keep their exact average entry. For example, buying 1,640 lots at 61,002 atoms and selling 820 at 61,998 realizes 816,720 atoms (0.816720 test collateral). A backed payment of that amount leaves 820 lots open. The same rule applies to maker inventory.

At the same fully accrued market snapshot, let `U` be the signed unpaid claim, `G` the signed price gain on the surviving lots at their exact basis, and express both in scaled atoms. The candidate's whole-atom ceiling is `floor(max(0, U − max(0, G)) / S)`. This keeps an open loss in the net entitlement. Positive and negative accrued funding, previously collected cash and earlier payments stay in the fixed component. For example, if clearing collected 20 atoms during a price decline and the price recovers, the account can recover those 20 subject to backing. An additional 10 atoms of open price gain still require a reduction. Available market cash, the backing certificate and recipient health further limit every payment.

This rule is under native qualification for fresh accounts. It changes the timing of cash availability for a maker carrying profitable inventory. Existing deployment identities use the ordinary payment contract above. Accounts with prior open payouts need their original interpretation. [Executable comparison and qualification boundary](../operations/qualification-scorecard.md#closed-quantity-payout-comparison)

## Funded exits

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

The owner can withdraw available funded cash when the result passes whole-account admission. A payout from the market settlement pool requires a valid backing certificate. Exposure in either market may require fresh funding and index inputs.

## Market totals

The originating market owns its insurance and protocol-fee share. Local lane fills record the full fee and changes in exposure at the designated registration. Consumers that need materialized totals checkpoint all required lanes first. Classifying fees respects the 25% split and the exact carry across fills. A capacity generation binds the reserved lot capacity per lane. Account-local guards still cover both counterparties, inventory, signed terms and aggregate solvency. [Fee accounting](../../crates/financial-core/src/fee_lanes.rs) · [Routing](../liquidity/routing.md)
