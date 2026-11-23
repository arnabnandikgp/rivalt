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

Maker inventory is the immediate trading constraint. With the largest supported profit-history slot, a signed local BTC maker carried 256 lots ($15.62 at the test price) and refused lot 257. The price book still offered 2 BTC. A different history can exhaust storage earlier. A separate 1,000-lot routed order exhausted the on-chain search budget. [Measurements and conditions](operations/performance.md)

**Next action.** establish a dollar-denominated BTC baseline that holds the order sequence fixed and records the first failure from quote through fill, payout and wallet exit. Track the remaining route-health error 6120 from order 109 alongside the distinct capacity and search failures. Changes to creditor rights, funding depth or liquidation incentives require a separate economic decision.

| Open gate | What remains |
|---|---|
| Market scale and economics | Meaningful executable depth, sustained maker inventory, funded maker P&L, keeper incentives and payout time under adverse flow. [Risk and liquidation](clearing/risk-and-resolution.md) |
| Independent maker validation (P15B) | An external maker must independently operate, reconcile and exit. All makers in the local evidence were internal. |
| Independent review and funded-pilot readiness (P16B) | Separate review, risk calibration and authorization. Default/devnet builds keep the current financial paths disabled. |
| Continuous 24-hour endurance | Deferred. Earlier short runs qualify only their recorded workloads. |

Documentation validation against integrated revision `9c482583` passed for relative links, headings, pinned Git references, shell examples and tracked-evidence policy. The storage and wallet figures were checked against existing records. Program qualification remains tied to the revisions above.
