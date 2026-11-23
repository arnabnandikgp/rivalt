# Measured operating limits

Read the order size, artifact, starting book and outcome together. These are local measurements with synthetic prices and internal makers. The examples use 1,000,000 BTC lots per BTC and a six-decimal test collateral token at parity.

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

## Wallet traffic and settlement

Three local runs scheduled the same 120 BTC buys from 24 wallets over 4.165 seconds. Orders were one to three lots. One deep maker always quoted the best test ask. All runs used the bounded router, synthetic sources and a real settlement worker. The timing column includes time spent waiting to prepare the order.

| Wallet preparation | Maker slot | Filled / offered | p95 scheduled offer to fill |
|---|---:|---:|---:|
| Independent | 128 bytes | 81 / 120 | 4.189 s |
| Wait for same-wallet confirmation | 128 bytes | 110 / 120 | 4.988 s |
| Wait for same-wallet confirmation | 256 bytes | 119 / 120 | 5.317 s |

Same-wallet sequencing accounted for 39 refusals in the independent arm. Ten storage refusals remained in the confirmed 128-byte arm. The enlarged arm ended with one signed route-health refusal (6120) and 991 of the original 996 claim atoms paid, with an empty pool. Its fresh SQL replay matched 1,321 events. These outcomes bound this workload only. [Comparison and refusal methodology](https://github.com/arnabnandikgp/rivalt/pull/169)

In the separate 16-wallet mixed-market workload the BTC creditor started flat with all 996 atoms already in the pool. The original worker left the claim unpaid for more than 191 seconds while servicing other work. The revised worker paid all 996 after 93.041 seconds on harness `c615ba2f`, with 72/72 trader fills and 83 successful settlement originals. The first ETH payment was observed at 238.158 seconds. A reconciled projection and a trader fill are distinct from a cash payout. [Worker comparison](https://github.com/arnabnandikgp/rivalt/pull/168)

## Funding, costs and comparisons

The funding publisher computes depth off chain. In three older 75-member runs on clearing `79724a5a`, 12 two-market publication transactions used 48,940–49,110 CU. Another 54 transactions that also checkpointed both markets used 89,682–99,550 CU. These are complete transactions on that binary. [Funding contract](../liquidity/funding.md) · [Receipt reader](../../tests/performance/funding-receipts.py)

Load runs used local transaction fees and synthetic prices. Report offered, eligible, submitted and finalized outcomes separately, along with filled notional, payer costs, time to withdrawable cash and remaining unpaid claims. The illustrative hedge assumption and zero-priority-fee runs supply no production profitability estimate.

For the pre/post Anchor migration comparison, per-instruction CU, wire and contention measurements, use the [tracked baselines](../../tests/performance/baselines/) and [pinned measurement report](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/operations/performance.md).
