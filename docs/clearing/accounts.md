# Accounts, ownership and wire identity

P47 qualifies the RC2 schema-8 local runtime; integration is tracked in [STATUS](../STATUS.md).
The retained P44 deployment stays on its schema-7 client.

Preserve two markets (BTC index 0, ETH index 1), one classic SPL six-decimal test
mint, 64 stable members including makers/receivers, four portfolios per owner,
children 0–8, two position slots, four orders and two protective pairs per root.
Child zero is Cross; positive children are Isolated. Makers are isolated. Cross
eligibility is immutable on market admission; both initial markets are eligible.
No identity reuse, market replacement, live conversion or dynamic listing is added.
A cross account uses the eligible registry, not a user-selected clearing group.
The bounded two-slot implementation is not a claim of unlimited market support.

## Account-scale successor contract (P51B)

**Successor contract; financial activation remains disabled.** Schema 8 above
remains the active implementation. D93 selects the following candidate for P54–P56;
P51B changed no instruction, layout, IDL, enabled count or deployment. P54B now
implements the inactive scratch-page layout described below. The
[resolution candidate](risk-and-resolution.md#scalable-exact-resolution-candidate-p51b)
and [backing candidate](accounting.md#incremental-backing-candidate-p51b) are required
dependencies, not optional later repairs after lifting the registration limit.

### Code-to-design gap matrix

| Current source / constraint | Successor obligation | Owning phase |
|---|---|---|
| `state/identity.rs`: `MAX_MEMBERS=64`; `state/records.rs` bounded registry decoding | Fixed-size pages with authenticated complete traversal; page capacity never acts as venue population cap | P55A |
| `account_custody/mod.rs`: register appends to `Vec<Address>`, lifetime `count:u16`, no individual retirement | Monotone u64 identity; empty registration distinct from financial participation; owner-authorized empty retirement and permanent tombstone | P55A |
| `state/accounts/layouts.rs`: `Portfolio.children:u16`, u16 indices/root ID | u32 owner namespace keys, u64 member IDs and explicit lifecycle; retain current 4/9 namespace policy until P60A | P55A/P60A |
| `account_safety/resolution/{mod,freeze,recovery}.rs`: registry hash/count and fixed pages | Freeze authenticated live-index root/count/epoch, then enumerate all financial members exactly once in stable ID order | P54B/P55A |
| `financial-core/lib.rs`: 64-participant checks and aggregate arithmetic | Separate per-root numeric admission from aggregate membership; checked wider totals and complete-cohort conservation | P54A/P55A |
| `clearing/{wide,row}.rs`: 96 limbs, product denominator, 186-bit factor, 93-bit totals | Paged arithmetic; reduced exact LCM with bounded small divisors; count-derived widths, not a bigger unexplained constant | P54A/P54B |
| `ResolutionRow/Page`: two wide flows per root, two roots/page, 32 pages | Compact frozen inputs and whole-flow quotients; shared paged wide scratch; recompute exact remainders to verify order | P54B/P54C |
| `ResolutionWork`, `clearing/circulation.rs`: u64 visited mask, 69 nodes, 518 arcs/u16 offsets | Paged graph, u64 indices, complete rank/permutation proof, hierarchical active-arc lookup and resumable canonical DFS | P54C |
| `account_cash/certificate.rs`: whole scan restarts on selected liability/source/membership stamp | Incrementally maintained per-page backing proofs; bounded validity region with current-source admission, no stale certificate or forced pause | P55B |
| `MarketLedger`, custody, retirement scans | Keep actual allocated vault cap; complete cash/claim totals, market attribution and empty-member exclusion proof; no duplicated cached spendable cash | P54/P55 |
| `events.rs`, `instructions/scopes.rs`, SDK `account-{client,snapshot}.ts` | Versioned lifecycle/page events and authenticated bounded page discovery; IDs as decimal strings, no JS number conversion | P55/P56A |
| Services `account-{frozen,rate}-proposal.ts`, `account-settlement-worker.ts` | Untrusted paged proposals, durable continuation/recovery and incremental backing; no whole-cohort transaction or trusted solver | P54/P56A |
| Indexer `account-{events,projection,reconcile}.ts` and trader UI | Staged completeness, page/tombstone projection and stable-ID pagination; never report partial replay as ready | P52/P56A |

### Identity and membership invariants

`Registered` counts identities; `Financial` counts roots activated for money or
obligations; `Exposed` counts nonzero q; `Default-connected` means claims joined
through the two market nodes. These are different populations. A funded flat root
is Financial even with no open position. Makers and liquidation receivers are
ordinary counted financial roots with their existing separate role restrictions.
Default still includes the **complete financial venue**, not only a suspected
connected component or a selected group. Omitting a Registered-only root is safe
only because the program enforces cash=q=v=orders=reservations=0 and no live binding.

Member IDs are monotone u64, assigned once and never reused. Page/slot derive from
ID, with 64 entries/page as an I/O choice. Registration writes the registry header
and its page; ordinary fills do not. A sparse radix index records pages with
financial entries; its stored counts authenticate traversal. Entry/exit updates
the leaf and ancestor counts atomically. No writable global member counter is
added to every trade. An existing Financial root stays indexed even when temporarily
empty, until its owner explicitly deactivates it. This avoids automatic tree writes
on a zero crossing and prevents a caller from dropping a debt-bearing root.

| Transition | Authority / exact precondition | Atomic effect |
|---|---|---|
| Absent → Registered | Owner, canonical unused portfolio/child PDA, unfrozen venue, checked next ID; payer supplies rent | Allocate ID/root/page; zero financial state; no trading permission |
| Registered → Financial | Owner, unfrozen safety; all required recovery storage and its rent funded before eligibility | Set live bit/count/path; bind activation generation; only then may the same transaction deposit or trade |
| Financial → Financial | Existing operation authority and all current whole-account rules | Preserve live membership; update affected backing proof as part of the financial transition |
| Financial → Registered | Owner; cash, quantities, fixed claims/fractions, reservations and active orders/protections all zero; delegate revoked and maker binding retired | Remove live bit/count/path; retain ID, nonces and generations |
| Registered → Retired | Owner, same zero-state checks, no binding; no frozen epoch owns the root | Retain permanent tombstone at root PDA and identity entry; refund only excess account rent |
| Financial → frozen snapshot → Financial | Existing credible freeze/emergency authority, then permissionless verified continuation | Freeze all live membership; apply every row once; recover only after exact reconciliation under the existing recovery rules |

No live mode conversion or namespace reuse is introduced. A tombstone cannot be
passed as a margin account or reinitialized; old signed actions cannot regain
authority. Full venue retirement remains distinct. No financial root/page can be
closed during default. Indexed membership changes serialize with safety so a
freeze sees either the full entry/exit or its unchanged predecessor.

### Versioned layout target and storage ownership

Reserve **account schema 9 / local profile 5** for this successor; this reservation
does not activate it or change existing financial account schemas. The initial
scratch layout below has its own typed/native decoder. All new accounts retain canonical name-based
discriminators and ordered little-endian Borsh fields. Common prefix is
`schema:u16, revision:u64, venue:Pubkey`; sizes include the eight-byte discriminator.
No version suffix is added to Rust domain type names. The final generated ABI and
literal byte-size/seed tests must agree before P54/P55 deploy anything.

| Record | Ordered fields after the common prefix / explicit delta |
|---|---|
| VenueRegistry | `membership_epoch:u64, next_id:u64, registered_count:u64, financial_count:u64, live_index:Pubkey, bump:u8`; 115 bytes |
| MemberPage | `page_index:u64, allocated_mask:u64, financial_mask:u64, entries:[MemberEntry;64], bump:u8`; 2,699 bytes |
| MemberEntry | `root:Pubkey, lifecycle:u8, activation_generation:u64`; 41 bytes; member ID is page/slot-derived; unallocated entry all zero |
| MemberIndexNode | `level:u8, prefix:u64, populated_mask:u16, counts:[u64;16], bump:u8`; 190 bytes; children use deterministic PDA prefixes; zero count iff absent bit |
| StorageFunding | `allocation:Pubkey, rent_payer:Pubkey, contributed_lamports:u64, locked_epoch:u64, bump:u8`; 131 bytes; rent refund binding, not custody/insurance or a spendable trader balance |
| Portfolio | Keep ownership; replace `index:u16, children:u16` with `index:u32, active_children:u32`; no bitmap-based child authorization |
| MarginAccount | Replace `subaccount_index:u16, id:u16` with `subaccount_index:u32, id:u64`; append `lifecycle:u8, activation_generation:u64` immediately before bump; other fields unchanged |
| MarginTombstone | Common prefix, `portfolio:Pubkey, owner:Pubkey, child:u32, id:u64, activation_generation:u64, bump:u8`; 135 bytes; same root address, different discriminator |
| Resolution / work | u64 frozen count/cursors/row IDs, committed live-index root and epoch; replace inline `Wide` by typed paged references and explicit used-limb counts; no inline cohort arrays |
| Frozen row | Stable member ID/key, original cash/q/generations/claims, own collected cash, three whole-flow floors, fractional/direction flags, applied bit; no per-row wide numerator |
| Arithmetic / graph / order pages | Epoch, work-object kind, page index, used length, fixed bounded payload, bump; all page identity derived from venue/epoch/kind/index, never a caller-selected writable account |

New seed prefixes are `member-page`, `member-index`, `resolution-limbs`,
`resolution-graph`, `resolution-order` and `storage-funding`, followed by venue and
the typed indices (or allocation key for storage funding);
work pages additionally include resolution epoch. Root/portfolio prefixes remain
but use u32 namespace seeds under a fresh domain. Typed layout lengths, graph-word
packing and arithmetic page payload sizes are P54's measured encoding decisions;
they cannot be inferred from the native Python object sizes. An opcode may access
only its bounded canonical pages. No page instruction grants authority over money.

Creation pays rent explicitly from a transaction signer. P55 must reserve scalar
snapshot/graph capacity **before financial activation** and provision wide scratch
for the aggregate proved numeric envelope, not wait for a bankrupt keeper to pay.
Shared scratch grows only at an authenticated capacity transition. The funding
source is explicit local operator lamports or an authorized storage payer, never
collateral, insurance or silently redirected trading fees. Refunds go to the
recorded payer only after no active/frozen work references that allocation.
The exact worst-case provisioning/cost proof remains an activation gate; an
unfunded allocation is a rejected activation, not an unresolvable admitted debt.

Numeric exhaustion rejects without wrap. With N finite financial roots and retained
per-root claim bound K, use checked totals sufficient for N*K; u128 is not a proof
for u64 N. P54B uses three u64 words with an explicit <2^151 bound for those totals; determinant
factors need up to 302 bits, hence five u64 limbs. Work length/index arithmetic is
also checked. Existing per-root limits, global allocated custody <=10^15 atoms and
market gross OI stay unchanged. Funding-index rebasing in P58D must preserve each
economic claim exactly; P60 namespace/order expansion must rerun the relevant
arithmetic and retirement proofs rather than exploit spare field widths silently.

### Successor membership reads (P54B, inactive)

`MemberIndexNode` and `MemberPage` now implement the reserved 190-/2,699-byte
read layouts above; no current instruction creates/mutates them. The Borsh wrapper
around the boxed 64-entry array adds no wire bytes. An entry's 41 bytes are root
address, lifecycle u8 and activation generation u64. Codes are 0 unallocated,
1 Registered, 2 Financial and 3 Retired; unallocated entries remain all zero.
A Financial entry must be allocated, have a nonzero root and generation, and still
match the actual canonical margin root before valuation. P55 owns registration,
activation, tombstones, storage funding and complete mutation coverage.

Index-node seeds are `member-index`, venue, level u8, prefix LE-u64 and bump.
Member-page seeds are `member-page`, venue, page-index LE-u64 and bump. Nodes have
level at byte 50, prefix at 51, populated mask at 59, 16 u64 child Financial counts
at 61 and bump at 189. Member pages have index at 50, allocated mask at 58,
financial mask at 66, 64 entries at 74 and bump at 2,698. Current native loader
checks match these literal layouts and name-derived discriminators.

A u64 member ID maps to page `id/64` and bit `id%64`. Its 58 page bits require
15 radix-16 levels, numbered 14 (root) through 0 (parent of member pages). Root
prefix is zero; a node child is `prefix*16+slot`. At level 0 it is a page index;
otherwise it is the next node prefix. Counts are Financial roots, not populated
pages. Bits and nonzero counts must agree, child counts must sum exactly, and
children outside the u64 ID namespace reject. In particular root slots 4–15 are
unreachable, and a level-0 child count cannot exceed 64.

The 544-byte internal `MembershipCursor` fixes the next canonical node, page or
member from the frozen root/count. It retains at most 15 bounded path frames,
verifies every subtree count on return, consumes financial bits in ascending ID
order and commits an ordinal only after successful row valuation. Work is one
bounded node/page/member transition; whole traversal has exactly
`N + 2*(index_nodes + member_pages)` such requests including terminal observation.
This is logical work, not measured transactions or CU. No population-sized stack,
private keeper list or skipped empty-looking financial root is permitted.

The read adapter authenticates program ownership, exact layout, venue, requested
level/prefix/index and PDA before advancing. **It does not itself freeze data.**
The owning controller must bind the safety/membership epoch and prohibit index,
entry and root mutation for that frozen snapshot; checking a count or caller's
checkpoint cannot substitute for those locks. Full root role/mode/ID/generation
and source/funding authentication, public handlers and signed acceptance remain
unfinished. Existing schema-8 account creation/trading limits are unchanged.

### Prepared frozen verification (P54B, inactive financial paths)

D97 binds the real schema-8 frozen `Resolution`, requiring Value/cursor zero,
exact source revision and registry hash, and unchanged frozen economic inputs.
`PreparedSettlement` uses schema 9, **1,463 bytes**, seeds `prepared-settlement`,
venue and epoch LE-u64. Its common schema/revision/venue prefix ends at byte 50;
epoch/source/source-revision end at 98; registry revision/membership epoch/hash at
146; count/safety/terms at 170; configuration/prices/funding at 234; allocated and
four market-bucket/gross arrays at 306. Stage/index-ready mask/member-page-ready
end at 310, followed by the 1,152-byte preparation checkpoints and bump.
`FrozenMarginPage` uses **1,156 bytes**, seeds `frozen-margin-page`, venue, epoch
LE-u64 and page-index LE-u64. After the common prefix, epoch/index occupy 16 bytes,
then row-count, eight 136-byte rows and bump. Rows bind stable ID, root address,
activation generation, original revision, cash, two signed quantities/generations,
exact i128 claims and collected cash. The fixed eight-row page is an I/O bound.

Initializers are permissionless/rent-funded and read the actual frozen source.
They cannot accept uploaded claims or caller-selected membership. The bounded
bridge mirrors the source's complete at-most-64 registered roots into one member
page and 15 radix nodes; generation is 1 because schema-8 IDs cannot be reused.
One mirror is created per fresh local qualification venue. Later freezes can use
the unchanged existing resolution; the paged live lifecycle is P55's separate work.

Valuation derives whole-account claims from the real margin model at frozen
prices/funding and checks canonical membership, identity and complete conservation.
Only after all ancestor counts close can denominator work begin. Stage- and
revision-guarded denominator calls consume frozen rows and perform 1–128 word
steps with at most three exactly ordered limb pages. Registers 0/1 alternate the
common denominator; register 2 is scratch and attempt is 0. Missing next pages
end the current bounded call; they cannot supply implicit zero data. The final
denominator stage is Proposal. `SettlementRates` then controls untrusted upload,
rate verification and insurance clipping; no path from this controller permits Apply.

`SettlementRates` uses schema 9 and **1,204 bytes**, seeds `settlement-rates`, venue
and epoch LE-u64. Prefix/epoch end at 58; attempt at 66; stage at 67; proposer at
99; last progress slot at 107; five-word factor at 147; numerator lengths at 163;
uploaded word counts at 179; insurance checkpoint at 243; rate checkpoint at 1203;
then bump. Stages are Await=0, Upload=1, Verify=2, Rejected=3 and Verified=4.
The original frozen insurance and completed rounds remain separate from attempt
state. Each new attempt increments a checked u64; page PDA seeds omit attempt so
retries reuse finite allocation.

Registers 3/4 hold the proposed BTC/ETH numerators. Only the proposal signer may
upload 1–32 contiguous words, within one page, at the exact next offset. The last
used word must be nonzero; zero is length zero. Count-derived width and five-word
factor bounds apply before upload. Registers 5–24 are algorithm-owned scratch;
any helper may retag an old scratch page for the current attempt exactly once.
No caller writes denominator registers 0/1 or arbitrary scratch values. Scratch
tails stay dirty and are excluded by verified normalized lengths.

Every helper may continue a completely uploaded proposal using authenticated
frozen rows and 1–128 bounded word steps. Arithmetic rejection records Rejected;
it never spends insurance or consumes an evaluation. A completed fractional round
updates only the planned budget and returns Await. Verified requires a final
integral round, with no more than three evaluations. D98 defines reset authority
and the 64-slot inactivity bound; reset cannot change frozen input or successful
insurance rounds. Missing/stale/foreign account guards still fail atomically.

Scoped history kinds 17–22 are PreparedSettlement, FrozenMarginPage,
MemberIndexNode, MemberPage, SettlementLimbPage and SettlementRates. Their schema is 9; all existing
financial kinds remain 8. The ABI extension is literal in
[its checker](../../ops/settlement_wire_contract.py); existing instructions/layouts,
seeds, discriminators, signing domains and errors are independently retained.
The selected runtime artifacts and admitted capacity remain unchanged until
actual acceptance. Generated clients do not establish deployed qualification.

### Successor limb-page layout (P54B, inactive)

The first concrete scratch type is `SettlementLimbPage`; it is reserved schema 9,
not a change to schema-8 venue/margin accounts. The verification-only P54B
controller initializes and consumes it under the D97 frozen-source bridge. Fields are Borsh little endian with discriminator
`sha256("account:SettlementLimbPage")[0..8]`:

| Byte offset | Field / bytes |
|---|---|
| 0 | Discriminator / 8 |
| 8 | Schema u16 / 2 |
| 10 | Internal scratch revision u64 / 8 |
| 18 | Venue address / 32 |
| 50 | Resolution epoch u64 / 8 |
| 58 | Attempt u64 / 8 |
| 66 | Logical register u32 / 4 |
| 70 | Page index u64 / 8 |
| 78 | Addressable word count u16 / 2 |
| 80 | PDA bump / 1 |
| 81 | Fixed 256-u64 payload / 2,048 |

Total **2,129 bytes**. PDA seeds are `resolution-limbs`, venue, epoch LE-u64,
register LE-u32, page-index LE-u64 and bump. Attempt is a fenced reuse tag, not a
seed that permits unbounded allocation on every proposal. The last page permits
only `min(256, capacity-page_index*256)` words; its unused payload is inaccessible.
The loader checks exact ownership, size, header, seeded address and required write
permission. Read-only requests cannot write even if transaction privilege merging
makes the account writable. Signed accounts/executable accounts are rejected.

The page is temporary arithmetic, never collateral or a claim. Revision overflow
rejects before a writable window opens. A successful invocation increments each
declared write page once and atomically persists its controller checkpoint. The
controller owns the epoch/attempt and descriptors; caller-supplied revisions are
replay guards only. Structural cursor validity or arbitrary keeper versions cannot
establish progress. Allocation/refund lifecycle and complete signed qualification
remain P54/P55 obligations, with financial expansion disabled until P56B.

### Deployment and phase gates

Use a new local domain/genesis/mint, exact new artifact hashes and empty schema-9
journal. Keep old artifacts, accounts, evidence and unresolved originals with their
schema-8 executors. No in-place copying of claims, positions, reserves or authority.
Default/devnet gates remain closed. P51B's model is never imported by a production
worker. P54 owns bounded exact execution and invalid-proposal recovery; P55 owns
membership/backing transitions; P56 owns complete SDK/event/PG/UI parity and signed
larger-cohort acceptance. Only P56B can enable the expanded local financial profile.


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
Each begins with schema u16=8 and a scoped revision u64. D84 deliberately supersedes
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

Canonical maker registrations and funding publishers are clearing-owned schema 8.
Maker-owned curve and price accounts use schema 5. Their exact layouts are in
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
