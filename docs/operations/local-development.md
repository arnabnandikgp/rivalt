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

### Closing a position through wallet withdrawal under load

Use the bounded-entry test deployment and baseline artifacts described under [Fixed-width entry qualification](#fixed-width-entry-qualification). Run the two arms sequentially on the same machine with fresh supervised Surfpool and PostgreSQL instances.

```bash
source ops/env.sh
export RIVALT_SETTLEMENT_PROBE=execution-router-bounded-entry-cashout
export RIVALT_ROUTER_REVISION=b7e4458b57a3a9bbb0906929a936094c78393b47
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/bounded-entry/build-b7e4458b
run=".local/close-to-wallet/$(date -u +%Y%m%dT%H%M%SZ)"
for arm in trader worker; do
  RIVALT_CASHOUT_ARM="$arm" RIVALT_RUN_DIR="$run/$arm" bash ops/scalable-settlement-smoke.sh || exit 1
done
python3 tests/performance/close-to-wallet-report.py "$run/trader" "$run/worker"
```

Each venue starts with a current BTC backing certificate and two independently funded traders holding 1,000 lots each. A signed collection funds 1.5 of their two equal claims before the close. Four other wallets submit 48 ten-lot BTC and ETH orders. Four waves of four start at 160 ms intervals, then 32 offers arrive at 750 ms intervals starting at 2.3 seconds. The report counts fills in slots strictly between each close and token withdrawal. In the trader arm each owner submits their own payout and can collect the remaining cash from the known debtor. In the worker arm the settlement service chooses what to collect and whom to pay. In both arms the owner withdraws the net profit once their entire claim is credited. Confirmed account reads time the stages. The harness separately checks signed originals over RPC and WebSocket and reconciles the final state and event history in fresh PostgreSQL. The report includes every designated creditor at each cutoff.

To compare worker policies, run the `worker` arm at each revision with the same observation harness. The collection-first control used the tree of `257ba582` with only `tests/rpc-contract/close-to-wallet-rpc.ts` from `6434dafa`. The final worker ran at `efff1af2`. Compare the two completed run directories with `python3 tests/performance/close-to-wallet-report.py --workers BEFORE_RUN AFTER_RUN`. The worker arm continues observing after wallet exit until the 48 orders have completed and covered losses on both markets have drained, subject to the 120-second follow-up.

To follow the ETH maker through its first complete backing check, use the same exports above and a fresh run directory. The worker keeps polling after the 48 offers, with a six-minute observation limit from the later BTC close. The report reads the original finalized fill events and reconciles the ETH spread to the maker’s payment and ending position.

```bash
RIVALT_CASHOUT_ARM=worker-eth-exit RIVALT_RUN_DIR="$run/worker-eth-exit" bash ops/scalable-settlement-smoke.sh
node --import tsx tests/performance/cold-maker-exit.ts "$run/worker-eth-exit"
```

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

For the price-collar and aggregate-fee regressions, build `wide-atomic-routes` at `b0e1a43f22699bb67335011ef7acfb2edf48b0d2`. Set `RIVALT_ROUTER_REVISION` and `RIVALT_SETTLEMENT_ARTIFACT_DIR` to that revision and its build directory. Run the supervisor once with `RIVALT_SETTLEMENT_PROBE=execution-router-multi-price-limits` and once with `execution-router-multi-width`, each in a fresh run directory. The first verifies signed fills and one-atom refusals. The second requires both widths to fill and replay.

### Comparing debtor coverage during the cold ETH payout

Build the local observation profile from clean clearing revision `ce9e8e9c82a4643abcd44135ed3a6214815ffb00` with the qualified base artifacts present. The program files also reproduce byte-for-byte from `3c7c6fe7`. Run the workload from the harness revision recorded in [the scorecard](qualification-scorecard.md#clearing-owned-coverage-during-a-cold-eth-payout).

```bash
RIVALT_ATTRIBUTION_PROFILE=shadow-coverage \
  RIVALT_ATTRIBUTION_DIR=.local/shadow-coverage/build-ce9e8e9c bash ops/build-profit-attribution.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/shadow-coverage/build-ce9e8e9c
export RIVALT_ROUTER_REVISION=ce9e8e9c82a4643abcd44135ed3a6214815ffb00
RIVALT_SETTLEMENT_PROBE=execution-router-shadow-coverage RIVALT_CASHOUT_ARM=worker-eth-exit \
  bash ops/scalable-settlement-smoke.sh
```

Each run provisions fresh local services and writes its own `shadow-coverage.json` and `cashout-result.json` in the ignored run directory. The first file contains per-fill compute, writable accounts and claim-time observations. The second contains the certified payments, withdrawals and replay result.

### Verifying mandatory coverage updates

Build the candidate at clean revision `eb1cb0e4250e7c4532207f9d7db7dbad135979be` with the qualified base artifacts installed. Use a fresh directory for each run. From the current harness checkout, set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to the resulting directory and run the signed membership and financial controls.

```sh
RIVALT_ATTRIBUTION_PROFILE=maintained-coverage \
  RIVALT_ATTRIBUTION_DIR=.local/maintained-coverage/build-eb1cb0e4 bash ops/build-profit-attribution.sh

export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/maintained-coverage/build-eb1cb0e4
export RIVALT_ROUTER_REVISION=eb1cb0e4250e7c4532207f9d7db7dbad135979be
RIVALT_SETTLEMENT_PROBE=execution-router-maintained-coverage bash ops/scalable-settlement-smoke.sh
```

The run checks rollback on missing and substituted writable accounts, compares all lane rows with finalized margin accounts, and replays the financial journal into a fresh PostgreSQL database. The ignored run directory retains the signed originals, receipts and `maintained-coverage.json`.

### Comparing market backing during a BTC price shock

Build the local program at clean revision `8a239609af68ad063bf59bc4a554ae906cf5b70d` with the qualified base artifacts installed. From the harness checkout, point the supervisor at those binaries and a fresh run directory.

```sh
RIVALT_ATTRIBUTION_PROFILE=verified-coverage \
  RIVALT_ATTRIBUTION_DIR=.local/verified-coverage/build-8a239609 bash ops/build-profit-attribution.sh

export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/verified-coverage/build-8a239609
export RIVALT_ROUTER_REVISION=8a239609af68ad063bf59bc4a554ae906cf5b70d
RIVALT_SETTLEMENT_PROBE=execution-router-verified-coverage bash ops/scalable-settlement-smoke.sh
```

The supervisor signs a cross trader’s fills and ETH loss collection. It compares the maintained backing result with margin-account arithmetic, the existing certificate and actual one-atom payment attempts as BTC falls and recovers. Signed receipts, the PostgreSQL replay and `verified-backing.json` stay in the ignored run directory.

### Qualifying direct profit credits

Build from clean program revision `984f18f3a4e1d6880926805bbf120f3cb1d41bfc` with the qualified base artifacts installed.

```sh
RIVALT_ATTRIBUTION_PROFILE=direct-closed-credit \
  RIVALT_ATTRIBUTION_DIR=.local/direct-closed-credit/build-984f18f3 bash ops/build-profit-attribution.sh
```

From the qualification checkout, start fresh local services using those artifacts.

```sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/direct-closed-credit/build-984f18f3
export RIVALT_ROUTER_REVISION=984f18f3a4e1d6880926805bbf120f3cb1d41bfc
RIVALT_SETTLEMENT_PROBE=execution-router-direct-credit bash ops/scalable-settlement-smoke.sh
```

The signed workload uses separate fee payers for BTC fills and ETH credits. Its ignored run directory contains `direct-credit.json`, signed originals, RPC receipts and local database data. [Acceptance checks](validation.md)

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

### Curved books and binding maker margin

Use clearing `f0b8a599c24bde303d7ce9a8eb74bd1ffd86a85a` with the `wide-atomic-routes` artifact directory described above. Set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to that directory. Each arm needs a fresh run directory and its own local database. These commands run the two arms sequentially on the default local ports.

```bash
source ops/env.sh
export RIVALT_ROUTER_REVISION=f0b8a599c24bde303d7ce9a8eb74bd1ffd86a85a
export RIVALT_SETTLEMENT_PROBE=execution-router-feasible-books
comparison_dir=".local/feasible-books-$(date -u +%Y%m%dT%H%M%SZ)"
for arm in wallet control; do
  RIVALT_FEASIBLE_ARM="$arm" RIVALT_RUN_DIR="$comparison_dir/$arm" \
    bash ops/scalable-settlement-smoke.sh || exit 1
done
python3 tests/performance/feasible-book-report.py "$comparison_dir/wallet" "$comparison_dir/control"
pnpm exec vitest run tests/rpc-contract/feasible-book-reference.test.ts
```

The report checks that the two venues offered identical books, funded balances, risk bounds and signed economic limits. For each order it compares the ordinary wallet fill, the calculated best allocation within four legs and the best control that actually landed. All three include the taker fee. A missing fill has no execution price. The control uses the same wallet compute limit and either supplies four candidate bundles for on-chain selection or signs an explicit two-leg split.

For the funded multi-maker comparison, build the same `wide-atomic-routes` profile at clearing revision `50bd8836352e3a138142a4ae377ec6dc9d75bcc8` and set `RIVALT_ROUTER_REVISION` and `RIVALT_SETTLEMENT_ARTIFACT_DIR` to that revision and its matching directory. Use fresh directories for both arms. The new wallet run also signs a sale whose minimum proceeds exceed the best available fill by one collateral atom and checks rollback.

For price-aware wallet selection, use SDK/harness `7353f463` or its compatible stack head with the funded multi-maker binary. The same two-arm command checks the ordinary fills against each independent allocation and signed control. Set `RIVALT_SETTLEMENT_PROBE=execution-router-matched-makers`, `RIVALT_COMPARISON_LEGS=8` and `RIVALT_COMPARISON_MAKERS=16` or `32` to reproduce the wide-directory compatibility traces at harness `7353f463`.

## Wallet count and market contention

Use the `wide-atomic-routes` build at `b0e1a43f22699bb67335011ef7acfb2edf48b0d2` and the matching directory from the wide-fill build instructions. Leave all three runs on the same host and run them sequentially. Each run provisions a fresh local venue and PostgreSQL database. Each window schedules 48 matched requests at 40 ms intervals. Twelve logical streams specify side and dollar size. One window sends every stream through one funded wallet. The other uses twelve independently funded wallets, each waiting only for its previous transaction to confirm.

```bash
source ops/env.sh
export RIVALT_ROUTER_REVISION=b0e1a43f22699bb67335011ef7acfb2edf48b0d2
export RIVALT_SETTLEMENT_PROBE=execution-router-wallet-contention
# Point RIVALT_SETTLEMENT_ARTIFACT_DIR to the verified wide-atomic-routes build.
comparison_dir=".local/wallet-contention/run-$(date -u +%Y%m%dT%H%M%SZ)"
for market in btc split eth; do
  RIVALT_CONTENTION_MARKETS="$market" RIVALT_RUN_DIR="$comparison_dir/$market" \
    bash ops/scalable-settlement-smoke.sh || exit 1
done
python3 tests/performance/wallet-contention-report.py "$comparison_dir"/{btc,split,eth}
```

The report matches timetables across venues, audits fee payers, signatures, loaded account permissions and outcomes from finalized receipts, and checks consumed maker depth against the replayed journal. It counts all distinct-wallet transaction pairs and separately counts pairs whose observed broadcast-to-confirmation intervals overlapped. Timing includes the SDK snapshot, simulation, signing, RPC and local scheduling.

### Native validator scheduler replay

This twelve-wallet comparison runs a local Agave leader at its default slot timing. It uses the same 48 arrivals, fees, program binaries, economic checks and finalized PostgreSQL replay as the Surfpool comparison. Each placement gets a fresh ledger. For this test use Agave 4.2.2. The workspace's 4.1.2 RPC rejects the 1,404-byte v1 order before it reaches scheduling.

Build the local test validator once. The small patch timestamps admission, worker assignment and the start of worker batch processing using one monotonic clock. A separate thread formats signatures and writes the trace. The command below uses the Rust toolchain and Apple Command Line Tools on the qualification host.

```bash
source ops/env.sh
source_dir=.local/agave-contention/source
git clone --branch v4.2.2 --depth 1 https://github.com/anza-xyz/agave.git "$source_dir"
test "$(git -C "$source_dir" rev-parse HEAD)" = c9c6f3287e26f24e3476e13e751aebe710191e89
git -C "$source_dir" apply --unidiff-zero "$PWD/tests/performance/agave-4.2.2-scheduler.patch"
(
  cd "$source_dir"
  mkdir -p target/release
  ln -s "$(xcode-select -p)/usr/lib/libclang.dylib" target/release/libclang.dylib
  LIBCLANG_PATH="$(xcode-select -p)/usr/lib" CARGO_INCREMENTAL=0 \
    CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_DEBUG=0 \
    CARGO_PROFILE_RELEASE_STRIP=debuginfo CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
    CXXFLAGS=-g0 CFLAGS=-g0 cargo +1.97.1 build --release --locked \
    -p agave-validator --bin solana-test-validator -j 5
)
export RIVALT_AGAVE_VALIDATOR="$source_dir/target/release/solana-test-validator"
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/wide-routing/build-b0e1a43f
comparison_dir=".local/agave-contention/run-$(date -u +%Y%m%dT%H%M%SZ)"
for market in btc split eth; do
  RIVALT_CONTENTION_MARKETS="$market" RIVALT_RUN_DIR="$comparison_dir/$market" \
    bash ops/validator-wallet-contention.sh || exit 1
done
python3 tests/performance/wallet-contention-report.py --scheduler "$comparison_dir"/{btc,split,eth}
```

The report joins native events to each original signed order and its finalized receipt. It reports scheduler intervals in microseconds and client intervals in milliseconds. RPC response and validator processing can overlap. Aggregate latency percentiles cannot be added. For each signature admitted once, the report times first assignment, first worker start and last worker start from that admission. The last interval includes prior attempts when Agave retries. Client percentiles use every signed original. Single-attempt percentiles have their own denominator. The validator stops when the workload exits. Raw traces, ledger and receipts stay in the local run directory.

### Profiling wallet order preparation

Use the validator and clearing artifact exports above. Set `baseline_split` to a completed twelve-wallet split run from the same validator, such as `"$comparison_dir/split"` from the preceding command. The reference baseline used harness `5475b255`.

```bash
baseline_split="$comparison_dir/split"
profiled_split=".local/agave-contention/preparation-$(date -u +%Y%m%dT%H%M%SZ)/split"
RIVALT_CONTENTION_MARKETS=split RIVALT_RUN_DIR="$profiled_split" bash ops/validator-wallet-contention.sh
python3 tests/performance/wallet-contention-report.py --preparation "$baseline_split" "$profiled_split"
```

The report checks both finalized journals, the validator binary, program build, per-wallet schedule and all signed outcomes. For each signed order it partitions elapsed time from wallet readiness to the original signature. The four sequential account calls include receipt and JSON parsing. The final batch includes both maker programs' upgradeable program data. Reported bytes are decoded account-data lengths. The elapsed time outside RPC includes event-loop waits. The leader's observed arrival rate divides the number of gaps between first admissions by their elapsed span. Fills/s uses every completed trader order through the last observed outcome.

### Replaying wallet snapshot verification offline

The twelve-wallet split run retains an Agave ledger. For the measured run, slot 406 immediately precedes the first fill. Export that bank with Agave 4.2.2 on a scratch copy. The following uses APFS clones on the local macOS host and the retained Agave distribution.

```bash
source ops/env.sh
run=.local/agave-contention/preparation-9369c98d/split
scratch=$(mktemp -d .local/agave-contention/profile-XXXXXX)
mkdir "$scratch/ledger"
cp -cR "$run/ledger/rocksdb" "$scratch/ledger/"
cp -c "$run/ledger/genesis.bin" "$run"/ledger/snapshot-400-*.tar.zst "$scratch/ledger/"
tar -xjf .local/agave-contention/solana-release-aarch64-apple-darwin.tar.bz2 \
  -C "$scratch" solana-release/bin/agave-ledger-tool
"$scratch/solana-release/bin/agave-ledger-tool" --ledger "$scratch/ledger" --log "$scratch/export.log" \
  accounts --halt-at-slot 406 --include-sysvars --output json-compact > "$scratch/accounts.json"
rg 'bank frozen: 406 hash:' "$run/ledger/validator.log" "$scratch/export.log"
node --experimental-test-module-mocks --import tsx tests/performance/wallet-snapshot-profile.ts \
  "$scratch/accounts.json" "$run" 406
```

Verify that both logs give the same bank hash. The benchmark reads all four account batches from that bank and times the SDK from its final response to its verified snapshot. It checks the maker hashes against the retained journal, compares decoder outputs byte for byte, and checks the SDK's response to a changed maker binary. Stage shares come from serial replays of the previous decoder. The separate decoder comparison alternates execution order and reports single-wallet and twelve-concurrent-wallet timings with stage recording disabled.

Use the same export to test the SDK in a real browser. Set `RIVALT_CHROME_PATH` to the local Chromium or Chrome executable, or use the Playwright-managed Chromium. The runner loads only the public bank data into a temporary headless browser and fulfills requests in memory. Run twice in separate processes to see timing variation.

```bash
node --import tsx tests/browser/wallet-snapshot-profile.ts "$scratch/accounts.json" "$run" 406
```

### Comparing already-signed order bursts

Use the native validator and artifact exports in the scheduler replay instructions. Run each placement sequentially on a fresh venue:

```bash
burst_dir=".local/agave-contention/burst-$(date -u +%Y%m%dT%H%M%SZ)"
for placement in btc split; do
  RIVALT_CONTENTION_MODE=presigned RIVALT_CONTENTION_MARKETS="$placement" \
    RIVALT_RUN_DIR="$burst_dir/$placement" bash ops/validator-wallet-contention.sh || exit 1
done
python3 tests/performance/wallet-contention-report.py --burst "$burst_dir"/{btc,split}
```

Each of 50 funded wallets places one four-candidate order. Sides and dollar sizes follow the same sequence on both venues. The harness holds every signed original after simulation and WebSocket subscription. Once all 50 are ready, it polls the processed slot, waits for the next observed slot change and releases the originals in order without waiting for another wallet's confirmation. An incomplete preparation cancels the burst. The report counts landed refusals separately from successful trader fills and checks every original against finalized RPC receipts, native scheduler events and PostgreSQL maker depth.

Slot offsets use the last processed slot observed immediately before release as zero. This RPC reference can lag a bank that is still accepting transactions. The slot histogram shows which finalized blocks included the orders. A missing receipt fails the audit. For each landing block the report reads the validator's actual bank-freeze timestamps and scheduler costs. Native admission-to-worker timing uses the validator's clock. Release to observed confirmation also includes RPC transport and client polling.
