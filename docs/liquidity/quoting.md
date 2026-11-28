# Maker quoting contract

## Standing execution quotes

The D145 ordinary router uses request version 5 on the existing read-only maker
quote interface. It prices current inventory and unconsumed depth at the maker's
last authorized anchor. A reprice is visible to the very next instruction.
This request has no age expiry. Its two expiry fields carry the maximum values
of their wire types. It still rejects unpublished prices, future publications,
revoked control, disabled shapes and insufficient capacity. Both admitted maker
programs must support this request before the new path can be used.

Version 4 retains expiry for funding and the existing signed-leg path. A funding
publisher cannot use version 5 to extend a market's held window.

## Identity, deployment and authority

- Fresh local venue/domain with `Venue.schema_version=10`, immutable
  `profile_version=6`; clearing accounts use schema 10 with scoped revisions.
  Maker-owned accounts use schema 5. Expiring requests use version 4 and standing execution requests use version 5 on supporting maker builds. The SDK binds these formats to the deployed program hashes.
  The default/devnet build rejects profile-6 financial activation. An explicit local qualification build gates execution.
- The fresh demo has three registry slots per market, IDs 0,1,2. The wide local qualification accepts consecutive IDs from 0 through at most 31. All must be provisioned and
  registry sealed before funding or trading. At least two instances share a maker
  implementation; the existing A/B programs remain the two admitted deployments.
  Programs do not choose a pricing strategy from the instance ID.
- Registry entries cannot be removed, reused or replaced after sealing. Disabled,
  exhausted and quarantined makers retain liabilities and cohort membership.
  A new capital/implementation topology requires a fresh local deployment in this
  bounded release. Maker capital cannot be a trader's selected root in its route.
- Reuse clearing's `[capital-v3, capital]` unique binding: one capital, one
  registration across programs and instance aliases. Capital must be the owner's
  schema-10 isolated maker root for the exact venue/market. Config replicas cannot
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
route size 1…100,000,000 lots. Existing minimum notional remains 1,000 atoms.

Each side has 0…8 regions `(end_lots:u64, offset:u64, slope:u64)`. Ends strictly
increase, final end ≤100,000,000. Offsets 0…1,000,000 and slopes 0…1,000; every region's
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
| Initialize | Owner, fresh capital identity, profile 6 | Immutable bindings, zero consumption, no valid price; no financial activation |
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
limits still prohibit adding expired, unmaterialized funding.

During route selection clearing authenticates each distinct pricing executable and its ProgramData once per instruction. Every maker still checks its registered approval hash, including makers that share an executable.

If a fill lands before another signed route, the latter uses current inventory and
consumption; it must still fit capacity and user limits. If a reprice lands first,
the route uses that price within the same limits. If shape/control/depth/authority
changes first, reject the stale binding even if its price would be favorable.
Expiry, source degradation, insufficient margin, exhausted depth or a failed second
leg reject the entire route without fee, counter, root, order or vault changes.


## Quote ABI and CPI authority

A maker returns a 204-byte response echoing the 156-byte request and reporting price sequence, anchor, gross quote, remaining capacity and validity endpoints. Clearing authenticates the executable, approved ProgramData and producer of the return data. It checks the canonical request/response and supplied read-only pricing accounts. The maker never receives the vault signer or unrelated writable clearing accounts. The clearing-owned registration tracks consumed depth.

Exact account spans depend on the deployment and its clearing-owned registration extensions. Use the [maker wire types](../../crates/maker-interface/src/canonical.rs), [clearing state](../../programs/clearing/src/state/liquidity.rs) and [generated IDLs](../../packages/sdk/idl/) when building an integration. Numeric protocol versions and historical seed bytes remain part of the wire contract.

## Events and economics

Only committed financial effects enter the finalized journal. Compare actual inventory, consumed depth, fees, funding, funded cash and unpaid claims for each maker. The local maker kit computes its report from finalized events and labels any assumed hedge cost. [Operator runbook](../operations/deployment.md#reconciliation-economics-and-exit)

## Publishing for an inactive listing

On the local `listed-maker-admission` build either maker program can initialize
a curve with its owner's listing-tagged capital, then publish using the usual
owner or delegated updater. Clearing admission requires both the owner and venue
authority. A published curve alone gives the router no permission to execute a
fill. [Capital identity and custody](../clearing/accounts.md#isolated-maker-capital-for-an-inactive-listing)

On the local `listed-market-directory` profile, the venue authority seals the
listing after all three maker instances have registered. Clearing checks their
canonical addresses, their distinct capital accounts and participation from
both supported maker programs. The resulting `LiquidityRegistry` has the same
layout and address seeds as the BTC/ETH directories, keyed by the full listing
address. Consumers can use `discoverLiquidityAccounts` to retrieve the three
registrations and their dependencies. Sealing ends new maker admission on this
listing. Each maker can continue updating its price and moving available cash.
The listing remains ineligible for orders until the wider trading gate passes.
