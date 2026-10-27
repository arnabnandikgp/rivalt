# P26 — whole-account liquidation and market-attributed default

This implements D60's [schema-3 contract](P22B-EXECUTABLE-CONTRACT.md), after the
verified P25 predecessor. WORKLOG owns status. Ordinary activation remains disabled
until the complete P26 acceptance; arithmetic tests alone do not enable a venue.
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
