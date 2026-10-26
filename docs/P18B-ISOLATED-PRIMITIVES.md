# P18B — two-market isolated primitives

This phase implements the normal-path primitives behind the P17/P18 safety gate.
`ISOLATED_TRADING_IMPLEMENTED` and `CROSS_TRADING_IMPLEMENTED` remain false.
Registration, indicative read-only quoting and authenticated source observations
are usable in the explicit successor test profile. Routes and orders reject
on chain until P18C supplies and qualifies isolated group liquidation/default.
Pure transition tests do not count as signed trading lifecycles.

## Accounting and authority

The [shared engine](../crates/financial-core/src/margin.rs) owns one cash balance
and two fixed positions. It reuses existing checked paired-fill, generation and
cumulative-fee arithmetic through transient selected-position views. Views are
never stored as extra cash balances. Isolated roots reject any nonzero field in
the other position slot. A cross-shaped model is an accounting type only; clearing
rejects cross roots in this phase, and P19 owns whole-account cross acceptance.

The [group trading handlers](../programs/clearing/src/instructions/group_trading/)
validate schema, profile, canonical account seeds, group/market/owner binding,
standing module approval, slot/nonce/observation/terms and all-in limits before
committing candidates. Owner aliases cannot self-trade through another child.
Both maker legs must pass their own post-fill health and inventory limits. Fees
leave the trader's funded cash and enter group fees; provider cash pays no fee.
Every changed root advances its state version. Critical events bind the shared
group sequence, actual market state and changed roots/registrations.

The [maker V2 config](../programs/maker-group.rs) reads typed clearing group,
market and capital accounts during initialization and verifies canonical seeds,
owner, immutable isolated mode/market and maker role. It uses separate `maker-v2`
seeds and the `MakerGroupConfig` discriminator. A/B depend on clearing's account
types with `no-entrypoint`; no new package/version or circular runtime CPI exists.
The actual pricing CPI receives only the read-only config and no signer, vault,
capital or arbitrary clearing account. Version-2 requests bind group plus the
existing market/domain/capital/epoch fields; strategy arithmetic remains shared
with V1. A group-wide capital binding prevents reusing a root in another registration.

Maker registration requires owner and group authority with actual funded capital.
Update operation 0 requires owner plus authority for code-hash approval and retains
consumption; operation 1 is owner-only, after the previous epoch expires, and resets
only the new epoch's directional consumption; operation 2 is authority-only
quarantine. Market config changes invalidate future held funding coverage; already
materialized charges remain. Unapproved code, wrong config version, writable config,
foreign capital and substituted return data reject.

## Two source domains and causal funding

D49 pins BTC and ETH lot sizes and source ranges. The six local signed fixture
feeds use primary/guard BTC 1/3, common collateral 2/4, ETH 5/6. Source identity and
owner substitution rejects before policy sampling. Authenticated stale or malformed
source values can record restrictive policy state; their existence never supplies
credible prices. Each market independently qualifies both registered makers and
its own exact bounded bid/ask impact quantity, validates read-only CPI and derives
a capped premium. No BTC observation is copied to ETH.

The source/funding transition preserves the original 20-second local freshness,
confidence/guard checks, two-second sample interval, six-second hold/recovery,
12-second funding outage rule and 30-second catch-up cap. Funding materialization
uses the held sample's original prefix so additional calls cannot change its
rounding. Changed terms or missing qualification discard unverified pending
coverage, retaining actually materialized funding. Custody-mode sampling records
prices but cannot accrue funding. The six-second recovery remains required.

## Orders and protections

Four order slots and two protections belong to each root. Every active order binds
one market, terms, generation and authority epoch. P18B supports owner authority
only. Each order retains cumulative gross notional, fee charged and remaining fee
budget across partial fills/replacement. Reservations use independent adverse
bounds and are summed; there is no bid/ask offset or unpaid-profit credit.

TP/SL requires an existing position. The two siblings share a remaining quantity
bound to that market and position generation. Partial fills reduce the common
budget, stale generations invalidate survivors, and neither sibling can flip the
position. Triggers use the central authenticated market index. Cancellation and
cleanup can use conservative stale-source reserves; they cannot admit a new fill
without credible bounds. A failed multi-leg route leaves nonce, order prefixes,
consumption, cash and claims unchanged.

## Verification and limitations

Focused Rust golden cases exercise the real account/order/route/funding candidates,
with literal independent cash, claim, reserve, fee, trigger and funding expectations.
[Committed A23B acceptance](evidence/P18B.md) establishes the signed four-maker/six-source
setup, CPI/authority negative cases and compiled activation rejection on `286cb4e`. ABI generation/conformance and
SBF frame/packet/account/CU checks are scoped to these new surfaces. Actual results
and tested revisions belong in WORKLOG and the phase evidence note when verified.

P18B does not claim activated fills, group settlement/default, PostgreSQL projection,
service lifecycle, UI readiness, contention throughput or successor endurance.
P18C owns signed isolated recovery/trading acceptance; P19/P20 own cross safety;
P21A/B own actual RPC/WS/PostgreSQL services and fresh qualification. P16A metrics
and the proposal's arithmetic are not evidence for these changes. P15B/P16B remain
separate external gates and the long soak remains Deferred.
