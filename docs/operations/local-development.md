# Local development

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

The RC2 toolchain uses `bash ops/install-anchor-rc2.sh`, followed by
`bash ops/build.sh`. P49 qualifies the expanded-quantity serialized RC2 artifacts
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
Fresh schema-8 domains/databases are required; no old accounts or signed originals
are relabeled. [STATUS](../STATUS.md) distinguishes qualification and PR integration.
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
