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

Ordered Borsh fields in [state/v3](../../programs/clearing/src/state/v3) are normative.
Anchor discriminator is the first eight bytes of SHA-256 of `account:<type name>`;
each includes schema u16=3. Integer seeds are little endian. Reused PositionV2 and
OrderBookV2 scalar records preserve 48-/680-byte encoding only, not V2 account
identity, handlers or common-loss semantics. All public JSON integers are decimal
strings with explicit units and schema.

| Account | PDA seeds after string prefix | Bytes including discriminator |
|---|---|---:|
| VenueV3 | `venue-v3`, domain[32] | 321 |
| CustodyV3 | `custody-v3`, venue | 83 |
| SafetyV3 | `safety-v3`, venue | 77 |
| VenueRegistryV3 | `registry-v3`, venue | 2,105 at 64 members |
| PortfolioV3 | `portfolio-v3`, venue, owner, u16 index | 79 |
| MarginAccountV3 | `margin-v3`, portfolio, u16 child | 970 |
| MarketV3 | `market-v3`, venue, u8 registry index | 447 |
| MarketLedgerV3 | `ledger-v3`, market | 109 |
| CapitalBindingV3 | `capital-v3`, capital | 106 |
| SettlementCertificateV3 | `settlement-v3`, venue, u8 market | 234 |
| ResolutionV3 | `resolution-v3`, venue | 3,644 |
| ResolutionPageV3 | `resolution-page-v3`, venue, u16 page index | 3,400; two fixed rows |
| ResolutionWorkV3 | `resolution-work-v3`, venue | 7,918 |
| RetirementCertificateV3 (D64 additive implementation) | `retirement-v3`, venue | 80 |
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
`MakerRegistrationV3` is the older fixed-maker format, not the current canonical
registration. Unknown schema/profile combinations reject even if fields decode.

Initialization is signed by the verified clearing ProgramData upgrade authority;
it pins separate venue, fee and reserve authorities and the immutable reserve
recipient. Initialize BTC then ETH and the stable member registry before portfolios.
Seed insurance requires both reserve authority and actual donor-token authority.
Surplus classification requires reserve authority and cannot exceed the unallocated
actual vault excess; repeated classification cannot allocate it twice.

The profile-4 initializer permits flat custody setup only under its explicit local
feature. `activate_liquidity_v4` requires venue authority, unpaused Custody, complete
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

The names shown here match current source. P36 will give current definitions domain
names and explicitly retain existing discriminators and seeds. Numeric schema,
API and transaction versions remain. Do not introduce permissive decoding or merge
old accounts solely because their names collide. [Deployment rules](../operations/deployment.md)
cover fresh artifacts, retained state and migration boundaries.
