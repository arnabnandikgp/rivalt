# Project status

The fresh local demo trades BTC and ETH with one test collateral mint. It uses
synthetic prices and three internally operated maker instances per market.
Default and devnet builds keep these trading paths disabled. The following
qualifications used separate program and harness revisions.

| Deployment or workload | Integrated result | Boundary |
|---|---|---|
| Fresh demo, `bounded-entry` | Isolated and cross accounts share clearing. Each immediate trade can fill against one or two makers. Reducing a position makes the closed quantity's gain eligible for backed payment. | Two inline market slots per margin account. Maker capital stays isolated by market. [Accounts](clearing/accounts.md) · [Settlement](clearing/accounting.md#ordinary-payouts-on-closed-quantity) |
| Wider local routing | The wallet discovered up to 32 maker registrations. One signed order filled atomically across eight funded makers. | Clearing chooses among the signed candidates. An omitted maker or a binding admission check can change the attainable price. [Routing](liquidity/routing.md#wider-atomic-fills) |
| Grouped BTC/ETH payout | On a 1,000-member book the worker paid closed profit and the owner withdrew during competing fills. Clearing also refused payment while an idle debtor lacked backing. | Group bounds depend on current prices. A stressed book can require individual row checks. [Measured costs](operations/performance.md#payout-with-incremental-debtor-groups) |
| Funded BTC/ETH/SOL venue, `listed-venue-default` | A single funded cross account held positions in all three markets. Fully insured and residual-loss episodes settled and owners withdrew. Finding 11 closed for this profile in [PR #250](https://github.com/arnabnandikgp/rivalt/pull/250). | The verifier admits at most 12 financial members and eight market columns, with bounded claims and plan search. An unsupported frozen book can remain frozen. General wider admission is open under Finding 10. [Verifier contract](clearing/default-plan-verification.md#default-on-a-funded-venue-with-a-listed-market) |

## Next action and open gates

Prepare a reproducible mixed-wallet trace for **Finding 6**. Finding 7 will reuse
it with independently timed maker and oracle updates. Finding 9 tracks actual
participant costs. Findings 5 and 8 are deferred to the combined shock and
recovery exercise. The [scorecard](operations/qualification-scorecard.md) gives
the acceptance criteria for each finding.

P15B requires an independently operated maker to reconcile and exit. P16B
requires independent review, risk calibration and authorization for a funded
pilot. The continuous 24-hour endurance run remains deferred.

**Verification baseline.** The funded default results use clearing `69c2f5d5`
and harness `49623912`. Scoped PR checks merged in [PR #251](https://github.com/arnabnandikgp/rivalt/pull/251)
at `ef9ba31a`. Use the [validation guide](operations/validation.md) to choose
between host checks and signed qualification.
