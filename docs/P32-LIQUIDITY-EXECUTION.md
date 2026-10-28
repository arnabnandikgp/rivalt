# P32 — clearing, funding and safety integration

In progress on `phase/p32-liquidity-execution`, above exact P31 `28d5dd0` / ready
[PR #46](https://github.com/arnabnandikgp/rivalt/pull/46). A37/G25 is not complete.
The governing contract remains [P29B](P29B-MAKER-CONTRACT.md); no financial policy,
resource gate or external authorization changes here.

## Implementation sequence within this phase

1. Prepare exact consecutive canonical quotes and a bounded single/pair funding
   allocator. Validate against independent expectations before using it in clearing.
2. Authenticate V4 registrations/configs/publications and invoke only fixed read-only
   config/price accounts. Execute the signed one/two-leg allocation through the
   existing whole-account candidate, order and fee/insurance engine. Current price
   and consumption may change within signed limits; structural epochs may not.
3. Sample all three sealed makers with actual funded capital, reservations and
   current funding. Fill each side's full reference quantity without a synthetic
   trader, taker fee or depth mutation. Causal structural controls materialize and
   truncate old held funding; ordinary repricing does not modify it.
4. Integrate the profile with complete account liquidation/default/recovery and
   funded exits. Preserve old profile behavior and reject old A/B sampling/routes
   on the new profile. Keep unfinished execution disabled; candidate activation
   must remain an explicit local qualification feature with complete safety storage.
5. Build and run scoped compiled/SBF, real Surfpool RPC/WS, independent financial
   audit and narrow PostgreSQL replay. Measure actual transaction keys/wire/CU and
   contention. Run G22's predeclared V3/control/treatment offer schedules; publish
   this phase only after A37/G25 and its prototype continuation gate pass.

## Current engineering checkpoint

`QuoteLadderV4` validates a canonical shape once, then emits exact cumulative prices
for consecutive quantities. It walks region offsets and uses the discrete potential
increment `tick * floor(distance / step)`, reversing that increment when inventory
moves toward target. Every marginal must remain within the same global price bounds;
an invalid marginal invalidates all later prefixes. This is a price optimization
only: **maker health is still evaluated independently at each quantity**.

The pure `financial_core::liquidity::best_sample_pair` scans all singletons and
unordered pairs from three per-maker quantity tables. A zero entry represents an
unavailable quantity; it never implies that larger quantities are unavailable.
It has the agreed deterministic tie order and no fee or third capital. Its single
side scratch shape is 3×601 u64 values = 14,424 bytes, below the 16 KiB contract.
The SBF heap/CU/packet limits remain unmeasured until integration: this static size
does not establish overall runtime headroom.

The clearing preparation authenticates each sealed registration, capital PDA,
program/ProgramData hash and fixed read-only config/price pair. It shares code-hash
work only within one instruction. Funding evaluates each quantity with the actual
route maker transition, whole-root funding, generation/order refresh and IM
admission, including healthy larger closes after unhealthy smaller quantities.
Valid zero-capacity publications still participate in required coverage.

[D73](DECISIONS.md#d73--causal-canonical-funding-observations-p32-29-october-2026)
records exact old-interval-first funding and structural-control bookkeeping. Native
literal tests cover failed samples, repeated controls, publication expiry, recovery
gaps, frozen mode and catchup. The staged sampler uses one reusable 14,424-byte
quantity table; it does not write capital/orders or consumption.

These helpers are not yet wired to a public financial instruction. P30/P31
deployments and evidence are unchanged, and no new trading activation is claimed.
Existing custody, source, funded-cash/unpaid-claim, 2 bps/zero-provider and 25%
insurance rules remain in force. P15B/P16B stay Open; 24-hour endurance Deferred.
