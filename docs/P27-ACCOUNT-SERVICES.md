# P27 — account services and finalized reconstruction

P27 implements A32/G21 on the qualified schema-3 local artifacts from P26. It
preserves the financial contract and leaves V1/V2 interfaces intact. P28 owns the
browser and sustained concurrency qualification. P15B/P16B remain external and
24-hour endurance remains Deferred.

## Implementation sequence

1. Authenticate every schema-3 critical event; rebuild venue, custody, safety,
   registry, portfolios, roots, markets, ledgers and maker registrations in the
   existing append-only PostgreSQL journal. Reconcile finalized account bytes and
   token backing before making a projection available. Reuse journal/retry transport,
   not V2 group accounting or its ordinary exit certificate.
2. Add a version-3 public deployment contract and direct account-aware SDK. Pin
   qualified executable identities, genesis and initialization anchor. Preserve
   original signed bytes/signatures for ambiguous submission recovery; cancellation
   and admissible funded withdrawal must work without the venue API.
3. Integrate maker, source/funding, order, settlement and risk workers. Derive
   dependencies from the account and operation; never make the event sequence an
   ordinary intent prerequisite. Use explicit operator budgets and durable jobs.
   Implement an untrusted exact rate proposer from current frozen chain inputs;
   it cannot supply authoritative payouts or depend on retained acceptance dumps.
4. Qualify actual Surfpool/RPC/WS/PostgreSQL lifecycles, fresh replay, raw-byte
   reconciliation, failed-transaction exclusion, lost acknowledgements, worker and
   indexer restart, and direct cancellation/exit. Record new sources and evidence;
   P26 counts do not qualify P27.

## Projection and intermediate states

Amounts and signed fractions are decimal strings in JSON; bytes are hex. Cash,
market settlement pools, insurance, retained fees and fee carries remain separate.
The registry supplies the complete stable root order. Events are authenticated CPI
payloads, not log messages; reverted events never enter the economic projection.
Unknown critical schemas, sequence gaps or immutable identity changes fail closed.

Default has a compact event-derived financial view, not a fabricated copy of the
wide arithmetic work account. Frozen rows retain original cash and claims. Partial
Apply changes individual roots while the custody total and pools retain their
frozen values. Reconcile that mixed root sum against remaining original cash plus
applied cash; only the completion event adopts the new aggregate buckets. Inspect
the canonical resolution header/pages against the event-derived fields. Wide
registers and DFS scratch are solver continuation state, not spendable balances.

Every RPC reconciliation chunk includes custody (the global discovery sequence)
and compares the same full custody bytes. A changing sequence requests backfill;
it never silently compares accounts from different economic snapshots. Unsequenced
permissionless precreation of resolution storage is not a financial transition.
Market payout certificates and terminal retirement proof remain distinct; neither
is an ordinary own-cash withdrawal prerequisite.

## Acceptance and limits

All four steps now have pinned acceptance in [the P27 report](evidence/P27.md).
P27 remains Review until integration. Intermediate decoder/projection tests and
retained-history checks only validate their own layer.
Use focused regression tests and fresh integration traces; broad inherited suites
remain in scoped CI. Local synthetic sources/internal makers are labelled as such.
No new devnet or funded deployment, paid service, outreach or external hedge is
authorized by this phase.


## Direct SDK checkpoint

`AccountUserClient` authenticates version-3 local configuration, the initialization
anchor/genesis and qualified artifact set. `readAccountSnapshot` accepts one or two
selected roots. It discovers their immutable portfolios, then reads all financial
state in one 12/13-account batch for the common same-portfolio cases. It does not
read unrelated roots or require a registry-wide exit certificate. A minimum context
slot prevents backwards RPC reads. The atomic instruction still checks current
whole-account funding, risk, reservations, source restrictions and held-window
solvency on chain. A cash balance alone is not an admission promise.

Owner exits use virgin-custody or guarded funded instructions as appropriate;
recovered/terminal exits retain their source-independent contract. Delegated
cancellation remains account-scoped. Explicit netting binds the source market's
canonical backing certificate and registry; the SDK cannot bypass that proof.
Pending signed transactions retain their exact bytes/signatures through shared
wallet recovery. The initial direct checkpoint does not yet qualify routes,
current risk previews or worker coordination; WORKLOG records completion evidence.


## Account risk and routing checkpoint

V2/V3 SDK wrappers share schema-neutral balance and allocation arithmetic, with
separate deployment/authority policies. The V3 balance preview uses funded cash
plus negative claims across both markets, current funding, additive requirements
and refreshed order reservations. Positive unpaid claims provide zero credit.
Indicative own-cash headroom is also capped by all four mixed held-funding corners;
current admission and held-window nonnegative equity are separate checks. Missing
required sources, pause, freeze or an unsettled terminal account produce no
indicative exit capacity. The field `withdrawableCash` remains null: only the
actual atomic instruction and its current simulation determine admission.

`readAccountTradeSnapshot` first discovers immutable maker capital/config/code
keys, then reads all trader, portfolio, market, ledger and selected maker financial
state in one RPC batch (24 accounts for the common three-portfolio fixture; bound
32). It verifies schema, owner, canonical PDAs, isolated maker capital, executable
ProgramData binding/hash, configuration identity and current epoch synchronization.
The ordinary cash snapshot remains one/two roots without maker dependencies.

`buildAccountRoute` reuses exact A/B allocation and stored-order prefix economics.
Its signed message binds root nonce/state version, safety/venue terms, selected
market terms/config and maker epochs/consumed prefixes. It carries neither a
historical oracle observation nor a global discovery sequence. Clearing checks
current relevant sources and whole-account health at execution. Confirmed quotes
are labelled provisional; finalized journal/cash facts retain their own boundary.
No instruction supplied by an HTTP quote is trusted as execution authority.


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
evidence dumps. Focused pure/consumer tests are separate from the still-required
fresh durable worker upload/default/restart acceptance.


## Durable execution boundary

`AccountExecution` reuses the immutable signed-wire queue and schema-3 journal with
qualified genesis/anchor/artifact binding. Public ingress accepts one measured
wallet action with explicit zero priority price, one wallet signer and exact
schema-decoded venue/actor/owner accounts. It does not accept arbitrary operator
instructions or supply sponsorship. Generated parsers avoid V2 account-index
assumptions in V3's differently ordered instruction contexts.

Nonexecution proof is limited to monotone root state versions, market observation
sequences or maker-sync quote epochs, with canonical PDA/schema checks after
finalized blockhash expiry. Unchanged authority says nothing about a hidden failed
transaction fee; its budget reservation remains until actual finalized history.
Actions without a signed pre-state stamp retain no inferred proof. All retries of
pending or unknown outcomes use the same committed bytes and signature. Worker
lamport budgets and heartbeat records are market/maker-specific; financial worker
wiring and actual process/fault qualification remain separate unfinished work.


## Worker operation

Run `account-executor-main.ts` for signed queue execution and
`account-worker-main.ts` with `RIVALT_ACCOUNT_ROLE=maker|funding|orders|settlement|risk`,
explicit `RIVALT_RUN_ID`, local RPC/database and a mode-0600 `RIVALT_SIGNER_PATH`.
Maker and funding roles require `RIVALT_MARKET_INDEX=0|1`; maker additionally
requires `RIVALT_MAKER_ID=0|1`. Risk receiver consent requires the receiver owner
signer plus explicit `RIVALT_RECEIVER_MARGIN`. No receiver is inferred. The
version-3 service API is separate from finalized indexing, defaults to loopback
port 18093 and exposes `/v3/quote`, `/v3/submit`, original submissions and operator
budgets/heartbeats. Public quotes remain provisional.

Discovery uses finalized membership/orders, followed by current authenticated
selected-root snapshots. Sampling records loss of source/maker coverage too;
heartbeats do not suppress restrictive source transitions. Sampling is not an
ordinary V3 quote barrier. Maker publication and clearing sync stay separate
transactions. Settlement requires funded whole-account gross debt coverage for
collection, or a current complete selected-market backing certificate for gains.
It never automatically nets an owner's opposite closed claims.

Risk workers probe at most two discovered exposed roots per iteration using actual
current sources, then consider a configured consenting receiver and strict
post-fee progress. Frozen work resumes the on-chain page/upload/order/round cursor.
Ordinary quote/cash authority never depends on this complete-cohort traversal.
Unchanged-stage expiry is not invented as a resolution nonexecution proof.
Recovery observations are bounded to eight original attempts per epoch; explicit
authority resume/reactivation/emergency freeze/retirement are outside automation.
The live `--workers` qualification owns new process/fault evidence; implementation
and unit checks alone do not close A32.


Completion events encode the two market fee carries as fixed bytes. The journal
represents those bytes as hex; projection explicitly decodes each byte to its
numeric market carry and validates the modulo-four bound. A later full snapshot
must never be relied upon to repair intermediate financial reconstruction.
