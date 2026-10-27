# Operating the account-centric local test profile

Use the exact qualified schema-3 deployment and explicit configuration. V1/V2
commands remain available for their existing profiles; their evidence does not
qualify a new schema-3 deployment. This guide does not authorize devnet/funded
operation, an independent maker or an external hedge.

## Fresh reproducible engineering check

From this repository with the pinned toolchain, qualified local artifacts and
Apple Containers running, and Google Chrome installed at the harness's explicit
macOS application path. On a fresh checkout, first follow [P01 setup](P01-SPINE.md),
install frozen dependencies with `pnpm install --frozen-lockfile`, and create the
qualified artifacts with `bash ops/build-account-safety.sh`. Clients require their
exact pinned identities; a different build is not silently accepted. The P28
runtime used retained, verified P26 artifacts and did not repeat that build.

On the prepared environment:

```sh
source ops/env.sh
pnpm --filter @rivalt/trader build
bash ops/account-indexer-smoke.sh --qualification
```

Keep the host awake and its lid open. The wrapper's finite macOS idle-sleep
assertion does not override explicit clamshell suspension.

The wrapper deploys fresh local programs, creates an isolated PostgreSQL database,
provisions explicitly synthetic accounts, runs the real browser/workload/recovery
checks and stops only its owned runtimes. The qualification is finite, not an
interactive server or an endurance test. Captures stay ignored at the printed
local path. A prior run's captures are never runtime deployment configuration.

## Existing explicitly configured local deployment

Run each process in its own terminal with the same private environment file
(mode 0600). Configure `RIVALT_RPC_URL`, `RIVALT_WS_URL`, `RIVALT_DATABASE_URL`,
`RIVALT_RUN_ID`, `RIVALT_VENUE`, `RIVALT_INIT_SIGNATURE` and
`RIVALT_ACCOUNT_PROFILE=account-safety-qualification` from that deployment.
Never put database credentials or signers in the public UI JSON. In **each**
process terminal, load the trusted private deployment file and export its variables
before running that terminal's process command (replace the example path):

```sh
source ops/env.sh
set -a
source /absolute/path/to/private-account-deployment.env
set +a
```

The private file must use shell assignment syntax and mode 0600. `ops/env.sh`
selects tools only; it does not load deployment credentials. Then start the indexer:

```sh
source ops/env.sh
node --import tsx packages/indexer/src/account-main.ts
```

The indexer read API defaults to `http://127.0.0.1:18092`. `/ready` reports whether
finalized reconciliation is current; `/live` only reports that the process lives.
Run the separate execution API and immutable-original executor:

```sh
node --import tsx packages/services/src/account-service-main.ts
node --import tsx packages/services/src/account-executor-main.ts
```

The execution API defaults to port 18093. Do not run those two commands sequentially
in one blocking terminal: each is its own long-lived process. Worker entrypoint:

```sh
node --import tsx packages/services/src/account-worker-main.ts
```

Set `RIVALT_ACCOUNT_ROLE` to `maker`, `funding`, `orders`, `settlement` or `risk`.
Each worker needs `RIVALT_SIGNER_PATH` pointing to its private mode-0600 test key.
Maker workers additionally require `RIVALT_MARKET_INDEX` and `RIVALT_MAKER_ID`
(0 or 1); funding requires a market index and accepts a 2–5 second cadence.
Four maker bindings and two funding processes cover BTC/ETH. The optional
`RIVALT_RECEIVER_MARGIN` for a risk worker must be a funded account owned by its
explicitly consenting signer. Without it, no liquidation receiver is inferred.
Protocol authority resume/reactivation is a separate explicit action. The owner UI
shows registered maker-capital and liquidation-receiver slots with their funded
cash and role labels. These slots do not enable the trader ticket; cash actions
still require current SDK preparation and on-chain admission.

Configure a public `RIVALT_TRADER_CONFIG` JSON with version 3, local chain/profile,
credential-free RPC/WS URLs, venue/mint/domain and exact genesis/initialization
signature/hash. Launch the trader with explicit service origins:

```sh
RIVALT_TRADER_CONFIG=/absolute/path/to/account-deployment.json \
RIVALT_SERVICE_ORIGIN=http://127.0.0.1:18093 \
RIVALT_INDEXER_ORIGIN=http://127.0.0.1:18092 \
pnpm --filter @rivalt/trader dev
```

Open `http://127.0.0.1:18083`. Select a portfolio and cross/isolated account.
Connect a compatible **local test** wallet; the automated qualification instead
uses the labelled instrumented Wallet Standard signer. Configure the instrumented
signer only in the qualification harness, never in a public application.

## Recovery and limits

Saved wallet originals are retained by wallet and deployment. An uncertain
acknowledgement is not permission to sign a replacement: reconcile its original
signature, or resend exactly the saved bytes while valid. An unseen expired
operator transaction may retain its fee reservation; no missing-history refund
is invented. Inspect the queue and actual original before intervention.

Maker expiry requires publication followed by clearing synchronization. A renewal
gap can refuse new quotes and close attempts; retain and label those attempts.
Source restrictions still apply to required exposed markets. API loss alone does
not block direct cancellation or an admissible funded withdrawal over RPC.
Custody totals and per-market settlement/insurance/fees must reconcile before
an indexed projection is considered healthy. Never force an unhealthy projection
ready, edit balances or skip default rows to restore availability.

Ordinary profit payment and explicit claim netting still need a complete current
selected-market backing certificate. Sampling and live maker inventory can delay
that proof/payment. A positive unpaid claim must remain labelled unpaid until an
actual certified payment moves funded cash. The busy-exit qualification covers
admissible own-cash withdrawal; it does not promise uninterrupted profit payout.

The fresh qualification report owns measured limits. Current provisional inputs
include two markets/one mint, 64 roots, bounded order books and routes, additive
risk without correlation discounts, no positive unpaid-profit credit, 2 bps
collected taker fees and a 25% originating-market insurance share. These are test
assumptions, not calibrated funded-market guarantees. P15B/P16B remain external;
24-hour endurance remains Deferred.
