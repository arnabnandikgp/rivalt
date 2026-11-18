# Liquidation and loss handling across perp venues

Research accessed 17 November 2026. **Discussion, not an approved successor
contract.** Rivalt comparison baseline: `07822f49dc9785989897f69d5361ea90717fdc11`.
The [architecture review](architecture-review.md) owns the implementation findings
and contract agenda; current accounting/risk specifications remain normative.

## Scope and evidence

This review distinguishes removing exposure, supplying temporary risk-bearing
capital, paying an existing deficit and allocating an unpayable remainder. The
same institution can perform several roles, but those operations are not equivalent.
An insurance reserve cannot buy inventory unless an explicit trading account and
authority permit it; reducing positions does not necessarily erase old debt.

Sources below are official documentation, except the explicitly identified academic
research. These describe intended mechanisms, not independently verified deployed
code, current reserve balances or stress survival. Targeted secondary searches for
Phoenix/Pacifica insurance and BULK risk-vault funding did not establish missing
primary specifications. Unknown is not evidence that a mechanism does not exist.
No external tests, audits or performance benchmarks were reproduced.

## Execution and liquidation comparison

| Venue | Execution structure | Documented exposure removal and final loss handling |
|---|---|---|
| Hyperliquid | CLOB on HyperCore | Book liquidation precedes HLP takeover; cross takeover includes cross positions and margin, isolated takeover only that allocation. Negative value triggers opposite-side ADL ranked by profit/leverage at the previous mark. Its docs explicitly exclude accounts without open positions from loss socialization. [Liquidation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations), [ADL](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/auto-deleveraging) |
| BULK | CLOB in a specialized execution layer alongside Solana | Portfolio liquidation selects reductions using closeout costs. Protocol acceptance precedes subsequent protected market execution. ADL distinguishes capacity underfill from monetary shortfall: mark-price reduction for the former; selected winners' entry-price closure with mark-valued offsets for the latter. Profit/leverage scores determine proportional quantities. A risk vault covers configured loss shares and unallocated shortfall. [Liquidation](https://docs.bulk.trade/bulk-exchange/Liquidations), [ADL](https://docs.bulk.trade/bulk-exchange/ADL) |
| Phoenix perps | One matching view combines FIFO orders and maker splines | Risk tiers permit cancellation, market reduction, backstop transfer and opposite-side profitable-position ADL. Partial market liquidation must improve health or close the position. Backstop accounts subsequently unwind inventory. Published material does not specify the complete ADL score/price or insurance waterfall. [Matching](https://docs.phoenix.trade/phoenix/matching-engine/matching-engine), [liquidation](https://docs.phoenix.trade/phoenix/margin-and-risk/liquidations) |
| Lighter | Orderbook on an application-specific ZK rollup | Cancel orders, execute IOC reductions, then LLP takeover subject to LLP initial-margin capacity; otherwise ADL. Matching ADL accounts requires compatible zero prices and uses leverage/PnL priority. The text defines a bankrupt account as retaining an open position. [Liquidation](https://docs.lighter.xyz/trading/liquidations-and-llp-insurance-fund), [architecture](https://docs.lighter.xyz/about-lighter/technical-architecture-lighter-core) |
| Variational Omni | RFQ; OLP is the sole counterparty, with bilateral user–OLP pools | Either party failing margin closes both sides of that bilateral position. OLP liquidation is described as ADL; the user receives a liquidation reward. This is counterparty closeout, not a venue-wide queue charging unrelated winners. OLP insolvency can still leave subsequent realized/unrealized PnL unpaid. [Counterparty liquidation](https://docs.variational.io/omni/trading/automatic-deleveraging-counterparty-liquidation), [OLP](https://docs.variational.io/omni/the-omni-liquidity-provider-olp) |
| Pacifica | Orderbook | IOC chunks, then backstop transfer below two-thirds maintenance margin, then profitable opposite-position ADL for negative equity with open exposure. Some markets lack backstop coverage. Published liquidation docs do not give a complete ADL pricing/ranking formula or insurance funding rule. [Liquidation](https://docs.pacifica.fi/trading-on-pacifica/liquidations) |

ADL therefore does not always mean the same trigger or the same economic charge.
Capacity exhaustion can require forced closure even without an existing monetary
deficit. Conversely, a flat unpaid obligation needs loss resolution even though no
position remains to deleverage. Do not collapse both cases into one status flag.

## Capital, scope and assumptions that must not be imported silently

| Venue | Capital / scope evidence | Consequence for this comparison |
|---|---|---|
| Hyperliquid | Community HLP capital bears strategy PnL, performs liquidations and receives part of trading fees. Cross margin credits positive unrealized PnL. HIP-3 deployers provide their own DEX backstop strategies. [HLP](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/protocol-vaults), [margin](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining), [HIP-3](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals) | HLP is active risk capital, not just a ring-fenced cash reserve. Core coverage is not universal across deployed markets. |
| BULK | Portfolio margin incorporates correlations and execution impact. Public ADL text identifies a risk vault but does not establish its available capital, replenishment or terminal exhaustion rule. [Margin](https://docs.bulk.trade/bulk-exchange/Margin) | Whole-account candidate evaluation is useful; correlation credit and an apparently unlimited residual vault are not justified for Rivalt. |
| Phoenix | Effective collateral includes weighted spot holdings, positive-PnL factors and negative claims. [Margin math](https://docs.phoenix.trade/phoenix/margin-and-risk/margin-math) | Explicit equations are useful. Spot conversion and positive-profit collateralization would change our economics. |
| Lighter | The insurance fund is a specialized public pool with a designated operator; participants contribute capital. [Whitepaper](https://assets.lighter.xyz/whitepaper.pdf), [public pools](https://docs.lighter.xyz/trading/public-pools) | A position-taking pool differs from passive loss coverage. Pool investors need their own capital/exit contract. |
| Variational Omni | OLP began with team seed capital; community deposits are described as intended. Bilateral pools cannot transfer/net positions across pools. [Capital](https://docs.variational.io/omni/the-omni-liquidity-provider-olp), [settlement pools](https://docs.variational.io/variational-protocol/key-concepts/settlement-pools) | Containment comes with counterparty attachment. Copying it would remove Rivalt's open-with-A/close-with-B common-clearing property. The generic RFQ protocol and Omni's single-provider product are distinct. |
| Pacifica | Unified margin includes spot collateral and implicit USDC borrowing; subaccounts remain separately margined. A money market supplies financing and has its own deleveraging. [Unified margin](https://docs.pacifica.fi/trading-on-pacifica/unified-margin), [money market](https://docs.pacifica.fi/trading-on-pacifica/money-market) | Borrowing can finance settlement but creates another creditor/loss system. It does not prove a no-borrowing clearing engine can pay the same obligations. |

These pages do not establish a common industry rule taxing every flat unpaid
creditor. Equally, documentation describing only open-position ADL does not prove
that every venue protects all closed claims under every failure. Hyperliquid's
explicit flat-account invariant is a useful design target, not evidence that
Rivalt already satisfies its preconditions.

## Implications for Rivalt

The previous suggestion of proportional impairment across open and closed unpaid
claims remains a comparison candidate, **not the presumed successor baseline**.
The research strengthens the case for defining settlement finality first.

| Question | Recommended design direction to specify and compare |
|---|---|
| Must we change the execution product? | Keep competing margined makers and common clearing. Add permissionless forced reduction through admitted maker quotes; preserve independent risk valuation, exact authority, financial checks and two-maker atomic execution. |
| What is a backstop? | A separately funded, consenting inventory receiver with position/notional limits and a defined unwind policy. Keep its cash, rewards and subsequent trading PnL separate from market insurance. A public passive pool is not a prerequisite. |
| When should insurance pay? | After attributing an actual eligible deficit and accounting for debtor resources. Available eligible insurance may cover the entire deficit; the existing 25% fee contribution is not a 25% claim-coverage limit. Do not spend another market's reserve implicitly. |
| Who absorbs the remainder? | Compare position-targeted ADL as the normal last exposure-removal mechanism with explicit exceptional resolution of unpaid obligations. Do not assume ADL eliminates flat debt or can fund more than the eligible counterparties can bear. Selection, price and charge limits must be one conserving transition. |
| What does closing guarantee? | Distinguish zero position, flat-but-unsettled and fully settled. Target protection of fully funded, discharged balances from subsequent defaults. A final close must settle or durably bind its obligations; it cannot erase a debtor or let a creditor outrun an already-bound loss. |
| How local is resolution? | Start from the debtor and attributable market losses, but prove closure over shared debtors and claims. Cross-account cash is counted once. Smaller pauses are a goal, not proof that cross-market links disappear. |
| How much liquidation is enough? | Choose bounded reductions using whole-account health after accrued funding, reservations, execution costs and fees. Stop at a specified recovery target; a receiver must also remain admissible. Cost estimates inform selection, not maker-controlled risk prices. |
| Which precision / ADL score? | Compare deterministic priority and proportional allocations against independently calculated outcomes. State rounding ownership, bounded loss overshoot, tie-breaking and account-splitting behavior. Do not inherit a queue simply because a large venue uses it. |

For a **proposed** deficit episode, after recognized debtor recoveries:

```text
insurance_used = min(eligible_deficit, authorized_available_market_reserve)
residual = eligible_deficit - insurance_used
residual = assigned_loss + still_unresolved_loss
```

These are conservation requirements, not a substitute for cross-market attribution
or the present simultaneous settlement algorithm. If ADL already assigns a loss,
that amount cannot be charged again to unpaid creditors. If capacity is exhausted,
the remaining liability must stay explicit; no success-returning fallback is valid.

## Mathematical and operational acceptance

One next contract/model deliverable should establish:

1. **State machine:** normal, restricted, liquidating, receiver-held, resolving and
   finalized; separate exposure state from debt/claim state. Include authenticated
   snapshots, activation authority, oracle outage and restart behavior.
2. **Conservation:** cash buckets reconcile to custody; trades/ADL preserve paired
   exposure; loss and insurance entries balance exactly, including fractional atoms.
3. **Finality:** no unfunded debt disappears with its last position; no transfer,
   close or withdrawal evades a bound deficit; no later event retroactively taxes a
   genuinely discharged account. Compare how each candidate funds this promise.
4. **Risk and liveness:** after-fee progress, no position flips, no inadmissible
   receiver, complete attribution and bounded continuation. Explicit terminal behavior
   for empty insurance, absent candidates, flat debt, shared cross debtors and cycles.
5. **Economics:** separately measure keeper SOL costs, backstop inventory losses,
   revenue and insurance depletion under stressed liquidity. Fee income is not a
   reserve-adequacy proof. Current 2 bps / 25% terms yield 0.5 bps to insurance before
   losses; seed capital and exposure limits still need calibration.
6. **Implementation:** map equations into independently testable accounting, risk,
   liquidation and resolution modules, then thin program/worker adapters. Independently
   derive golden cases before real SBF/RPC/WS/PostgreSQL acceptance and new lock/CU
   measurements. No historical qualification transfers automatically.

Academic work reinforces why ADL selection deserves modeling:
[Autodeleveraging as Online Learning](https://arxiv.org/abs/2602.15182) studies
solvency budgets and excessive profit liquidation;
[Risk-Based Auto-Deleveraging](https://www.math.columbia.edu/~mnutz/docs/Risk_Based_ADL.pdf)
studies risk-minimizing selection and explains why a single-asset leverage rule
does not directly generalize to cross portfolios. Abstracts/introductory results
were inspected; proofs and empirical reconstructions were not reproduced. Neither
paper approves correlation discounts or supplies a drop-in Rivalt algorithm.

Runtime architecture also limits portability. [BULK](https://docs.bulk.trade/architecture/overview)
uses native execution beside Solana; [Lighter](https://docs.lighter.xyz/about-lighter/technical-architecture-lighter-core)
uses sequencer/prover execution and an exceptional global escape freeze. Their
mechanisms do not prove ordinary Solana account-write parallelism or eliminate
Rivalt's shared market/ledger contention. Treat that as a separate workstream.

## Handoff

The 17 November survey informed the following day's
[loss-policy decision](../DECISIONS.md#d112--capped-adl-and-proportional-residual-recovery).
The [clearing roadmap](roadmap.md) tracks the remaining eligibility and execution
work. The survey supplies venue comparisons only. P15B/P16B remain external
gates and continuous 24-hour endurance remains deferred.
