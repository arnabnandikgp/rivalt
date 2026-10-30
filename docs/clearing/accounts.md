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
| Registration | Venue/mint, safety, immutable market eligibility, portfolio owner/index | Registry, portfolio/root revisions; membership version increments |
| Deposit | Venue, safety, root, classic token accounts | Root, custody and vault; dependent liability stamps; no oracle prerequisite |
| Withdraw/transfer | Root complete positions/book, relevant markets/sources and safety | Roots, consumed relevant market prefixes, custody/vault as applicable; own nonce/state and safety. No certificate or global event sequence commitment |
| Trade/order execution | Owner/delegate or stored order, root nonce/version, market terms, maker identity/approval/epoch/consumption, relevant sources/funding | All touched roots, markets with consumed funding, selected registrations/ledger and other liable-market ledger; exact signed limits. No unrelated observation or historical event counter as automatic rejection |
| Place/replace/protection | Whole root and relevant sources, current generations/reservations, live signer authority | Root nonce/book/version and consumed relevant market prefixes; no liability-stamp change for authority alone |
| Cancel/revoke | Root/version/current authority, safety | Root/book/epoch; no fresh source or maker quote needed outside frozen ownership |
| Collect/pay/net | Root, selected ledger, full relevant funding/source state; pay/net certificate | Root, relevant market ledger(s) and consumed funding; no custody/vault; invalidate affected payment certificates after mutation |
| Liquidate | Complete target/receiver roots, credible relevant bounds and current orders | Target/receiver, relevant markets/liability ledgers; no custody/vault; strict whole-account post-fee MM-deficit decrease and nonflipping exposure reduction |
| Freeze/resolve | Safety, complete registry, immutable source/funding/config endpoints, canonical pages | Safety, resolution/work/pages and exact financial apply; ordinary root mutations blocked |

A liability version advances for a root's economic change in each market where it
has nonzero exposure/claim before or after the change. This includes a cash change
caused in another market. Selected pool changes also invalidate that market's
payment certificate. Membership changes have a separate version. Relevant funding/
price changes invalidate certificate observation stamps. Scoped revisions establish history dependencies; they are not an immediate-order
or funded-exit signing prerequisite.
Bound all checked counters and reject overflow, never wrap/recycle authority.

Every financial transaction uses one on-chain Clock and actual landed write-lock
ordering. Successful simulations/previews do not reserve state. Missing, duplicate,
foreign or aliased roots/markets/sources reject. Actual token gateways share custody/vault writes. Internal fills omit them, but
selected-market accounting, cross-root dependencies and maker capital still order
conflicting actions. Distinct-market independence is not a validator TPS claim.


## Exact layouts, encoding and deployment

Ordered Borsh fields in [state/accounts](../../programs/clearing/src/state/accounts) are normative.
Clearing accounts use canonical discriminator bytes, SHA-256(`account:<name>`)[0..8].
Each begins with schema u16=7 and a scoped revision u64. D84 deliberately supersedes
P36's preserved historical discriminators for this fresh local domain. Integer seeds are little endian. Reused Position and
OrderBook scalar records preserve 48-/680-byte encoding only, not V2 account
identity, handlers or common-loss semantics. All public JSON integers are decimal
strings with explicit units and schema.

| Account | PDA seeds after string prefix | Bytes including discriminator |
|---|---|---:|
| Venue | `venue-v3`, domain[32] | 329 |
| Custody | `custody-v3`, venue | 59 |
| VenueSafety | `safety-v3`, venue | 85 |
| VenueRegistry | `registry-v3`, venue | 2,113 at 64 members |
| Portfolio | `portfolio-v3`, venue, owner, u16 index | 87 |
| MarginAccount | `margin-v3`, portfolio, u16 child | 978 |
| Market | `market-v3`, venue, u8 registry index | 455 |
| MarketLedger | `ledger-v3`, market | 125 |
| CapitalBinding | `capital-v3`, capital | 114 |
| SettlementCertificate | `settlement-v3`, venue, u8 market | 234 |
| Resolution | `resolution-v3`, venue | 3,652 |
| ResolutionPage | `resolution-page-v3`, venue, u16 page index | 3,408; two fixed rows |
| ResolutionWork | `resolution-work-v3`, venue | 7,926 |
| RetirementCertificate (D64 additive implementation) | `retirement-v3`, venue | 80 |
| Classic SPL vault | `vault-v3`, venue | Token account; venue PDA is token authority |

Resolution pages/work retain epoch fields and are reused only after terminal
reconciliation/new epoch, never for concurrent resolutions. At most 32 row pages;
no single instruction deserializes the whole cohort. Fixed wide arrays are heap/
account-backed, never copied wholesale onto a 4,096-byte SBF stack frame. The
contract's size tests do not establish SBF stack/CU safety.


## Current-profile additions and activation

Canonical maker registrations and funding publishers are clearing-owned schema 7.
Maker-owned curve and price accounts retain schema 4. Their exact layouts are in
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

The names shown here match current source; D84 deliberately changes account/event
discriminators and schema while retaining PDA seed bytes under a fresh domain. Numeric schema,
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

## Scoped-history contract (P40B)

D84 froze this incompatible local wire change before runtime edits. P40A state
remains historical and cannot be read as these accounts. Clearing-owned account
schema is **5**; profile 4 still selects the bounded liquidity behavior, and maker-owned
curve/price schemas and quote payloads remain 4; signed funding reports remain version 1. Source names stay
canonical. No account, database or unresolved original is migrated in place.

Each of the 17 clearing-owned account types inserts `revision:u64` immediately after
`schema_version:u16`, at byte offset 10 including the eight-byte discriminator.
All other fields retain their existing relative order, except `Custody.sequence`
and `RetirementCertificate.custody_sequence`, which are removed. Account
discriminators become the first eight SHA-256 bytes of `account:<canonical name>`;
this is an intentional incompatible layout boundary, not P36-style ABI preservation.
Existing PDA seed bytes and indices are retained under a **new mandatory domain
and fresh local genesis**. Strict discriminator/schema/size/artifact checks reject
old state; the unchanged seed strings do not authorize its reinterpretation.

Footer kind order is fixed: Venue 0, Custody 1, VenueSafety 2, VenueRegistry 3,
Portfolio 4, MarginAccount 5, Market 6, MarketLedger 7, CapitalBinding 8,
SettlementCertificate 9, Resolution 10, ResolutionPage 11, ResolutionWork 12,
RetirementCertificate 13, LiquidityRegistry 14, MakerRegistration 15,
FundingPublisher 16. Account sizes/seeds are tabulated above and in the maker and
publisher contracts.

Revisions identify journal transitions, never signed order authority or risk equity.
A newly initialized account goes 0→1. Each declared mutable clearing-owned account
advances exactly once per successful clearing invocation, including a financial
no-op. Readonly context fields do not advance merely because another instruction
promotes the same key writable in the complete message. Declared nested/optional
accounts and stage-authorized writable remaining accounts are covered. Duplicate
scope keys, unsupported types and checked-u64 exhaustion reject atomically.

Capture revisions before the handler. After all ordinary financial checks and event
emission succeed, check that the handler did not reset its revision and increment
it. Finalize typed accounts before Anchor serializes them; finalize remaining-account
bytes only after their handler's explicit writes. A failed handler, envelope CPI or
later transaction instruction rolls back revisions and financial effects together.
A read-only dependency records its unchanged revision. No revision account, shared
journal counter or readonly-account mutation is introduced.

The event contract and transaction-atomic reconstruction are owned by
[durability](../application/durability.md#scoped-history-successor-contract-p40b).
Full `MarginAccountSnapshot`, `MarketSnapshot`, `LiquidityRegistryPayload`,
`MakerRegistrationPayload` and `FundingPublisherPayload` retain byte parity with
their account bodies by including the predecessor revision after schema. This
preserves the bounded borrowed-event serializers. The final envelope owns revision
advancement; apply candidate financial values before that final revision.
Economic nonces, liability versions, membership, source sequences and safety epochs
retain their separate purposes. Source funding prefixes still materialize under
P40B; P41 owns their dependency reduction.

### Terminal retirement without a global discovery stamp

D84 replaces the old global-sequence retirement stamp with an explicit pause
barrier. The existing venue authority must pause an Active/Custody venue before
the scan.
Every page and final retirement require the same paused safety epoch and membership
version, complete liability-free roots and the existing exact cash/pool/vault checks.
Unpause invalidates the proof. This is a terminal administrative window, not an
ordinary withdrawal/payment prerequisite and not a permissionless way to pause users.

Permitted paused delegation/revocation and cancellation introduce no liabilities
or cash transfers; precreated storage and direct token donations cannot alter
allocated entitlements. Cash/financial mutations reject while paused; unpause
advances the bound safety epoch. Complete liability-free membership still rejects
any live order or claim, independently of those housekeeping actions.
The already-resolved complete-header retirement path remains distinct. Retirement
still clears pause into irreversible Retired mode, preserving eligible user cash
and separately authorized reserve exits. No reserve ownership or payout rule changes.

### Explicit ABI delta and access coverage

`ops/scoped_wire_contract.py` constructs the exact successor ABI from immutable
P40A `f8984e0`, without recapturing expectations from changed generated output.
The original wire fixture remains intact. Besides the layout/event changes above,
20 instruction variants lose custody's sequence-only write privilege and three
storage-precreation instructions append event authority/program metas. Economic
custody writers remain writable, including delegation's liability invalidation.
Maker-owned curves/prices and their instruction/event encodings remain unchanged;
their IDLs' imported Venue/Market/MarginAccount types reflect clearing schema 5.

`instructions/scopes.rs` declares all 42 public contexts, flattened through nested
and optional fields. `ops/check-scoped-history.py` compares that table with Anchor
source declarations and verifies all 53 entrypoint wrappers and real discriminators.
Only APPLY-stage resolution may write remaining cohort roots; other remaining
roots record reads even when the complete transaction promotes their privileges.
These static/native checks do not prove compiled CPI, rollback, packet/CU fit or
journal completeness. The explicit local qualification build is tested separately from these static
checks; default/devnet builds continue to reject financial activation.

## Relevant-market contract (P41)

D86 froze this fresh local boundary before changing contexts. Source, rebuilt
artifacts and scoped integrated acceptance are recorded in
[validation](../operations/validation.md#relevant-market-acceptance-p41). Clearing-owned
accounts and scoped envelopes select **schema 6**; field order, sizes, kinds,
canonical discriminators and PDA seeds stay as schema 5. A new domain/genesis,
explicit `accountSchema: 6`, new artifact pins and fresh journal are required.
Maker-owned curve/price schema 4 and signed quote/report formats remain unchanged.
No retained P40B deployment, original or database is migrated in place.

The required market set is derived on-chain from every touched trader, selected
maker, transfer recipient and liquidation receiver. Include every nonzero position
or scaled claim (positive or negative), every stored active order (including its
protective child), and each requested market effect. Inert protection allowance
without an active child creates no execution authority. Expired-but-not-cleaned
active records remain conservative dependencies until the action refreshes them.
A caller-supplied mask never authorizes omission. Validate root identity and book
bounds before using the set. Existing oracle admission rules remain unchanged;
including a flat claim in the dependency set does not add positive margin credit.

- Immediate/stored routes require the selected market and the complete union for
  trader plus one/two makers. `AccountRouteIdentity.other_market` becomes optional.
- Order actions require the requested market plus the complete root set.
  `ManageAccountOrder.btc/eth` become optional.
- Funded withdrawal/transfer require the complete donor/recipient sets. A flat
  account may omit both. `AccountFinancialIdentity.btc/eth` become optional.
- Claim collection/payment adds the selected market. Gain payment also includes
  every market required by its complete-backing certificate; flat netting requires
  both. Liquidation includes target/receiver sets and the selected market, even
  though target risk orders are cancelled by the transition.
- Treasury fee allocation/withdrawal and resolved reserve withdrawal consume no
  funding and may omit both markets through the same optional financial context.
  Their ledger/custody/vault conservation and authority checks remain intact.
- Complete default, recovery, activation and retirement retain their complete
  two-market contexts. P42 owns ledger/vault/custody isolation and certificate
  liveness; P41 does not remove those remaining shared dependencies.

Each supplied market is a typed, canonical writable account. Omission uses Anchor's
program placeholder and contributes no market read/write to the compiled message
or scoped footer. A missing required market rejects before economic changes. Extra
canonical markets may still be supplied by direct callers; SDK builders omit them
when unnecessary. Superfluous supplied markets retain the full old validation,
materialization and revision semantics rather than silently claiming independence.

Only supplied markets produce funding views/materialize their consumed prefixes.
For a proven empty omitted slot, arithmetic uses neutral zero-exposure inputs and
preserves the original position/checkpoint/generation and reservation-observation
bytes. It never substitutes a neutral valuation for an exposure, claim or live
order. Each relevant consumed prefix remains irreversible under time/slot expiry,
publisher outage/revocation and later reports; held-window bounds and mixed-market
withdrawal checks remain intact.

The four affected payload shapes become explicit partial snapshots:
`LiquidityRouteExecuted.other_market_state` is `Option<MarketSnapshot>`;
`AccountOrderChanged.markets`, `AccountFinancialChanged.markets` and
`AccountLiquidated.markets` are bounded vectors of at most two snapshots, ordered
by registry index. Omitted market snapshots are absent, never fabricated or used to
reset the projection. Revisions authenticate every included snapshot. Existing
financial amounts, account guards, complete-root snapshots and fee splits stay.

Acceptance requires independent missing-loss/order/receiver cases, signed isolated
BTC/ETH dependency sets, cross-market coupling, held/expired/negative funding
prefix checks, transfers/withdrawals/reservations/TP/SL/liquidation, ABI/SDK parity
and actual Surfpool RPC/WS/PostgreSQL reconstruction. Failed and successful paths
must use the rebuilt schema-6 artifact; P40B evidence does not qualify it.

## Custody isolation contract (P42)

D87 freezes this fresh local schema-7 boundary before runtime edits. P41 remains the
accepted schema-6 predecessor at `49b95a4`; no existing deployment/database/original
is migrated. Use a new domain/genesis, explicit `accountSchema: 7`, fresh artifact
pins and journal binding. Profile 4, maker-owned schema 4, quote/report versions,
canonical discriminators, PDA seeds and instruction argument encodings stay intact.
Scoped rebuilt acceptance is recorded in [validation](../operations/validation.md#custody-isolation-acceptance-p42);
the contract alone supplies no activation or resource qualification.

Ordered account changes (all sizes include discriminator):

| Account | Exact successor field delta | Size |
|---|---|---:|
| Custody | Delete `total_cash:u64` and `liability_versions:[u64;2]`; retain schema, revision, venue, allocated_vault, bump in that order | 59 |
| MarketLedger | Insert `liability_version:u64` after `version:u64` and before bump | 125 |
| SettlementCertificate | Replace `liability_versions:[u64;2]` in place with `liability_version:u64`, binding only its selected ledger | 234 |
| Other clearing accounts | Numeric schema 7; no field/order/size change | unchanged |

Custody records only allocated tokens. Ordinary financial rights live in canonical
roots and selected ledgers. Full cash is derived as `allocated V - sum(P+I+T)` at
complete frozen/admin checkpoints, then checked against the complete root scan; it
is never an asynchronously updated spendable balance. Market liability stamps move
to the corresponding ledger, without reusing its unrelated fee/insurance version.
A root cash, quantity or fixed-claim change invalidates each market where it has a
nonzero position/claim before or after; selected settlement-pool changes invalidate
that market too. A pure nonce/delegate/order-authority change or checkpoint rewrite
preserving the exact fixed claim does not invalidate debtor backing. Price/funding
observation stamps remain separate and unchanged.

Account-meta contract (W means declared write; omitted means absent, not readonly):

| Context / operation | Required scope after change |
|---|---|
| Immediate/stored route | Venue/safety R; trader/makers/registrations W; relevant markets W; selected ledger W and optional other ledger W when any touched root has its claim/exposure. Omit custody/vault |
| Manage order / delegate | Existing whole-root guard/authority; root W, relevant consumed markets W for order actions. Omit custody/vault/ledgers; delegate consumes no funding |
| Common financial identity | Venue/safety R and canonical optional BTC/ETH W only. No token or ledger fields |
| Funded withdrawal | Financial identity plus root W, relevant liability ledgers W, custody/vault W, canonical mint/token/destination; exact token CPI |
| Funded transfer / liquidation | Financial identity plus touched roots W and relevant liability ledgers W. Omit custody/vault |
| Loss/gain | Financial identity, root W, selected plus all root-dependent liability ledgers W; registry and optional gain certificate R. Omit custody/vault |
| Flat netting | Financial identity, root and both ledgers W; registry/source certificate R. Omit custody/vault |
| Deposit / flat custody withdrawal | Root/custody/vault W; canonical optional liability ledgers W for active deposited roots; no market/source account or fresh-price prerequisite |
| Flat custody transfer | Venue/safety R and two roots W; omit custody/vault/ledgers |
| Fee allocation | Separate treasury context: venue/safety R, fee-authority signer, selected ledger W only; omit mint/token/custody/vault/markets |
| Fee withdrawal / retired reserve exit | Treasury context plus custody/vault/destination W and mint/token; selected ledger only; retain distinct authorities and terminal reserve gate |
| Reserve seed / surplus classification | Actual token/allocated gateway plus selected ledger W, no other ledger |
| Backing initialize/check | Omit custody; selected ledger R for check, both markets R for complete debtor classification, registry R and certificate W |
| Maker controls / funding publication | Remove custody used solely for profile identity; retain canonical venue/safety and every code/authority/source/depth check |
| Complete activation/default/recovery/retirement | Retain both markets/ledgers and actual allocated-vault reconciliation; freeze remains a global safety barrier |

Optional ledger omission must be derived from all touched roots and selected pool
changes; it cannot omit an obligation to preserve an old certificate. Supplied
extra canonical ledgers retain their declared write/revision semantics. Token
operations authenticate actual backing `actual >= allocated`, bounded allocation,
owner/mint/destination and local entitlement debit/credit; they do not recompute
venue-wide root cash. Missing token funds, arithmetic failure, second-instruction
failure or event failure rolls the entire transaction back.

The backing scan remains complete and conservative. Its selected ledger stamp,
membership, safety, required observations, source deadlines and held-funding bounds
are checked on every page and payment. Final page and payment may be two instructions
in one atomic transaction. A root promoted writable by the later instruction remains
a read-only dependency of the earlier scan; the scan never mutates it. No stale
certificate, source relaxation, private subset or guaranteed completion window is
introduced. Continuous-activity progress is measured separately.

Wire payload changes are explicit: remove global `total_cash` and
`liability_versions` from ordinary custody/route/financial/authority/order/
liquidation payloads. `MarketLedgerSnapshot` appends `liability_version` after
`version`; route retains selected `ledger` and adds `other_ledger:Option<...>`
immediately after it. Financial and liquidation events carry ordered, bounded
partial ledger vectors. `AccountFinancialChanged.allocated_vault/actual_vault`
become options; internal actions emit neither. Custody payload `allocated_vault`
also becomes optional for pure transfers. BackingSnapshot replaces its version
array with the selected scalar. `RetiredReserveWithdrawn` also drops the unavailable
global `total_cash`; its selected reserve, allocation and actual token fields remain.
Complete-resolution payloads retain exact frozen
cash and both liability stamps, now derived from ledgers. Indexer/API full cash is
an explicitly derived complete-root value; omitted fields never zero unrelated
state. Authenticate every changed ledger/root with its scoped footer revision.

Acceptance requires actual distinct-owner/payer isolated BTC/ETH messages without
protocol W/W or W/R overlap; retained same-market/cross coupling; independent local
conservation, fee carries and fractional claims; complete default/retirement and
funded token exits; full certificate invalidation and atomic final-page/payment;
classified continuous-sampling/trading scan attempts; rebuilt ABI/SDK/SBF parity;
actual RPC/WS/PostgreSQL crash/replay reconciliation. A temporary coordinated window
may remain a measured limitation, never an implicit guarantee. P43/P44 cannot
inherit resource acceptance from P41.
