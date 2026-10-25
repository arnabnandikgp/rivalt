# Reference maker integration kit

This kit operates the existing A/B pricing programs against Rivalt common clearing. Both makers are **internal reference operators**. The local sources and collateral are synthetic test fixtures. No external hedge is executed, and no independent maker or funded-pilot qualification follows from running it.

## Fresh operator setup

The verified bootstrap target is macOS arm64 with Python 3.12+, rustup and the existing Apple container runtime. Follow the prerequisite installation in [P01](P01-SPINE.md); Docker Desktop is not required. Other host platforms need their own audited tool downloads and runtime qualification. Exact downloads are checksum-pinned in `ops/toolchain-downloads.json`, Rust in `rust-toolchain.toml`, dependencies in the two lockfiles, and PostgreSQL 18.6 by image digest in `ops/postgres.sh`.

In a fresh checkout of the recorded P15A revision:

```sh
python3 ops/bootstrap.py
source ops/env.sh
npm install --prefix .tools/pnpm --ignore-scripts pnpm@10.23.0
rustup toolchain install 1.97.1 --profile minimal --component rustfmt,clippy
pnpm maker:build
pnpm maker:qualify
```

`maker:build` installs frozen dependencies and builds only clearing's `local-test-profile`, maker A, maker B and the signed oracle fixture with SBF v1.52/arch v0. It generates public deterministic **local-only** deployment keys. Never fund those keys on a shared cluster. It does not run inherited financial/browser/load suites or regenerate the SDK from a different IDL.

`maker:qualify` starts a new offline Surfpool 1.6.1 chain at 50 ms/slot and an isolated PostgreSQL 18.6 container/database. Required free loopback ports are 18899/18900, 15432, 18081/18083 (the shared supervisor also reserves UI ports 18084). It deploys the four explicit `target/deploy/*.so` files, provisions real local SPL/SOL balances, launches separate bots plus indexer/API/executor/funding/settlement, and submits actual signed transactions. No prior evidence dump, devnet credential, private development key, web wallet, paid feed or hedge venue is required. Deployment artifact hashes, revision/dirty state and installed tool versions are recorded. An operator can reuse an explicitly supplied matching build/tool cache; disclose that reuse instead of claiming fresh downloads or compilation.

The bounded workflow exercises both bot epoch renewals, SDK maker deposit, a two-maker fill, causal funding, close/rebalance, collection/funded settlement, venue-authorized quarantine, complete-cohort proofs and a one-atom owner withdrawal from each maker. It checks the exact token/cash changes, all original signed outcomes and actual maker SOL fees against the indexed report, then runs a separate Python aggregate-accounting audit. Initial quote epochs last 1,024 slots so publication is exercised; subsequent bot epochs use the existing 3,600-slot duration. No oracle, margin or fee rule is relaxed. Unsigned quote refusals and signed failures are retained separately. A signed failure/unknown outcome fails the run; the harness never silently replaces it with another signed action.

Raw results stay under the newly printed `.local/maker-qualification/<run>/` path, ignored by Git. The supervisor stops only its own processes/container; PostgreSQL data and logs stay at that path. Failed runs remain failed. This is an ordinary lifecycle check, not a throughput, endurance, default or independent-operator test.

## Configuration and running the bot

The harness writes `maker-a-config.json` / `maker-b-config.json` and matching owner files with mode 0600. For an explicitly configured test deployment, create the same schema in a private local file:

```json
{
  "schemaVersion": 1,
  "operatorClass": "internal-reference",
  "chain": "solana:localnet",
  "rpcUrl": "http://127.0.0.1:18899",
  "databaseEnv": "RIVALT_DATABASE_URL",
  "signerPath": "/absolute/private/maker-owner.json",
  "runId": "existing-indexer-run-id",
  "makerId": 0,
  "owner": "REPLACE_WITH_REGISTERED_OWNER_PUBLIC_KEY",
  "market": "REPLACE_WITH_DEPLOYED_MARKET_PUBLIC_KEY",
  "domain": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS_FROM_MARKET",
  "budgetProfile": "smoke"
}
```

The placeholders intentionally fail validation. `chain` permits only the selected local/devnet test deployments. A private devnet RPC may be supplied locally, but this phase's qualification is local. The database environment variable must refer to the existing indexer run; do not paste credentials into tracked config or logs. `runId`, genesis, initialization transaction, market, stored domain, maker ID and actual signing owner must all agree. A renamed profile does not redefine the market domain.

```sh
chmod 600 /absolute/private/maker-config.json /absolute/private/maker-owner.json
pnpm maker:bot /absolute/private/maker-config.json
```

The bot uses the existing `Runtime.maker` implementation, observing capital/inventory and publishing only after actual epoch expiry. It submits signed publication+sync intents to PostgreSQL; a separately running `services` executor broadcasts/reconciles those immutable bytes. Its first failure in each outage logs a bounded reason with the configured database URL and incidental URLs redacted; repeated failures stay quiet until recovery. The run also requires the indexer and appropriate funding/source services. The current reference deployment shares the venue database and executor: this is not an isolated multi-tenant or independently operated production service.

Maker A/B each have a 1,000,000-lamport fee cap in `smoke`; operator funding/settlement budgets are distinct. Each pending operator intent reserves 20,000 lamports until actual finalized fees or proven nonexecution resolve it. The bot does not silently increase caps, top up SOL, sign another participant's action or charge network costs to collateral. See [the queue/retry contract](P06-LIFECYCLE.md). SIGINT/SIGTERM stops discovery, not already signed intents or standing on-chain quote authority.

## Permissions, funding and SDK integration

| Step | Authority and code |
|---|---|
| Register participant | Owner signs `sdk.getRegisterParticipantInstructionAsync`; the participant PDA binds owner and market |
| Initialize pricing config | That same owner signs `sdk.makerA` / `sdk.makerB.getInitializeConfigInstructionAsync`, using the **stored market domain** and that participant as capital |
| Fund capital | Owner signs `sdk.getDepositInstructionAsync` from their classic SPL account with the market's six-decimal test mint; SOL for rent/fees is separate |
| Admit maker | Owner and venue authority sign `sdk.getRegisterMakerInstructionAsync`; the selected module/config/ProgramData/capital binding and 100,000-lot profile inventory limit are explicit |
| Publish/sync | Owner publishes an expired curve epoch and synchronizes it atomically; early publication cannot reset consumed depth |
| Route/rebalance | `Runtime.quote` supplies an unsigned offer; `UserClient.validateQuote` checks the confirmed snapshot before owner signing. A maker taking another maker's liquidity pays the same 2 bps taker fee |
| Settle/withdraw | Permissionless loss collection and eligible funded settlement use existing rules; owner withdrawal requires an up-to-date complete-cohort proof |
| Stop new quoting | Stop the bot, resolve signed intents, and coordinate venue-authorized quarantine or wait for actual epoch expiry. Heartbeat loss alone does not revoke standing authority |

[Executable SDK examples](../packages/maker-kit/src/examples.ts) construct publication/sync and deposit instructions for the exact registered owner. [The qualification runner](../tests/rpc-contract/maker-kit.ts) shows independently validated quotes, original-wire persistence/finality recovery and `UserClient.exitInstructions` with separate cohort proof and withdrawal transactions. [Provisioning](../tests/rpc-contract/oracle-cases.ts) contains the real participant/config/funding/admission sequence used by the fresh lab; it is fixture provisioning, not simulated success. Two distinct program IDs/owner keys remain under our control.

Maker CPI receives a read-only config and no vault signer or arbitrary clearing writables. Changing the approved pricing code requires joint upgrade/approval controls. There is no implemented owner key-rotation or maker deregistration instruction in this kit; do not promise either. Quarantine does not erase obligations or remove a participant from the complete cohort. Pricing is the existing fixed A/B reference curve, not an adaptive or external-hedging strategy.

## Economics and reconciliation

Take an opening checkpoint before activity, then capture the same owner/run:

```sh
pnpm maker:record checkpoint /private/maker-config.json /private/opening.json
pnpm maker:record capture /private/maker-config.json /private/capture.json /private/opening.json 5
pnpm maker:report /private/capture.json /private/recomputed-report.json
python3 tests/maker-kit/audit.py /private/capture.json
```

Output paths must be new; files are mode 0600. Capture rejects an opening checkpoint whose owner or capital differs from the configured maker, before reading its economics or writing a report. Capture reads projection, contiguous finalized events, transaction fees and reservations in one repeatable-read PostgreSQL snapshot. The pure TypeScript reporter does not call SDK pricing/settlement helpers. It rejects missing/duplicate/reordered effects, foreign bindings, failed-transaction events and endpoint mismatches. Liquidation/default events intentionally reject: their economics need a separate attributed model, not an ordinary-lifecycle result.

All financial JSON uses decimal integer strings. One quote token is 1,000,000 atoms, one BTC is 1,000,000 base lots, and scaled P&L has a further 1,000,000,000 denominator. Reports contain each fill/side/provider-or-taker role, notional, final inventory, cash, capital deposits/withdrawals, actual collected losses/settled gains, accrued funding and remaining unpaid P&L. Funding is a component of P&L, not added twice. Capital injections are excluded from profit. Positive unpaid profit never becomes cash or margin credit merely because it is reported.

References captured from historical finalized state are conservatively labelled `stale`; report valuation is not authorization to trade/withdraw. Without a reference an exposed mark is null. Materialized funding is explicit: the report does not invent a live accrual beyond its checkpoint. Flat accounts may retain fractional unpaid claims after all whole-atom settlement.

Network costs are actual finalized venue transaction fees paid by the maker, including failed transactions, plus separately reported still-reserved fees. The interval excludes prior setup/rent and unrelated wallet transactions. Lamports are not converted into collateral P&L using an invented SOL price. The qualification independently compares those fees to actual maker SOL deltas. Operator/source costs are separate funded budgets.

The final `5` in the capture command is an explicit hypothetical **5 bps cost on every venue fill**. It is labelled not observed and not deducted from reported P&L. It excludes hedge slippage, financing and inventory basis. No simulated hedge establishes independent economics; P15B remains Open.

## Exit and incident procedure

Stop new quoting and inspect unresolved signed intents before any new action. Reconcile the original signature over finalized RPC; preserve the same wire/reservation while unknown. Do not manually replace the job or clear its fee reservation. An RPC/indexer mismatch closes readiness; restore/rebuild the indexer under its original run binding and recheck actual chain state.

Close inventory using admissible quotes from another maker; liquidity/health/source constraints can prevent immediate execution. Collect whole losses, settle eligible funded gains and retain unpaid fractions. Obtain current complete-cohort proofs and withdraw only admissible funded cash using direct RPC/SDK if the API is down. Proof and withdrawal must be separate transactions because a proof's participant accounts are read-only. Intervening sequence/observation changes require a fresh proof. A stale exposed cohort or distress can block ordinary exit; use the existing incident/resolution procedure, never weaken the oracle or margin checks.

The qualification withdraws one atom per maker to prove authorization/token movement while leaving remaining funded cash in the test venue. It does not claim full liquidation of capital, deregistration, continuous availability, independent validation or funded readiness. P16A owns the separate availability diagnosis and targeted operational follow-up; 24-hour endurance stays Deferred under D42.
