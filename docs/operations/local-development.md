# Local development

## Pinned toolchain

| Component | Pin / distinction |
|---|---|
| Host Rust / Cargo | 1.97.1, pinned by rust-toolchain.toml |
| Anchor CLI / anchor-lang | 1.2.1; default `solana-v3`, `event-cpi` enabled |
| Agave CLI distribution | 4.1.2, source 182084b8 |
| Bundled cargo-build-sbf | 4.1.0; its displayed default platform-tools is v1.54 |
| Explicit SBF build | platform-tools v1.52, rustc 1.89.0-dev, SBPF v0 |
| Surfpool | 1.6.1; RPC reports solana-core 4.2.1, feature-set 565236538 |
| Node / pnpm | 24.22.0 / 10.23.0 |
| Application web3.js / Kit | 3.1.1 / 8.5.0 |
| Wallet compatibility | wallet-adapter 3.1.1, React / React DOM 19.3.0 |
| Generator | codama 1.11.0, nodes-from-anchor 1.5.6, renderers-js 2.8.0 |
| Legacy test process | @anchor-lang/core 1.2.1, web3.js 1.99.0 |
| TypeScript / test runner | 5.9.3 / Vitest 3.2.4 |


Also retain Anchor SPL 1.2.1, LiteSVM 1.6.1, Fastify 5.12.7, pg 8.23.1,
PostgreSQL 18.6, Vite 7.3.7 and Playwright core 1.64.1. Lockfiles and
[download manifests](../../ops/toolchain-downloads.json) are authoritative. Host
Rust, SBF compiler, runtime version and transaction format are different identities.
Legacy Anchor/web3.js 1.x lives only in `tests/anchor-conformance`; no runtime
imports or workspace overrides make it appear compatible with the modern client.

From the repository root, bootstrap only missing tools:

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
bash ops/build-liquidity-execution.sh
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

## Earlier interactive demo

`bash ops/demo.sh start|status|stop|reset` is the existing profile-3 demo, not yet
the canonical profile-4 launcher. It needs qualified `.local/account-safety/`
artifacts and frozen dependencies. Open `http://127.0.0.1:18083`, select **Rivalt
Local Demo**, get test funds, create portfolio/cross or isolated account, deposit,
trade BTC/ETH, place/cancel existing-position TP/SL, close and withdraw admissible
cash. Fixed synthetic prices demonstrate placement, not triggered-stop execution.

The opt-in test wallet stays in the browser tab, including across reload; closing
the tab loses its key. Never fund it with real assets. Local faucet is limited to
one SOL/1,000 test USD and 16 wallets per session, bound to origin and genesis.
Uncertain funding originals keep their allowance; success waits for finality.
The instrumented wallet is not Phantom compatibility evidence.

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

`pnpm smoke` remains the broad historical matrix, not a default current PR check.
Earlier launchers/feature profiles remain until P37 consumer retirement; historical
reproduction instructions are pinned in [HISTORY](../HISTORY.md). Do not point an
old suite at new accounts or claim its results validate a new implementation.
