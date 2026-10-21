# P07 controlled oracle policy and common funding

This phase extends the explicit local-test-profile build. Market mode 2 is selected once by market authority from mode 1. The old synthetic price setter then rejects. The default build cannot initialize or sample this profile. MarketState is 232 bytes, TestRouteState with embedded OracleState is 387 bytes, and ExitGuard is 109 bytes (all including discriminator). Account/event layouts are regenerated experimental schemas; no upgrade-in-place migration is promised.

## G08 local profile

| Parameter | Selected value |
|---|---|
| Source identity | `oracle-fixture` program `A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj`; four immutable PDAs derived from two distinct fixture signer keys and feed IDs `[1;32]` through `[4;32]` |
| Trust | Signed local dependencies, not upstream verification or independent economic operators. The fixture deliberately permits invalid payloads for negative tests. Actual verification remains P13. |
| Schema | Exact owner/discriminator/length/PDA; verifier equals fixture ID; verification level 2; monotonically nondecreasing source sequence; USD exponent exactly -6 |
| BTC range / confidence | 10,000–100,000 USD; confidence at most 50 bps |
| Collateral range / confidence | 0.5–1.5 USD; confidence at most 25 bps; Normal requires 0.95–1.05 USD for both sources |
| Freshness | At most 20 seconds old; at most 2 seconds future skew; on-chain Clock timestamps, distinct from slot lifetimes |
| Cross-source divergence | Primary and guard converted references differ by at most 1% of primary; otherwise no credible bounds |
| Risk / triggers | Primary BTC/USD divided by collateral/USD, integer atoms/lot; confidence-derived interval plus 1% model envelope, union with guard. Missing invalid guard with valid primary gives at least ±3% and Degraded. Triggers in P08 use this central reference. |
| Sampling | At least 2 seconds apart; prior sample held at most 6 seconds and no later than source deadline or either maker expiry; maximum unverified catch-up 30 seconds |
| Recovery | At least 6 seconds of consecutive qualified observations, gaps at most 6 seconds; any invalid observation or changed market configuration restarts the window |
| Funding outage | Risk increase blocked after 12 seconds without a qualified sample, even if a cached Normal status remains |
| Reference quantity | ceil(6,000,000 collateral atoms / reference atoms per lot), therefore 60–600 lots |
| Premium | Fee-excluded optimal aggregate impact midpoint; ±50 bps cap; coefficient 1; period 3,600 seconds |
| Fees/budget | Separate funding signer, 5,000,000-lamport run cap and existing 20,000-lamport immutable-intent reservation; no participant cash charges |

Caller-supplied wrong source accounts, owners or writable flags reject the instruction. They cannot manufacture a source failure and place the market into a restrictive mode. Invalid values in the actual authenticated configured feeds are recorded as policy failures. Neither source signer can supply a funding rate directly.

## Complete maker coverage and bounded execution

Every sample supplies exact maker registrations 0 and 1, both capital PDAs, approved ProgramData and bound configs. Each module's code hash and authority are authenticated once in the transaction; subsequent pricing CPI receives only the same read-only config. Both modules must successfully quote both directions, even when the optimal selected quantity from a module is zero. Sampling never changes consumption.

Funding depth uses a deliberately conservative funded margin bound. At the current fully accrued funding index, take whole-atom adverse risk equity minus current IM and reservations. Each additional lot reserves `ceil(upper/10) + max(ceil(1.1*M)-lower, upper-floor(0.9*M))`. Thus every quantity up to the capacity remains admissible for marginal execution prices inside the route's ±10% band. Capacity is additionally limited by remaining curve depth, inventory and the module's funded availability. Positive unpaid profit supplies no capacity. This may invalidate funding before all potentially executable reducing liquidity disappears; ordinary route admission is unchanged.

Fixed A/B cumulative ask costs are convex and bid proceeds concave over this bounded prefix. Binary search on discrete differences selects the exact best split within the qualified depth. Each selected quote is recomputed by CPI and checked for exact producer/return data and post-fill health. An independent exhaustive per-lot reference checks the largest quantity; the submitted funding ceiling is 1,200,000 CU with an acceptance threshold of 960,000 CU (20% headroom), 20 message accounts and 1,232 bytes. Actual measurements belong in evidence.

## Causal index and participant ownership

The observation stores base F, scaled premium, sample time, bounded hold endpoint, source/strategy/config stamps, outcomes and coverage counters. For a covered instant `t`, effective `F = base + trunc(premiumScaled * (min(t, holdEnd)-sampleTime) / 3600)`. A new observation never supplies a retrospective rate. Invalid inputs, changed control epochs or a catch-up gap discard only unverified, unmaterialized pending time, preserving charges already materialized at a position change or exit. Coverage records both validated hold time and time already materialized before an invalidation; skipped time remains explicit.

Every route, collection, gain settlement and withdrawal accrues the participant at the effective on-chain index before changing economic state. Routes accrue all touched participants before changing q. A flat participant retains its exact signed fractional claim through reopening. New entrants start with zero claim. MarketState records the latest materialized index and time; the sample prefix remains the authority for subsequent clock-derived evaluation. Partial accrual frequency therefore does not compound truncation.

The midpoint premium truncates toward zero by less than one scaled atom/lot per sample. Each causal prefix truncates by less than one scaled atom/lot; participant accrual itself is exact at the selected 1e9 scale. Compared with the ideal rational hold, index error is less than `(1 + 6/3600)` scaled units per sample, before the explicit cap. With at most 1e8 lots per participant, the corresponding absolute allocation error is less than 0.101 quote atom per sample per participant. This is a bounded quantization error, not a fractional cash transfer; no remainder is assigned to a later entrant.

Reconciliation is `sum(v_i + q_i*F_i) = P*SCALE`, together with `sum(q_i)=0`. Summing stored v alone is incorrect after lazy funding accrual. Events carry actual funding checkpoints/materialization time; database rebuilds include the full observation state. Display previews label clock/source state and never treat an off-chain preview as authority.

## Action restrictions and exits

Normal requires credible current source bounds, a completed recovery window and recent complete funding qualification. Degraded blocks new risk but permits valid reduce-only routes with existing post-IM checks. No credible bounds blocks ordinary exposed execution. Custody deposits and participant registration do not invoke source or maker pricing. P08 owns cancellation, which must remain independent of funding availability.

ExitGuard checks every member against the extrema of last materialized, current and remaining held-funding endpoints, and sums fully checkpoint-adjusted claims. This protects the certificate while time advances without a financial mutation. The market sequence and observation still invalidate the certificate on changed state. Without credible bounds, only an entirely flat, conservatively solvent complete cohort can certify cash/profit exits; a zero net position alone is insufficient. No liquidation, insurance spending, default or persistent-order instruction is enabled by this phase.

## Validation status

Implementation and acceptance are in progress. Development tests are not clean committed acceptance. See WORKLOG for actual runs, revisions and remaining gates. Real upstream dependency verification, browser wallet, soak, devnet, independent-maker and funded-pilot evidence remain later phases.
