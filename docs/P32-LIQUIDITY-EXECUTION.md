# P32 — clearing, funding and safety integration

In progress on `phase/p32-liquidity-execution`, above exact P31 `28d5dd0` / ready
[PR #46](https://github.com/arnabnandikgp/rivalt/pull/46). A37/G25 is not complete.
The governing contract is [P29B](P29B-MAKER-CONTRACT.md), explicitly amended by
D74's published-liquidity decision and D75's subsequently accepted
[restricted publisher replacement](P32-FUNDING-PUBLISHER.md). R087 implements the
handler/backend under the frozen D76 contract. Its [scoped publisher probe](evidence/P32-PUBLISHER.md)
passes on clean`4f4e47d`. [Basic execution](evidence/P32-EXECUTION.md),
[protective full-book resources](evidence/P32-RESOURCES.md),
[affected safety](evidence/P32-SAFETY.md) and [prototype PostgreSQL replay](evidence/P32-JOURNAL.md)
now pass on their recorded pins. General-entry/stored full-book measurements and
the bounded comparative continuation remain. Execution financial checks and external
authorization are unchanged.

## Implementation sequence within this phase

1. Freeze the D75 publisher report/layout/authority transitions and smaller resource
   target. Reuse canonical pricing/snapshots in an off-chain published-depth builder,
   with independent expected vectors and complete input provenance.
2. Authenticate V4 registrations/configs/publications and invoke only fixed read-only
   config/price accounts. Execute the signed one/two-leg allocation through the
   existing whole-account candidate, order and fee/insurance engine. Current price
   and consumption may change within signed limits; structural epochs may not.
3. Implement the D75 bounded signed-report handler plus a real publisher client.
   Compute complete configured published depth off-chain without hypothetical
   financial admission. Keep index/source validation and causal accrual on-chain;
   test authority, replay, expiry, unavailable reports and structural invalidation.
   Disable competing sampling entrypoints for the replacement profile.
4. Integrate the profile with complete account liquidation/default/recovery and
   funded exits. Preserve old profile behavior and reject old A/B sampling/routes
   on the new profile. Keep unfinished execution disabled; candidate activation
   must remain an explicit local qualification feature with complete safety storage.
5. Build and run scoped compiled/SBF, real Surfpool RPC/WS, independent financial
   audit and narrow PostgreSQL replay. Measure actual transaction keys/wire/CU and
   contention. Run G22's predeclared V3/control/treatment offer schedules; publish
   this phase only after A37/G25 and its prototype continuation gate pass.

## Canonical execution and safety contract (R088)

The new immediate/stored-order handlers use P29B's exact one/two-leg wire contract.
They authenticate current maker code and fixed read-only dependencies, verify the
canonical CPI result and run the existing whole-account financial candidate before
committing any root, consumption, fee or order change. The event adds actual price
sequences and consumption prefixes; signed intents bind structural epochs instead.
The SDK preserves caller-supplied limits and returns an explicit 800k CU budget for
the existing measured-size v0/v1 compiler. This is a budget, not measured route fit.

Safety integration reuses schema-3 account financial instructions/layouts for
profile4 only under `liquidity-execution-qualification`. Order authority, cash,
liquidation, complete-cohort resolution, recovery and terminal exits share their
existing implementation. Legacy maker registration, route execution, sampling and
initial activation remain profile3-only. Default/devnet/P30-only artifacts cannot
activate profile4 or execute its financial operations.

`activate_liquidity_v4()` uses the existing `ActivateAccountsV3` account layout:
venue-authorized qualification identity plus resolution header, no extra accounts.
It requires the explicit P32 local candidate feature, immutable profile4, unpaused
custody mode, all 32 precreated safety pages, a fresh zero-epoch resolution header,
zero market gross/funding and settlement/collected fees/carry, reconciled collateral
and both markets' existing fresh Normal qualification. Only D76 reports can produce
that profile's qualification; publisher initialization required sealed three-maker
registries, which cannot subsequently change membership. Activation clears held
observations and increments safety/custody versions, so fresh reports are needed
before trading. It neither bypasses the six-second recovery rule nor resets earned
funding after a default. Shared post-default recovery/reactivation retains its
complete-cohort and separate source/qualification requirements. Activation in the
candidate artifact permits testing; it is not A37/G25 acceptance or public enablement.

## Historical D74 implementation checkpoint (superseded by D75/D76)

`QuoteLadderV4` validates a canonical shape once, then emits exact cumulative prices
for consecutive quantities. It walks region offsets and uses the discrete potential
increment `tick * floor(distance / step)`, reversing that increment when inventory
moves toward target. Every marginal must remain within the same global price bounds;
an invalid marginal invalidates all later prefixes. This is a price optimization
only: D74 funding deliberately does not evaluate maker health. Actual execution
retains financial admission.

The pure `financial_core::liquidity::best_sample_pair` scans all singletons and
unordered pairs from three per-maker quantity tables. A zero entry represents an
unavailable quantity; it never implies that larger quantities are unavailable.
It has the agreed deterministic tie order and no fee or third capital. Its single
side scratch shape is 3×601 u64 values = 14,424 bytes, below the 16 KiB contract.
This static size does not establish overall runtime headroom; the historical
financially admitted sampler fails the resource probes recorded below.

The clearing sampler authenticates each sealed registration, capital PDA,
program/ProgramData hash and fixed read-only config/price pair. It shares code-hash
work only within one instruction. D74 removes hypothetical maker funding accrual,
cash/claim/IM checks, order-reservation refresh and selected-leg financial rechecks
from sampling. It retains identity/code/price authentication, all declared depth,
inventory/reduce-only caps, the 90–110% independent index price band and exact
one/two-maker allocation. Zero-capacity publications still participate in required
coverage. Zero funded cash does not itself remove a published curve. This changes
the funding trust assumption: published depth need not be executable. Automatic
economic-failure exclusion is deferred; existing quarantine remains fail-closed.

The prior prepared financial projections and103,680 full-route comparisons remain
test-only regression coverage; they are not compiled into the sampling path.
New literal tests distinguish published prices from financial trade admission and
check price-band edges, consumed depth and reduce-only capacity. The scoped real
RPC probe additionally withdraws all three makers' actual funded cash and samples
their unchanged published depth, without enabling trading.

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

## Pre-D74 resource probes (historical, not phase acceptance)

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
The clean`478613a` probe advances into the sell-side search, then fails with an
explicit heap allocation error at1,201,380 simulated CU. It remains a failed,
unbroadcast100-lot sample;30 preceding setup/source/update transactions finalize.
Retain`.local/liquidity-execution/runs/20261028T193112Z-17106`. This is the first
observed heap failure, distinct from the prior compute exhaustion. The next change
borrows the already-loaded capital and uses temporary stack adapters, removing
persistent duplicate root allocations. Thirteen focused native clearing tests,
including the103,680 equivalence cases, and seven affected account-trading tests
pass. The borrowed-capital SBF build passes its frame check; its RPC retry remains
pending, so heap/resource success is not inferred.
Keep the complete registry, full code hashes, exact quantities, risk rules and
20% headroom requirement. At that pre-D74 checkpoint no successful sampler, full-book resource acceptance,
actual financial funding/execution or A37/G25 completion is claimed yet.
Existing custody, source, funded-cash/unpaid-claim, 2 bps/zero-provider and 25%
insurance rules remain in force. P15B/P16B stay Open; 24-hour endurance Deferred.


## D74 published-depth resource result

Clean `2a93394` compiles and passes15 scoped clearing tests,4 independent funding
reference cases and TypeScript checking. The amended100-lot sampler succeeds in
simulation and lands at **1,334,329CU**,1,101 bytes v0,29 unique static accounts,
in `.local/liquidity-execution/runs/20261028T201121Z-29627`. Its fetched event has
the literal expected bid5,999,900/ask6,000,300 and premium1e9; generated SDK and
isolated legacy Anchor event decoding agree.

This still **fails** the1.12mCU headroom target. The harness stops before600 lots,
actual zero-cash makers, stale-input cases and transaction binary/WS checks. Those
checks, full books, actual trading and phase acceptance remain pending. Thirty
setup/source/publication transactions pass before this successful but over-budget
sample. The owned runtime is stopped; no new PostgreSQL directory is created.

Log boundaries attribute530,849CU before the first maker quote,237,366CU within
eight maker quote calls, and566,114CU to the remaining quote/search/bookkeeping
work. The first category includes setup/authentication and is not an isolated
code-hashing measurement. No maker hypothetical financial checks remain in this
sampler. D75 supersedes continued optimization of this on-chain sampler as the chosen
path. Implement and separately measure the restricted publisher replacement;
do not label either design cheap or scalable from this historical single size.
