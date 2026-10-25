# P21A — group clients and services

This is the in-progress schema-2 interface contract on P20's qualified local
artifact. WORKLOG owns progress and actual evidence. It does not qualify P21B or
change financial authority, risk thresholds, source policy or external gates.

## Versioned journal and reconciliation

`packages/indexer/src/group-indexer.ts` subscribes/scans the configured group over
standard confirmed WS/finalized RPC. Initialization binds the actual successful
group creation transaction, its hash, domain, genesis, program, schema 2 and the
explicit `cross-safety-qualification` local profile. A V1 store cannot open that
run. Unknown critical schemas stop projection. A failed transaction retains its
metadata and observations but contributes no event, cash effect or outbox row.

The SQL journal format stays version 1: protocol version is the immutable
`binding.schema`, independent of the SQL migration version. The shared journal
stores exact signed-event bytes, one group-global sequence and decimal-string
financial values. No V1 row/account migration or history reinterpretation occurs.
Candidate state and journal commit use the same projection adapter. Reconciliation
must succeed before the durable cursor advances; missing history remains unresolved.

Projection reconstructs group pools, portfolios, stable members, two market
snapshots, account cash/positions/order/delegate state, isolated maker registrations
and complete resolution rows. It checks cash once per root, both net exposures,
scaled claims and frozen collection/payment/fractional ownership. Maker config
changes advance that market's config epoch, not the group's epoch.

RPC reconciliation compares canonical account identities and every projected field
against finalized account bytes, plus token mint/authority/vault allocation. Each
100-or-fewer-account request includes the group; differing group bytes reject the
candidate. This supports a bounded cohort whose portfolio identities make the
complete set larger than one RPC request. Exit certificates are authenticated
direct inputs, not fabricated journal events. The remaining acceptance must cover
maximum identities and process interruption during complete-group resolution.

## Read API and SDK previews

Run `node --import tsx packages/indexer/src/group-main.ts` with explicit
`RIVALT_GROUP_PROFILE=cross-safety-qualification`, `RIVALT_GROUP`,
`RIVALT_INIT_SIGNATURE`, `RIVALT_RUN_ID`, RPC/WS and PostgreSQL configuration.
The endpoint defaults to loopback port 18090. This launches a read service for an
existing explicit deployment; it never provisions from retained acceptance dumps.

- `/v2/group`: group, two markets, makers and resolution.
- `/v2/portfolios/:owner`: owner portfolios and immutable child accounts.
- `/v2/accounts/:margin`: exact cash/positions/book/authority plus risk preview.
- `/v2/events` and `/v2/trades`: bounded global-sequence pagination; trades include
  actual isolated and cross aggregate route fills only.

Responses carry schema, deployment binding, finalized sequence/signature/slot,
collateral/scaled units and each market's distinct lot units. `/ready` and all
`/v2` reads fail closed when projection readiness is lost. An account preview
fetches finalized on-chain Clock separately and labels its context explicitly.
Pending funding accrues both permitted positions without mutating root state;
reserves refresh current market bounds and live delegation/protection allowance.
Positive unpaid profit gets zero risk credit. Required stale exposed markets make
risk equity unavailable; an unrelated empty slot does not invent price dependence.
Frozen root data is accompanied by the resolution ledger, not a spendable payout.

`localCashHeadroom` is only the account's previewed capacity. `withdrawableCash`
remains null and `withdrawalStatus` requires a fresh complete-group certificate
and simulation. Portfolio cash is never pooled implicitly. The direct account client now shares immutable wallet signing with V1. Pinned
executor recovery passes; direct RPC exit acceptance and full financial workers
remain P21A work.

## Durable execution infrastructure

`packages/services/src/group-execution.ts` uses the same immutable signed-byte
queue as V1 with a schema-2 run. Finalized expiry proofs distinguish margin nonce,
group sequence and per-market maker quote epoch, authenticate the account schema
and group, and leave unknown network fees reserved. Wallet ingress permits one
owner/delegate action or the explicit owner transfer plus route; the latter uses
700,000 CU and binds recipient/next group sequence. No additional signer,
nonzero priority price, arbitrary program or replacement wallet message is accepted.
Operator request prefixes remain reserved; ordinary client retries use identical
bytes and request identities.

The separately runnable `group-executor-main.ts` consumes this queue. It does not
discover or decide financial maintenance. Group financial workers remain phase
work; their market-specific liveness records use `(run, marketIndex, makerId)`.

| Explicit local fee budget | Cap (lamports) |
|---|---:|
| Each BTC/ETH A/B maker | 1,000,000 |
| Each BTC/ETH funding worker | 5,000,000 |
| Group orders, settlement and risk (each) | 5,000,000 |

Caps bind a payer once, share the existing 20,000-lamport reservation per pending
intent and reconcile independently fetched actual fees. No automatic top-up or
collateral deduction exists. Same-owner internal makers remain internal actors.

## Scoped verification

`bash ops/group-indexer-smoke.sh` deploys the explicitly qualified local artifact
and the existing maker/source fixture artifacts, provisions real token cash and
signed market/account operations, then verifies finalized reconstruction, reverted
event exclusion, actual WS disconnection/restart and fresh PostgreSQL replay.
The artifact directory is `.local/successor-p20`, produced by
`bash ops/build-cross-safety.sh`; no raw evidence serves as runtime configuration.
The fixture transport is not a substitute for the forthcoming service queue.

Targeted tests cover authenticated schemas, V1 scanner compatibility, negative
cash/claim mutations, whole-account preview arithmetic, funding expiry, delegated
orders and TP/SL. Read-only replay of retained P20 history is a consumer regression,
never new chain/PG acceptance. Full A26A still requires explicit worker budgets,
deployment artifact binding, real process recovery, fresh independent financial
audit and direct SDK cancellation/admissible exit with the API stopped. P21B owns
the browser and measured contention workload. No full-day run is required.

## Direct account client

`GroupUserClient` requires a credential-free local deployment configuration with
schema 2, the explicit qualified profile, genesis, group/domain/mint, initialization
signature and exact initialization transaction hash. `readGroupSnapshot` authenticates
registry, two markets, every root/portfolio, SPL mint/vault and safety identities.
Every dependent RPC request repeats the group bytes; an intervening group mutation
requires a retry. Finalized balances and confirmed execution previews stay labelled.
Empty portfolios with no registered roots are not enumerated by this root snapshot;
owner-selected creation/registration uses canonical indexed identities.

Direct builders support explicit account registration, mode-specific deposits,
market-bound order management, account delegates, flat claim netting and owner
allocation/withdrawal. All signed actions still simulate before wallet review and
reconcile the original signature/bytes. They neither synthesize a successful action
nor replace an unresolved signature. Complete-group proof pages precede withdrawals
and transfers in separate transactions. An expired exposed certificate cannot be
reset under an unchanged sequence; a fresh market observation is needed. Flat
cohorts retain the existing price-independent exit path with funding bounds checked.
No local preview or positive unpaid claim is withdrawable cash authority.

`bash ops/group-indexer-smoke.sh --direct-sdk` is the scoped direct-account RPC/WS/
PostgreSQL check. It shuts down a real read API before SDK actions and deliberately
expires the sources before cancellation/flat exit. WORKLOG records actual results;
this account checkpoint does not cover route quoting, resolution workers or P21B.
