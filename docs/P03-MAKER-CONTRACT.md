# P03 maker quote and capital contract

Version 1 · synthetic local profile · 21 October 2026

P03 adds separate maker A and B pricing deployments, funded-capital registration and read-only clearing previews. The market stays CustodyOnly. There is no fill, position mutation, fee, settlement or consumption instruction; P04 must commit consumption together with paired financial effects. A caller-supplied preview reference is indicative pricing input, never an authenticated risk observation.

## G04 profile

Taker side 0 buys from a maker; side 1 sells to it. Quantities/prices retain P02 units. At a labeled snapshot, maker inventory is q. Signed integer division truncates toward zero. The central quote price is `reference - trunc(q/skew_step)*skew_tick`.

| Fixed strategy v1 | Epoch side depth | Spread, atoms/lot | Flat knee f | Inventory step, lots | Skew tick, atoms/lot |
|---|---|---|---|---|---|
| A | 512 | 10 | 0 | 64 | 4 |
| B | 4,096 | 30 | 256 | 256 | 1 |

At consumed index i (zero based), offset is `spread + max(i-f,0)`. Ask marginal price adds offset; bid subtracts it. Define `H(n)=max(n-f,0)*(max(n-f,0)-1)/2` and cumulative `K(n)=(center +/- spread)*n +/- H(n)`. An additional d costs/proceeds exactly `K(consumed+d)-K(consumed)` whole atoms; integer marginal ticks require no fractional rounding. Every marginal price must remain within P02's inclusive price envelope. Small orders favor A; B's wider initial spread is offset by deeper flat capacity on larger orders.

The quote cap is the minimum of unconsumed side depth, directional inventory headroom, and `max(0,min(MAX_LOTS,floor(cash*10/reference))-abs(q))`. This is a conservative synthetic availability cap, not risk authorization. P04 must check final adverse risk and reservations independently. Clearing P03 previews accept only actual funded, flat, claim/reserve/order-free participant state. Direct maker quotes can evaluate hypothetical cash/inventory snapshots, clearly separate from financial state; the maker replaces the supplied time with the actual execution slot.

## Authority and epoch rules

- Each maker config is its program's PDA `[maker, capital]`; initialization stores owner, market, domain, capital, version, maker ID and epoch. Owner alone publishes subsequent epochs. Strategy v1 constants are fixed in code.
- Epoch duration is 64–3,600 slots, inclusive start and exclusive expiry. Publishing requires the preceding epoch to have expired, advances a checked epoch counter and starts at the actual current slot. No heartbeat or early publication resets cheap depth.
- Clearing registrations are `[maker, market, maker_id]`, with only IDs 0/A and 1/B admitted. Registering requires both market authority and the actual funded Participant owner's signatures. An initialized `[maker-capital, capital]` binding prevents reusing capital under another module. There is no deregistration or capital reassignment.
- Registration records exact config/program/ProgramData identities, inventory limit, authority epoch, quote epoch/lifetime and separate buy/sell consumption. Module validation checks executable program, loader ProgramData binding, config owner/PDA/discriminator/version/identity and exact bounded lengths.
- Approval hashes the entire loader ProgramData account, including deployment metadata and code (at most 1 MiB). Every clearing preview and epoch sync verifies the hash. Any unapproved change rejects immediately; the market authority may explicitly quarantine even while paused. Reactivation/approval requires market and capital-owner signatures and advances authority epoch. It never resets consumption.
- Anyone may sync an owner-published next epoch after the old expiry, provided the new config starts no earlier than that expiry and is currently valid. Only this checked transition resets the two consumption counters. Repeating the same epoch rejects. Quarantining leaves participant membership and liabilities intact.

## Read-only CPI and return contract

Clearing's preview derives bindings, inventory, funded cash, consumption and execution slot from actual accounts; caller arguments bind quote/authority/market epochs, side, size and indicative reference. Maker CPI gets exactly one read-only config account, no signer seeds, no capital/market/vault accounts, and no arbitrary remaining accounts. Off-chain evaluation mirrors the same bounded integer contract.

The fixed 92-byte Borsh response contains version, maker ID, side, exact lots/gross quote/remaining capacity, quote/authority/terms/market-config epochs, start/expiry, consumed prefix and reference price. Clearing requires the exact producer, length and expected response. A rejected quote errors; it does not fabricate a successful fill. Response validation tests must cover wrong producer, every changed byte and truncated/oversized outputs.

`MakerChanged` uses event-CPI with domain/market, checked market sequence, operation (0 register, 1 approve, 2 sync, 3 quarantine), registration/capital, maker ID, authority/quote epochs, quarantine flag and approved hash. Quotes are read-only return data and do not increment sequence. P05 indexes only successful transaction events.

## Qualification and measured budgets

[Fresh A03/G04 acceptance](evidence/P03.md) verifies this implemented profile on `e05a20e`. The preview instruction has six read-only accounts (eight total message accounts including payer and clearing program), a 92-byte return and exactly one config account in pricing CPI. Measured signed previews are 426 bytes and at most 113,216 CU within the default 200,000-CU budget. ProgramData hashing accepts at most 1 MiB; newly approved builds require fresh qualification rather than inheriting these measurements. P04 owns combined two-maker route/message/CU budgets.

The independent per-lot oracle, cross-client ABI/live decode, signed built-program and standard RPC/WS evidence cover both sides, deep capacity, inventory and consumption prefixes, epoch/capital authority and actual upgrade rejection/reapproval. Financial consumption remains model-only until atomic route execution exists. No operational route, PostgreSQL/service lifecycle, authenticated oracle/funding, independent-maker or funded-pilot result is implied. Current PR/integration status is in WORKLOG.

## P04 extension

P04 supersedes the custody-only execution and flat-capital preview restriction above: validated exposed maker capital can be quoted, approved and synchronized, and atomic routes commit cumulative consumption with the fill. The one-config CPI, curve/version/epoch/hash rules are unchanged. TestRoutes activation, synthetic observation trust, supported deposits and disabled trading-mode exits are specified in [ATOMIC-ROUTES](P04-ATOMIC-ROUTES.md).
