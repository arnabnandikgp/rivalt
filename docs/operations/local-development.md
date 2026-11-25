# Local development

Run commands from the repository root. The verified bootstrap is macOS arm64 with Python 3.12+, rustup, Apple Command Line Tools and Apple Containers for the digest-pinned PostgreSQL image. Surfpool, the application and the database run locally with test assets.

## Pinned toolchain

| Component | Version used |
|---|---|
| Host Rust / Cargo | 1.97.1 |
| Anchor framework / isolated CLI | 2.0.0-rc.2 |
| Agave CLI / cargo-build-sbf | 4.1.2 / 4.1.0 |
| Explicit SBF build | platform-tools v1.52, SBPF v0 |
| Surfpool / PostgreSQL | 1.7.0 / 18.6 |
| Node / pnpm | 24.22.0 / 10.23.0 |

The [tool download manifest](../../ops/toolchain-downloads.json), [Rust toolchain](../../rust-toolchain.toml), workspace lockfiles and isolated conformance lockfiles pin the dependencies. Legacy Anchor conformance lives in [its own client](../../tests/anchor-conformance/).

```sh
python3 ops/bootstrap.py
source ops/env.sh
npm install --prefix .tools/pnpm --ignore-scripts pnpm@10.23.0
rustup toolchain install 1.97.1 --profile minimal --component rustfmt,clippy
pnpm install --frozen-lockfile
```

For source builds that invoke the Anchor CLI, install the isolated CLI with `bash ops/install-anchor-rc2.sh`. The fresh demo installer reads the pinned source revisions directly from Git and verifies all four program binaries against the [SDK deployment table](../../packages/sdk/src/account-deployment.ts).

## Run the demo

```sh
source ops/env.sh
export RIVALT_DEMO_ROOT=.local/successor-demo
bash ops/build-demo-programs.sh
bash ops/demo.sh start
```

Open **http://127.0.0.1:18083**, select **Rivalt Local Demo**, and get test funds. Create a portfolio and margin account, deposit, review and sign a BTC or ETH trade. The receipt identifies the selected makers. The tab-scoped test wallet survives reload and loses its key when the tab closes.

Use the same `RIVALT_DEMO_ROOT` for `bash ops/demo.sh status` and `bash ops/demo.sh stop`. A fresh session selects `bounded-entry` and installs its programs at `.local/demo-programs/bounded-entry-settlement/`. Clearing and the two identical-to-prior maker binaries build from `b7e4458b`. The oracle fixture has its own pin. Alternative artifact directories must pass the same byte-length and hash checks.

Only one interactive demo can use the fixed ports. The supervisor limits a session to 60 minutes and stops on low disk. After stopping, `bash ops/demo.sh reset` stops the owned supervisor, removes that workspace’s disposable runtime and starts a fresh test venue. Choose a new root to preserve the previous runtime. Keep keys, logs, receipts and existing demo workspaces at their ignored paths. The qualification wrappers use separately owned PostgreSQL instances.

## Wallet load comparison

The signed load harness uses its own verified build manifest. It requires the P56 baseline artifacts for the oracle fixture and an execution-router test build from exactly `986b3cd3287ff0e99ae777a98c192792f8a91883`. For a new machine, use the [pinned baseline build recipe](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/local-development.md#pinned-toolchain). Build the router test artifacts with `ops/build-profit-attribution.sh` in a clean checkout at the router revision with `RIVALT_ATTRIBUTION_PROFILE=execution-router-qualification`. The [manifest check](../../tests/rpc-contract/execution-router-build.ts) validates the three binaries before the wrapper starts the chain.

From the workload checkout, set the artifact paths to those builds and use a new run directory for each arm:

```sh
source ops/env.sh
export RIVALT_ARTIFACT_DIR=.local/anchor-rc2/current
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/execution-router/build-search-counters
export RIVALT_ROUTER_REVISION=986b3cd3287ff0e99ae777a98c192792f8a91883
export RIVALT_SETTLEMENT_PROBE=execution-router-load
export RIVALT_LOAD_TRADERS=16 RIVALT_LOAD_OFFERS=72 RIVALT_LOAD_GAP_MS=100
export RIVALT_LOAD_BTC_PERCENT=90 RIVALT_LOAD_MAX_LOTS=8 RIVALT_LOAD_FIRST_MAKER_LOTS=1
export RIVALT_LOAD_REFRESH_MS=2800 RIVALT_LOAD_SEED=117
RIVALT_SETTLEMENT_ARM=offered-only RIVALT_RUN_DIR=.local/load-control bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_ARM=active RIVALT_RUN_DIR=.local/load-active bash ops/scalable-settlement-smoke.sh
python3 tests/performance/compare-router-load.py .local/load-control .local/load-active
```

The control waits for the trader originals to drain before starting settlement. The active arm overlaps settlement with the scheduled offers. To reproduce the 24-wallet comparison, use 120 offers, 35 ms gaps, 100% BTC, rotating asks, one shallow maker lot, a three-lot order maximum, 2,100 ms refresh and seed 117. Compare independent wallet preparation with confirmed predecessors, then repeat the confirmed arm with maker 1 storage sponsorship. The [harness](../../tests/rpc-contract/router-load-rpc.ts) defines the environment knobs. [Observed results](performance.md) · [Exact comparison commands](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/local-development.md#match-trading-load-with-and-without-profit-settlement)

## Fixed-width entry qualification

First provision the four P56 baseline binaries in `.local/anchor-rc2/current` in the program checkout. On a new machine, build them at `657a255` with `bash ops/install-anchor-rc2.sh` and `bash ops/build.sh`, then make that artifact directory available in the harness checkout too. Both the builder and the signed smoke check verify the baseline hashes. [Pinned toolchain and P56 build recipe](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/local-development.md#pinned-toolchain)

Build from a clean checkout of program revision `b7e4458b57a3a9bbb0906929a936094c78393b47` with `RIVALT_ATTRIBUTION_PROFILE=bounded-entry-settlement` and `bash ops/build-profit-attribution.sh`. From the harness checkout set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to that output directory and `RIVALT_ROUTER_REVISION` to the full program revision. Use a fresh `RIVALT_RUN_DIR` or leave it unset for each invocation.

```sh
RIVALT_SETTLEMENT_PROBE=execution-router-bounded-entry bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=execution-router-bounded-entry-inventory bash ops/scalable-settlement-smoke.sh
RIVALT_SUCCESSOR_BUILD=bounded-entry RIVALT_SETTLEMENT_PROBE=profit-attribution-successor-recovery \
  RIVALT_FROZEN_PLAN_PROOF=1 RIVALT_FROZEN_PLAN_CASE=paged-wallet RIVALT_RECOVERY_SCHEDULE_BUDGET=65536 \
  bash ops/scalable-settlement-smoke.sh
```

The three runs exercise closed-profit payouts, retained mixed-price maker inventory and complete two-market frozen settlement. Each ends at wallet withdrawal with fresh PostgreSQL replay. To compare against independent rational arithmetic, build `entry_cost_decisions` and `scalable-settlement-driver` using `cargo build --locked -p financial-core --features closed-quantity-model --example entry_cost_decisions --bin scalable-settlement-driver`, then run `python3 tests/financial/test_fixed_entry.py`.

## Closed-quantity payout qualification

Build the test artifacts in a clean checkout at `ec6f1ffa4b6a3a37b322a3411e934f474b88f997` using the P56 baseline artifacts described above. Set `RIVALT_ATTRIBUTION_PROFILE=closed-quantity-settlement` and `RIVALT_ATTRIBUTION_DIR` to a new output directory when running `bash ops/build-profit-attribution.sh`. From the workload checkout, set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to that output and `RIVALT_ROUTER_REVISION` to the full program revision. Choose a fresh run directory.

```sh
RIVALT_SETTLEMENT_PROBE=execution-router-closed-quantity RIVALT_RUN_DIR=.local/closed-quantity-lifecycle bash ops/scalable-settlement-smoke.sh
```

The probe leaves the ordinary 128-byte slots in place, checks open and excessive payments on a funded book, pays partial and final closes, withdraws tokens and replays the finalized transactions. [Measured results](performance.md#closed-quantity-settlement)

For the frozen nine-member BTC/ETH regression, use the same verified artifacts and a separate empty run directory.

```bash
RIVALT_SUCCESSOR_BUILD=closed-quantity RIVALT_SETTLEMENT_PROBE=profit-attribution-successor-recovery \
  RIVALT_FROZEN_PLAN_PROOF=1 RIVALT_FROZEN_PLAN_CASE=paged-wallet RIVALT_RECOVERY_SCHEDULE_BUDGET=65536 \
  RIVALT_RUN_DIR=.local/closed-quantity-recovery bash ops/scalable-settlement-smoke.sh
```

## Mixed-price maker storage

Use the verified clearing artifacts and full `RIVALT_ROUTER_REVISION` from [closed-quantity qualification](#closed-quantity-payout-qualification). Run the same BTC book twice, using a fresh directory for each. The first run uses the ordinary wallet compute limit. The second requests extra compute to isolate the storage boundary.

```bash
RIVALT_SETTLEMENT_PROBE=execution-router-mixed-storage RIVALT_MAKER_STORAGE_BUDGET=wallet \
  RIVALT_RUN_DIR=.local/maker-storage-wallet bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=execution-router-mixed-storage RIVALT_MAKER_STORAGE_BUDGET=diagnostic \
  RIVALT_RUN_DIR=.local/maker-storage-diagnostic bash ops/scalable-settlement-smoke.sh
```

Each run provisions two trader wallets and real maker capital, checks exact basis against an independent formula, and measures both sides of each signed round trip. Rejections must roll back economic accounts. After the last refusal the traders reduce the maker to flat, clearing collects the trader losses, and the owner withdraws the maker's principal and profit. The harness writes `mixed-maker-storage.json` after finalized RPC and fresh PostgreSQL replay agree. [Measured limits](performance.md#mixed-price-maker-storage)

## Fixed BTC order sizes

Use the two verified artifact directories and router revision from the wallet-load build above. Run the following from a clean tracked checkout with a new output directory. This probe owns its local Surfpool and PostgreSQL instances.

```sh
RIVALT_SETTLEMENT_PROBE=execution-router-notional RIVALT_RUN_DIR=.local/btc-notional-baseline bash ops/scalable-settlement-smoke.sh
```

The harness saves each published quote, signed simulation and finalized order in `notional-orders.json`. After checking payout, SPL balances and fresh database replay, it writes `notional-baseline.json` in the same ignored directory. It attempts the same six buys in order, including diagnostic broadcasts of refused simulations. [Conditions and results](performance.md#btc-orders-at-fixed-dollar-sizes)

Use [validation](validation.md) to select smaller checks. Historical proof experiments have separate artifact and helper bindings. Their commands are kept with the [original revisions](../HISTORY.md).

## Matched BTC fill benchmark

From a clean tracked checkout, set the pinned artifact directory and run each arm in a fresh local venue. Use the fixed-width artifact build described under [fixed-width entry qualification](#fixed-width-entry-qualification). The smoke wrapper creates a unique run directory automatically. Run the commands sequentially to reuse the default ports.

```sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/bounded-entry/build-b7e4458b
export RIVALT_ROUTER_REVISION=b7e4458b57a3a9bbb0906929a936094c78393b47
export RIVALT_SETTLEMENT_PROBE=execution-router-bounded-entry-benchmark
RIVALT_BENCH_ARM=routed bash ops/scalable-settlement-smoke.sh
RIVALT_BENCH_ARM=explicit bash ops/scalable-settlement-smoke.sh
```

Each run retains its signed originals, simulations, finalized RPC and WS records, PostgreSQL reconciliation and `depth-benchmark.json` locally. The latter records each offer, the independent optimal allocation for the fixture’s flat price regions, the signed limit, and the actual outcome. When a pair of makers can supply the size, both transaction alternatives are signed and simulated at the same confirmed slot before broadcasting the designated one. When the size exceeds every pair, both runs submit the wallet’s routed original so the refusal has a receipt.

To repeat against the funded-routing candidate, build program revision
`e02e72a06a16c36cd2b843ca373895e3fbd23927` with the same
`bounded-entry-settlement` Cargo feature. Point `RIVALT_SETTLEMENT_ARTIFACT_DIR`
at that build, set `RIVALT_ROUTER_REVISION` to its full revision and use
`RIVALT_SETTLEMENT_PROBE=execution-router-funded-benchmark`. The routed run
checks every signed outcome against the independent reference, including both
ETH limits while maker zero has one collateral atom.

Run `python3 tests/performance/depth-benchmark-report.py ROUTED_RUN EXPLICIT_RUN` to summarize both completed directories. Read `ordinaryBtc` for requested and filled dollars at the index (atom totals use six decimals) and `dollarOrders` for each signed limit, average fill price, dollar cost versus the index, taker fee and refusal. An order with no fill has zero executed notional and a null execution price. The supplementary CU differences use two successful simulations on the same bank. `source ops/env.sh && node --import tsx tests/rpc-contract/depth-benchmark-reference-check.ts` checks the independent reference against exhaustive allocation on 216 small books and orders.

## Wide maker discovery and fills

Build clearing revision `5e32c124f078902535c6e40a02419f797550e89a` with
`RIVALT_ATTRIBUTION_PROFILE=wide-maker-discovery` and an empty
`RIVALT_ATTRIBUTION_DIR` using `bash ops/build-profit-attribution.sh`.
At harness revision `951adeea` or its compatible stack head, set
`RIVALT_SETTLEMENT_ARTIFACT_DIR` to that directory, `RIVALT_ROUTER_REVISION`
to the full program revision, and `RIVALT_SETTLEMENT_PROBE=execution-router-wide-fills`.
Run `bash ops/scalable-settlement-smoke.sh` with the standard local oracle
artifacts and Apple container PostgreSQL available. The run retains its signed
originals and `wide-fills.json` under the ignored run directory.

For wider atomic fills use clearing `f0b8a599c24bde303d7ce9a8eb74bd1ffd86a85a`, build profile `wide-atomic-routes` and harness `c5d51f9c` or its compatible stack head. Run the same supervisor with probes `execution-router-multi-fills` and `execution-router-multi-width` in separate fresh directories. The first checks the fragmented fill, final-maker rollback and insurance allocation. The second checks four and eight real maker fills and journal replay.

### Matched dollar comparison

Use the same `wide-atomic-routes` program revision and artifact directory as the wider-fill check. Use wallet and harness revision `0edb3064` to reproduce depth-aware shortlisting. The previous comparison used `22814361` on the same clearing program. Each cell starts a fresh BTC book and PostgreSQL database. From the repository root, with the pinned artifact paths configured, run the following sequentially. Set a fresh result directory for each comparison.

```bash
source ops/env.sh
export RIVALT_ROUTER_REVISION=f0b8a599c24bde303d7ce9a8eb74bd1ffd86a85a
export RIVALT_SETTLEMENT_PROBE=execution-router-matched-makers
comparison_dir=.local/matched-makers-depth-aware
for makers in 16 32; do
  for legs in 2 4 8; do
    RIVALT_COMPARISON_MAKERS="$makers" RIVALT_COMPARISON_LEGS="$legs" \
      RIVALT_RUN_DIR="$comparison_dir/$makers-$legs" \
      bash ops/scalable-settlement-smoke.sh || exit 1
  done
done
node --import tsx tests/rpc-contract/comparison-reference-check.ts
python3 tests/performance/matched-maker-report.py "$comparison_dir"/{16,32}-{2,4,8}
```

The report checks each signed signature, fee and outcome against its retained finalized transaction. It also counts requests the wallet refused before signing. For each request it gives the same-bank full-directory price, the full-directory price at the leg cap, and the signed shortlist price. Each is fee-inclusive and requires the entire requested quantity. The constant-price reference independently enumerates maker subsets and measures quoted depth under each constraint. Clearing checks funding and margin when a signed order executes. A null reference means the requested size exceeded that book's capacity.

The trace uses a fixed $61,000 test BTC index, 65,000-lot asks and 6,000- or 40,000-lot bids per maker before the deep-book replacement. It also reprices a maker outside the already signed shortlist, installs a one-million-lot book, replenishes two consumed books, and offers two independent wallet orders concurrently. Each later order encounters the inventory and consumed depth left by its own cell's earlier fills. Confirmed latency includes simulation, WS subscription and local RPC. The two-wallet rate covers a single batch. The indexer replays the finalized venue into a fresh PostgreSQL database.
