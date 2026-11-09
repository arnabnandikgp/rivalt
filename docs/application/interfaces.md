# SDK, API and wallet contracts

## Explicit deployment identity

`AccountUserClient` validates version-4 local configuration, immutable artifact
pins, genesis and the actual initialization signature/hash. Configuration includes
RPC/WS URLs, venue, mint and domain. Never infer a deployment from a port or retained
acceptance dump. The fresh RC2 deployment requires explicit
`accountSchema: 8` in addition to transport `version: 4` and the local profile;
missing/old schema selection rejects. All clearing-owned decoders use schema 8,
while maker-owned curve/price schemas advance to 5; quote/report protocol versions remain unchanged. This is a fresh-domain/client change,
not permission to upgrade retained state or replay old signed originals. [Deployment](../operations/deployment.md) owns
artifact and key configuration; [routing](../liquidity/routing.md) owns snapshots.

P47 qualifies the exact C0 local artifacts. Normal launchers use the separate
`.local/anchor-rc2/current` directory; deployment binding and executable hash checks
remain mandatory.

Public amounts are integer decimal strings with units; internal arithmetic uses
bigint. Never serialize a monetary bigint as an IEEE-754 number. Keep cash,
unpaid claims, risk equity, reservations, fees and insurance separate.

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
`accountSchema: 8` in deployment configuration and API envelopes. `asOf.cursor`
is the journal-local financial-payload cursor, `asOf.cursorScope` identifies that
scope, and `asOf.blockhash`/`slot` identify its complete finalized block fence.
Scoped revisions authenticate protocol history; UI pagination cursors do not.
