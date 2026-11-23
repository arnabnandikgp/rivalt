# Finalized history and durable execution

The indexer reads complete finalized blocks and independently reconstructs clearing effects in PostgreSQL. The chain remains authoritative for balances and eligibility. A published view binds a specific chain, deployment and verified cursor.

## Publication frontiers

- **Covered:** the complete authenticated finalized block prefix durably stored
  with its ordered invocation projection. Interrupted recovery resumes after this
  prefix; a later unavailable block or newer account revision cannot erase it.
- **Reconciled:** a covered prefix whose financial projection has passed independent
  finalized account/vault reconciliation. Public facts and discovery use this
  immutable published state/cursor, never a partially advanced covered state.

Each covered chunk checks genesis/initialization binding, complete signature
manifests, canonical parents, transaction outcomes, scoped revision dependencies
and exact projector invariants. Persist blocks, original transaction bytes,
invocations, projection and covered checkpoint atomically. Duplicate identical
bytes are idempotent; conflicting duplicates, gaps and impossible revision orders
reject. A chunk boundary cannot split an atomic transaction or manufacture a full
block fence from its prefix. Canonical block transaction order alone is insufficient
where scoped read/write dependencies require a different order within that block.

`pageSize` bounds requested slot ranges (default 100, allowed 1–1,000). One
complete block is one SQL commit. `maxRecoveryTransactions` is a per-cycle work
budget (default 10,000); empty blocks cost one work unit, and an indivisible
nonempty block can exceed the remaining budget.
Reaching the budget saves progress and defers remaining work to the next cycle,
without rejecting a large backlog. At most eight block bodies and their eight
independent signature manifests are in flight. Each RPC response is streamed
under an explicit 64 MiB default byte budget; `maxRpcResponseBytes` can be raised
for an operator's measured environment. If an oversized or unavailable block stops a cycle, the durable checkpoint retains the previously covered prefix.

## Durable execution boundary

`AccountExecution` reuses the immutable signed-wire queue and current schema-bound journal with
qualified genesis/anchor/artifact binding. Public ingress accepts an allowlisted wallet action or the supported activation-and-deposit pair. It checks the zero priority price, wallet signer and exact decoded venue, actor and owner accounts. It does not accept arbitrary operator
instructions or supply sponsorship. Generated parsers authenticate the exact current instruction account ordering.

For inherited account actions, nonexecution proof is limited to monotone root state versions, market observation
sequences, with canonical PDA/schema checks after
finalized blockhash expiry. Unchanged authority says nothing about a hidden failed
transaction fee; its budget reservation remains until actual finalized history.
Liquidation jobs retain the consenting receiver’s signed pre-state version:
on-chain execution checks it and advances it, so an unchanged canonical receiver
after finalized expiry proves no liquidation effect. An advanced/missing receiver
remains unresolved. Permissionless freeze/default/recovery jobs have no invented
version proof. Wallet activation signs the margin root revision, which clearing
checks and advances on success. The same proof covers an atomic activation and
deposit. A standalone deposit provides no such stamp. Actions without a signed pre-state stamp retain no inferred proof. All retries of
pending or unknown outcomes use the same committed bytes and signature. Worker
lamport budgets and heartbeat records are market/maker-specific; actual process/fault qualification is recorded in validation.

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

## Settlement during trading

Loss collection and gain payment are separate landed instructions. A positive claim, available settlement cash and valid backing must coincide before payment. The worker can service a ready gain on one market while the other builds its backing certificate. Polls and successful submissions alone do not credit cash. Check the finalized holder and market changes, and report remaining claims and the pool balance. [Observed payout timing](../operations/performance.md)

## Default recovery

The database persists the episode, frozen membership, authenticated on-chain stage and exact signed original. Resume at the last verified stage after restart. A native helper can propose a plan and page descriptors. Clearing verifies each stage and controls every payout. An incomplete or unknown original cannot be replaced by an unrelated financial action. Verify terminal custody and all member movements before treating a withdrawal as available. [Default verification](../clearing/default-plan-verification.md) · [Indexer source](../../packages/indexer/src/) · [Worker source](../../packages/services/src/)
