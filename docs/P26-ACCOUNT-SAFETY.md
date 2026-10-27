# P26 — whole-account liquidation and market-attributed default

This implements D60's [schema-3 contract](P22B-EXECUTABLE-CONTRACT.md), after the
verified P25 predecessor. WORKLOG owns status. The candidate safety matrix is
verified; the explicit storage-ready local activation gate requires its own final
pinned check. Default/devnet activation remains disabled.
V1/V2, fees, loss bearers, source limits and the 25% insurance allocation are unchanged.

Implementation proceeds within one cohesive phase/PR:

1. Allocation-free 96-limb checked arithmetic, independently tested against Python
   integers; no wide-by-wide multiplication or unbounded general quotient.
2. Whole-account liquidation using the shared checked candidate, consenting receiver,
   complete current funding/reservations and strict post-fee MM-deficit reduction.
3. Canonical frozen registry/pages and authenticated valuation; no ordinary mutation
   while frozen. Shared debtors connect the operational freeze, while each market
   retains its own pool, insurance, fees and creditor losses.
4. Complete denominator/collection scans, untrusted chunked rate proposals, exact
   fixed-equation and greatest-solution verification, prescribed insurance clipping.
5. Complete flow plan and deterministic conserving remainder circulation before any
   root application; canonical exactly-once application/reconciliation and explicit
   recovery/terminal retirement authority.
6. Independent golden cases against those actual handlers, signed SBF and real
   Surfpool RPC/WS, all legal page sizes, maximum cohort, corrupt/partial proofs,
   interruption/replay and measured packet/CU/heap limits. Only then add explicit
   qualified local activation; default/devnet remain disabled.

The shared arithmetic accepts caller-provided fixed scratch buffers. It allocates
no heap in its inner loops, which matters because the SBF allocator cannot reclaim
repeated temporary allocations during one instruction. Multipliers have at most
three u64 limbs; debt divisors are below 2^88; whole-flow quotients are below 2^58.
Overflow, division by zero and out-of-envelope inputs reject. Scratch mutations
on a failed calculation are never an accepted financial state transition.

The existing ResolutionV3/PageV3/WorkV3 layouts are the starting contract. Any
measured layout/resource adjustment must be explicit and versioned before acceptance;
no truncation, reduced claimant set, guessed rate or relaxed financial equation is
an optimization. Whole-cohort runtime cost is measured independently from the cost
of one continuation. A bounded proof schedule is not a promise of one-transaction
resolution. P27 services and P28 concurrency/UI remain distinct downstream gates.

## Frozen preparation and proposal contract

The candidate precreates one header/work pair and all 32 canonical two-row pages.
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
fabricated payout. Deterministic rounding/application/recovery remain subsequent
implementation and acceptance, not implicit effects of reaching FlowPlan.

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

The initial signed two-row FlowPlan exceeded 1.2M CU. Exact arithmetic now skips
zero multiplier columns/unused high limbs and leading zero quotient bits, retaining
checked overflow and the maximum 58 subtraction steps. All independent wide,
row/rate and atom/continuation comparisons were rerun. This is an arithmetic
implementation improvement, not a higher budget, heap or altered rounding policy.
Maximum-width signed continuation budgets remain a separate acceptance obligation.

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
including source sequence and coverage changes, for future indexer reconstruction.

Resolved/Retired owner withdrawals use the existing signed root guard and actual
SPL transfer, require flat/no-claim/no-live-order cash and no pause, and consume no
new funding or artificial source freshness. The candidate feature remains required;
ordinary activation is still false. The active P25 withdrawal path retains its full
current risk/held-funding checks. Full maximum-cohort/resource/RPC acceptance
still gates P26 readiness.


## Recovery and terminal reserve custody

Permissionless authenticated observations must establish six seconds of sustained
normal sources, with the unchanged two-second sample interval and six-second hold.
Bad sources reset recovery credit; a gap longer than the hold starts a new window.
Only venue authority can resume a completely reconciled Resolved venue, and this
returns to Custody. Safety/venue/market terms advance, earned funding and fee carry
remain, and old observations are cleared. Fresh independent maker/source sampling
and a separate authority action are required for candidate reactivation. No old
order, delegate or quote authority is revived. Default/devnet builds stay gated.

Recovered custody roots retain historical generations and nonces. Liability-free
cash deposit/transfer/withdrawal therefore tests zero q/v, reserves and live orders
rather than requiring virgin account bytes. Funded owner exits in recovered
Custody, Resolved and Retired consume no new funding or fresh source observation.
The fresh P23 custody profile and active P25 risk checks remain distinct.

Retirement is irreversible and requires either complete current-epoch resolution
reconciliation or a canonical complete flat/no-orders/no-claims scan. The latter
uses additive `RetirementCertificateV3`, schema 3, 80 bytes including discriminator,
at `retirement-v3, venue`. Ordered fields after schema/venue are safety epoch,
membership version, custody sequence, scanned cash (four u64s), count/next (two
u16s), complete/bump (two bytes). One/two read-only canonical roots are checked per
call; an empty venue has an explicit zero-row completion. Any intervening ordinary
mutation invalidates the administrative proof. A valid completed or in-progress
scan cannot be gratuitously replaced; a stale scan restarts from zero. Complete
cash must match custody and both market gross exposures/pools must be zero.
This global proof is exclusively for irreversible retirement; normal owner exits
never depend on it. Operators can pause activity for this administrative action.

Only venue authority may retire. Retired identities cannot resume, activate,
register or accept deposits. Then only the distinct stored reserve authority may
withdraw selected-market I to the immutable reserve-destination owner's canonical
classic SPL ATA. Actual I/V decrease equally; C/T and fee carry remain separately
backed. No active/resolved pre-retirement insurance sweep is introduced. New
progress, recovery, retirement and reserve events retain exact state/amounts for
P27 reconstruction. The additive certificate is a D64 implementation detail of
D60's existing authority contract, not a new loss policy.


## Measured arithmetic continuation budget

The isolated `tests/fixtures/clearing-math` SBF fixture invokes the actual checked
financial-core functions with 88-, 2,796- and 5,592-bit denominators and maximum
row cash/claim magnitudes. It owns only arithmetic scratch, no venue, root or token
account. It does not fabricate deposits/fills/settlements or qualify an entire
financial instruction. Raw fixed-width results match independent integer formulas;
insurance probe inputs deliberately overbound a single cohort's aggregate vault.

Two maximum-width row-flow calculations consume 1,011,805 CU before complete clearing
context overhead, violating the unchanged 20% headroom requirement under 1.2M CU.
Accordingly Verify and FlowPlan now accept exactly **one row** per call. Complete
rate fixed/greatest equations and both insurance floors require a separate
`finalize_account_resolution_rates_v3` after Verify cursor equals complete count.
The header remains at Verify/count until that step; early/replayed finalization
rejects. Stage/cursor/epoch/work identity still authenticate every continuation.
Page storage remains two rows, and Value/Denominator/Apply/Reconcile retain legal
one/two-row calls. No economic formula, claimant set, funding/source rule, heap or
compute ceiling changes. This explicitly supersedes the initial universal
one/two-row continuation envelope within unpublished P26.

Measured resource-only single-row maxima are 524,723 CU for exact flows and
391,738 for whole-atom planning; complete two-market insurance checks peak at
423,042. These fixture figures exclude full clearing context overhead; do not
present them as a measured maximum-width venue resolution. The full-context runtime
matrix and final pinned acceptance remain separate requirements.

The separate `account-safety-context-budget.ts` resource probe forks an actual
signed 64-root/two-market frozen runtime. It widens only derived denominator scratch,
preserving all rational flows, then measures the actual clearing contexts. L reaches
5,632 bits and the factor 186 bits. Separate extremal scratch rows cover maximum
cash/claims and double-debt/mixed-sign branches. Those derived rows deliberately do
not represent authenticated root valuations: they are resource inputs, never
successful financial histories. No Apply or token movement runs in the fork;
root/market/ledger/vault bytes stay unchanged, and the genuine parent continues
its separately audited signed settlement. Whole-case financial evidence still
comes from actual registration, deposits, trades and source updates.

The initial full-context extremal measurements peak at 774,364 CU (Verify) and
638,366 (FlowPlan), below 960,000 with the unchanged 1.2M ceiling and default heap.
Publication requires the final pinned matrix, including default-artifact rejection,
complete proposal/order/circulation resource paths and actual RPC faults. The
resource-only fixture and full-context scratch measurements are labelled separately
from canonical financial acceptance; neither claims a live maximum-value cohort.


## Qualified local activation

Retain the reproducible `account-safety-qualification` feature name for the explicit
local profile. Its release marker reflects that feature only; default, devnet,
custody-only and earlier trading/cash candidates cannot call `activate_accounts_v3`.
The new authority-only instruction requires canonical schema-3 resolution storage,
an idle zero-epoch header with all 32 two-row pages precreated, no prior resolution,
Custody mode, reconciled vault/ledgers, zero exposure/funding/pools/fees/carry and
fresh Normal maker/source qualification in both markets. Header/work creation is
atomic; pages cannot be closed/replaced. Activation consumes the same audited
initial transition and clears old held observations before new trading sampling.

The older `qualify_account_trading_v3` rejects in this full safety profile, so it
cannot bypass storage readiness. It retains its historical P24/P25 candidate use.
Recovered venues use only the separate authenticated recovery/reactivation path;
initial activation cannot reset their history. The existing qualification event
layout is preserved. This is fresh local engineering authorization only; P27/P28,
P15B/P16B and deferred endurance remain separate gates.
