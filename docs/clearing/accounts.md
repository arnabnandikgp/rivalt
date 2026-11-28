# Accounts, custody and authority

## Registering an inactive market

On the `inactive-market-listing` local profile the venue authority can reserve a
market ID and ticker before taking any orders. One signed instruction creates a
`MarketListing` PDA keyed by venue and little-endian `u16` ID, and a
`ListedSymbol` PDA keyed by venue and the eight-byte zero-padded ticker. Both
must be free. BTC/ETH and IDs 0/1 are reserved. The listing fixes its lot scale,
the venue's collateral mint, and the publisher and feed address for the underlying
USD index. Clearing checks the local oracle program's ownership, the feed's
address and its stored publisher and feed ID. Registration does not read its price.

The authority pays rent for these two accounts. Existing trader and maker accounts
do not grow when a market is registered. Listing registration creates no market ledger or position slot. Orders require a separate trading market. The two admitted
markets still come from the venue's trading configuration.

A separate `ListingIndex` PDA keyed by the listing stores the bound sources and
the last qualified price observation. The authority funds it at binding. A sample
writes only this clearing account. [Index rules](risk-and-resolution.md#observing-the-index-of-an-inactive-listing)

## Isolated maker capital for an inactive listing

On the local `listed-maker-admission` profile an owner can create a dedicated
maker margin account in their existing portfolio and deposit the venue's
collateral through the usual SPL vault. Its inline market selector is 254,
a tag meaning neither BTC nor ETH. Both inline positions and their reservations
must be zero. The root has its own member ID and funded cash balance.

The maker program binds its quote configuration to the full listing address
and capital root. The owner and venue authority then sign `admit_listed_maker`.
Clearing checks the program, executable hash, configuration, price account and
positive funded balance. It creates a registration keyed by listing and
instance and one permanent binding keyed by capital. This second key prevents
the same capital from supporting two registrations, even when the maker
deployments or listings differ. A maker can withdraw its funded cash. The binding
persists at zero balance, so a consumer must check available capital at fill time.

A venue-authorized `seal_listed_liquidity` moves the listing from status 0
(registration open) to status 1 (directory sealed). It advances the listing
revision and creates the maker directory. This one-time transition leaves cash
and position records untouched. Both statuses accept independent index updates.
[Maker directory](../liquidity/quoting.md)

## Listed markets on the funded margin account

The local `listed-margin-storage` profile allocates position space on the
existing margin PDA when the owner registers. Its first 1,099 bytes are the
existing account and both bounded BTC/ETH entry records. The account's cash
field and the venue SPL vault continue to own all collateral. The owner pays
rent for the additional space once at registration.

| Account | Extra records reserved | Total bytes |
|---|---:|---:|
| Cross trader or cross receiver | 6 | 1,705 |
| Isolated maker bound to a listed market | 1 | 1,215 |
| Isolated BTC/ETH account | 0 | 1,099 |

An 18-byte header after the original records contains the eight bytes
`RVMKTS01`, the last allocated incarnation (u64) and the occupied count
(u16). Each 98-byte record carries the full market ID (u16), incarnation
(u64), signed lots (i64), virtual balance and funding checkpoint (both i128),
position generation (u64) and the existing 40-byte bounded entry cost. Integers
are little-endian. Records are sorted by market ID. A flat position with a
fractional debt or claim still occupies a record. Reusing a discharged slot
assigns a new incarnation. Spare bytes must be zero.

Registration creates an empty directory. BTC/ETH trading, cash access and the
two-market default reader require an empty directory. A separate listing must
pass trading and default acceptance before a live financial instruction may
write a listed position. The reservation of six records describes physical
capacity. Signed SOL execution and eight-market trading have separate gates.
[Market slot encoding](../../crates/clearing-accounting/src/market_slots/storage.rs)

The separate `listed-venue-execution` qualification build lets the venue
authority move a fresh funded venue into profile 7. The transition requires
a sealed maker directory and configured funding for the listing, increments
the venue and safety epochs, and closes the previous funding interval. The
profile accepts the listed market order, the base market checkpoint and the
two funding publication instructions. This gate also applies to legacy
instructions that could otherwise pay a different account in the same venue.
Wider cash access and default need their own signed acceptance before general
trading can open. [Current qualification](../STATUS.md)

The venue authority can pause and resume active profile 7 through `pause_venue` with both inline fee checkpoints. Each change advances the safety epoch. The paused profile rejects listed fills and funding publications. Fee classification remains available so the authority can resume. The pause itself leaves positions and collateral untouched.

## Follow a deposit

1. An owner creates a portfolio and registers a child margin-account PDA. The owner, portfolio index and child index identify actual accounts. The portfolio holds the namespace. Cash, positions, orders and obligations belong to the margin account.
2. Financial activation inserts the root into paged membership and requires provisioned recovery capacity. On the local grouped-payout deployment, activation also needs a free row in the lane assigned by stable member ID modulo eight. Each lane has 125 rows. Vacating a different lane releases recovery capacity but does not create room in the assigned lane. A registered identity can exist without financial exposure. The local launcher provisions 128 Financial roots. This is distinct from the number of identities that can be registered.
3. A signed deposit transfers the six-decimal collateral token into the venue vault and credits the selected root. A permitted transfer between two roots of the same owner changes their clearing balances. Only a token deposit or withdrawal moves SPL tokens across the vault boundary.
4. Deactivation requires all obligations discharged. A retired child leaves a permanent tombstone. Discovery distinguishes registered, active Financial and retired roots, including their stable member IDs and activation generations.

## Ownership

| Account or authority | Owns or authorizes |
|---|---|
| Venue, custody and safety | Deployment identity, mint, vault binding, operating mode and freeze. Token gateways authenticate SPL accounts and actual vault custody. |
| Trader margin account | One cash balance and up to two market positions. Isolated roots bind one market. Cross roots combine BTC/ETH requirements against their own cash. Mode and isolated market are immutable. |
| Maker capital and registration | One isolated root per registered capital, bound to one venue and market. Owner and venue authority approve maker executable identity. A delegated updater reprices. |
| Portfolio owner or delegate | Owner controls custody and retirement. Delegated trading actions require current scope, authority epoch, expiry and account guards. The owner controls both ends of an internal cash transfer. |
| Market, ledger and maker capacity records | Index and funding state, settlement, retained fees, insurance and gross exposure. Fills can update maker-local contributions. Consumers requiring current totals authenticate the market checkpoints and complete bounded inputs. |
| Frozen member pages and settlement plan | Complete member identities, original revisions, positions and claims for one episode. Clearing checks the final payout before releasing cash. |

The shared vault is custody. It does not make funded cash in one sibling account available to another debtor. An isolated maker or trader can hold an unpaid market claim after closing.

## Wire format and changes

The fresh local client uses clearing schema 10, profile 6, maker account schema 5 and the explicit artifact binding. Fixed discriminators, integer widths, field order, PDA seeds, account metas, signed domains and error numbers are public interfaces. Namespace indices are u32 and member IDs are u64. JSON transports monetary quantities and member IDs as decimal strings. Historical seed text such as `capital-v3` remains part of address derivation.

Fresh local accounts append an eight-byte `RVPROF03` marker and two 40-byte market records to the margin prefix. Each record contains two little-endian u128 scaled cost bounds and one little-endian u64 reference quantity. Flat records are zero. Both markets are allocated at registration. Fills and payouts need no resize or additional rent. Historical RVPROF01 and RVPROF02 accounts retain their original programs and codecs, including their rent-credit rules. Use a fresh genesis and journal for the new deployment. [Entry arithmetic](accounting.md#ordinary-payouts-on-closed-quantity)

Use the types and generated contracts for exact field layouts and instruction metas. Compare supported wire formats before changing an existing account. [Clearing state](../../programs/clearing/src/state/) · [Membership wire checks](../../ops/membership_wire_contract.py) · [Wire contract](../../ops/wire_contract.py) · [SDK deployment bindings](../../packages/sdk/src/account-deployment.ts)

## Market slots in the width qualification

A listed market occupies space in a margin account when the account has open lots, a nonzero signed claim (down to one scaled unit), or a stored open or partially filled order in that market. This includes each live take-profit or stop-loss child. Clearing must see the market even when the next instruction will cancel the order. Once the last obligation clears, a past protection record, position generation or funding checkpoint alone needs no slot.

The candidate directory stores the market ID alongside the position and its entry-cost bounds. Within one margin account, a reference pairs that ID with a monotonically assigned number. Collecting the final debt while an order remains keeps the reference valid. Releasing the slot and reopening the same market assigns a new number. Moving another record during compaction leaves its reference valid. An isolated maker can occupy only its registered market.

A transition must supply the final position and entry cost for every previous occupant and every touched market, plus all live orders from the authenticated root. An explicit zero image discharges a market. An omitted image, invalid entry record or excess occupancy rejects the entire transition. The number of slots is a per-account capacity; market IDs can be sparse. Native qualification replays finalized BTC/ETH account images. The local custody qualification also persists the directory in program-owned accounts, in both qualification profiles below. The trading deployment still persists the two fixed market records described above. [Slot transition](../../crates/clearing-accounting/src/market_slots.rs) · [Qualification](../operations/qualification-scorecard.md#market-slot-retention-and-reuse)

### Funded custody qualification

On the local custody fixture, a margin PDA stores the collateral custody identity, child index, capacity, revision, funded cash, occupancy counter, standing order market and a length-prefixed directory. Each 98-byte slot stores its market ID, incarnation, signed lots, scaled claim, funding checkpoint, position generation and 40-byte entry-cost record. The owner funds the account by transferring six-decimal test collateral into the fixture vault. Opening an account creates no funded cash.

A withdrawal requires the current revision, the owner's signature and one authenticated, unexpired market observation per occupied market in order. A transfer uses the union of the two margin accounts' markets, counting each shared market once. The fixture accrues every open position and recalculates the standing order's reserve. Debiting the sender must leave cash sufficient for both current initial margin and held-window risk. The recipient can receive collateral even when its initial balance is below its requirements. Transfers preserve total funded cash inside the vault. A withdrawal transfers tokens from the vault to the owner's token account in the same instruction.

This profile fixes the initial exposures, a single standing buy per account and synthetic price/funding observations. It has a separate program and vault from the BTC/ETH venue. [Qualification results](../operations/qualification-scorecard.md#funded-custody-across-persisted-markets) · [Fixture implementation](../../tests/programs/default-proof/src/slot_custody.rs)

### Signed orders on a sparse cross account

The local order fixture starts every margin account empty. A trader signs one resting order at a time. The order alone occupies a market slot. Cancelling an unfilled order releases that slot when no other obligation remains. Reopening the market gets a new incarnation. A funded maker signs each execution from a separate account permanently bound to that market. A partial fill updates both positions, both entry records, the unfilled quantity and the remaining fee budget atomically. The taker’s 2 bps fee rounds on cumulative executed notional for that order. Each market credits one quarter of collected fees to insurance with integer carry.

A separate authority can update a synthetic market’s price and cumulative funding index without writing a trader or maker account. The next order placement, fill or withdrawal loads the required observations and accrues every open position on each affected account. A fill also enforces the trader’s signed limit, order expiry, fee allowance and both parties’ current margin. A reduce-only order binds the position generation. A full close retains a slot with an outstanding debt or unpaid gain. Only funded surplus can leave the vault.

The fixture reserves eight slots for a cross trader and one for each isolated capital. It executes at the synthetic index with maker consent. Production maker quoting, routing, funding publication, claim collection and default have their own entry points in BTC/ETH clearing. [Trading fixture](../../tests/programs/default-proof/src/slot_trading/) · [Validation](../operations/validation.md#checks-by-change)

### Cash access on the funded listed-market qualification venue

The opt-in `listed-venue-cash` build uses the owner-signed withdrawal and same-owner transfer instructions on profile 7. After the fixed accounts, the caller supplies one read-only listing and its writable funding account for each distinct open listed market across the donor and recipient, ordered by market ID. The SDK derives those pairs from the actual margin account bytes. Flat unpaid debts still count against cash. The donor must cover its existing reservations and pass both current initial margin and the held funding endpoint across its whole account. A recipient accrues its own funding before receiving the cash. The SPL withdrawal and the margin debit are atomic.

The clearing receipt names the funding checkpoints and carries the occupied position directories. An independent replay checks that the lots and entry costs survived, that the funding update balances and that cash moved by the signed amount. The default build and general SOL activation are separate gates.
