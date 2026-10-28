# P29B — canonical maker liquidity contract

28 October 2026 · D70 · A34B/G22 · executable design, not runtime qualification

This realizes [the P29–P34 roadmap](P29-MAKER-LIQUIDITY-ROADMAP.md). The user
authorizes sequential implementation and open, ready stacked PRs. P29B freezes the
contract; P30–P34 must implement and qualify it. Model tests do not activate trading.
The inspected implementation is inherited `ca14b86` (runtime baseline `1c59592`).

## 1. Code-to-contract map and retained economics

| Current implementation | Deliberate change | Owning phase |
|---|---|---|
| `crates/maker-interface/src/lib.rs`: IDs 0/1 select hard-coded curves | Capability 1 selects one configurable integer curve; instance ID is identity only | P30 |
| `programs/maker-account.rs`: one config, expired-only publication | Separate shape and small price accounts; independent consumption | P30 |
| `account_trading/makers.rs`: exactly two IDs/program assignments | Three sealed registry slots, unique capital binding, two admitted implementations | P30/P32 |
| `packages/sdk/src/allocate-route.ts`: A/B-specific exact enumeration | Every eligible singleton/pair, independent adapter, exact feasibility | P31 |
| `account_trading/routes.rs`: strict quote epoch/consumption prefix | Strict security/shape/depth epochs; latest price/consumption within signed limit | P32 |
| `account_trading/oracle.rs`: fixed curves/pair and binary-search assumptions | Complete three-maker input set, same canonical quotes and exact feasible search | P32 |
| Existing V3 workers/indexer/UI | Versioned discovery, updates, actual quote versions and rejection reasons | P33/P34 |

Paths above under `account_trading/` are relative to
`programs/clearing/src/instructions/`. Existing code is evidence of gaps, not of the
new contract's acceptance. D22/G04, D23/G05 and D53/D62 fixed strategy assumptions
are superseded **only for profile 4**. Existing G08 causal/complete funding is retained.

Keep V3 financial schemas, BTC/ETH lot units, one collateral mint, 64-member cohort,
isolated maker roots, whole-root funding and reservation refresh, 10% IM/5% MM,
index-derived adverse valuation, zero positive unpaid-profit margin credit,
2 bps aggregate taker/zero provider fee, persistent fee-prefix rounding, 25% fee
insurance share with existing carry, TP/SL, liquidation and complete default. No
new loss bearer, cross-market insurance transfer, margin credit or payout promise.
The canonical quote supplies **gross notional only**, never funded cash or P&L.

## 2. Identity, deployment and authority

- Fresh local venue/domain with `VenueV3.schema_version=3`, immutable
  `profile_version=4`; financial account layouts remain schema 3. New maker
  accounts/quote ABI use version 4. No in-place profile-3 upgrade or account rewrite.
  The default/devnet build rejects profile-4 financial activation. Quote/control
  support may exist before P32; an explicit qualification build gates execution.
- Exactly three registry slots per market, IDs 0,1,2. All must be provisioned and
  registry sealed before funding or trading. At least two instances share a maker
  implementation; the existing A/B programs remain the two admitted deployments.
  Programs do not choose a pricing strategy from the instance ID.
- Registry entries cannot be removed, reused or replaced after sealing. Disabled,
  exhausted and quarantined makers retain liabilities and cohort membership.
  A new capital/implementation topology requires a fresh local deployment in this
  bounded release. Maker capital cannot be a trader's selected root in its route.
- Reuse clearing's `[capital-v3, capital]` unique binding: one capital, one
  registration across programs and instance aliases. Capital must be the owner's
  schema-3 isolated maker root for the exact venue/market. Config replicas cannot
  supply additional collateral or depth. The same owner may fund distinct roots.
- Owner + venue authority jointly admit/renew the program, ProgramData and complete
  SHA-256 code hash. Validate the actual loader/program-data relationship and full
  code bytes on use, retaining the 1 MiB bound. Deduplicate hashing identical
  ProgramData within a transaction; do not replace it with a prefix or trust cache.
- Owner chooses an updater and expiry slot. Updater may **only reprice**. It cannot
  change shape/caps, replenish, withdraw, transfer, change permissions, approve
  code or release quarantine. Owner may reprice without the updater expiry limit.
  Revocation increments control epoch and invalidates the prior publication.
- Shape/permission/mode changes go through clearing's control gateway. It verifies
  the owner and signs only a dedicated `[liquidity-control-v4, venue, capital]`
  PDA into the maker control instruction. This PDA is not a custody authority and
  needs no stored data. The maker checks the exact clearing program-derived PDA.
  Neither this CPI nor quote CPI receives a vault signer, writable clearing state
  or arbitrary remaining accounts. Quote CPI gets only read-only config and price.

Profile checks in existing financial `account_*` instructions require 3. P30 adds
`initialize_liquidity_venue_v4` and permits existing flat custody provisioning only
under `maker-liquidity-qualification` in CUSTODY mode. Events report the actual
venue profile. P32 must audit the remaining paths explicitly: extend common custody/risk/order/settlement/safety paths to
4 where qualified; legacy maker/route/sample entrypoints continue rejecting 4.
Clients must reject unknown profiles even when financial schema bytes decode.
Deployment bundles contain program hashes, domain, addresses, registry and transaction
resource settings. They cannot depend on retained acceptance dumps. Preserve existing profiles.

## 3. Canonical arithmetic (capability 1)

All prices/offsets are integer quote atoms **per market lot**; notionals are quote
atoms. JSON uses decimal strings. Checked signed i128 intermediates, checked
u64 results; no floating point, saturating arithmetic or implicit wrapping.
Inventory/target bounds are ±100,000,000 lots; price bounds 1…1,000,000 atoms/lot;
route size 1…4,608 lots. Existing minimum notional remains 1,000 atoms.

Each side has 0…8 regions `(end_lots:u64, offset:u64, slope:u64)`. Ends strictly
increase, final end ≤4,096. Offsets 0…1,000,000 and slopes 0…1,000; every region's
last offset is ≤1,000,000. The next region starts at least at the prior region's
last offset. At quantity index `j` in `[start,end)`, offset is
`offset + slope*(j-start)`. Empty side is allowed; both sides empty reject.
Unused array entries are zero. Price jumps are allowed; backwards marginal prices
are not. Configuration mode is 0 disabled, 1 enabled, 3 enabled/reduce-only.

For maker inventory `q`, target `t`, step `s∈[1,100,000,000]`, tick `k∈[0,1000]`,
define a convex inventory potential:

```
n = abs(q-t); a = n // s; r = n % s
H(q) = k * (s*a*(a-1)/2 + a*r)
O_side(c) = sum of the first c configured offsets, using arithmetic series

taker buys d, maker inventory q -> q-d:
  gross = anchor*d + O_ask(c+d)-O_ask(c) + H(q-d)-H(q)
taker sells d, maker inventory q -> q+d:
  gross = anchor*d - O_bid(c+d)+O_bid(c) - H(q+d)+H(q)
```

`c` is the corresponding clearing-owned consumed counter. All arithmetic is exact;
there is no additional quote rounding. Each marginal price, including both
endpoints, must be within the price bounds. Ordered marginal prices make checking
the two endpoints sufficient. Execution also applies the existing independent
90%…110% index band and full account admission; config validation alone does not
guarantee a currently executable quote. Negative/overflow prices reject.

Quantity cap is min(unconsumed side depth, directional inventory cap). A taker buy
has headroom `q+short_cap`; sell has `long_cap-q`, floored at zero. Caps are
0…100,000,000. Reduce-only additionally caps buy at `max(q,0)`, sell at `max(-q,0)`;
it cannot cross zero. Shape replacement below consumed depth leaves zero capacity.
This cap is an upper bound, **not a claim every smaller size is healthy**. Exact
funding, reservations, fee/claims and post-fill root health decide feasibility.

At fixed anchor/shape, cumulative offsets and potential telescope: splitting a
same-direction fill produces exactly the same gross as the combined fill, including
crossing zero inventory or region boundaries. Independent new user transactions
may pay an extra fee atom because each charges its own ceil; stored-order subfills
use the existing cumulative-notional fee prefix. Repricing or explicit replenishment
changes future quotes and is outside fragmented-fill equivalence. Inventory skew
telescopes on a round trip; nonnegative side offsets prevent extracting it for profit.

Literal example: anchor100, step2, tick2, target0, bids `(3,2,1),(8,8,0)`, asks
`(3,3,2),(8,12,0)`, zero consumption/inventory. Buy 3 costs 317, buy 4 costs 431,
sell 3 receives 289. Buy 3 starting inventory 3 costs 313; sell 3 at inventory −3 receives 293.
`tests/financial/maker_curve_reference.py` is the independent specification;
`test_maker_curve_contract.py` checks a separate per-lot derivation and literal values.
P30 must compare real Rust/SDK/program results against these expectations.

## 4. Transitions, races and held funding

All counters start at 1 except price sequence and consumption at 0. Checked
increments reject at exhaustion. Every failure is atomic, including failed CPI.

| Transition | Authority / preconditions | Effects / pending routes |
|---|---|---|
| Initialize | Owner, fresh capital identity, profile 4 | Immutable bindings, zero consumption, no valid price; no financial activation |
| Reprice | Owner or unexpired updater; exact expected control and price sequence | Increment price sequence, store positive anchor and actual Clock slot/time; consumption/shape/security unchanged |
| Replace shape/caps/TTL | Owner via gateway, exact authority/control/shape epochs | Increment shape epoch, retain both consumption counters; strict pending shape bindings fail |
| Rotate/revoke updater | Owner via gateway, exact authority/control epochs | Increment control epoch; old price's control mismatch invalidates it; fresh authorized reprice required |
| Replenish | Owner via clearing, exact authority/depth epochs, enabled and safe venue/market | Increment depth epoch; clear only selected side counters; retain positions, cash, claims, funding checkpoints, orders and reservations |
| Disable / enable | Owner via gateway | Change mode and increment shape epoch; enable also increments control epoch, requiring fresh price; no implicit replenish |
| Quarantine | Venue authority | Increment authority epoch, invalidate future quote use; retain obligations |
| Approve code / release quarantine | Owner + venue, full hash admission | Increment authority epoch, require fresh control epoch/publication; no consumption reset |
| Expire | Clock reaches either price deadline | Quote unavailable without mutation; no refresh, replenishment or cash movement |

Publication requires CAS `(expected_control, expected_price_sequence)`; different
updates cannot reorder silently. The price is valid only if config/price control
epochs agree, `updated_slot ≤ slot < updated_slot + ttl_slots`, and
`updated_time ≤ now < updated_time + 6`. `ttl_slots` is 1…150 (default 150). Both
deadlines apply. Actual timestamps come from Clock, never user input. An updater's
accepted publication can live for its TTL after its delegation expires; revocation
actively invalidates it. No heartbeat restores depth. Repricing a disabled/paused
maker may publish data but cannot bypass enable, risk, source or venue gates.

**Structural changes are coordinated, ordinary repricing is not.** Before shape,
permission, replenish, disable, quarantine or approval changes, clearing materializes
the old valid held funding interval at the current Clock, then truncates future
held accrual: persist the resulting index, set `funding_base` to it, set
`held_until=sampled_at`, clear `valid_since`, and mark sample Degraded/unqualified.
Do not backdate source observations or reverse any accrued funding. Recovery needs
new complete samples and the existing six-second recovery. These changes are denied
during default/frozen resolution; existing safety-owned quarantine transitions must
use the same causal materialization before entering that mode. Pure repricing does
not rewrite a held sample: it describes the next sample, while the old sample can
accrue only to its already authenticated bounded endpoint. It never bumps a market
config/security epoch, root nonce, or unrelated market.

If a fill lands before another signed route, the latter uses current inventory and
consumption; it must still fit capacity and user limits. If a reprice lands first,
the route uses that price within the same limits. If shape/control/depth/authority
changes first, reject the stale binding even if its price would be favorable.
Expiry, source degradation, insufficient margin, exhausted depth or a failed second
leg reject the entire route without fee, counter, root, order or vault changes.

## 5. Wire contract and bounded dependencies

Borsh, little endian, no padding; bool one byte, public keys 32, signed values two's
complement. Anchor discriminators are first 8 SHA256 of `account:<Type>`,
`global:<snake_case_instruction>` or `event:<Type>` respectively. Reject trailing
data, unsupported version/capability, noncanonical bools, unused region bytes or
unexpected accounts. `LAYOUTS` in the reference pins field order/width/offsets.

| Account / owner / seeds | Bytes including discriminator | Ordered payload fields |
|---|---:|---|
| `LiquidityRegistryV4` / clearing / `liquidity-v4,market` | 173 | schema:u16; venue,market:keys; count:u8; sealed:bool; registrations:[key;3]; bump:u8 |
| `MakerRegistrationV4` / clearing / `maker-v4,market,instance:u8` | 333 | schema:u16; venue,market,capital,owner,pricing_program,program_data,config,price:keys; approved_hash:[u8;32]; instance:u8; authority_epoch,depth_epoch,buy_consumed,sell_consumed:u64; quarantined:bool; bump:u8 |
| `MakerCurveV4` / maker / `curve-v4,capital` | 691 | schema:u16; venue,market,capital,controller,owner,updater:keys; updater_expiry_slot,control_epoch,shape_epoch:u64; domain:[u8;32]; instance:u8; capability:u16; mode:u8; ttl_slots:u16; target:i64; skew_step,skew_tick,long_cap,short_cap:u64; bid_count,ask_count:u8; bids,asks:[Region;8]; bump:u8 |
| `MakerPriceV4` / maker / `price-v4,config` | 83 | schema:u16; config:key; control_epoch,sequence,anchor,updated_slot:u64; updated_time:i64; bump:u8 |

Config immutable fields are schema, venue, market, capital, controller, owner,
domain, instance, capability and bump. Fixed owner transfers require a fresh
deployment in this release. `ShapeV4` is mode,ttl,target,step,tick,long/short cap,
counts,region arrays in config order (429 bytes). Region is three u64s (24 bytes).
All maker mutable dependencies are exactly config and price. No dynamic read list,
external feed CPI, taker identity, router identity or funding-purpose flag.

**Quote ABI:** `QuoteRequestV4` (156 bytes) is version:u16, domain:[u8;32],
market:key, capital:key, instance:u8, authority/control/shape/depth epochs:u64,
side:u8 (0 buy/1 sell), lots:u64, inventory:i64, consumed:u64. `QuoteResponseV4`
echoes that request followed by price_sequence, anchor, gross, remaining,
valid_until_slot:u64 and valid_until_time:i64 (204 bytes). Remaining means available
capacity **after** this quantity, before financial admission. CPI producer must
equal the admitted executable program; require exact length and byte-equivalent
canonical recomputation. Clock supplies expiry checks. A direct maker quote is a
mathematical quote over supplied inventory/consumption, not proof those inputs are
the clearing state; clearing/SDK must authenticate them. Only clearing consumes.

**Maker instructions:** `initialize_curve_v4(ShapeV4, updater:key, expiry:u64,
instance:u8)` binds existing venue/market/capital/domain/controller, initializing
config/price; `reprice_v4(expected_control:u64, expected_sequence:u64, anchor:u64)`;
`control_curve_v4(expected_control:u64, expected_shape:u64, action:u8, payload)`;
`quote_v4(QuoteRequestV4)`. Control actions: 0 shape(429 bytes), 1 updater(key,u64),
2 mode(u8), 3 invalidate publication(no payload). These form Borsh enum
`CurveControlV4` with discriminants0…3 and no vector-length prefix. Shape replacement
must retain the current mode; re-enabling must use the mode transition and invalidate
the old price. Only clearing controller signs
control; action3 is the approval/revocation gateway hook. Reprice accounts in order:
actor signer, config read-only, price writable, event authority, maker program.
Quote accounts: config, price, both read-only and no signer. Initialize accounts:
owner payer/signer, venue, market, capital read-only, config/price writable,
system program, event authority, maker program. Controller derives from capital;
no external mutable financial dependency is passed to maker initialization.

**Clearing instructions:** `initialize_liquidity_venue_v4(domain,fee_authority,
reserve_authority,reserve_destination_owner)` reuses the V3 initializer account/arg
layout to create immutable profile4, gated by the P30-only build feature.
`initialize_liquidity_v4()` creates registry in custody
mode (venue authority); `register_liquidity_v4(instance:u8)` jointly admits the
owner's capital/program/config/price/hash and unique binding; `seal_liquidity_v4()`
requires all 3, then immutable membership. `control_liquidity_v4(expected_authority:u64,
expected_control:u64, expected_shape:u64, action:u8, payload)` invokes maker control
after materialization; `replenish_liquidity_v4(expected_authority:u64,
expected_depth:u64, sides:u8)` uses mask1 buy,2 sell,3 both. Quarantine/reapproval
are `quarantine_liquidity_v4(expected_authority:u64)` and
`approve_liquidity_v4(expected_authority:u64)`. Initial registration/approval require
the venue authority and owner; no caller-supplied hash is trusted.

Gateway common ordered accounts: owner/actor signer, venue, custody writable,
safety, market writable, registration writable, capital read-only, config writable,
price read-only, maker program, ProgramData, controller, maker event authority, optional co-signer,
clearing event authority, clearing. Joint approval requires the venue-authority
co-signer; owner-only operations require no co-signer (Anchor placeholder convention).
Quarantine uses its own authority,venue,custody,safety,market,registration,capital,
event-authority,clearing context and invokes/loads no maker dependencies; it remains
possible while paused or after a maker closes/corrupts its own accounts. Capital is never sent to maker CPI.
Registry initialization: authority payer/signer, venue, custody writable, market, safety, registry
writable, system, event authority, clearing. Registration: owner payer/signer,
venue authority signer, venue, custody writable, safety, market, registry writable,
capital, registration writable, capital binding writable, config, price, maker
program, ProgramData, system, event authority, clearing (≤18 keys with compute).
Seal: authority signer, venue, custody writable, market, safety, registry writable, the three
registrations in ID order, event authority, clearing. No optional
financial authority can be inferred from a missing signer. Resource envelopes
below cover these lists; exact generated-IDL parity is a P30 acceptance check.

**Execution:** `execute_liquidity_route_v4` uses existing V3 intent order except
each leg is `(lots,authority_epoch,control_epoch,shape_epoch,depth_epoch):[u64;5]`.
Retain AccountGuardV3, domain, terms/config epochs, validity, side, total lots,
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

**Sampling:** `sample_liquidity_v4()` has no args; payer signer, venue, custody
writable, safety, market writable, registry, four authenticated source accounts,
then the three complete maker tuples (capital read-only, registration read-only,
program,ProgramData,config,price), event authority and clearing. Market/order
reservation projections do not write maker roots during a sample. Duplicate program
metas are deduplicated in the message, not confused with duplicate capital.

Events use existing event-CPI durability. The following lists are ordered Borsh
payloads. `PayloadV4` means the named account's exact bytes without its 8-byte
discriminator. Nested V3 snapshot records retain their existing field order.

- Maker `LiquidityPriceV4`: config:key, control/sequence/anchor/slot:u64,time:i64.
  `LiquidityShapeV4`: config:key,state:MakerCurvePayloadV4,action:u8 (initialize=4;
  control actions0…3 above). Emit both complete initialization states.
- Clearing `LiquidityRegistryChangedV4`: venue:key,sequence/slot:u64,registry:key,
  state:LiquidityRegistryPayloadV4. `LiquidityMakerChangedV4`: venue:key,
  sequence/slot:u64,market:key,market_state:MarketSnapshotV3,registration:key,
  state:MakerRegistrationPayloadV4,operation:u8 (register0,shape1,updater2,mode3,
  replenish4,quarantine5,approve6). Maker's corresponding shape event supplies
  config changes in the same atomic transaction; do not infer a successful CPI.
- `LiquidityRouteExecutedV4`: exactly the ordered `AccountRouteExecutedV3`
  payload in `programs/clearing/src/events.rs`, replacing `maker_states` with
  `Vec<MakerRegistrationPayloadV4>` and appending `legs:Vec<ExecutedLegV4>`.
  Root states count 2/3 and maker/leg count 1/2, all in selected-leg order.
  `ExecutedLegV4`: registration,capital:keys;instance:u8; lots,gross,price_sequence,
  authority_epoch,control_epoch,shape_epoch,depth_epoch,consumed_before,
  consumed_after:u64. All fee/carry/ledger/liability effects are retained.
- `LiquidityOracleChangedV4`: existing `AccountOracleChangedV3` ordered payload,
  then `inputs:[SampleInputV4;3]`, `bid_legs,ask_legs:Vec<SampleLegV4>` (each ≤2).
  Input: registration,capital:keys; authority/control/shape/depth epochs,
  price_sequence,buy_consumed,sell_consumed,expiry_slot:u64;expiry_time:i64.
  Leg: instance:u8,lots/gross:u64. Market snapshot contains reference, quantity,
  bid/ask and held endpoints. Unqualified samples retain three identity records,
  zero unknown input fields and empty legs, with the explicit existing outcome.

These events are authoritative only after finalized RPC fetch/decoding. P30/P32
must prove generated event-IDL parity, and P33 journal/replay parity. No synthetic
success events or inferred fills. Stream bounded large events using the existing
event-CPI implementation rather than copying full roots into multiple heap buffers.

## 6. Routing guarantee and complete funding coverage

Discover all three sealed registrations at one coherent fetched snapshot. Authenticate
ownership, identities, capabilities, code, valid publications and distinct capitals.
Classify ineligible candidates (self-capital, quarantine, disabled, stale, invalid,
zero capacity). Unknown capabilities reject discovery rather than adopting a weaker
optimizer guarantee. The route guarantee is **best feasible single/pair within
that authenticated snapshot**, not all Solana venues or future landing state.

For every singleton and unordered pair enumerate each integer split with nonzero
legs, exact requested total, each ≤4,096. At most12,291 compositions (peak Q=4,097);
prices/capacity may prune work but not feasibility assumptions. Check both selected
makers' and the trader's current **whole-root** funding, claims, reservations,
per-market IM ceilings, applicable reduction/deficit rules, order/TP/SL generation,
minimum notional, index bands and user limits. Positive unpaid claims cannot fund
margin or fees. No pair may count the same capital twice. Charge fee once on summed
gross (or the stored-order prefix difference), then insurance carry as existing.

Minimize gross+fee for buy; maximize gross−fee for sell. Ties: fewer legs,
lexicographically smaller sorted instance IDs, then more quantity at the first ID.
The SDK defaults to the reviewed all-in amount; any worse-price tolerance must be
explicit. Current-price execution cannot broaden a signed order's bounds.

Funding requires **all three** sealed authenticated configurations, capital states
and fresh publications, even if a maker contributes zero size. Missing, expired,
disabled, quarantined or code-mismatched required input makes the sample unqualified;
never substitute a keeper-selected subset. A valid one-sided or inventory-limited
maker may have zero capacity on one side without invalidating its input. Both
aggregate sides must still fill the full reference quantity with ≤2 capitals each.

Keep source validation and reference interval10,000…100,000; quantity
`ceil(6,000,000/reference)` (60…600). Quote using the same anchor, shape, inventory,
consumption and maker post-fill admission as execution, with no synthetic trader
or fee and no consumed depth. Precompute exact quote/eligibility arrays per maker,
side and quantity; evaluate every feasible singleton/pair. No binary search on a
presumed monotone health predicate. Same canonical CPI checks, at most first-lot
plus selected quote per maker/side (≤10 CPIs); a zero/invalid first-lot price cannot
be hidden by a later average. Maker public quote code has no funding-only context.

Require ask≥bid>0. Premium is signed truncation toward zero of
`(bid+ask−2*Q*reference)*1e9/(2*Q)`, clamped to ±`reference*1e9*50/10000`.
It is a scaled price-per-lot increment, not a dimensionless rate. Keep 3,600-second
period, 2-second sampling, 6-second hold/recovery, 30-second catchup and 12-second
funding outage rule; no synthetic update to risk freshness. Held end is additionally
bounded by every publication's actual time/slot expiry and source deadline.
Interval accrual uses the old held sample before installing the next one. Pure
repricing does not retroactively replace it; structural updates use section 4.

## 7. G22 resource and comparison gates (pinned before measurements)

These are **design envelopes and future pass criteria**, not measured program
results. Keep the existing toolchain/lockfiles. Transaction compression does not remove
loaded keys or contention. D71 supersedes the original mandatory lookup-table policy. Full order/protection books use the existing V3 maximum capacity.

| Item | Hard bound / acceptance |
|---|---|
| Registry / regions / dependencies | 3 makers/market, 8 regions/side, config+price only, ≤2 distinct programs |
| Search | ≤12,291 candidate compositions, ≤12,288 nonzero per-maker quantity quotes; exact optimum; SDK p95≤250ms and p99≤500ms over 1,000 warmed worst-width runs on recorded host |
| Funding search | ≤3×600 per-maker quotes/side and ≤3×599+3 allocations/side; keep only one side's arrays live; ≤16 KiB quote+eligibility scratch, default32 KiB heap |
| Packet/accounts | v0≤1,232 / v1≤4,096 complete serialized bytes; ≤32 unique loaded accounts for route/sample, ≤18 per control gateway including a separate fee payer and up to3 signers; composed controls≤32 total keys; no automatic expansion |
| Compute | Single reprice submitted≤100k, single control≤400k, atomic pair of controls≤800k, route≤800k, sample≤1.4m CU; measured maximum≤80% of its submitted limit, including full ProgramData verification and max books |
| Atomic combined operations | Submit only if measured packet/compute/headroom pass; no claim all old transfer+route compositions already fit the new envelope |
| Concurrency | Record writable keys, conflicts/retries and update-to-landing p50/p95/p99; price publication writes only its price account, not market/custody/capital |

**Current transport policy (D71):** measure the complete transaction including
signatures before broadcast. Use v0 when it fits1,232 bytes; use v1 above that,
subject to4,096 bytes. No lookup table is required. V1 puts explicit compute and
loaded-account-data limits in the message header, with zero priority fee; budget
instructions are not a substitute for the v1 header. P30 uses8MiB loaded-account
data and the per-operation CU limits above. RPC reads advertise support through
version1; acceptance independently fetches and decodes the original signed bytes.
Ambiguous retries preserve the original transaction/signature. Wallet, service and
indexer v1 compatibility remain owning-phase checks, not assumptions.

P29B's original independent v0/ALT size models remain historical evidence on its
pinned commit. The mandatory table provisioning/freeze/recovery design is explicitly
superseded by the user's v1 direction. Initial P30 offline signed serialization
measures full-shape control1,222 bytes, initialization1,039, reprice460 and joint
approval775 for the actual generated instructions and two signatures. These all
fit v0 and are not RPC execution evidence. Batched instructions and wider P32
transactions require their own measurements. Preserve unique-account, compute,
search and risk bounds; larger wire capacity does not authorize weakening them.
If the three-maker/full-hash/full-book budget fails, optimize or record a failed
gate; do not reduce coverage, admission checks or headroom to report success.

**P32 continuation workload:** pinned separate V3/V4 fresh deployments, fixed seed
2902, same toolchain/host/RPC configuration and initial test balances. Per profile,
240 offers over 120 seconds, alternating buy/sell, lots cycling1,2,4,8,16; risk reference
60,000 with identical 2-second source updates, funding every 2 seconds. Baseline A/B
parameters are documented; canonical controls match flat-center legacy offsets
(A512 lots spread10/slope1; B4096 lots spread30, first256 flat then slope1), with
inventory kept within legacy zero-skew ranges for direct price comparisons. The
canonical control republishes the unchanged anchor every 500ms to maintain TTL;
legacy A/B uses a 3,600-slot epoch, with no fake depth reset. Third
maker is funded but zero-capped in this control. A separate 240-offer treatment uses
all 3 (third4096 lots spread20/slope1), canonical target0/step64/tick4, price updates
every 500ms alternating ±1 atom, plus per-maker depletion and explicit replenish.
Never attribute changed spreads/depth to a better allocator.

Schedule the same source outage at30–38s, updater outage at60–68s and one
quarantine/recovery at90–98s; count offered 240 including these windows, and
separately report eligibility. Baseline can't perform live reprice; record that
limitation instead of refreshing its depth or granting it different risk sources.
Every omission/rejection is classified. Zero unexplained quote/financial differences
against each profile's independent expectations; exact V4 optimum on every offer;
zero safety regressions; eligible-at-construction finalized success must not fall
more than 5 percentage points below the control. No greater-than25% p95 signed
route landing-latency regression in the control (report sample populations; fewer
than 100 comparable attempts is insufficient). Do not count fault-window rejection
as a risk failure or exclude it from offered availability. Demonstrate at least 20
price updates after consumption with no reset and 20 strict-epoch stale rejections.

**P34 final workload:** same seed/control/treatment definitions on final artifacts,
both markets and isolated/cross traders, each 300 seconds/600 offers, six maker roots,
maximum order/protection-book budget cases, both venue programs, concurrent funding,
orders, reprices, exits, one worker restart and one indexer restart. Add deterministic
default/recovery and complete flat exit/replay fixtures outside timed pricing samples.
P33 supplies the original-signature recovery and PostgreSQL reconstruction. Report
all six denominators (offered, eligible, quoted, attempted, submitted, finalized),
markouts at2s/10s, transaction costs, inventory/funding, funded/unpaid P&L and explicitly
assumed hedge costs. Gates use the same5pp/25% thresholds plus all safety/resources
above. No24h run or independent profitability claim is introduced.

## 8. Acceptance ownership and limitations

P29B/A34B resolves the specified contract, arithmetic, transitions, layout/ABI and
bounded resource/search plan with independent literal/exhaustive checks. P30/A35
owns compiled canonical implementation, generated IDL/SDK parity and real signed
RPC/WS quote/update/control cases. P31/A36 owns production exact allocation and
search timings. P32/A37 owns all financial paths, full books, code-hash costs,
actual packet/CU measurements, causal funding, races/rollback, narrow PostgreSQL
replay and continuation gate. P33/A38 owns durable services and usable interfaces;
P34/A39 owns final comparative concurrency/reconciliation/recovery/exit evidence.

No on-chain implementation, runtime performance, deployment, new financial
acceptance or external review is proved by this contract/reference. Ordinary
implementation corrections update this document and D70 with evidence. Material
economic/scope changes need a decision. P15B/P16B stay Open; 24h stays Deferred.


### P30 contract realization notes (R080 continuation)

Implementing the contexts exposed two omitted event dependencies in the initial
G22 list: clearing custody provides the durable registry event sequence, and maker
event-CPI authority must accompany a control CPI. A separately sponsored payer can
add a third signature/key. Before signed measurements, the conservative control
envelope is therefore explicitly amended from16 keys/1,049bytes for two signers
to18 keys/1,179bytes for up to3 signers in the initial ALT model. D71 subsequently
supersedes that transport policy with measured v0/v1 selection;20% compute
headroom remains unchanged. This is a context/serialization correction, not a change
to capital, loss, fee, margin or update authority. P29B's original calculation remains
recorded on its tested commit. Generated-IDL and signed P30 checks must verify the
realized account lists; no size estimate substitutes for them.

Shape payloads cannot change mode; enabling always increments control epoch and
requires a new publication. Quarantine has no maker-owned read/code dependency,
so a hostile/closed module cannot prevent the venue from quarantining it. Control
CPI results are compared to the complete expected canonical config, including all
immutable fields. P30 structural transitions accept only custody/zero-funded-index/
zero-open-interest/unheld state; active causal materialization remains disabled
until P32 implements and qualifies it.
