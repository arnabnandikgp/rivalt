# Venue qualification scorecard

Reviewed 27 November 2026. Fixed-width position storage is integrated. A funded-routing candidate passes the previously missed ETH order. Wider maker discovery, atomic fills and the matched dollar comparison have signed local qualification. The wallet now covers the previously missed eight-leg thin-bid sales. The funded multi-maker wallet matches the independent references for the curved BTC buy and margin-constrained ETH sale. The combined market-shock and recovery exercise is deferred. The baseline is local BTC/ETH trading with test collateral, synthetic sources and internal makers.

Use the numbered findings across revisions. **Open** means a measured bottleneck or a gap in the evidence. **In review** requires a tested change and a linked PR. **Closed** requires integration and the evidence specified in the last column, scoped to the workload it covers. **Deferred** records a deliberate timing decision. When updating a row, give the program and harness revisions, the denominator, the outcome and the remaining limit. Keep raw receipts at their ignored local paths.

## Findings to revisit

| # | Finding and status | What the evidence says | What would address it |
|---|---|---|---|
| 1 | **Position storage — Closed on integration of [#180](https://github.com/arnabnandikgp/rivalt/pull/180)** | On clearing `b7e4458b` and harness `d175285e`, 80/80 alternating increases and reductions fit fixed 40-byte market records. All 163 wallet routes landed. The maker withdrew principal plus gain, with 951 events reconciled. Exact-fraction checks cover a separate 4,101-fill history and the documented rounding differences. [Measured workload](performance.md#fixed-width-maker-entry) | The fixed-width deployment covers retained mixed-price inventory. Depth, concurrency and adverse-flow liquidity remain separate findings. |
| 2 | **Published versus executable depth — Closed on integration of [#191](https://github.com/arnabnandikgp/rivalt/pull/191) for the bounded local workload ([clearing #189](https://github.com/arnabnandikgp/rivalt/pull/189), [wallet #190](https://github.com/arnabnandikgp/rivalt/pull/190))** | [Benchmark PR #181](https://github.com/arnabnandikgp/rivalt/pull/181). On clearing `b7e4458b` and harness `6ddfcaee`, 22/30 ordinary BTC orders filled across deep, fragmented and one-sided books. Three needed two makers. Six requests exceeded published depth and two required three makers. On ETH the router returned 6133 for a financially executable 3,334-lot buy. The alternative maker filled it in the signed explicit control. Across the ordinary BTC orders, 52.66% of requested dollars filled at the index. [Dollar fills and per-order cost](performance.md#dollar-sized-orders-and-executable-depth) | Clearing `e02e72a0` and harness `db964391` filled this ETH order at the exact $100.053343 limit and refused the tighter limit. At 16 and 32 makers, the matched trace filled 5/10, 6/10 and 7/10 requests at caps of two, four and eight. An eight-maker shortlist omitted deeper bids needed to fill a $10,000 sell. [Matched results](performance.md#matched-dollar-execution-across-16-and-32-makers). On `0edb3064` the eight-leg wallet filled both thin-bid sells at the independent bounded price and improved to 8/10 at each directory size. [Signed results](performance.md#wallet-selection-by-order-size). On curved BTC asks a signed alternative saved $1.720650. On ETH the wallet refused a $3,000 sale that two shortlisted makers filled in a signed control. Clearing `50bd8836` filled ETH at the control price and executed the best four-curve BTC control in 394,364 CU. SDK `7353f463` closed the $5.038591 BTC gap and preserved the funded ETH fill. Both signed ordinary orders reached the computed four-leg optimum. [Wallet results](performance.md#price-aware-wallet-execution). Integration is pending. [Curved and margin-bound results](performance.md#curved-quotes-and-binding-maker-margin). Historical order 109’s exact 6120 branch remains unknown. |
| 3 | **Wallet count versus parallel throughput — Closed for the bounded local workload** | Surfpool filled 288/288 in matched wallet windows. Native wallet preparation limited delivery to 8.54 and 16.05 signed orders/s in two split windows scheduled at 25/s. In matched pre-signed bursts, all 50 BTC orders landed in one local slot, and so did 25 BTC plus 25 ETH. The split used two workers and halved the highest writable-account cost. [Wallet preparation](performance.md#where-the-wallet-spends-time-before-signing) · [Burst and slot timing](performance.md#fifty-already-signed-orders-in-one-slot) | SDK `402a6c03` reduced median Chrome verification from about 16 to 7.3 ms for one wallet and from 169–172 to 82 ms each for twelve. Integrated at `cf61ad81`. The 200 ms repeat is deferred. Sustained throughput and priority-fee competition remain unmeasured. [Browser replay](performance.md#browser-wallet-verification-with-the-default-decoder) · [PR](https://github.com/arnabnandikgp/rivalt/pull/198) |
| 4 | **Closing versus getting cash out — Closed for bounded local BTC/ETH in [#216](https://github.com/arnabnandikgp/rivalt/pull/216)** | A 1,000-member book paid two separately earned 40-atom closed ETH gains through the ordinary worker. The owner withdrew both payments to its token wallet. The ordinary credit used 158,387 CU with zero exact checks. Recovery used 640,410 CU for 640 checks. [Worker qualification](performance.md#automatic-wallet-payouts-on-a-stressed-1000-member-book) | The worker refused an underfunded cross debtor through restart and membership replacement, then paid after recovery. Both exits landed under competing fills and 3,583 events reconciled. Wider market support and production latency are separate qualifications. |
| 5 | **Member count versus default complexity — Deferred to the shock exercise** | Three 75-member books needed 193, 285 and 327 finalized keeper transactions. A separate 128-member recovery needed 471 continuations for one payout calculation. [Recovery evidence](validation.md#evidence-by-deployment) | At fixed population, vary debt concentration, cross-market claims and eligible reductions. Report work to finish, restart progress and time to the last wallet exit. |
| 6 | **Scripted flow versus actual wallet behavior — Open** | The burst assigned wallets round-robin. The 72-order trace covered eight sizes overall, yet each of its 16 wallets used one size throughout. The 24-wallet burst was BTC buy-only. [Generator](../../tests/rpc-contract/router-load-rpc.ts) | Vary arrival, size, side and market independently per wallet, keep a fixed comparison trace, and repeat on additional seeds. Include repeat traders, reductions, reversals and outstanding orders. |
| 7 | **Coordinated makers and sources — Open for benchmark coverage** | The fixture can refresh six maker publications and synthetic oracle sources together. The funding report uses published depth and omits hypothetical financial admission. [Fixture](../../tests/rpc-contract/liquidity-execution-setup.ts) · [Funding](../liquidity/funding.md) | Vary maker update timing separately from oracle updates. Measure executable spread, refusals and funding coverage. The combined price jump and maker outage belongs to the deferred exercise. |
| 8 | **Willing liquidation capital — Deferred to the shock exercise** | The signed case sold ten lots to a maker. A consenting operator-owned receiver could take five more only after it was funded. [Liquidation qualification](validation.md#evidence-by-deployment) | Exercise several unhealthy accounts competing for limited receiver capital. Measure deficit after fees, remaining exposure and recovery time. Independent participation is a separate external gate. |
| 9 | **Local costs versus sustainable participation — Open for cost reporting** | The wallet uses zero priority fee and the maker kit labels hedge cost as an assumption. The 119 fills earned 2,963 collateral atoms in aggregate taker fees before insurance. [Wallet budget](../liquidity/routing.md) · [Maker economics](../../packages/maker-kit/src/liquidity-economics.ts) | Report actual costs per role in lamports, retained fees after insurance, funded and unpaid maker P&L, and explicitly assumed hedge and priority-fee scenarios. Independent maker economics remain open. |
| 10 | **Markets sharing a margin account — Open** | Local clearing has two fixed slots. A [withdrawal comparison](#withdrawal-risk-at-two-four-and-eight-markets) covers two, four and eight markets. The [slot lifecycle](#market-slot-retention-and-reuse) and [funded custody fixture](#funded-custody-across-persisted-markets) exercise obligation retention and signed cash movements. | [Signed fills](#signed-orders-on-eight-markets) and [receiver liquidation](#funded-receiver-liquidation-across-markets) qualify the sparse fixture. [Venue withdrawals](#occupied-market-withdrawal-on-venue-clearing) use the indexed check at two markets. The venue [registers SOL inactive](#inactive-sol-listing-on-venue-clearing) [observes its independent index](#inactive-sol-index-observation) and [admits separately funded maker capital](#isolated-maker-capital-for-an-inactive-listing). Wider venue accounts and default activation remain open. |
| 11 | **Default across three or more markets — Open, blocks wider cross trading** | A native complete-book calculation at `8b1e155f` matched independent exact settlement across three markets, including partial recovery, cycles, insurance and terminal whole atoms. [Workload](#three-market-frozen-book-settlement) | The [signed five-member book](#signed-three-market-default-and-wallet-exit) verifies the maximal protected charge for a single eligible pair and reconciles the wallet exits. The [signed two-winner settlement](#signed-two-winner-settlement-and-withdrawals) checks competing charges on the same BTC debtor. The [market-indexed engine](#one-settlement-engine-across-market-widths) compares simultaneous reductions against the original book. The [signed four-market book](#signed-market-indexed-settlement) verifies nine allocations and wallet exits. The [insured settlement](#insured-settlement-with-two-debt-destinations) pays a debtor’s two destinations and protects a creditor through rounding. The indexed verifier now covers [residual settlement](#residual-settlement-with-open-positions), [capacity-limited recovery](#partial-recovery-with-competing-winners) and [simultaneous competing markets](#competing-winners-in-two-distressed-markets). Wider venue trading, default and wallet exits remain open. Finding 5 tracks the operating cost of recovery. |

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

On the fresh grouped payout build, the [signed 1,000-member workload](performance.md#payout-with-incremental-debtor-groups) paid a closed ETH gain with every member exposed. All 64 group bounds held at the current adverse endpoints. The verifier checked zero individual debtors. A price shock that made an idle debtor unable to pay forced an individual check and blocked payment. The [stressed worker run](performance.md#automatic-wallet-payouts-on-a-stressed-1000-member-book) covers scheduling under competing fills and measures a payment with 40 groups requiring exact checks.

### Inactive SOL listing on venue clearing

Clearing `1adaf018` and harness `d470168b` ran on a fresh local venue. The
authority registered SOL as ID 2 with 1,000,000 lots per whole SOL, the existing
test collateral mint and a local SOL/USD feed. Finalized SDK discovery returned
one listing. The 522-byte transaction used 18,534 CU and loaded ten accounts.
The listing occupies 166 bytes and its ticker binding 51. No margin account or
active market changed during registration.

Clearing rejected eight signed attempts covering an unauthorized signer, a BTC
feed substituted for SOL, a different publisher, reserved ETH ID 1, duplicate ID, duplicate
ticker, an order on ID 2 and an attempted fill using the listing as an active
market. The financial accounts and both listing accounts matched their pre-attempt
bytes after each refusal. A one-lot BTC fill succeeded afterward. The 230 signed
transactions include venue provisioning. Fresh PostgreSQL replay reproduced 81
events and reconciled both listing accounts against RPC. The isolated legacy
and RC2 Anchor clients agreed with the generated SDK on the signed instruction,
its two account layouts and both events. SOL index observations, maker admission,
live positions and default remain outside this run.

### Inactive SOL index observation

On clearing `aa205484` and harness `0cf1251f`, the authority bound four local
oracle feeds to a 251-byte observation PDA. A trader paid the network fee and
was the only signer on each accepted observation. The venue supports one million
lots per SOL and one million atoms per collateral token in this test.

| Signed transaction | Price inputs (primary SOL, guard SOL, collateral) | Reference and inclusive bounds, in collateral atoms per lot | CU | Wire bytes |
|---|---|---|---:|---:|
| Bind the sources | No published price required | Empty observation | 18,076 | 538 |
| First observation | $150, $151, $0.99 | 151 (149–155) | 18,380 | 537 |
| Recover after expiry | $149.50, $150, $1.01 | 148 (146–151) | 18,392 | 537 |

Each transaction loaded 12 accounts. The first observation expired eight seconds
after acceptance because the guard's report was already 12 seconds old. An
unchanged report, substituted feeds, stale primary and collateral guard prices,
a conflicting guard price, excessive confidence width and an unverified guard
all refused. No refusal moved the sample's deadline or changed financial state.

The full signed run included 258 transactions. Nineteen refused, including
eleven specific to binding or observing the index. Fresh PostgreSQL replay
matched all 96 events and reconciled the final accounts. Both isolated Anchor
clients matched the generated SDK on four accepted instructions, three accounts
and eight events. A one-lot BTC control filled; SOL trading remained disabled.
This is local fixture pricing. [Reproduction](validation.md)

### Occupied-market withdrawal on venue clearing

Fresh local profile `indexed-withdrawal` ran clearing `4e11ef94` and SDK/harness
`356293da`. A cross trader bought ten BTC lots at 60,002 atoms per lot and
sold ten ETH lots at 29,998. The independent cash floor was 99,940 atoms after
fees. After transferring one atom to the owner's other margin account, the
owner withdrew 899,878 atoms to their token account. The SPL vault decreased by
the same amount. This complete withdrawal transaction used 144,477 CU and
1,107 wire bytes, including the market and fee checkpoints.

Clearing rejected omission of ETH with only an ETH order and again with an open
ETH position. Substituting the BTC PDA for the required ETH PDA failed seed
validation. Both a transfer and a wallet withdrawal one atom over the limit
failed. Each refusal preserved the watched margin, maker, lane, market, ledger,
custody and token bytes. The run fetched 241 signed transactions over local
RPC, observed WebSocket notifications and reproduced 116 journal events in a
fresh PostgreSQL database. The signed venue book used zero funding premium.
Nonzero mixed endpoints are covered in the native width and clearing tests.
The venue still lists BTC and ETH.

### Withdrawal risk at two, four and eight markets

On risk kernel `f57333f3`, the independent reference computed both required cash amounts for 128 books at each width. It enumerated all funding corners from the stored pre-accrual positions. Both amounts matched on every book, including books with flat claims and fractional losses. Testing a withdrawal one atom below, at and one atom above the independent maximum gave 1,152 matching decisions. With two markets, all 384 also matched the existing Rust withdrawal and four-corner risk calculation. The held funding requirement bound 32, 25 and 20 of the 128 books respectively. The comparison uses deliberately wide synthetic windows to exercise both conditions. [Arithmetic and assumptions](../clearing/risk-and-resolution.md#withdrawal-risk-across-occupied-markets)

Signed local fixture `e32e5d88` stored alternating longs and shorts in a synthetic book with 10,000 funded atoms and seven reserved atoms. Absolute sizes were one through the number of markets. Each lot could lose 60 atoms under its adverse funding endpoint. The table reports complete, finalized read-only decision transactions. Each signed transaction paid 5,000 test lamports. Only the fee payer was writable.

| Occupied markets | Funding corners in reference | Maximum withdrawal in fixture atoms | CU at the boundary | Loaded accounts | Wire bytes |
|---:|---:|---:|---:|---:|---:|
| 2 | 4 | 9,820 | 5,164 | 6 | 346 |
| 4 | 16 | 9,400 | 8,733 | 8 | 412 |
| 8 | 256 | 7,840 | 15,871 | 12 | 544 |

All three maxima passed. One extra atom, a missing market PDA and a substituted market PDA each refused at every width. RPC and WS verified the signed originals. A fresh PostgreSQL table rebuilt from finalized program history matched the 12 observed decisions and their CU. All fixture state bytes compared equal before and after. The measured path includes the fixture account reads and risk calculation. Production oracle checks, order refresh, SPL custody, account writes and wider liquidation/default still need separate qualification. [Reproduction](validation.md#checks-by-change)

### Market slot retention and reuse

The candidate keeps only occupied markets, sorted by market ID. Native tests fill capacities of two, four and eight, refuse one additional market, then release a middle slot and admit a different market on either side of the existing IDs. Unaffected references still resolve after compaction. Both signs of a one-billionth-of-an-atom claim keep the market occupied. At all widths the checks use the same accounting transition. [Account contract](../clearing/accounts.md#market-slots-in-the-width-qualification)

On clearing `e4aff314`, harness `e131600c` captured 15 finalized root images each for a cross trader and an isolated ETH maker. The trader kept a live BTC order while opening and closing ten ETH lots. Cancelling one protection child left the other active. The close invalidated the surviving child and left the trader owing 40 atoms and the maker owed 40. Collecting 39 kept the trader’s ETH slot. Collecting the last atom released it. The maker’s slot survived until its claim became funded cash, and the owner withdrew the 40 atoms. Reopening ETH assigned the trader a fresh binding. Removing the BTC order kept the new ETH binding valid after compaction.

Both withdrawals that omitted a required ETH market (live order, then flat debt) returned clearing error 6125 and left the watched financial and token accounts byte-identical. Of 247 signed workload and provisioning transactions, those two were the only refusals. Each original matched finalized RPC and WS observations. PostgreSQL replay reconciled 150 events. The Rust directory replayed the existing two-market wire layout and checked retired references at each stage. The signed program used the existing two-market representation throughout. [Reproduce](validation.md#checks-by-change)

### Funded custody across persisted markets

The local custody program stores alternating long and short positions, with sizes of one through the number of occupied markets. Each sender starts with an SPL deposit of 10,000 test atoms. The standing order reserves 307 atoms. At the current funding index a long owes three atoms per lot. The reference separately enumerates all four, 16 or 256 combinations of the held funding endpoints. The sender must retain the larger of the two cash floors.

| Occupied sender markets | Current cash floor | Held cash floor | Maximum transferable or withdrawable atoms |
|---:|---:|---:|---:|
| 2 | 340 | 177 | 9,660 |
| 4 | 419 | 594 | 9,406 |
| 8 | 715 | 2,148 | 7,852 |

Each receiver holds a position in one shared market and a standing order in a market unique to the receiver. The transfer therefore requires three, five or nine distinct market observations. Both accounts accrue from their stored funding checkpoints. Admission of a credit can improve an underfunded receiver, while spending from that receiver requires its own cash floor of 320 atoms. [Account layout and authority](../clearing/accounts.md#funded-custody-qualification)

On fixture and harness `c7325087`, all three maximum withdrawals and transfers landed. With two, four and eight sender markets, withdrawals used 17,900, 23,903 and 36,326 CU. Transfers used 14,161, 20,420 and 32,922 CU. The widest withdrawal loaded 17 accounts in 718 wire bytes. The widest transfer loaded 15 accounts in 652 bytes. These costs include the fixture risk checks and the withdrawal’s SPL CPI. They exclude live order matching and production source updates.

The 52 signed transactions included 35 cash instructions. Twenty refusals covered one atom over each sender limit, missing or substituted markets on both operations, a foreign signer and a stale revision. Every refused operation preserved the roots, windows, wallet and vault byte-for-byte. Fresh PostgreSQL replay of finalized history matched 35 receipts, the six final funded balances and the 4,042 atoms remaining in the SPL vault. The held observations and exposures were synthetic. [Reproduction](validation.md#checks-by-change)

### Signed orders on eight markets

On fixture and harness `a10888c9`, one trader deposited 20,000 collateral atoms into an empty cross account. A separate local operator funded eight isolated maker accounts with 4,000 atoms each. The trader bought 100 lots in each of eight markets at 100 atoms per lot. Two fills of 25 and 75 lots completed the first order for two fee atoms in total. Nine markets were listed. An order in the ninth refused when all eight slots were occupied.

After the trader signed a sell limit of 100, the source authority changed the first market’s index to 95 and the eighth to 98, and increased each cumulative funding index by one atom per lot. The update wrote neither counterparty’s margin account. The old revision and the old sell limit each refused. The trader signed a replacement at 98 and closed the eighth position in fills of 40 and 60 lots. The closed trader owed 300 atoms in that market. The isolated maker held the corresponding unpaid gain. The other seven trader positions stayed open.

| Signed fixture operation | CU | Loaded accounts | Wire bytes |
|---|---:|---:|---:|
| Fill the second market | 16,545 | 9 | 533 |
| Fill the fourth market | 24,249 | 11 | 599 |
| Fill the eighth market | 40,257 | 15 | 731 |
| Close 40 of 100 lots with eight occupied markets | 41,925 | 15 | 731 |
| Close the remaining 60 lots | 38,433 | 15 | 731 |
| Withdraw the trader’s surplus with seven open positions and one flat debt | 40,115 | 18 | 814 |

After fees the trader held 19,982 funded atoms. The current cash floor was 6,950 initial margin plus 900 debt. The held funding endpoints required 2,300. Withdrawing 12,133 atoms refused, and 12,132 landed in the trader’s SPL account, leaving 7,850. The maker withdrew its 4,000 funded atoms and retained the 300-atom unpaid claim. A withdrawal of 4,001 refused.

There were 72 finalized signed transactions including setup. All 13 expected refusals preserved both token wallets, vault, markets and margin accounts byte-for-byte. Separate PostgreSQL replay discovered 59 market, order, fill and custody receipts from finalized program history. It reconstructed all 11 fills and reconciled all nine margin accounts and nine market fee records. The vault held 35,868 atoms, comprising 35,850 funded balances, 17 retained fees and one insurance atom. The older two-, four- and eight-market custody trace also reconciled all 35 cash receipts and 4,042 remaining vault atoms on this revision.

These measurements use synthetic index and funding updates, one resting order per trader and one consenting maker per fill. The profile omits production price discovery, routed maker execution and liquidation. [Account contract](../clearing/accounts.md#signed-orders-on-a-sparse-cross-account) · [Reproduction](validation.md#checks-by-change)

### Funded receiver liquidation across markets

The signed `847d6ca2` workload extends the eight-market order trace. The target had seven open longs, one closed debt of 300 atoms, 8,852 funded atoms and a resting buy. An index drop to 45 and cumulative funding of two atoms per lot in the first market produced another 5,700 atoms of debt. With 3,225 atoms of maintenance required, its shortfall was 373. The selected transfer market held its index of 100 throughout. A separate receiver had a resting buy in the ninth market reserving 1,002 atoms.

| Finalized transaction | Result | CU | Loaded accounts | Wire bytes |
|---|---|---:|---:|---:|
| Transfer one lot at 96 | Five atoms of maintenance released, four lost on price and one paid in fees. The unchanged shortfall blocked execution. | 49,650 | 16 | 772 |
| Transfer 40 at 100 with 1,399 receiver cash | The two-atom fee left the receiver one atom short of its reservation plus 400 initial margin. Both accounts rolled back. | 55,202 | 16 | 772 |
| Add one atom to receiver cash, then transfer 40 at 100 | The transfer alone took the shortfall from 373 to 175 after the two-atom fee. The receiver kept its order and the target’s resting buy was cancelled. | 56,115 | 16 | 772 |
| Receiver cancels its resting buy, then takes 36 at 100 | The transfer alone restored maintenance after a second two-atom fee. The target retained 24 lots in this market. | 55,152 | 15 | 739 |

The receiver owner and a separate fee payer signed both successful transfers. The target and source authority did not sign. A third attempt refused after recovery. The receiver withdrew 644 atoms, leaving 760 against its 76 lots. Each successful transfer paid 10,000 test lamports in transaction fees. The two collateral fees passed from target to receiver. The market retained its existing trading-fee split.

Of 97 signed transactions, 25 expected refusals preserved all watched financial state. Of 12 receiver transfer attempts, two landed. A fresh PostgreSQL database replayed 82 finalized market, order, fill, transfer and custody receipts, reconstructed both deficits after fees and checked receiver margin. Ten margin roots held 37,608 funded atoms. Together with 18 trading-fee atoms they matched 37,626 atoms in SPL custody. Native regression `2f0f5467` also checked a partially transferred short’s surviving reduce-only reservation and its release at flat. It rebuilt the same program bytes.

This single-target local case uses synthetic observations and an internal funded receiver. The production adapter, maker-routed liquidation, competition for receiver capital, and complete default at greater width each have their own qualification scope. [Receiver contract](../clearing/risk-and-resolution.md#funded-receiver-on-a-sparse-cross-account) · [Reproduction](validation.md#checks-by-change)

### Three-market frozen-book settlement

At `8b1e155f` the Rust model and Python fraction reference matched on 153 native evaluations. These comprised six partial-recovery or debt-cap cases under 12 input orderings, eight mixed books under six market orderings, 32 seeded four-member books and one numeric-boundary book. A further 24 books with an empty third market reproduced the existing two-market specification's whole member balances, claim movements and insurance use. Ten invalid inputs refused, including an omitted zero-balance member whose removal would otherwise preserve every financial total.

| Frozen book | Outcome in collateral atoms |
|---|---|
| SOL collects 90 against 180 owed to a cross debtor with BTC/ETH debts of 150/120 | The debtor forwards 50/40. BTC insurance supplies 100. The creditors receive 150/40 and the ETH creditor bears the remaining 80. |
| SOL collects one atom against the same debts, with no insurance | The exact entitlements are 5/9 and 4/9. The BTC creditor receives the one whole atom. All 12 input orders produce the same result. |
| A cashless cycle with an available reserve in each market | All three markets discharge the reciprocal claims in full. Cash paid and insurance consumed are both zero. Adding outside creditors and three funded atoms in a separate book gives rates 33/56, 33/56 and 17/28. |
| Rounding one reserve reduces the next market's incoming recovery | From reserves of 2/3/3, the book spends 1/2/2. Final recovery rates are 2/3, 6/7 and 10/11. Fees stay in their originating markets. |

The fully compared fields include each member's own cash collection, recovered claims, onward payments, impairment, writeoff, exact cash entitlement and final whole-atom movements. The largest fixture contained seven members. This is a native arithmetic qualification on supplied frozen balances. Wider signed default, forced reductions, SPL exits and operating cost remain open. [Equations](../clearing/risk-and-resolution.md#settlement-across-a-frozen-set-of-markets) · [Reproduction](validation.md#checks-by-change)

### Protected three-market forced reduction

On native revision `1669a71b`, the comparator admitted 178 of 270 submissions and refused 92. The eight tests covered 12 named proposals under 12 orderings each, 54 seeded cases rotating the target market, 60 interconnected fractional books, one near-tick entry and 11 malformed proposal or position controls. The largest book held nine members. Each admitted schedule, remaining position size, exact recovery, whole cash movement, fee and reserve balance matched the independent fraction reference.

| Proposed action | Verified outcome in collateral atoms |
|---|---|
| Charge 10 on BTC while the winner owes 12 on ETH and 8 on SOL | Two of three opposite lots closed. The BTC flat creditor received 40. ETH and SOL kept 12 and 8, with zero insurance. |
| Raise the charge to 11 on the same book | Ordinary rounding still gives 12 and 8. The exact claims fall to 1044/89 and 696/89, so the comparison refused. At 20, holding both creditors whole would spend 3 of ETH insurance and 2 of SOL insurance. That alternative also refused. |
| Charge 40 after an account originally split SOL proceeds equally between BTC and ETH | The account recovered 150 on SOL. Its adjusted BTC debt was only 60, so it forwarded 60 to BTC and the remaining 90 to ETH. The market reserves contributed zero. |
| Ordinary rounding would transfer one atom away from each of two small creditors | The conserving whole-atom plan preserved the smallest creditor’s previous atom in both ETH and SOL. Each set of three creditors received 3/1/1. |

A separate Rust test rejected two individual minimums that each fit their own rounded claim but together required two atoms from a one-atom vault. These are native calculations on supplied frozen positions and claims. The signed case below measures on-chain selection and payment for one eligible pair. General schedule selection remains open. [Contract](../clearing/default-plan-verification.md#one-proposed-reduction-on-a-three-market-frozen-book) · [Reproduction](validation.md#checks-by-change)

### Signed three-market default and wallet exit

Five wallets deposited 6,405 test collateral atoms. The cross trader first closed a losing BTC trade against one isolated maker, leaving that maker flat with a 600-atom claim. It then opened ten lots in each of BTC, ETH and SOL against three other isolated makers. The three price updates left the cross trader with a 400-atom BTC claim, 2,800 cash and debts of 1,800 on ETH and 1,200 on SOL. The BTC debtor owed 1,000 and had 599 cash. BTC insurance held one atom from the signed fills.

| Member | Cash at freeze | Cash without a forced reduction | Cash after resolution and amount withdrawn |
|---|---:|---:|---:|
| Cross trader | 2,800 | 40 | 0 |
| BTC debtor | 599 | 0 | 0 |
| Flat BTC creditor | 1,000 | 1,360 | 1,400 |
| ETH creditor | 1,000 | 2,800 | 2,800 |
| SOL creditor | 1,000 | 2,200 | 2,200 |

At a 100-atom charge on one matched BTC lot, exactly 200 atoms of the BTC payment still flow through the cross trader to meet its remaining ETH/SOL debt. The flat BTC creditor receives the other 400 BTC payment atoms. At 101, the cross trader would receive only 179400/899 atoms, falling short by 400/899. This exact shortfall disqualifies the larger charge even though it is smaller than a whole token atom. BTC insurance spent one atom, ETH and SOL insurance spent zero, and five collected fee atoms remained in the SPL vault after all three wallet exits.

On revision `eed48e38`, 64 transactions finalized with RPC and WebSocket confirmation, including six SPL or signer setup transactions. Fresh PostgreSQL replay matched 58 program receipts. The independent fraction model on the reconstructed book enumerated the 400 charges through the BTC writeoff and admitted 100. All 18 signed refusals preserved the watched financial accounts, including a standing order at freeze, a roster omission, a wrong commitment, 99 and 101 charged atoms, a second application and an unauthorized withdrawal. A separate keeper signed the freeze and resolution alone.

| Successful transaction | CU | Wire bytes | Loaded accounts |
|---|---:|---:|---:|
| Freeze five members and three markets | 25,929 | 569 | 13 |
| Verify the maximum and settle all balances | 27,169 | 609 | 13 |
| Withdraw to one owner’s wallet, each of three | 13,001 | 550 | 10 |

That run used signed synthetic prices, whole-atom final transfers and one eligible pair. The two-winner case below extends the signed scope. Joint reductions, general fractional terminal settlement and a third venue market remain open. [Verification contract](../clearing/default-plan-verification.md#signed-three-market-default-with-one-eligible-pair) · [Reproduction](validation.md#checks-by-change)

### Competing winners in a three-market default

On native revision `1f6f1e6a`, independent enumeration on 31 frozen books and episode variants examined 602 allocations within the original lot and debtor budgets, including zero action. Of those, 535 preserved the foreign creditors and insurance. All 67 Rust selections, including reordered inputs, matched the independent winning charges, lot schedules and complete terminal settlements. Eighteen seeded cases varied which market defaulted, the side of the debtor, its cash, winner capacities and foreign reserves.

| Frozen book | Selected charges in atoms | What determined the result |
|---|---:|---|
| Equal winning positions, two debtor lots, 10 atoms recoverable | 5 and 5 | Each winner gave up one lot. The native search needed one candidate evaluation. |
| Same claims, one debtor lot, equal terms | 10 and 0 or 0 and 10 | Both schedules recovered 10. The frozen episode selected who bore it. Six fixed episodes exercised both outcomes. |
| One debtor lot, per-lot capacities of 3 and 6 | 0 and 6 | Only the second winner could absorb six atoms on that lot. |
| A winner owes five ETH and three SOL atoms | 4 and 6 | Five and five would lower exact foreign receipts to 35/8 and 21/8. The selected split preserved five and three and used only one BTC insurance atom. Three candidate evaluations sufficed. |
| Either one-atom charge harms a different foreign creditor | 0 and 0 | The original settlement was the only protected result. |

On a separate equal-capacity book with a one-million-atom writeoff, the native selector verified 500,000 atoms per winner, 50,000 matched lots each, in one candidate evaluation. That case checked its hand-derived optimum and complete reference settlement. The exhaustive 602-allocation count covers the smaller books. Search cost still depends on how many splits the actual lot and foreign protections exclude. The native search covers more books than the signed two-winner fixture below. [Contract](../clearing/default-plan-verification.md#two-winners-competing-for-the-same-debtor-lots) · [Reproduction](validation.md#checks-by-change)

### Signed two-winner settlement and withdrawals

Five wallets deposited 13,185 test collateral atoms. Six signed fills left the BTC debtor short two lots. The cross trader and an isolated maker each held one opposite lot and 120 atoms of eligible gain. The trader’s net BTC claim was 120 and the maker’s was 180, including earlier realized P&L. The debtor owed 300 BTC-market atoms. Its 289 cash and one BTC insurance atom left ten to allocate.

The cross trader owed 5,000 on ETH and 3,000 on SOL, with 7,884 atoms of funded cash. It therefore needed at least 116 from BTC. The table compares whole-wallet outcomes from the independent reference on that frozen book. The selected row is also checked through actual SPL withdrawals.

| BTC charge to cross trader / maker | Cross trader | BTC debtor | BTC maker | ETH creditor | SOL creditor | Reason |
|---|---:|---:|---:|---:|---:|---|
| No action | 0 | 0 | 1,174 | 7,000 | 5,000 | Ten BTC atoms remain written off in the baseline settlement. |
| 5 / 5 | 0 | 0 | 1,175 | 6,999 | 5,000 | Only 115 BTC atoms reach the cross trader. Both exact foreign entitlements fall. |
| 3 / 7 | 1 | 0 | 1,173 | 7,000 | 5,000 | Protects foreign creditors but another full recovery shares the charge more proportionally. |
| **4 / 6** | **0** | **0** | **1,174** | **7,000** | **5,000** | Recovers the ten-atom BTC writeoff, matches one lot per winner and preserves both foreign claims. |

All four rows use one BTC insurance atom. The accepted allocation changes how the BTC loss is recognized. Its three wallet amounts coincide with the no-action baseline on this book. The ETH and SOL insurance atoms remain available in the vault.

At `4348427c`, 70 signed originals finalized through local Surfpool RPC and WebSocket. All 21 refusals left the watched financial accounts unchanged. Fresh PostgreSQL replay reconstructed every one of the 64 program receipts, including six fills. Independent exact-fraction enumeration on that reconstructed book found 66 physically possible splits and 29 that preserved foreign creditors and insurance. The three withdrawals totaled 13,174 atoms. The remaining 11 comprised nine retained fee atoms and one atom each of ETH and SOL insurance.

| Successful transaction | CU | Wire bytes | Loaded accounts |
|---|---:|---:|---:|
| Freeze all five members and three markets | 34,370 | 569 | 13 |
| Verify both charges and settle the book | 35,632 | 617 | 13 |
| Withdraw to one owner's wallet, each of three | 13,003 | 550 | 10 |

On the same revision, a fresh single-winner regression matched 59 program receipts, refused the two-charge instruction on that freeze, reproduced the 100-atom charge and paid the original three wallet amounts. The five-member local fixture uses synthetic indices and one distressed market. Joint plans across distressed markets and activation of a third market remain open. [Signed contract](../clearing/default-plan-verification.md#signed-settlement-with-a-second-btc-winner) · [Reproduction](validation.md#checks-by-change)

### One settlement engine across market widths

Native revision `d2e1ca09` used the same settlement implementation at two, three, four, eight and twelve markets. The eight-market allocation and the twelve-market chain exercise different limits. The former lets one account owe seven destinations. The latter allows each member at most two occupied markets.

| Frozen book | Observed settlement |
|---|---|
| Four markets, one source of recovery and three destinations | The 150 recovered atoms covered 75, 60 and 15 of the frozen debts. The first market spent 25 of its own insurance. Creditor cash was 100, 60 and 15. |
| Four markets, simultaneous distress in the first two | Out of the nine combinations of charges from zero to two per target, charging two in each reduced impairment by one atom per target. The two outside creditors each received nine instead of eight at baseline, with zero insurance. Either two-atom charge alone refused. |
| A third creditor depends on a winner's own proceeds | The joint two-atom charges refused when they would deprive that creditor of its protected recovery. |
| Eight-market cycle | A closed cashless cycle offset every claim at par. With a four-atom outside creditor and one outside cash atom, all eight rates were exactly one quarter and the outside creditor received one. |
| Twelve linked markets, thirteen members | With 25 cash against the initial 100-atom debt, each market recovered one quarter and the final creditor received all 25 atoms. |
| Frozen economic inputs from the signed two-winner book | Of eleven full ten-atom splits, the protected ones charged the cross trader zero to four. Four and six was closest to proportional. The resulting cash and reserve spend matched the prior signed withdrawals. |

The reference compared 12 seeded four-market fractional books in three input orders. Across four joint books, 36 charge combinations and 16 reversed-order repeats matched independent exact settlement or refusal. Ten malformed inputs refused. The pre-existing two-market projections, three-market reference cases and 67 competing-winner selections also passed. On the same revision, separate signed repeats on the existing local fixture reproduced its single-winner and competing-winner SPL exits. Fresh PostgreSQL replay matched 59 and 64 program receipts, respectively. The general engine evaluates supplied plans in host memory. The signed local profile below verifies greatest rates and pays a bounded four-market book. Venue integration and broader books remain open. [Contract](../clearing/risk-and-resolution.md#settlement-across-a-frozen-set-of-markets) · [Reproduction](validation.md#checks-by-change)

### Signed market-indexed settlement

On revision `3155169c`, eight signed fills linked four markets. Each of two cross traders held a 500-atom open gain in one market, a 50-atom closed gain in the other and a 1,200-atom debt in a third. Two isolated makers each owed 550 with 548 funded atoms. All nine joint charge allocations satisfied the creditor protections. Only a two-atom concession on one lot in each defaulted market recovered all four atoms of the original shortfall. The two traders withdrew 348 atoms each, two other makers withdrew 1,500 each, and eight fee atoms remained in the vault. Those wallet totals also match the baseline on this symmetric book. The forced reductions remove four atoms of unpaid claims against the defaulted makers. Fresh PostgreSQL replay rebuilt cash, entry prices and claims from eight fills, reproduced the full rate witness, and reconciled all 72 successful or rejected program receipts with finalized RPC history and WS observations.

| Operation on local Surfpool | Members | Markets | CU | Signed bytes | Loaded accounts |
|---|---:|---:|---:|---:|---:|
| Authenticate trade accounts, verify nine allocations, apply balances and record matched lots | 6 | 4 connected | 119,619 | 821 | 15 |
| Read-only frozen example, nine allocations | 8 | 2 connected | 51,023 | 503 | 3 |
| Same member count, two further connected creditors’ markets | 8 | 4 connected | 73,394 | 687 | 3 |
| Same connected book, two additional flat members | 10 | 4 connected | 85,778 | 759 | 3 |
| Same member count, two members in a separate reciprocal-debt component | 10 | 4 connected + 2 | 111,322 | 971 | 3 |

The funded settlement carried a 153-byte rate witness encoding one denominator, one allocation index and 36 rate numerators with a vector length. Its separate 32-byte digest authenticated the book. The read-only instruction takes encoded inputs and returns terminal cash. On the original eight-member example it awarded the last two creditors nine each, and rejected both a standalone forced close and the inferior joint allocation. An independent control rejected a lower recovery even when both proposals paid wallets identically. The reciprocal-debt control refused a mathematically self-consistent zero rate when full offset at par was possible. The account-writing path also rejected an omitted market, substituted member, stale book digest, missing candidate, forged rate, inferior allocation and replay. Sixteen signed refusals preserved all watched financial state. On the same revision, the existing single-pair three-market flow reproduced its 1,400, 2,800 and 2,200 atom withdrawals and reconciled 59 program receipts.

That revision qualified a local test program with zero insurance and one debt destination per member. At eight members, two rows are empty in the two-market book and become linked creditors in the four-market book. At four markets the two extra members in the ten-member book are empty. Resource growth with populated members, many competing allocations, reserve clipping and fractional rounding still needs measurement before venue activation. [Contract and limits](../clearing/risk-and-resolution.md#signed-verification-across-market-ids) · [Reproduction](validation.md#checks-by-change)

### Insured settlement with two debt destinations

Thirteen signed fills on Surfpool created a three-market book with six margin accounts and one test collateral mint. One cross trader held 421 cash atoms, a closed source claim of 200, and debts of 504 and 756. A source maker owed 400 with 396 funded atoms. The winning plan charged four atoms on one profitable opposing lot. That brought the source market to par and let the cross trader forward all 200 recovered atoms.

| Step | First destination | Second destination |
|---|---:|---:|
| Frozen debt | 504 | 756 |
| Collection from the trader’s 421 cash atoms | 168⅖ | 252⅗ |
| Share of its 200 recovered atoms | 80 | 120 |
| Own market insurance used | 1 | 0 |
| Total exact resources for creditors | 249⅖ | 372⅗ |
| Whole atoms paid | 249 | 373 |

One creditor held 54 atoms of face claims in the first destination. Its exact recovery increased from 3,729/140 to 3,741/140 atoms. Ordinary deterministic rounding would have reduced its prior whole receipt from 27 to 26. Protected rounding preserved 27 and paid the other two creditors 67 and 155. The program calculated the repair and recorded that it used it. Diverting three atoms between markets while preserving the global total refused. Supplying the insurance account read-only also refused. All 14 refusals preserved every watched financial account.

Of 7,230 deposited atoms, four owners withdrew **2,263, 2,155, 1,227 and 1,573** (7,218 in total). The other two balances were zero. The three markets collected 3, 7 and 3 fee atoms. With the 25% insurance share tracked separately in each market, only the middle market had earned a whole reserve atom. It spent that atom. Twelve retained fee atoms remained in the vault. Fresh PostgreSQL replay reconstructed all 13 fills, checked the five charge allocations, verified the insurance debit and matched all 76 program receipts. The independent Python model and native Rust settlement agreed on each wallet and the three protected-market receipts.

At `de1b47f3` the insured settlement used **126,550 CU**, 724 signed bytes and 14 loaded accounts for five allocations. The same binary reproduced the earlier four-market wallet exits and its 72-receipt reconciliation. That nine-allocation transaction used **158,141 CU** and 821 bytes, compared with 119,619 CU on the narrower verifier at `3155169c`. These are per-settlement measurements on the two specified books. Focused host cases exercised a fractional reserve draw clipped from 3/8 to zero, a reduction that fills one destination before the other, and two debtors sharing a market insurance payment. The signed insured book spent a whole atom. Cases with no eligible reduction, competing winners or unresolved priority ties still need qualification before venue integration. [Verification contract](../clearing/risk-and-resolution.md#signed-verification-across-market-ids) · [Run commands](validation.md#checks-by-change)

### Residual settlement with open positions

A six-member local workload starts with three fully covered markets. A trader has 421 cash atoms and a closed claim worth 200 in the first market. Two price shocks leave it owing 504 and 756 in the other markets. The opposing makers still hold positions, but have closed their previous lots and reopened at the current price. Their outstanding claims survive and their new lots have zero eligible open gain. The remaining loss must be allocated to creditors after using the debtor's own resources and each market's insurance.

| Frozen outcome, collateral atoms | First debt market | Second debt market |
|---|---:|---:|
| Debt | 504 | 756 |
| Debtor's own cash plus recovered claim, before rounding | 248⅖ | 372⅗ |
| Own insurance spent | 1 | 0 |
| Exact uninsured loss | 254⅗ | 383⅖ |
| Whole atoms received by creditors | 249 | 373 |

On program and harness revision `d2dec1c9`, twelve signed fills produced this book. The first market paid the full 200 from its maker’s cash. After the loss of 638 atoms, the first debt market's three creditors received 67, 156 and 26 whole atoms. The other market’s creditor received 373. Settlement recorded zero forced charges and zero matched lots across all markets. Five owners separately withdrew 2,068, 2,156, 196, 1,226 and 1,573 atoms. The sixth owner’s cash was zero. These withdrawals plus the 11 retained fee atoms reconcile to all 7,230 deposits.

The successful transaction used **54,409 CU, 659 signed bytes and 14 loaded accounts**. The same keeper’s earlier attempt to settle the fully covered book refused before the shocks. All 17 signed refusal controls preserved the watched accounts, including a missing market, a forged full-recovery claim and a diversion between markets. Fresh PostgreSQL replay rebuilt the frozen book from finalized RPC history and reconciled 77 program receipts, the reserve debit and the wallet exits. The independent exact-fraction model and native Rust settlement agreed on every market movement and wallet.

On a separate signed book with an eligible four-atom concession, zero-charge settlement refused. The same binary accepted the winning reduction, preserved the creditor’s 27th atom and reproduced all four prior withdrawals. That settlement used 126,597 CU and 724 bytes. PostgreSQL reconciled 77 program receipts. A focused native test also refused residual settlement when insurance alone could cover the entire gap. Competing winners within a charged market and the wider venue path remain open. [Scoped run commands](validation.md#checks-by-change)

### Two winners on a four-market book

Seven signed fills on a fresh local Surfpool venue left a market maker short two lots, owing 300 atoms against 289 cash and one atom of its own market’s insurance. A cross trader and another maker each held one opposing lot with 120 atoms of eligible gain. The cross trader also owed three foreign markets 5,000, 2,000 and 1,000 atoms. At baseline those creditors were fully covered. The target market’s ten-atom writeoff was the largest possible recovery from a forced reduction.

| Charge to cross trader / second maker | Target loss removed | Effect on the three foreign claims | Result |
|---|---:|---|---|
| 5 / 5 | 10 | Exact receipts fall by ⅝, ¼ and ⅛ of an atom. The first creditor loses a whole atom after rounding. | Refused |
| 3 / 7 | 10 | All three claims stay paid in full. | Refused because 4 / 6 shares the charge more proportionally. |
| 4 / 6 | 10 | All three claims stay paid in full. | Accepted. Each winner concedes one lot. |

The independent Python reference and the native Rust financial engine agreed on all 66 physically possible allocations, including zero action. Twenty-nine preserved the creditors. The on-chain verifier checked the baseline and all eleven full-charge splits, since a charge below ten cannot recover ten. The signed transaction used **225,399 CU, 977 bytes and 15 loaded accounts** on `70ac71f5`. It recorded the two charges, lots and member identities, and debited one originating-market insurance atom. Four owners withdrew 1,174, 7,000, 4,000 and 3,000 test atoms. Two members had zero cash. Of the 15,186 deposited atoms, 12 remained in custody as ten retained fee atoms and two unspent foreign insurance atoms. Fresh PostgreSQL replay reconciled 62 program receipts. All fourteen signed refusal controls preserved the watched accounts.

On the same binary, the signed single-winner insured case reproduced the protected 27-atom receipt and all four withdrawals, reconciling 77 program receipts. Its settlement used 128,382 CU and 724 bytes. The two-market joint charge reproduced the 348, 348, 1,500 and 1,500 withdrawals on its four-market book, reconciling 73 receipts. Its settlement used 162,516 CU and 821 bytes.

A native scarce-lot case gave the debtor one lot even though two opposing winners could each absorb the whole charge. Across sixteen custody identities the verifier refused a split that spent the same lot twice, and both winners were selected in different final member-priority ties. The signed book exercised two available lots and a tie on recovery decided by proportionality. This local certificate covers full recovery with one competing pair of winners. Partial recoveries with competing winners, simultaneous competing markets and wider venue activation remain open. [Verification contract](../clearing/risk-and-resolution.md#signed-verification-across-market-ids) · [Reproduction](validation.md#checks-by-change)

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

### Direct credit with membership changes and competing fills

Clearing `984f18f3` and harness `ed673ae8` started with six makers, two traders and no settlement certificate. A trader’s ten-lot ETH round trip earned its maker 40 atoms. Collecting ten atoms from the trader funded the first payment. After a ninth member joined, a third party credited one atom to the maker in a single 1,029-byte transaction using 156,449 CU and 25 accounts. An adverse BTC move then blocked a second credit with nine atoms still in the ETH pool. The empty member left, BTC recovered and a new payment landed directly. Further loss collection supplied the remaining cash. The maker received all 40 atoms and withdrew exactly 40 to its SPL account. No certificate was created in the run.

Eight signed refusals preserved the financial accounts. They covered insufficient pool cash, missing checkpoints, missing or substituted lanes, a read-only recipient lane, an underfunded idle cross debtor, open-only BTC profit and an expired required BTC source. Finalized margin accounts matched the lanes after the join, after the exit and after withdrawal. Fresh PostgreSQL replay reconciled 263 events.

| Four BTC fill and ETH credit pairs per submission mode | Signed-to-confirmed fill, median | Signed-to-confirmed credit, median | Pairs landing in the same slot |
|---|---:|---:|---:|
| Submit the fill, then the credit after confirmation | 145.9 ms | 126.0 ms | 0/4 |
| Release both signed originals together | 151.3 ms | 145.8 ms | 4/4 |

All eight fills and eight paired credits landed. Each pair used separate fee payers and shared four conflicting accounts across its two transactions. These were the BTC market, its maker registration and the two coverage lanes written by the fill. Signed-to-confirmed timing includes preflight and the simultaneous-release barrier. This small test used local 50 ms Surfpool slots and zero priority fee. The [12-member cold-exit comparison](performance.md#automatic-payout-on-the-same-12-member-book) measures the scheduled worker. The [128-member check](performance.md#direct-payout-at-128-financial-members) covers full lanes. Sustained arrivals remain open. [Reproduce the run](local-development.md#qualifying-direct-profit-credits)

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


### Isolated maker capital for an inactive listing

At `5929eb48` with harness `5924e4c4`, a maker deposited 1,234,567 atoms,
published a SOL curve, and obtained joint owner/venue admission. Clearing stored
the SHA-256 of the deployed maker program data. The updater then repriced the
curve. A withdrawal returned all 1,234,567 atoms to the owner's SPL account and
restored the vault to its balance before the deposit.

The legacy BTC and ETH maker accounts could not initialize SOL curves. A second
listing with ID 258 could not use the curve for ID 2. A separately initialized
curve on the other maker program could quote the second listing, but clearing
refused to bind the same capital twice. Unfunded admission, a SOL order and
a SOL listing substituted into a BTC fill also refused. A control BTC fill
landed. The two independent clients decoded the new instructions and accounts,
and fresh PostgreSQL replay reconciled 103 events from 255 signed transactions.

### Partial recovery with competing winners

At `95df43f7` the four-market fixture recorded six signed fills. One trader
closed two winning lots and reopened one against a second maker. At the final
index, the debtor owed 300 atoms and held 289. The trader owned a 299-atom
claim, of which one atom belonged to the still-open lot. The second winner
owned one atom of open gain. Ordinary default began with eleven unpaid atoms.

Independent enumeration found four feasible allocations. The signed verifier
charged one atom to each winner, recovered two and settled the remaining
nine-atom loss under the existing rule. It refused to skip the reductions,
to charge an unavailable split and to use forged rates. Settlement took
62,949 CU, 716 bytes and 15 loaded accounts. The five solvent owners withdrew
8,180, 1,000, 2,000, 2,000 and 2,000 atoms. Six fee atoms remained in custody.
Fresh PostgreSQL replay reconciled 56 program receipts. This result covers a
partial recovery limited by the winners' eligible gain. Lot or creditor
constraints can still prevent a split from attaining that upper bound.


The same program repeated the full-recovery case. It refused 5/5 and 3/7,
accepted 4/6, and reproduced 62 program receipts and the original wallets.
The settlement used 226,597 CU in a 977-byte transaction.

### Competing winners in two distressed markets

On SBF revision `b5540580` and harness `1c92356d`, seven funded members traded
on four market IDs. Eight signed fills left two markets in default with two
eligible winners per debtor. Independent enumeration evaluated all 36 physical
allocations. Nine could reach both two-atom recovery ceilings. The program
verified the complete book and charged one atom to each winner in each market.
It refused an uneven split in either market and a proposal to skip both.

One settlement used 187,885 CU, 910 signed bytes and 16 loaded accounts.
Five owners withdrew 4,586, 1,001, 1,001, 2,000 and 2,000 atoms. Eight fee
atoms remained in the SPL vault and all four insurance balances were untouched.
PostgreSQL independently reconstructed the fills, both stored splits and wallet
exits from 66 finalized program receipts. The first replay read the new split
vector as the previous optional single record and failed after the wallets had
exited. The successful run repeated the entire workload on a fresh bank and
database. This establishes a bounded test-program settlement. Finding 11
requires the real clearing program to settle positions from the wider venue.

### Complete settlement inputs from venue clearing

On clearing `5929eb48` and harness `e44cad4e`, seven Financial accounts used
the deployed SPL vault and maker programs. A trader bought one BTC lot for
60,002 atoms and sold it to another maker for 60,998. The two 13-atom fees
contributed six atoms to BTC insurance and 20 to retained fees. Collecting
996 atoms of the short maker's loss moved cash into the BTC settlement pool.
Both the native settlement engine and the independent rational reference
gave identical terminal balances before and after this collection.

A signed price shock to 80,000 atoms per lot then froze the short maker
with 11,504 funded atoms and a 19,002-atom debt. The frozen roster, market
inventory, claims, settlement pools, fee split and 1,075,000 allocated vault
atoms reconciled. Before forced reductions, the BTC recovery rate was
6,253/9,999 with six atoms of BTC insurance and zero ETH insurance. The SDK
refused an omitted or duplicate member, an active book presented as frozen,
and a frozen book presented as active. Fresh PostgreSQL replay matched 117
events from 236 signed transactions. Those terminal values are calculations.
The signed on-chain effects in this workload end at freeze.

The preceding funded-book rehearsal at `58ec5340` reconciled 112 events without a
freeze. An earlier launch stopped before the workload because the native reference
example was built without its required Cargo feature.


### Checking the protected plan on the funded venue

Clearing `a094f62c` and harness `cab2dfbf` froze seven real margin accounts after BTC moved to 80,000. The market already held 996 collected collateral atoms. The debtor could supply 11,504 atoms and BTC insurance could supply six. Initial entitlements were payable at 6,253/9,999. Reducing the opposing open gain by 7,492 atoms restored full recovery of the remaining claims. The signed result returned 0 for the debtor, 24,010 for its counterparty, 12,500 each for four other makers and 1,000,970 for the trader. Combined entitlements and the 20 retained fee atoms reconcile to the 1,075,000-atom vault.

The read-only transaction used 66,981 CU, 882 bytes and 21 loaded accounts. Missing or substituted members, a stale episode, a forged rate, skipped recovery and surplus witness data all refused. The independent legacy Anchor client matched the instruction encoding. The workload finalized 243 signed transactions, and fresh PostgreSQL reconciliation matched 117 financial events. Actual balances were unchanged after the preview. Wider-market fills and application to the venue wallets remain open.
