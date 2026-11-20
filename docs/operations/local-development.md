# Local development

The normal local runtime selects schema-10/profile-6 clearing, paged Financial
membership, maintained backing and durable default. Use a fresh domain/genesis
and PostgreSQL database. Preserve earlier sessions and unresolved originals with
their original clients; a schema-8 artifact or database fails before startup.
The launcher provisions recovery capacity for 128 Financial roots. This is the
qualified local operating envelope, not a fixed identity-registration ceiling.

## Pinned toolchain

| Component | Pin / distinction |
|---|---|
| Host Rust / Cargo | 1.97.1, pinned by rust-toolchain.toml |
| Candidate Anchor CLI / anchor-lang / anchor-spl | 2.0.0-rc.2; language `alloc`/`guardrails`, SPL `guardrails`; isolated CLI |
| Agave CLI distribution | 4.1.2, source 182084b8 |
| Bundled cargo-build-sbf | 4.1.0; its displayed default platform-tools is v1.54 |
| Explicit SBF build | platform-tools v1.52, rustc 1.89.0-dev, SBPF v0 |
| Surfpool | 1.7.0 for P40B onward; solana-core 4.3.2, feature-set 3383571666 (D85) |
| Node / pnpm | 24.22.0 / 10.23.0 |
| Application web3.js / Kit | 3.1.1 / 8.5.0 |
| Wallet compatibility | wallet-adapter 3.1.1, React / React DOM 19.3.0 |
| Generator | codama 1.11.0, nodes-from-anchor 1.5.6, renderers-js 2.8.0 |
| RC2 test process | @anchor-lang/core 2.0.0-rc.2, Kit 8.3.0, separate lockfile |
| Legacy test process | @anchor-lang/core 1.2.1, web3.js 1.99.0 |
| TypeScript / test runner | 5.9.3 / Vitest 3.2.4 |


Also retain LiteSVM 1.6.1, Fastify 5.12.7, pg 8.23.1,
PostgreSQL 18.6, Vite 7.3.7 and Playwright core 1.64.1. Lockfiles and
[download manifests](../../ops/toolchain-downloads.json) are authoritative. Host
Rust, SBF compiler, runtime version and transaction format are different identities.
Legacy Anchor/web3.js 1.x lives only in `tests/anchor-conformance`; no runtime
imports or workspace overrides make it appear compatible with the modern client.

For a fresh build of the qualified demo, create a separate checkout with
`git worktree add --detach ../rivalt-qualified 657a255` and install the pinned
tools and dependencies there. Run `bash ops/install-anchor-rc2.sh`, then
`bash ops/build.sh` from that checkout. To build the extracted risk engine for
comparison, use `RIVALT_LIQUIDITY_ARTIFACTS=.local/risk-engine-candidate bash ops/build-liquidity-execution.sh`
at the candidate source revision in [validation](validation.md#whole-account-risk-engine-extraction). P56 selects the account-scale RC2 artifacts with the unchanged approved policy-2
price bounds, quantities and risk safeguards
and selects `.local/anchor-rc2/current` for builds, probes and the local demo. Actual files
must match the SDK's admitted hashes; changing a manifest does not qualify code.
`RIVALT_ARTIFACT_DIR` may explicitly select another directory containing those
same qualified artifacts. `RIVALT_LIQUIDITY_ARTIFACTS` changes a build destination.
Builds retain a separate staging directory and logs; the default destination is
updated only after fixed SDK hash verification passes. An explicit alternate build
destination may contain unqualified candidates, but runtime probes still reject
them until separately qualified and admitted. Run
`node --import tsx ops/verify-liquidity-artifacts.ts <directory>` for the same
preflight used by normal probes and the broad smoke launcher.
The frozen P44 directory and `.tools/bin/anchor` remain untouched; RC2 build scripts
select `.tools/anchor-v2-rc2/bin/anchor`. Install the isolated test client with
`pnpm --dir tests/anchor-rc2-conformance install --frozen-lockfile`.
Fresh schema-10 domains/databases are required; no old accounts or signed originals
are relabeled. [STATUS](../STATUS.md) distinguishes qualification and PR integration.
Signed provisioning waits for Clock to pass both publishers' initialization fences
before refreshing inputs and preparing the first funding reports. This does not
relax report freshness, the two-second sample interval or monotone observation slots.
The demo starts workers only after a coherent published finalized provisioning
journal, waiting across bounded recovery cycles for up to 60 seconds. A completed
catch-up cycle alone is not readiness.
Initial projection/reconciliation errors still fail startup and preserve local
records.
Six maker updaters and two funding publishers each use a separately funded local
signer/fee payer, matching service qualification. Their existing restricted
authorities are assigned through signed provisioning; no shared payer serializes
all publication workers. Keys stay in the ignored session configuration.
Synthetic independent sources refresh after a one-second producer delay, matching
service qualification. Source-age, recovery and signed quote lifetime checks are
unchanged; delayed originals can still reject and require a new user review.
The full interactive worker set targets funding publication every four seconds,
within the existing supported 2–5-second operator range, to leave dispatch room
for wallet and settlement actions. The separate P47 service/load measurements
retain their recorded two-second policy; demo results are not substituted for them.

From the repository root, bootstrap only missing baseline tools:

```sh
python3 ops/bootstrap.py
source ops/env.sh
npm install --prefix .tools/pnpm --ignore-scripts pnpm@10.23.0
rustup toolchain install 1.97.1 --profile minimal --component rustfmt,clippy
pnpm install --frozen-lockfile
```

Bootstrap uses official pinned archives under ignored `.tools/` and does not replace
default system tools. Python 3.12+ and rustup are prerequisites. The tested native
host is macOS arm64 with the existing Apple Containers runtime; do not assume Docker
Desktop. PostgreSQL images are digest-pinned by the wrappers with native arm64
support, loopback ports and owned volumes; host PostgreSQL remains untouched.

## Current canonical qualification commands

Select the affected command; this list is not a mandatory sequential test suite.
Run from the repository root with `source ops/env.sh`.

```sh
bash ops/build.sh
pnpm typecheck
pnpm generate:check
bash ops/funding-publisher-smoke.sh
bash ops/liquidity-execution-smoke.sh
bash ops/liquidity-services-smoke.sh
```

The build locks dependencies, generates IDLs/SDKs and fails on any oversized SBF
stack diagnostic. Reused artifacts must match actual expected hashes; never update
pins merely to accept an unexplained binary. A fresh build needs its own identity
record. `pnpm generate:check` verifies generated output, not program correctness.

Browser checks require an installed compatible Chromium. Set `RIVALT_CHROME_PATH`
to its executable or use the existing pinned Playwright browser cache; `playwright-core`
does not download a browser. `pnpm build:trader` builds the UI. Integrated wrappers
provision signed real accounts and SPL transfers, start actual services/PG and stop
only owned processes. Fixtures do not fabricate fills or settlements.

## Ordinary payout demonstration

With the selected program artifacts and PostgreSQL container runtime installed,
run the following from the repository root.

```sh
RIVALT_LIQUIDITY_PROBE=ordinary-payout bash ops/current-runtime-smoke.sh
```

The launcher creates an owned Surfpool instance and a fresh PostgreSQL database.
It prints the local output directory on success. Open `payout.html` for the trader's
Positions panel at each payment stage. `payout.json` records the exact amounts,
transaction signatures, worker receipts and observation times. Both stay local.
The test fee payer submits keeper operations, the trader's local signer authorizes
the trades and withdrawal, and the two reference makers use separate capital.
The first collection is deliberately partial so the intermediate balances can be
inspected. Observation times include sampling, finality and SQL publication.

## BTC default recovery comparison

Use the selected program artifacts, the pinned native settlement helper and the
local PostgreSQL container runtime. Run this command from a clean tracked checkout.

```sh
RIVALT_LIQUIDITY_PROBE=btc-default-recovery bash ops/current-runtime-smoke.sh
```

Two internal makers trade one BTC lot against the same trader. The trader closes
before a signed price change makes the first maker insolvent. The launcher records
the verified freeze, finalized continuations, funded payouts and SPL withdrawal in
`btc-default-recovery.json` under the printed local directory. A Python reference
replays the two fills and calculates both payout rules from that same freeze.
Only the selected proportional rule moves tokens in this demonstration.

## Clearing-owned profit attribution

Build from clean program source `33361d9` with the normal P56 artifacts already
present. Use the same artifact directory from the signed harness checkout at
`af1c515`. Each run starts a fresh loopback chain and PostgreSQL database.

```sh
RIVALT_ATTRIBUTION_DIR=.local/profit-attribution/candidate-33361d9 bash ops/build-profit-attribution.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/profit-attribution/candidate-33361d9
RIVALT_SETTLEMENT_PROBE=profit-attribution bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-recovery bash ops/scalable-settlement-smoke.sh
```

The first probe compares every frozen account with independently replayed fills
and payments. The second follows the debtor and both creditors through the
selected proportional settlement and wallet exit. [Measured results](validation.md#clearing-owned-surviving-profit).

## Sponsored profit capacity

Build at `1763dc7` with the selected P56 maker binaries available. Switch back
to the qualification revision `291e7a5` before launching each fresh local run.

```sh
RIVALT_ATTRIBUTION_DIR=.local/profit-attribution/sponsored-revision-2 bash ops/build-profit-attribution.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/profit-attribution/sponsored-revision-2
RIVALT_SETTLEMENT_PROBE=profit-attribution-sponsor bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-sponsor-recovery bash ops/scalable-settlement-smoke.sh
```

## Verified BTC default payout

Build from clean program revision `447efef` with the pinned P56 maker binaries.
From the qualification checkout build the matching native page helper, then run
both cases using a fresh loopback chain and PostgreSQL database for each.

```sh
RIVALT_ATTRIBUTION_PROFILE=single-pair-default-qualification RIVALT_ATTRIBUTION_DIR=.local/profit-attribution/verified-pair-rates bash ops/build-profit-attribution.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/profit-attribution/verified-pair-rates
bash ops/build-settlement-helper.sh verified-pair-candidate
RIVALT_SETTLEMENT_PROBE=profit-attribution-verified-pair bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-verified-pair-limited bash ops/scalable-settlement-smoke.sh
```

The first case follows the flat trader through a withdrawal. The second gives
the winning maker only 502 eligible atoms against a 1,500-atom shortfall and
checks that the cohort stays frozen.

## BTC residual recovery

Build clearing at `8024a37` with the P56 maker artifacts available. From the
qualification checkout `1e05885`, build the matching helper, then launch each
scenario on a fresh local chain and PostgreSQL database.

```sh
RIVALT_ATTRIBUTION_PROFILE=btc-residual-qualification RIVALT_ATTRIBUTION_DIR=.local/profit-attribution/btc-residual-r1 bash ops/build-profit-attribution.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/profit-attribution/btc-residual-r1
bash ops/build-settlement-helper.sh btc-residual-candidate
for scenario in partial none multi; do
  RIVALT_SETTLEMENT_PROBE="profit-attribution-btc-residual-$scenario" bash ops/scalable-settlement-smoke.sh
done
```

## Maker liquidation demonstration

Build the separately pinned candidate at source revision `ab3f6c6` with
`RIVALT_LIQUIDITY_ARTIFACTS=.local/anchor-rc2/maker-reduction-ab3f6c6 bash ops/build-liquidity-execution.sh`.
From the qualification revision, run the following with the normal selected
artifacts still available. The launcher verifies both sets of hashes before
deploying to a fresh loopback Surfpool instance.

```sh
RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/anchor-rc2/maker-reduction-ab3f6c6 \
RIVALT_SETTLEMENT_PROBE=maker-liquidation RIVALT_PG_PORT=15452 \
bash ops/scalable-settlement-smoke.sh
```

The result in `liquidation.json` contains the realized shortfalls, fees in the
transaction receipts and replay count. The maker and receiver in this exercise
use internal capital and separate signing keys for the trader, keeper and
receiver. The normal launcher continues to require the qualified P56 binaries.

## Interactive local demo

`bash ops/demo.sh start|status|stop|reset` launches the same current canonical
profile as the SDK and services. It needs qualified `.local/anchor-rc2/current/`
artifacts (or `RIVALT_ARTIFACT_DIR` pointing to the same admitted binaries) and
frozen dependencies; [STATUS](../STATUS.md) records the current
launcher's acceptance checkpoint. Open `http://127.0.0.1:18083`, select **Rivalt
Local Demo**, get test funds, create portfolio/cross or isolated account, deposit,
trade BTC/ETH, place/cancel existing-position TP/SL, close and withdraw admissible
cash. Fixed synthetic prices demonstrate placement, not triggered-stop execution.

The opt-in test wallet stays in the browser tab, including across reload; closing
the tab loses its key. Never fund it with real assets. Local faucet is limited to
one SOL/1,000 test USD and 16 wallets per session, bound to origin and genesis.
Uncertain funding originals keep their allowance; success waits for finality.
The instrumented wallet is not Phantom compatibility evidence.

To qualify a fresh session while retaining an earlier stopped runtime, set
`RIVALT_DEMO_ROOT` to a new ignored directory under `.local/`. Use that same value
for start/status/stop and browser verification. Ports remain fixed, so only one
interactive demo can run at a time. PostgreSQL startup waits for the final TCP
listener, not the image's temporary initialization server.

Sessions last <=60 minutes. Startup needs >1 GiB free; runtime stops below 768 MiB.
Stop before sleep/lid close. Start after a stopped chain refuses reuse: Surfpool's
SQLite restart changes genesis/slot clock despite retaining accounts. Use reset
for a fresh venue/mint/genesis. Reset removes only this launcher's ended owned
runtime after port checks; session logs/receipts remain. Stop waits for supervisor
exit and owned ports; timeout is not successful cleanup. Existing raw evidence
and unrelated databases are never reset with the demo.

## Storage and older harnesses

`.local/` holds local builds, test databases, logs, keys and raw evidence. Inspect
usage and active ownership before cleanup. Compilers may regenerate build caches;
never delete active PostgreSQL files, user research, key material or acceptance
captures as an automatic cleanup. Reuse a stopped owned qualification cluster with
`RIVALT_PG_REUSE_DIR` when the wrapper supports it; preserve fsync/WAL durability.

`pnpm smoke` explicitly runs the broad current integration matrix on already built
artifacts; it is not a default PR check. Earlier launchers/feature profiles are
retired; reproduction uses the immutable baseline in [HISTORY](../HISTORY.md). Do not point an
old suite at new accounts or claim its results validate a new implementation.

### Bounded indexer recovery

P52 requires a fresh format-3 PostgreSQL journal; retain older journals and pending
signed originals. Run its scoped signed RPC/WS/PostgreSQL probe with
`RIVALT_LIQUIDITY_PROBE=indexer-progress RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15452 bash ops/current-runtime-smoke.sh`.
The supervisor starts/stops only its own Surfpool and PostgreSQL processes and
retains local evidence/data. On macOS a process-scoped idle-sleep inhibitor keeps
RPC deadlines from expiring while the operator is away; it ends with the supervisor
and does not keep the display awake or change power settings. The fixture deliberately exceeds 10,000 transactions
and 4,096 clearing invocations; this is backlog recovery, not a throughput or
larger-account claim. `/ready` reports covered and reconciled progress separately.


On macOS, finite `ops/current-runtime-smoke.sh` qualification runs hold a temporary
`caffeinate -i` assertion tied to the supervisor PID. It ends with that run, keeps
no display awake and changes no persistent system settings. Host suspension can
otherwise invalidate real freshness/timeout measurements; it is not repaired by
extending oracle validity or relabelling a timed-out test as successful.


### Candidate paged-default operator helper

The paged-default service uses a bounded native descriptor helper; retail SDK
calls do not need it. `bash ops/build.sh` builds the programs, generated SDK and
helper. Build only the helper when its source changes:

```sh
bash ops/build-settlement-helper.sh
```

The locked native executable and SHA-256 manifest live under ignored
`.local/settlement-helper/`, or the explicit `RIVALT_SETTLEMENT_HELPER_DIR`.
The script builds the clean D108 Git tree declared in the SDK deployment contract,
including its lockfile. The worker requires that exact source revision, version 2,
schema 10/profile 6 and a matching local binary size and hash. The helper
suggests canonical page descriptors; clearing independently verifies all work.
The demo checks it before provisioning. It holds no signing key or financial
permission. Rebuild after changing its checkpoint dependencies.


### Account-scale wallet candidate

P56A2's dedicated local probe uses `RIVALT_SETTLEMENT_PROBE=account-clients` with
`ops/scalable-settlement-smoke.sh` and the explicitly pinned candidate artifact
directory. It builds the trader UI and runs an internal Wallet Standard browser
against real Surfpool RPC/WS and owned PostgreSQL. It is a dedicated client probe, separate from normal `ops/demo.sh` startup.

Candidate wallet configuration requires `accountSchema: 10` and
`deployment: "account-scale-candidate"`. Both processes require a matching explicit deployment binding. Exact executable,
anchor, genesis and domain checks reject mismatched deployments. The browser
qualifies an internal test signer; it does not claim new external-wallet review.

The default-worker probe uses bounded batches of up to 32 instructions; set
`RIVALT_DEFAULT_BATCH_STEPS=1` for a scalar transport diagnostic. Each batch is
independently constrained by CU, wire size and account data. The normal operations
entrypoint is:

```sh
bash ops/liquidity-operations-smoke.sh
```

It creates 128 genuinely funded Financial roots, trades both directions, exercises
cash/orders/liquidation, then verifies complete default, upload/Apply crash
recovery, token exit and identical fresh PostgreSQL replay. It asserts G1's local
time/fee/storage envelope. The 1,024-root extended diagnostic is available only
through explicit `RIVALT_DEFAULT_POPULATION=1024`; it must be measured before an
operator enables that workload. Omitting population in the low-level candidate
probe retains the eight-root comparison. Only the exact qualified artifact set
may run through normal launchers.

### Reproduce the multi-winner BTC recovery

Use the locally pinned clearing source `9e2cc00` for the
`btc-allocation-qualification` SBF and the selected maker binaries. From the
current harness checkout, build the matching helper and run each case with a
fresh run directory, loopback validator and PostgreSQL database.

```bash
bash ops/build-settlement-helper.sh btc-allocation-candidate
for scenario in unequal tie; do
  RIVALT_SETTLEMENT_ARTIFACT_DIR="$allocation_build" \
    RIVALT_SETTLEMENT_PROBE="profit-attribution-btc-allocation-$scenario" \
    bash ops/scalable-settlement-smoke.sh || break
done
```

Here `allocation_build` is the absolute path produced by
`RIVALT_ATTRIBUTION_PROFILE=btc-allocation-qualification bash ops/build-profit-attribution.sh`
at the pinned revision. Qualification deploys both fresh 1,220-byte frozen
pages and the artifact-bound worker. Previously deployed recovery pages use
their original layout.

### Reproduce the linked default comparison

Use the attribution build at `33361d9` and the BTC allocation build at
`9e2cc00` described above. From the harness checkout, run each profile on
its own fresh local validator and PostgreSQL database. The launcher selects
a new evidence directory for each invocation.

```bash
RIVALT_SETTLEMENT_ARTIFACT_DIR="$attribution_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-linked bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_ARTIFACT_DIR="$allocation_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-btc-allocation-linked bash ops/scalable-settlement-smoke.sh
```

Each run writes `linked-default.json` with the frozen inputs, financial
comparison, worker signatures, wallet and vault balances.

### Reproduce clearing-verified joint recovery

Build the `linked-pair-qualification` program from clean revision `0e027fc`
with the selected maker and oracle binaries installed. Use the resulting
artifact directory in the harness checkout.

```bash
# Program checkout
RIVALT_ATTRIBUTION_PROFILE=linked-pair-qualification bash ops/build-profit-attribution.sh
# Harness checkout
bash ops/build-settlement-helper.sh linked-pair-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$linked_build" RIVALT_SETTLEMENT_PROBE=profit-attribution-linked-apply \
  bash ops/scalable-settlement-smoke.sh
```

The fresh validator and PostgreSQL run reads and verifies both actual frozen
maker positions. The worker records its original transaction for each step.

### Reproduce the closed BTC trader's joint-default payout

Run the same four signed trades twice, with fresh validators and databases.
Use the ordinary attribution build from `33361d9`. Build the linked candidate
from clean revision `30434d5` using `ops/build-profit-attribution.sh` with
`RIVALT_ATTRIBUTION_PROFILE=linked-pair-qualification`. From the harness checkout:

```bash
bash ops/build-settlement-helper.sh linked-flat-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$attribution_build" RIVALT_SETTLEMENT_PROBE=profit-attribution-linked-flat \
  bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_ARTIFACT_DIR="$linked_flat_build" RIVALT_SETTLEMENT_PROBE=profit-attribution-linked-flat-apply \
  bash ops/scalable-settlement-smoke.sh
```

Each run checks the flat trader's banked collateral separately from the claim
payout, the maker wallet, the vault, the independently reconstructed frozen
inputs and the events replayed into a fresh PostgreSQL database.

To exercise competing BTC winners, run the same linked candidate and helper
with `RIVALT_SETTLEMENT_PROBE=profit-attribution-linked-contested`. This
five-trade scenario compares the proposals to the frozen book and submits
each incomplete pair to clearing on its own fresh chain.

### Reproduce the linked allocation across competing makers

At clean program revision `d0ae474`, build clearing with
`RIVALT_ATTRIBUTION_PROFILE=linked-allocation-qualification` and
`bash ops/build-profit-attribution.sh`. Keep its printed output directory. At the
harness revision recorded in [validation](validation.md#linked-allocation-across-competing-makers),
run the following with that directory in `linked_allocation_build`.

```bash
bash ops/build-settlement-helper.sh linked-allocation-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$linked_allocation_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-linked-allocation \
  bash ops/scalable-settlement-smoke.sh
```

The five fills produce two BTC winners, one ETH winner and a flat BTC creditor.
The run first offers too little BTC alongside the correct ETH allocation, then
restarts the worker during the corrected member scan. It compares all final
margin accounts and four withdrawals to the independent fill-by-fill reference,
and refetches the original transactions into a fresh PostgreSQL database.

### Reproduce a winner with debt in the other market

Run the same three signed trades on fresh validators and PostgreSQL databases.
Use the ordinary attribution artifact from `33361d9` and the linked allocation
artifact and helper from `d0ae474`. The first run measures ordinary payment
and exit. The second submits both debtors to the current permissionless proof
and checks the frozen roots after rejection.

```bash
RIVALT_SETTLEMENT_ARTIFACT_DIR="$attribution_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-foreign-winner-ordinary \
  bash ops/scalable-settlement-smoke.sh
bash ops/build-settlement-helper.sh linked-allocation-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$linked_allocation_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-foreign-winner-gate \
  bash ops/scalable-settlement-smoke.sh
```

To test joint payment for the same book, build the local program at
`d177cc5` with `RIVALT_ATTRIBUTION_PROFILE=foreign-creditor-qualification`
and `bash ops/build-profit-attribution.sh`. From the harness revision in
[validation](validation.md#atomic-payment-for-a-btc-winner-with-eth-debt), run

```bash
bash ops/build-settlement-helper.sh foreign-creditor-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$foreign_creditor_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-foreign-winner-apply \
  bash ops/scalable-settlement-smoke.sh
```

### Reproduce two debtors sharing one-lot winners

Use the ordinary attribution binary built at `33361d9` and the harness at
`cfc2279`. Save the printed run directory. The native comparison at `981d269`
reads the reconstructed inputs and compares every selected debtor/winner pair.

```bash
RIVALT_SETTLEMENT_ARTIFACT_DIR="$attribution_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-shared-inventory \
  bash ops/scalable-settlement-smoke.sh
cargo build --locked -p default-plan-selection --example single_lot_assignment
python3 tests/financial/check_shared_inventory.py "$run_dir/linked-default.json"
```

To reproduce the successor on the same book, build the separate program at
`59184c5` with `RIVALT_ATTRIBUTION_PROFILE=shared-inventory-qualification`.
From the signed harness revision in [validation](validation.md#two-btc-debtors-sharing-winning-inventory), run

```bash
bash ops/build-settlement-helper.sh shared-inventory-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$shared_inventory_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-shared-inventory-apply \
  bash ops/scalable-settlement-smoke.sh
```

For the scarce-inventory comparison, build the local clearing program at
`2256c51` using `RIVALT_ATTRIBUTION_PROFILE=partial-inventory-qualification`.
Its native helper uses the same pin. Run each probe in a fresh run directory.

```bash
bash ops/build-settlement-helper.sh partial-inventory-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$ordinary_attribution_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-scarce-inventory-one-ordinary \
  bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_ARTIFACT_DIR="$partial_inventory_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-scarce-inventory-one-apply \
  bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_ARTIFACT_DIR="$partial_inventory_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-scarce-inventory-zero-apply \
  bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_ARTIFACT_DIR="$partial_inventory_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-scarce-inventory-floor-apply \
  bash ops/scalable-settlement-smoke.sh
```

For the three-debtor comparison use the ordinary SBF at `33361d9`. The
harness builds the population selector and separately replays the signed
transactions and terminal settlement.

```bash
RIVALT_SETTLEMENT_ARTIFACT_DIR="$ordinary_attribution_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-inventory-book-ordinary \
  bash ops/scalable-settlement-smoke.sh
cargo build --locked -p default-plan-selection --example single_lot_assignment
python3 tests/financial/check_inventory_book.py
```

The corresponding successor uses the book candidate from clean clearing
revision `d5cc624` and the same signed fills. Build the SBF from the pinned
revision, then run the helper and harness from the current checkout.

```bash
bash ops/build-settlement-helper.sh book-inventory-candidate
RIVALT_SETTLEMENT_ARTIFACT_DIR="$book_inventory_build" \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-inventory-book-apply \
  bash ops/scalable-settlement-smoke.sh
```

Use the same book candidate for the certification resource probe. Set
`RIVALT_SETTLEMENT_PROBE=profit-attribution-inventory-book-capacity` and
`RIVALT_INVENTORY_PAIRS` to the number of long/short pairs. The optional
`RIVALT_INVENTORY_STRIDE` selects every nth trader root. The intervening
roots are funded, flat members. For example, 11 pairs at stride 8 produce
22 active pages across 175 Financial accounts. The commands use separate
fresh run directories and database instances as above.

To reproduce the revised certificate, build clearing at `eb011a5` with the
same `book-inventory-qualification` feature and run
`bash ops/build-settlement-helper.sh book-capacity-candidate`. Select the new
artifact directory with `RIVALT_SETTLEMENT_ARTIFACT_DIR`. The
`profit-attribution-inventory-book-expanded` probe simulates 32, 64, 128 and
256 KiB heap requests against the same frozen rows. It then submits the
worker’s chosen transaction, checks its finalized bytes and replays PostgreSQL.
Use 11 pairs with stride 8 for the 22-page book or 81 pairs with stride 1
for the 162-position book. The separate
`profit-attribution-inventory-book-expanded-apply` probe follows three
maker credits through settlement, worker restart and SPL withdrawal.

For the multi-lot comparison use the same book-capacity artifacts and
`RIVALT_SETTLEMENT_PROBE=profit-attribution-multi-lot-search`. The launcher
builds the native verifier, executes two real two-lot trades, freezes the
eight-member book and checks the existing signed release gate. To rerun the
economic comparison on its saved inputs use
`python3 tests/financial/check_multi_lot_search.py "$run_dir/multi-lot-frozen.json"`.
Omit the file argument to check the independent synthetic books.

For a clearing-verified multi-lot payout, build the candidate at the source
revision in the deployment binding (currently `baef259`) using
`RIVALT_ATTRIBUTION_PROFILE=multi-lot-book-qualification` with
`bash ops/build-profit-attribution.sh`. From the qualification revision, run
`bash ops/build-settlement-helper.sh multi-lot-book-candidate`. Point
`RIVALT_SETTLEMENT_ARTIFACT_DIR` at that program build, select
`RIVALT_SETTLEMENT_PROBE=profit-attribution-multi-lot-apply` and run
`bash ops/scalable-settlement-smoke.sh`. Repeat with a fresh run directory
and `profit-attribution-multi-lot-tie` to verify refusal when the marginal
costs tie. Each run creates its own local PostgreSQL instance.

To reproduce the paired-route measurement, select the same multi-lot clearing
artifact directory, a fresh run directory and
`RIVALT_SETTLEMENT_PROBE=profit-attribution-route-locks`. Run
`bash ops/scalable-settlement-smoke.sh`. The harness writes the signed lock
sets and per-pair confirmation times to `successor-route-locks.json` in the
run directory.

### Aggregate insurance and default payout

From clean program revision `5b1e964`, run
`RIVALT_ATTRIBUTION_PROFILE=aggregate-fee-qualification bash ops/build-profit-attribution.sh`.
Return to the qualification revision. Run
`bash ops/build-settlement-helper.sh aggregate-fee-candidate`. Set
`RIVALT_SETTLEMENT_ARTIFACT_DIR` to the absolute printed program directory.
Run `bash ops/scalable-settlement-smoke.sh` with
`RIVALT_SETTLEMENT_PROBE=profit-attribution-fee-lanes` for paired trades and
with `RIVALT_SETTLEMENT_PROBE=profit-attribution-fee-lanes-apply` for a default
that draws on earned insurance. Use a separate fresh run directory each time.

### Reproduce the bounded market read

Build from clean program revision `3ace707` with
`RIVALT_ATTRIBUTION_PROFILE=bounded-market-read bash ops/build-profit-attribution.sh`.
Return to the qualification revision, export `RIVALT_SETTLEMENT_ARTIFACT_DIR`
as the absolute printed build directory and run
`bash ops/build-settlement-helper.sh bounded-market-candidate`.
Run `bash ops/scalable-settlement-smoke.sh` once per
`RIVALT_SETTLEMENT_PROBE` value, using fresh run directories.

| Probe | Check |
|---|---|
| `profit-attribution-bounded-market` | Complete and foreign-market reads, two stored fills, cross-maker close, external CPI and freeze |
| `profit-attribution-bounded-market-apply` | Frozen population, funded default application, actual token withdrawals and fresh database replay |
| `profit-attribution-bounded-market-receiver` | Distressed trader, eligible maker fill, funded receiver transfer and unwind |

### Reproduce checked funding publication

Build clean program `2da3e90` with
`RIVALT_ATTRIBUTION_PROFILE=checked-funding-prefix bash ops/build-profit-attribution.sh`.
Use harness `1637f8f` or the corresponding ready branch. Export the printed
absolute build directory as `RIVALT_SETTLEMENT_ARTIFACT_DIR` and run
`RIVALT_SETTLEMENT_PROBE=profit-attribution-checked-funding bash ops/scalable-settlement-smoke.sh`
with a fresh run directory. For independent replay build the `funding_prefix_replay`
example in `financial-core` with `--features parallel-market-prototype` and run
`node --import tsx tests/performance/replay-cross-fill-funding.ts <run-directory>`.

### Reproduce the read-only market route

Build clean revision `10ab3b5` with
`RIVALT_ATTRIBUTION_PROFILE=read-only-route-market bash ops/build-profit-attribution.sh`.
Export the printed directory as `RIVALT_SETTLEMENT_ARTIFACT_DIR`.
At clean harness revision `d45eae7`, run
`RIVALT_SETTLEMENT_PROBE=profit-attribution-market-lanes bash ops/scalable-settlement-smoke.sh`
for paired fills, withdrawal and freeze, and
`RIVALT_SETTLEMENT_PROBE=profit-attribution-market-lane-funding bash ops/scalable-settlement-smoke.sh`
for the nonzero-premium cross-account and outage cases. Run the latter at
`aa0a209` to include the two-maker reversal. Each invocation owns a
fresh Surfpool instance and PostgreSQL database.

### Reproduce clearing-owned joint recovery

On clean program revision `efbaa024`, build the candidate with
`RIVALT_ATTRIBUTION_PROFILE=recovery-search-qualification bash ops/build-profit-attribution.sh`.
Export the printed directory as `RIVALT_SETTLEMENT_ARTIFACT_DIR`. Return to
the qualification revision recorded in [validation](validation.md#clearing-owned-joint-recovery).
Build its pinned page helper with `bash ops/build-settlement-helper.sh recovery-search-candidate`.
Run either case with the repository's pinned local Surfpool and PostgreSQL tools.

```sh
RIVALT_FROZEN_PLAN_PROOF=1 RIVALT_SETTLEMENT_PROBE=profit-attribution-owned-cross \
  bash ops/scalable-settlement-smoke.sh

RIVALT_FROZEN_PLAN_PROOF=1 RIVALT_FROZEN_PLAN_CASE=equal-winners \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-owned-tie bash ops/scalable-settlement-smoke.sh
```

Each case uses a fresh local deployment. It reconstructs the book from signed
fills, checks an inferior proposal, restarts the verifier, and follows clearing
and the wallet through actual RPC. The pricing and custody fixtures use test
collateral. The separate external review and funded-pilot gates still apply.

### Reproduce the combined clearing lifecycle

Build clean program revision `5d7a7c0f` with
`RIVALT_ATTRIBUTION_PROFILE=integrated-recovery-qualification bash ops/build-profit-attribution.sh`.
Export the resulting directory as `RIVALT_SETTLEMENT_ARTIFACT_DIR`. At the
harness revision in [validation](validation.md#combined-clearing-lifecycle),
run `bash ops/build-settlement-helper.sh integrated-recovery-candidate` once.
Each invocation below starts its own local chain and PostgreSQL database.

```sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-lanes bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-funding bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-payout bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-receiver bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-automatic-liquidation bash ops/scalable-settlement-smoke.sh
RIVALT_FROZEN_PLAN_PROOF=1 RIVALT_SETTLEMENT_PROBE=profit-attribution-owned-integrated bash ops/scalable-settlement-smoke.sh
```

To measure ordinary payout on that same artifact, run each case separately.
Each starts the settlement worker before the close, verifies its signed originals,
withdraws the gain, and replays finalized history into a fresh SQL database.

```sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-warm-payout bash ops/scalable-settlement-smoke.sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-integrated-delayed-payout bash ops/scalable-settlement-smoke.sh
```

The second case interrupts collection after the worker persists its signed wire.
Each run writes `ordinary-timing.json` under its ignored run directory.

For the financial-domain comparison, build both revisions in
[validation](validation.md#financial-domain-extraction) with the integrated
feature above. Set `RIVALT_DOMAIN_COMPARISON=baseline` for the parent or
`extracted` for the successor and point `RIVALT_SETTLEMENT_ARTIFACT_DIR` at the
corresponding build. Run the integrated payout and receiver commands separately.
The harness verifies the exact binary against the comparison pin before deployment.

For the automatic recovery keeper, build its native selector on the same
checkout. The acceptance command also builds it before running the worker.

```sh
cargo build --locked --offline --release -p default-plan-selection --features keeper --bin rivalt-recovery-selector
RIVALT_RECOVERY_SCHEDULE_BUDGET=3000 RIVALT_FROZEN_PLAN_PROOF=1 \
  RIVALT_SETTLEMENT_PROBE=profit-attribution-owned-integrated bash ops/scalable-settlement-smoke.sh
```

The budget is the maximum number of schedules this local sponsor will compare
for one frozen book, from 1 to 65,536. Omit it to leave submission to another
payer. A larger budget increases native CPU and memory use. The ordinary P56
runtime has its own recovery worker. The [successor worker contract](../application/interfaces.md#local-joint-recovery-selection)
lists its blocked outcomes and restart behavior.

### Reproduce recovery across two frozen pages

Build the clearing SBF from clean revision `37672622` with
`RIVALT_ATTRIBUTION_PROFILE=paged-recovery-qualification bash ops/build-profit-attribution.sh`.
Export the printed directory as `RIVALT_SETTLEMENT_ARTIFACT_DIR`. From the
[harness revision](validation.md#recovery-selection-across-two-membership-pages),
run `bash ops/build-settlement-helper.sh paged-recovery-candidate`. Each command
starts its own Surfpool venue and PostgreSQL database.

```sh
export RIVALT_FROZEN_PLAN_PROOF=1 RIVALT_RECOVERY_SCHEDULE_BUDGET=3000
export RIVALT_SETTLEMENT_PROBE=profit-attribution-owned-paged
RIVALT_FROZEN_PLAN_CASE=paged-wallet bash ops/scalable-settlement-smoke.sh
RIVALT_FROZEN_PLAN_CASE=paged-insurance bash ops/scalable-settlement-smoke.sh
```

Both cases include a flat BTC creditor on the second page. The insurance case
changes the collateral deposit before the five fills, causing a second rate
calculation. If a keeper preflight refuses a step, the harness saves its
source accounts and both signed simulation wires in `blocked-paged-step.json`.
Reproduce the CU and error against the same binary with
`node --import tsx tests/rpc-contract/replay-paged-step.ts <capture> <clearing.so>`.

### Combined local successor qualification

Build clearing at `d9a2a55b` with `RIVALT_ATTRIBUTION_PROFILE=local-successor-qualification bash ops/build-profit-attribution.sh`.
Set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to the resulting directory. From the
qualification checkout, build the native helper with
`bash ops/build-settlement-helper.sh local-successor-candidate`.
The probes check the exact clearing and maker hashes before deployment.

Run `bash ops/scalable-settlement-smoke.sh` once for each probe below, with a
fresh `RIVALT_RUN_DIR` for each run. The harness starts local Surfpool and
PostgreSQL. In the table, prefix each probe name with `profit-attribution-successor-`.

| Probe | Additional environment | Observed boundary |
|---|---|---|
| `workload` | None | Thirty rounds of paired fills, market fee reconciliation, exit and freeze |
| `funding` | None | Cross-market funding progress through a publication outage |
| `warm-payout`, `delayed-payout` | None | Close to funded cash and wallet transfer, including restart |
| `automatic-liquidation` | None | Maker admission, unfunded receiver refusal, funded takeover and restored health |
| `recovery` | `RIVALT_FROZEN_PLAN_PROOF=1`, `RIVALT_RECOVERY_SCHEDULE_BUDGET=3000`, `RIVALT_FROZEN_PLAN_CASE=paged-wallet` or `paged-insurance` | Nine-member complete freeze, keeper restart, insurance, wallet exits and independent replay |

After a workload run use `python3 tests/performance/successor-workload-cost.py "$RIVALT_RUN_DIR"`
to reproduce fees by actual payer, CU and lock conflicts from finalized transaction
bytes. Run `node --import tsx tests/performance/successor-proof-space.ts` to
measure the search account's minimum bytes at the selected launcher's population.

### Populated successor recovery inputs

Build the opt-in clearing artifact at `ba2057df` with
`RIVALT_ATTRIBUTION_PROFILE=partitioned-recovery-inputs bash ops/build-profit-attribution.sh`.
Back in the qualification checkout, run the following with that directory
as `RIVALT_SETTLEMENT_ARTIFACT_DIR` and a fresh `RIVALT_RUN_DIR`.

```sh
source ops/env.sh
cargo build --locked --offline --release -p default-plan-selection --features keeper --bin rivalt-recovery-selector
RIVALT_SETTLEMENT_PROBE=profit-attribution-partitioned-population bash ops/scalable-settlement-smoke.sh
```

The test creates 128 Financial members using signed transactions, then
registers the exact BTC and ETH charge terms for each member during frozen
valuation. To reproduce the size of the search from the retained freeze,
run `target/release/rivalt-recovery-selector --dimensions < "$RIVALT_RUN_DIR/population-input.json"`.
This measurement visits eligible debtor/winner pairs once. It grants no
authority to settle the book.

To reproduce the original-rate and debtor-budget checks, build clearing at
`16f89bef` with `RIVALT_ATTRIBUTION_PROFILE=populated-recovery-qualification
bash ops/build-profit-attribution.sh`. In the harness checkout at `acdb2e30`
or a compatible revision, use the selector build above and run

```sh
RIVALT_SETTLEMENT_PROBE=profit-attribution-original-budgets \
RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/profit-attribution/build-16f89befe4682ab75a7480b9e1b2410ca3e87dc1 \
RIVALT_RUN_DIR=.local/profit-attribution/original-budget-reproduction \
bash ops/scalable-settlement-smoke.sh
```

Use a new run directory for each qualification. The harness deploys locally,
captures the frozen RPC rows, compares the clearing calculation with an
independent fractional reference and replays the financial journal into a
fresh PostgreSQL database.

For the foreign charge cap check, build the same opt-in feature at `7df9585e`.
Use `RIVALT_SETTLEMENT_PROBE=profit-attribution-foreign-caps` and
`RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/profit-attribution/build-7df9585e0c3b99d62b6ffea4c6189609b7dd22e0`
in the command above. Harness `b43351f8` checks each prefix and the final
caps before comparing the complete financial checkpoint on fresh SQL replay.
