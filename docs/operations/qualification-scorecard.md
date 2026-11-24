# Venue qualification scorecard

Reviewed 24 November 2026. Our immediate priorities are position storage and a benchmark that follows an order through to the trader’s wallet. The combined market-shock and recovery exercise is deferred. The baseline is local BTC/ETH trading with test collateral, synthetic sources and internal makers.

Use the numbered findings across revisions. **Open** means a measured bottleneck or a gap in the evidence. **In review** requires a tested change and a linked PR. **Closed** requires integration and the evidence specified in the last column, scoped to the workload it covers. **Deferred** records a deliberate timing decision. When updating a row, give the program and harness revisions, the denominator, the outcome and the remaining limit. Keep raw receipts at their ignored local paths.

## Findings to revisit

| # | Finding and status | What the evidence says | What would address it |
|---|---|---|---|
| 1 | **Position storage — Open, first priority** | All four fixed dollar sizes filled on fresh slots. A maker retaining mixed entries ran out of its initial 128 bytes on round 34. After growth to 256 bytes, the wallet ran out of compute on round 66. The diagnostic run reached the storage limit on round 70. Both traders’ records stayed at or below 13 bytes. [Mixed-price qualification](performance.md#mixed-price-maker-storage) | Bound the cost of carrying inventory across many reductions and increases. Compare per-account entitlements, consumption of compute, storage and solvency against the exact reference before changing the representation. |
| 2 | **Published versus executable depth — Open** | A separate 1,000-lot order exhausted on-chain search. Three books can show enough total depth even when no eligible pair can fill the order. Order 109 passed preview and failed at execution with 6120. Its precise branch remains open. [Route contract](../liquidity/routing.md) · [Order 109](performance.md#wallet-traffic-and-settlement) | Compare published depth, eligible one- or two-maker depth, signed limits, actual fills and the first refusal on deep, fragmented and one-sided books. Include a genuine split fill where conditions allow it. |
| 3 | **Wallet count versus parallel throughput — Open** | All three candidate capitals and registrations are writable on a same-market route. Per-wallet sequencing raised fills from 81 to 110 out of 120, while p95 scheduled-offer-to-fill time rose from 4.189 to 4.988 seconds. [Matched comparison](performance.md#wallet-traffic-and-settlement) | Report same-market versus split-market arrivals, offered and filled notional per second, lock overlap and tail wait from scheduled arrival. A validator throughput claim also requires a representative scheduler and fee market. |
| 4 | **Closing versus getting cash out — Open** | A ready 996-atom BTC claim took 93.041 seconds to pay under load. Another run paid 991 of 996 atoms and ended the observation with an empty pool. These expose different limits on payment. [Settlement measurements](performance.md#wallet-traffic-and-settlement) | Measure close, cash available in the pool, backing ready, funded credit and SPL withdrawal separately. Include partially paid and still-waiting creditors at the cutoff. |
| 5 | **Member count versus default complexity — Deferred to the shock exercise** | Three 75-member books needed 193, 285 and 327 finalized keeper transactions. A separate 128-member recovery needed 471 continuations for one payout calculation. [Recovery evidence](validation.md#evidence-by-deployment) | At fixed population, vary debt concentration, cross-market claims and eligible reductions. Report work to finish, restart progress and time to the last wallet exit. |
| 6 | **Scripted flow versus actual wallet behavior — Open** | The burst assigned wallets round-robin. The 72-order trace covered eight sizes overall, yet each of its 16 wallets used one size throughout. The 24-wallet burst was BTC buy-only. [Generator](../../tests/rpc-contract/router-load-rpc.ts) | Vary arrival, size, side and market independently per wallet, keep a fixed comparison trace, and repeat on additional seeds. Include repeat traders, reductions, reversals and outstanding orders. |
| 7 | **Coordinated makers and sources — Open for benchmark coverage** | The fixture can refresh six maker publications and synthetic oracle sources together. The funding report uses published depth and omits hypothetical financial admission. [Fixture](../../tests/rpc-contract/liquidity-execution-setup.ts) · [Funding](../liquidity/funding.md) | Vary maker update timing separately from oracle updates. Measure executable spread, refusals and funding coverage. The combined price jump and maker outage belongs to the deferred exercise. |
| 8 | **Willing liquidation capital — Deferred to the shock exercise** | The signed case sold ten lots to a maker. A consenting operator-owned receiver could take five more only after it was funded. [Liquidation qualification](validation.md#evidence-by-deployment) | Exercise several unhealthy accounts competing for limited receiver capital. Measure deficit after fees, remaining exposure and recovery time. Independent participation is a separate external gate. |
| 9 | **Local costs versus sustainable participation — Open for cost reporting** | The wallet uses zero priority fee and the maker kit labels hedge cost as an assumption. The 119 fills earned 2,963 collateral atoms in aggregate taker fees before insurance. [Wallet budget](../liquidity/routing.md) · [Maker economics](../../packages/maker-kit/src/liquidity-economics.ts) | Report actual costs per role in lamports, retained fees after insurance, funded and unpaid maker P&L, and explicitly assumed hedge and priority-fee scenarios. Independent maker economics remain open. |

## Starting evidence for the active priorities

**Position storage.** A native comparison opens the four BTC sizes at 61,002 atoms per lot. It reduces at entry price and pays one atom of open profit at each of 220 different remaining prime lot counts, using an index 1,000 atoms per lot in the profitable direction at payment. Sharing each payment across a different quantity produces a fraction that can grow even with one entry price. For the $100 order, the resulting exact record takes **805 bytes**. Storing entry and paid profit as separate reduced fractions would take **545 bytes** with four two-byte length fields. The paid denominator alone is 263 bytes. Both results measure this particular history. The independent rational sum matches the real Rust accounting for both long and short positions, including the whole-atom cap on forced reduction. This is an accounting comparison; admitting it on-chain and funding the payments are still open. [Executable case](../../crates/clearing-accounting/tests/position_history_storage.rs)

| Opening BTC notional target | Lots | RVPROF01 bytes after the history | Calculated bytes with separate fractions |
|---|---:|---:|---:|
| $100 | 1,640 | 805 | 545 |
| $1,000 | 16,394 | 1,164 | 784 |
| $10,000 | 163,935 | 1,444 | 971 |
| $61,000 | 1,000,000 | 1,660 | 1,115 |

**Trader outcomes.** The 119/120 burst offered 240 BTC lots and filled 237, for **14.457474 test collateral tokens** of execution value. Maker 1 handled 74 fills alone and maker 2 handled 45 alone. This is evidence about wallet contention and settlement on that book. Use a separate split-fill workload for conclusions about routing across makers. The receipt reader decodes the maker legs, actual gross and fees from finalized fills. It measures requested gross at the fixture’s offer price and retains all scheduled arrivals in the denominator. [Receipt reader](../../tests/performance/trader-flow-report.ts) · [Workload PR](https://github.com/arnabnandikgp/rivalt/pull/169)

To repeat the native comparison or rescore an existing completed router-load run from the repository root:

```sh
source ops/env.sh
cargo test --locked --offline -p clearing-accounting --features surviving-profit --test position_history_storage
node --import tsx tests/performance/trader-flow-report.ts "$RIVALT_RUN_DIR"
```

Set `RIVALT_RUN_DIR` to the directory containing `router-load.json` and its retained receipts. [Generating a wallet workload](local-development.md#wallet-load-comparison)

### Closed-quantity payout comparison

The native test runs the actual route, margin, fee, backing, settlement and profit-attribution arithmetic with the [closed-quantity payment ceiling](../clearing/accounting.md#ordinary-payouts-on-closed-quantity). It checks whether the exact entry fits at trade time. An admitted partial close or payment carries no additional entry-storage requirement. The pool is funded by collection from a losing account. With adequate cash, the following long results use entry 61,002 and exit 61,998 collateral atoms per lot. The first sale closes half the lots, rounded up. Amounts below are six-decimal test collateral, before trader fees unless labelled otherwise.

| Requested size | Paid after the first sale | Gross gain paid by final close | Trader's cash gain after all fees |
|---|---:|---:|---:|
| $100 | 0.816720 | 1.633440 | 1.593095 |
| $1,000 | 8.164212 | 16.328424 | 15.925130 |
| $10,000 | 81.640128 | 163.279260 | 159.246457 |
| One BTC ($61,000) | 498.000000 | 996.000000 | 971.400000 |

All four sizes and both small controls completed for longs and shorts. With the pool already funded, price appreciation alone authorized zero payment. On replay of the 220 prime-quantity requests at each size, sales at entry produced zero realized gain and all 880 payout attempts were refused. In a separate profitable-sale sequence, all 880 one-atom payments succeeded. Single-price entry occupied 13 bytes at all four sizes. This counts the attribution record for one market inside one margin account.

**Remaining storage limit.** Open one lot at 60,001, then repeatedly buy one at 60,002 and sell one at 60,002. After `n` round trips, exact average entry is `60,002 − 1/2ⁿ`. The model completed 984 round trips within 256 bytes. Increase 985 required 257 bytes and rolled back. The owner could still close the remaining lot and collect the exact three atoms due at 60,004. Quantity and payout count alone cannot bound exact entry size for an active maker.

Run `cargo test --locked --offline -p financial-core --features closed-quantity-model --test closed_quantity_payout`. These are native arithmetic and storage checks. The [signed deep-book run](performance.md#closed-quantity-settlement) now covers these sizes, payment refusals, keeper amount calculation, an SPL withdrawal, CU and SQL replay. The [signed mixed-price inventory runs](performance.md#mixed-price-maker-storage) exercise both storage limits. Adverse flow remains open. [Executable cases](../../crates/financial-core/tests/closed_quantity_payout.rs)

## Work order

1. **Compare and qualify position storage.** Use the [fixed BTC sequence](performance.md#btc-orders-at-fixed-dollar-sizes) of $100, $1,000, $10,000 and $61,000 plus the one- and three-lot controls. Compare the existing exact implementation to alternative representations on both sides of the trade. Check single-price and mixed entries, aggregate versus split maker legs, repeated partial closes, payments between closes, flips and final close. Check funded cash, unpaid claims, eligible forced-close amounts and creditor receipts against an independent oracle, including rounding boundaries. Measure encoded bytes, reserved bytes, rent, CU and wire impact. Require a signed deep-book repeat, rollback checks, SPL wallet exit and fresh PostgreSQL reconciliation before declaring the storage limit addressed. Escalate any proposal that changes who receives a collateral atom.
2. **Benchmark the trader’s experience.** Keep the deterministic regression suite. Use identical dollar requests across deep, fragmented and one-sided books, then vary maker capital, independent update timing, wallet activity and BTC/ETH exposure. Preserve every scheduled request, including unsigned refusals, expiries and unresolved originals. Report requested and filled notional, actual price against the signed limit, one- and two-maker fills, fees by payer, scheduled-arrival-to-fill latency, cash payout, SPL exit and outstanding claims at a stated cutoff. Keep the index notional and execution value distinct. A larger run can begin while storage work proceeds, but a refusal supplies no downstream payout observation.
3. **Deferred — degradation and recovery on a populated venue.** Build positions with actual trades, introduce a price shock and a maker outage, and continue ordinary traffic while liquidation and payout compete. Measure depth loss and recovery, cost by role, unpaid claims and time to the last exit. This exercise, the deferred 24-hour endurance run, and external P15B/P16B validation have separate scopes.
