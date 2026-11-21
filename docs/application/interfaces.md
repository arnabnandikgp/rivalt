# SDK, API and wallet contracts

## Account-scale candidate interfaces

The schema-10/profile-6 account runtime uses stable u64 identities, Registered /
Financial / Retired lifecycle states, paged membership and maintained backing.
The selected artifact uses a fresh domain/database; current codecs cannot
reinterpret retained schema-8 deployments. Qualification and remaining limits are
recorded in STATUS and validation, separately from source implementation.
Member IDs/cursors are decimal strings in JSON and bigint internally; u32
portfolio/child keys have explicit bounds. Never cast a member ID into a JS number
or confuse a page slot with a global ID.

Owner discovery reads the portfolio and its nine currently supported child PDAs
in one finalized RPC batch. It validates the complete active-child count, canonical
keys, owner/domain, schemas, generations and distinct stable identities. Returned
retired tombstones reserve their child slots permanently. Registered roots are
identity/lifecycle facts; financial snapshots still require Financial roots.
The owner namespace policy remains separate from the venue's scalable member index.

The published API lists active roots and retired children separately per portfolio.
Account reads distinguish Registered, Financial and Retired; a frozen Financial
account also includes the source epoch/stage, adopted plan stage/cursor and its
actual Apply status. No partially applied root becomes withdrawable until complete
resolution. A missing root is distinct from a permanent tombstone.

Default workers follow authenticated epoch/stage/cursors and upload untrusted rate/
order proposals in bounded transactions. Retry the same persisted signed original
after ambiguity, and reconcile its actual finalized transition before new work.
Neither a solver's model nor a local database can declare a root applied or a
creditor paid. P56A1 owns durable default; P56A2 owns wallet/discovery integration.
The selected account-scale deployment integrates these checkpoints; validation
records its actual populated acceptance and remaining operational limits.

## Explicit deployment identity

`AccountUserClient` validates version-4 local configuration, immutable artifact
pins, genesis and the actual initialization signature/hash. Configuration includes
RPC/WS URLs, venue, mint and domain. Never infer a deployment from a port or retained
acceptance dump. The fresh RC2 deployment requires explicit
`accountSchema: 10`, `deployment: "selected"` (or the retained explicit alias
`"account-scale-candidate"`), transport `version: 4` and the local profile;
missing/old schema or deployment selection rejects. Clearing-owned decoders use schema 10 / on-chain profile 6,
while maker-owned curve/price schemas advance to 5; quote/report protocol versions remain unchanged. This is a fresh-domain/client change,
not permission to upgrade retained state or replay old signed originals. [Deployment](../operations/deployment.md) owns
artifact and key configuration; [routing](../liquidity/routing.md) owns snapshots.

Minimum lifecycle builders distinguish registration, Financial activation,
deactivation and permanent retirement. Namespace seeds are u32; member IDs remain
u64/bigint. `readMarginMembership` authenticates the canonical member page and all
fifteen revision-guarded index nodes for entry/exit. Empty retirement does not need
funded index/storage accounts. Owner discovery reads the current bounded child
namespace and validates tombstones rather than interpreting `activeChildren` as a
bitmap. Ordinary money/trade snapshots require Financial roots with nonzero
activation generation. These are client checks; landed clearing admission remains
authoritative. Activation plus deposit is atomic; admission failure or a failed token transfer
rolls back both. Recovery capacity and member/index storage must be provisioned
with an explicitly identified SOL payer before admission; this wallet action
does not silently pay operator storage rent. Deactivation requires no cash,
claims, reservations, positions, orders or live delegate. Retirement is owner
signed, permanent, and refunds only excess account rent. Historical counters
are preserved rather than erased to manufacture emptiness. STATUS records the
actual wallet/UI acceptance scope.

The shared SDK deployment table binds client, service and indexer to the exact
schema-10/profile-6 executable hashes. `selected` is the normal launcher binding;
`account-scale-candidate` is an explicit alias for the same qualified bytes, not a
caller-selected hash or historical decoder. Default launchers use
`.local/anchor-rc2/current`; an explicit artifact directory must pass the same hash
checks. No existing journal or signed original is relabeled during promotion.

Public amounts are integer decimal strings with units; internal arithmetic uses
bigint. Never serialize a monetary bigint as an IEEE-754 number. Keep cash,
unpaid claims, risk equity, reservations, fees and insurance separate.

## Quantity contract (P49)

Immediate requests, stored order totals and maker side depth share the existing
100,000,000-lot financial domain; signed positions and aggregate gross exposure
retain their separate existing checks. `/v4/quote` accepts canonical positive
decimal strings through that bound. The UI converts BTC/ETH exactly and rejects
larger quantities before requesting a quote. Fee budgets are signed by the owner
or an authorized, unexpired delegate:
expanding the input domain to the existing cash bound does not change 2 bps fees.

Order and liquidation workers first try the remaining quantity, then halve on
size-dependent unavailability, for at most 27 probes across the numeric domain.
The order worker stops probing that order for the current pass if its required
market source is unavailable, quote construction throws `AccountQuoteUnavailable`,
or enqueue preflight simulation fails. A later pass can retry. A `quote-expiring`
result still permits smaller probes because selecting different makers can change
route expiry; depth/health and search-budget refusals also permit smaller probes.
Each probe still needs full quote/admission or successful liquidation simulation,
and only one accepted action is durably queued. This operational schedule is not an exhaustive
proof that no smaller admissible size exists. Persistent send/fee budgets and
unknown-original recovery are unchanged. Router search work remains independently
bounded and explicitly reports exhaustion without a transaction.

## Direct accounts and actions

The shared account snapshot discovers immutable portfolios and then reads the
selected one/two roots and required financial state in one coherent batch.
Minimum RPC context prevents backwards reads; ordinary cash reads do not load
unrelated roots or maker books. Account/root identity and the complete relevant
position/order dependency set are authenticated before building a transaction.
Liability-ledger dependencies are derived separately from nonzero quantity/claim
slots and requested pool effects across every touched root. Empty order-only slots
do not invent debtor backing; omitted markets/ledgers never reset projected state.
Custody stores allocated tokens, not cached total cash. A selected-account preview
cannot assert a complete venue cash sum; full reconciliation enumerates every root.

Funded withdrawal and cash allocation perform full own-account checks atomically
on-chain. The SDK cannot bypass a source-market backing certificate for explicit
flat netting or gain payment. Direct cancellation and admissible withdrawal must
work with the venue API stopped. Recovered/terminal cash exits preserve their
source-independent flat/no-claim rules.

Current balance previews include both funding checkpoints, all negative claims,
per-position IM and refreshed orders, with zero positive unpaid-profit credit.
Indicative cash headroom is capped by all mixed held-funding corners. Missing
required sources, pause/freeze or unsettled terminal state supplies no admission
promise. `withdrawableCash` remains null; only the actual instruction/current
simulation determines admission. Never label unpaid marked P&L as cash.

## Quotes and signed ingress

`/v4/quote` exposes selected maker instances, gross/all-in values, expiry, source
freshness and classified unavailability. Quote validity is provisional; an HTTP
response is not instruction authority. Rebuild and authenticate instructions in
the SDK with user size, side, limits, fee cap and exact account bindings. Current
price may improve/change within signed bounds; structural-epoch changes reject.

An unfinished exact route search reports `liquidity-search-budget-exhausted` with
bounded search metrics, distinct from insufficient depth or failed account health.
It supplies no provisional winning allocation or transaction to sign. Direct SDK
callers receive `LiquiditySearchLimitError` for the same condition.

Public submission accepts one allowlisted wallet action, or exactly activation
followed by a positive deposit into the same root. Both instructions must bind
the same owner, venue, margin, safety and event authority; activation supplies
exactly fifteen writable index nodes. No arbitrary financial batching is accepted.
Every envelope has one wallet signer, exact decoded identity and explicit
resource/zero-priority policy (400,000 CU for membership/cash, 800,000 for routing). No arbitrary operator instruction or implicit sponsorship. The executor
stores and submits the exact signed original; shared account contexts are parsed
with the correct current IDL, never legacy account-index assumptions.

Profile-4 signing requires support for both v0 and v1. Preserve exact payer,
blockhash, account privileges, intended instructions and resource policy returned
by the wallet. A modified financial action cannot be broadcast as the user's
reviewed transaction. Instruction-prefix decoding behavior does not remove
signature or economic-intent authority checks.

## UI obligations

Connect wallet → portfolio/account → deposit → quote/review/sign → receipt → manage
positions/orders → close → eligible settlement/withdrawal. Portfolio and subaccount
IDs refer to real PDAs; portfolio metadata itself has no funds. Account mode and
isolated market cannot change after registration.

For a flat position with a positive claim, the Positions panel uses
`closedGainStatus` from the SDK. It shows whether ordinary payment is suspended,
the balance is below one payable atom, the settlement pool is empty, the pool
covers part of the claim, or the claim awaits verified payment. Pool cash is
shared. A payment becomes funded account cash only when clearing applies it.

Show pending, confirmed and finalized separately. Submitted does not mean filled;
a triggered stop authorizes an attempt and can fail liquidity/price/risk checks.
Keep exact original signatures/wire for reload and direct RPC recovery. Account,
wallet, chain and configuration changes invalidate incompatible prepared state.
Account discovery may identify a newly selected account before its financial
snapshot arrives. Render that identity without attempting a balance calculation
against the previous account's snapshot; keep financial actions disabled until
the snapshot contains the selected root.

Separate actual fill candles and execution VWAP from independent risk/index prices
and publisher-attested funding impact. Expose source/quote/publisher age and reason
for unavailable quotes; mark reports superseded after authority control. Derived
books are snapshots, and a daemon heartbeat does not refresh on-chain prices.

Never describe insurance as guaranteed profit backing, reference makers as
independent operators, or assumed hedges as observed costs. Instrumented local
Wallet Standard browser evidence is distinct from external-provider compatibility.

The schema-10 candidate retains API version 4 and reports `accountSchema: 10`
in configuration and API envelopes. Older artifacts remain separate. `asOf.cursor`
is the journal-local financial-payload cursor, `asOf.cursorScope` identifies that
scope, and `asOf.blockhash`/`slot` identify its complete finalized block fence.
Scoped revisions authenticate protocol history; UI pagination cursors do not.

P52 API reads and event/trade pagination use only the reconciled published state
and cursor, even when durable history has advanced farther. `/ready` distinguishes
`covered` slot/cursor from `reconciled` slot/cursor/capture time. Readiness requires
an error-free publication less than ten seconds old and a connected indexer.
Coverage alone cannot refresh financial facts or worker discovery. Pending original
execution uses immutable deployment identity independently of this read fence.


## Shared price-policy literals

The SDK exports `price-policy.ts`; its constants are generated from the Rust
financial core by `python3 ops/generate-price-policy.py`. `pnpm generate` and
`pnpm generate:check` include this step. Financial values are BigInts, serialized
as decimal strings; policy version and source exponent are integer metadata.
Funding source decoding/search, maker/routing bands, risk fallback prices and
trader price entry use these shared definitions. Units and approved policy-2
activation rules live in [risk and resolution](../clearing/risk-and-resolution.md#versioned-price-policy-p53a).
The generated values describe the pinned program; a client constant grants no
on-chain authority and cannot expand accepted prices by itself.

`allocateFundingSide` accepts three canonical `FundingCurve` records (shape,
anchor, inventory and directional consumption), replacing the old quote-callback
input. It performs no cash/reservation/health checks. `readFundingReport` derives
these records only after authenticating the complete frozen maker snapshot; the
low-level function itself is not an authentication boundary. Arbitrary/disconnected
quote callbacks are unsupported by its convex-search contract. The optional
`FundingSearchMetrics` records distinct quantity evaluations and compositions;
report wire format, publisher authority and actual trade admission are unchanged.

## Aggregate fee receipts

For the D137 local artifact, `/v4/trades` returns one `LiquidityRouteFeeRecorded`
per fill. Its signed payload carries the whole fee. The API adds
`reconstructedFeeSplit` alongside that payload with insurance and retained atoms
as decimal strings and the new carry as an integer from zero through three. A
page can start mid-market or just after a checkpoint. The indexed pre-fill
remainder is derivable from the last classified carry and the cumulative pending
fees in that receipt. `/v4/events` also exposes `MarketFeesClassified`, the
on-chain transfer into insurance. Summing both as revenue would count the same
collection twice. The SDK's `decodeFeeLedger` separates escrow from spendable
treasury cash on this artifact.

## Reading current market gross

Select `bounded-market-candidate` on the qualified local artifact. An on-chain
caller can invoke `read_market_gross` with the venue, market and all three
canonical maker registrations, then check the return program and decode exactly
eight bytes as a little-endian u64. An RPC client can call
`readMarketGross(rpc, venue, marketIndex)`. The SDK authenticates all five
accounts from one finalized `getMultipleAccounts` response and returns the
gross and its context slot. These reads require no signer at the instruction level.

The indexer compares the derived capacity total against finalized market
events during reconciliation. The pure read produces no financial event or
revision. Both source discovery and the final funding snapshot require the
account layout selected by the caller. [Layout and identity](../clearing/accounts.md#bounded-market-gross-on-the-local-candidate).

### Derived market values for the read-only route

With the candidate's explicit `market-lanes` layout, wallet and trade snapshots
include the canonical registrations for both markets in the final account batch.
Funding publication reads the registrations for the reported market. The SDK
uses the newest materialization by slot in the same observation and the
corresponding premium to calculate earned funding. It obtains current gross lots
from reserved capacity. Reading the Borsh market prefix alone returns the last
stored checkpoint.

`MarketLaneFilled` carries the unchanged market snapshot and the earned
timestamp and index. The journal derives gross from actual position changes,
verifies funding against the observation, and keeps the stored fields for
revision checks and finalized RPC reconciliation. `MarketCheckpointed` verifies
these derived values against the newly written market account. Both route
events appear in the trade feed. Runtime selection remains limited to explicit
local qualification.

## Local joint recovery selection

`boundRecoveryReceipt` decodes the completed selection from the prepared
settlement. The SDK returns null before binding. After binding it exposes
the search address, rank, verified schedule count, actual insurance use and
each member’s separate claim changes and signed cash movements as exact
integers. An explicitly sponsored local risk worker can open, capture, verify,
seal and bind a proof through its durable transaction queue. It resumes from
the on-chain cursor after a restart and subsequently drives the existing rate,
application and reconciliation stages.

The [keeper calculation](../../packages/services/src/recovery-witness.ts)
reads the prepared settlement, resolution and eight-member frozen page together
over RPC. Given the ordered debtor/winner pairs calculated by clearing and a
proposed schedule number, it derives both market rates and both rounding orders.
Every candidate retains the debtor cash allocation at freeze. The calculator
rejects a changed episode or revision, a different population, a rate wider
than the wire format, or a settlement needing another insurance pass.
The [native selector](../../crates/default-plan-selection/src/bin/recovery_selector.rs)
derives the eligible pairs and compares schedules using clearing’s financial
rules and the frozen episode’s tie order. The worker reads all eight original
margin histories against their frozen revisions. It identifies the proof
account from the payer, venue, episode, revision and selected rank. Clearing
verifies each proposed exclusion interval. Ties with the incumbent require
individual financial checks. Each signed proof step has its own queue identity.

The original one-page and integrated local search builds accept exactly eight members. Without a
schedule budget, an eight-member freeze continues to accept an external proof
and the risk worker reports `recovery-search-pending`. A different population
returns `recovery-unsupported-cohort`. A search larger than the configured
work budget returns `recovery-schedule-budget` before renting a proof account.
An unresolved financial comparison or unsupported witness also blocks
submission. The schedule budget bounds the search work. The existing operator
fee budget meters transaction fees. On opening a new proof the sponsor also
funds its rent. Restarting with the same payer reuses that account.
The sponsor’s budget cannot change any entitlement.

On the combined local profile, financial instructions that require a market
or ledger checkpoint must follow the matching clearing instructions in the
same transaction. For example, a receiver deposit in trading mode that
supplies both market ledgers includes both fee classifications before the
deposit. A prior transaction in the same slot cannot satisfy that check.
The [combined lifecycle](../operations/validation.md#combined-clearing-lifecycle)
exercises the rejected and accepted forms.

The separate `paged-recovery-candidate` reads the prepared header and
membership pages at a monotonic RPC slot, then checks every original margin
history against its frozen revision. Its SDK subpath `@rivalt/sdk/paged-recovery`
decodes the proof and frozen rows. `pagedRecoveryHeader` gives the bound
schedule and market totals. Each member’s claim changes, market movements
and final cash live on their original frozen page. A reader must fetch every
page of that epoch to reconstruct the distribution.

The paged witness carries one to three insurance-rate triples and one complete
rounding order per market. The worker requests 1.35M CU for a full schedule
comparison if the original or adjusted payout has multiple rounds. Other
individual recovery steps retain their 1.2M budget. Preflight and the
on-chain resource limits still apply. The sponsor funds a 10,240-byte search
account. Supported book shapes depend on the serialized histories, eligible
pairs, packet size and compute cost. [Signed cases and limits](../operations/validation.md#recovery-selection-across-two-membership-pages).

### Ordinary payout on the local parallel-ledger build

The settlement worker identifies the market and ledger layout from the
verified deployment in PostgreSQL. On the combined local build it reads the
market, ledger and all three maker registrations in the same RPC snapshot.
When it submits a loss collection, backing scan or gain payment, it includes
the checkpoints for every market and ledger supplied to that instruction.
If the final scan and payment share a transaction, the worker repeats the
required checkpoints immediately before the payment. The reference for the
on-chain check is [the parallel ledger contract](../clearing/accounts.md).


### Liquidation keeper on the combined local build

The risk worker reads the reconciled Financial membership, rotates through two
accounts with open positions per iteration, then authenticates each target and
its market inputs over RPC. A solvent trader below maintenance first gets a
reduce-only maker route. The SDK prices one- and two-maker allocations within
the adverse oracle bound for each leg, includes the original order dependencies,
and accounts for cancellation of risk-increasing orders. Clearing rechecks the
actual fill, fee, equity and maintenance deficit.

The service tries remaining exposure, successively halved sizes, and maker
price-region endpoints including sums of two endpoints. A pass can miss a
feasible intermediate size. Exhausting the exact allocation search budget stops
the pass. When the size probes yield no admitted route, the worker can transfer
exposure to the configured receiver only with its owner's signature and actual
margin. It caps the requested lots at the first reference-price transfer that
would restore target maintenance and preflights smaller quantities when needed.
It records the original signed bytes and the guarded account version before
broadcast. Subsequent cycles read current health again.

Select `integrated-recovery-candidate` explicitly for the risk or settlement
worker and executor. The risk signer's local SOL pays transaction fees. The
configured `RIVALT_RECEIVER_MARGIN` belongs to that signer and supplies separate
collateral for taking inventory. The reference run can discover and submit a
maker route without a configured receiver. The local launcher can explicitly select the unified successor and leaves receiver configuration explicit. [On-chain liquidation rules](../clearing/risk-and-resolution.md#maker-liquidation-candidate).


The explicit `unified-recovery-candidate` risk worker reads the proof family
from the prepared freeze. On a populated freeze it reads the original rates,
debtor budgets, lot histories and foreign protection caps from canonical pages.
It proposes the winner cutoffs and ordered pair pages, then the adjusted rates.
Clearing verifies them. The fee payer and frozen episode determine the worker's
proof addresses. After process loss the executor resumes the original bytes
in PostgreSQL. An unattainable winner bound returns
`insufficient-certified-winner-capacity`. Funds stay frozen until clearing
verifies a complete payment. [Signed restart and exits](../operations/validation.md#one-keeper-for-both-recovery-families).

### Wallet and publisher checkpoints in the local successor

A signed wallet request can contain a single direct-lane action or a serial
financial action preceded by its venue-derived market and fee checkpoints.
The SDK and ingress verify the instruction sequence, accounts, privileges and
terminal action. Cross-market exposure and exhausted lane capacity use the
serial route. A funded terminal exit uses clearing's resolution checks. The
stored transaction and its expiry authority identify the actual signed action.

A funding publisher signs the selected market checkpoint followed by the
report and its three registered maker accounts. Its PostgreSQL record binds
the report, digest and calculation to that exact wire. Historical single-report
originals retain their deployment-specific format.
