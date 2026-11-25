# Project status

Updated 25 November 2026. Rivalt is a local, test-collateral BTC/ETH perpetual venue. The wallet uses on-chain execution-time routing across three internal makers per market. A fill selects up to two maker capitals. The same clearing engine handles isolated and cross accounts.

## Integrated

| Area | Last verified scope |
|---|---|
| Execution and wallet | The previously integrated `bounded-router-candidate` ran at program revision `986b3cd3`. An execution-time reprice changed the winning makers. Search-budget and trader-limit refusals rolled back the trade. [Routing](liquidity/routing.md) |
| Ordinary settlement | The worker can pay a ready creditor while another market builds its backing proof. A 16-wallet BTC payout completed in 93.041 seconds in the review repeat. [Settlement PR #168](https://github.com/arnabnandikgp/rivalt/pull/168) |
| Wallet load and maker capacity | In a 24-wallet burst, waiting for the previous wallet order to confirm and resizing one maker improved fills to 119 of 120. One signed route still failed admission after preview. [Workload PR #169](https://github.com/arnabnandikgp/rivalt/pull/169) |
| Recovery | Earlier pinned recovery runs verified all 128 payouts on one populated book and completed wallet exits after keeper restart on three 75-member books. The verifier and book determine the work. [Validation](operations/validation.md) |

PRs #168 and #169 merged together at [`9c482583`](https://github.com/arnabnandikgp/rivalt/commit/9c4825830842b6cd316ebd6c8458ecc9d34e28a9). The merge revision, harness revision and deployed program revision serve different purposes.

## Limits and next action

Fresh local venues use `bounded-entry`. Each position has a fixed 40-byte entry record. Ordinary price profit becomes eligible when the trader reduces or closes exposure and clearing has verified backing. Legacy journals retain their original binary and payout rule. [Settlement contract](clearing/accounting.md#ordinary-payouts-on-closed-quantity)

[PR #180](https://github.com/arnabnandikgp/rivalt/pull/180) qualifies fixed-width position storage. On clearing `b7e4458b` and harness `d175285e`, 163/163 signed wallet fills completed with a mixed-price maker, including 80 inventory increases. The maker withdrew its entire funded balance and PostgreSQL replay reconciled 951 events. A separate six-buy book rejected open profit and one atom above the partial-close ceiling, settled the remaining profit and withdrew 1,148.168568 net. Replay reconciled 381 events. [Measured CU, storage and workload](operations/performance.md#fixed-width-maker-entry)

On the same binary and harness, a nine-member BTC/ETH default verified the joint plan, charged 13 and 12 atoms, and completed one trader and three maker withdrawals. PostgreSQL replay matched 176 events. Both Anchor clients decoded the eight recovery instruction encodings identically.

At native test revision `1c37352d`, the independent exact-fraction model exercised 4,101 fills without growing a record. In two constructed histories the new rule permits 27 ordinary atoms and four forced atoms on both books. Exact history would permit 27/eight and 28/four respectively. On the eight-atom frozen book this gives the two creditors eight and zero. The conservative defaults and their consequences are intentional. [Decision](DECISIONS.md) · [Prior experiments](operations/qualification-scorecard.md#exact-replay-from-a-verified-checkpoint)

**Dollar-fill benchmark in review.** On clearing `b7e4458b` and harness `6ddfcaee`, the wallet filled 22/30 ordinary BTC orders and $243,600.755 of $462,600.942 requested at the index. The fragmented book filled 6/10 requests and 7.91% of requested dollars. Every completed fill matched the reference price and aggregate fee for its maker allocation. A separate $100 ETH buy failed even though a funded maker filled it within the same signed limit on the control venue. The per-order dollar report was checked against all 72 retained originals from the two runs. [Dollar outcomes](operations/performance.md#dollar-sized-orders-and-executable-depth) · [PR #181](https://github.com/arnabnandikgp/rivalt/pull/181)

On funded-routing clearing `e02e72a0` with harness `db964391`, the ordinary ETH buy filled 3,334 lots at maker 1 for 100,033,336 gross atoms plus a 20,007-atom fee. At the tighter 100,046,674-atom limit it refused and rolled back. The other 35 orders reproduced their baseline outcomes, including fills for 22/30 ordinary BTC orders. The funded wallet withdrew 499,925.164827 test tokens after closing BTC and ETH. Fresh PostgreSQL replay reconciled 463 events. The wallet still searches three internal makers and fills up to two.

**Wide discovery in review.** Clearing `5e32c124` and harness `951adeea` provisioned 16 BTC and 32 ETH makers on a fresh local venue. The wallet included three per order. Maker 15 filled BTC for 6,004,000 gross atoms. After signing, ETH maker 30 improved its ask and filled for 3,000,600 gross atoms. Maker 12 posted a cheaper omitted quote. An explicit BTC reduction filled, a substituted accounting lane and a breached trader limit both rolled back. PostgreSQL replay reconciled 358 events and 24,500 test tokens in custody. [Routing contract](liquidity/routing.md#wide-maker-discovery-in-local-qualification)

**Wider atomic fills in review.** Clearing `f0b8a599` and harness `c5d51f9c` filled the 163,935-lot BTC order across three makers in 399,121 CU. Four and eight real counterparties filled in 460,763 and 673,599 CU. All three traders paid and signed alone. Final-leg margin refusal rolled back, and fresh PostgreSQL replay reconciled 109 and 158 events. [Results](operations/performance.md#atomic-fills-across-three-to-eight-makers)

**Next action.** Replay matched dollar requests for 16 and 32 registered makers at two, four and eight legs. [Executable depth deliverables](operations/qualification-scorecard.md#executable-depth-work)

| Open gate | What remains |
|---|---|
| Market scale and economics | Meaningful executable depth, sustained maker inventory, funded maker P&L, keeper incentives and payout time under adverse flow. [Risk and liquidation](clearing/risk-and-resolution.md) |
| Independent maker validation (P15B) | An external maker must independently operate, reconcile and exit. All makers in the local evidence were internal. |
| Independent review and funded-pilot readiness (P16B) | Separate review, risk calibration and authorization. Default/devnet builds keep the current financial paths disabled. |
| Continuous 24-hour endurance | Deferred. Earlier short runs qualify only their recorded workloads. |

The current protocol guides merged at `cfd2626c`. Harness `c4800d5e` reproduced all six outcomes and CU measurements from `5c3ac284` on clearing `986b3cd3`. Each signed run reconciled 357 events through fresh PostgreSQL replay.
