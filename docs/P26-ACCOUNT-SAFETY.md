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
