# Deployment identities and operator lifecycle

## Supported boundary

The current qualified profile is explicit local `liquidity-execution-qualification`.
Pin actual clearing/maker A/maker B/oracle-fixture binaries, IDLs, domain/mint/venue,
registry, genesis, initialization signature/hash and resource settings in an explicit
manifest. Public configuration cannot replace the SDK's executable allowlist.
Qualify fresh build hashes before promoting them; preserve previous deployment
manifests and unresolved original transactions.

Earlier custody-only, successor, account-trading/cash/safety and devnet
profiles use their original clients at the historical baseline, not this active
source tree. Never combine local and
devnet features. The latest profile cannot be enabled on devnet by pointing a local
launcher at a different URL. Previously tested Pyth sponsored Core accounts and
Phantom registration belong to the older devnet implementation, not current parity.
No production, funded or new cluster deployment follows from repository cleanup.

Source renaming preserves current account/argument/meta/discriminator/seed/error
contracts unless an explicitly reviewed migration says otherwise. It changes code
hashes even if financial bytes are identical. Existing deployments stay untouched.
Old-to-new migration requires actual admissible withdrawal/deposit; open positions,
unpaid claims/fractions, orders, fees/reserves and signed originals never migrate
by relabeling database rows. Keep any needed compatibility reader explicitly scoped.

## Running an operator against an explicit deployment

Create a private JSON file (`chmod 600`) containing `schemaVersion: 4`,
`operatorClass: "internal-reference"`, `deployment`, `runId`, `databaseEnv`,
`signerPath`, `signer`, `role`, `marketIndex` and, for a maker, `instance`.
`deployment` is the public `AccountUserConfig`: version 4, local chain/profile,
RPC/WS URLs, genesis, actual initialization signature/hash, venue, mint and domain.
Copy it from the deployment operator's explicit configuration, never infer these
identities from whichever process happens to occupy an RPC port. `databaseEnv`
names the environment variable containing the database URL; credentials and signer
bytes never belong in the public configuration. The key file is also mode 0600.

```sh
source ops/env.sh
pnpm liquidity:bot /absolute/private/operator.json
```

The operator validates the local deployment's executable hashes, chain, anchor,
venue and database binding before starting. A PostgreSQL advisory lease admits one
process for a market/instance role. The executor runs separately using
`packages/services/src/account-executor-main.ts`, the same database/run ID/RPC and
`RIVALT_ACCOUNT_PROFILE=liquidity-execution-qualification`. The finalized indexer
uses `packages/indexer/src/main.ts` with the explicit profile, venue and
initialization signature. `RIVALT_ACCOUNT_ROLE=funding` is a separate restricted
publisher role, with no maker instance. Do not use an owner/custody key as its signer.

## Capital, quoting and permissions

The signed provisioning example is
`tests/rpc-contract/liquidity-execution-setup.ts`; canonical registration/control
examples are in `tests/rpc-contract/canonical-maker-cases.ts`. These use the public
generated SDK and real instructions, not injected account balances. Production
token accounts, funds, upgrades and independent admissions are outside this kit.

- Owner: create/fund an isolated capital account, approve the reviewed program,
  register its instance, set shape/updater permissions and explicitly replenish
  declared depth. Admission and code approval retain their joint authority checks.
- Updater: only `Reprice` under current control epoch and expected price sequence.
  It cannot replenish consumed depth, alter shapes/permissions or withdraw cash.
  This reference strategy reanchors to the admitted independent index. It is not a
  profitability model. Reads and quotes have no protocol tariff.
- Funding publisher: compute complete three-maker published depth and retain the
  raw inputs before a durable submission. Reports target two-second cadence and
  have the existing short validity/hold bounds. Configuration authority can rotate
  or revoke this signer. A digest identifies inputs; it does not prove honesty.
- Executor: broadcast only persisted signed originals under separate lamport
  budgets. Restart does not create a replacement signature. Confirmed errors and
  ambiguous/missing history remain distinct; only resolved failures allow a fresh
  attempt. Collateral, protocol fees and insurance do not pay worker network fees.

For key rotation, stop the old role, resolve every signed original and its network
fee, then authorize the new key on-chain. Update the private operator configuration
and run `pnpm liquidity:bot /absolute/private/operator.json handover` before starting
the new worker. This explicit local handover preserves the existing role's lifetime
cap and spent amount; it cannot reset its allowance or release pending reservations.
It verifies the current on-chain publisher/updater authority and refuses unresolved
originals. Revocation alone never transfers a fee budget to an arbitrary key.

`readAccountTradeSnapshot` and `buildLiquidityRoute` expose authenticated books
and current whole-account trade admission. `readFundingReport` calculates published
funding depth without hypothetical maker margin checks. These are intentionally
different promises. `/v4/operators` reports daemon state; heartbeat loss alone does
not invalidate an otherwise live on-chain book. `/v4/quote` includes chosen
instances, expiry, gross/all-in values and classified unavailability.

## Reconciliation, economics and exit

`liquidityMakerEconomics` consumes a contiguous finalized event window and independently
recreates provider inventory, funding, cash and claim changes using integer
arithmetic. It reports fills, actual attributed updater fees, funded P&L, unpaid
marked claims and explicit unobserved hedge-cost assumptions. It rejects incomplete
history, unknown effects and exceptional default windows; default requires the
separate complete-resolution audit. Network fees are lamports and are not silently
converted into collateral. Shared publisher/setup/rent costs must be labelled
separately from per-instance updater costs. Positive unpaid profit is not margin
or withdrawable cash.

```sh
pnpm liquidity:report /absolute/captured-input.json /absolute/new-report.json
```

Normal exit: stop new aggressive exposure, use owner controls to disable quoting,
cancel capital-account orders, close remaining positions through an admissible
route, settle collectible losses and eligible funded gains, and use
`AccountUserClient.exit` for admissible own-cash withdrawal. Disabling or revoking
an updater does not erase inventory, claims or funding. Maker-free direct cash exits
do not depend on either HTTP service. A disabled maker interrupts the fixed
complete-coverage funding set: plan the test venue's controlled recovery rather
than silently omitting it. Unpaid claims can remain after positions are flat;
there is no guaranteed payout or automatic claim-to-cash conversion.


## Recovery and terminal operations

Unknown transaction history retains the original and fee reserve; restore final
history or use only the explicitly qualified nonexecution proof. Worker heartbeats,
simulation success or a missing RPC response are insufficient. For default, inspect
current frozen chain stages; resume exact upload/verification/order/circulation/
apply/reconcile without reconstructing a different claimant subset.

Authority resume requires complete reconciliation and sustained qualified source
recovery, returns to Custody, and separately requalifies/reactivates. Retirement is
irreversible; only after complete liability discharge can the stored reserve
recipient receive insurance under reserve authority. Consult the exact
[risk/default contract](../clearing/risk-and-resolution.md) before these actions.
