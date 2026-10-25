# P18A — fresh two-market group custody

This is the custody-only implementation of [P17](P17-MARGIN-CONTRACT.md).
`successor-test-profile` explicitly includes the local test profile; combining it
with the devnet profile is rejected by the existing mutual-exclusion compile check.
Default builds reject successor custody. No isolated or cross trading activation,
oracle update, delegation, claim setter, live conversion or migration instruction
exists in this phase.

## Instructions and authority

All handlers and Anchor contexts live in
[group_custody.rs](../programs/clearing/src/instructions/group_custody.rs).
Every operation checks schema/profile 2 and rejects extra remaining accounts.
All financial allocation is serialized through the writable group root and the
affected margin roots. No portfolio is writable on a cash transfer.

| Instruction | Effect / required authority |
|---|---|
| `initialize_group_v2` | Verified actual program upgrade authority initializes a fresh nonzero domain, group, 64-member registry and six-decimal classic SPL vault; mint freeze authority must be absent |
| `initialize_group_market_v2` | Group authority creates canonical BTC index 0, then ETH index 1; hardcodes lot sizes/symbols and rejects another market; no prices or funding fabricated |
| `create_portfolio_v2` | Owner creates group-bound index 0–3 after both markets exist; namespace has no money |
| `register_margin_v2` | Owner creates immutable child mode/market/role, records bitmap and stable registry ID; rejects a cross maker, invalid mode/index and member 65 |
| `deposit_group_v2` | Owner token account transfers actual collateral to group vault and increments only the chosen root and group cash |
| `withdraw_group_custody_v2` | Owner withdraws only that root's funded cash through the group PDA signer, to its own mint-compatible token account |
| `transfer_group_custody_v2` | Owner explicitly allocates between distinct same-owner/same-group roots, including separate portfolios; no token or P/I/T delta |
| `pause_group_custody_v2` | Group authority pauses/unpauses after vault reconciliation; cannot activate financial modes or alter account mode |
| `classify_group_surplus_v2` | Group authority explicitly assigns actual unallocated vault surplus to insurance, never a chosen trader |

For now **every** custody transition requires group mode zero, P=0 and T=0;
outflows also require both root position slots, funding checkpoints/generations,
nonce, reservations and the entire serialized order book to be zero. Delegate
must be absent at initial epoch 1. This is intentionally a phase-limited profile,
not an alternative exit path for later trading state. P18C/P19 introduce their
separate health/certificate-protected paths. No automatic family guarantee or
claim/fraction transfer is introduced.

Cash operations advance checked root state versions and a checked group event
sequence. `allocated_vault = total_cash + P + I + T`, and actual vault must be at
least allocated vault before/after token CPI. Overflow, insufficient donor cash,
invalid owner/mint/alias, paused or financial/frozen mode rejects atomically. An
unsolicited token transfer remains observable surplus until explicit classification.

## ABI and events

Existing V1 instruction/account/type/event/error IDL definitions are retained.
V2 has distinct account discriminators and seeds from P17. The generated SDK
adds nine instructions, five reachable account codecs and a separate
`GroupCustodyChangedV2` event. Codama disambiguates registry/vault PDA names as
`findInitializeGroupV2RegistryPda` and `findClassifyGroupSurplusV2VaultPda`;
V1 `findRegistryPda`/`findVaultPda` stay unchanged. Supply explicit V2 market
addresses derived from `[market-v2, group, u8 index]` where the generator cannot
infer the array-expression seed. Never substitute V1's BTC-only market helper.

The critical event binds group/domain/profile, ordered sequence/slot, operation,
actor/subject, immutable market keys, C/P/I/T/vault, and at most two affected
root identities/cash/version snapshots. `actual_vault=None` means that operation
did not read the token vault; zero is a real observed zero balance. Failed
transactions may contain reverted event-CPI bytes, which must not become committed
projection effects. Full PostgreSQL V2 projection remains P21A; V1 services reject
unrecognized group profiles rather than interpreting them as V1.

## Reproduce the scoped checks

```sh
source ops/env.sh
bash ops/build-group-custody.sh
pnpm typecheck
pnpm exec vitest run tests/rpc-contract/group-custody-conformance.test.ts
node --import tsx tests/rpc-contract/group-custody-svm.ts
bash ops/group-custody-smoke.sh
```

Build only the changed clearing artifact and explicit default rejection artifact,
using frozen dependencies and the pinned SBF toolchain. A fresh dependency checkout
needs the existing root and isolated legacy installs from P01; no new packages.
The supervisor starts a new offline loopback Surfpool at 50 ms slots, deploys the
actual successor binary, fetches all signatures/outcomes independently over RPC,
decodes WS/event/account data and compares live bytes with isolated legacy Anchor.
It shuts down only its own runtime. No private devnet configuration is used.

The shared signed cases exercise independent account allocation, literal expected
cash/token balances, wrong identity/authority/mint/bounds, same-transaction rollback,
surplus and pause. SVM adds 64 actual registrations, foreign-group allocation,
explicitly labelled/restored adversarial state corruption and default-profile
rejection. No successful financial effect is fabricated by direct account injection.
`tests/financial/group-custody-reference.py` independently reads pinned raw-byte
offsets and checks final ownership, cash, empty positions, membership and token
balance without importing Rust or SDK arithmetic.

Declare 400,000 CU; require measured ≤320,000 CU, ≤1,232 packet bytes and report
actual accounts/CU for each submitted scenario. These are custody budgets, not
cross trading/liquidation budgets or throughput. Raw captures remain local/ignored
under `.local/successor/` and `.local/group-custody/`. Actual committed results,
failures and source hashes belong in WORKLOG and the concise evidence summary.
