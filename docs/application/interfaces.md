# SDK, API and wallet contracts

The fresh-local wallet selects `bounded-entry`. Clients bind the exact deployment, program hashes, genesis, initialization signature and domain. Transport version 4, clearing schema 10/profile 6 and SQL journal format 3 are separate identifiers. `selected` is an explicit earlier P56 deployment. Existing signed originals remain bound to their original executor. [SDK deployment table](../../packages/sdk/src/account-deployment.ts)

## Finding an inactive market

`readInactiveMarketListings(rpc, venue)` returns the venue's finalized inactive
listings in market-ID order. Each result contains the address, ticker and decoded
record, including the lot scale, collateral mint and bound primary oracle. The SDK
checks the deployment, discriminator, PDA seeds, identity and schema. Clients can
show these rows as *registered, trading disabled*. The order form and router use
the separately admitted trading markets. A venue authority can build the local
registration with `getRegisterMarketListingInstructionAsync`. [Account rules](../clearing/accounts.md#registering-an-inactive-market)

Derive the observation PDA with `findListingIndexPda({listing})` and decode it
with `getListingIndexDecoder()`. A zero deadline means no sample has qualified.
The `reference`, `lower` and `upper` fields are collateral atoms per lot. At or
after `deadline` (chain Unix seconds), the sample has expired. The generated
`getObserveListingIndexInstructionAsync` builder needs the four bound feeds and
requires no venue or oracle signature.

## Account discovery

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

Financial activation plus deposit can be atomic. The account must have capacity in the membership index and provisioned recovery storage before financial entry. Owners can retire empty roots. Public monetary amounts and stable member IDs are decimal strings. SDK internals use bigint.

## Quantity and execution bounds

Immediate requests, stored order totals and maker side depth share the existing
100,000,000-lot financial domain; signed positions and aggregate gross exposure
retain their separate existing checks. `/v4/quote` accepts canonical positive
decimal strings through that bound. The UI converts BTC/ETH exactly and rejects
larger quantities before requesting a quote. The owner or an authorized, unexpired delegate signs the fee budget. A request within this numerical range still needs executable depth, margin and a complete route search. [Measured bounds](../operations/performance.md)

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

For the local grouped coverage layout, `groupedFundedWithdrawal` builds the owner
instruction from an authenticated account snapshot. It includes markets required
by live orders, positions and flat claims, the applicable ledgers and the
owner account's coverage lane. Prepend the instructions returned by
`marketCheckpointsFor` in the same transaction. The grouped-credit wallet
performs this step in `prepare`. [SDK implementation](../../packages/sdk/src/account-client.ts)

Current balance previews include both funding checkpoints, all negative claims,
per-position IM and refreshed orders, with zero positive unpaid-profit credit.
Indicative cash headroom is capped by all mixed held-funding corners. Missing
required sources, pause/freeze or unsettled terminal state supplies no admission
promise. `withdrawableCash` remains null; only the actual instruction/current
simulation determines admission. Never label unpaid marked P&L as cash.

## Quotes and signed ingress

On an execution-router venue, the ordinary wallet uses `AccountUserClient.marketOrder`
and signs an order against the candidates shown in the wallet. The baseline deployment includes the complete three-maker registry. The opt-in local `multi-maker` profile discovers up to 32 registrations, defaults to four supplied makers and accepts an explicit two-leg or three-through-eight choice. The wallet retains a financially admitted preview or selects candidates with enough combined depth when possible under the fill limit. The review shows
size, maximum spend or minimum proceeds, fee ceiling and expiry. The signed
original is saved before direct RPC broadcast. At landing clearing selects up to two baseline makers or allocates across the wider signed shortlist. Price age alone does not expire that execution quote. Risk source,
funding, maker control, consumption and trader limits still apply. The wallet can
reconcile an ambiguous submission by its original signature. An integration using
`/v4/submit` can relay the same bytes through the durable queue.

`/v4/quote` exposes selected maker instances, gross/all-in values, expiry, source
freshness and classified unavailability. Quote validity is provisional; an HTTP
response is not instruction authority. Rebuild and authenticate instructions in
the SDK with user size, side, limits, fee cap and exact account bindings. Current
price may improve/change within signed bounds; structural-epoch changes reject.
On the legacy signed-leg path the wallet displays the route's signed slot
deadline. Its maker price can expire after six seconds while the order still has
slots remaining. A fresh review is required to sign again.

An unfinished exact route search reports `liquidity-search-budget-exhausted` with
bounded search metrics, distinct from insufficient depth or failed account health.
It supplies no provisional winning allocation or transaction to sign. Direct SDK
callers receive `LiquiditySearchLimitError` for the same condition.

Public submission accepts one allowlisted wallet action, or exactly activation
followed by a positive deposit into the same root. Both instructions must bind
the same owner, venue, margin, safety and event authority. Activation supplies the canonical membership index accounts.

Each signed original retains its wallet, account guards and exact limits. The finalized event records the actual maker allocation. [Route search and locks](../liquidity/routing.md)

## Wallet display

Connect wallet → portfolio/account → deposit → quote/review/sign → receipt → manage
positions/orders → close → eligible settlement/withdrawal. Portfolio and subaccount
IDs refer to real PDAs; portfolio metadata itself has no funds. Account mode and
isolated market cannot change after registration.

For a fresh closed-quantity account, the Positions panel shows the whole atoms eligible before pool availability and backing, including after a partial close. For a flat position with a positive claim, the panel uses
`closedGainStatus` from the SDK. It shows whether ordinary payment is suspended,
the balance is below one payable atom, the settlement pool is empty, the pool
covers part of the claim, or the claim awaits verified payment. Pool cash is
shared. A payment becomes funded account cash only when clearing applies it.

Show pending, confirmed and finalized separately. Display the fill only when its transaction executes successfully.

The operator API exposes status and economics separately from the wallet. A healthy worker heartbeat provides no evidence that a quoted order can clear. The normal wallet submits over RPC. Journal-backed submission, workers and replay are described in [durability](durability.md).

### Direct local profit credit

For the `direct-closed-credit` deployment, pass the decoded recipient margin account, selected market, amount, actor and pinned artifact set to `directClosedProfitCredit`. The SDK derives the recipient from its portfolio and subaccount, includes both markets, selects the ledger dependencies and marks the recipient’s coverage lane writable. Sign and send all returned instructions together. Anyone can pay the transaction fee. Credited cash belongs to the margin account owner. [Clearing contract](../clearing/accounting.md#atomic-credit-of-closed-profit)

### Complete default inputs

`readVenueSettlementBook(rpc, identity, roster, phase)` reads up to 40 distinct
Financial roots on the current ledger-lane venue. All roots, market checkpoints,
registry, vault and recovery state come from one finalized bank. Unique member
IDs and the registry's Financial count establish completeness. The reader keeps
signed claims at full precision, classifies pending insurance, checks each
market's net and gross inventory, and separates allocated cash from unsolicited
vault surplus. With `active-preview` it uses the current market state. With
`frozen` it requires the newly valued episode and uses its immutable prices and
funding. The output supplies the native settlement engine with decimal-string
amounts. Clearing still verifies any transaction that changes balances.
