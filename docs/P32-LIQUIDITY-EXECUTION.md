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

The clearing sampler authenticates each sealed registration, capital PDA,
program/ProgramData hash and fixed read-only config/price pair. It shares code-hash
work only within one instruction. Funding evaluates each quantity with the actual
scalar fill/reservation/risk arithmetic, whole-root funding and generation/order
authority, including healthy larger closes after unhealthy smaller quantities.
Valid zero-capacity publications still participate in required coverage.
Invariant order terms are prepared once; per-quantity generation, direction and
protection capacity still apply. Every selected leg also receives the complete
route maker transition/book refresh/admission. A native exhaustive comparison
checks the prepared projection against that full path in103,680 combinations.
This is optimization-equivalence evidence, separate from the independent literal
financial expectations and required real-program acceptance.

[D73](DECISIONS.md#d73--causal-canonical-funding-observations-p32-29-october-2026)
records exact old-interval-first funding and structural-control bookkeeping. Native
literal tests cover failed samples, repeated controls, publication expiry, recovery
gaps, frozen mode and catchup. The staged sampler uses one reusable 14,424-byte
quantity table; it does not write capital/orders or consumption.

`initialize_liquidity_oracle_v4` reuses the existing source-initializer context and
authority contract, with a separate profile4 entrypoint. `sample_liquidity_v4`
wires complete sampling and `LiquidityOracleChangedV4`; all four structural-control
paths materialize/truncate held funding before mutation. They require the explicit
`liquidity-execution-qualification` candidate build. Default and P30 custody-only
builds retain their gates; legacy V3 sampling/activation still rejects profile4.
New financial trading remains disabled. P30/P31 deployments and evidence are
unchanged; candidate artifacts live separately in `.local/liquidity-execution/`.

## Resource probe (not phase acceptance)

`bash ops/build-liquidity-execution.sh` builds the candidate; `bash
ops/liquidity-sampling-smoke.sh` performs the scoped real RPC/WS sampler probe.
The first two builds rejected oversized sampler stack frames. Explicit decode,
admission-construction and side-search boundaries remove the SBF frame violations.
The first actual 100-lot sample measures1,101 bytes in v0, but its simulation
exhausts1.4m CU before completing the search. It is not sent or counted as a
successful sample. The45 earlier provisioning/source/publication transactions
finalized. Raw attempted evidence is retained at
`.local/liquidity-execution/runs/20261028T190442Z-7610`.

This failed resource gate motivates the prepared-reservation optimization above.
The clean follow-up on`db2628f` reaches the first selected buy quote but again
exhausts1.4mCU before completing the100-lot sample;30 provisioning/source/update
transactions finalize, while the sample is not broadcast. Retain
`.local/liquidity-execution/runs/20261028T191745Z-11673`.

The next candidate prepares isolated risk inputs once and evaluates checked
cash-plus-negative-claim equity and the exact per-position IM ceiling directly,
sharing generation transitions with actual fills. Fixed bounds permit u64 IM
numerators and index-band products without rounding changes. It preserves the full
selected-leg recheck. Additional native literal/fraction/ceiling cases and1,650
extreme-bound/generation comparisons agree; the103,680 full-route comparisons and
642 independent allocation cases still pass. Allocation visitation already follows
the complete tie order, so equal gross retains the first candidate without rescans.
These optimizations still require fresh resource measurement.
Keep the complete registry, full code hashes, exact quantities, risk rules and
20% headroom requirement. No successful sampler, full-book resource acceptance,
actual financial funding/execution or A37/G25 completion is claimed yet.
Existing custody, source, funded-cash/unpaid-claim, 2 bps/zero-provider and 25%
insurance rules remain in force. P15B/P16B stay Open; 24-hour endurance Deferred.
