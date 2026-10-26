# Product and scope
Rivalt · baseline R1 · 20 October 2026

## Product objective

Offer traders a common perp position that can open against one maker and close against another, with competing executable prices, predictable fees and explicit settlement/risk rules. Makers supply programmable liquidity against their own posted margin. Rivalt operates the common market contract, routing and user experience.

The engineering objective is a reproducible local venue, followed by focused devnet parity, using test assets. Real independent maker economics and repeat customer choice determine later commercial viability.

## Selected scope

The table below remains the V1 engineering MVP. D45–D48 authorize a fresh bounded
schema-2 successor: BTC and ETH, one test mint, owner portfolios with isolated or
two-position cross margin accounts, and common clearing-group settlement/default.
[P17](P17-MARGIN-CONTRACT.md) specifies the account/authority/risk contract and
P17–P21 deliver it. Maker capital remains isolated per market. Cross trading stays
disabled until its liquidation/default acceptance. Multi-collateral borrowing,
correlation discounts and live mode conversion remain excluded. This does not
reclassify existing implementation evidence or close P15B/P16B.

| Dimension | Baseline |
|---|---|
| Market/collateral | One BTC perpetual; one six-decimal classic SPL test USDC-like mint |
| Margin and liability | Isolated participant accounts under one common market; each maker owns and funds its inventory |
| Programs | Clearing with routing entry points; separately deployed Maker A and Maker B |
| Routing | Off-chain consistent-snapshot selection; one or two distinct makers per transaction |
| Immediate orders | Exact-base FOK: all selected legs commit or all venue effects revert |
| Persistent orders | Limit, cancel/replace, reduce-only close and standalone stop-limit; partial fills across successful atomic subfills |
| Protective orders | TP/SL pair on an existing position, shared reduce-only allowance and position generation |
| Risk | Index-derived valuation with source safeguards; no positive unpaid-profit margin credit |
| Prices shown | Actual execution VWAP/per-leg prices; trade candles from actual fills; separate index/risk overlays |
| Fees | Flat 2 bps taker and 0 bps provider-side maker fee; one venue fee |
| Admission/capacity | Explicit maker registry; two reference makers in the initial lab; 64 total participants and four order slots per participant |
| Exceptional failure | Pause, complete-cohort valuation/collection/insurance/unpaid-profit impairment and explicit recovery |
| Exit | Immediate admissible funded withdrawal through SDK even when venue API is down; no withdrawal-queue promise |

64 includes traders, makers and liquidators registered in that market. System cash pools are not extra uncounted trading accounts. The test profile is a capacity bound, not evidence of scale. A two-leg route limit is distinct from a future registry expansion.

## Excluded from the engineering MVP

Cross-margin, portfolio margin, multiple markets, public LP deposits, pooled maker capital, separate provider-specific contracts, traditional user-to-user matching, arbitrary routing search, signed private RFQs, general IOC, entry-linked bracket growth, trailing stops, delegated trading sessions, token/airdrop/points/staking mechanisms, active volume discounts, builder/referral commissions, automatic maker rebates and continuous ADL.

The off-chain liquidity view can look like a book. It is not a conventional price-time CLOB or on-chain matching engine.

## Customer flow

Connect wallet → deposit test collateral → request a size/side quote → inspect aggregate price/fee and split → sign → observe chain outcome → manage position/orders → close → settle eligible funded profit → withdraw.

Show pending, confirmed and finalized outcomes separately. “Order submitted” does not mean filled or cancelled. A stop trigger authorizes an attempt; liquidity, price limits, health and source validity still govern execution.

Show funded collateral, unpaid P&L, risk equity, reserved margin and currently withdrawable cash as separate values. A flat position may retain an unpaid profit claim. Maker outages, source failures, insufficient margin and settlement delays have explicit reasons.

## Economics

2 bps = 0.02% = 200 ppm of executed notional, charged on both opening and closing executions. A 10,000-token execution incurs 2 tokens of venue fee before network costs. The maker's spread is embedded in its executable price. Funding belongs to position holders under the common contract, not to the operator.

A user limit order still takes maker liquidity and pays taker fees. A registered maker executing an aggressive rebalance also pays taker fees. Clearing derives the role from the execution path, not a caller-supplied exemption.

No protocol quote, cancellation or maker admission tariff. Makers pay their own pricing-update transactions and operations by default. User-initiated transactions are user-funded by default. Keeper maintenance and any sponsored execution use explicitly funded operator budgets; there is no hidden deduction from user collateral. Budget/payee details are a P06 gate.

For the test MVP, collected trading fees go entirely into the protocol fee balance T. Insurance I is separately seeded and recorded as injected capital. No automatic fee-to-insurance percentage or rebate is selected; future reserve allocation requires an explicit decision and transition. T is not automatically available in the loss waterfall. Treasury withdrawal requires program authorization and the applicable market gate.

## Maker onboarding

Initial software qualification is operator-controlled and disclosed. For the lab, operate A and B with distinct program IDs, configuration/capital keys, funded accounts and daemon processes. Different keys under our control are not independent economic operators.

Qualification checks: interface/quote parity, capital binding, inventory/capacity limits, stale parameters, key rotation, hostile accounts, bounded computation, atomic rollback and clean deregistration. Deregistration stops new quoting but cannot erase inventory, debt or obligations.

A future independent maker receives SDK/examples, risk/settlement/default terms, scoped permissions, test environment and clear exit rules. Custom pricing programs require review. M6 collects genuine independent quote/fill/hedge/capital/cost evidence. No listing fee, guaranteed flow, hidden routing preference or implied bailout.

## Success and limits

Engineering north star: completed and exactly reconciled trade lifecycles under normal and fault conditions. Improve correctness/exits, then reliability, execution quality, maker capital economics and measured scale.

Commercial north star: weekly executed volume from returning independent traders without promotional subsidies, guarded by competitive all-in costs, maker sustainability, reliable exits and venue contribution. Returning means active this week with a qualifying trade in the preceding 28 days. Internal bots, known wash activity and subsidies are excluded and separately reported.

This metric is unestablished until real users exist. Passing local tests proves neither PMF nor production safety.

