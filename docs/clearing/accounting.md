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
| Ordinary gain payment x | Whole x within the closed-quantity ceiling below, x<=P_m, valid complete market payment certificate and recipient final health: P_m−x/v_m−x*S/C+x. No I/T use, rounding up or borrowing |
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

### Acceptance contract for ordinary payouts

The successor must preserve these outcomes while removing membership traversal
from ordinary payment. This example uses whole collateral atoms, two flat ETH
creditors owed 50 each and a solvent recipient with no reservations.

| State immediately before the claim | Required outcome |
|---|---|
| ETH pool 60. Charlie owes ETH 40, has 40 cash and owes nothing elsewhere. | Either creditor can claim 50 directly. The landed payment leaves 10 in the pool. |
| The first creditor has been paid. Charlie still covers the 40. | A request by the second creditor for the full 50 must wait for collection. Collect 40 from Charlie, then pay 50. Both creditors now hold 50 cash and the pool is empty. |
| ETH pool again 60. Charlie still owns 40 cash and owes ETH 40, but now also owes BTC 30. | Ordinary ETH payment and selective collection from Charlie refuse. The missing 30 cannot be assigned to BTC by paying the first ETH caller. |

The third state can arise from a BTC price change while Charlie is idle. Clearing
must distinguish it at the first subsequent payout, before keeper intervention.
A stale input or insufficient proof also blocks payment, but does not establish
default. Record unsafe, unavailable, waiting for cash and paid outcomes separately.
Preserve partial-payment ceilings, exact fractions, recipient health and the
existing owner withdrawal of funded cash. [Qualification gates](../operations/qualification-scorecard.md#payout-and-cross-margin-work)

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

### Ordinary payouts on closed quantity

Selling part of a long or buying back part of a short makes the price profit on that quantity eligible. The remaining lots retain the same entry-cost bounds. For example, buying 1,640 lots at 61,002 atoms and selling 820 at 61,998 realizes 816,720 atoms (0.816720 test collateral). A backed payment of that amount leaves 820 lots open. The same rule applies to maker inventory.

A fresh margin account stores lower and upper bounds `L,H` on the total scaled entry cost of a reference quantity `Q`. One atom is one millionth of a collateral token and `S = 10⁹` scaled units per atom. An opening fill sets both bounds to its exact gross times `S` and records its quantity. Selling part of a long or covering part of a short leaves all three fields untouched. When adding inventory to `q` surviving lots with new gross `g` and size `n`, write `floor(L*q/Q) + g*S`, `ceil(H*q/Q) + g*S` and `Q = q+n`. A flip uses the full crossing execution's gross and quantity as the new reference. A full close clears the record.

The interval always encloses the exact weighted entry. Its width starts at zero. At an increase the new width is at most the old width times `q/Q` plus two scaled units, hence at most `2(q+n)` if the old width was at most `2Q`. Reductions preserve that invariant. Within the 100-million-lot domain the uncertainty in the remaining total cost is at most 0.2 of one collateral atom.

At the same fully accrued market snapshot, let `U` be the signed unpaid claim and `G` the greatest signed price gain consistent with the surviving entry bounds, in scaled atoms. Use `L/Q` per lot for a long and `H/Q` for a short. The whole-atom ceiling is `floor(max(0, U − max(0, G)) / S)`. This keeps an open loss in the net entitlement. Positive and negative accrued funding, previously collected cash and earlier payments stay in the fixed component. For example, if clearing collected 20 atoms during a price decline and the price recovers, the account can recover those 20 subject to backing. An additional 10 atoms of open price gain still require a reduction. Available market cash, the backing certificate and recipient health further limit every payment.

At the same snapshot, the conservative ordinary ceiling can delay one atom compared with exact fractions. Successive reductions with the same fills, gross and funding snapshot produce the same final ceiling whether submitted together or separately. At flat the actual claim sets the ceiling. In default use the opposite endpoint for the least seizable gain. At an integer price boundary this can reduce recovery by up to one atom per matched lot relative to exact arithmetic, further capped by the claim and shortfall. The ordinary bound is per observation and the forced bound is per matched position, not a lifetime venue-wide loss bound.

Fresh local accounts use the closed-quantity contract. It applies to ordinary trader and maker payments. Collection of losses, funded withdrawals and complete frozen resolution each retain their own admission rules. Historical RVPROF01 accounts use their original deployment. [Signed payouts and wallet exit](../operations/performance.md#closed-quantity-settlement)

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

The owner can withdraw available funded cash when the result passes whole-account admission. The default deployment requires a valid backing certificate for payment from the market settlement pool. Exposure in either market may require fresh funding and index inputs.

On the local `shadow-coverage` build, clearing can also record a member’s funded cash, signed lots and funding-adjusted claims in a separate PDA. Eight PDAs partition members by stable ID modulo eight. Each observation prices these rows against the clearing program’s current BTC/ETH risk and held-funding endpoints. The comparison fixture updates every affected member in the financial transaction, checks bootstrap completeness against the registry and audits writes against finalized history. A change in financial membership invalidates the fixture’s observations. The certificate remains the sole backing authority for payouts. [Qualification and scope](../operations/qualification-scorecard.md#clearing-owned-coverage-during-a-cold-eth-payout)

### Clearing-maintained debtor coverage

The fresh local `maintained-coverage` build opens eight clearing-owned accounts before the first financial member joins. A member’s stable ID selects its account modulo eight. Joining inserts the member’s row. Leaving removes it. Rejoining inserts a fresh row, even if membership changed several times in another lane. Terminal retirement replaces an already deactivated root with its tombstone and updates the identity registry. Its coverage row was removed at deactivation. Each lane has room for 16 members in this build. A full lane refuses another join until space becomes available in that same lane. A registered identity keeps its assigned lane when it retries. The [128-member run](../operations/performance.md#direct-payout-at-128-financial-members) exercised this with an unused recovery seat and a vacancy in another lane.

For each margin account declared as written, clearing compares its financial state before and after the handler. It records funded cash, signed BTC/ETH lots, and each market’s virtual balance plus lots times the funding checkpoint. The instruction carries the required writable lanes after its normal accounts. Clearing authenticates each lane and the prior row, then writes the successor row inside the instruction. Omitting a required lane rolls back the entire operation, including token transfers. Two members in the same lane share one writable account. A revision change that leaves these values and financial membership intact needs no lane write. The separate row-copy instruction is disabled in this build.

A coverage read authenticates all eight lanes, checks their total population against the live financial registry and values them using current risk and held-funding endpoints. Removal can leave a conservative summary in place, which can increase the number of exact row evaluations. The existing certificate authorizes payments during this qualification. [Clearing commit](../../programs/clearing/src/shadow_coverage/maintenance.rs) · [Qualification](../operations/qualification-scorecard.md#clearing-owned-coverage-during-a-cold-eth-payout)

## Market totals

The originating market owns its insurance and protocol-fee share. Local lane fills record the full fee and changes in exposure at the designated registration. Consumers that need materialized totals checkpoint all required lanes first. Classifying fees respects the 25% split and the exact carry across fills. A capacity generation binds the reserved lot capacity per lane. Account-local guards still cover both counterparties, inventory, signed terms and aggregate solvency. [Fee accounting](../../crates/financial-core/src/fee_lanes.rs) · [Routing](../liquidity/routing.md)

### Market backing from maintained rows

The fresh local `verified-coverage` comparison reads the venue, registry, BTC and ETH markets, safety account, selected market ledger and eight coverage lanes. It requires active clearing, a nonempty complete financial membership and the canonical accounts. For the selected market, signed lots must sum to zero and the sum of all fixed claims must equal the settlement balance times the fixed-point scale. Each financial write maintains these sums in its own lane. The build adds 74 bytes to each lane for the two markets’ sums and position counts.

Clearing then checks each debtor against current index bounds and held funding endpoints. An open selected-market position requires that market’s source. An account that could owe the selected market and holds an open sibling position also requires the sibling source. A flat ETH debtor with open BTC exposure can therefore lose ETH backing when BTC falls, even while the ETH settlement balance stays constant.

A successful observation returns one for covered and zero for underfunded. Unavailable required sources, incomplete membership and failed conservation return errors. The result is a read at the executing slot. The comparison grants no reusable payout permission. The ordinary credit instruction still checks the existing certificate, closed-quantity ceiling, available cash and recipient health.

### Atomic credit of closed profit

On the fresh local `direct-closed-credit` build, anyone can submit `pay_account_gain` with an absent certificate and all eight coverage lanes in canonical order. The recipient must be a financial member. Clearing reads both markets, authenticates the current member set and verifies market backing against the settlement balance at execution. The recipient’s lane must be writable. The remaining seven lanes can be read-only.

The same instruction checks the closed-quantity entitlement, available settlement cash and the recipient’s post-payment margin. It debits the market pool, reduces the unpaid claim, credits the recipient’s funded cash and updates its coverage row. Failure rolls back the entire transaction, including its market and fee checkpoints. Cash enters the recipient’s own margin account. Only its authorized owner can withdraw it to a token account.
