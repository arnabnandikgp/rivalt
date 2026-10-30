# Accounts, ownership and wire identity

Preserve two markets (BTC index 0, ETH index 1), one classic SPL six-decimal test
mint, 64 stable members including makers/receivers, four portfolios per owner,
children 0–8, two position slots, four orders and two protective pairs per root.
Child zero is Cross; positive children are Isolated. Makers are isolated. Cross
eligibility is immutable on market admission; both initial markets are eligible.
No identity reuse, market replacement, live conversion or dynamic listing is added.
A cross account uses the eligible registry, not a user-selected clearing group.
The bounded two-slot implementation is not a claim of unlimited market support.


## Authority, dependencies and linearization

The root owner controls collateral, flat netting, delegates and immediate/orders.
A delegate controls only that root's trading/orders until exclusive expiry or epoch
revocation; no cash/netting/admin rights. Maker registration gives standing pricing
authority over its isolated capital, with joint module approval and existing owner/
alias exclusions. A receiver signs its own liquidation and passes whole-account IM.
Permissionless maintenance can only execute stored authority or exact financial
rules. Venue, fee and reserve authorities are separate stored keys, initialized by
the clearing deployment's verified upgrade authority. They cannot bypass activation,
health, frozen membership or choose a creditor subset.

| Action | Must read/authenticate | Serializing writes / validity |
|---|---|---|
| Registration | Venue/mint, safety, immutable market eligibility, portfolio owner/index | Registry, portfolio/root, custody event sequence; membership version increments |
| Deposit | Venue, safety, root, classic token accounts | Root, custody and vault; dependent liability stamps; no oracle prerequisite |
| Withdraw/transfer | Root complete positions/book, relevant markets/sources, custody, safety | Roots, consumed relevant market prefixes, custody/vault as applicable; own nonce/state and safety. No certificate or global event sequence commitment |
| Trade/order execution | Owner/delegate or stored order, root nonce/version, market terms, maker identity/approval/epoch/consumption, relevant sources/funding | All touched roots, markets with consumed funding, selected registrations/ledger/custody; exact signed limits. No unrelated observation or historical event counter as automatic rejection |
| Place/replace/protection | Whole root and relevant sources, current generations/reservations, live signer authority | Root nonce/book/version and affected liability stamps |
| Cancel/revoke | Root/version/current authority, safety | Root/book/epoch; no fresh source or maker quote needed outside frozen ownership |
| Collect/pay/net | Root, selected ledger, full relevant funding/source state; pay/net certificate | Root, market ledger(s), custody and consumed funding; invalidate affected payment certificates after mutation |
| Liquidate | Complete target/receiver roots, credible relevant bounds and current orders | Target/receiver, selected market/custody; strict whole-account post-fee MM-deficit decrease and nonflipping exposure reduction |
| Freeze/resolve | Safety, complete registry, immutable source/funding/config endpoints, canonical pages | Safety, resolution/work/pages and exact financial apply; ordinary root mutations blocked |

A liability version advances for a root's economic change in each market where it
has nonzero exposure/claim before or after the change. This includes a cash change
caused in another market. Selected pool changes also invalidate that market's
payment certificate. Membership changes have a separate version. Relevant funding/
price changes invalidate certificate observation stamps. Event sequence exists for
history discovery only; it is not an immediate-order or funded-exit prerequisite.
Bound all checked counters and reject overflow, never wrap/recycle authority.

Every financial transaction uses one on-chain Clock and actual landed write-lock
ordering. Successful simulations/previews do not reserve state. Missing, duplicate,
foreign or aliased roots/markets/sources reject. Shared custody, market and maker
writes remain hot accounts; P24/P28 measure them rather than claim parallelism.


## Exact layouts, encoding and deployment

Ordered Borsh fields in [state/accounts](../../programs/clearing/src/state/accounts) are normative.
Current accounts retain explicit discriminator bytes derived from their original
pre-consolidation names. Do not hash the new source name to decode them. Each
financial account includes schema u16=3. Integer seeds are little endian. Reused Position and
OrderBook scalar records preserve 48-/680-byte encoding only, not V2 account
identity, handlers or common-loss semantics. All public JSON integers are decimal
strings with explicit units and schema.

| Account | PDA seeds after string prefix | Bytes including discriminator |
|---|---|---:|
| Venue | `venue-v3`, domain[32] | 321 |
| Custody | `custody-v3`, venue | 83 |
| VenueSafety | `safety-v3`, venue | 77 |
| VenueRegistry | `registry-v3`, venue | 2,105 at 64 members |
| Portfolio | `portfolio-v3`, venue, owner, u16 index | 79 |
| MarginAccount | `margin-v3`, portfolio, u16 child | 970 |
| Market | `market-v3`, venue, u8 registry index | 447 |
| MarketLedger | `ledger-v3`, market | 109 |
| CapitalBinding | `capital-v3`, capital | 106 |
| SettlementCertificate | `settlement-v3`, venue, u8 market | 234 |
| Resolution | `resolution-v3`, venue | 3,644 |
| ResolutionPage | `resolution-page-v3`, venue, u16 page index | 3,400; two fixed rows |
| ResolutionWork | `resolution-work-v3`, venue | 7,918 |
| RetirementCertificate (D64 additive implementation) | `retirement-v3`, venue | 80 |
| Classic SPL vault | `vault-v3`, venue | Token account; venue PDA is token authority |

Resolution pages/work retain epoch fields and are reused only after terminal
reconciliation/new epoch, never for concurrent resolutions. At most 32 row pages;
no single instruction deserializes the whole cohort. Fixed wide arrays are heap/
account-backed, never copied wholesale onto a 4,096-byte SBF stack frame. The
contract's size tests do not establish SBF stack/CU safety.


## Current-profile additions and activation

Canonical maker registrations and funding publisher accounts use schema 4 while
financial accounts remain schema 3. Their exact layouts are in
[quoting](../liquidity/quoting.md) and [funding](../liquidity/funding.md).
The older fixed-maker registration is retired, not reinterpreted as the current
canonical registration. Unknown schema/profile combinations reject even if fields decode.

Initialization is signed by the verified clearing ProgramData upgrade authority;
it pins separate venue, fee and reserve authorities and the immutable reserve
recipient. Initialize BTC then ETH and the stable member registry before portfolios.
Seed insurance requires both reserve authority and actual donor-token authority.
Surplus classification requires reserve authority and cannot exceed the unallocated
actual vault excess; repeated classification cannot allocate it twice.

The profile-4 initializer permits flat custody setup only under its explicit local
feature. `activate_liquidity` requires venue authority, unpaused Custody, complete
32-page safety storage, an idle zero-epoch resolution header, reconciled vault and
ledgers, zero gross exposure/funding/settlement/fees/carry and both fresh Normal
market qualifications. Only the restricted publisher can qualify this profile;
initialization required sealed complete registries. Activation clears held
observations and increments safety/custody state; fresh reports precede trading.
Recovery uses a separate path and cannot reset earned funding/history.

## Encoding and compatibility

Borsh field order and little-endian integers are wire contracts. Public JSON
integers are decimal strings with explicit units. Account addresses, discriminator
bytes, instruction metas, error numbers and signed domains must not change as an
incidental rename. Preserve fixed 96-limb wide records as 768 serialized bytes;
heap boxing changes placement, not wire size or ownership.

The names shown here match current source, with explicit original discriminators
and unchanged seeds. Numeric schema,
API and transaction versions remain. Do not introduce permissive decoding or merge
old accounts solely because their names collide. [Deployment rules](../operations/deployment.md)
cover fresh artifacts, retained state and migration boundaries.

The consolidation wire baseline is `tests/fixtures/wire-contract.json`, captured
from `72187bc` before source edits and narrowed under D81 to exact retained records
from `b89768b`. The fixture separately lists deliberate removals; retained hashes
are not recaptured from changed layouts. `python3 ops/wire_contract.py` pins all three
IDLs, expanded layouts, ordered fields/variants/metas, discriminator bytes, seeds,
errors and literal domains. Only declaration ordering, docs and source labels are
omitted. Its hashes do not replace raw codec/PDA conformance, SBF or RPC tests.
