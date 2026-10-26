# P22B — schema-3 account-centric financial contract

27 October 2026 · D60 · fresh bounded local profile · G17 contract

This completes the design-level obligations left open by
[P22B's analysis](P22B-FINANCIAL-CONTRACT.md) and
[D59's clearing reference](P22B-CLEARING-REFERENCE.md). It is normative for the
fresh schema/profile 3 only. Inert Rust layouts and independent executable models
are contract evidence; there are no new financial entrypoints or deployment here.
P23–P28 must qualify their actual implementations. V1/V2 remain unchanged.

## 1. Implementation gaps and exact replacement boundary

| Existing implementation | Schema-3 contract | Acceptance owner |
|---|---|---|
| `state/v2/group.rs`: group owns identity, membership, common pools, sequence and mode | Separate VenueV3, VenueRegistryV3, CustodyV3, SafetyV3 and per-market MarketLedgerV3 | P23 |
| `state/v2/margin.rs`: group-scoped portfolio/root | Venue-scoped portfolio/root, immutable child mode/role, registry market eligibility | P23 |
| `group_margin/trading.rs`: both observation IDs and group sequence committed | Bind root authority/nonce, safety/terms, selected maker epoch/consumption and user limits; re-evaluate current relevant source/funding state | P24 |
| `group_safety/settlement.rs`: certificate required for funded exit | Atomic own-account full health/held-funding checks and actual token transfer; no certificate for funded cash | P25 |
| Same settlement module: common gain pool and group certificate | Market pool, scoped complete-market payment certificate, whole-account debtor coverage; insurance excluded | P25 |
| `group_margin/netting.rs`: cancel opposite claims without cash | Owner-only flat funded pool-to-pool transfer; never delete an unfunded inter-market obligation | P25 |
| `group_safety/resolution/ledger.rs`: common account-net waterfall | D59 complete two-market clearing, verified greatest rates, integral insurance and per-market conserving atom rounding | P26 |
| V2 SDK/events/projection/workers/UI bind group identity/sequence | Explicit schema 3, venue account selection, independent ledgers and event ordering; original-signature recovery unchanged | P27/P28 |

Preserve two markets (BTC index 0, ETH index 1), one classic SPL six-decimal test
mint, 64 stable members including makers/receivers, four portfolios per owner,
children 0–8, two position slots, four orders and two protective pairs per root.
Child zero is Cross; positive children are Isolated. Makers are isolated. Cross
eligibility is immutable on market admission; both initial markets are eligible.
No identity reuse, market replacement, live conversion or dynamic listing is added.
A cross account uses the eligible registry, not a user-selected clearing group.
The bounded two-slot implementation is not a claim of unlimited market support.

## 2. Cash, claims and normal transitions

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

The funded-exit proof and held-corner obligation in P22B section 2 remain normative.
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

## 3. Authority, dependencies and linearization

The root owner controls collateral, flat netting, delegates and immediate/orders.
A delegate controls only that root's trading/orders until exclusive expiry or epoch
revocation; no cash/netting/admin rights. Maker registration gives standing pricing
authority over its isolated capital, with joint module approval and existing owner/
alias exclusions. A receiver signs its own liquidation and passes whole-account IM.
Permissionless maintenance can only execute stored authority or exact financial
rules. Venue, fee and reserve authorities are separate stored keys, initialized by
the clearing deployment's verified upgrade authority. They cannot bypass activation,
health, frozen membership or choose a creditor subset.

| Action | Must read/authenticate | Serializing writes / validity |
|---|---|---|
| Registration | Venue/mint, safety, immutable market eligibility, portfolio owner/index | Registry, portfolio/root, custody event sequence; membership version increments |
| Deposit | Venue, safety, root, classic token accounts | Root, custody and vault; dependent liability stamps; no oracle prerequisite |
| Withdraw/transfer | Root complete positions/book, relevant markets/sources, custody, safety | Roots, consumed relevant market prefixes, custody/vault as applicable; own nonce/state and safety. No certificate or global event sequence commitment |
| Trade/order execution | Owner/delegate or stored order, root nonce/version, market terms, maker identity/approval/epoch/consumption, relevant sources/funding | All touched roots, markets with consumed funding, selected registrations/ledger/custody; exact signed limits. No unrelated observation or historical event counter as automatic rejection |
| Place/replace/protection | Whole root and relevant sources, current generations/reservations, live signer authority | Root nonce/book/version and affected liability stamps |
| Cancel/revoke | Root/version/current authority, safety | Root/book/epoch; no fresh source or maker quote needed outside frozen ownership |
| Collect/pay/net | Root, selected ledger, full relevant funding/source state; pay/net certificate | Root, market ledger(s), custody and consumed funding; invalidate affected payment certificates after mutation |
| Liquidate | Complete target/receiver roots, credible relevant bounds and current orders | Target/receiver, selected market/custody; strict whole-account post-fee MM-deficit decrease and nonflipping exposure reduction |
| Freeze/resolve | Safety, complete registry, immutable source/funding/config endpoints, canonical pages | Safety, resolution/work/pages and exact financial apply; ordinary root mutations blocked |

A liability version advances for a root's economic change in each market where it
has nonzero exposure/claim before or after the change. This includes a cash change
caused in another market. Selected pool changes also invalidate that market's
payment certificate. Membership changes have a separate version. Relevant funding/
price changes invalidate certificate observation stamps. Event sequence exists for
history discovery only; it is not an immediate-order or funded-exit prerequisite.
Bound all checked counters and reject overflow, never wrap/recycle authority.

Every financial transaction uses one on-chain Clock and actual landed write-lock
ordering. Successful simulations/previews do not reserve state. Missing, duplicate,
foreign or aliased roots/markets/sources reject. Shared custody, market and maker
writes remain hot accounts; P24/P28 measure them rather than claim parallelism.

## 4. Exact bounded exceptional arithmetic

Normal state uses fixed-scale i128; terminal work uses **96 u64 limbs (6,144 bits)**
in unsigned little-endian encoding. No Fraction, float, unchecked cast, convergence
tolerance or unbounded allocation is part of the executable schedule. The integer
reference is [bounded_clearing_reference.py](../tests/financial/bounded_clearing_reference.py);
its independent oracle remains the separately implemented Fraction/branch model.

Let each frozen scaled claim have magnitude at most
`K = 10^26 + 3*10^23 < 2^87`, derived from retained normal v/q/price/funding bounds.
Own whole collection is `k_i=min(C_i, floor(sum debt_scaled/S))`. A single-negative
account has integral scaled collection `k_i*S` and a scaled-integer residual link
cap. Only a double-negative account with nonzero collection needs a denominator.
Let **L** be the product of those accounts' total scaled debts (use 1 if none).
Do not use an LCM requiring an unbounded gcd routine. At most 64 factors are each
below 2^88, hence `L < 2^5632`. Collections in scaled units share denominator L.

All positive totals, incoming unsaturated slopes and fixed link caps are sums of
at most 64 values below 2^87, hence below 2^93. For each branch the two equations are:

```text
W_0*r_0 - slope_0*r_1 = N_0/L
W_1*r_1 - slope_1*r_0 = N_1/L
```

`N_m/L` is P*S + collected scaled cash + I*S + capped incoming links, below 2^94.
A capped response replaces its equation by `r_m=1`. Non-singular determinants are
positive and below 2^186; numerators `N_0*W_1+slope_0*N_1` and its partner are below
`L*2^188`. A singular branch's greatest endpoint is a cap or link threshold, also
representable with a denominator factor below 2^186. Therefore rates can always
be represented `r_m = rate_numerator_m / (L*factor)` with `0<factor<2^186`.
Both rates share this denominator; canonical reduction is unnecessary.

All cash flows share `D=S*L*factor`. Original scaled claims multiply one rate
numerator; collection numerators multiply factor. Rate comparisons cancel common L
before cross multiplication. The largest scheduled intermediate is below 2^6016
(including comparison of two candidate sums); 6,144 bits supplies checked headroom.
Never cross-multiply two unreduced wide fractions. Remainder ordering compares
numerators over common D. Whole flow quotients are below 2^58, so division can use
at most 58 checked shift/subtract steps. Wide multiplication is only by bounded
small factors (at most three u64 limbs), not an unconstrained wide-by-wide product.

Debtor insurance attribution/writeoff is retained as a **factored exact record**:
residual numerator times `(total residual numerator - I_spent*D)` divided by
`D*total residual numerator`. Store the original row, final rates/flows, D and
market insurance totals, rather than expanding a roughly 12,000-bit diagnostic
product into normal state. Reconstruct exact writeoffs/impairments and signed
terminal adjustments from those committed factors. Their per-market identities
must reconcile; factoring does not discard a fraction or create a spendable asset.

### Untrusted rate proposal, complete on-chain verification

Keepers compute rates off chain; their proposal is not authority. The program
recomputes L, complete positive totals, exact collections and every capped incoming
flow from frozen authenticated rows. Check the two original min equations exactly,
rate bounds and factor bound. Then verify **greatest**, not merely fixed, rates:

- If either rate equals one, the other is uniquely fixed by its original response,
  so no componentwise greater solution exists.
- Otherwise compute each right-hand incoming slope from links **strictly below**
  their cap at the proposed rate. Require `slope_0*slope_1 < W_0*W_1`.

Each slope is bounded by the other market's complete positive population. Concavity
means increments above this point cannot exceed the right slopes; a product below
one rules out a greater fixed point. If the product equals one and both rates are
below one, a positive interval can advance both along the linear cycle, so this
is not the greatest solution. At an exact cap breakpoint the link is excluded
from the right slope. This rejects zero/partial cashless-cycle solutions while
accepting full setoff, and retains every external creditor. Empty W has rate one.
No trusted worker, timeout, administrator-selected rate or caller subset is needed.

Start insurance capacities at snapshotted I. Verify actual use from full flows;
if fractional, clip that capacity to its floor and repeat the complete verified
solution. Each market clips at most once; at most three evaluations. Persist the
clipped mask/evaluation. Never let a proposer begin with a smaller reserve budget.
Then perform D59's deterministic conserving circulation with integer remainders,
<=192 original edges, <=67 auxiliary edges, <=69 nodes and <=192 augmentations.
Record every whole flow and its signed exact adjustment; each market adjustment
sums to zero and final cash error is less than one atom against the final clipped
benchmark. Retained own cash is protected. No global cross-market dust award.

## 5. Frozen transitions, continuation and recovery

Freeze the complete venue liability cohort because shared debtors/cycles can connect
markets. Loss attribution remains market-specific even though this bounded safety
freeze is venue-wide. No claim of operational isolation is made.

Permissionless freeze requires a credible common-value net-bankrupt account, or a
fully flat account whose gross closed obligations exceed its funded cash. The
latter is an unpaid closed-debt trigger, not permission to seize other accounts'
healthy cash; complete clearing can discharge a cashless cycle with zero loss.
An exposed merely under-IM account is not bankruptcy. Retain the separately
specified authority source-emergency trigger after 30 seconds without credible
bounds; liquidity shortage alone is not a default proof.

Pin complete registry hash/count, safety epoch, source/config terms, both consumed
funding endpoints and credible common closeout prices. Missing required valuation
enters AwaitValuation, never a caller-chosen stale mark. No new funding while frozen.

| Persisted stage | Mandatory completion before advancing |
|---|---|
| AwaitValuation | Authenticate both required common prices and frozen F; freeze all membership/ordinary mutations |
| Value | Canonical pages, exact two claims, C, q/generations; verify total q=0, both claim sums=P*S and allocated custody |
| Denominator | Canonical pages build L and collection/positive totals, with checked wide arithmetic |
| RateProposal / Verify | Bounded chunks upload one untrusted rate pair/factor; complete rows verify equations/right slopes and insurance use. Stale epoch/proposal replay rejects |
| Clip / repeat | Exactly prescribed floor-capacity update, mask/evaluation progress; clear prior derived work and reverify complete rows |
| FlowPlan | Whole base flows and common remainders; canonical complete edge order, stable-ID ties, balances and bounded residual graph |
| Round | Deterministic remainder-priority DFS with repair arcs; persisted node/edge cursor/parents/capacities; caller cannot select a different augmenting path |
| Apply | Complete final plan first; apply each root exactly once, set cash, zero q/v/claim, advance generations, clear orders/delegates. Preserve market ownership of reserve/fee balances |
| Reconcile | Complete scan, zero exposure/claims/P, exact final C+I+T/allocated vault, all rows applied and each market adjustment zero |
| Resolved | Owner funded cash exits and fee withdrawal permitted; no ordinary trading until explicit recovery |

Pages have two stable rows; allow page operations of one or two rows without
skipping/reordering. Every continuation binds epoch/stage/cursor and required
canonical account keys. Partial proposal bytes cannot drive financial application.
Work arithmetic may continue after a bounded limb/edge budget without changing its
result. Storage accounts are precreated in the fresh profile; a restarted worker
needs only chain state. A proposer that disappears cannot lock authority: anyone
can replace an incomplete proposal before verification begins; after verification
starts only deterministic rejection/reset or exact continuation is allowed.
A complete wrong proposal resets rate-verification work, never frozen inputs or
collected funds; proposals cannot strand an epoch by consuming insurance early.

Compute insurance as a plan until Apply. Stage accounting uses the frozen ledger
plus applied-row bitmap/cursor: never add live and frozen representations twice.
No intermediate fractional flow becomes spendable C/P/I. Reserve use and final
P=0 occur once under the frozen plan; external direct donations stay unclassified.
Recovery requires venue authority, complete reconciliation and the unchanged
sustained valid source/recovery policy. Return to Custody, bump safety/terms epochs,
retain earned F and fee carry, then separately activate the qualified local profile.
No automatically revived orders, delegates, old quotes or insurance reset.

No active reserve redemption exists. Authority may irreversibly **Retire** only
a completely reconciled liability-free venue (after resolution or a complete
flat/no-orders/no-claims scan). Retired identities cannot reopen. Then reserve
authority may withdraw attributed I to the immutable reserve-destination owner's
canonical token account; owner C and T remain separately backed. A resume path
cannot sweep I first. This is terminal reserve custody, not LP shares or yield.

## 6. Exact layouts, encoding and deployment

Ordered Borsh fields in [state/v3](../programs/clearing/src/state/v3) are normative.
Anchor discriminator is the first eight bytes of SHA-256 of `account:<type name>`;
each includes schema u16=3. Integer seeds are little endian. Reused PositionV2 and
OrderBookV2 scalar records preserve 48-/680-byte encoding only, not V2 account
identity, handlers or common-loss semantics. All public JSON integers are decimal
strings with explicit units and schema.

| Account | PDA seeds after string prefix | Bytes including discriminator |
|---|---|---:|
| VenueV3 | `venue-v3`, domain[32] | 321 |
| CustodyV3 | `custody-v3`, venue | 83 |
| SafetyV3 | `safety-v3`, venue | 77 |
| VenueRegistryV3 | `registry-v3`, venue | 2,105 at 64 members |
| PortfolioV3 | `portfolio-v3`, venue, owner, u16 index | 79 |
| MarginAccountV3 | `margin-v3`, portfolio, u16 child | 970 |
| MarketV3 | `market-v3`, venue, u8 registry index | 447 |
| MarketLedgerV3 | `ledger-v3`, market | 109 |
| MakerRegistrationV3 | `maker-v3`, market, u8 maker ID | 326 |
| CapitalBindingV3 | `capital-v3`, capital | 106 |
| SettlementCertificateV3 | `settlement-v3`, venue, u8 market | 234 |
| ResolutionV3 | `resolution-v3`, venue | 3,644 |
| ResolutionPageV3 | `resolution-page-v3`, venue, u16 page index | 3,400; two fixed rows |
| ResolutionWorkV3 | `resolution-work-v3`, venue | 7,918 |
| Classic SPL vault | `vault-v3`, venue | Token account; venue PDA is token authority |

Resolution pages/work retain epoch fields and are reused only after terminal
reconciliation/new epoch, never for concurrent resolutions. At most 32 row pages;
no single instruction deserializes the whole cohort. Fixed wide arrays are heap/
account-backed, never copied wholesale onto a 4,096-byte SBF stack frame. The
contract's size tests do not establish SBF stack/CU safety.

Initialize a fresh local deployment/domain/test mint and explicit manifest. No
V1/V2 data or existing devnet programs are upgraded by this authorization. Migration
requires an admissible actual old withdrawal and new deposit; positions, unpaid
claims/fractions, orders, fees and reserves do not move implicitly. Default/devnet
builds reject schema-3 activation. P23 provides custody only. P24/P25 candidate
financial harness builds are isolated test artifacts; ordinary activation remains
hard-disabled until P26's full safety acceptance.

Critical events retain Anchor event-CPI and schema/venue/sequence/action/affected
identities with exact before/after deltas or canonical snapshots. P23 owns generated
ABI parity; P27 owns final interface/event projection qualification. Every fee
split emits gross fee, I/T credits and carry before/after. Every resolution effect
binds epoch/stage/row and its exact frozen-plan identity. A work-page hash alone is
not sufficient financial history: persist the input/certificate/final-row data
needed to reconstruct rational adjustments and actual whole payouts. Failed
transaction logs never apply, and SQL projection/checkpoint commits remain atomic.

## 7. Acceptance and resource obligations

G17 requires the independent Fraction and bounded integer outputs, literal normal
payment/netting/fraction counterexamples, certificate greatest-solution rejection,
canonical stage/replay cases, exact Rust serialization/identity bounds, preserved
old namespaces and all transitions/authority/supersessions above. It does not
claim signed SVM or runtime acceptance. P23 starts only after these checks pass.

P23/G18: real custody/authentication/alias negatives, generated and isolated legacy
parity, signed SBF/Surfpool token reconciliation. P24/G19: actual financial engine,
funding/reservation/order/delegate/fill rollback and maker parity. P25/G19: real
normal collection/netting/payout and same-transaction exits under live sampling,
plus source/health negatives. P26/G20: exact bounded wide operations/certificates,
maximum cohort and every legal page size, malicious/partial proofs, clipping,
cycles/fractions, interruption at each stage, liquidation progress and explicit
activation/recovery. P27/P28: actual RPC/WS/PostgreSQL/browser/replay and bounded
concurrent qualification; no inherited qualification substitution.

Provisional transaction envelopes: 1,232 bytes; ordinary routes 600,000 CU,
transfer-plus-route 700,000; sampling/resolution 1,200,000; other actions 400,000.
Require at least 20% measured CU headroom at each owning phase. Keep 32 KiB heap
and the existing account-count targets where practical; measure any justified new
paged proof envelope before promotion. Chunk wide proposal uploads below packet
limit, authenticate contiguous offsets/final hash and disallow partial execution.
Continuation work is deterministic and finitely bounded, not a promised one-tx
resolution. P26 must measure worst-case signed steps and total completion cost;
if necessary split arithmetic work into more persisted steps, not weaken economics.
P28 measures hot custody/market locks, latency, eligible/rejected/failed exits and
actual recovery. No 24-hour endurance, real maker/review or funded-pilot gate closes.
