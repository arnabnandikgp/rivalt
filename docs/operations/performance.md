# Measured operating limits

Read the order size, artifact, starting book and outcome together. These are local measurements with synthetic prices and internal makers. The examples use 1,000,000 BTC lots per BTC and a six-decimal test collateral token at parity.

## Dollar-sized orders and executable depth

On clearing `b7e4458b` and harness `6ddfcaee`, each run submitted 30 ordinary BTC orders and six diagnostic orders. The five BTC sizes were $100, $1,000, $5,000, $10,000 and $61,000 in both directions. Each maker published one flat region per side, with spreads of two, four and six atoms per lot from the synthetic $61,000 index. The benchmark used one repeat trader, an additional one-atom account and three internal makers per market. Books retained consumed depth between their orders.

The wallet filled **22 of 30 ordinary BTC orders** and **$243,600.755 of $462,600.942** requested at the index (52.66%). All 22 orders for which the independent reference found a feasible pair filled at its best fee-inclusive value. Each request was exact-size. A refusal contributed zero filled dollars.

| BTC book | Buy fills / offers | Sell fills / offers | Two-maker fills | Filled / requested index notional | Share of dollars filled |
|---|---:|---:|---:|---:|---:|
| Deep, four BTC per maker per side | 5/5 | 5/5 | 0 | $154,200.314 / $154,200.314 | 100% |
| Fragmented, 65,000 lots per maker per side | 3/5 | 3/5 | 2 | $12,200.244 / $154,200.314 | 7.91% |
| One-sided, 1,200 ask lots and four BTC of bids per maker | 1/5 | 5/5 | 1 | $77,200.197 / $154,200.314 | 50.06% |

### What each dollar order received

Each cell shows **buy / sell** for the same requested BTC exposure. The buy value is gross execution notional plus the taker fee. The sell value is gross execution notional less the taker fee. These figures value the exposure at test collateral parity. The trader posts margin to open the perp. Order sizes round up to whole lots, and table values round to four decimals. Network fees are separate.

| Target at the index | Deep book | Fragmented book | One-sided book |
|---:|---:|---:|---:|
| $100 | $100.0633 / $100.0167 | $100.0666 / $100.0134 | $100.0642 / $100.0167 |
| $1,000 | $1,000.2668 / $999.8012 | $1,000.2996 / $999.7684 | refused / $999.8012 |
| $5,000 | $5,001.2120 / $4,998.8841 | $5,001.2459 / $4,998.8502 | refused / $4,998.8841 |
| $10,000 | $10,002.3629 / $9,997.7072 | refused / refused | refused / $9,997.7072 |
| $61,000 | $61,014.2004 / $60,985.8004 | refused / refused | refused / $60,985.8004 |

For example, the $5,000 fragmented buy requested 81,968 lots worth $5,000.048 at the index. The average fill price was $61,002.414015 per BTC. The fills added $0.197872 over the index and the 2 bps taker fee added $1.000050, for an **execution cost of $1.197922**. Its $5,001.245922 all-in value met the trader's signed maximum exactly. The reference and signed limits covered the same whole-lot quantity on each side. The report includes these unrounded dollar amounts and signed-limit comparisons for each order. [Run the report](local-development.md#matched-btc-fill-benchmark)

On the fragmented book the $10,000 request needed 163,935 lots. At the index, the three makers advertised $11,895 of depth (195,000 lots). The largest permitted pair could supply only $7,930 (130,000 lots). The $5,000 buy and sell both filled with 65,000 lots from maker 0 and 16,968 from maker 1. The independent calculation matched the maker IDs, quantities, gross amounts and aggregate fee on every successful original. Failed trades left the trader, maker capitals, registrations, markets and fee ledgers byte-identical.

**An executable $100 ETH buy the router missed.** The lowest published offer for 3,334 lots was $100.046674 including fees. That maker had one collateral atom and could not margin even one lot. The trader signed a $100.053343 maximum, enough for the next maker, but the ordinary route refused the whole order. An explicit order against that maker finalized at exactly $100.053343, including a $0.020007 taker fee. The same pair of signed transactions also produced these different outcomes when simulated on the same bank. Clearing returned its internal search-limit error (6133). The receipt does not identify which search counter exhausted.

Including the six controls, the router filled 23/36 signed requests and the explicit control filled 24/36. Where no pair could supply the requested quantity, both venues submitted the routed original to obtain a finalized refusal. Each run requested $463,201.142 at the index. The routed run filled $243,700.795 at the index, exchanged 243,698.277846 gross test collateral and charged 48.739666 in aggregate taker fees. The control filled $243,800.815 at the index, exchanged 243,798.311182 gross and charged 48.759673. Each wallet spent 180,000 local lamports on its 36 measured originals, including refusals. Exit transactions and operator provisioning are outside those totals.

After both books were restored, the trader flattened, paid its whole-atom losses and withdrew 499,925.224841 test collateral on the routed venue and 499,925.164827 on the control venue. Both SPL wallet increases matched the vault decreases. Each trader retained one funded atom against 0.546810565 atoms of outstanding BTC debt. These traders lost the spread. This workload measured return of available collateral and included no profitable trader payout. The PostgreSQL replays reconciled 422 and 463 events respectively. This sequential test has synthetic prices, one independent maker reprice before signing, and zero priority fees. It supplies no concurrent arrival or production latency distribution. [Reproduction and report](local-development.md#matched-btc-fill-benchmark)

## Cost of selecting and filling the same order

Both full transactions were signed and simulated on the same confirmed bank with identical economic terms and checkpoint instructions. The table uses the routed run’s starting state for each row. Each arm also broadcast its designated originals on its own fresh venue. The explicit instruction still authenticates its selected makers, asks their programs for binding prices and runs financial admission and settlement. The difference includes the extra candidate accounts, validation, search and any wire-format overhead. The maker quote column sums only the nested maker program invocations on the routed path.

| Matched successful order | Routed transaction CU | Explicit transaction CU | Additional CU | Routed maker quote CU |
|---|---:|---:|---:|---:|
| Deep $61,000 buy, one maker | 475,479 | 203,585 | 271,894 | 7,194 |
| Fragmented $5,000 buy, two makers | 513,261 | 243,571 | 269,690 | 14,845 |
| Fragmented $5,000 sell, two makers | 516,799 | 242,406 | 274,393 | 14,907 |
| Thin asks, $100 buy, two makers | 521,653 | 243,954 | 277,699 | 15,261 |

Across the 20 matched one-maker successes on the routed venue, specifying the leg saved 194,179–294,632 transaction CU. Across three matched splits it saved 269,690–277,699 CU. These ranges describe the measured books. Neither path has a constant fill cost.

The successful explicit ETH fallback changed later portfolio exposure in that run. All CU differences in this comparison use the two simulations on the same bank.

## Fixed-width maker entry

On clearing `b7e4458b` and harness `d175285e`, one internal BTC maker carried four short lots between 80 round trips. A second wallet bought and sold 16,379 lots each time. The maker's exact average changed on every increase. Its 40-byte BTC record enclosed the independently reconstructed cost after every increase and reduction. Its margin account stayed at 1,099 bytes, including the separate ETH record. The prior exact representation needed owner-funded growth at round 34 and exhausted the wallet compute budget on increase 66. The workloads have the same opening pattern. The prior workload reduced the retained inventory to two lots after its first storage refusal.

| Finalized signed routes | Count | Transaction CU range |
|---|---:|---:|
| Seed wallet opens and closes in two parts | 3 | 397,114–475,476 |
| Cycling wallet buys | 80 | 491,536–491,607 |
| Cycling wallet sells | 80 | 486,474–490,597 |

All 163 routes landed with the ordinary 800,000 CU wallet request. The maker earned 5.241292 test collateral and withdrew 10,005.241292 after both traders paid their losses and clearing verified backing. PostgreSQL replay reconciled 951 events. This is one steadily quoted book with two trader wallets. It measures sustained inventory at these sizes and does not establish venue throughput.

On the separate deep-book lifecycle, the $100, $1,000, $10,000 and $61,000 buys used 475,953, 493,175, 493,176 and 493,173 CU respectively. Clearing refused an open-profit payment on a funded book, paid 588.622056 after a partial close, refused one atom above the ceiling and finalized a net wallet withdrawal of 1,148.168568. PostgreSQL replay matched 381 events. [Reproduction](local-development.md#fixed-width-entry-qualification)

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

## Mixed-price maker storage

Two independent trader wallets traded against one internal BTC maker. One wallet held four lots open. The other bought about $983 of BTC exposure and sold the entire position back on each round trip. That trader needed 13 bytes at entry and zero when flat. The maker carried a small position between rounds. The maker's first sale was one atom below its subsequent ask, so each increase changed its exact average entry, even with a stationary quote thereafter.

Every addition brings maker inventory to 16,383 lots. With `r` lots retained between rounds, each addition multiplies the weight of the original entry by `r / 16,383`. This gives an independent exact price for every round. The test compares it with the signed account bytes after both fills. After the first storage refusal a trader closes two lots, leaving two, and the maker owner pays 1,503,680 lamports to grow the margin account from 1,275 to 1,571 bytes. The BTC and ETH slots each grow from 128 to 256 bytes. Each trader account stays at 1,275 bytes.

Both runs used clearing `ec6f1ffa`, the ordinary three-maker router and one executable maker within the signed price limit. The orders went directly through signed RPC. The diagnostic budget separates the storage check from the wallet compute limit.

| BTC slot and signed route budget | Completed round trips since opening | Maker bytes before → required on next increase | First refusal |
|---|---:|---:|---|
| 128 bytes, both runs | 33 | 128 → 132 | Clearing capacity error 6105 |
| 256 bytes, 800,000 CU wallet budget | 65 | 240 → 244 | Increase 66 consumed all 800,000 CU |
| 256 bytes, 1,400,000 CU diagnostic budget | 69 | 254 → 258 | Clearing capacity error 6105 |

The diagnostic execution of increase 66 used 800,572 CU. Its most expensive successful increase used 809,216 CU. At each refusal the compared economic accounts rolled back byte for byte. Each run then reduced the existing maker inventory with ordinary trader orders. The fully closed maker claim was funded by collecting both traders’ losses. [Signed workload and independent entry calculation](../../tests/rpc-contract/maker-storage-rpc.ts)

In the wallet-budget run (`24af1d2d`), 134 of 136 signed route attempts filled. After the compute refusal, the two final one-lot reductions used 353,789 and 350,442 CU. The maker withdrew its entire 10,000-token deposit plus 4.258808 test collateral in trading profit. Fresh PostgreSQL replay matched 840 events. The diagnostic run (`aca1e51c`) filled 142 of 144 signed attempts, withdrew the deposit plus 4.520904 and replayed 872 events. Provider fees were zero. These counts apply to one sequential BTC position with a stationary index and one best-priced maker. The bound depends on the price and quantity history. [Reproduction](local-development.md#mixed-price-maker-storage)

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

All three published curves priced every order. Each dollar order reached maker quote CPI, then clearing checked whether the **trader's** position could store future partial payouts and reductions. This check runs before the maker's corresponding check. For the $100 opening trade the historical formula on clearing `986b3cd3` required 1,554 bytes on the trader alone. Fresh local positions use [fixed 40-byte records](#fixed-width-maker-entry). Splitting those lots between makers would still give the trader a 1,640-lot position. Every refusal left the trader, three maker capitals, three registrations and both market/fee-ledger pairs byte-identical. The diagnostic deliberately broadcast failed simulations on loopback. Each signed attempt cost the payer 5,000 local lamports. [Commit order](../../programs/clearing/src/instructions/maker_liquidity/routes/commit.rs) · [Recovery-space formula](../../crates/clearing-accounting/src/attribution.rs)

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

## Atomic fills across three to eight makers

Clearing `f0b8a599`, wallet harness `c5d51f9c`, local signed v1 transactions. Each trader was the sole signer and fee payer. Each transaction used an 800,000 CU limit and 128 KiB heap request.

| Market | Filled lots by maker | Gross test tokens | Taker fee | CU | Signed bytes | Accounts |
|---|---|---:|---:|---:|---:|---:|
| BTC | 65,000 + 65,000 + 33,935 | 10,000.628610 | 2.000126 | 399,121 | 1,238 | 25 |
| BTC | 3 × 65,000 + 33,935 | 13,737.151480 | 2.747431 | 460,763 | 1,404 | 29 |
| ETH | 7 × 65,000 + 33,935 | 14,672.232960 | 2.934447 | 673,599 | 2,068 | 45 |

Each transaction paid 5,000 test lamports. With insufficient final-maker margin the three-leg BTC order returned 6120 at 250,104 CU, leaving all compared financial accounts byte-identical. Finalized RPC and signature WS reported the refusal. Surfpool’s logs WS reported a null error for that refused original. Fresh PostgreSQL replay reconciled 109 events for the three-leg venue and 158 for the four/eight-leg venue. These numbers describe the listed books and initial inventories.

## Matched dollar execution across 16 and 32 makers

Clearing `f0b8a599`, RPC harness `22814361`. Each of six fresh local venues received the same ten exact-size BTC requests under a synthetic $61,000 index. Each venue received **$85,100.368** of requested index notional after rounding to whole lots. A refusal counts as zero filled dollars. There were three funded trading wallets, two internal maker programs and separately funded capital for every registration. The two-leg instruction supplied three candidates. The four- and eight-leg instructions supplied four and eight. The reference independently priced the complete directory, the best directory-wide allocation under the leg limit and the signed shortlist at execution.

| Makers | Leg cap | Filled / offered | Filled dollars at index | Taker fees | Extra cost on fills versus full directory | Replayed events |
|---:|---:|---:|---:|---:|---:|---:|
| 16 | 2 | 5/10 | $35,100.193 | $7.021975 | $6.021046 | 264 |
| 16 | 4 | 6/10 | $45,100.228 | $9.021955 | $3.030654 | 268 |
| 16 | 8 | 7/10 | $65,100.237 | $13.023022 | $0.044289 | 274 |
| 32 | 2 | 5/10 | $35,100.193 | $7.023657 | $14.434536 | 360 |
| 32 | 4 | 6/10 | $45,100.228 | $9.023142 | $8.965025 | 364 |
| 32 | 8 | 7/10 | $65,100.237 | $13.023022 | $0.044289 | 370 |

All completed trades matched the independent fee-inclusive value available from their signed candidates. The extra cost column is the trader's aggregate worse execution across fills in that cell, compared to the unrestricted directory on the same book at landing. Refused requests have no execution price. Filling more early orders changes the depth left for later ones.

| Makers / cap | Signed / offered | Transaction fees in test lamports | Signed to confirmed p50 / p95 | Shared writable accounts on final pair | Final pair fills / elapsed seconds |
|---|---:|---:|---:|---:|---:|
| 16 / 2 | 8/10 | 40,000 | 175.1 / 259.2 ms | 8 | 2 / 0.220 |
| 16 / 4 | 8/10 | 40,000 | 177.7 / 254.0 ms | 10 | 2 / 0.224 |
| 16 / 8 | 8/10 | 40,000 | 228.3 / 265.1 ms | 18 | 2 / 0.283 |
| 32 / 2 | 8/10 | 40,000 | 176.7 / 254.5 ms | 8 | 2 / 0.224 |
| 32 / 4 | 8/10 | 40,000 | 177.0 / 250.7 ms | 10 | 2 / 0.190 |
| 32 / 8 | 8/10 | 40,000 | 226.5 / 263.6 ms | 19 | 2 / 0.287 |

The final pair came from separate wallets after normal source recovery. Each pair was submitted concurrently. Elapsed time covers building and signing through both confirmations, including local simulation, subscription and submission. Signed-to-confirmed latency starts at signature. The omitted-maker reprice happens during that interval. These short local batches measure shared locks and observed latency. They provide no sustained network throughput estimate.

- On all six venues the $100 buy signed before an omitted maker improved its price. The trader paid $100.063289 all-in. The new best directory price would have cost $100.019000.
- In the fragmented book, the $10,000 buy first filled at four legs and the $20,000 buy first filled at eight among the three tested caps. With two, the $20,000 order filled after a deep replacement maker posted.
- With 32 registrations, the eight-leg $10,000 sell included makers 0–7. Each bid for only 6,000 lots. The signed set therefore offered 48,000 lots for a 163,935-lot sale. The independent eight-maker allocation could deliver $9,992.798640 after fees using makers 0–3 and 16–19. Selecting enough aggregate depth matters even with eight available legs.
- Two additional $5,000 buy requests per cell reached the wallet after published depth was replenished. The source was Degraded and the wallet refused both before signing. Their $10,000 target remains in each denominator. The next two scheduled requests followed four ordinary sampling rounds. Every signed original paid 5,000 test lamports, including refusals. Only fills paid a taker fee.

The [reproduction instructions](local-development.md#matched-dollar-comparison) and [report](../../tests/performance/matched-maker-report.py) give per-order quantities, VWAP, fees, refusal reasons and the three reference prices, with every signed result checked against its retained receipt. These fixtures use flat, internally operated books. Sustained throughput, stressed maker margin and independent operators remain open.

### Wallet selection by order size

The eight-leg wallet previously chose eight 6,000-lot bids for a 163,935-lot BTC sell. With wallet and harness `0edb3064` and the same clearing binary `f0b8a599`, both directories filled the entire order. Each selected four 6,000-lot bids, then took 40,000, 40,000, 40,000 and 19,935 lots from the deeper makers. The trader signed once and paid 5,000 test lamports.

| Registered makers | Maker IDs in signed order | Gross test dollars | Taker fee | Trader proceeds | CU | Signed bytes / accounts |
|---:|---|---:|---:|---:|---:|---:|
| 16 | 0–3 and 8–11 | 9,997.036560 | 1.999408 | 9,995.037152 | 688,766 | 2,068 / 45 |
| 32 | 0–3 and 16–19 | 9,994.797600 | 1.998960 | 9,992.798640 | 687,114 | 2,068 / 45 |

Both receipts matched the fee-inclusive eight-leg optimum computed against the original book before the change. In the 32-maker book the unrestricted quote would have paid 9,994.038132, an additional 1.239492 test dollars. The number of shallow bids increases with directory size in this fixture. Each maker's offset also depends on its registration ID. [Selection rule](../liquidity/routing.md#wide-maker-discovery-in-local-qualification)

Across the same six venues, 38 of 60 orders filled, up from 36. At both directory sizes the eight-leg runs filled eight of ten orders for $75,100.272 of the $85,100.368 requested at the index (88.25%, previously 76.50%). The two- and four-leg runs again filled five and six of ten. The paired traces reproduced every other outcome and all-in amount, comparing the concurrent wallets together because their execution order can reverse. Twelve offers still stopped before signing while the source was Degraded. Ten signed refusals exceeded available depth at the leg cap. Fresh PostgreSQL replay reconciled 264, 268 and 279 events at 16 makers and 360, 364 and 375 at 32 makers, in increasing leg-cap order.

The fixture uses flat bids and ample maker margin. Price ranking with a depth constraint does not guarantee the cheapest eligible subset of arbitrary curved books. A later reprice at an omitted maker remains unreachable by the signed order.

### Curved quotes and binding maker margin

Clearing `f0b8a599` and harness `b61ade13` exercised the opt-in local multi-maker wallet on two fresh Surfpool venues with ten funded makers per market and a four-leg ceiling. The BTC buy requested 163,935 lots at a $60,000 index ($9,836.10 index notional). The ETH sale requested 100,000 lots at $3,000 ($3,000 index notional). Dollar amounts below are test collateral including the 2 bps fee. The network fee was 5,000 test lamports per signed attempt, including refusals.

| Order | Ordinary wallet | Independently calculated best across ten makers | Signed control on the same book |
|---|---:|---:|---|
| BTC buy, stepped and sloping asks | Paid $9,843.684008 (445,423 CU) | $9,838.645417 on four makers | The best four exhausted 800,000 CU. A second selection filled on three makers for $9,841.963358 (454,621 CU), saving $1.720650 over the wallet. |
| ETH sell, best bid posted by a maker with $240 funded | No fill, route health 6120 (307,709 CU) | $3,012.866858 net | An explicit two-leg sale returned exactly $3,012.866858 (240,487 CU). Both makers were already in the wallet's four candidates. |

On BTC, the wallet selected makers 0/1/2/6 and got the best price available from that set. Replacing maker 2 with maker 7 brought in another cheap first 40,950 lots. Clearing allocated 81,974 lots to maker 0, 40,983 to maker 6 and 40,978 to maker 7. The four cheapest curves together supplied the mathematical reference. Their signed attempt rolled back before completing. The gap to that reference was $5.038591, of which $1.720650 was demonstrated executable.

On ETH, maker 0 bid 30,200 atoms per lot. At the 29,700 lower risk bound this adds 500 atoms of adverse mark per lot to 3,030 atoms of initial margin. Its 240,000,000 funded atoms covered 67,988 lots. The control sold that quantity to maker 0 and 32,012 lots to maker 1 at 29,996, paying 0.602694 in taker fees. The ordinary multi-route first caps by cash and initial margin, selects a quoted split, and submits that split to full financial admission. The confirmed refusal and the successful control show a feasible alternative inside the same shortlist. [On-chain selection and admission](../../programs/clearing/src/instructions/maker_liquidity/routes/market_order.rs)

The reference reads the authenticated curves, caps, cash and risk bounds from the same pretrade snapshot. It checks each possible maker quantity for opening margin, merges the affordable marginal prices for each of the 210 four-maker subsets, and applies the aggregate fee and trader's signed limit. Buys and sells on small books matched an independent enumeration of every quantity vector at each width and at signed-limit boundaries. These cases start from flat inventory, zero reservations and zero book consumption. The frequency of either outcome under sustained order flow remains unmeasured. [Reproduction](local-development.md#curved-books-and-binding-maker-margin)
