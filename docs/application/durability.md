# Finalized state and durable execution

## Projection and intermediate states

Amounts and signed fractions are decimal strings in JSON; bytes are hex. Cash,
market settlement pools, insurance, retained fees and fee carries remain separate.
The registry supplies the complete stable root order. Events are authenticated CPI
payloads, not log messages; reverted events never enter the economic projection.
Unknown critical schemas, revision gaps or immutable identity changes fail closed.

Default has a compact event-derived financial view, not a fabricated copy of the
wide arithmetic work account. Frozen rows retain original cash and claims. Partial
Apply changes individual roots while the custody total and pools retain their
frozen values. Reconcile that mixed root sum against remaining original cash plus
applied cash; only the completion event adopts the new aggregate buckets. Inspect
the canonical resolution header/pages against the event-derived fields. Wide
registers and DFS scratch are solver continuation state, not spendable balances.

RPC reconciliation reads the complete entity revision vector and financial bodies
twice across bounded chunks. A relevant advance requests tail catch-up; it never
silently combines incompatible states. Storage precreation has a zero-payload
scoped transition, so its creation remains part of authenticated history.
Market payout certificates and terminal retirement proof remain distinct; neither
is an ordinary own-cash withdrawal prerequisite.


## Durable execution boundary

`AccountExecution` reuses the immutable signed-wire queue and schema-5 journal with
qualified genesis/anchor/artifact binding. Public ingress accepts one measured
wallet action with explicit zero priority price, one wallet signer and exact
schema-decoded venue/actor/owner accounts. It does not accept arbitrary operator
instructions or supply sponsorship. Generated parsers authenticate the exact current instruction account ordering.

For inherited account actions, nonexecution proof is limited to monotone root state versions, market observation
sequences, with canonical PDA/schema checks after
finalized blockhash expiry. Unchanged authority says nothing about a hidden failed
transaction fee; its budget reservation remains until actual finalized history.
Liquidation jobs retain the consenting receiver’s signed pre-state version:
on-chain execution checks it and advances it, so an unchanged canonical receiver
after finalized expiry proves no liquidation effect. An advanced/missing receiver
remains unresolved. Permissionless freeze/default/recovery jobs have no invented
version proof. Actions without a signed pre-state stamp retain no inferred proof. All retries of
pending or unknown outcomes use the same committed bytes and signature. Worker
lamport budgets and heartbeat records are market/maker-specific; actual process/fault qualification is recorded in validation.



## Bounded dispatch and persistent account reservations

P40A gives each executor two concurrent RPC lanes, retaining a 32-original due-work
scan and spare capacity in its four-connection pool. Admission uses the complete
static v0/v1 signed-message read/write set, including fee payer, program accounts
and promoted writable aliases. ALT messages remain rejected. Read/read sharing is
allowed; W/W and both W/R directions conflict. Authority metadata is not a substitute
for the signed message's resource set. This is service scheduling, not a validator
throughput or on-chain financial admission change.

`service_dispatch_contract` binds each run to dispatcher version 1.
`service_dispatch_access` stores `(run_id, request_id, address, writable)` with a
foreign key to its immutable original. The same request cannot have two workers:
a per-original PostgreSQL session advisory lock spans the pre-send commit and RPC
step. Short shared/exclusive transaction advisory locks make conflict checking and
resource reservation atomic across executors. Resource rows commit **before** any
broadcast and survive process/connection death. Unrelated originals can progress.
Conflicting attempts defer their due time without spending an attempt or changing
the original's economic status; transport failures never cancel independent work.

A send acknowledgement does not release access. Finalized success/failure releases
resource reservations in the same transaction as its receipt and actual fee.
Authenticated nonexecution after finalized expiry also releases resource access,
but keeps the unknown fee reservation. Such an original is never broadcast again,
even if a later RPC claims its blockhash valid. Absent proof retains access and can
block that resource indefinitely; another independent resource can still progress.
Reservations apply within one run/database. Direct submissions or separate queue
deployments remain governed by on-chain locks and checks. Two executor processes do not each get to send the same active original.

Deployment is additive SQL, with no account/event/financial wire change. Stop old
executors first. An existing run without dispatcher version 1 is admitted only if
it has no pending/unresolved originals; drain those with its previous pinned
executor. Never manufacture leases or assume old ambiguous originals were not sent.
Expired-proven originals retain their unknown fees. Existing journal identities and
original wires are preserved; P40B owns the separate fresh event-domain migration.

## Maker expiry proof

New profile-4 reprice originals retain the registered maker program, registration,
price PDA and expected sequence. After finalized blockhash expiry, one finalized
RPC batch at or after that expiry fence must authenticate both account owners,
exact schema/discriminators/sizes, registration/venue/program bindings and canonical
registration/config/price addresses. Only an unchanged monotone price sequence
proves that the reprice did not apply. Runtime artifact verification remains required.
Missing, advanced or malformed state keeps the original unresolved.

A proven unexecuted original permits a separately reserved retry under the existing
operator retry limit. Its immutable wire/signature and unknown-fee reservation stay
in PostgreSQL. Only an independently fetched finalized transaction releases that
reservation; budget exhaustion and handover can still wait for historical fees.
Previously persisted null-authority originals are not rewritten or retroactively
proved. This changes availability, not fee accounting or financial authority.


## Untrusted resolution proposal

The service proposer uses exact bigint rational arithmetic and enumerates the
bounded two-market capped-flow branches to select the greatest fixed point. It
outputs only the 1,560-byte numerator/factor encoding and hash for the current
on-chain evaluation. Clearing remains authoritative for complete-row verification,
insurance clipping, flow planning, remainder order, circulation and payout.

Inputs come from the current canonical frozen header/registry/pages in one final
RPC batch. The reader verifies the frozen epoch/safety/terms, complete stable
membership and row order, cash/claim/collection aggregates and the on-chain common
denominator. A competing progress transition cannot silently change the proposal's
stage identity. The runtime has no dependency on Python reference code or retained
evidence dumps. Unit/consumer tests and actual durable worker acceptance remain distinct evidence layers.



## Journal, reports and checkpoints

Subscribe through standard RPC/WS for discovery, then fetch original signatures
and finalized transaction/account bytes. Discover complete finalized blocks, deduplicate stable
signature/instruction/event identities, retain failed transaction logs but apply
no reverted events. Projection and checkpoint commit atomically in PostgreSQL;
crash/rollback/disconnect recovery resumes the durable checkpoint. Unknown critical
schemas, skipped revisions, bad CPI identity, duplicates with conflicting bytes and
unexplained balances fail readiness. Fresh database replay must match incremental
reconstruction. A chain reset is a different genesis, never a continuation.

RPC reconciliation compares financial accounts, canonical registry/registration
and publisher configuration as well as actual token backing. Maker price accounts
are provisional unsequenced external inputs, not invented clearing events. Decode
fixed-byte fee carries explicitly as per-market modulo-four values; a later full
snapshot cannot excuse a corrupt intermediate projection.

Funding originals and content-addressed ordered input rows commit in one SQL
transaction before broadcast. Store shared code bytes once by digest, preserve
append-only provenance, and verify digest/calculation against persisted signed
reports on insert and read. The report sequence persists across publisher rotation;
observed time/slot fences advance with authoritative Clock. Independent financial
replay checks each trader root so offsetting errors cannot hide in venue totals.

## Budgets, retries and operator handover

Keep exact signed original/last-valid-height, outcome classification, attempts and
reserved lamport budget before broadcast. Retry pending/ambiguous outcomes with
the same wire/signature. Finalized failure can permit a fresh bounded attempt;
finalized expiry plus the applicable authenticated nonexecution proof may permit
one while retaining unknown-fee reserves. Actions without an applicable proof
remain unresolved. Proof of no economic effect is not proof of zero fee.

Known fees are read from actual finalized receipts. Collateral, settlement,
insurance and retained trading fees never silently pay worker network costs.
Per-role/run/market budgets and retry bounds are explicit, not infinite retries.
Repeated history gaps can exhaust a budget and block handover even after a
separately reserved retry succeeds. Old null-authority rows are not retrofitted.

Stop the old role, resolve originals and fees, authorize the new key on-chain,
then perform explicit budget handover. Verify the new authority, retain lifetime
cap/spent values and refuse unresolved reservations. Ordinary startup rejects a
changed payer; rotating a key cannot reset its allowance or transfer a budget.

## Worker authority

Maker updaters only reprice; publisher workers only submit bounded reports. Orders
execute existing durable authority; settlement collects fully covered gross debt
or pays through a valid selected-market certificate. It never silently nets an
owner's opposite claims. Risk discovery considers at most two exposed roots per
iteration, uses a configured consenting funded receiver and post-fee progress.
Frozen work resumes chain stage/cursors; untrusted rate proposals grant no payout
rights. Recovery observations are bounded to eight originals per epoch.
Authority-only resume/reactivation, emergency freeze and retirement are explicit
operator actions, not automatically inferred from healthy observations.

## Stored schema identity during source renaming

Current Rust/IDL/SDK symbols have canonical names. Persisted journal/API event tags
retain their existing `V3`/`V4` suffixes as schema identities; their source decoder
mapping is explicit in `account-events.ts`. Do not relabel historical rows or
original signed bytes. Generated decoder names and stored event tags are different
interfaces. Existing HTTP versions, numeric layouts and deployment checks remain.

## Scoped-history successor contract (P40B)

This is the implemented fresh-domain journal contract; exact acceptance pins and
remaining limitations are in [validation](../operations/validation.md).
The account kinds/layouts are in [accounts](../clearing/accounts.md#scoped-history-contract-p40b).
New journal bindings use schema 5 and fresh databases. Public deployment configuration
must explicitly bind account schema 5; transport/profile names alone cannot select
an incompatible decoder. Historical schema-4 databases/originals retain their pinned
client and are never relabeled by startup.

Every successful clearing invocation emits one final `AccountTransition` CPI envelope.
Its discriminator is SHA-256(`event:AccountTransition`)[0..8]. Ordered Borsh fields:
`schema_version:u16=5, venue:Pubkey, domain:[u8;32], slot:u64,
instruction:[u8;8], payload_count:u16, reads:Vec<ScopedRead>, writes:Vec<ScopedWrite>`.
`instruction` is the executed public entrypoint's discriminator, not caller input.
`ScopedRead` is `account:Pubkey, kind:u8, revision:u64` (41 bytes).
`ScopedWrite` is `account:Pubkey, kind:u8, before:u64, after:u64` (49 bytes).
The envelope is 100 bytes plus its rows, at most 32 entities and 1,668 bytes; keys
are unique across both vectors, and at least one write is required. Read revisions
are positive; writes are checked consecutive increments. Creation is 0→1 only.

Financial payload events remove their global `sequence` field and use canonical
`event:<source name>` discriminators. Their ordering within a clearing invocation
comes from authenticated CPI positions, not a writable account. Count all actual
payload emissions, including resolution row/completion/progress combinations;
require exact `payload_count` (0–4 currently). Storage precreation now has an
envelope with zero financial payloads. Missing, duplicate, trailing, unknown or
foreign-frame payloads reject the whole candidate. The self-event instruction is
not a second financial invocation. Authenticate the program/event PDA and invocation
tree before decoding; failed transactions retain raw logs but produce no effects.

The transport identity is `(genesis, signature, outer instruction, clearing invocation,
payload ordinal)`. An envelope and its financial payloads are one transition; all
transitions in one signed transaction apply atomically, including multiple instructions.
Whole transactions, not individual account changes, are the ordering units.

For each entity, a writer follows its predecessor revision; a reader at r follows
the writer producing r and precedes the writer consuming r. These read-before-write
edges prevent a snapshot reader from being reordered after its inputs change.
No external reader may interleave intermediate revisions of one atomic transaction.
Canonical block/transaction position breaks independent ties; slot alone is not a
total order. Competing writers, missing predecessors, cross-entity cycles and an
edge from a future finalized slot fail closed. Reordered delivery is acceptable
only when this exact dependency graph reconstructs a valid complete prefix.

Use a fixed finalized block fence and complete ordered transaction lists with
recorded block hashes, parent links and signature-list digests. WS/address histories
remain discovery hints; neither a repeated page nor a stable head signature proves
that an independent entity was not omitted. Resolve actual loaded account keys when
filtering venue transactions, and authenticate all relevant CPI invocations. A
missing advertised block/transaction or inconsistent same-slot discovery cannot
advance the checkpoint. Bound each recovery batch to 4,096 envelopes and expose
backlog/limit failures. This is a local engineering limit, not a venue TPS claim.

PostgreSQL stores immutable blocks, transactions, envelopes/payload bytes and entity
revisions. Projection, local outbox cursor and complete-block checkpoint commit in
one SQL transaction. The cursor is explicitly off-chain progress, not an on-chain
financial sequence or signing guard. Duplicates require byte-identical originals;
conflicting bytes or failed-effect attempts roll back the candidate. Recovery and
fresh replay must produce identical projections and revision vectors.

Reconciliation compares account kinds/revisions and their financial values, with
membership fenced for complete discovery. A relevant advancing revision requests
bounded tail catch-up; an unrelated entity must not restart all historical discovery.
No mixed RPC chunk is presented as one simultaneous financial snapshot. Any sampled
comparison ahead of the journal remains pending until the corresponding atomic
transition is reconstructed; no stale proof authorizes a payment. Source accounts
and external maker prices remain separately authenticated inputs. P42/P44 own
continuously active certificate and performance measurements.

The active journal uses `scoped-history.ts` with authenticated on-chain envelopes.
Ordering unit tests supplement ABI/SDK parity, actual same-slot/nested-CPI outcomes,
RPC reconciliation, crash recovery and fresh PostgreSQL replay; they do not
substitute for those integration layers.

`scoped-events.ts` supplies the separate schema-5 transport gate: reconstruct
financial invocation ancestry from compiled outer/inner instructions and mandatory
stack heights, resolve loaded keys and verify write privileges. Financial payloads
belong to their immediate clearing frame; the final footer binds that frame's
actual instruction, slot, domain and count. Unknown payload tags and instructions
fail closed. This is the active schema-5 decoding gate; schema-4 journals remain
bound to their historical clients.

The schema-5 candidate now uses SQL journal format **2**, which refuses retained
format-1 databases. `getBlocks` plus complete `getBlock` bodies establish a fixed
finalized fence; parent slot/hash links detect omitted produced blocks, and each
stored block preserves its ordered signatures and their digest. A separately
requested signatures-only block must agree exactly with the full body and its
header; missing transaction records reject. WS remains a hint.
Projection orders whole signed transactions by scoped causal dependencies. A
second account pass fences every entity revision before combining RPC chunks.
Only a relevant advance permits bounded tail catch-up (three extensions).

SQL independently decodes the supplied block transactions before accepting their
envelopes, then commits blocks, original transactions, envelope/payload bytes,
entity revisions, financial projection, outbox and fence together. Exact repeated
blocks are checked against retained bytes without applying their effects again.
`state.sequence` / the SQL event `sequence` column now mean a **local payload
cursor** only; no such field is injected into canonical event data. Zero-payload
storage transitions advance revisions without creating a financial payload.
The footer serializes borrowed captured rows without allocating separate read/write
vectors. Two-row default Apply likewise borrows its full root payload. Their bytes
must match the owned IDL types exactly; this preserves the 32 KiB default heap and
does not change revision, event ordering or financial validation rules.
The public API labels this `asOf.cursor` and `cursorScope: local-payload-stream`,
and exposes the finalized `blockhash`; it does not label a block hash a signature.
Maker economics inputs use version 5 with `opening.cursor`, `closing.cursor` and
an explicit `cursor` alongside each SQL-derived event payload. Contiguity is a
local journal export check; it is not a field supplied by the on-chain event or
a substitute for the journal's complete-block and entity-revision authentication.
These are implemented local contracts; [validation](../operations/validation.md)
records the separate compiled, signed and database evidence.
