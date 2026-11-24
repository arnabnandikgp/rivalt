# Project status

Updated 24 November 2026. Rivalt is a local, test-collateral BTC/ETH perpetual venue. The wallet uses on-chain execution-time routing across three internal makers per market. A fill selects up to two maker capitals. The same clearing engine handles isolated and cross accounts.

## Integrated

| Area | Last verified scope |
|---|---|
| Execution and wallet | The previously integrated `bounded-router-candidate` ran at program revision `986b3cd3`. An execution-time reprice changed the winning makers. Search-budget and trader-limit refusals rolled back the trade. [Routing](liquidity/routing.md) |
| Ordinary settlement | The worker can pay a ready creditor while another market builds its backing proof. A 16-wallet BTC payout completed in 93.041 seconds in the review repeat. [Settlement PR #168](https://github.com/arnabnandikgp/rivalt/pull/168) |
| Wallet load and maker capacity | In a 24-wallet burst, waiting for the previous wallet order to confirm and resizing one maker improved fills to 119 of 120. One signed route still failed admission after preview. [Workload PR #169](https://github.com/arnabnandikgp/rivalt/pull/169) |
| Recovery | Earlier pinned recovery runs verified all 128 payouts on one populated book and completed wallet exits after keeper restart on three 75-member books. The verifier and book determine the work. [Validation](operations/validation.md) |

PRs #168 and #169 merged together at [`9c482583`](https://github.com/arnabnandikgp/rivalt/commit/9c4825830842b6cd316ebd6c8458ecc9d34e28a9). The merge revision, harness revision and deployed program revision serve different purposes.

## Limits and next action

Fresh local venues use `closed-quantity`. Ordinary price profit becomes eligible when the trader reduces or closes the position. A payment still needs funded backing. Existing venue journals retain their original deployment identity. [Settlement contract](clearing/accounting.md#ordinary-payouts-on-closed-quantity)

On clearing `ec6f1ffa` with harness `ed60fc6c`, all four BTC buys from $100 through $61,000 and both control buys filled on the initial 128-byte slots. With the pool already funded, clearing refused payment on the open position. After a partial close it paid 588.622056 test collateral and refused one atom more. After the final close the wallet withdrew 1,148.168568 net. Fresh PostgreSQL replay matched all 381 events. On the previous binary the four larger buys failed storage admission. [Signed results](operations/performance.md#closed-quantity-settlement)

On that same clearing binary with harness `4718f365`, the nine-member BTC/ETH default verified both markets, applied the joint plan and reached the trader and three maker wallet withdrawals. Fresh PostgreSQL replay matched 176 events. [Recovery qualification](operations/validation.md#evidence-by-deployment)

The [venue qualification scorecard](operations/qualification-scorecard.md) tracks nine findings. Position storage and representative trader workloads remain the first two priorities. A native mixed-price history completed 984 round trips within a 256-byte slot, then required 257 bytes for the next increase. The surviving position could still close and collect its claim. The combined market-shock and recovery exercise is deferred.

**Next action.** Exercise sustained mixed-price maker inventory on the signed local deployment through storage saturation, refused increase, partial reduction and wallet exit. Record trader and maker bytes separately and reconcile the receipts before expanding the workload.

| Open gate | What remains |
|---|---|
| Market scale and economics | Meaningful executable depth, sustained maker inventory, funded maker P&L, keeper incentives and payout time under adverse flow. [Risk and liquidation](clearing/risk-and-resolution.md) |
| Independent maker validation (P15B) | An external maker must independently operate, reconcile and exit. All makers in the local evidence were internal. |
| Independent review and funded-pilot readiness (P16B) | Separate review, risk calibration and authorization. Default/devnet builds keep the current financial paths disabled. |
| Continuous 24-hour endurance | Deferred. Earlier short runs qualify only their recorded workloads. |

The current protocol guides merged at `cfd2626c`. Harness `c4800d5e` reproduced all six outcomes and CU measurements from `5c3ac284` on clearing `986b3cd3`. Each signed run reconciled 357 events through fresh PostgreSQL replay.
