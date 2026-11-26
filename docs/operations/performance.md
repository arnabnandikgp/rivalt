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

## Wallet count and market contention

On clearing `b0e1a43f` and harness `27710e33`, each fresh Surfpool venue received the same 48-request trace twice. The first window used one funded wallet. The second used twelve, with each wallet waiting for its own previous confirmation. Each window offered 25 orders/s over 1.920 seconds ($30,720 total test notional), in $120, $600 and $1,200 buys and sells. Every order filled at the synthetic index and paid the 2 bps taker fee. The split venue assigned six streams and half the dollars to each market. Four funded makers per market published deep, flat quotes with zero spread and skew. Normal pricing and funding upkeep continued during each window.

| Markets | Wallets | Fills / offered | Trader fills/s | Filled test dollars/s | p95 arrival to confirmed fill | Last outcome from window start |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 1 | 48/48 | 4.73 | 3,028.06 | 7.835 s | 10.145 s |
| BTC | 12 | 48/48 | 11.97 | 7,658.22 | 2.133 s | 4.011 s |
| ETH | 1 | 48/48 | 4.85 | 3,105.22 | 7.588 s | 9.893 s |
| ETH | 12 | 48/48 | 11.50 | 7,359.27 | 2.397 s | 4.174 s |
| 50/50 BTC and ETH | 1 | 48/48 | 4.14 | 2,647.16 | 9.318 s | 11.605 s |
| 50/50 BTC and ETH | 12 | 48/48 | 10.00 | 6,396.84 | 2.863 s | 4.802 s |

Trader fills/s counts each completed user order once, including orders split across makers. Both achieved rates use the full observation window through drain, including time spent waiting before signing. All six windows filled the same mix at an average of $640 per order, so filled dollars/s is exactly 640 times fills/s before rounding. Among twelve-wallet orders, all 1,056 distinct-wallet pairs on each single-market venue had common writable accounts. Each order locked the market, ledger, four maker capitals and four registrations. Only maker 0 on each active market consumed depth. In the split venue all 480 same-market pairs conflicted, and none of the 576 cross-market pairs shared an account that either transaction wrote. Among pairs with overlapping broadcast-to-confirmation intervals, 76/76 same-market pairs conflicted and 0/95 cross-market pairs conflicted.

Twelve wallets improved the delivered rate in all three placements. Splitting the market did not improve it in this run. On the split venue p95 was 2.009 s before a wallet started preparing its request, 1.394 s for snapshot through preflight and 0.967 s from broadcast through observed confirmation. Those percentiles describe different samples and cannot be added. The recorded intervals include SDK, simulation, RPC polling and host scheduling. They do not isolate validator lock wait. Each placement had one short window per wallet count, the single-wallet window ran first, and each twelve-wallet trader used one market. Cross accounts carrying both markets can require additional dependencies.

PostgreSQL independently replayed 477 BTC, 473 ETH and 557 split-venue events and reconciled the funded accounts. All 288 finalized originals and their WS observations matched the report. Fourteen timed funding maintenance attempts landed in the matched run. An earlier ETH run stopped when its harness treated a funding-report preflight refusal (6131) as fatal. The corrected harness records that refusal separately, leaves the refused report unsent, and samples again on its normal cadence. Production capacity and contention pricing require separate scheduler and fee-market evidence. [Reproduction and receipt audit](local-development.md#wallet-count-and-market-contention)

### Native validator queue timing

On Agave 4.2.2, harness `5475b255` replayed the twelve-wallet arrivals against clearing `b0e1a43f`. Each placement scheduled 48 signed 1,404-byte v1 orders over 1.920 seconds on a fresh book. Wallets waited for their own previous confirmation. All three placements used synthetic prices, four funded flat makers per market and zero priority fees. The earlier Surfpool twelve-wallet windows followed a one-wallet warm-up on the same book. Compare timings within each runtime first. [Run the native benchmark](local-development.md#native-validator-scheduler-replay)

| Market placement | Filled / offered | Fills/s through drain | Arrival to observed confirmation p95 | Wallet stream wait p95 | Snapshot through signing p95 | Admission to first worker p95 | Admission to last worker p95 | Orders with repeated assignments |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BTC | 48/48 | 17.18 | 1.274 s | 684 ms | 348 ms | 21.212 ms | 41.966 ms | 6 |
| ETH | 48/48 | 13.84 | 1.868 s | 1,220 ms | 658 ms | 1.207 ms | 3.637 ms | 1 |
| BTC/ETH split | 48/48 | 7.94 | 4.207 s | 3,400 ms | 1,699 ms | 5.278 ms | 24.050 ms | 1 |

Each native interval starts when the leader accepts the transaction for its scheduler queue. First worker means the start of processing its assigned batch. Last worker includes elapsed time across internal retries. All 144 signatures had exactly one admission. In BTC, ETH and split order, p95 time to the first assignment itself was 21.210 ms, 0.019 ms and 0.038 ms. Preflight and subscription took 24.5, 47.7 and 86.7 ms p95, the send RPC took 12.3, 24.1 and 40.3 ms, and RPC response to client-observed confirmation took 645.7, 580.3 and 716.8 ms. The client polls for confirmation. These intervals can overlap validator processing, and percentiles describe separate distributions. [Agave worker assignment](https://github.com/anza-xyz/agave/blob/c9c6f3287e26f24e3476e13e751aebe710191e89/core/src/banking_stage/transaction_scheduler/greedy_scheduler.rs) · [Signature audit](../../tests/performance/wallet-contention-report.py)

Every trader assignment, including retries, went to worker 0. The split trace retained 480/480 same-market lock overlaps and 0/576 cross-market overlaps. Cross-market orders could execute in parallel, but this wallet workload did not demonstrate parallel worker use. Its longest measured delays were before submission. The aggregate rate includes the time needed for all offered orders to finish. One window per placement on a single local leader supplies no saturation curve or evidence of priority-fee competition.

A preliminary stock-validator control finalized 48 oracle-policy refusals. The funding publications showed a one-second gap beyond the previous hold, which restarted recovery. The harness now refreshes signed inputs during the two-second minimum reporting interval and reads both markets' on-chain Normal states before measuring. The native harness also retains enough ledger history to replay from initialization and allows up to 90 seconds for finalized receipt auditing. The refused control is excluded from fill rates.

### Where the wallet spends time before signing

Harness `9369c98d` repeated the twelve-wallet BTC/ETH split on the same Agave binary, clearing build and 48-order schedule. The largest interval began **after the final account response arrived** and ended when the SDK returned a verified snapshot. It accounted for 66.7% of the time wallets spent preparing their orders. The SDK decodes clearing and maker accounts, derives their addresses and verifies maker program hashes during this interval. Timings include waits for other work on the same JavaScript event loop. [Snapshot reader](../../packages/sdk/src/account-snapshot.ts) · [Maker verification](../../packages/sdk/src/liquidity-adapter.ts)

| Stage from wallet readiness to signature | Median | p95 | Share of time summed over 48 orders |
|---|---:|---:|---:|
| Four account RPC calls, including JSON parsing | 13.6 ms | 38.2 ms | 5.51% |
| SDK work before and between account reads | 31.9 ms | 85.4 ms | 13.13% |
| Final account response to verified snapshot | 138.0 ms | 438.3 ms | 66.73% |
| Build the four-candidate order | 14.1 ms | 87.1 ms | 9.18% |
| Order built to blockhash request | <0.1 ms | <0.1 ms | 0.02% |
| Fetch recent blockhash | 2.0 ms | 16.4 ms | 1.75% |
| Compile, sign and serialize | 8.5 ms | 18.0 ms | 3.68% |

The complete snapshot took 522.3 ms p95 and preparation through signing took 580.5 ms p95. Each wallet read 1, 4, 5 and then 44 accounts. The final read returned 351,176 decoded bytes. Of those, 335,130 bytes (95.4%) belonged to the two maker program-data accounts. Byte counts measure payload size. They leave the relative cost of decoding, hashing and address derivation open. This book had four registered makers and the wallet included all four, so wider shortlist search needs its own workload.

| Same split schedule, 25 orders offered/s | Orders finalized | First admissions/s at leader | Fills/s through drain | Scheduled to observed confirmation p95 | Leader admission to first worker p95 |
|---|---:|---:|---:|---:|---:|
| Previous window, `5475b255` | 48/48 | 8.54 | 7.94 | 4.207 s | 5.278 ms |
| Instrumented repeat, `9369c98d` | 48/48 | 16.05 | 14.44 | 1.603 s | 23.592 ms |

First admissions/s uses the 47 gaps from the first signed order admitted to the last. Fills/s counts all 48 orders from the scheduled start through the last observed outcome. The wallet waited for each trader's previous confirmation. Both runs delivered fewer than 25 signed orders/s to the leader and all trader assignments went to one worker. The rate difference illustrates run-to-run variability. The repeat changed benchmark instrumentation only. Its fresh PostgreSQL replay reconciled 305 events and 259 accounts. [Run the comparison](local-development.md#profiling-wallet-order-preparation)

### Wallet snapshot decoding and verification

In two independent Node 24.22.0 processes, decoding two maker program-data accounts accounted for **50.8–52.2%** of the SDK's time from its final account response to a verified trade snapshot. The input was the retained Agave bank at slot 406, immediately before the first order landed in the twelve-wallet split run. Its replayed bank hash matched the original validator log. Each process profiled 48 serial snapshots on harness `36b6b256`. Each snapshot read 44 accounts in its final batch, including 335,130 bytes across the two maker programs. [Reproduce the offline replay](local-development.md#replaying-wallet-snapshot-verification-offline)

| Stage after the final account response | First run, share of elapsed time | Repeat |
|---|---:|---:|
| Decode base64 for the two maker programs | 50.76% | 52.23% |
| Decode base64 for other accounts | 3.91% | 3.92% |
| Derive and find canonical addresses | 29.53% | 29.41% |
| SHA-256 of the two maker program-data accounts | 1.51% | 1.26% |
| Remaining verification and runtime work | 14.29% | 13.18% |

At the profiled revision, the SDK copied the binary string returned by `atob` through `Uint8Array.from` with a mapping callback per character. The experiment allocated the destination array at the known length and copied each character code directly to its offset. Each process compared 72 snapshots per decoder per concurrency level in alternating order, with individual stage timers disabled.

| Final response to verified snapshot | Original p50, run 1 / 2 | Candidate p50, run 1 / 2 | Original p95, run 1 / 2 | Candidate p95, run 1 / 2 |
|---|---:|---:|---:|---:|
| One wallet at a time | 23.60 / 23.50 ms | 10.66 / 10.64 ms | 29.21 / 25.64 ms | 11.89 / 11.52 ms |
| Twelve wallets together, per wallet | 246.02 / 244.45 ms | 105.19 / 106.09 ms | 277.71 / 273.54 ms | 113.98 / 121.41 ms |

Both decoders reproduced the bytes for all 655 exported accounts and the same decoded state for all twelve wallets. Both marked makers using altered program data unavailable. These timings cover SDK verification on one host from a fixed bank. [Node benchmark](../../tests/performance/wallet-snapshot-profile.ts)

### Browser wallet verification with the default decoder

At `402a6c03` the SDK uses the indexed copy by default. Two fresh headless Chrome 157.0.8103.39 processes replayed the same bank through the wallet's `readAccountTradeSnapshot`. The comparison bundle substituted only the previous decoder. Each process alternated the order for six rounds, giving 72 observations per decoder per workload after warmup. The interval starts when the final batch of 44 accounts is ready and ends when the wallet has verified the snapshot. [SDK decoder](../../packages/sdk/src/wallet-client.ts) · [Reproduction](local-development.md#replaying-wallet-snapshot-verification-offline)

| Time per wallet | Previous median, run 1 / 2 | SDK median, run 1 / 2 | Previous p95, run 1 / 2 | SDK p95, run 1 / 2 |
|---|---:|---:|---:|---:|
| One wallet at a time | 16.1 / 16.2 ms | 7.3 / 7.3 ms | 16.7 / 16.9 ms | 8.0 / 7.9 ms |
| Twelve wallets verifying together | 171.9 / 169.2 ms | 81.8 / 82.2 ms | 194.0 / 191.4 ms | 85.8 / 86.8 ms |

Both bundles reproduced the bytes of all 655 accounts and the same serializable state for twelve BTC/ETH wallets. Both rejected malformed base64 and marked the affected adapters unavailable on both markets when one byte of approved maker code changed. A Node 24.22.0 replay at the same revision independently compared all account bytes with `Buffer.from`. There was no RPC transport, signature, or validator in the timed interval. The improvement applies to local wallet preparation. [Browser comparison](../../tests/browser/wallet-snapshot-comparison.ts)

### Fifty already-signed orders in one slot

Fifty distinct funded wallets each submitted one 1,404-byte v1 order on harness `97523cdf`, clearing `b0e1a43f` and the traced Agave 4.2.2 validator. Both fresh venues used the same 25 buys, 25 sells and $30,960 of requested notional across $120, $600 and $1,200 orders. Four internal makers per market quoted at the index. All 50 originals had been signed, simulated and subscribed over WebSocket before release. Funding maintenance continued. [Reproduce the burst](local-development.md#comparing-already-signed-order-bursts)

| Measured after release | All 50 orders on BTC | 25 BTC and 25 ETH |
|---|---:|---:|
| Fills in the first slot after the release reference | 50/50 | 50/50 |
| Slots after that reference for the last released order to land | 1 | 1 |
| First to last scheduler admission | 1.4 ms | 2.1 ms |
| Admission to first worker, median / p95 | 68.1 / 118.6 ms | 60.4 / 91.2 ms |
| Assignments by validator worker | 50 on worker 0 | 31 on worker 0, 19 on worker 1 |
| Largest cost charged to one writable account in the landing block | 17,957,403 | 8,980,288 |
| Time between the previous and landing block's bank freezes | 457.1 ms | 470.5 ms |
| Release to last confirmation observed by the client | 519.5 ms | 630.0 ms |

Each local leader reported processed slot 636 immediately before release. Finalized receipts placed every order in slot 637 on its respective venue, including the 50th released order. All 1,225 BTC-only pairs shared writable accounts. In the split run 600/600 same-market pairs conflicted and 0/625 cross-market pairs did. Each order had one native admission and one worker assignment. The split used two workers and roughly halved the largest charge to one writable account. Scheduler cost covers all transactions in the block. Assignment counts identify workers but do not measure their execution overlap.

The observed drain corresponds to 96.24 and 79.36 trader fills/s, respectively, including confirmation polling. Both placements cleared the whole burst in one local slot despite the difference in those rates. These were single bursts, with zero priority fees, one leader and measured block intervals above 450 ms. Only maker 0 supplied depth in each traded market. They establish a local lower bound of 50 fills in one block for this workload. A 200 ms slot target, sustained demand and competition for inclusion require separate measurements.

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

### From a profitable close to tokens in the wallet

Two fresh Surfpool 1.7.0 venues at clearing `b7e4458b` ran the same workload on harness `f873bfd1`. Each of two traders bought 1,000 BTC lots at 60,002 atoms per lot and closed at 60,998. Each earned 996,000 atoms, paid 24,201 in fees and could withdraw 971,799 atoms (0.971799 test collateral). The market started with a current backing certificate and 1,494,000 atoms collected from a funded maker, enough for one and a half of the two claims. Four other wallets submitted 48 BTC/ETH trades on a fixed schedule. All 48 filled on each venue. [Run the comparison](local-development.md#closing-a-position-through-wallet-withdrawal-under-load)

| Payout submitter | Creditor | First credit | Full credit | Tokens in wallet | Other fills in slots strictly between close and withdrawal |
|---|---|---:|---:|---:|---:|
| Trader | First | 0.494 s | 0.494 s | 0.800 s | 11 |
| Trader | Second | 0.623 s | 1.102 s | 1.236 s | 8 |
| Settlement worker | First | 38.573 s | 38.573 s | 38.648 s | 44 |
| Settlement worker | Second | 43.404 s | 43.404 s | 43.455 s | 44 |

Times start when the harness observed that trader's confirmed close. It sampled the margin, settlement pool, vault and both wallet destinations together at confirmed commitment, then checked finalized receipts and fresh PostgreSQL replay (489 and 551 events). Both paths began submitting payouts after both closes confirmed. Each owner withdrew the net gain once their full claim was credited. The two trader-directed claims used a fixed submission order and a known debtor. The worker used ordinary discovery and its durable queue. These are two creditors per venue on one local host with synthetic prices and internal makers.

At one second, the first self-service trader had withdrawn. The second had received 498,000 atoms of funded credit, with 498,000 still unpaid. That trader submitted a permissionless loss collection against the maker, claimed the remainder and withdrew. Both had their tokens by five seconds. On the worker venue neither trader had a credit or a withdrawal at the 1, 5, 15 or 30 second cutoffs. All 1,992,000 claim atoms were still owed to them at 30 seconds.

On the worker venue the observed pool first covered both remaining claims 0.970 s after the second close. All 122 backing checks sampled through the last wallet exit were payable. The finalized worker receipts show twelve loss collections before its first gain payment, which went to a maker. The two designated creditors were paid later. Once credited, their tokens arrived another 75 ms and 51 ms later. That worker selected a covered loss before scheduling a gain and waited for the outstanding original. This workload exposes the cost of that scheduling order when the pool can already fund the claims. [Worker selection](../../packages/services/src/account-settlement-worker.ts) · [Cutoff report](../../tests/performance/close-to-wallet-report.py)

An earlier paced control at `1bbc36e4` filled 32/32 orders per venue. The self-service exits landed at 0.303 and 0.388 s, before the second scheduled background fill. Worker exits took 37.382 and 42.221 s. The burst comparison above requires at least one competing fill in a strictly intervening slot for each measured exit. Cold backing, debtor discovery by an ordinary wallet, exhausted debtor collateral and production latency require separate evidence.

### Scheduling payouts while losses keep arriving

All three workers ran the same signed 48-order schedule on fresh local venues with the same clearing binary (`b7e4458b`) and observation code. Each designated BTC trader closed a 996,000-atom gain and withdrew 971,799 test-collateral atoms after fees. All 48 background orders filled in each run.

| Worker | First trader withdrew | Second trader withdrew | Zero remaining loss after the last fill (from later close) | Replayed events |
|---|---:|---:|---:|---:|
| Collection first (`08645cd0`) | 40.815 s | 45.671 s | 33.043 s | 558 |
| Rotate work, fixed payee order (`6434dafa`) | 33.831 s | 41.011 s | 51.109 s | 576 |
| Rotate work and payees (`efff1af2`) | 11.674 s | 18.752 s | 45.915 s | 562 |

Withdrawal times start at each trader’s confirmed close. The collection column starts at the later close and ends at the first zero-debt sample in a slot strictly after the last traffic fill. Turning between collections and payments alone let one maker earn again and receive four payouts before either trader. Continuing the payout search after the last creditor gave the two traders a turn while that maker kept trading.

| After close | Wallets with tokens, previous → revised | BTC / ETH still collectible, previous | BTC / ETH still collectible, revised |
|---:|---:|---:|---:|
| 1 s | 0 → 0 | 160 / 160 | 160 / 160 |
| 5 s | 0 → 0 | 220 / 200 | 220 / 200 |
| 15 s | 0 → 1 | 180 / 200 | 340 / 220 |
| 30 s | 0 → 2 | 240 / 240 | 300 / 260 |

Wallet counts use each trader’s own cutoff. Debt uses a single confirmed bank at the second trader’s cutoff and includes losses already incurred by that point. Across all three runs, finalized collections after release were **502,480 collateral atoms on BTC and 480 on ETH**. The opening maker owed 502,000 more atoms after seeding the BTC pool. Each market’s two traffic wallets lost another 480 atoms over twelve round trips. The reporter includes each market’s pool, outstanding debt and collections in strictly earlier slots. The terminal pools reconcile to the opening pools plus collections less payments. All three ended with 4,000 atoms in the BTC pool and 480 in the ETH pool. The flat ETH maker still had a 480-atom claim and ETH backing was incomplete when observation stopped.

These measurements cover two BTC creditors, a current backing certificate, four active trading wallets, six internal makers and an initially partly funded pool. The worker’s scheduling preference resets on restart. A larger population, cold backing and insufficient collectible collateral have separate timing limits. [Worker policy](../application/durability.md#settlement-during-trading) · [Reproduce the comparison](local-development.md#closing-a-position-through-wallet-withdrawal-under-load)

### First ETH maker payout with cold backing

On clearing `b7e4458b`, harness `254404ef` ran the six-wallet schedule with a current BTC certificate and no ETH certificate. The ordinary worker from `efff1af2` handled both markets. All 48 scheduled trades filled. The ETH maker sold 120 lots for 3,600,240 collateral atoms and bought back 120 for 3,599,760. Its 480-atom spread was 0.000480 test collateral. [Receipt report](../../tests/performance/cold-maker-exit.ts)

| First confirmed observation | Seconds from start of trading |
|---|---:|
| ETH certificate created | 13.695 |
| Maker flat with all 480 atoms unpaid | 25.611 |
| ETH pool holds all 480 atoms | 46.118 |
| ETH certificate covers all 12 members | 142.721 |
| Maker margin credited by 480 atoms | 142.721 |
| Owner wallet received 480 atoms | 142.797 |

The maker waited 117.186 s from the observed flat claim to wallet receipt. Its pool held the full amount 96.603 s before the credit. The worker submitted 43 successful backing-check transactions across 12 members. The scan visits the membership index and its pages as well as the financial accounts. Clearing completed the final backing check and credited all 480 atoms in the same finalized transaction. ETH certificate initialization, checks and payment used 44 distinct successful worker transactions and 220,000 lamports in transaction fees. The owner signed and paid for a separate withdrawal. Its finalized SPL balances moved exactly 480 atoms from the vault to the maker wallet, leaving the original 100 test collateral in the margin account.

The two BTC traders received 0.971799 test collateral each at 11.047 and 18.166 s after their respective closes. The BTC and ETH markets collected 502,480 and 480 atoms after release. The first zero-debt sample after the last fill was 45.590 s after the later BTC close. The ETH pool ended at zero. Fresh PostgreSQL replay reconciled 903 events.

The 48 orders were a finite burst. Source and maker updates continued through the later backing checks and withdrawal. This measures one cold scan on a local 12-member venue with funded losses. [Run the qualification](local-development.md#closing-a-position-through-wallet-withdrawal-under-load)

### Automatic payout on the same 12-member book

The same worker and harness revision (`88625d28`) ran sequentially on two fresh Surfpool banks with 50 ms slots and zero priority fee. Each had six internal makers, six traders, a current BTC certificate and no ETH certificate at release. Four wallets submitted 48 scheduled ten-lot orders across BTC and ETH. The ETH maker earned 480 collateral atoms on 120 lots sold and 120 bought back. The credit put funded cash in its margin account. The maker signed a separate withdrawal to its SPL wallet. [Run both arms and reconstruct the spread](local-development.md#comparing-automatic-direct-and-certificate-payouts)

| Observed outcome | Certificate (`b7e4458b`) | Direct credit (`984f18f3`) |
|---|---:|---:|
| ETH maker flat with the full spread earned → wallet receipt | 115.232 s | 13.994 s |
| All 480 atoms collected → full margin credit | 96.752 s | 2.495 s |
| ETH backing-check transactions | 43 | 0 |
| ETH worker transactions for backing and credit, including initialization | 44 | 3 |
| Fees for those transactions | 220,000 lamports | 15,000 lamports |
| Loss collections, BTC / ETH | 4 / 4 | 4 / 4 |
| Both markets clear of collectible losses after the last fill, measured from start | 43.981 s | 37.110 s |
| Two BTC traders, confirmed close → wallet | 8.990 / 16.165 s | 16.933 / 21.655 s |
| Competing fills / scheduled orders | 48/48 | 48/48 |
| Events reconciled by fresh PostgreSQL replay | 899 | 550 |

The direct worker paid 140, 100 and 240 atoms. The first 140 came from earlier closed quantity. At its last close the maker therefore had 140 atoms of funded cash above principal and 340 atoms still owed. The collection milestone counts both cash left in the ETH pool and cash already paid to the maker. Both workers collected 502,480 BTC-market atoms and 480 ETH-market atoms after release. Their final ETH pool and outstanding collectible losses were zero. Fees in the table exclude loss collections, BTC credits, setup and owner withdrawals.

This is one pair of runs. It measures the effect of the deployed payout paths on this finite book. The direct worker still discovers candidates off chain, and clearing reads all eight coverage accounts for each payment. The [128-member test](#direct-payout-at-128-financial-members) exercises the 16-member capacity of each lane. The 1,000-member workload and sustained contention remain open.

### Direct payout at 128 financial members

On clearing `984f18f3`, harness `53317975` filled eight lanes with 16 members each. Six were internal maker capitals and 122 were trader margin accounts. Recovery had 129 funded seats. The same flat ETH maker earned 40 collateral atoms on a ten-lot round trip, then received two equal credits from the collected loss. No ETH certificate was created. [Reproduction and independent receipt check](local-development.md#direct-payout-at-full-coverage-capacity)

| Finalized transaction | Individual rows checked for backing | Whole transaction CU | Wire bytes | Accounts | Fee, lamports |
|---|---:|---:|---:|---:|---:|
| Collect 40 ETH-market loss atoms | — | 131,475 | 849 | 19 | 5,000 |
| Credit 20 atoms with all positions flat | 0 | 161,532 | 1,029 | 25 | 5,000 |
| Credit 20 atoms with open ETH positions in every lane | 128 | 260,646 | 1,029 | 25 | 5,000 |
| Withdraw the 40 funded atoms to the owner's SPL account | — | 144,545 | 1,107 | 24 | 10,000 |

Between credits, eight margin accounts with two trader authorities bought 40 ETH lots each against two other maker capitals. An independent reader reconstructed the fills and marked the ten exposed accounts at their adverse bounds of 29,700 or 30,300 collateral atoms per lot. Each could cover its losses. Eight changed trader positions were sufficient to make clearing check every row. The second credit used 99,114 more CU and remained within the ordinary 400,000-CU limit. Both credits had the same wire size and fee. The withdrawal had two signatures because the fixture supplied a separate fee payer.

The 129th identity registered. Its attempt to activate in a full lane rolled back in 53,666 CU. After an account left a different lane, a second attempt at 127 active members still rolled back. Freeing a seat in the candidate’s own lane allowed that same identity to activate in 63,815 CU. Finalized membership, margin cash and the token exit reconciled in fresh PostgreSQL replay (499 events). An earlier quiet run on harness `96cacd73` paid all 40 atoms in one 161,539-CU transaction and replayed 483 events.

The paired run used 50 ms local slots, zero priority fees and a fixed synthetic price. It measures payout execution on a full book with ten open positions. The larger population is measured below.

### Direct payout at 1,000 financial members

On clearing `213d394d` and harness `e4105ea0`, 994 funded trader margin accounts and six internal maker capitals occupied eight lanes of 125 members. A ten-lot ETH round trip earned a flat maker 40 collateral atoms. Clearing collected the trader’s 40-atom loss before paying two equal 20-atom credits. Eight other margin accounts opened 40-lot ETH longs between credits, one per lane against two makers. Those ten open positions made clearing check all 1,000 rows. [Reproduction](local-development.md#direct-payout-at-1000-financial-members)

| Book | Requested CU | Heap | Finalized outcome | Transaction CU reported |
|---|---:|---:|---|---:|
| All flat | 400,000 | 32 KiB | Heap exhausted | 400,000 |
| All flat | 400,000 | 128 KiB | Backing verified, then heap exhausted | 400,000 |
| All flat | 400,000 | 256 KiB | Paid 20 atoms, zero individual solvency checks | **204,674** |
| Open ETH positions in every lane | 400,000 | 32 KiB | Heap exhausted | 400,000 |
| Open ETH positions in every lane | 400,000 | 128 KiB | Compute exhausted | 400,000 |
| Open ETH positions in every lane | 1,400,000 | 128 KiB | Backing verified, then heap exhausted | 1,400,000 |
| Open ETH positions in every lane | 1,400,000 | 256 KiB | Paid 20 atoms, 1,000 individual solvency checks | **964,970** |

All seven signed payments used 25 transaction accounts, six writable including the fee payer. Each used 1,029 wire bytes with the default heap or 1,037 with an explicit request. All five refusals rolled back and cost 5,000 lamports apiece. The two successful credits also cost 5,000 each, for 35,000 lamports across the seven attempts at zero priority fee. Surfpool reported the full requested compute limit after a fatal heap fault. Only the successful rows measure the cost to complete a payment. Both succeeded at the largest tested heap. The run did not locate the minimum between 128 and 256 KiB.

Collecting the loss used 136,890 CU. The maker owner then withdrew all 40 funded atoms in 149,984 CU, with two signatures and a 10,000-lamport fee. The wallet gained the same 40 atoms the vault released. No certificate was created. There were 287 local slots from the maker going flat to the withdrawal (14 seconds by block timestamps). This interval includes deliberate retries, intervening fills and refreshed sources. It measures this scripted run only.

Recovery had 1,001 funded seats. A new identity registered but its financial activation rolled back both when all lanes were full and after a different lane opened up. It joined after a member in its assigned lane left. Final membership was 999. Fresh PostgreSQL replay reproduced 3,232 events and reconciled the final margin accounts, membership and custody. The qualification harness committed up to 128 complete finalized blocks per SQL transaction. An earlier identical payout run reached the SPL exit, but its single database transaction hit the 15-second idle limit before reconciliation.

Each lane reserves 8,400 bytes compared with 1,424 at 128 members. The backing read decodes every lane’s member list even when a summary proves solvency. The final coverage update also decodes the supplied lanes. Both passes matter when sizing heap. Sustained concurrent fills, automatic worker delivery on the larger build and wider cross-market accounts require separate qualification. [Backing read](../../programs/clearing/src/shadow_coverage.rs) · [Coverage update](../../programs/clearing/src/shadow_coverage/maintenance.rs)

### Streamed coverage on the same 1,000-member book

Clearing `99165b41` and harness `1d105af3` repeated the two 20-atom ETH payments from the [prior run](#direct-payout-at-1000-financial-members). Both runs used the same eight 8,400-byte coverage accounts, six maker capitals, 994 trader margin accounts, program instruction and 400,000-CU / 32 KiB initial request. Each successful transaction included the same 25 accounts. Only the recipient’s coverage lane was writable. The new reader uses the ordinary 1,029-byte payment even for the diagnostic compute retry.

| Book and individual checks | Prior successful CU / requested heap | Streamed successful CU / requested heap | Change in successful CU | Outcome of first streamed attempt |
|---|---:|---:|---:|---|
| All positions flat, zero individual checks | 204,674 / 256 KiB | **157,640 / 32 KiB** | −47,034 (23.0%) | Paid |
| ETH positions in every lane, 1,000 individual checks | 964,970 / 256 KiB | **922,864 / 32 KiB** | −42,106 (4.4%) | Compute exhausted and rolled back. Paid on retry requesting 1,400,000 CU. |

The maker withdrew all 40 funded atoms in a separate 150,232-CU transaction. At zero priority fee the three payment attempts cost 15,000 lamports altogether, compared with 35,000 across seven prior attempts. This comparison excludes collection, source refreshes and withdrawal fees. Ten accounts had open ETH exposure during the second payment. The observed compute cost is specific to that book. Fresh PostgreSQL replay reconciled 3,216 events with 999 members after two exits and one admission.

On a separate nine-member bank with the same binary, a fall in BTC left an idle cross debtor unable to back an ETH payment. Clearing checked one individual row and refused one atom with nine still in the pool. The compared financial accounts were byte-identical after rollback. Once the debtor recovered, payment resumed and the maker ultimately withdrew its full 40 atoms. Fresh PostgreSQL replay reconciled 263 events for this control. [Reproduction](local-development.md#direct-payout-at-1000-financial-members)

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

### Funded opening depth

Clearing `50bd8836` and wallet harness `152e4f18` repeated the ten-maker, four-leg comparison. The ordinary ETH sale now filled 67,988 and 32,012 lots for $3,012.866858 after the taker fee, using 383,599 CU. Raising minimum proceeds by one atom rejected the signed sale with byte-identical financial accounts. The explicit control returned the same proceeds in 240,487 CU. The four cheapest BTC curves landed for $9,838.645417 in 394,364 CU. Previously this allocation exhausted the 800,000-CU budget. The original wallet shortlist still cost $9,843.684008 in 391,726 CU. Fresh PostgreSQL replay reconciled 184 wallet events and 185 control events. All amounts use test collateral.

### Price-aware wallet execution

On clearing `50bd8836` and SDK/harness `7353f463`, both ordinary wallet orders reached the same amount as the independent four-leg reference and a signed control. The BTC buy supplied makers 6/7/8/9. Clearing filled 40,992 / 40,986 / 40,981 / 40,976 lots, for $9,836.678081 gross and a $1.967336 fee. The trader paid **$9,838.645417**, saving $5.038591 over the original shortlist. Execution used 394,364 CU. When allowed a fifth maker, 29 lots would go to maker 0. The wallet repriced the entire order after removing that contribution.

On ETH the ordinary wallet sold 67,988 and 32,012 lots for **$3,012.866858** after fees, using 383,599 CU. Raising the minimum proceeds to $3,012.866859 rolled back. Each fresh venue reconciled 185 events in PostgreSQL. These prices qualify the measured snapshots. The shortlist comparison is a heuristic when the full-directory optimum exceeds the signed width or fails financial admission.

The eight-leg compatibility trace at the same SDK and program revisions filled 8/10 offers in each of the 16- and 32-maker venues. Four offers across both venues stopped at the source guard before signing. The 163,935-lot thin-bid BTC sale still returned $9,995.037152 and $9,992.798640 respectively. Each of the 16 signed orders was refetched and audited. Fresh PostgreSQL replay reconciled 279 and 375 events respectively.

### Signed price and fee limits

Clearing `b0e1a43f` and harness `a9dc0bba` ran three fresh local venues. Each four-book limit case offered 100 lots per maker. Three makers filled the complete 300-lot request. The BTC buy excluded the 53,000 ask below the 54,000 floor and paid 18,003,600 atoms including fees. The ETH sell excluded the 30,001 bid that would raise the fee above 1,800 atoms and received 8,998,200 atoms. The fills used 516,677 and 549,088 CU. Tightening either all-in limit by one atom returned `RouteHealth` and the financial accounts matched their pretrade bytes. PostgreSQL replay reconciled 107 events.

On the width venue both positive orders landed, at 465,564 CU for four counterparties and 682,804 CU for eight. Replay reconciled 158 events. On the wallet venue the curved BTC buy paid $9,838.645417 and the maker-margin-constrained ETH sell received $3,012.866858 after fees. Its one-atom-tighter sell refused. Replay reconciled 185 events. These runs used internal makers and the opt-in local program.
