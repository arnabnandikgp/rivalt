# P33 — canonical maker services and user integration

Status: implementation in progress above exact P32 `6de5cea` / ready PR #47.
A38/G26 is not yet passed. P34 follows P33's verified ready PR. Keep the stack open.

## Deployment and version boundaries

The explicit local `liquidity-execution-qualification` profile uses the four
P32-qualified executables built at `6437f7d`, with byte lengths and hashes pinned
in the SDK. No public configuration replaces those pins. Financial account
layouts remain schema 3 with immutable venue profile 4; canonical maker and
publisher layouts, journal binding and `/v4` interfaces are version 4. V1–V3
remain distinct. This phase adds consumers and operational durability, not a new
financial activation or a program deployment authorization.

The production projection reconstructs every critical custody, financial,
maker, registry, publisher and accepted-report event in custody-sequence order.
Existing per-market cash/claim/insurance/fee and complete-resolution checks apply.
Current maker price accounts are provisional external inputs; reprices are not
fabricated as clearing events. Finalized read readiness requires independent
RPC byte comparison of financial accounts, canonical registrations/registries
and publisher configuration. Failed transactions retain their logs but apply no
events. Restart/backfill and fresh-database replay must agree exactly.

## Durable operations

Signed originals and fee reservations commit before broadcast. Lost acknowledgments,
process restart and absent history never authorize a replacement signature.
Explicitly finalized failure permits rebuilding from a new current snapshot;
finalized blockhash expiry plus an unchanged applicable authority can prove no
economic effect, but does not release an unseen network fee. Per-role budgets
are operator lamports, separate from collateral or insurance.

Canonical transport selects v0 up to 1,232 bytes and v1 up to 4,096 bytes before
signing, without address lookup tables. V0 keeps its own packet ceiling. V1
resource limits live in its header; explicit resource/zero-priority-fee policy
must be validated at the wallet/service boundary. Legacy queues remain v0-only.

Maker updater keys can only reprice under current control/shape/authority limits;
they cannot replenish depth, change permissions or withdraw capital. The funding
publisher retains raw input rows/digest and calculated allocations for independent
replay, uses the authorized signer/epoch, and publishes no faster than the agreed
two-second cadence. Rejection after a concurrent structural control is classified;
the next eligible tick rebuilds after the original is resolved. No risk or oracle
check is weakened to increase availability.

## User and operator acceptance remaining

- Versioned direct SDK and browser wallet flow, preserving cash/unpaid distinctions,
  user price/fee bounds, stored-order authority and service-independent safe exits.
- Quote responses expose selected maker instances, gross/all-in amounts, source
  freshness/expiry and classified unavailability. Derived depth is a snapshot.
  Published funding depth is a trusted attestation, not financial trade admission.
- Fresh operator configuration/provisioning, durable maker/publisher workers,
  key rotation/revocation and interrupted/ambiguous original-signature recovery.
- Actual Surfpool RPC/WS/PostgreSQL, browser signatures, source/maker outages,
  indexer restart and fresh replay, independently reconciled fills/inventory,
  funding, funded cash/unpaid claims, fees and market insurance contributions.
- Maker-kit permissions, funding, quoting, reconciliation and exit instructions;
  reference makers are internal and hedge-cost assumptions are explicitly labelled.

P34 owns the complete bounded comparative workload and final measured limits.
No inherited P32/P16A run substitutes for these gates. P15B/P16B stay Open and
24-hour endurance stays Deferred.
