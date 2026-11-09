# Authenticated routing and atomic execution

## Implementation boundary

`readAccountTradeSnapshot` discovers the selected market's three sealed
registrations, then reads immutable root identities. One final `getMultipleAccounts`
batch contains custody, vault/mint, safety, both markets/ledgers, Clock, the selected
root, all three isolated maker capitals and their portfolios, unique capital
bindings, registry/registrations, curves/prices and both executable/ProgramData
accounts. Context slots cannot go backwards. Discovery supplies keys only; final
bytes supply all quoted financial and pricing values.

The final discovery read has a hard ceiling of 48 distinct RPC keys. This includes
unselected candidates and code authentication and is **not** an increase to G22's
32 loaded-account ceiling for a submitted transaction. Profile 3 readers/builders
remain separate and reject profile 4. Snapshot construction itself grants no execution authority.

`authenticateLiquidityMarket` checks exact owners/layouts, canonical PDAs, sealed
membership, one capital per instance, isolated-market ownership, controller/domain
and authority bindings, admitted capability and full approved ProgramData hashes.
Two instances may use the same pricing program; instance identity is independent
of A/B program identity. Unsupported capabilities or malformed bindings reject the
snapshot. Quarantined, unapproved, disabled and stale/invalid publications remain
visible as classified candidates. Returned pricing and capital objects are frozen;
requests get independent domain bytes.

The canonical adapter exposes exact gross quotes, depth hints and fully bound pure
quote requests. Depth hints describe price capacity, not financial feasibility.
`allocateLiquidityRoute` covers all singletons and every unordered pair with
positive integer quantities summing to the full requested size. Each leg is at
most 100,000,000 lots and the request at most 100,000,000. It never executes three capitals,
partially fills the request or prunes maker health as a monotone prefix. Zero
mathematical capacity is classified separately from no feasible financial quote.

`prepareLiquidityMargin` uses the existing whole-account balance/reservation
engine. Both positions accrue funding, all negative claims and relevant sources
count, positive unpaid claims get zero margin credit, and active order reserves
refresh after the proposed fill. Stored prefixes and shared TP/SL allowance are
updated in the candidate only. A below-IM trader reduction must strictly improve
the whole-account maintenance deficit after fees; makers still require IM.

The objective is minimum buy cost or maximum sell proceeds after the **single**
2 bps aggregate/prefix-difference fee. Ties prefer fewer legs, lexicographically
smaller ordered instance IDs, then more quantity on the first instance. A candidate
dominated by an already feasible result needs no repeated trader health calculation.
Every potentially superior candidate still receives full trader admission. This
guarantees the best admissible result only within the authenticated candidate set
and snapshot. Actual landing may differ; clearing revalidates it on chain.

`previewLiquidityRoute` binds the pure allocator to the coherent profile-4 reader
and authenticated source/funding policy. `buildLiquidityRoute` constructs the
bounded route intent; the wallet or durable worker signs the resulting transaction.
The 2 bps/zero-provider fee, insurance share, loss ownership and V1–V3 economics
are unchanged. P15B/P16B remain Open; continuous 24-hour endurance remains Deferred.


## Signed execution contract

**Execution:** `execute_liquidity_route_v4` uses existing V3 intent order except
each leg is `(lots,authority_epoch,control_epoch,shape_epoch,depth_epoch):[u64;5]`.
Retain AccountGuard, domain, terms/config epochs, validity, side, total lots,
all-in limit, max fee, reduce-only and optional generation. It does not sign a
price sequence or consumption prefix. Vec length exactly1/2, sum exact, identities
bound by signed transaction account keys. Max serialized args incl discriminator223
bytes. `execute_liquidity_order_v4` retains V3 stored-order execution authority/id/
version/filled/start/expiry/lots with these legs (≤172 bytes). Existing transaction
signatures cover exact account identities; no substitution or resplit on landing.
Accounts retain V3 identity order, add registry, and per leg capital writable,
registration writable, program/ProgramData/config/price read-only, then event CPI
accounts. No arbitrary remaining accounts; singleton optional accounts use the
generated Anchor convention and may not alias real capital/config dependencies.


## Canonical execution and safety contract

The immediate/stored-order handlers use the exact one/two-leg wire contract above.
They authenticate current maker code and fixed read-only dependencies, verify the
canonical CPI result and run the existing whole-account financial candidate before
committing any root, consumption, fee or order change. The event adds actual price
sequences and consumption prefixes; signed intents bind structural epochs instead.
The SDK preserves caller-supplied limits and returns an explicit 800k CU budget for
the existing measured-size v0/v1 compiler. Current measured resource results are recorded in validation.

Safety integration uses schema-8 account financial instructions/layouts for
profile4 only under `liquidity-execution-qualification`. Order authority, cash,
liquidation, complete-cohort resolution, recovery and terminal exits share their
existing implementation. Earlier runtime APIs are retired in source and remain
reproducible at their historical revisions. Default/devnet artifacts cannot
activate profile4 or execute its financial operations.

`activate_liquidity_v4()` uses the existing `ActivateAccounts` account layout:
venue-authorized qualification identity plus resolution header, no extra accounts.
It requires the explicit local qualification feature, immutable profile4, unpaused
custody mode, all 32 precreated safety pages, a fresh zero-epoch resolution header,
zero market gross/funding and settlement/collected fees/carry, reconciled collateral
and both markets' existing fresh Normal qualification. Only D76 reports can produce
that profile's qualification; publisher initialization required sealed three-maker
registries, which cannot subsequently change membership. Activation clears held
observations and increments safety/custody versions, so fresh reports are needed
before trading. It neither bypasses the six-second recovery rule nor resets earned
funding after a default. Shared post-default recovery/reactivation retains its
complete-cohort and separate source/qualification requirements. Activation permits only this explicitly qualified local profile; it is not public enablement.


## Transport and resource boundaries

Measure the complete signed transaction before broadcast. Use v0 at <=1,232 bytes,
v1 above that up to 4,096; no lookup table is required. V1 compute and loaded-account
limits live in its header, not substitute compute-budget instructions. Keep explicit
zero priority price and current 8 MiB loaded-data policy. Preserve original bytes
and signature on ambiguous retries; fetch/decode RPC results supporting version 1.
Wallet admission requires both formats; actual external-wallet compatibility is a
separate check from instrumented local signing.

A route submits <=800,000 CU with measured maximum <=640,000, <=32 loaded keys,
and default 32 KiB heap. P49 expands total quantity and maker depth to the existing
100,000,000-lot numeric domain; its fresh program/resource acceptance is tracked in
validation. Eight regions per side and complete four-order/two-protection books
remain the bound. Earlier CU observations retain their original quantity workload. The RPC
snapshot's 48-key ceiling is not a transaction loaded-key allowance. Combined
transfer/control operations require their own measured packet/compute fit.

P48 replaces exhaustive quantity enumeration with exact interval search. Its
work budget is 65,536 visited intervals and 131,072 distinct quantity quotes per
request, independent of the numeric quantity domain. Exceeding either throws
`LiquiditySearchLimitError`; the quote service reports
`liquidity-search-budget-exhausted`, with no allocation or signed transaction.
It must not report insufficient liquidity or return an uncertified incumbent.
This is a computational availability bound, not permission to relax financial
admission. P48 retains the old program limits; P49 applies the existing numeric
domain to maker depth, action/order and liquidation quantities. This equals at most
100 BTC or 1,000 ETH per action, before inventory, collateral, gross exposure and
available depth impose tighter limits. Price/region work does not grow per lot.

For canonical capability 1, buy gross is integer convex and sell gross is integer
concave: region offsets have ordered marginal increments and the inventory
potential is convex. Valid marginal prices form a prefix; the independent VWAP
band forms an interval. These price facts do not imply monotone account health.
Within each singleton/pair domain, binary search finds the gross optimum. Net
sell proceeds can tie across a fee step; a separate search finds the rightmost
net optimum for the existing deterministic tie order. This gives an optimistic
bound for every integer split in that interval. A feasible optimum certifies the
interval; a bound dominated by an already feasible route excludes it. Otherwise
balanced subdivision preserves both halves, including nonprefix health islands.

Financial enclosures exclude only provably impossible intervals. For an isolated
maker, risk claim is convex on each side of flat; maximum equity is attained at an
endpoint or flat. Initial margin has its minimum nearest flat. Remaining maker
reservations are monotone in absolute exposure between generation changes;
endpoints and flat neighbours bound their minimum. Combining independent maxima
and minima overestimates admissibility. Trader quantity is fixed; bound cash with
the minimum fee and claims with the most favourable gross, independently, and
bound remaining reservations from gross endpoints. This handles sell equity
peaking at zero claim, where cash fees continue to increase. An uncertain bound
never excludes a range. Every accepted allocation still runs exact full-account
admission, numeric bounds, gross exposure, fee prefixes and signed limits.

Tie order is part of the API. Snapshot optimality does not prove global exchange
best execution, future-state optimality or validator throughput. [Validation](../operations/validation.md)
records actual latency/resource limits and contention caveats.
