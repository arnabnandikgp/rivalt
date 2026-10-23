# P06 service lifecycle

This implementation extends the explicit `local-test-profile` only. BTC, six-decimal classic SPL collateral, F=0, no orders/reserves, and the P04 expiring synthetic common reference remain the allowed profile. Authenticated sources/funding, liquidation/default, TP/SL and funded deployment retain their later gates. The historical P05 statements that all trading exits/settlement are disabled are superseded by this contract.

## Ordinary settlement and exit authority

Clearing adds `collectLoss(sequence, observation, amount)`, `settleGain(sequence, observation, amount)` and owner-signed `withdrawTrading(sequence, observation, amount)`. All bind the current market sequence and live observation. All arithmetic is the checked P02 integer model. Collection moves whole negative entitlement from participant C into P and adds the same scaled amount to v. Settlement transfers available P into C and subtracts the scaled amount from v, bounded by current positive entitlement and post-action initial margin. Fractions stay with their participant. Positive unpaid profit is never cash or margin credit.

No keeper can spend insurance, fees or other participants' cash through a gain-settlement instruction. Settlement remains first admissible landed execution; scheduling is a local worker policy, not an on-chain FIFO/pro-rata promise. Collection is permissionless and can continue when an account is distressed. Insurance/default mechanics remain unavailable.

Settlement and trading withdrawal require a complete cohort certificate. `ExitGuard`, PDA `[exit-guard, market]`, is 101 bytes and stores market, sequence, observation, registry count/next index, cumulative C/q/U and bump. `initializeExitGuard` is permissionless rent-funded setup. `checkExitCohort` accepts 1–8 readonly participant accounts in exact append-only registry order. Start zero begins a new sequence/observation snapshot and cannot rewind partial or completed work at the same stamp; later pages must match its sequence/observation/count and next index. Each account must have the correct owner, PDA, market and stable ID. Every participant must cover its adverse-bound unpaid loss with cash. Completion also verifies ΣC, Σq=0, ΣU=P×SCALE and actual-vault reconciliation.

The scan does not freeze the market or increment its financial sequence. Any intervening registration, financial action, risk publication or maker/control event invalidates the certificate. Each exit rechecks live risk, current sequence and complete certificate; withdrawal also requires owner authority, the correct SPL destination and post-withdrawal margin. A previously completed scan cannot authorize a second exit after the first changes sequence. This conservative gate works for all 64 members using pages and fails closed for distressed cohorts. It does not implement P09 exceptional resolution, or P07 no-credible-bound exits.

Existing custody `withdraw` remains mode-0 only. New financial instructions reject the default build without `local-test-profile`. Deposit/routes now admit a nonzero P in mode 1; C+P+I+T remains allocated vault assets. F/order/reservation restrictions are unchanged.

`SettlementChanged` event-CPI v1 carries domain/market, checked sequence/slot/observation, kind (0 collection, 1 gain, 2 withdrawal), participant/amount, resulting C/v, total C/P, allocated and actual vault. Indexing excludes failed transaction events, updates C/v/P atomically with the checkpoint, and verifies Σv=P×SCALE after every critical event. Read balances expose P and the certificate requirement. They conservatively report zero immediately withdrawable cash for mode 1; the signed withdrawal is authoritative.

## Processes and HTTP contract

`packages/services` uses the existing exact Fastify 5.12.7, pg 8.23.1, Kit 8.5.0 and web3.js 3.1.1 pins. No legacy Anchor enters its runtime graph. `main.ts` runs one role per process: `api`, `executor`, `maker-a`, `maker-b`, or `settlement`. Common configuration is `RIVALT_DATABASE_URL`, `RIVALT_RUN_ID`, `RIVALT_RPC_URL`; signing roles use a protected `RIVALT_SIGNER_PATH` JSON file. API binds loopback, default `RIVALT_SERVICE_PORT=18081`. This phase refuses non-loopback RPC. Keys/credentials belong in ignored local configuration, never evidence.

The indexer must initialize the database run binding first. Services verify genesis and the exact initialization transaction against that immutable binding. Quote/worker snapshots discover registry/config keys, then fetch all financial accounts in one finalized `getMultipleAccounts` bank. They check account owners, registry membership, cash/claims/exposure conservation, vault assets, and maker ProgramData hashes. The on-chain instructions revalidate authority and finances at execution.

| Endpoint | Contract |
|---|---|
| `GET /live`, `/ready` | Process liveness; ability to validate a current chain snapshot |
| `POST /v1/quote` | `{owner, side:0|1, lots:"100"}`; labeled eligible universe, exact allocation/fee and unsigned SDK instructions encoded as base64 data plus account roles |
| `POST /v1/submit` | `{requestId, wire}`; already wallet-signed v0 transaction, exact bytes persisted before broadcast |
| `GET /v1/submissions/:id` | Signature, durable execution status, attempts and finalized fee/error result |
| `GET /v1/operators` | Maker owner/availability, capital/inventory/epoch and explicit operator fee budgets |

Ingress accepts a single clearing deposit, immediate route or trading withdrawal, with at most the fixed 400k-CU instruction. It verifies every Ed25519 signature, static v0 account form and wallet owner as fee payer. No service key signs a wallet action. No address tables, arbitrary instruction relay, hidden collateral fee, or automatic user re-signing is enabled. On-chain owner, limits, epochs, nonce and health remain authoritative.

Each maker daemon loads a distinct owner key, observes inventory/cash and publishes an expired epoch plus clearing synchronization as an atomic signed transaction. Heartbeats include owner/process ID and chain slot/state; 3 seconds without a heartbeat marks that daemon offline. The quote API excludes offline daemons from its explicitly labeled candidate universe. Standing on-chain authority is not revoked by heartbeat loss, and direct SDK execution can still use a valid standing quote. Returning daemons retain the same owner/authority. Neither daemon hedges externally; these processes are synthetic operators, not independent commercial participants.

The settlement worker collects available whole losses in stable registry order, scans the complete solvent cohort, then settles available whole gains. Each instruction binds its observed sequence. Competing workers use a stable economic request key; changing the chain sequence invalidates older financial actions. Underfunded/distressed cohorts block ordinary exits until later recovery support exists. The worker performs no insurance/default action.

## G07 budgets and recovery

User transactions pay their own SOL network fees. Maker publication/synchronization uses that maker's funded SOL key. The keeper uses a separately explicitly funded SOL key. Per run, maker A and B each have a **1,000,000-lamport** fee cap; the keeper has **5,000,000 lamports**. Test fixtures fund those keys with real local SOL. Sponsorship of user fees is disabled. These are local run caps, not production economic assumptions or automatic recurring top-ups.

P14 wallet ingress also accepts the explicit zero-price compute instruction alongside the fixed 400,000-CU limit and one wallet-owned financial action. Budget instructions must precede that action, carry no accounts and occur at most once each; a price requires the fixed limit. Nonzero prices, other limits, duplicates and additional financial actions remain rejected. Existing one-action and limit-plus-action clients remain supported. This does not change operator reservations or introduce user sponsorship.

Every operator job atomically reserves **20,000 lamports** in PostgreSQL with its immutable signed bytes. The RPC fee estimate must fit before persistence; finalized actual transaction fees replace reservations. Unresolved jobs retain reservations. Cap, payer and budget identity cannot be silently changed by a worker restart. Budget exhaustion stops new work; no participant collateral is charged. Program/account deployment and initial rent provisioning are explicit fixture setup costs outside these ongoing worker fee budgets.

The durable queue stores unique `(run, requestId)` and `(run, signature)`, immutable wire/blockhash/authority/budget, attempts, status and result. A repeated ID accepts only identical bytes. Workers lock rows with `FOR UPDATE SKIP LOCKED`; they process at most 32 due intents per cycle with a one-second retry schedule. Broadcast can occur only after the intent insert commits. Timeout/crash/retry resends only the same bytes. A transport exception or missing history stays `unresolved`.

Finalized success/failure requires both finalized signature status and independently fetched matching transaction metadata. `expired-unexecuted` additionally requires an invalid blockhash at finalized commitment and a same-or-later finalized account observation showing the transaction's monotonic nonce/market sequence unchanged. Expiry by itself is insufficient. This establishes absence of the authorized economic effect, not absence of a failed landing/network fee: the expiry result has an unknown fee and retains any operator reservation until transaction evidence is available. If authority advanced without attributable history, or a deposit lacks such authority, status remains unresolved. The executor never rebuilds a signed wallet action. Actual fees, failed transactions and ambiguous jobs remain observable for reconciliation.

## Reproduction and evidence

`source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` is the complete build/regression/service command. `bash ops/lifecycle-smoke.sh` reruns the service acceptance against already-built artifacts and creates its own Surfpool, PostgreSQL volume/container and process group; it is not a replacement for clean build provenance. `pnpm test:settlement` runs the compiled signed settlement/cohort scenarios. The RPC harness is the thin wallet client: it signs generated instructions with a funded local user key and submits through the HTTP API.

Acceptance exercises actual SPL deposit → beneficial A/B split → B-only close during A outage → ordinary funded settlement → full flat withdrawal. Independent expected values are: opening gross 6,002,790 and fee 1,201; closing gross 6,097,000 and fee 1,220; trader gain 94,210; maker losses 20,580 and 73,630; trader final funded cash 100,091,789 before withdrawal. Real RPC/WS and PostgreSQL determine every observed result. No financial balances, fills or settlement events are injected into the database.

Run-specific pass/fail, hashes, measured resources and integration status belong in [WORKLOG](WORKLOG.md) and the evidence report. This contract alone does not claim acceptance, review, soak or deployment completion.

P12 extension (D34): the original smoke caps remain default; explicit loopback `soak24` uses 500,000,000 lamports per operator role and 5,000,000 per maker. Payer/cap identity is still immutable; separately prefunded synthetic SOL, fee reservations, actual-fee reconciliation and unknown-outcome retention are unchanged. No automatic top-ups or collateral funding are added. See [LOAD-SOAK](P12-LOAD-SOAK.md) for the measured profile and pending acceptance.


D35: unsigned route previews may use confirmed state with an explicit commitment label and independent client reconstruction. Pending funding is not assumed applied from a status flag: its exact confirmed transaction must decode to the snapshot observation/epochs/validity/funding state. This does not finalize the queue row or release its budget; missing/conflicting evidence still refuses preparation. All transaction-success and fee reconciliation stays finalized.

P14 service parity correction: the worker now follows P07's existing on-chain flat-cohort source-outage path. When every participant has zero lots in mode 2, ordinary whole-atom collection, complete-cohort verification and funded gain settlement may proceed despite expired sources. Open exposure still requires credible bounds; pause/freeze and all sequence/certificate checks remain enforced. This corrects worker scheduling, not economic permissions or funding.
