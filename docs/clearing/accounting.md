# Cash, claims and ordinary settlement

## Incremental backing candidate (P51B)

**Proposed successor, not implemented ordinary payment authority.** Schema 8 still
uses the restartable certificate below. G3 recommends maintaining proof contributions
as financial state changes, while separating an arithmetic validity region from
the freshness of the actual source accounts. This requires no user-visible pause
and does not make positive profit spendable without complete backing/pool cash.

For each market, a certificate epoch specifies a conservative rectangular range of
price and funding endpoints for **both** markets. The range includes the currently
admitted source/held-funding possibilities. For each root use checkpoint-adjusted
`z_m = v_m + q_m*F_checkpoint,m`, so `U_m = q_m*(M_m*S-F_m)+z_m`.
Moving a consumed funding checkpoint preserves z exactly; a new price does not
rewrite the root. At each corner compute own total negative claims, counting cash
once and no positive claims/reserves. An entry is bad for market m if it can owe m
anywhere in the region and its cash cannot cover the maximum gross debt in that
region. This sufficient condition may withhold a payout; it cannot excuse a losing
other-market claim. Claim conservation can be checked symbolically:
`sum(q_m)=0` and `sum(z_m)=P_m*S`, without restarting for every in-region observation.

Paged scans mark each entry's contribution processed for this certificate epoch.
Every later economic mutation of a processed entry atomically removes its old
contribution and installs the new one, in the **same clearing invocation** as cash/
q/v/claim changes. An unprocessed entry remains owed by the scan. Do not reject an
otherwise valid trade merely to keep its proof green: a newly unbacked entry sets
bad and blocks payment instead. Page summaries and a selected-market aggregate
track processed count, bad count and exact q/z sums; a payment cannot sum a private
subset of convenient pages. The complete financial index authenticates coverage.

This gives monotone scan progress within a fixed region despite changes to already
processed roots. It does not promise completion under infinitely fast new financial
membership or arbitrary oracle jumps. Membership changes must install a complete
neutral contribution or an explicit unprocessed entry atomically; no reuse of old
page coverage bits. Safety/terms or region changes start a new proof epoch. The
old epoch cannot silently certify an out-of-region source or funding endpoint.

At payment, still require current credible/fresh required sources, the actual
current/held funding endpoints **inside** the certified region, complete coverage,
zero bad entries, exact symbolic conservation, available P and recipient final
whole-account health/reservations. Fresh new observations inside the region need
not destroy an unchanged arithmetic proof. They must independently satisfy all
existing age, confidence, divergence and recovery rules. A region is not a way to
renew an old source timestamp or ignore unconsumed funding. If current points leave
the region, withhold payment and start a new region proof; funded-cash exits retain
their own local checks and never wait for that certificate.

P55B must specify the versioned certificate/summary layouts and authenticate every
mutation path: deposit, withdrawal, transfer, direct/stored fills, loss/gain, flat
netting, liquidation, entry/retirement, fee-driven cash changes and resolution/
recovery. Orders/delegation alone do not change economic proof contributions.
Pool changes update the selected symbolic identity; terminal changes invalidate
ordinary proof epochs. Every SDK/event/indexer path must carry the added declared
writes. This can add page/aggregate write contention; measure it against P40–P44
rather than assume an arithmetic improvement improves throughput.

The [executable summary model](../../tests/financial/incremental_backing_candidate.py)
checks already-admitted root mutations; its independent test enumerates all 16
two-market price/funding corners. It models neither authorization nor Solana
rollback, membership page authentication, source freshness validation or whole-
account trading admission. It cannot qualify P55B. Required signed acceptance is
continuous relevant sampling/trading with real RPC/WS/PG, interrupted scan/restart,
membership churn, newly bad/then repaired roots, mixed funding corners, exact
generation/revision checks and final-page/payment rollback. A fixed-region scan
must finish without resetting its cursor under bounded admitted mutation load.
Out-of-region movement and genuine insolvency must remain classified refusals.

Do not install a compulsory market pause, reserve positive profit as cash or accept
a stale proof to meet that test. If safe progress needs a coordinated window after
all, G3 requires a concrete scope/duration/exit-effects proposal and explicit user
approval. The current candidate makes no such departure.

### Checked maintained-backing kernel (P55B1)

`crates/financial-core/src/backing.rs` implements the arithmetic candidate; it is
not called by current program payment authority. `Region` contains two inclusive
price/funding rectangles within the existing numeric domains. `contribution`
validates an actual `margin::Margin`, then returns selected q, checkpoint-adjusted
z, a bad-debtor flag and the market source-dependency mask. Cash is counted once;
positive claims and reservations supply no additional backing. A q=0 fractional
claim remains exact. The selected exposed market requires its source; a potentially
negative selected claim also requires every exposed sibling market's source.

`Summary` maintains processed count, bad count, selected q and separate positive/
negative z totals, plus per-market dependency counts. Removal/replacement returns
a checked candidate; failures do not publish partial counters. A complete summary
checks `sum(q)=0` and `positive(z)=negative(z)+pool*S`. It is not a membership proof,
source attestation or payment instruction. Its 104-byte native checkpoint has an
explicit `RVBACK01` domain and rejects malformed lengths, counters and aggregate
bounds. This is a kernel checkpoint, not a new Anchor account/discriminator.

The aggregate bound follows the existing per-root contract:
`abs(z) <= MAX_SCALED + MAX_LOTS*MAX_FUNDING = 100100000000000000000000000`.
That is below 2^87; multiplying by at most u64::MAX Financial roots remains below
2^151. Reuse the three-word `ClaimTotal` representation, with checked subtraction
and count multiplication. Do not squeeze a population sum into i128 or truncate
opposite signs to fit. q totals fit i128 under the same u64 count / 100m lot domain.
These are representational proofs, not economic capacity or deployment acceptance.

The independent `test_maintained_backing.py` enumerates all 16 two-market corners
using the direct unpaid formula, checks literal financial transitions and compares
real Rust summaries/restored prefixes. Native diagnostic counts and actual tested
revision belong to validation/STATUS. P55B2 must separately qualify actual source
freshness, complete membership, mutation hooks, writable accounts and concurrency.

### Economic mutation coverage required before P55B activation

The inventory below is based on P55A2's actual source. No instruction may obtain
payment authority merely by updating a hash/count or calling this arithmetic.
For a processed root, remove its authenticated **before** contribution and install
its **after** contribution in the same instruction; for an unprocessed root, leave
it owed by the authenticated scan. q/z/cash must come from root bytes, never caller
assertions. Updates which make a debtor bad must remain valid financial actions
when their existing admission passes; they block payout rather than being rejected
to preserve an optimistic certificate.

| Actual mutation owner | Required maintained-proof behavior |
|---|---|
| `account_custody::cash`: active deposit | Include cash-only repairs of both selected-market debtor contributions; the old identical-position invalidation call is insufficient to calculate a delta without pre-deposit cash |
| `account_cash::cash::{withdraw,transfer}` through `account_cash::commit` | Update each donor/recipient from before/after cash and both q/z; preserve full funding, reservations, held corners and token-CPI rollback |
| `maker_liquidity::routes::commit::apply` for direct and stored routes | Update trader and both selected maker roots, including aggregate fee debit; complete the whole route atomically; no maker may write the summaries via CPI |
| `account_cash::claims::change` | Loss collection changes cash/z/pool; gain payment changes all three oppositely. Certify before payment, maintain the exact after identity, never invalidate an otherwise sound region solely for the pool change |
| `account_cash::claims::net` | Flat-only funded source/destination z and pools change together; cash stays unchanged; maintain both market summaries and keep owner/reservation rules |
| `account_safety::risk::liquidate` | Target and receiver update cash, inventory and z including the funded fee; preserve consent, IM, held funding and strict progress after fees |
| `account_trading::authority::{manage,delegate}` and `engine::markets::commit_model` | Order/reservation/delegate changes alone preserve economic contribution. Consumed funding changes v/checkpoint but exactly preserves z. Assert this equality on no-economic-write paths so future mutations cannot bypass maintenance |
| `account_membership::handlers::change` | Entry/exit must account for changed complete coverage and generation. Any invalidated proof must mark its entire old coverage unusable; no count-only reuse. Reentry cannot inherit old processed authority |
| Empty registration, permanent retirement and rent funding/refund | Preserve Financial membership semantics; no trader cash/claim contribution is manufactured from rent, empty identities or a tombstone |
| `account_safety::resolution::freeze`, `settlement::plan::lifecycle` Apply/reconcile, recovery/retirement | Frozen/terminal safety prevents ordinary payment; safety/epoch transition invalidates all old ordinary proofs before root/bucket changes can be reused. Recovery requires a fresh complete ordinary epoch |
| `account_custody::{cash,transfer}` in custody and `account_cash::cash::terminal_exit` | Zero obligations and non-active mode are explicit boundaries, not bypasses for a live debtor. Re-entering active safety cannot reuse a pre-transition proof |
| Oracle sampling, funding publication/materialization and terms/config changes | In-region fresh samples and pure checkpoint consumption preserve arithmetic. At use, recheck current sources, all relevant held endpoints and epoch/terms. Out-of-region or incompatible terms require a fresh proof, never timestamp renewal |
| Insurance seed/fee allocation/retained-fee withdrawal, liquidity updater/control | These do not directly change root cash/q/z or settlement pools; retain their existing authority/bucket and route fences. No insurance, retained fee or published maker quote becomes backing credit |

P55B2 must choose and measure the physical summary placement. Existing relevant
market ledgers already serialize financial changes; storing maintained totals
there with per-root processed epochs may avoid adding a new page write to every
trade. This is an implementation candidate, not an accepted lock/CU improvement.
A bounded scan would write the scanned root's processed marker and selected-market
summary; it must retain the complete live-index and final-page/payment rollback
proof. Any membership restart must be observable and include an invalidation/retry
denominator. No new global writable registry is permitted on ordinary trading
merely to simplify proof maintenance. No mandatory pause is authorized here.

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
fraction. Persist consumed relevant market prefixes in the same transaction. Accrual validates
the complete input and output plus each changed position; admission evaluates
per-market rounded IM and negative claims in one traversal. Reusing those checks
never credits positive claims or omits an isolated-slot/bound check.
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
Missing/reordered/duplicate roots or changed required stamps restart/reject. The
worker submits the final page and gain payment in one atomic original. Earlier
pages still need a stable required-observation/liability window: P42 measured three
deliberately observation-interleaved failures and one coordinated-window completion,
not a normal-traffic availability estimate. The scan only reads roots even when
the later payment promotes its beneficiary writable in the complete message.
Payment remains limited by actual selected P; an unpaid-profit certificate may
need coordination with concurrent relevant activity. Funded withdrawal needs none.

Netting requires no live orders/protections; terminal unused records do not retain
execution rights. Deposit, transfer, withdrawal, collection and gain payment all
retain exact negative/fractional claims and any required reservations. Recovered
Custody/Resolved/Retired cash exits need flat/no-claim/no-live-order state, not
virgin nonces/generations or invented fresh prices. Frozen partial resolution
permits no ordinary cash mutation.
