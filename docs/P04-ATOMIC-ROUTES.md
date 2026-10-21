# P04 atomic routes and bounded allocation

21 October 2026 · synthetic local test profile only

P04 enables immediate signed one/two-maker FOK execution inside clearing. Maker A/B still receive exactly one read-only config per CPI and no signer seeds, collateral vault, capital accounts or arbitrary remaining accounts. Clearing verifies the full approved ProgramData hash, current registration/config/lifetime and exact 92-byte response before any route effects commit. No maker co-signature is needed after standing registration.

## Explicit test-risk boundary

Default clearing builds reject test-route initialization, publication and execution with Profile. `ops/build.sh` produces and tests a default artifact, then explicitly enables `local-test-profile` for local acceptance. This is not an authenticated oracle implementation or deployment permission. The old CustodyOnly mode (0) remains the initialization default. Market authority can activate TestRoutes (1) once, creating `[test-routes, market]`; activation advances the market config epoch. There is no return-to-custody switch that can erase exposure or fees.

`initializeTestRoutes(reference, duration)` and `publishTestRisk(reference, duration)` are explicitly named synthetic fixture authorities. Only the stored market authority signs them. Reference is 10,000–100,000 quote atoms/lot, lifetime 64–3,600 actual slots, start inclusive/end exclusive. Long risk uses floor(reference×99/100), short risk and IM use ceil(reference×101/100). Each leg execution VWAP must be inside reference×[90%,110%]. Publishing advances a checked observation sequence without changing positions, funding or gross exposure. Execution binds that exact sequence and checks current Clock validity. No caller supplies a risk price in a route. A cached flag never extends validity.

These fixture bounds are index-derived arithmetic around a declared synthetic reference; they do not verify upstream BTC/USD or collateral/USD, independent guard provenance, wall-clock freshness or funding. P07 replaces this profile with G08 authenticated observations and action modes. Funding F and all participant checkpoints remain zero; settlement P and reservations/order slots remain zero. Unsupported nonzero state rejects. P06 owns collection/settlement and admissible exits under the then-implemented profile, P08 orders, P09 distressed reduction/default. Ordinary P04 reduction must still pass full final IM; no deficit-improvement exception is exposed.

Deposits remain real token transfers and can strengthen exposed accounts. Once TestRoutes activates, withdrawals are disabled, including flat accounts, until a guarded exit implementation exists. Insurance/surplus/pause operations remain reconciled; all collected taker fees stay in T. No treasury transfer is enabled. Approval/sync/quarantine continue to work for makers with positions and preserve membership, inventory, claims and consumed prefixes.

## Signed authority and atomic transition

`executeRoute` binds domain, market accounts, terms/config and observation epochs, exact side/total size, nonce, inclusive start/exclusive expiry, aggregate all-in limit, maximum fee and one/two exact leg sizes with quote/authority epochs. Optional generation can restrict any intent; reduce-only requires the current generation, opposite side and size no greater than current absolute position. The wallet owner signs; there is no detached signature or delegated session.

At most two distinct maker IDs and capital accounts are accepted; trader and maker roles cannot alias. The second account tuple must be wholly present or wholly absent. Extra remaining accounts reject. Typed ownership, deterministic PDAs, program/ProgramData and config/capital/owner bindings are checked before CPI. Each selected maker is called once. Current funded cash, inventory and side consumption determine terms; stale terms cannot exceed signed limits even if the nonce is freshly rebuilt.

Candidate q/v updates accrue first, preserve exact paired claims and advance trader generation once for the aggregate route, independent of split. Final adverse equity must cover IM and implemented reservations for trader and both makers. Positive unpaid profit provides zero margin credit. Current maker inventory limits and the market sum-of-absolute-exposures cap are enforced. The route state tracks that sum by checked before/after deltas; no full cohort scan enters normal execution.

One fee `ceil(sum(gross_quote)/5000)` is deducted from trader cash into T; provider cash is unchanged. Buy limits bound gross+fee, sell limits bound gross−fee. Perp gross updates v, never transfers gross collateral. Nonce, consumed prefixes, q/v/generation, total C/T, gross exposure, sequence and events commit together. A failure anywhere—including a subsequent instruction in the transaction—leaves all venue accounts unchanged; failed event bytes are not committed fills.

## G05 envelope and allocation

| Item | Bound / rule |
|---|---|
| Immediate total size | 1–4,608 lots; positive leg sizes sum exactly to total |
| Selected makers | One or two; fixed admitted A/B IDs; no repeated capital |
| Signed intent lifetime | At most 150 slots, inclusive start/exclusive expiry |
| Minimum new gross notional | 1,000 atoms |
| Submitted compute limit | 400,000 CU, with acceptance requiring ≤320,000 CU (20% headroom) |
| Serialized transaction | ≤1,232 bytes; v0 with no address lookup table required |
| Message accounts | ≤20 in the declared route fixture, including payer/budget/programs |
| Pricing CPI | One read-only config; no signer; 92-byte exact response |
| Allocation | Exact bigint enumeration of ≤513 A allocations; B takes the remainder |

`packages/sdk/src/allocate-route.ts` is the pure quote-router core for later services. It receives one labeled snapshot, trader cash/claims and the eligible A/B candidates. It enumerates every feasible integer partition, including single-maker endpoints; evaluates current curve capacity, per-leg execution band, final maker/trader health, aggregate fee, signed limits and global exposure; and minimizes buy all-in cost or maximizes sell all-in proceeds. Ties prefer fewer legs, lower stable maker ID, then more A quantity. Candidate order does not change the answer. Empty/insufficient/unsafe liquidity returns null. Snapshot freshness and state acquisition remain the service's responsibility, and chain validation is authoritative.

The independent comparator enumerates individual marginal lots into prefix arrays, then enumerates all quantity partitions with its own risk equation. It does not call the production quote/allocator to compute expected values. Signed program fixtures independently enumerate marginal prices and assert actual account cash/q/v/generation/nonce/consumption, cash conservation, zero exposure, exact aggregate claims and token-vault reconciliation after each fill.

## Accounts, events and qualification

Existing MarketState/Participant/MakerRegistration layouts retain schema 1; mode 1 extends the implemented profile without changing their bytes. New TestRouteState is 97 bytes, including discriminator: market, observation sequence/reference/lower/upper/start/end/gross exposure and bump. There is no live account migration claim. Generated IDL/SDK freezes exact instruction/account/error layouts. New errors 6117–6120 are intent, observation, limit and health failures.

`TestRiskPublished` records version/terms and declared synthetic bounds, validity, observation/market sequences and config epoch. `RouteExecuted` is the single authoritative fill event: domain/market/epochs/sequence/slot, observation sequence, trader/nonce, aggregate side/quantity/gross/fee and post-state, plus one/two detailed maker legs with quantities, gross, epochs, consumed prefix and q/v/generation. Leg details are components of this event, not additional fills. P05 must apply only successful transaction events and use event positions for deduplication.

The hostile fixture at `tests/fixtures/hostile-maker` is an adversarial replacement of the real B program identity, not a fourth first-party venue program. Tests first reject its unapproved upgrade, jointly approve it solely for qualification, then exercise wrong gross, oversized return, attempted read-only config mutation and explicit CPI failure. RPC uses actual signed deployments and independently fetched transactions. It restores and reapproves the normal binary afterward. Source-unavailable, alias, nonce, epoch, capacity, fee/price, owner and generation failures use the same no-residue checks. Default-build activation rejection is also tested with its actual SBF artifact in LiteSVM.

`pnpm test:routes` runs signed compiled-program scenarios. `RIVALT_SLOT_TIME=20 pnpm smoke` additionally runs the full frozen build/ABI/economic regression and actual Surfpool RPC/WS scenarios, capturing failed transactions, independently decoded live events and measured resources. PostgreSQL/services, authenticated oracle/funding, persistent orders, operational default, browser, soak, devnet and external gates are later-phase work. Actual results and revision identities belong in WORKLOG and the acceptance evidence, not in this contract.
