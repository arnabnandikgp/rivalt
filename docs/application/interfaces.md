# SDK, API and wallet contracts

## Planned account-scale interface (P51B)

The schema-9/profile-5 [account contract](../clearing/accounts.md#account-scale-successor-contract-p51b)
is implemented in the P55A2 source and generated codecs. The
selected, qualified artifact remains schema 8; these clients cannot reinterpret
that deployment. P55A2 has a pinned schema-9 candidate and signed lifecycle/default evidence;
complete UI/worker acceptance and runtime promotion remain P56A/P56B in STATUS.
P56A owns complete UI and restartable worker integration before expanded financial
activation. u64 member IDs/cursors are decimal strings
in JSON and bigint internally; u32 portfolio/child keys have explicit bounds.
Never cast a member ID into a JS number or confuse a page slot with a global ID.

Paginate authenticated identities separately from the live financial index.
Responses distinguish Registered, Financial, Retired and frozen/apply-pending
state. A retired namespace is unavailable for reuse; a hidden zero balance does
not prove retirement eligibility. Display funding cash and fractional/unpaid claims
as before. SDK activation must name its storage/rent payer and include the actual
atomic activation/deposit instructions; a provisioned page is not a funded account.
Do not claim a complete portfolio/venue from one page or a partially caught-up DB.

Default workers follow authenticated epoch/stage/cursors and upload untrusted rate/
order proposals in bounded transactions. Retry the same persisted signed original
after ambiguity, and reconcile its actual finalized transition before new work.
Expose classified missing-storage, proposal-rejected, in-progress, invalidated-
region and genuinely unbacked payment states. Neither a solver's model nor a local
database can declare a root applied or a creditor paid. P52's staged indexer may
land first with the current schema; it must preserve that schema's financial
readiness rules rather than invent the future layout.

## Explicit deployment identity

`AccountUserClient` validates version-4 local configuration, immutable artifact
pins, genesis and the actual initialization signature/hash. Configuration includes
RPC/WS URLs, venue, mint and domain. Never infer a deployment from a port or retained
acceptance dump. The fresh RC2 deployment requires explicit
`accountSchema: 9` in addition to transport `version: 4` and the local profile;
missing/old schema selection rejects. The in-progress clearing-owned decoders use schema 9 / on-chain profile 5,
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
authoritative. Complete wallet/UI flow acceptance remains P56A work.

P47 qualifies the exact C0 local artifacts. Normal launchers use the separate
`.local/anchor-rc2/current` directory; deployment binding and executable hash checks
remain mandatory.

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

Public submission accepts one allowlisted measured wallet action, one wallet
signer, exact decoded venue/actor/owner identity and explicit resource/zero-priority
policy. No arbitrary operator instruction or implicit sponsorship. The executor
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

Show pending, confirmed and finalized separately. Submitted does not mean filled;
a triggered stop authorizes an attempt and can fail liquidity/price/risk checks.
Keep exact original signatures/wire for reload and direct RPC recovery. Account,
wallet, chain and configuration changes invalidate incompatible prepared state.

Separate actual fill candles and execution VWAP from independent risk/index prices
and publisher-attested funding impact. Expose source/quote/publisher age and reason
for unavailable quotes; mark reports superseded after authority control. Derived
books are snapshots, and a daemon heartbeat does not refresh on-chain prices.

Never describe insurance as guaranteed profit backing, reference makers as
independent operators, or assumed hedges as observed costs. Instrumented local
Wallet Standard browser evidence is distinct from external-provider compatibility.

The current RC2 account-schema-8 deployment retains API version 4 but requires
`accountSchema: 9` in deployment configuration and API envelopes. `asOf.cursor`
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
