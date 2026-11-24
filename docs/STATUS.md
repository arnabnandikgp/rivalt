# Project status

Updated 24 November 2026. Rivalt is a local, test-collateral BTC/ETH perpetual venue. The wallet uses on-chain execution-time routing across three internal makers per market. A fill selects up to two maker capitals. The same clearing engine handles isolated and cross accounts.

## Integrated

| Area | Last verified scope |
|---|---|
| Execution and wallet | Fresh sessions use `bounded-router-candidate`, program revision `986b3cd3`. An execution-time reprice changed the winning makers. Search-budget and trader-limit refusals rolled back the trade. [Routing](liquidity/routing.md) |
| Ordinary settlement | The worker can pay a ready creditor while another market builds its backing proof. A 16-wallet BTC payout completed in 93.041 seconds in the review repeat. [Settlement PR #168](https://github.com/arnabnandikgp/rivalt/pull/168) |
| Wallet load and maker capacity | In a 24-wallet burst, waiting for the previous wallet order to confirm and resizing one maker improved fills to 119 of 120. One signed route still failed admission after preview. [Workload PR #169](https://github.com/arnabnandikgp/rivalt/pull/169) |
| Recovery | Earlier pinned recovery runs verified all 128 payouts on one populated book and completed wallet exits after keeper restart on three 75-member books. The verifier and book determine the work. [Validation](operations/validation.md) |

PRs #168 and #169 merged together at [`9c482583`](https://github.com/arnabnandikgp/rivalt/commit/9c4825830842b6cd316ebd6c8458ecc9d34e28a9). The merge revision, harness revision and deployed program revision serve different purposes.

## Limits and next action

The fixed BTC notional baseline is in review. On the same router binary, all three internal makers quoted each request from $100 to $61,000. Clearing rejected all four at the trader's profit-history storage check. One- and three-lot buys filled, closed and paid 3,884 net atoms to the wallet. The earlier 1,000-lot search refusal and order 109's route-health refusal occurred on different books. [Sizes, receipts and limits](operations/performance.md#btc-orders-at-fixed-dollar-sizes)

The [venue qualification scorecard](operations/qualification-scorecard.md) tracks nine findings and their closure criteria. Position storage and the trader benchmark are the active priorities. The combined market-shock and recovery exercise is deferred.

On `6c8795f6`, the native accounting case measured 805 bytes after 220 interleaved open-profit payments on the $100 position. Re-reading finalized receipts from the existing 24-wallet burst verified 14.457474 tokens of filled notional and zero split fills. These are a storage comparison and a historical workload measurement. The on-chain storage fix and broader benchmark remain open.

**Next action.** Evaluate an exact position-history layout with additional storage for fractions that outgrow the inline slot. Establish how increases fund that storage and how reductions and payments can finish when the owner is offline. Compare it against the four fixed sizes and the 220-payment histories before changing clearing.

| Open gate | What remains |
|---|---|
| Market scale and economics | Meaningful executable depth, sustained maker inventory, funded maker P&L, keeper incentives and payout time under adverse flow. [Risk and liquidation](clearing/risk-and-resolution.md) |
| Independent maker validation (P15B) | An external maker must independently operate, reconcile and exit. All makers in the local evidence were internal. |
| Independent review and funded-pilot readiness (P16B) | Separate review, risk calibration and authorization. Default/devnet builds keep the current financial paths disabled. |
| Continuous 24-hour endurance | Deferred. Earlier short runs qualify only their recorded workloads. |

The current protocol guides merged at `cfd2626c`. Harness `c4800d5e` reproduced all six outcomes and CU measurements from `5c3ac284` on clearing `986b3cd3`. Each signed run reconciled 357 events through fresh PostgreSQL replay.
