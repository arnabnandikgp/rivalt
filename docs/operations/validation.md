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

On wide routing clearing `5e32c124` with harness `951adeea`, two ordinary
100-lot buys used 405,464 CU (BTC, 16 makers, 27 loaded accounts) and
445,226 CU (ETH, 32 makers, 32 loaded accounts). The later ETH quote from a
supplied maker won. An omitted reprice was cheaper. A one-lot explicit
reduction used 252,986 CU. Wrong-lane and price-limit refusals rolled back.
A clean database independently replayed 358 events and reconciled 395 RPC
accounts. This run used internal test collateral and a three-maker shortlist.

## Evidence by deployment

| Path | What was verified | Evidence and limits |
|---|---|---|
| Funded maker search, clearing `e02e72a0`, harness `db964391` | At the signed $100.053343 ceiling the ETH buy filled at maker 1 in 434,876 transaction CU. The $100.046674 ceiling refused in 359,578 CU. All other signed outcomes and fill amounts matched the prior routed run. | 24/36 filled, including 22/30 ordinary BTC requests. Checked atomic refusals, wallet exit and 463 replayed events. [Reproduction](local-development.md#matched-btc-fill-benchmark) |
| Matched wallet and explicit legs, clearing `b7e4458b`, harness `6ddfcaee` | Both venues filled 22/30 ordinary BTC requests, including three splits, across deep, fragmented and one-sided books. With an underfunded maker, the ETH router returned 6133 and the explicit alternative finalized. | 36 measured signed requests per venue, atomic refusals, two SPL exits, and 422/463 reconciled PostgreSQL events. [Dollar fills and costs](performance.md#dollar-sized-orders-and-executable-depth) |
| Frozen default with fixed-width entry, clearing `b7e4458b`, harness `d175285e` | The nine-member BTC/ETH freeze verified the joint plan, charged 13 and 12 atoms and completed four wallet withdrawals. | 126 keeper originals, 176 replayed events, eight legacy/RC2 instruction encodings. The near-tick counterexamples were exercised separately in native financial tests. |
| Fixed-width local entry, clearing `b7e4458b`, harness `d175285e` | 163/163 BTC wallet fills across 80 inventory cycles, fixed 40-byte market records, maker withdrawal, and an independent six-buy partial-close and payout lifecycle. | Fresh PostgreSQL replay of 951 and 381 events respectively. [Measured CU and sizes](performance.md#fixed-width-maker-entry) |
| Mixed-price maker inventory, clearing `ec6f1ffa` | The signed wallet-budget run reached a maker storage refusal and a compute refusal. The diagnostic run reached the 128- and 256-byte storage refusals. Each run verified exact entries on both sides, rolled back refused fills, reduced the maker to flat and withdrew principal plus profit to its SPL wallet. | Wallet harness `24af1d2d` reconciled 840 events. Diagnostic harness `aca1e51c` reconciled 872. [Workload, CU and amounts](performance.md#mixed-price-maker-storage) |
| Ordinary payouts on closed quantity, clearing `ec6f1ffa`, harness `ed60fc6c` | Six buys filled. With cash already collected in the BTC pool, clearing refused open-price profit, paid the partial-close ceiling, and refused an extra atom. The wallet received 1,148.168568 net after final close and withdrawal. | [Sizes, CU and limits](performance.md#closed-quantity-settlement). Finalized RPC, token balances and 381 replayed PostgreSQL events cover one deterministic book. |
| Frozen default on closed quantity, clearing `ec6f1ffa`, harness `4718f365` | A nine-member BTC/ETH book verified the joint plan, charged 13 and 12 atoms, then completed one trader and three maker withdrawals. | 126 keeper originals, 176 replayed events and eight recovery instruction encodings checked. This run covers this frozen book. [Reproduction](local-development.md#closed-quantity-payout-qualification) |
| Earlier execution-time router, `986b3cd3` | Signed singleton and two-maker fills, reprice at landing, atomic limit and search refusals. | [PR #167](https://github.com/arnabnandikgp/rivalt/pull/167). The [fixed BTC notional baseline](performance.md#btc-orders-at-fixed-dollar-sizes) adds signed capacity refusals, rollback and an SPL wallet exit after the control fills. |
| Maker liquidation and receiver, `5d7a7c0f` | On a 50-lot trader, the keeper sold ten lots to a maker, held when the receiver lacked capital, then transferred five after funding. The maintenance deficit reached zero with 35 lots remaining. | [PR #143](https://github.com/arnabnandikgp/rivalt/pull/143). The operator owned the receiver. Independent liquidator participation and profitability are open. |
| Default on populated books | On `3acd4a4d`, all 128 members reconciled and one wallet withdrew 986,527 atoms. One payout calculation took 471 continuations. On `79724a5a`, three 75-member books completed after keeper restart using 193, 285 and 327 finalized keeper transactions. | [128-member qualification](https://github.com/arnabnandikgp/rivalt/pull/152) · [75-member qualification](https://github.com/arnabnandikgp/rivalt/pull/158). Costs depend on frozen positions, claims and proof eligibility. |
| Earlier devnet and external gates | Historical devnet oracle and external wallet registration used previous programs. Current trading is local. | [Historical record](../HISTORY.md) · [Open gates](../STATUS.md). |

The [closed-quantity payout comparison](qualification-scorecard.md#closed-quantity-payout-comparison) on `afc45179` ran eight native cases against the financial crates. It establishes the payout and storage results for those histories. The longer native mixed-price history exposed a storage limit in that exact-entry profile.

The [entry-cost bounds comparison](qualification-scorecard.md#can-two-entry-cost-bounds-certify-the-exact-payment) on `0bf61818` verified the 32-byte representation against exact attribution on retained fill histories and rounding boundaries. Two histories with the same stored bounds require different payments. This is native evidence only.

The [exact replay experiment](qualification-scorecard.md#exact-replay-from-a-verified-checkpoint) on `3c0e35b4` recovered both entitlements with authenticated fill data and measured the first exact-record overflow on a longer frozen history. The commitments and checkpoint rotations were modeled locally. That experiment used exact records. Fresh local deployments use the [40-byte entry record](../clearing/accounts.md#wire-format-and-changes).

Retain raw evidence at its ignored local path. Record new results against exact program and harness revisions, with the denominator, failed attempts, economic outcome and remaining limitation. Detailed runs and reproduction notes belong in the PR.

The opt-in local multi-maker deployment has signed three-, four- and eight-leg fills, independent financial expectations, a last-leg rollback and fresh PostgreSQL replay. Wallet-relay authorization was checked on the original signed bytes. The isolated Anchor clients reproduced four wider instruction payloads from the retained originals and decoded 21 committed clearing events. The IDL lock inventory lists the fixed context. The signed widths include the dynamic maker accounts. [Measured widths and exact deployment](performance.md#atomic-fills-across-three-to-eight-makers)

Six matched venues independently replayed their completed journals into PostgreSQL. The economic report audited all 48 signed order receipts and counted twelve more wallet refusals before signing. The independent flat-book optimizer also matched 576 exhaustive small-book quantity enumerations. [Matched dollar results and scope](performance.md#matched-dollar-execution-across-16-and-32-makers)

The depth-aware wallet repeat on clearing `f0b8a599` and SDK/harness `0edb3064` audited 48 signed receipts, twelve unsigned refusals and six fresh PostgreSQL replays. Both formerly omitted eight-leg sales reached the previously computed reference proceeds. [Matched outcomes and limits](performance.md#wallet-selection-by-order-size)

The curved-book and maker-margin comparison on clearing `f0b8a599` and signed harness `b61ade13` verified five wallet-signed orders across two fresh venues. Three filled and two rolled back. PostgreSQL independently replayed 181 wallet-venue events and 188 control-venue events, with funded vaults reconciled in both. The report checks equal pretrade economic inputs across arms. Finding 2 remains open for both orders. [Execution prices and refusal causes](performance.md#curved-quotes-and-binding-maker-margin)

The signed funded-multi-maker repeat on clearing `50bd8836` and harness `152e4f18` reproduced the independently calculated ETH allocation through the ordinary wallet, verified a one-atom limit rejection, and landed the best four-curve BTC control. PostgreSQL reconciled both fresh journals. [Measured outcomes](performance.md#funded-opening-depth)

At wallet revision `7353f463` both ordinary orders, their signed controls and the one-atom refusal were audited on clearing `50bd8836`. Across these two matched local venues four signed fills landed and one signed order rolled back. Both fresh PostgreSQL replays reconciled 185 events. [Verified dollar fills](performance.md#price-aware-wallet-execution)
