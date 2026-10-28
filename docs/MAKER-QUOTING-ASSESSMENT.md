# Maker quoting and routing assessment

28 October 2026 · R077 · proposal for discussion, not an accepted protocol change

Inspected Rivalt revision: `1c59592eeaf96f0f2fec144ea0a5e63eebeff933`.
No new implementation phase, deployment, test result or economic policy is
authorized or established by this assessment. P15B/P16B remain external gates;
24-hour endurance remains deferred. The demo remains stopped.

R078 follow-up: the user accepts the five-change direction and requests a scoped
plan. [D69 / P29–P34](P29-MAKER-LIQUIDITY-ROADMAP.md) now records that roadmap;
this original assessment remains research, not an exact executable specification
or implementation evidence.

## What the references establish

Jupiter's public integration boundary separates account discovery/update,
size-specific quoting, and execution account construction. Reading account bytes
requires a venue-specific decoder and pricing implementation; a universal quote
account is not required. Its integration test kit compares an SDK quote with
actual program token deltas. This is a useful model for Rivalt's adapter parity,
not evidence that Rivalt or the supplied GoonFi reconstruction passes it.
[Interface](https://docs.rs/jupiter-amm-interface/latest/jupiter_amm_interface/trait.Amm.html),
[test kit](https://github.com/jup-ag/jupiter-amm-interface).

The supplied `GoonFi_V2/metadata.json` explicitly describes a work-in-progress
reconstruction of a closed-source program. It has no positive conformance score.
The following are properties of the supplied source, not verified deployed behavior:

- `state/market_v2.rs:14,668`: ten bid/ask quantity thresholds, seven pricing
  tiers containing ten adjustments per side, and a staleness coefficient.
- `:390,423`: separate directional reference values, update slot and spread
  multiplier; interpolation between active quantity thresholds. These are
  cumulative effective-price points, not independent resting marginal orders.
- `:531`: additional output is calculated from the difference between cumulative
  quantity/price expressions, with direction-specific conversion and rounding.
  The first/last active tier extends beyond its threshold; the last threshold
  alone is not a hard liquidity cap.
- `:920,971`: vault-inventory adjustment, optional smoothing, maximum quote age,
  cumulative side quantities and time-dependent decay of prior consumption.
- `instructions/quote.rs:101,225` and `instructions/swap.rs:293,353`: a read-only
  quote entry point and swap call the pricing calculation. Route classification
  also affects pricing. The quote path uses a placeholder signer while execution
  uses the user; shared arithmetic alone does not establish universal parity.
- `account_info.rs:11`: the reference context is read from an account owned by
  a separate price-context program. That producer's update implementation and
  the aggregator's actual adapter are not established by this source inspection.

These parameters describe an executable pricing policy over spot inventory.
They do not establish segregated token deposits at every displayed price.
Source SHA-256 for `state/market_v2.rs`:
`8f29218bef892e112bc2d1af83dd15d05f3691d7bebf73c6032ec0c3f835a3cb`.

Phoenix's official perpetuals documentation confirms a maker mid with bid/ask
regions, a separate refresh flag for replenishing consumed liquidity, and
risk-clipped availability. Its combined FIFO/spline matching semantics are
separate from Rivalt's chosen off-chain allocation. We can reuse the compact
quoting idea without adopting its entire matching engine.
[Spline model](https://docs.phoenix.trade/phoenix/matching-engine/spline-liquidity),
[matching](https://docs.phoenix.trade/phoenix/matching-engine/matching-engine).

Meteora DLMM uses actual token liquidity in discrete fixed-price bins. Swaps move
through bins as output inventory is consumed. Distribution can be uniform,
center-heavy or edge-heavy; diminishing liquidity away from mid is not a general
requirement. A maker moving a private reference is different from moving an LP's
existing bin positions.
[Formulas](https://docs.meteora.ag/core-products/dlmm/formulas),
[strategies](https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases).

## Actual Rivalt gaps

| Area | Inspected implementation | Proposed direction |
|---|---|---|
| Pricing shape | `crates/maker-interface/src/lib.rs:133` fixes A/B depth, spread, knee and skew; V2/V3 reuse it | Configurable independent bid/ask regions and inventory response |
| Maker identity | `account_trading/makers.rs:100` binds IDs 0/1 to two programs and one exact config layout | Separate maker instance/capital identity from strategy implementation/version |
| Clearing coupling | `account_trading/makers.rs:464` recomputes the fixed curve and checks full response equality | Stable execution checks plus an admitted pricing evaluator; preserve exact canonical-curve validation |
| Quote updates | `programs/maker-account.rs:95` only renews an expired epoch; fixed shape and externally supplied reference | Separate price update, shape update, replenishment and security epochs |
| Allocation | `packages/sdk/src/allocate-route.ts:17` exactly enumerates the fixed A/B partitions | Common exact quote adapter; optimize feasible one/two-maker allocations independently of maker IDs |
| Funding | `account_trading/oracle.rs:212,241` prices candidate allocations with the same fixed math and searches using curve shape assumptions | A canonical, executable funding quote context and validated curve/search properties |
| Settlement | Clearing owns collateral, claims, fees, risk and maker consumption | Preserve these boundaries; a quote account is not a collateral account |

Paths in the clearing rows are relative to `programs/clearing/src/instructions/`.
The existing implementation is a bounded reference integration, not a completed
arbitrary-maker platform. Its router already accounts for size, aggregate fees
and account health; replacing it with a top-of-book price comparison would lose
functionality.

## Recommended boundary

Keep common clearing and independently funded, per-market maker capital. Introduce
a versioned quote/execution contract, with an ordinary configurable curve module
as the first implementation. Multiple makers should be able to instantiate that
module without deploying a new program. A maker's private signal/hedging strategy
can remain off-chain and publish public execution parameters.

The quote contract answers: for this market, side, exact base quantity, current
authenticated state and declared context, what is the exact gross quote amount,
remaining capacity and validity? The discoverable descriptor identifies the maker,
capital, approved evaluator/version and bounded read dependencies. A derived depth
view is useful for display and search; it is not the sole execution authority.
No request needs a maker signature or network round trip once standing liquidity
has been published.

The default module should have independent bid/ask shapes, a movable maker
reference, integer ticks/lots, one-sided and reduce-only settings, inventory skew,
finite lifetime and side/exposure limits. Use bounded ordered regions or knots,
with exact cumulative cost, explicit marginal-versus-average semantics and fixed
rounding. Prototype the region bound rather than treating ten or sixteen as a
measured optimum. Keep marginal buy prices nondecreasing and marginal sell prices
nonincreasing in the default model. Smooth high-order splines add little here and
can introduce overshoot and validation problems.

Repricing must preserve consumption. Replenishment must be a separate authorized
action that restores offered depth without restoring cash or erasing inventory,
claims or risk. A price/heartbeat change must not silently replenish the cheapest
segment. Reject reordered updates using maker sequences. Test shape replacement,
fragmented fills and inventory recomputation for unintended reset advantages;
do not assert path independence merely because each individual call uses a
cumulative-cost formula.

A later custom module may implement a different exact quote function behind the
same envelope. It needs an approved, bounded read set, deterministic off-chain
adapter, producer/version checks, declared consumption behavior and real-program
parity. It receives no vault signer or arbitrary writable clearing accounts.
Generalizing away from the current full fixed-formula equality check changes the
trust boundary: code admission and economic adversarial cases must cover it.
Shared default/insurance exposure means dishonest pricing cannot be dismissed as
only the maker's problem.

Do not promise arbitrary private conditional logic, universal book flattening and
cheap globally optimal routing simultaneously. Start with the canonical curve;
admit custom capabilities when their trading and funding semantics are explicit.
An advertised curve from an arbitrary callback is a search hint unless its
execution equivalence is actually enforced.

## Routing, freshness and funding

Optimize total buy cost or sell proceeds, including the single existing 2 bps
venue fee and exact rounding, across eligible capital-backed candidates. Do not
charge a new hidden module fee. Keep the current atomic two-maker execution bound;
more discovered makers is a separate registry/capacity change, not permission for
unbounded transaction fan-out. Report best execution within that constraint and
the observed snapshot, not across all hypothetical venues or future chain state.

For monotone marginal curves, compare marginal cost and exact candidate breakpoints,
then verify the complete allocation. Health constraints and integer rounding still
matter. Arbitrary nonconvex curves cannot inherit that optimizer's optimality claim;
they require bounded search and an explicit guarantee. Deduplicate shared capital
so multiple quote accounts cannot advertise the same capacity as independent.

At execution, clearing recomputes current quotes and risk, accrues funding, checks
the user's size/limit/fees/expiry, consumes depth and commits both sides atomically.
A book snapshot does not reserve liquidity. Competing fills can exhaust capacity.
Separate authority/shape changes from rapid price changes. A possible later
bounded-latest-price route could preserve user limits without rejecting every
benign reference update; this deliberately changes today's signed quote/prefix
binding and requires an explicit contract and race tests before adoption.

Retain independent risk sources and their hard stale/confidence/mode gates. The
maker reference prices execution only. Widening a maker spread does not authorize
trading when the risk oracle forbids it. Funding already depends on executable
maker depth: specify one public sampling context, complete required coverage,
same pricing/capacity, no consumption, and bounded manipulation/missing-input
behavior. Do not let a module advertise special funding-only liquidity.

Per-maker config accounts reduce configuration coupling; they do not remove write
contention on maker capital, consumption or common market accounting. Measure
update-to-landing latency, quote/execution divergence, rejection causes, bytes,
compute and account locks under simultaneous updates/fills. More frequent price
updates are useful only if actual execution reliability improves.

## Passive strategies and an evidence-bounded next step

A passive bin or constant-product pricing strategy can be adapted into a Rivalt
maker funded in Rivalt collateral. An existing Meteora spot pool cannot directly
assume Rivalt perp positions, funding or default obligations. Its LP funds are not
Rivalt margin. External spot execution for hedging and public pooled LP capital
would be separate products, economics and authorization.

Before a large new delivery stack, propose one bounded prototype using two
contrasting configurable strategies: tight shallow depth and deeper inventory-aware
depth. Compare against today's A/B baseline on the same declared workloads:

- exact quote/program parity, cumulative depth, resets and fragmented rounding;
- allocation against an independent exhaustive comparator on bounded domains;
- fills, user all-in price, freshness/rejections, update latency and transaction cost;
- maker inventory, funding, funded and unpaid P&L separately, markouts at declared
  horizons, and explicitly simulated hedge costs;
- actual Surfpool RPC/WS/PostgreSQL reconciliation and unsafe-route rollback.

No outcome, target threshold or profitability is measured by this research run.
Agree quantitative acceptance and price-update semantics before implementation;
proceed beyond the prototype only if it improves the relevant trade-offs. This
proposal does not call for another margin/custody rewrite or close the independent
maker gate.
