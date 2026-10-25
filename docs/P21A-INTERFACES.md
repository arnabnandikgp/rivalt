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
discover or decide financial maintenance. Maker/funding discovery is now implemented in `group-runtime.ts`; order, settlement
and risk/default workers remain phase work. Liveness records use
`(run, marketIndex, makerId)`.

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

## Market workers

`readGroupMakers` authenticates four canonical market-local registrations, isolated
capital roots, config identities and executable/ProgramData bindings against the
same group snapshot. Actual approved code hash and quote-epoch synchronization
are reported separately. Unknown or foreign dependencies reject the snapshot.

Run `group-worker-main.ts` with the explicit group run/RPC/PostgreSQL configuration,
`RIVALT_GROUP_ROLE=maker|funding|orders|settlement|risk`, `RIVALT_MARKET_INDEX=0|1` for market workers, a private
`RIVALT_SIGNER_PATH`, and `RIVALT_MAKER_ID=0|1` for makers. Makers own only their
registered isolated capital/config permissions. Expired publication and owner sync
are separate immutable queued intents; it never grants code approval or collateral access.
Funding cadence is 2–5 seconds, default two, independently budgeted per market.
Missing heartbeat or stale quotes do not suppress the on-chain source/coverage
sample: clearing still records its restrictive result. Pending/unresolved original
intents prevent replacement signing.

`bash ops/group-indexer-smoke.sh --market-workers` checks the actual separate
processes, source-loss sampling, maker restart, independent market stop and exact
queue-fee/PostgreSQL reconstruction. WORKLOG owns actual results. This does not
establish funded-position health, expired-epoch publication or full A26A acceptance.

## Whole-account quote candidate

`allocateGroupRoute` retains the fixed A/B search, integer fee prefixes and stable
allocation ties. Its explicit admission callback reconstructs each full root,
accrues both funding indexes, applies the selected fill/generation and remaining
order/protection reservations, then tests whole-account equity. Positive unpaid
claims do not increase cash or offset another loss. A reduction below IM must
strictly improve the full MM deficit after fees. This read-only client calculation
is never on-chain authority; signed acceptance remains required.

`buildGroupRoute` rebuilds exact route or stored-order instructions from the
confirmed snapshot, using both observations, group sequence and durable account/
order terms. Direct `GroupUserClient.quote` reads actual RPC maker/code bindings.
The execution service at loopback port 18091 exposes `/v2/quote`, `/v2/submit`,
`/v2/submissions/:id` and `/v2/operators`, separate from the finalized read API.
Quotes serialize messages for inspection only; wallet flows must use trusted SDK
builders and simulate the actual reviewed message. Missing/unmatched pending
funding evidence blocks a service quote. A matching original confirmed sample may
be recognized while its queue/budget still awaits finality. Observed availability
and signed flow acceptance belong in WORKLOG, not in these interface declarations.


The standalone `orders` role uses the group-wide orders budget and an explicit
operator signer. It discovers live market-bound order prefixes, tries at most a
64-lot subfill with bounded halving, and queues the original signed instruction;
clearing validates the persistent authority, prefix, fee and whole-account state.
It does not acquire owner transfer/netting authority. The scoped command
`bash ops/group-indexer-smoke.sh --trading-services` owns fresh route/order service
checks; preparation or unit success alone does not qualify its signed outcomes.


## Ordinary settlement worker

The `settlement` role uses `group-settlement` and one immutable pending attempt at
a time. It reads a coherent confirmed snapshot, accrues both market funding
prefixes for candidate calculations, collects whole-atom negative claims from
actual cash, and preserves each root's fractional claims. It never performs the
owner's explicit flat-claim netting. Gains require funded P, full post-payment
IM/reservations and the current complete-group certificate. Candidate simulation
and on-chain checks precede effects; failed/missing history never releases an
unknown fee reservation.

Proof pages contain the next 1–8 canonical read-only members, in a transaction
separate from any cash change. An invalidated certificate restarts at zero; an
expired matching certificate waits for a new observation. Negative adverse equity
can block ordinary certification but never substitutes for a default proof.
A flat cohort can collect and certify after prices expire under the existing
funding bounds. Active sequence/observation changes can interrupt proof progress;
this worker neither pauses samplers nor promises continuous exit availability.
The scoped `--settlement-services` command owns mixed-mode funding/settlement,
restart and fresh PostgreSQL checks; WORKLOG records actual outcomes.


## Liquidation and complete-group resolution worker

The `risk` role uses `group-risk` and optionally an explicit
`RIVALT_RECEIVER_MARGIN` owned by its private signer. A missing receiver permits
permissionless bankruptcy/page work but no liquidation; makers/empty/foreign
capital cannot consent. The one-second loop rotates through at most two open or
flat-net-negative roots, simulating ordinary freeze against the six current signed
source accounts. This works during administrative pause and does not use cached
negative risk equity to prove bankruptcy. No emergency freeze is automated.

If no default probe succeeds, one selected distressed target may be simulated for
liquidation at the actual index reference, at most 64 lots with bounded halving in
each permitted market. Clearing enforces current sources, strict post-fee progress,
receiver IM and reservations. A rejected simulation has no broadcast/fee; transport,
budget or unknown queue errors stop candidate selection. The ephemeral discovery
cursor carries no financial authority; durable signed intents and canonical
resolution state determine all committed progress.

Frozen progression uses the exact canonical next 1–4 members, epoch/stage/cursor
and measured resolution budget. Only collect/apply stages make members writable.
AwaitValuation and completed-group source checks remain permissionless; `resume`
is always false. At most eight paid completed-recovery attempts occur per epoch;
qualification stops at the existing six-second requirement and awaits explicit
authority resume. Resume returns to isolated mode; enabling cross requires its
separate existing activation. The worker never holds group authority for these
actions. `--risk-services` owns fresh process/database/resource qualification.

Proof-only settlement intents carry no group-sequence expiry proof: guard progress
does not advance that sequence. Missing original proof history stays unresolved
until independent evidence arrives; it cannot authorize replacement bytes or a
fee release. Busy-group proof progress and discovery latency remain measured
operational limits, not risk exceptions.


Maker publication writes its config; clearing epoch synchronization requires the
same config read-only. Submit publication first and wait for its original finalized
result, then sign a separate owner-sync transaction. Between them the maker is
unsynchronized and cannot quote. This preserves the on-chain read-only boundary
under Solana transaction-wide writability promotion. Publication carries no
registration-epoch expiry proof because it does not change that registration.
