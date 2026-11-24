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

## Evidence by deployment

| Path | What was verified | Evidence and limits |
|---|---|---|
| Current execution-time router, `986b3cd3` | Signed singleton and two-maker fills, reprice at landing, atomic limit and search refusals. | [PR #167](https://github.com/arnabnandikgp/rivalt/pull/167). The [fixed BTC notional baseline](performance.md#btc-orders-at-fixed-dollar-sizes) adds signed capacity refusals, rollback and an SPL wallet exit after the control fills. |
| Maker liquidation and receiver, `5d7a7c0f` | On a 50-lot trader, the keeper sold ten lots to a maker, held when the receiver lacked capital, then transferred five after funding. The maintenance deficit reached zero with 35 lots remaining. | [PR #143](https://github.com/arnabnandikgp/rivalt/pull/143). The operator owned the receiver. Independent liquidator participation and profitability are open. |
| Default on populated books | On `3acd4a4d`, all 128 members reconciled and one wallet withdrew 986,527 atoms. One payout calculation took 471 continuations. On `79724a5a`, three 75-member books completed after keeper restart using 193, 285 and 327 finalized keeper transactions. | [128-member qualification](https://github.com/arnabnandikgp/rivalt/pull/152) · [75-member qualification](https://github.com/arnabnandikgp/rivalt/pull/158). Costs depend on frozen positions, claims and proof eligibility. |
| Earlier devnet and external gates | Historical devnet oracle and external wallet registration used previous programs. Current trading is local. | [Historical record](../HISTORY.md) · [Open gates](../STATUS.md). |

The [closed-quantity payout comparison](qualification-scorecard.md#closed-quantity-payout-comparison) on `afc45179` ran eight native cases against the financial crates. It establishes the payout and storage results for those histories. The signed router measurements above use the deployed closed-first rule.

Retain raw evidence at its ignored local path. Record new results against exact program and harness revisions, with the denominator, failed attempts, economic outcome and remaining limitation. Detailed runs and reproduction notes belong in the PR.
