# P33 — canonical maker operator kit

This kit runs internal reference makers on the explicit local profile 4. It does
not onboard an independent operator, execute a hedge or authorize funded deployment.
The two markets, one test mint, three instances per market and two-maker route
limit are fixed. Every maker capital account remains isolated to one market.

## Fresh local qualification

Browser qualification requires an installed Chromium-based browser; the locked
`playwright-core` dependency does not install one. Before running the harness,
set `RIVALT_CHROME_PATH` to an installed executable (for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on this Mac), or
install the Chromium revision expected by the locked Playwright version into its
browser cache. Omitting the variable uses that already installed cached browser.
No macOS-specific path is required on other hosts.

Use a checkout of the recorded P33 revision, the locked dependencies and the exact
[validation stack](04-STACK-AND-VALIDATION.md). From the repository root:

```sh
source ops/env.sh
pnpm install --frozen-lockfile
bash ops/build-liquidity-execution.sh
pnpm build:trader
bash ops/liquidity-services-smoke.sh
```

The build must match `packages/sdk/src/liquidity-artifacts.ts`; do not change those
pins to accept an unexplained binary. The scoped launcher creates a fresh offline
Surfpool deployment and an owned PostgreSQL instance, provisions real test token
accounts, isolated maker capital, curves, sources and publisher authority through
signed transactions, then starts the actual durable workers and browser. It stops
owned processes on exit. Raw transactions, protected test keys, logs, database and
reports stay at the printed ignored run path. No retained evidence file is a
runtime deployment configuration. Existing qualified artifacts may be reused when
their exact hashes match; doing so is not a fresh compiler qualification.

## Running an operator against an explicit deployment

Create a private JSON file (`chmod 600`) containing `schemaVersion: 4`,
`operatorClass: "internal-reference"`, `deployment`, `runId`, `databaseEnv`,
`signerPath`, `signer`, `role`, `marketIndex` and, for a maker, `instance`.
`deployment` is the public `LiquidityUserConfig`: version 4, local chain/profile,
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
uses `packages/indexer/src/account-main.ts` with the explicit profile, venue and
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
- Updater: only `RepriceV4` under current control epoch and expected price sequence.
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

`readLiquidityTradeSnapshot` and `buildLiquidityRoute` expose authenticated books
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
`LiquidityUserClient.exit` for admissible own-cash withdrawal. Disabling or revoking
an updater does not erase inventory, claims or funding. Maker-free direct cash exits
do not depend on either HTTP service. A disabled maker interrupts the fixed
complete-coverage funding set: plan the test venue's controlled recovery rather
than silently omitting it. Unpaid claims can remain after positions are flat;
there is no guaranteed payout or automatic claim-to-cash conversion.

P33 evidence and WORKLOG record which of these executable checks actually passed.
P34 adds the final comparative workload; P15B/P16B and deferred endurance remain open.
