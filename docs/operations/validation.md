# Verification and qualification

Use the smallest check that exercises the changed behavior. For a financial transition, derive expected values independently and verify the actual handler. Select the binary and helper expected by each harness. The fresh-demo installer and historical smoke wrappers have distinct artifact formats. For an integrated claim, submit the signed transaction, fetch its finalized RPC result, inspect the account and token changes, and replay the finalized history through PostgreSQL. A local calculation, simulation, submitted signature and wallet receipt establish different facts.

## Checks by change

| Change | Focused checks |
|---|---|
| Documentation | Check local links and heading anchors, referenced files and commands, `git diff --check` and `python3 ops/check-evidence-policy.py`. |
| Accounts, wire or SDK | `python3 ops/wire_contract.py`, `pnpm generate:check`, `pnpm typecheck`, affected instruction/IDL conformance and signed rollback cases. [Isolated legacy client](../../tests/anchor-conformance/) |
| Prices, margin, cash or default | [Independent financial models](../../tests/financial/) and the affected Rust crate. Exercise boundary, fee, funding, fractional ownership and conservation through the appropriate [RPC harness](../../tests/rpc-contract/). |
| Maker quote or router | `python3 tests/financial/test_maker_curve_contract.py`, `python3 tests/financial/check_liquidity_allocation.py`, affected SDK tests, and a signed fill/refusal using the intended deployment profile. |
| Funding or services | `bash ops/funding-publisher-smoke.sh` or `bash ops/liquidity-services-smoke.sh` with their pinned artifacts. Verify actual report expiry or restart/replay for the affected path. |
| User-facing trade and payout | Verify wallet review and guards, actual fills, fees, inventory, funded and unpaid balances, vault movement and fresh SQL replay. [Wallet workload](local-development.md#wallet-load-comparison) |
| CI scope | [Workflow](../../.github/workflows/pr-checks.yml) and [scope selector](../../ops/ci-scope.py). Broad regression belongs in the relevant CI jobs. |

### Local qualification and PR checks

Before opening a PR, exercise the changed behavior. Record the command, program
and harness revisions, deployment profile and result for a signed qualification.
Reuse that result across the stack while its source, inputs and dependencies are
unchanged. If a later layer changes them, rerun the affected scenario on the
combined revision. Program builds, IDL generation from Rust, Surfpool transactions
and PostgreSQL reconciliation run locally.

GitHub selects checks from the PR's delta against its parent. Documentation-only
PRs run repository guards. Trader changes run the trader and demo tests and build
the UI. Indexer changes run indexer and consumer tests. Shared SDK or event format
changes run the full client suite. CI owns the broad client regression so a local
pre-PR run can focus on the specific change.

Shared financial crates and Rust dependencies select the broader reference tests.
Indexed default changes select the settlement verifier, funded-book and Python
rounding and allocation regressions. Rust fixture changes select the corresponding
native crate. CI checks the generated SDK against the committed IDLs on shared
client changes. A clean CI run covers the selected host checks. Signed financial
acceptance uses the separately recorded deployment and wallet results.

## Funded venue default and creditor wallet exits

Use this check for a change to venue freeze, insurance, complete-book settlement
or owner exits. The reviewed comparison used two clean checkouts. Build the
`listed-venue-default` profile on clearing `69c2f5d559221309107055ace615d35cff7d115b`.
Use harness `49623912407acd0f124d6038ff230cdcf3e55dfd` to run two fresh
BTC/ETH/SOL venues. Follow the [artifact setup](local-development.md#reproducing-a-qualification)
in both checkouts.

In the program checkout, choose an unused build directory. The build script
records the source revision, selected profile and binary hashes.

```sh
source ops/env.sh
RIVALT_ATTRIBUTION_PROFILE=listed-venue-default bash ops/build-profit-attribution.sh
```

In the harness checkout, set `RIVALT_SETTLEMENT_ARTIFACT_DIR` to the absolute
path of the resulting program build. The default output is
`.local/profit-attribution/build-<full-program-revision>` in the program checkout.
The wrapper uses a fresh run directory by default.

```sh
source ops/env.sh
export RIVALT_ROUTER_REVISION=69c2f5d559221309107055ace615d35cff7d115b
: "${RIVALT_SETTLEMENT_ARTIFACT_DIR:?set this to the absolute program build directory}"
export RIVALT_SETTLEMENT_PROBE=execution-router-funded-listed-default
RIVALT_LISTED_DEFAULT_CASE=insured bash ops/scalable-settlement-smoke.sh
RIVALT_LISTED_DEFAULT_CASE=residual bash ops/scalable-settlement-smoke.sh
```

Compare the proposed allocation with the independent whole-book reference.
For the insured case, verify that the frozen shortfall is covered, the charge
to winning positions is zero and creditors can withdraw in full. For the
residual case, check each market's insurance spend and each winner's charge.
In both cases reconcile all funded entitlements and retained fees to the vault,
each signed withdrawal to its SPL wallet, and the finalized events to a fresh
PostgreSQL replay. Check atomic refusal on omitted members, incorrect plans
and replay of a settled episode. [Measured outcomes](performance.md#default-and-wallet-exits) · [Funded harness](../../tests/rpc-contract/funded-listed-default.ts)

## Choosing a comparison workload

| Change under test | Acceptance |
|---|---|
| Margin width or cash access | Compare the maximum cash withdrawal against independently enumerated funding endpoints. Exercise one atom above the maximum, missing markets and live reservations. Check both sides of internal transfers and verify the wallet token delta on withdrawals. [Native and signed width recipes](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/operations/validation.md#local-qualification-and-pr-checks) |
| Closed-profit eligibility or backing | Compare open, partially closed and flat claims. On an open book, shock an idle debtor, change membership and restart the worker. Check rejection while underfunded and the owner's withdrawal after recovery. Count individual debtor checks and competing fills. [Grouped workload recipe](local-development.md#reproducing-a-qualification) |
| Wallet flow, quoting or funding | Compare the same offered trace and funded books across arms. Count offered, eligible, signed, refused and finalized orders, with fees, filled notional, funding coverage and time to wallet. Verify the actual filled legs, source times, wallet balances and finalized journal. [Wallet controls](local-development.md#wallet-load-comparison) |
| Liquidation or default under load | Verify receiver consent and capital, deficit reduction after fees, preservation of foreign creditors, progress through restart and final owner exits. Vary debt concentration separately from participant count. Findings 5 and 8 track the deferred combined exercise. [Scorecard](qualification-scorecard.md#findings-to-revisit) |

Report program and harness commits, workload denominator, result and remaining
limits in the PR. Raw logs, transactions and evidence stay in their ignored
local paths. Historical devnet observations and earlier fixture acceptance are
available through the [history index](../HISTORY.md).
