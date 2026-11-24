# Measured operating limits

Read the order size, artifact, starting book and outcome together. These are local measurements with synthetic prices and internal makers. The examples use 1,000,000 BTC lots per BTC and a six-decimal test collateral token at parity.

## Closed-quantity settlement

On clearing `ec6f1ffa` and harness `ed60fc6c`, one funded trader submitted the same six sequential buys on the three-maker deep BTC book. All six filled with the fresh 128-byte position slots on both trader and maker accounts. Gross index notionals and filled transaction CU were:

| Requested buy | Filled lots | Index notional in test USD | Transaction CU |
|---|---:|---:|---:|
| $100 | 1,640 | 100.040 | 488,977 |
| $1,000 | 16,394 | 1,000.034 | 515,127 |
| $10,000 | 163,935 | 10,000.035 | 515,016 |
| One BTC | 1,000,000 | 61,000 | 515,203 |
| Three-lot control | 3 | 0.183 | 470,531 |
| One-lot control | 1 | 0.061 | 381,973 |

The buys used 1,234-byte v1 transactions. After a price rise and loss collection, the market pool held 1,177.245108 test collateral. Clearing rejected a one-atom payment of open price gain. Selling 590,986 lots made 588.622056 eligible while 590,987 lots remained open. An attempt to collect one extra atom rolled back. The exact payment used 146,060 CU. The second sale and payment discharged the claim. Fees totaled 29.076540 test collateral and the SPL wallet received 1,148.168568 net. Fresh PostgreSQL replay matched 381 events. This covers one deterministic book. Exact mixed-entry growth remains a separate bound. [Signed harness](../../tests/rpc-contract/router-notional-rpc.ts) · [Storage qualification](qualification-scorecard.md#closed-quantity-payout-comparison)

## Maker inventory and route search

On clearing `986b3cd3`, one maker quoted 2 BTC and both sides had 80,000 test collateral tokens. At a $61,000 BTC reference the signed single-maker path admitted 128 lots with an ordinary 128-byte market slot. After growing the maker to 256 bytes, it carried 256 lots ($15.62). Adding one more lot failed with capacity error 6105. Attempts targeting 0.001, 0.01, 0.1 and 1 BTC also rolled back. The harness checkout was `38f2d09b`. The diagnostic and receipts were retained locally. [Fill admission](../../programs/clearing/src/profit_attribution.rs) · [Storage formula](../../crates/clearing-accounting/src/attribution.rs)

| Single-price BTC inventory | Actual entry record | Required space for subsequent reductions and payments |
|---|---:|---:|
| 128 lots | 13 bytes | 114 bytes |
| 256 lots | 13 bytes | 210 bytes |
| 257 lots | 13 bytes | 402 bytes |
| 0.01 BTC | 13 bytes | 12,306 bytes |
| 1 BTC | 13 bytes in the native test | Length exceeds the supported encoding |

These are per-position measurements for this sequence. Partial payments and weighted entry history also affect storage. At 256 lots the signed maker received 1,024 atoms, reduced to 128 lots with four atoms already paid per surviving lot, then closed. Fresh PostgreSQL replay matched 363 events.

A separate **on-chain search** on the same program returned error 6133 at 510,423 CU for a 1,000-lot order. A repriced pair filled at 535,611 CU and a standing singleton at 402,633 CU. The router locks all three candidate capitals and registrations for a same-market order. Each order can fill against at most two. [Router limits](../liquidity/routing.md) · [Signed qualification](https://github.com/arnabnandikgp/rivalt/pull/167)

## BTC orders at fixed dollar sizes

At a synthetic BTC index of $61,000, each of three internal makers quoted 2 BTC on each side, two collateral atoms per lot away from the index. The trader and each maker started with 80,000 test collateral tokens and a 256-byte profit-history slot per market. One wallet signed the buys below in order, against the same book, with the exact published ask plus the 2 bps taker fee as its maximum spend. Each dollar request rounds up to a whole lot.

| Requested buy | Lots | Reference notional | Signed RPC simulation | Finalized execution | Transaction CU |
|---|---:|---:|---|---|---:|
| $100 | 1,640 | $100.040 | Capacity 6105 | Rolled back | 460,091 |
| $1,000 | 16,394 | $1,000.034 | Capacity 6105 | Rolled back | 460,091 |
| $10,000 | 163,935 | $10,000.035 | Capacity 6105 | Rolled back | 460,000 |
| $61,000 | 1,000,000 | $61,000 | Capacity 6105 | Rolled back | 460,169 |
| Three-lot control | 3 | $0.183 | Passed | Filled | 449,119 |
| One-lot control | 1 | $0.061 | Passed | Filled | 384,275 |

All three published curves priced every order. Each dollar order reached maker quote CPI, then clearing checked whether the **trader's** position could store future partial payouts and reductions. This check runs before the maker's corresponding check. For the $100 opening trade the current slot formula asks for 1,554 bytes on the trader alone. Splitting those lots between makers would still give the trader a 1,640-lot position. Every refusal left the trader, three maker capitals, three registrations and both market/fee-ledger pairs byte-identical. The diagnostic deliberately broadcast failed simulations on loopback. Each signed attempt cost the payer 5,000 local lamports. [Commit order](../../programs/clearing/src/instructions/maker_liquidity/routes/commit.rs) · [Recovery-space formula](../../crates/clearing-accounting/src/attribution.rs)

The controls opened four lots in total. After the index moved to $62,000, the reduce-only sale left a flat trader with 3,984 unpaid collateral atoms. Collection from the losing maker and the backing scan enabled payment. The trader withdrew the 3,884-atom net gain after 100 atoms of trading fees. The token wallet gained and the vault lost exactly that amount. Fresh PostgreSQL replay matched 357 events. The four refused orders produced no claim or payout to measure. This was a sequential flat-book test with scripted settlement, one wallet and synthetic prices. [Signed harness](../../tests/rpc-contract/router-notional-rpc.ts) · [Run instructions](local-development.md#fixed-btc-order-sizes)

## Wallet traffic and settlement

Three local runs scheduled the same 120 BTC buys from 24 wallets over 4.165 seconds. Orders were one to three lots. One deep maker always quoted the best test ask. All runs used the bounded router, synthetic sources and a real settlement worker. The timing column includes time spent waiting to prepare the order.

| Wallet preparation | Maker slot | Filled / offered | p95 scheduled offer to fill |
|---|---:|---:|---:|
| Independent | 128 bytes | 81 / 120 | 4.189 s |
| Wait for same-wallet confirmation | 128 bytes | 110 / 120 | 4.988 s |
| Wait for same-wallet confirmation | 256 bytes | 119 / 120 | 5.317 s |

Same-wallet sequencing accounted for 39 refusals in the independent arm. Ten storage refusals remained in the confirmed 128-byte arm. The enlarged arm ended with one signed route-health refusal (6120) and 991 of the original 996 claim atoms paid, with an empty pool. Its fresh SQL replay matched 1,321 events. These outcomes bound this workload only. [Comparison and refusal methodology](https://github.com/arnabnandikgp/rivalt/pull/169)

For the remaining refusal, wallet 14's three-lot order 109 simulated successfully at slot 3,384 and landed at 3,391. The same message used 431,103 CU in preview and 346,613 CU on failure. Seven other buys landed in that slot. Maker 0 had already used its shallow ask, maker 2's ask exceeded the signed limit, and maker 1 went from 129 to 146 short lots during the slot. Its last reprice was at slot 3,359. The failed transaction reached route selection and returned 6120 before maker quote CPI. Competing fills consuming maker 1's margin fit the observations. The receipt gives no candidate-specific reason or intermediate maker balance at the failed instruction, so the exact rejection remains open. [Selector](../../programs/clearing/src/instructions/maker_liquidity/routes/market_order.rs)

In the separate 16-wallet mixed-market workload the BTC creditor started flat with all 996 atoms already in the pool. The original worker left the claim unpaid for more than 191 seconds while servicing other work. The revised worker paid all 996 after 93.041 seconds on harness `c615ba2f`, with 72/72 trader fills and 83 successful settlement originals. The first ETH payment was observed at 238.158 seconds. A reconciled projection and a trader fill are distinct from a cash payout. [Worker comparison](https://github.com/arnabnandikgp/rivalt/pull/168)

## Funding, costs and comparisons

The funding publisher computes depth off chain. In three older 75-member runs on clearing `79724a5a`, 12 two-market publication transactions used 48,940–49,110 CU. Another 54 transactions that also checkpointed both markets used 89,682–99,550 CU. These are complete transactions on that binary. [Funding contract](../liquidity/funding.md) · [Receipt reader](../../tests/performance/funding-receipts.py)

Load runs used local transaction fees and synthetic prices. Report offered, eligible, submitted and finalized outcomes separately, along with filled notional, payer costs, time to withdrawable cash and remaining unpaid claims. The illustrative hedge assumption and zero-priority-fee runs supply no production profitability estimate.

For the pre/post Anchor migration comparison, per-instruction CU, wire and contention measurements, use the [tracked baselines](../../tests/performance/baselines/) and [pinned measurement report](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/performance.md).
