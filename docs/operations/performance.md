# Measured operating limits

Each result belongs to the named program, client or harness revision. The venues
used test collateral, internal makers and synthetic prices. CU and wire sizes
below describe complete transactions unless the row explicitly says simulation.

## Fixed-width maker entry

On clearing `b7e4458b` and harness `d175285e`, an internal BTC maker retained
four short lots between 80 round trips. Its entry cost changed on each increase.
All 163 signed routes landed, the BTC record stayed at 40 bytes, the margin
account stayed at 1,099 bytes, and the maker withdrew 10,005.241292 test tokens.
PostgreSQL replay reconciled 951 events. Cycling buys used 491,536–491,607 CU
and cycling sells used 486,474–490,597 CU. This measured storage under repeated
mixed-price fills on one book. [Qualification](https://github.com/arnabnandikgp/rivalt/pull/180)

## Closed-quantity settlement

On the same binary, a six-buy lifecycle refused an open-profit payment with
cash already in the market pool. A partial close made 588.622056 test tokens
payable. An extra atom was refused. The final net wallet withdrawal was
1,148.168568. Fixed-width entry bounds can give different whole-atom ceilings
from exact historical entry arithmetic. [Accounting contract](../clearing/accounting.md#ordinary-payouts-on-closed-quantity)

## Dollar-sized orders and executable depth

Clearing `b7e4458b`, harness `6ddfcaee`. Each BTC book received five sizes
from $100 to $61,000 in each direction at a synthetic $61,000 index. Quantities
were exact. A refusal contributed zero filled dollars.

| Book | Fills / offers | Filled / requested test notional at the index |
|---|---:|---:|
| Deep | 10/10 | $154,200.314 / $154,200.314 |
| Fragmented | 6/10 | $12,200.244 / $154,200.314 |
| One-sided | 6/10 | $77,200.197 / $154,200.314 |

All 22 eligible orders matched the independent two-maker reference. In same-bank
simulations, the routed deep $61,000 buy used 475,479 CU and the explicit-leg
order used 203,585 CU. For a fragmented $5,000 two-maker buy the corresponding
figures were 513,261 and 243,571 CU. Both paths include financial admission.
The difference includes candidate accounts, validation and search. [Matched simulations and signed controls](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/operations/performance.md#cost-of-selecting-and-filling-the-same-order)

## Atomic fills across three to eight makers

On clearing `f0b8a599` and wallet harness `c5d51f9c`, a single signer submitted
each v1 transaction with an 800,000 CU limit and a 128 KiB heap request.

| Signed fill | CU | Wire bytes | Accounts |
|---|---:|---:|---:|
| BTC, three makers | 399,121 | 1,238 | 25 |
| BTC, four makers | 460,763 | 1,404 | 29 |
| ETH, eight makers | 673,599 | 2,068 | 45 |

Insufficient last-maker margin refused the three-leg order atomically. With
wallet `0edb3064`, the eight-leg comparison filled 8/10 requests at each
directory size (16 and 32 makers), covering 88.25% of requested index notional.
The two- and four-leg runs filled 5/10 and 6/10. Quotes at omitted makers can
still improve the unrestricted price. Separate curved BTC and margin-bound ETH
cases on clearing `50bd8836` and SDK `7353f463` matched the four-leg reference.
[Wallet selection](../liquidity/routing.md#wide-maker-discovery-in-local-qualification) · [Signed controls](https://github.com/arnabnandikgp/rivalt/pull/191)

## Wallet count and market contention

On clearing `b0e1a43f` and harness `27710e33`, all 288 offered orders filled
across six Surfpool windows. Each scheduled 48 requests at 25/s. Rates below
include the drain through client-observed confirmation.

| Placement | One wallet, trader fills/s | Twelve wallets, trader fills/s |
|---|---:|---:|
| BTC | 4.73 | 11.97 |
| ETH | 4.85 | 11.50 |
| BTC/ETH split | 4.14 | 10.00 |

On a separate local Agave 4.2.2 leader, harness `97523cdf` released 50
already-signed orders per venue. Both the BTC-only and split-market bursts
landed 50/50 in one slot. All 1,225 BTC-only pairs shared writable accounts.
In the split run, 600/600 same-market pairs conflicted and 0/625 cross-market
pairs did. Measured block intervals were 457.1 and 470.5 ms. Sustained
throughput, fee competition and a 200 ms slot remain unqualified.

SDK `402a6c03` reduced median post-fetch Chrome wallet verification from about
16 to 7.3 ms for a single wallet, and from 169–172 to about 82 ms per wallet
with twelve verifying together. The two decoder builds reproduced all 655
account payloads and twelve wallet states. This interval excludes RPC, signing
and validator time. [Browser and scheduler measurements](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/operations/performance.md#browser-wallet-verification-with-the-default-decoder)

## Payout with incremental debtor groups

On `grouped-credit` clearing `e4aff314`, eight lanes held 994 traders and six
makers. Harness `796a16b0` paid a 20-atom closed ETH gain at each exposure
level. At 0, 10 and 1,000 exposed members the signed credits used 158,218,
158,384 and 164,585 CU. Each read 64 group summaries and needed zero exact
debtor checks. Maintaining the summaries added 6,926–13,244 CU to the eight
measured opening fills. The owner withdrew 60 atoms. Replay matched 4,413 events.

On the stressed book, harness `11cb1b55` exercised two separately earned
40-atom gains with competing fills. The ordinary credit used 158,387 CU and
zero exact checks. A BTC shock blocked the ETH payment through restart and
membership replacement. After recovery, the credit used 640,410 CU for 640
individual rows **inside eight lane accounts**. Both credits finalized on the
first submission, both owner withdrawals landed, and 3,583 events reconciled.
If all group bounds fail, clearing can still check all 1,000 rows. Worker
discovery also reads the off-chain membership projection. [Group arithmetic and fallback](../clearing/accounting.md#incremental-debtor-checks-on-open-books) · [Worker qualification](https://github.com/arnabnandikgp/rivalt/pull/216)

## Market width and cash access

| Scope and revision | What the workload established |
|---|---|
| Withdrawal diagnostic, `e32e5d88` | Two, four and eight open markets used 5,164, 8,733 and 15,871 CU in signed read-only checks. |
| Sparse trading fixture, `a10888c9` | A funded cross trader opened eight positions and withdrew 12,132 atoms with seven still open. Eleven fills and 13 refusal controls covered the workload. |
| Funded venue, clearing `48f78dec`, harness `7654019e` | A trader with +1 BTC and −10 ETH lots bought 10 SOL lots. The signed order with both funding checkpoints used 536,513 CU, 1,644 bytes and 36 accounts. Omitting ETH risk refused atomically. |
| Cash-access profile, clearing `b79ea8db`, harness `feb4ca7d` | The independently calculated 2,807-atom maximum passed for transfers and an owner withdrawal. Both 2,808-atom requests refused with all three positions open. |

The eight-market fixture has separate custody and synthetic observations.
General market admission depends on complete recovery for reachable venue
books. [Funded margin account](../clearing/accounts.md#listed-markets-on-the-funded-margin-account) · [Width and custody fixtures](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/operations/qualification-scorecard.md#funded-custody-across-persisted-markets)

## Default and wallet exits

Clearing `69c2f5d5`, harness `49623912`. Each funded BTC/ETH/SOL venue froze
12 financial members. Each run recorded 394 signed transactions, ten owner
withdrawals and 241 events replayed in PostgreSQL. All 210 accounts reconciled
with finalized RPC. Monetary columns below are collateral atoms.

| Shortfall | Insurance spent, BTC / ETH / SOL | Forced charges, BTC / ETH / SOL | Paid to wallets | Left in vault | Settlement CU |
|---|---:|---:|---:|---:|---:|
| 6, fully insured | 1 / 5 / 0 | 0 / 0 / 0 | 7,340,180 | 68 | 165,221 |
| 26, residual loss | 3 / 15 / 0 | 1 / 6 / 0 | 7,340,192 | 56 | 399,670 |

Both vaults retained 56 fee atoms. The fully insured run also retained 12
unspent insurance atoms. [Funded default reproduction](validation.md#funded-venue-default-and-creditor-wallet-exits)

Population alone does not determine recovery work. On the separate BTC/ETH
profile `79724a5a`, three 75-member books needed 193, 285 and 327 finalized
keeper transactions through restart. On `3acd4a4d`, a 128-member book needed
471 continuations for one payout calculation. These populations and transaction
counts belong to different verifiers from the funded three-market run.
[75-member qualification](https://github.com/arnabnandikgp/rivalt/pull/158) · [128-member qualification](https://github.com/arnabnandikgp/rivalt/pull/152)

## Funding, costs and comparisons

The publisher computes impact prices off chain. On `79724a5a`, 12 signed
two-market publications used 48,940–49,110 CU. Another 54 transactions also
checkpointed both markets and used 89,682–99,550 CU. These are complete
transaction costs for those workloads. [Funding contract](../liquidity/funding.md)

For Finding 9, the 119-fill burst earned 2,963 collateral atoms in aggregate
taker fees before insurance. Report lamport spend by payer, funded maker cash
and unpaid gains separately. Local zero-priority-fee runs and assumed hedge
costs cannot establish production profitability. [Maker economics](../../packages/maker-kit/src/liquidity-economics.ts) · [Burst conditions](https://github.com/arnabnandikgp/rivalt/pull/169)

The [tracked CU and account baselines](../../tests/performance/baselines/)
preserve the Anchor migration comparison. The [pinned measurement tables](https://github.com/arnabnandikgp/rivalt/blob/ef9ba31aac8fed71c917eafa50f3d29ae5762e77/docs/operations/performance.md)
retain the per-order results, older storage formats and intermediate timings.
