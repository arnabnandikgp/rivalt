# P09 liquidation and complete-cohort resolution

Implementation in progress; G10 selections below require independent arithmetic, signed program and actual RPC/WS/PostgreSQL acceptance. Only the explicit local-test-profile is eligible. No M6 risk calibration or funded deployment is implied.

## G10 local policy

| Parameter | Selection |
|---|---|
| Distress | Strictly positive `max(MM - conservative equity, 0)`; MM remains 5%, positive unpaid-P&L margin credit remains zero |
| Liquidation quantity | 1–4,608 lots, no greater than target absolute exposure; no target reversal |
| Execution price | Positive integer price inside the same exact index-derived ±10% execution band; receiver signs the exact price/quantity; current credible bounds required |
| Receiver | Distinct, owner-signed, funded non-maker participant; no unlimited capital or implicit maker authorization; post-transfer IM, reservations and existing global caps apply |
| Liquidation fee | `min(ceil(gross/2000), 10,000, target funded cash)` atoms, paid from target C to receiver C; no duplicate ordinary taker fee or treasury receivable |
| Risk progress | Target exposure and maintenance deficit must strictly decrease after the funded fee; cancellation of risk-increasing reservations cannot itself count as deficit improvement |
| Ordinary default trigger | Any caller can prove a registered participant has `C + U(reference,F) < 0` at a current credible common reference; no keeper-selected closeout price |
| Source emergency | Market authority may freeze after no credible bounds and at least 30 seconds beyond the source deadline; valuation then waits for authenticated credible sources |
| Cohort | Exact immutable registry prefix, at most 64 stable participant IDs; no deposit/registration during freeze |
| Pages | 1–4 exact sequential registry members; checked epoch/stage/cursor binding; reject duplicate, skipped, reordered and foreign pages |
| Compute declaration | Up to 1,200,000 CU for resolution work, acceptance ≤960,000 CU; ≤1,232 submitted bytes; account/event sizes measured before Review |
| Recovery | Complete payout and cohort reconciliation, six seconds of valid source checks at intervals 2–6 seconds, then explicit market-authority resume into new terms/config epochs |
| Operator | Separate risk role and 5,000,000-lamport budget; test receiver collateral is deposited through ordinary SPL custody |

The liquidation fee is the separate policy already allowed by PROTOCOL §4. It does not change the 2 bps ordinary taker / zero provider maker fee. A receiver's funded cash must support its acquired exposure; receiving positive unpaid P&L cannot finance its margin. Maker capital is excluded as a receiver in this local profile so liquidation cannot bypass its separate standing inventory commitment. Maker positions can be liquidation targets. Insufficient receiver capacity leaves an explicit unavailable action; it does not fabricate a fill or automatically declare a solvent participant bankrupt.

## Frozen authority and funding

Freeze materializes only the previously valid funding prefix, records its endpoint, freezes registry identity/count and advances terms/config epochs. Existing order authority becomes ineligible immediately. Ordinary trades, deposits, registration, settlement, withdrawals, new funding and changes to clearing maker registrations are blocked while frozen. Independent maker curve publication does not change the frozen clearing ledger; adoption through clearing remains blocked. Source-independent internal order cleanup is part of resolution; a caller cannot alter the cohort or revive an old order.

Freeze authenticates the four bound source accounts and pins their currently credible converted reference. Otherwise AwaitValuation persists until the immutable authenticated source bindings produce credible converted bounds. There is no administrator-supplied price fallback. The pinned common price and funding endpoint cannot change after valuation begins.

## Complete-cohort stages

Resolution stores bounded per-ID records and advances only by exact epoch/stage/cursor. Every pass completes the whole registry before the next pass starts. Fees T remain excluded; the allocated vault does not change.

1. **Value:** read every frozen participant at the same price and funding endpoint into resolution records. Authenticate every registry/PDA binding and verify complete-cohort net exposure, funded cash and exact valued claims. Participant positions remain frozen in place during planning.
2. **Collect:** transfer each debtor's available whole cash into P, retaining fractional claims. Keep the ordinary virtual field frozen and add the collected scaled amount to the resolution record. This preserves derived-claim headroom even at the ordinary stored-v limit. The frozen ledger, rather than an ordinary position view, accounts for the collection adjustment.
3. **Insurance floors/awards:** calculate `z=min(I,floor(D/SCALE))`, then its exact scaled allocation across every debtor using overflow-safe integer division. Persist remainders; a separate bounded pass assigns the residual scaled units by remainder and stable ID. Pool movement waits until the complete payout plan is known.
4. **Impairment floors/awards:** allocate residual debt across all positive unpaid claims using the same deterministic scaled-unit rule; cancel all residual debtor claims. No caller chooses a winner subset.
5. **Payment floors/awards:** compute whole-atom floors of remaining entitlements, distribute leftover whole atoms by fractional remainder/stable ID, and record each explicit signed terminal adjustment. Adjustments sum to zero and each absolute adjustment is below one atom.
6. **Apply:** after all planning passes and exact sum checks, transfer z from I to P once. Apply each already-computed payment, zero positions/claims, advance affected generations and invalidate orders. All debt collection precedes payments, so page order cannot spend an unfunded pool.
7. **Reconcile:** traverse every final account again and verify cash, zero positions/claims/reservations, P=0 and exact vault accounting before Complete. Recovery then requires valid sources and explicit authority.

During Collect, claims include the explicit collection adjustment held in the resolution ledger. During Apply, an individual account may already be finalized while another still has its frozen pre-closeout position. Ordinary net-q/claim equations cannot be applied blindly to that mixed representation. The frozen resolution ledger and applied cursor explicitly identify pending claims/payouts; the cash equation is enforced throughout. The indexer must reconcile the staged representation and the actual accounts, then restore ordinary invariants only after the full cohort is finalized. API responses label the frozen stage and expose planned versus applied amounts; they never report planned profit as withdrawable cash.

The P02 exact closeout rule is unchanged. Operational execution must match an independent complete-cohort expected result across legal page sizes, interruptions and competing keepers. The existing pure closeout routine alone is not evidence for this paginated implementation.

## Required evidence

A13: receiver consent/alias/binding/capital limits, fee caps and funded transfers, strict post-fee deficit improvement, unhealthy/non-improving rejection, current source/observation constraints and order-generation interactions.

A14: real bankruptcy and source-emergency freezes, no invented valuation, disabled ordinary financial paths, full-cohort page authentication, duplicate/concurrent progress, exact insurance/impairment/rounding, restart equivalence, complete reconciliation and authorized recovery into a new epoch. Actual risk-worker RPC/WS and PostgreSQL reconstruction are required before Review. All implementation, resource measurements and acceptance remain pending.

Resolution progress events carry exact per-ID plan records and compact changed balances. Collect leaves order books and nonces unchanged; Apply deterministically invalidates all active orders, zeros reservations/order IDs and group allowances, and preserves retained IDs/prefix history. The indexer applies that explicit transition and compares its entire reconstructed participant book to the actual account. Copying four complete unchanged books into every event exceeded the standard SBF heap in the first 64-member developmental test; this representation must pass the same resource test before G10 acceptance.

A restrictive oracle sample retains the last credible source deadline while status/validity still reject priced actions. Erasing that deadline would let a continuing failed-source sampler prevent the emergency grace proof indefinitely. Freeze also rereads authenticated sources, so a caller cannot use an old restrictive observation to freeze after credible source recovery.

Freeze closes the last held funding coverage interval once: only its materialized prefix counts as covered and its remaining elapsed tail is skipped. Resume adds the entire frozen wall-clock interval to skipped coverage before resetting sampler qualification. This changes diagnostic coverage accounting, not the pinned F or participant charges; no funding catches up across resolution.

Canonical decoded event data remains immutable during projection. Candidate validation and transactional SQL replay reuse the same events; each projection must own its nested books and resolution headers. In-place final book cleanup cannot alter historical order/route/liquidation payloads before they are journaled. Fresh complete-history reconstruction is required to verify this boundary.
