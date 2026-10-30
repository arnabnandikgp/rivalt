# Finalized state and durable execution

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


## Durable execution boundary

`AccountExecution` reuses the immutable signed-wire queue and schema-3 journal with
qualified genesis/anchor/artifact binding. Public ingress accepts one measured
wallet action with explicit zero priority price, one wallet signer and exact
schema-decoded venue/actor/owner accounts. It does not accept arbitrary operator
instructions or supply sponsorship. Generated parsers avoid V2 account-index
assumptions in V3's differently ordered instruction contexts.

For inherited account actions, nonexecution proof is limited to monotone root state versions, market observation
sequences or legacy maker-sync quote epochs, with canonical PDA/schema checks after
finalized blockhash expiry. Unchanged authority says nothing about a hidden failed
transaction fee; its budget reservation remains until actual finalized history.
Liquidation jobs retain the consenting receiver’s signed pre-state version:
on-chain execution checks it and advances it, so an unchanged canonical receiver
after finalized expiry proves no liquidation effect. An advanced/missing receiver
remains unresolved. Permissionless freeze/default/recovery jobs have no invented
version proof. Actions without a signed pre-state stamp retain no inferred proof. All retries of
pending or unknown outcomes use the same committed bytes and signature. Worker
lamport budgets and heartbeat records are market/maker-specific; actual process/fault qualification is recorded in validation.



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
and finalized transaction/account bytes. Paginate history, deduplicate stable
signature/instruction/event identities, retain failed transaction logs but apply
no reverted events. Projection and checkpoint commit atomically in PostgreSQL;
crash/rollback/disconnect recovery resumes the durable checkpoint. Unknown critical
schemas, skipped sequence, bad CPI identity, duplicates with conflicting bytes and
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
