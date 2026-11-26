# Venue qualification scorecard

Reviewed 26 November 2026. Fixed-width position storage is integrated. A funded-routing candidate passes the previously missed ETH order. Wider maker discovery, atomic fills and the matched dollar comparison have signed local qualification. The wallet now covers the previously missed eight-leg thin-bid sales. The funded multi-maker wallet matches the independent references for the curved BTC buy and margin-constrained ETH sale. The combined market-shock and recovery exercise is deferred. The baseline is local BTC/ETH trading with test collateral, synthetic sources and internal makers.

Use the numbered findings across revisions. **Open** means a measured bottleneck or a gap in the evidence. **In review** requires a tested change and a linked PR. **Closed** requires integration and the evidence specified in the last column, scoped to the workload it covers. **Deferred** records a deliberate timing decision. When updating a row, give the program and harness revisions, the denominator, the outcome and the remaining limit. Keep raw receipts at their ignored local paths.

## Findings to revisit

| # | Finding and status | What the evidence says | What would address it |
|---|---|---|---|
| 1 | **Position storage — Closed on integration of [#180](https://github.com/arnabnandikgp/rivalt/pull/180)** | On clearing `b7e4458b` and harness `d175285e`, 80/80 alternating increases and reductions fit fixed 40-byte market records. All 163 wallet routes landed. The maker withdrew principal plus gain, with 951 events reconciled. Exact-fraction checks cover a separate 4,101-fill history and the documented rounding differences. [Measured workload](performance.md#fixed-width-maker-entry) | The fixed-width deployment covers retained mixed-price inventory. Depth, concurrency and adverse-flow liquidity remain separate findings. |
| 2 | **Published versus executable depth — Closed on integration of [#191](https://github.com/arnabnandikgp/rivalt/pull/191) for the bounded local workload ([clearing #189](https://github.com/arnabnandikgp/rivalt/pull/189), [wallet #190](https://github.com/arnabnandikgp/rivalt/pull/190))** | [Benchmark PR #181](https://github.com/arnabnandikgp/rivalt/pull/181). On clearing `b7e4458b` and harness `6ddfcaee`, 22/30 ordinary BTC orders filled across deep, fragmented and one-sided books. Three needed two makers. Six requests exceeded published depth and two required three makers. On ETH the router returned 6133 for a financially executable 3,334-lot buy. The alternative maker filled it in the signed explicit control. Across the ordinary BTC orders, 52.66% of requested dollars filled at the index. [Dollar fills and per-order cost](performance.md#dollar-sized-orders-and-executable-depth) | Clearing `e02e72a0` and harness `db964391` filled this ETH order at the exact $100.053343 limit and refused the tighter limit. At 16 and 32 makers, the matched trace filled 5/10, 6/10 and 7/10 requests at caps of two, four and eight. An eight-maker shortlist omitted deeper bids needed to fill a $10,000 sell. [Matched results](performance.md#matched-dollar-execution-across-16-and-32-makers). On `0edb3064` the eight-leg wallet filled both thin-bid sells at the independent bounded price and improved to 8/10 at each directory size. [Signed results](performance.md#wallet-selection-by-order-size). On curved BTC asks a signed alternative saved $1.720650. On ETH the wallet refused a $3,000 sale that two shortlisted makers filled in a signed control. Clearing `50bd8836` filled ETH at the control price and executed the best four-curve BTC control in 394,364 CU. SDK `7353f463` closed the $5.038591 BTC gap and preserved the funded ETH fill. Both signed ordinary orders reached the computed four-leg optimum. [Wallet results](performance.md#price-aware-wallet-execution). Integration is pending. [Curved and margin-bound results](performance.md#curved-quotes-and-binding-maker-margin). Historical order 109’s exact 6120 branch remains unknown. |
| 3 | **Wallet count versus parallel throughput — Closed for the bounded local workload** | Surfpool filled 288/288 in matched wallet windows. Native wallet preparation limited delivery to 8.54 and 16.05 signed orders/s in two split windows scheduled at 25/s. In matched pre-signed bursts, all 50 BTC orders landed in one local slot, and so did 25 BTC plus 25 ETH. The split used two workers and halved the highest writable-account cost. [Wallet preparation](performance.md#where-the-wallet-spends-time-before-signing) · [Burst and slot timing](performance.md#fifty-already-signed-orders-in-one-slot) | SDK `402a6c03` reduced median Chrome verification from about 16 to 7.3 ms for one wallet and from 169–172 to 82 ms each for twelve. Integrated at `cf61ad81`. The 200 ms repeat is deferred. Sustained throughput and priority-fee competition remain unmeasured. [Browser replay](performance.md#browser-wallet-verification-with-the-default-decoder) · [PR](https://github.com/arnabnandikgp/rivalt/pull/198) |
| 4 | **Closing versus getting cash out — [Automatic scheduling in review](https://github.com/arnabnandikgp/rivalt/pull/201) for the funded local workload** | Self-service exits took 0.800 and 1.236 s on `f873bfd1`. At `efff1af2`, worker-assisted exits took 11.674 and 18.752 s, down from 40.815 and 45.671 s in the matched control. All 48 competing orders filled and both markets collected every covered loss. [Timing and collection trade-off](performance.md#scheduling-payouts-while-losses-keep-arriving) | On `254404ef` the flat ETH maker received all 480 atoms in its wallet after 117.186 s with initially cold backing. [Cold exit](https://github.com/arnabnandikgp/rivalt/pull/203) · [Timing](performance.md#first-eth-maker-payout-with-cold-backing) The [exact coverage comparison](#exact-btceth-debtor-coverage) resolves prior solvent collisions. The [12-member comparison](#clearing-owned-coverage-during-a-cold-eth-payout) found ETH debtors covered before the first complete certificate. The [mandatory update test](#coverage-updates-enforced-by-clearing) verified nine signed refusals across financial and membership writes. A fully crossed book can still require 1,000 exact rows. An exhausted pool or debtor can still leave profit unpaid. |
| 5 | **Member count versus default complexity — Deferred to the shock exercise** | Three 75-member books needed 193, 285 and 327 finalized keeper transactions. A separate 128-member recovery needed 471 continuations for one payout calculation. [Recovery evidence](validation.md#evidence-by-deployment) | At fixed population, vary debt concentration, cross-market claims and eligible reductions. Report work to finish, restart progress and time to the last wallet exit. |
| 6 | **Scripted flow versus actual wallet behavior — Open** | The burst assigned wallets round-robin. The 72-order trace covered eight sizes overall, yet each of its 16 wallets used one size throughout. The 24-wallet burst was BTC buy-only. [Generator](../../tests/rpc-contract/router-load-rpc.ts) | Vary arrival, size, side and market independently per wallet, keep a fixed comparison trace, and repeat on additional seeds. Include repeat traders, reductions, reversals and outstanding orders. |
| 7 | **Coordinated makers and sources — Open for benchmark coverage** | The fixture can refresh six maker publications and synthetic oracle sources together. The funding report uses published depth and omits hypothetical financial admission. [Fixture](../../tests/rpc-contract/liquidity-execution-setup.ts) · [Funding](../liquidity/funding.md) | Vary maker update timing separately from oracle updates. Measure executable spread, refusals and funding coverage. The combined price jump and maker outage belongs to the deferred exercise. |
| 8 | **Willing liquidation capital — Deferred to the shock exercise** | The signed case sold ten lots to a maker. A consenting operator-owned receiver could take five more only after it was funded. [Liquidation qualification](validation.md#evidence-by-deployment) | Exercise several unhealthy accounts competing for limited receiver capital. Measure deficit after fees, remaining exposure and recovery time. Independent participation is a separate external gate. |
| 9 | **Local costs versus sustainable participation — Open for cost reporting** | The wallet uses zero priority fee and the maker kit labels hedge cost as an assumption. The 119 fills earned 2,963 collateral atoms in aggregate taker fees before insurance. [Wallet budget](../liquidity/routing.md) · [Maker economics](../../packages/maker-kit/src/liquidity-economics.ts) | Report actual costs per role in lamports, retained fees after insurance, funded and unpaid maker P&L, and explicitly assumed hedge and priority-fee scenarios. Independent maker economics remain open. |
| 10 | **Markets sharing a margin account — Open** | The local account and risk, funding and backing inputs have two fixed market slots. A flat account can still owe or own a claim. | Key slots by market and preserve obligations until discharged. Qualify the whole account at increasing widths before enabling additional markets. |
| 11 | **Default across three or more markets — Open, blocks wider cross trading** | A BTC/ETH debtor has at most one other market where recovered proceeds can be applied. A third market creates competing destinations. [Three-market example](../clearing/risk-and-resolution.md#gate-for-a-third-cross-market) | Verify the approved proportional allocation before insurance in complete, order-independent settlement, including insurance and final cash exits. Finding 5 separately tracks the cost of running recovery. |

## Payout and cross-margin work

| Order | Finding | Deliverable and acceptance |
|---|---|---|
| 1 | 4, 11 | [Contract and reference cases in review, #204](https://github.com/arnabnandikgp/rivalt/pull/204). Specify [the three ordinary payout outcomes](../clearing/accounting.md#acceptance-contract-for-ordinary-payouts) and compare the three-market default alternatives on the same funded book. |
| 2 | 4 | On BTC/ETH, pay a fully backed, eligible closed claim in one permissionless transaction with **zero membership-walk transactions**. Include cold start, joins, exits, idle cross debt after a price shock, source expiry and recovery. Distinguish loss collection from backing work. Reject unsafe payouts and measure safe payouts delayed. |
| 3 | 10 | Separate the number of listed markets from slots occupied by positions, outstanding claims, live orders or protections. Keep maker capital isolated. Compare a worst-endpoint-per-position withdrawal check against exhaustive mixed endpoints. Exercise fees, funding, transfers, liquidation after fees, slot reuse and refused omissions. |
| 4 | 11 | Before opening a third cross market, qualify a whole frozen book with multiple debtor destinations, partial source recovery, simultaneous shocks and fractional rounding. Reconcile each market's insurance and each creditor's entitlement. Then qualify the wider account end to end. |

Vary population and markets per account independently. Target 1,000 financial
members for the payout workload and 2, 4 and 8 occupied markets for width
comparisons, including mostly idle members and simultaneous fills. These are test
targets. Record actual funded recovery capacity, loaded accounts, writable locks,
CU, fees, transactions per claim, time to wallet and cutoff for unresolved claims.
Use signed Surfpool RPC/WS, token-account changes and fresh PostgreSQL replay for
integrated results. A keeper restart or a new signup must not discard a safe
claim's progress. Preserve the closed fixed-width entry finding and the separate
external and endurance gates.

### BTC/ETH backing summary comparison

[Native comparison in review, #205](https://github.com/arnabnandikgp/rivalt/pull/205). This model starts with empty counters and records account
changes as they occur. It tests debtor coverage alone. The claimant's closed
profit, the pool balance, current sources and authority still require separate
checks. No clearing instruction uses this model.

For each possible debtor, first cover every flat negative claim. Divide its
remaining cash equally across its open positions for the purpose of the proof.
For each market and position direction, count the accounts whose assigned share
would fail at each of nine funding-adjusted prices. The axes are independent.
At payout, read the counter at the next more adverse price on each relevant
axis. A counter also retains the XOR of its member IDs. A count of one identifies
one margin account to value exactly. A larger count cannot be resolved this way.
Outside an axis, the model treats all exposed accounts of that direction as
potential exceptions. A production instruction would have to authenticate every
account change and the supplied exception accounts against current on-chain state.

| Constructed workload | Result |
|---|---|
| Matched positions in 12 and 1,000 financial accounts. Each population repeats the same price, funding and one-debtor cash changes, then removes all members. | Of 224 market-level checks, the full reference marked 164 safe and 60 unsafe. Counters alone withheld 48 safe results. Rechecking identified accounts reduced that to four. All 60 unsafe checks refused. Population was varied by repeating portfolios; the rates describe this trace only. |
| 64 varied eight-account books, including opposite directions, fractions and mixed funding endpoints | The independent exhaustive reference and the existing Rust backing kernel agreed on all 128 market-level decisions. The candidate admitted no reference-unsafe result. |
| Two solvent accounts breach the same conservative threshold | Even when both accounts remain unchanged and cash is sufficient, the exception counter has two IDs and cannot identify both. Ordinary payout could wait indefinitely under this candidate. |

**Disposition.** Keep Finding 4 open. These counters cannot be the sole payout
authority. A replacement must make progress on the two-account counterexample
and on many different debtors behind one warning, without a membership walk.
The exact comparison below tests that case. [Counter comparison](../../tests/financial/test_payout_coverage_summary.py)

### Exact BTC/ETH debtor coverage

The native verifier models eight clearing-owned lanes, assigned by stable member
ID modulo eight. It always reads their current summaries. Each fill records the
new cash, signed lots and funding-adjusted fixed claims for both sides in the
affected lanes. A claimant supplies a one-byte mask identifying additional lane
bodies it can load. If a summary is inconclusive, the verifier checks the
current rows of that lane. An omitted required lane returns “missing input.”
An uncovered debt returns the debtor ID. A mask prepared before a trade confers
no authority. [Model](../../crates/financial-core/tests/payout_coverage/lanes.rs) · [Independent cases](../../crates/financial-core/tests/payout_coverage.rs)

For two markets, write `T` for a member’s target claim, `U` for its other
claim and `C` for funded cash, all in scaled collateral atoms. Coverage holds
if `T ≥ 0`, or if both `C + T ≥ 0` and `C + T + U ≥ 0`. The summaries bound
those three inequalities at the current price and held-funding endpoints.
They also retain how far prices can move from a common reference before a
member could violate the inequalities. This distance uses that member’s own
cash and lots. Flat positions have zero price sensitivity even when they retain
a debt. The model records separate distances for BTC exposure, ETH exposure,
both and neither. A move beyond a proven distance triggers more exact work.

| Native comparison | Result |
|---|---|
| Two solvent accounts in the same lane, in each of the three prior collision cases | All three decisions cleared from the summaries alone. |
| The 224 decisions from the 12- and 1,000-member controls | All 164 safe checks cleared and all 60 unsafe checks refused. Summaries alone decided 56 of 112 in each population. At most two rows were checked at 12 members and 125 at 1,000. |
| 64 varied 16-member books, with intervening balance changes and mixed price/funding endpoints | All 384 decisions agreed with independent 16-corner arithmetic and the existing Rust backing kernel. Of those, 53 were covered and 331 underfunded. |
| Admitted ten-lot BTC fill at 100, one-atom fee, then BTC at 70 | The old mask omitted a newly required lane. With that lane present, the verifier found 189 cash against 340 debt. Adding 151 cash covered it exactly. A one-unit increase in the scaled held funding endpoint again refused. At the covered point the native settlement engine paid the flat ETH creditor 50 atoms from a pool of 60 and the book reconciled. |
| 1,000 members in matched pairs with sizes from 1 to 500 lots, BTC/ETH effective prices moving from 100/200 to 70/120 | With exposure to just one market per account, all eight summaries sufficed for both targets. With both markets open and cash just covering each member’s own losses, both targets required all 1,000 rows. Every account in this control was solvent. |

**Resource limit.** Under a packed representation the fields require 241 bytes
per lane summary and 64 bytes per member including its ID. Eight summaries are
1,928 bytes. The worst observed case adds 64,000 bytes of account data. These
counts exclude account framing and the transaction message. One updated member
widens one summary and replaces one row. Historical extremes can continue to
force exact reads after a debtor recovers. A claim reading all summaries would
also conflict with a fill writing any of them. The model assumes clearing has
tracked every admitted economic change from genesis.

**Signed cost of reading exact rows.** A separate read-only Surfpool fixture
uses the same checked predicate on packed accounts. A caller selects the rows
to measure. The fixture has no clearing or custody authority. In the populated
cross book, a signed update reduced the last account's cash by one atom. The
previously successful all-lane instruction then refused. Restoring cash allowed
the last lane to pass again. The harness checked every initial row against its
independent expected balance and verified finalized RPC receipts and WS
notifications. A fresh PostgreSQL database recorded all six read outcomes.

| Signed read on the solvent book | CU | Transaction bytes | Packed body account data |
|---|---:|---:|---:|
| Empty instruction control | 863 | 241 | 0 bytes |
| 125 rows in one lane | 102,169 | 274 | 8,045 bytes |
| 1,000 rows in eight lanes | 811,251 | 505 | 64,360 bytes |

Each read paid 5,000 test lamports. Only the fee payer was writable. A
single-lane read shared its body with a writer updating that lane. An all-lane
read shared a body with every lane writer. The empty control measures fixture
overhead. All three measurements exclude summary selection, full membership
and economic reconciliation, recipient admission and the payout itself.
[Signed diagnostic](../../tests/rpc-contract/payout-coverage-rpc.ts)

### Clearing-owned coverage during a cold ETH payout

The local observation build copies the canonical cash, lots and funding-adjusted claims of each changed margin account into its lane in the same signed transaction. After provisioning a fixed cohort, the harness opens eight PDAs and seeds one row per financial member. The registry count rejects incomplete initialization. The registry epoch invalidates all observations on a join or retirement. At a payout, the worker keeps the required checkpoints contiguous with the real payment, observes the still-unmodified coverage rows, then copies the new recipient balance. Clearing derives both market risk and held-funding endpoints in that slot. The existing certificate authorizes the payment.

The audit checks every finalized margin write after seeding against its companion row update, and reads the complete set of lanes and financial roots from the same finalized bank at both ends of the run. The reported added CU is the sum of the two top-level row-update instructions on the landed fill. Lock comparisons use the complete transaction read/write sets with and without the added lane keys. They measure which transactions could serialize on the same account.

On clearing `ce9e8e9c` and harness `fd5433fd`, 52 signed single-maker fills landed on local Surfpool. The table distinguishes an observation of sufficient debtor resources from the first actual credit to the maker.

| Check | Finalized result |
|---|---|
| Complete membership | Clearing refused the 11-of-12 cohort. All 12 rows matched canonical margin state at both audits. All 145 scoped margin writes carried their updates in the same transaction. |
| Cold ETH backing | The pool held the flat maker’s 480 atoms at slot 3,831. At slot 3,832 the signed observation found all 12 members covered with zero exact row evaluations. It used 38,178 CU, or 38,628 CU for the whole transaction. |
| Actual credits and withdrawals | All four BTC credits and one ETH credit agreed with the accompanying coverage reading. The 43rd ETH certificate check and the 480-atom credit landed together at slot 5,587 (257,002 CU including the observation). The maker withdrew at slot 5,588, 114.883 s after going flat. The two BTC traders withdrew after 11.218 and 18.473 s. |
| Cost on competing fills | All 48 ten-lot background orders filled. Recording both changed accounts used 10,270–11,249 additional CU per fill (median 10,948.5). Whole fills used 172,437–185,496 CU. |
| Writable accounts and contention | Twelve background fills added one distinct writable lane and 36 added two. Of 1,128 fill pairs, 576 had compatible original lock sets. All 576 remained compatible. An observation reads all eight lanes and conflicts with every one of the 48 writers. Other member distributions can introduce additional fill-to-fill conflicts. |
| Independent replay | Fresh PostgreSQL replay reconciled 915 financial events. Both markets finished with zero outstanding collectible loss. |

This build puts summaries and complete row bodies in the same PDAs. A summary can avoid exact arithmetic while still loading the whole account. The fixture allows 16 rows per lane and freezes membership. The optional recording instructions can be omitted outside the supervised workload. A payment path that trusts these rows first needs mandatory maintenance for every financial or membership change, market accounting and recipient checks, and signed qualification on larger and adverse books. [Clearing implementation](../../programs/clearing/src/shadow_coverage.rs) · [Receipt audit](../../tests/rpc-contract/shadow-coverage-receipts.ts) · [Run locally](local-development.md#comparing-debtor-coverage-during-the-cold-eth-payout)

### Coverage updates enforced by clearing

Fresh local clearing `eb1cb0e4`, with harness `fdc603cb`, maintained the coverage records inside the financial instruction. Eight finalized snapshots matched the canonical cash, signed positions and funding-adjusted claims for every financial member. The venue began with six isolated makers and one trader. A second account joined, received and returned 100 atoms, left, rejoined in generation two, left again and retired. The financial count returned to seven and the membership epoch advanced from eight to twelve.

| Signed check | Outcome |
|---|---|
| Omitted or substituted account | All nine controls failed with `ExitCohort` (6121). This included missing and substituted lanes on a join and an SPL deposit, a missing recipient on a transfer, a missing lane on leaving, an omitted or read-only maker lane on a fill, and a missing lane on an SPL withdrawal. The financial state, token and index accounts touched by each transaction matched their pre-attempt bytes. |
| Two-party BTC fill | Ten lots at 60,002 atoms/lot, 121 atoms taker fee, zero provider fee. The opposite ten-lot positions and both updated coverage rows landed in a single 1,008-byte transaction using 173,703 CU. |
| Transfer and funded withdrawal | Transferring the 100 atoms to the child used 153,055 CU for the complete transaction. The original trader later withdrew 100 funded atoms to its SPL account in 146,828 CU, including the market checkpoints. |
| Coverage after membership changes | The BTC observation found all seven members covered at slot 2,289, with zero exact-row evaluations and 35,784 CU for the complete transaction. Fresh PostgreSQL replay reconciled 115 events. |

These are whole-transaction measurements on this local book. This run does not establish the cost of a certificate-free profit payment, an adverse market outcome, or sustained concurrent load. The 16-row limit per lane also applies to a skewed distribution of stable IDs. [Reproduction](local-development.md#verifying-mandatory-coverage-updates) · [Signed workload](../../tests/rpc-contract/maintained-coverage-rpc.ts)

### Market backing during an idle BTC loss

Clearing `8a239609` and harness `36765e1b` ran against seven financial accounts. One trader owed 30 ETH-market atoms after loss collection and still held a ten-lot BTC long. The debtor and all eight coverage accounts stayed byte-identical during each BTC price move. Each observation was a single 702-byte signed transaction. The comparison independently marked all seven canonical margin accounts, rebuilt the ETH certificate and attempted a one-atom payment to the flat maker.

| BTC price in atoms per lot | ETH settlement balance before claim | Maintained ETH check | Certificate and actual payment |
|---|---:|---|---|
| 60,000 | 10 | Covered, 42,044 CU | 38 steps, paid one atom |
| 40,000 | 9 | Underfunded, 42,036 CU | 38 steps, refused with both balances intact |
| 60,000 after recovery | 9 | Covered, 42,035 CU | 38 steps, paid one atom |

The adverse BTC-market check also returned underfunded. An expired required BTC source blocked the ETH check. After BTC recovered, an expired ETH source still allowed the check because every ETH position was flat. A substituted market ledger was rejected. Finalized RPC/WS receipts and fresh PostgreSQL replay reconciled 792 events. This book had zero funding premium. Direct credit, contention across the eight lanes and populations beyond the per-lane allocation remain open.

## Executable depth work

| Deliverable | Acceptance |
|---|---|
| Funded maker selection | Replay the two signed ETH limits and the baseline BTC orders. Check the winner, aggregate fee, refused state, exit and PostgreSQL replay. |
| Wider discovery | Discover and price 16 and 32 distinct registered makers per market. Construct a bounded writable shortlist for each order. Report which makers the wallet included. At execution, clearing re-reads and compares those makers. A reprice at an omitted maker can improve the market-wide price. |
| Wider atomic fills | First fill the fragmented $10,000 BTC order across three maker capitals. Exercise four and eight legs separately, measure the whole signed transaction and prove rollback on a final-leg failure. Verify full risk admission, one trader update and one aggregate taker fee. |
| Economic and load comparison | Replay the same order flow at 16 and 32 makers with leg budgets of two, four and eight. For each book and side report requested and filled dollars, all-in price versus a same-state independent reference, shortfalls from omitted makers, refused orders, competing writes and actual transaction costs. Record throughput and latency under repricing and replenishment. |

Limits above are test targets. The measured wallet envelope and execution
quality determine which combinations are eligible for a local release.

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

**Storage limit of the earlier exact-entry profile.** Open one lot at 60,001, then repeatedly buy one at 60,002 and sell one at 60,002. After `n` round trips, exact average entry is `60,002 − 1/2ⁿ`. The model completed 984 round trips within 256 bytes. Increase 985 required 257 bytes and rolled back. The owner could still close the remaining lot and collect the exact three atoms due at 60,004. Quantity and payout count alone cannot bound exact entry size for an active maker.

Run `cargo test --locked --offline -p financial-core --features closed-quantity-model --test closed_quantity_payout`. These are native arithmetic and storage checks. The [signed deep-book run](performance.md#closed-quantity-settlement) now covers these sizes, payment refusals, keeper amount calculation, an SPL withdrawal, CU and SQL replay. The [signed mixed-price inventory runs](performance.md#mixed-price-maker-storage) exercise both storage limits. Adverse flow remains open. [Executable cases](../../crates/financial-core/tests/closed_quantity_payout.rs)

### Fixed-width entry cost comparison

The native experiment on `2477ddc4` keeps one 16-byte total entry cost per position, in billionths of a collateral atom. An increase adds its execution cost. A partial reduction keeps the surviving share of cost, rounding down for a long and up for a short. This protects the ordinary payment ceiling from rounding upward. Four tests compare both directions with the exact Rust attribution and independent rational arithmetic. [Comparison driver](../../crates/financial-core/examples/bounded_entry_comparison.rs) · [Financial cases](../../tests/financial/test_bounded_entry.py)

| Question | Result |
|---|---|
| Does the same signed trade history produce the same ordinary ceiling? | Yes on both retained BTC books at the 60,000 reference. All 552 maker and trader observations agreed across 134 and 142 successful routes. The final maker gains were 4.258808 and 4.520904 test collateral. |
| Can splitting a close change when a trader can collect? | Yes. With six lots open, closing three together made five atoms payable in both models. Three one-lot closes made five payable under exact accounting and four under the candidate. With backing, the final close brought both cumulative payouts to ten. |
| Can rounding change a default? | Yes. With all surviving maker lots available for a hypothetical forced reduction, the charge ceiling rose on 127 of 134 and 135 of 142 maker observations. The largest increase was 16,383 atoms. In a separate three-member frozen book, selecting each model’s maximum charge on one eligible lot moved one of eight funded atoms from one creditor to another. Insurance spending was zero in both cases. |

The fixed-width candidate remains native-only. The last row measures a ceiling on the signed histories and an actual native settlement on the separate frozen book. Candidate CU, account rent and on-chain execution remain unmeasured.

### Can two entry-cost bounds certify the exact payment?

Native revision `0bf61818` stores two 16-byte bounds on the surviving position’s total entry cost. Each holds an integer in billionths of an atom and a bit indicating whether the true cost can equal that endpoint. Adding inventory adds its gross cost to both bounds. Reducing inventory scales both by the surviving proportion and rounds each outward. A full close resets both to zero; a flip derives the new basis from its share of the execution gross. Only the entry-cost field is 32 bytes. [Native implementation](../../crates/financial-core/examples/bounded_entry_comparison/interval.rs)

For fixed lots, mark, unpaid claim and matched quantity, each whole-atom ceiling varies monotonically with cost and changes only at integer scaled costs. Clearing arithmetic can therefore give a definitive answer whenever the two endpoint evaluations agree. The experiment tests the interior side of each excluded endpoint. It reports ordinary and frozen ceilings independently, returning an explicit unknown for a ceiling that crosses a threshold. An exact rational reference checks containment and each certified decision. [Tests and fill histories](../../tests/financial/test_entry_bounds.py)

| Native comparison | Result |
|---|---|
| Same two signed BTC histories, replayed at index 60,000 | All **552/552 ordinary ceilings** and **552/552 hypothetical forced-charge ceilings** certified at the exact amounts. Treating both endpoints as inclusive left 262 maker charge ceilings ambiguous. No default occurred on these runs. |
| Three-member frozen case from the single-cost comparison | The strict bounds certified the original one-atom maximum charge. The compiled settlement engine returned **8/0** to the creditors with zero insurance use. |
| Close three lots together or one at a time | Both methods of selling have an exact ordinary ceiling of five atoms. The bounds certify five for the single sale, report unknown after the three partial sales, and certify ten at final close. This holds for both long and short positions. |
| Two distinct BTC fill histories with identical stored bounds | Each ends long four lots with the same mark and a 36-atom unpaid claim. One allows **27 atoms ordinary / 8 forced**, the other **28 ordinary / 4 forced**. Both amounts remain ambiguous from the 32-byte state even with the endpoint bits. |

These results cover local native accounting. The two BTC runs overlap in their early fills. Neither their success rate nor the constructed cases estimate the frequency of ambiguous decisions in general trading. A deployable design preserving these rules still needs enough authenticated information to distinguish the last two histories and finish payout or recovery when the bounds alone cannot decide.

### Exact replay from a verified checkpoint

Native revision `3c0e35b4` replayed admitted position deltas and gross execution amounts through the existing exact Rust entry arithmetic. The experiment models clearing maintaining a SHA-256 commitment for an identified position. Given that trusted commitment, the frozen lot count, accrued claim, mark and matched quantity, a verifier authenticates a checkpoint and every subsequent fill in order. It only returns payment and charge ceilings after the resulting position matches the frozen lot count. Current signed fills do not maintain this experimental commitment. [Verifier](../../crates/financial-core/examples/authenticated_entry_replay.rs) · [Independent histories and checks](../../tests/financial/test_authenticated_entry_replay.py)

| Workload | Exact result and cost |
|---|---|
| Two ambiguous 65-fill histories | Recovered ordinary/forced ceilings **27/8** and **28/4**. With eight funded atoms and no insurance, choosing each maximum charge paid the two creditors **7/1** and **8/0** in the native frozen settlement engine. From flat, each history requires 65 fills and 1,056 witness bytes. From a previously verified checkpoint after fill 64 it requires one fill and **51 bytes**, with the first 64 fills already processed. |
| Maker from the two retained signed BTC histories | The model replayed 134 and 142 successful maker fills in three segments each. Peak exact records used **240** and **254 bytes**. The largest segment witness used **1,164 bytes**. The independent rational reference agreed with every segment checkpoint and both final maker entitlements. |
| Synthetic 4,101-fill position kept open through freeze | The two bounds alone left both ceilings ambiguous. With limits of 64 fills per segment and 256 bytes of exact state, the first width refusal was fill **1,970** (257 bytes). With a 1,024-byte allowance, 65 verified segments completed. Peak exact state was **524 bytes**, the largest witness was **1,554 bytes**, and the last segment used 618 bytes. The exact ordinary/forced ceilings were **2,046/4**. The native frozen case distributed all 513 available atoms. |

Witness sizes count 16 bytes for checkpoint sequence and signed lots, the exact entry bytes, and 16 bytes per subsequent fill. The verifier hashes the checkpoint and each fill once before replaying the financial arithmetic. Rotating the checkpoint hashes its new exact state once more. These figures exclude transaction framing, account metadata, the stored 32-byte commitment, and temporary bigint memory. A missing witness cannot produce a recovery result. Checkpoint rotation requires prior verified work and accessible data; it bounds the number of fills per segment while the exact entry itself can grow with continued inventory. The stress history repeatedly halves a surviving entry difference, adding denominator bits until the next storage limit. No signed replay, Solana execution cost or data-availability guarantee is claimed.

## Original qualification sequence

The [current payout and cross-margin sequence](#payout-and-cross-margin-work) builds on these earlier priorities.

1. **Compare and qualify position storage.** Use the [fixed BTC sequence](performance.md#btc-orders-at-fixed-dollar-sizes) of $100, $1,000, $10,000 and $61,000 plus the one- and three-lot controls. Compare the existing exact implementation to alternative representations on both sides of the trade. Check single-price and mixed entries, aggregate versus split maker legs, repeated partial closes, payments between closes, flips and final close. Check funded cash, unpaid claims, eligible forced-close amounts and creditor receipts against an independent oracle, including rounding boundaries. Measure encoded bytes, reserved bytes, rent, CU and wire impact. Require a signed deep-book repeat, rollback checks, SPL wallet exit and fresh PostgreSQL reconciliation before declaring the storage limit addressed. Escalate any proposal that changes who receives a collateral atom.
2. **Benchmark the trader’s experience.** Keep the deterministic regression suite. Use identical dollar requests across deep, fragmented and one-sided books, then vary maker capital, independent update timing, wallet activity and BTC/ETH exposure. Preserve every scheduled request, including unsigned refusals, expiries and unresolved originals. Report requested and filled notional, actual price against the signed limit, one- and two-maker fills, fees by payer, scheduled-arrival-to-fill latency, cash payout, SPL exit and outstanding claims at a stated cutoff. Keep the index notional and execution value distinct. A larger run can begin while storage work proceeds, but a refusal supplies no downstream payout observation.
3. **Deferred — degradation and recovery on a populated venue.** Build positions with actual trades, introduce a price shock and a maker outage, and continue ordinary traffic while liquidation and payout compete. Measure depth loss and recovery, cost by role, unpaid claims and time to the last exit. This exercise, the deferred 24-hour endurance run, and external P15B/P16B validation have separate scopes.
