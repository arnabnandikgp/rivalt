# P22B — complete-cohort clearing references

26 October 2026 · D59 reference · specification evidence, not a program

D60 completes the [bounded executable contract](P22B-EXECUTABLE-CONTRACT.md).
This document retains the original Fraction benchmark and its development limits;
the separate integer schedule and inert layouts address those G17 obligations.
Actual program/runtime acceptance remains phase-owned.

This develops D57's selected market-attributed loss policy with D58's attributed
insurance. It covers mixed-sign accounts and cycles that the earlier restricted
comparison intentionally rejected. A second candidate maps the result to whole
cash atoms with explicit market-preserving rounding. Both use arbitrary-size
rational internals; they do **not** finish the fixed-point/overflow proof, normal
gain-payment eligibility, frozen stage authority or layouts. Preserve V1/V2 and
keep the new profile disabled.

Run `python3 tests/financial/test_clearing_network.py`. The
[rational reference](../tests/financial/clearing_network_reference.py) imports only
Python exact arithmetic and the independent account model, never Rust/SDK/program
code. Its [literal/closed-form tests](../tests/financial/test_clearing_network.py)
are economic reference evidence; P24–P26 must later compare the actual implementation
and signed compiled programs against qualified cases.

## 1. Complete frozen input and economic priority

There are exactly two markets, one collateral mint and at most 64 complete account
rows, including isolated makers and liquidation receivers. Every row contains its
own funded cash and both fully valued/accrued claims at the frozen endpoints. An
absent position contributes zero; a caller cannot omit a losing claim. Per-market
claim sums must equal the corresponding settlement pools. Actual production must
also authenticate the registry, prices/funding, source bounds and frozen state;
the model's array length and identities are not substitutes for those proofs.

For account `i` and market `m`, write positive claim `w_i,m = max(U_i,m,0)` and
debt `d_i,m = max(-U_i,m,0)`. The rational benchmark uses these priorities:

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

These are terminal simultaneous-clearing obligations. They do not grant positive
unpaid margin credit, authorize a live claim transfer or allow an ordinary account
to spend an uncollected receivable. The owner-authorized normal flat-netting
instruction still needs its separate admissibility and ledger transition contract.

## 2. Exact equations and cycles

Let `W_m` be all original positive claims in a market, and `B_m` its initial P plus
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

Each response curve is monotone, capped and piecewise affine, with a breakpoint
where a link reaches its debt cap. The reference enumerates the exact branches of
both curves, solves the two linear equations on each branch, validates the original
equations, and chooses a solution dominating every candidate. A singular closed
cycle uses the greatest compatible branch endpoint. There is no numerical tolerance
or arbitrary iteration timeout. With at most 64 links across the two destinations,
the simple segment bound is `(32+2)^2 = 1,156` pairs; this is a reference-operation
bound, **not** a measured SBF/CU/packet guarantee. Python fraction numerator and
denominator growth still require a separate bounded on-chain representation proof.

## 3. Independently specified cases

All amounts are illustrative quote atoms, not tokens or live observations.

| Case | Exact expected result |
|---|---|
| Fully funded BTC debtor/winner; unfunded ETH debtor/winner, 100 each | BTC winner 100, ETH winner 0; no blanket 50/50 haircut |
| One debtor C=100, debts BTC=80/ETH=80, I=20/10 | Collections 50/50; winners 70/60; insurance use 20/10; remaining writeoffs 10/20 |
| Cross claim `(+100,-100)`, source BTC debtor C=40; I=10/20 | BTC rate 1/2, ETH rate 7/10; link recovery 50; ETH winner 70; cross account receives no extra cash |
| Reciprocal `(+100,-100)` / `(-100,+100)`, no cash | Full reciprocal setoff; zero payout/insurance, including with available reserve capital |
| Reciprocal `(+20,-5)` / `(-20,+5)`, no cash, I=10/99 | Rates BTC=3/4, ETH=1; links capped at 5 each; first account cash entitlement 10; insurance use 10/0 |
| Reciprocal 100 links, external winners 50 each, external debtors 50 each with C=10/0 | Rates 3/25 and 2/25; link recoveries 12/8; external cash entitlements 6/4 |

The symmetric-cycle family independently solves
`(k+e)*r_BTC - k*r_ETH = b_BTC` and its ETH counterpart. The closed-form rates are
`((k+e)*b_BTC+k*b_ETH)/(e*(2*k+e))` and the exchanged expression. Check 378 small
funded combinations, plus a `k=10^12, e=1` case where iterative convergence would
be impractically slow. Include all 64 rows, market-label and participant-order
permutations, missing-market claims, fabricated pool cash and fractional ownership.

## 4. Conservation and what the model does not prove

For each row, final rational cash is starting C minus own collections plus recovered
positive claims minus its outgoing capped link. It is nonnegative. Each market's
remaining debtor obligations receive proportional insurance coverage; subsequent
debtor writeoffs exactly equal that market's creditor impairment. Final rational
cash plus unused insurance plus unchanged T equals initial C+P+I+T. These assertions
are checked independently of any token transfer or runtime projection.

Gross impairment across both markets can count the same failed economic chain at
multiple claim layers. Do not report the sum as additional missing vault cash.
Report market attribution, internal recoveries and actual cash/insurance movements
separately. Intermediate link recoveries are not external deposits or venue revenue.

**Whole-atom counterexample:** accounts have claims `(2,-1)`, `(1,0)`, `(-3,0)` and
`(0,1)`, all with zero cash, and insurance `(1,1)`. Rational rates are `(1/3,1)`;
insurance use is `(1,1/3)` and cash entitlements `(0,1/3,0,1)`. This is algebraically
conserved but not executable with whole-atom I/C. Flooring only insurance while
keeping payouts creates 1/3 atom. Even integer inputs therefore need a complete
deterministic atom-finalization rule, not an integer cast at the end of this model.

`has_fractional_cash_effects` exposes such outputs; false does not prove fixed-point
representability, source/authentication, fairness after rounding, numeric bounds or
program acceptance. The existing restricted integral comparison remains available
as its original regression and is not silently renamed as this general benchmark.

Section 5 addresses monetary finalization at the model level. Before G17 closes,
prove the bounded executable numeric representation and staged implementation
envelope. Then finish normal payment/netting, terminal recovery, exact layouts and
phase-qualified enforcement. No extra product choice or risk relaxation is required
to continue that engineering work.

## 5. Whole-atom output candidate

`clear_atom_cohort` produces whole C and I outputs while retaining the two market
balances independently. It is still an arbitrary-precision reference, not an SBF
implementation. Its exact priority/rounding steps are:

1. **Collect only whole owned cash:** use `min(C_i, floor(sum(d_i,m)))`, then assign
   its exact proportional market obligations. Retain the remainder in the debtor's
   funded cash. In particular two accounts owing 1/2 atom each do not each lose a
   full atom; their sub-atom debts remain in the complete impairment calculation.
   Opposite unpaid profits cannot shield whole funded cash from own gross debts.
2. **Find integral insurance consumption:** solve the greatest rates with each
   market's actual I as its initial capacity. If actual insurance use is fractional,
   reduce that market's *effective capacity* to its floor and re-solve. The unused
   reserve is retained, not transferred or erased. No insurer is rounded up.
3. **Round a conserving network:** construct account and market nodes. Each market
   supplies its whole P plus the now-integral insurance spent; each account supplies
   its starting whole C. Edges are the exact creditor receipts, debtor payments
   (including capped links) and each account's final cash entitlement. Round every
   edge within its floor/ceiling while conserving every node. A global winner-only
   allocation is forbidden: it could give two BTC winners both independent markets'
   atoms and leave the ETH winners with none.
4. **Record terminal adjustments:** for each account/market, record actual signed
   cash movement minus its exact signed movement. Each adjustment has magnitude
   below one atom, each market's adjustments sum to zero, and each account's final
   cash differs from its final reference entitlement by less than one atom. The
   cash retained after step 1 cannot be seized by rounding. Apply each adjustment
   explicitly when discharging the final claim; do not silently drop fractions.

Step 2 takes at most three reference evaluations for two markets. Fractional use
means the market's rate is one: a lower rate exhausts its integer capacity exactly.
Reducing that capacity below the amount needed makes the rate strictly lower.
Other capacity reductions cannot increase any greatest rate. That market therefore
uses its whole new capacity in subsequent evaluations and cannot require clipping
again. Each nonterminal evaluation clips at least one new market. The tests include
a case requiring both successive clips; neither a timeout nor convergence tolerance
is used to end this process.

Step 3 subtracts the floor from each exact edge. The remaining edges have capacity
zero or one and integer node deficits/surpluses. The original fractional residual
is a feasible flow, so an integral maximum-flow completion can meet those same
integer demands. The reference uses deterministic depth-first augmenting paths,
preferring larger forward remainders, then stable target/edge identity; reverse
edges allow earlier choices to be repaired. This recovers the larger-remainder and
stable-ID result for unlinked single-market awards while preserving the constraints
of linked markets. It does not claim to maximize an additional global fairness
objective. A keeper cannot choose the tie order or omit a row.

There are at most three original edges per account (two claims and final cash),
so at most 192 flow augmentations for 64 accounts; each augmentation must traverse
a unit-capacity original residual edge. These finite reference bounds do not yet
prove Solana transaction cost or bounded storage for rational numerators. P26 must
qualify the persisted implementation's actual stage/packet/account/CU envelope.

For section 4's counterexample the candidate spends insurance `(1,0)`, retains
the other market's atom and pays `(0,0,0,1)`. BTC and ETH terminal adjustments each
sum to zero. Cashless fractional cycles still produce zero cash/insurance use.
Independent markets each keep their own atom even if every claimant has a half-atom
entitlement. These are independent literal expectations, not another invocation of
the solver as the expected value.

The less-than-one-atom final account bound is against the **final whole-collection,
clipped-capacity benchmark**, not the unconstrained ideal of sections 1–4. Whole
collection can leave less than one atom of debt per account uncollected; insurance
clipping can retain less than one previously indicated insurance atom per clipped
market, with propagation through claim links. Report these separately from terminal
rounding; do not hide a different ideal behind one dust bound. All uncollected debt
and creditor impairment remain exact in the reference.

This prospective two-market rounding candidate refines the single-pool D19
allocation approach only in the new-profile design. Existing V1/V2 behavior stays
unchanged. Numeric/encoding bounds, precise paginated persistence, normal netting/
payment eligibility, terminal recovery and layouts still prevent G17 closure.
