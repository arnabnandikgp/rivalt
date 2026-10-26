# P23 — account-centric identities and custody

27 October 2026 · schema/profile 3 · A28/G18

Implements [D60](P22B-EXECUTABLE-CONTRACT.md)'s fresh venue, registry, portfolio,
margin account, safety, custody and market insurance accounts. Trading, funding,
orders, settlement/default and live migration remain disabled. No V1/V2 instruction,
account or event schema changes. Use `account-test-profile` only for a fresh local
manifest; it inherits the existing local/devnet mutual exclusion.

## Instructions and roles

| Instruction | Authority and effect |
|---|---|
| initializeVenueV3 | Verified clearing ProgramData upgrade authority; creates venue/custody/safety and classic SPL vault, pins separate fee/reserve keys and reserve destination owner, fixed 2500 bps insurance share |
| initializeVenueRegistryV3 | Venue authority, once; creates empty stable member registry separately to keep initialization bounded |
| initializeMarketV3 | Venue authority; BTC then ETH, immutable index/lot/cross eligibility, separate zero P/I/T/carry ledger |
| createPortfolioV3 | Owner, indexes 0–3; namespace only, no cash |
| registerMarginV3 | Owner and bound portfolio; immutable child/mode/role, stable global member ID, max 64 including makers/receivers |
| depositAccountV3 | Owner-signed actual token transfer into its empty-financial root; C and allocated custody increase once |
| withdrawAccountCustodyV3 | Owner, canonical mint/vault/destination, empty-financial custody state; actual token transfer, no sibling bailout |
| transferAccountCustodyV3 | Owner of both distinct roots, same venue; cash allocation only, no token or claim movement |
| pauseVenueV3 | Venue authority, reconciled custody; safety epoch advances, no financial activation |
| classifyMarketSurplusV3 | Reserve authority, explicit market and amount bounded by actual unallocated vault surplus; no duplicate classification |
| seedMarketInsuranceV3 | Reserve authority plus donor token authority; actual token transfer to exactly one attributed I ledger; no fee/carry or trader claim |

Context PDA/schema/owner/token/role checks and final vault reconciliation enforce
these rules. Both canonical market ledgers are supplied to custody reconciliation;
foreign/duplicate market accounts reject. Seed contributions are donations to
protocol insurance, not LP shares or an owner-redeemable deposit. Unsolicited token
transfers remain unallocated until classification; they do not increase user C.

A cross account can receive, allocate and withdraw debt-free cash without trading
activation. Every nonzero position, virtual claim/fraction, funding checkpoint,
reservation, order book, nonce or delegated authority rejects custody-only outflow.
P24/P25 own the separate qualified financial paths. The global custody event
sequence records history but is not a signed custody validity argument.

## Layout and event boundary

[D60 layouts](P22B-EXECUTABLE-CONTRACT.md#6-exact-layouts-encoding-and-deployment)
retain identical Borsh bytes. The first SBF build exposed oversized generated stack
frames for fixed-wide resolution arrays. `WideV3` now owns a fixed 96-limb **Box**;
its serialized size stays exactly 768 bytes, with no vector length or wire migration.
This keeps inert resolution decoding below the stack limit. P26 must still qualify
actual arithmetic heap/CU and continuation behavior; custody acceptance does not.

`AccountCustodyChangedV3` event-CPI provides venue/domain/schema, checked global
history sequence, action/actor/subject/amount, exact changed member snapshots,
attributed ledger snapshots, pinned authorities/policy, safety state, custody totals
and optional actual-vault/member-registry observations. None is encoded as a fake
zero when not read. P27 adds actual SQL projection; this phase independently fetches
and decodes signed RPC transactions and compares event/account bytes with isolated
Anchor. Reverted events are retained in failed history and excluded from committed
financial reconstruction.

Generated helper names are pinned to the new seed schemas (`venueV3`, `custodyV3`,
`safetyV3`, `portfolioV3`, `marginAccountV3`, `marketLedgerV3`, `venueRegistryV3`,
`venueVaultV3`). Generation preserves all existing V1/V2 instruction/account/type/
event definitions. The new instruction surface is additive, not a rename of V2.

## Reproduction and acceptance

```sh
source ops/env.sh
bash ops/build-account-custody.sh
pnpm typecheck
pnpm exec vitest run tests/rpc-contract/account-custody-conformance.test.ts
node --import tsx tests/rpc-contract/account-custody-svm.ts
bash ops/account-custody-smoke.sh
```

The build creates default and explicit custody artifacts, rejects any 4,096-byte
SBF frame diagnostic, generates the SDK from the current IDL and keeps locked pins.
The signed LiteSVM path covers full 64-member admission, real custody movements,
role/alias/authority/amount/frozen/profile negatives and atomic rollback. Negative
corruption fixtures are restored and never count as successful financial setups.

The scoped Surfpool command binds only its owned loopback ports, deploys the real
program, checks standard HTTP/WS, fetches every original signature finalized, reads
actual token/account bytes and compares legacy decoding. Its independent Python
auditor verifies C/P/I/T/actual-token identities and rejects eight byte mutations.
Declare 400,000 CU and require <=320,000 measured CU, <=1,232 packet bytes; record
actual account counts, fees and complete pass/rejection populations. No maker,
PostgreSQL, UI, load, oracle or unrelated financial suite is launched by this phase.
Raw evidence stays ignored under `.local/account-centric/` and
`.local/account-custody/<run>/`; concise acceptance goes in [P23 evidence](evidence/P23.md).
