# Risk, orders and complete resolution

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
| BTC / ETH USD ranges | 10,000–100,000 / 1,000–10,000; ETH value/confidence multiplied by ten before common ratio rounding |
| Asset / collateral confidence | At most 50 / 25 bps |
| Collateral USD range / Normal | 0.5–1.5 / both sources 0.95–1.05 |
| Source age / future skew | At most 20 / 2 seconds at on-chain Clock |
| Primary/guard divergence | At most 1% of primary converted reference |
| Reference / risk price | 10,000–100,000 / finite 1–1,000,000 atoms per lot |
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

## Orders and protection

Four records and two protective pairs are embedded in each root. Inclusive start,
exclusive expiry; order lifetime and placement horizon at most 216,000 slots;
quantity 1–4,608 lots; per-lot all-in limit 9,000–110,000 atoms; lifetime fee budget
at most 1,000,000 atoms; index triggers 10,000–100,000 atoms. Every submitted
subfill is exact-base atomic with at most two distinct maker capitals.

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
whole-account MM deficit. Transfer 1–4,608 lots within held quantity, without flipping,
at a price inside 90–110% of independent reference. Cancel target risk orders
atomically; their cancelled authority cannot create a false extra source dependency.
Receiver surviving orders still count. Fee is `min(ceil(notional/2000), 10,000,
target cash)` atoms, transferred to receiver, with no additional insurance tax.
After fees, selected absolute exposure and whole-account MM deficit must both
strictly decrease. Mere exposure reduction is insufficient. Failure rolls back
funding, orders, positions and fee. No forced unfunded receiver or hidden subsidy.

## Complete frozen input and economic priority

There are exactly two markets, one collateral mint and at most 64 complete account
rows, including isolated makers and liquidation receivers. Every row contains its
own funded cash and both fully valued/accrued claims at the frozen endpoints. An
absent position contributes zero; a caller cannot omit a losing claim. Per-market
claim sums must equal the corresponding settlement pools. The program must
also authenticate the registry, prices/funding, source bounds and frozen state;
the model's array length and identities are not substitutes for those proofs.

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

These are terminal simultaneous-clearing obligations. They do not grant positive
unpaid margin credit, authorize a live claim transfer or allow an ordinary account
to spend an uncollected receivable. The owner-authorized normal flat-netting
instruction still needs its separate admissibility and ledger transition contract.

## Exact equations and cycles

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


## Exact bounded exceptional arithmetic

Normal state uses fixed-scale i128; terminal work uses **96 u64 limbs (6,144 bits)**
in unsigned little-endian encoding. No Fraction, float, unchecked cast, convergence
tolerance or unbounded allocation is part of the executable schedule. The integer
reference is [bounded_clearing_reference.py](../../tests/financial/bounded_clearing_reference.py);
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

## Frozen transitions, continuation and recovery

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

Pages have two stable rows. D64 resource measurement limits Verify and FlowPlan
to one row per instruction and separates complete rate/insurance verification from
the last row; Value/Denominator/Apply/Reconcile allow one or two rows without
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


## Frozen preparation and proposal contract

The qualified profile precreates one header/work pair and all 32 canonical two-row pages.
Creation is permissionless rent payment in Custody/Active; it grants no price,
reserve or payout authority. Freeze requires the completed storage set, the current
safety/resolution epochs and an authenticated registry member. It accepts common
net bankruptcy or strictly underfunded gross flat debt; an exposed risk deficit
alone rejects. The authority-only missing-source emergency retains its full
30-second grace. A missing price anywhere with exposure enters AwaitValuation;
a wholly unexposed market uses the fixed irrelevant price sentinel 1.

One/two-row Value pages cannot cross a two-row storage boundary, omit a root,
change its canonical identity or supply writable participant accounts. The complete
scan checks cash, both zero signed exposures, gross quantities and both pool/claim
identities before Denominator. Frozen participant accounts and live cash ledgers
remain unchanged. L is then derived from all frozen rows with exact whole own-cash
collections. Epochs, stages and cursors prevent reuse of earlier pages.

Rate proposals are exactly 1,560 bytes: two 96-limb little-endian numerators,
followed by the three-limb factor. Chunks are nonempty, eight-byte aligned and at
most 512 bytes; offsets are contiguous and bound to epoch/evaluation/SHA-256.
Anyone may restart an incomplete upload at offset zero. Verification cannot be
replaced mid-pass. Wrong complete encoding/equations reset proposal work without
changing frozen inputs, spending reserves or consuming an insurance evaluation.
Every frozen row contributes exact flows and right slopes. Only complete fixed
and greatest-rate verification permits the prescribed floor clipping or FlowPlan.
Clipping preserves original reserves and requires a complete new verified scan.

Verify work registers 0/1 hold incoming flow numerators; register 2 contains the
two checked u128 slopes in limbs 0–3; register 3 contains L*factor; registers 4–7
are scratch. This names the existing layout's usage; no account bytes or old
profile semantics change. Events retain frozen valuation inputs, proposal chunks,
verification decisions and exact insurance budgets; preparation does not emit a
fabricated payout. Deterministic rounding/application/reconciliation are mandatory
stages, not implicit effects of reaching FlowPlan.

## Deterministic atom planning and circulation

After complete rate verification, FlowPlan derives whole claim-flow/cash floors,
exact common-denominator remainders, per-root outgoing order and node residuals.
No root balance is applied by planning. Fixed original edge IDs are market-zero
rows, market-one rows, then cash rows; zero-claim placeholders have no adjacency.
Auxiliary IDs follow those edges in stable node order. The work account keeps four
positive/negative claim masks in register 0 limbs 0–3, required/sent flow in limbs
4/5, root outgoing permutations in register 1, signed i64 residual balances in
register 2 and the previous checked remainder in register 3. Registers 4–7 are
scratch. Roots/markets/cash sink/source/sink retain the contract's <=69 nodes.

A proposed pair of complete market permutations grants no path authority. Every
entry is authenticated against the canonical frozen page and exact remainder,
with stable root-ID ties. A proposal can be replaced before checking begins;
a wrong committed order resets deterministically so an absent proposer cannot
strand resolution. After checking begins, an unrelated caller cannot replace a
partially verified order. Only complete verification enables Round.

Round examines at most 128 deterministic adjacency slots per call, persisting
DFS parents, cursors, path and residual capacities. It prioritizes auxiliary
forward arcs, descending-remainder original forward arcs, then repair arcs by
stable destination/edge. Every augmentation is bounded and total augmentations
remain <=192. A complete result audits each node's required increment, including
both market nodes; reaching an aggregate sent count alone is insufficient.
Whole row cash and flows are not committed to participant accounts until Apply.

## Exactly-once application and terminal cash

Only a complete audited circulation enables Apply. Canonical writable roots must
still match their frozen cash, q, generations and fully accrued claims. Each row
applies once, checks its own cash equation and retained own cash, stores the final
whole flows/cash, zeroes allowed positions/claims and advances their generations.
An isolated account's forbidden market slot remains entirely empty. Orders and
protection are removed while the last order ID remains monotonic; delegate expiry/
identity are cleared and root nonce/version/delegate epoch advance.

During partial Apply, participant bytes contain a mixture of old/new rows. The
custody aggregate and P/I/T remain the original frozen ledger; `scanned_cash` is
remaining original C and `cash_applied` is final C of applied rows. These are the
stage-accounting representations, never two spendable balances. Remaining q/gross/
claims track the unapplied cohort. In this stage `claim_sums` accumulates signed
whole market flows at scale S. No ordinary deposit/trade/exit can consume a partial
plan. The complete application proves both market whole-flow totals equal P plus
that market's planned insurance use, and final C equals original C+P+spent I.
Only then does custody adopt final C, set both P to zero and debit each I exactly
once; fee amounts/carries and allocated vault remain unchanged.

Reconcile scans every applied root again, checking final cash, zero claims/q,
funding checkpoints, generations and absence of revived order/delegate authority.
Only its completed cash check enters Resolved and advances safety authority. Events
retain every applied root, final whole flows, staged aggregates, exact reserve/fee
state and versions. Freeze events also retain both resulting market snapshots,
including source sequence and coverage changes, for indexer reconstruction.

Resolved/Retired owner withdrawals use the existing signed root guard and actual
SPL transfer, require flat/no-claim/no-live-order cash and no pause, and consume no
new funding or artificial source freshness. The explicit local safety feature is
required; default/devnet remain disabled. The active P25 withdrawal path retains
its full current risk/held-funding checks. The evidence report records the complete
maximum-cohort/resource/RPC acceptance.


## Recovery and terminal reserve custody

Permissionless authenticated observations must establish six seconds of sustained
normal sources, with the unchanged two-second sample interval and six-second hold.
Bad sources reset recovery credit; a gap longer than the hold starts a new window.
Only venue authority can resume a completely reconciled Resolved venue, and this
returns to Custody. Safety/venue/market terms advance, earned funding and fee carry
remain, and old observations are cleared. Fresh independent maker/source sampling
and a separate authority action are required for separate reactivation. No old
order, delegate or quote authority is revived. Default/devnet builds stay gated.

Recovered custody roots retain historical generations and nonces. Liability-free
cash deposit/transfer/withdrawal therefore tests zero q/v, reserves and live orders
rather than requiring virgin account bytes. Funded owner exits in recovered
Custody, Resolved and Retired consume no new funding or fresh source observation.
The fresh P23 custody profile and active P25 risk checks remain distinct.

Retirement is irreversible and requires either complete current-epoch resolution
reconciliation or a canonical complete flat/no-orders/no-claims scan. The latter
uses `RetirementCertificate`, schema 5, 80 bytes including discriminator,
at `retirement-v3, venue`. Ordered fields are schema u16, revision u64, venue,
safety epoch/membership version/scanned cash (three u64s), count/next (two u16s),
complete/bump (two bytes). One/two read-only canonical roots are checked per
call; an empty venue has an explicit zero-row completion. The venue authority must pause
before scanning; every page and retirement bind the same paused safety epoch and
membership version. Cash mutations reject during the window; unpause invalidates
the proof. A valid completed or in-progress
scan cannot be gratuitously replaced; a stale scan restarts from zero. Complete
cash must match custody and both market gross exposures/pools must be zero.
This global proof is exclusively for irreversible retirement; normal owner exits
never depend on it. The pause window is required for the flat-scan branch of this administrative action.

Only venue authority may retire. Retired identities cannot resume, activate,
register or accept deposits. Then only the distinct stored reserve authority may
withdraw selected-market I to the immutable reserve-destination owner's canonical
classic SPL ATA. Actual I/V decrease equally; C/T and fee carry remain separately
backed. No active/resolved pre-retirement insurance sweep is introduced. New
progress, recovery, retirement and reserve events retain exact state/amounts for
indexer reconstruction. The additive certificate is a D64 implementation detail of
D60's existing authority contract, not a new loss policy.



## Terminal rounding obligations

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
remain separately reported. Factored exact writeoffs and creditor impairments
reconcile without expanding unbounded diagnostic fractions on-chain.

Verify and FlowPlan process exactly one row per call. Finalize complete rate and
insurance verification separately after Verify cursor reaches count. Other row
stages allow one/two rows without crossing a two-row storage page. Default heap is
32 KiB; bounded wide scratch must not be copied onto the 4,096-byte SBF stack.
See [validation](../operations/validation.md) for measured full-context limits and
the distinction between actual financial lifecycles and resource-only scratch cases.
