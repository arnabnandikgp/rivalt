# Maker quoting contract

## Identity, deployment and authority

- Fresh local venue/domain with `Venue.schema_version=6`, immutable
  `profile_version=4`; clearing accounts use schema 6 with scoped revisions.
  Maker-owned accounts/quote ABI retain version 4. No in-place profile-3 upgrade or account rewrite.
  The default/devnet build rejects profile-4 financial activation. An explicit local qualification build gates execution.
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
  schema-6 isolated maker root for the exact venue/market. Config replicas cannot
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


## Canonical arithmetic (capability 1)

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
This cap is an upper bound, **not a claim every smaller size is healthy**. For
execution, funding, reservations, fee/claims and post-fill root health decide
feasibility. D74 funding sampling deliberately uses published depth without those
financial checks; the [funding contract](funding.md) records that separate admission policy.

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
Rust/SDK/program results must agree with these independent expectations.


## Transitions, races and held funding

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

D73 makes interval bookkeeping explicit: a structural control closes the old
observation at its actual Clock, accounts for covered/skipped seconds once, then
records an unqualified observation with `sampled_at=held_until=now` (both remain
zero if no sample has ever existed). It preserves source identities, sequences,
deadline, risk bounds and their validity. This is not a fresh source observation.
Repeated controls account only for the time since the preceding observation; the
next sample retains the two-second interval rule. A failed new sample preserves
the old valid interval's materialized index. Recovery cannot bridge a gap beyond
the old publication's held time/slot endpoint. Existing slot-expiry and catchup
limits still prohibit adding expired, unmaterialized funding. V1–V3 are unchanged.

If a fill lands before another signed route, the latter uses current inventory and
consumption; it must still fit capacity and user limits. If a reprice lands first,
the route uses that price within the same limits. If shape/control/depth/authority
changes first, reject the stale binding even if its price would be favorable.
Expiry, source degradation, insufficient margin, exhausted depth or a failed second
leg reject the entire route without fee, counter, root, order or vault changes.


## Wire contract and bounded dependencies

Borsh, little endian, no padding; bool one byte, public keys 32, signed values two's
complement. Anchor discriminators are first 8 SHA256 of `account:<Type>`,
`global:<snake_case_instruction>` or `event:<Type>` respectively. Untrusted maker
config/publication accounts and quote return data require exact lengths; reject
trailing bytes there, unsupported version/capability, noncanonical bools, unused
region bytes or unexpected accounts. `LAYOUTS` in the reference pins field
order/width/offsets.

R095 corrects the earlier blanket trailing-data claim: Anchor 1.2.1's instruction
dispatcher decodes the declared arguments and permits an unused suffix. Generated
clients emit the canonical encoding without a suffix. This release retains that
dispatcher behavior; it does not use instruction bytes as a unique economic-intent
identifier. Signatures still bind the complete wire, while account nonces, stored
order versions, publication sequences and authority epochs enforce replay rules.
The exact 204-byte quote response and fixed maker account lengths remain mandatory.
See [the self-review evidence](https://github.com/arnabnandikgp/rivalt/blob/84c46d4d26b23f25d6f3a7ae4bcbec591fa31503/docs/evidence/R095-SELF-REVIEW.md).

| Account / owner / seeds | Bytes including discriminator | Ordered payload fields |
|---|---:|---|
| `LiquidityRegistry` / clearing / `liquidity-v4,market` | 181 | schema:u16=5; revision:u64; venue,market:keys; count:u8; sealed:bool; registrations:[key;3]; bump:u8 |
| `MakerRegistration` / clearing / `maker-v4,market,instance:u8` | 341 | schema:u16=5; revision:u64; venue,market,capital,owner,pricing_program,program_data,config,price:keys; approved_hash:[u8;32]; instance:u8; authority_epoch,depth_epoch,buy_consumed,sell_consumed:u64; quarantined:bool; bump:u8 |
| `MakerCurve` / maker / `curve-v4,capital` | 691 | schema:u16; venue,market,capital,controller,owner,updater:keys; updater_expiry_slot,control_epoch,shape_epoch:u64; domain:[u8;32]; instance:u8; capability:u16; mode:u8; ttl_slots:u16; target:i64; skew_step,skew_tick,long_cap,short_cap:u64; bid_count,ask_count:u8; bids,asks:[Region;8]; bump:u8 |
| `MakerPrice` / maker / `price-v4,config` | 83 | schema:u16; config:key; control_epoch,sequence,anchor,updated_slot:u64; updated_time:i64; bump:u8 |

Config immutable fields are schema, venue, market, capital, controller, owner,
domain, instance, capability and bump. Fixed owner transfers require a fresh
deployment in this release. `LiquidityShape` is mode,ttl,target,step,tick,long/short cap,
counts,region arrays in config order (429 bytes). Region is three u64s (24 bytes).
All maker mutable dependencies are exactly config and price. No dynamic read list,
external feed CPI, taker identity, router identity or funding-purpose flag.

**Quote ABI:** `MakerQuoteRequest` (156 bytes) is version:u16, domain:[u8;32],
market:key, capital:key, instance:u8, authority/control/shape/depth epochs:u64,
side:u8 (0 buy/1 sell), lots:u64, inventory:i64, consumed:u64. `MakerQuoteResponse`
echoes that request followed by price_sequence, anchor, gross, remaining,
valid_until_slot:u64 and valid_until_time:i64 (204 bytes). Remaining means available
capacity **after** this quantity, before financial admission. CPI producer must
equal the admitted executable program; require exact length and byte-equivalent
canonical recomputation. Clock supplies expiry checks. A direct maker quote is a
mathematical quote over supplied inventory/consumption, not proof those inputs are
the clearing state; clearing/SDK must authenticate them. Only clearing consumes.

**Maker instructions:** `initialize_curve_v4(LiquidityShape, updater:key, expiry:u64,
instance:u8)` binds existing venue/market/capital/domain/controller, initializing
config/price; `reprice_v4(expected_control:u64, expected_sequence:u64, anchor:u64)`;
`control_curve_v4(expected_control:u64, expected_shape:u64, action:u8, payload)`;
`quote_v4(MakerQuoteRequest)`. Control actions: 0 shape(429 bytes), 1 updater(key,u64),
2 mode(u8), 3 invalidate publication(no payload). These form Borsh enum
`CurveControl` with discriminants0…3 and no vector-length prefix. Shape replacement
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
layout to create immutable profile4, gated by the explicit local build feature.
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
below cover these lists; exact generated-IDL parity is required.


## Events and economic separation

Maker price/shape events retain the actual config, control/sequence, anchor,
Clock and complete shape state. Clearing registry/control events retain venue,
affected market snapshot and exact registration state, followed by the authenticated
scoped revision footer; there is no global custody discovery counter.
Execution events include changed roots/ledgers, gross fee and I/T/carry, selected
registrations and actual price sequence/consumption before/after for each leg.
See [event definitions](../../programs/clearing/src/events.rs) and maker source for
ordered payloads. Emit large financial snapshots using bounded borrowed streaming;
do not duplicate full account buffers onto the SBF stack/heap.

Only independently fetched successful finalized effects enter financial history.
A maker event is not a fabricated clearing fill; failed CPI rolls back both.
Quotes return gross notional, never collateral transfers or a risk valuation.
Current source names are canonical; numeric schemas and persisted journal tags
retain explicit wire identity. Compatibility details remain explicit in [accounts](../clearing/accounts.md).
