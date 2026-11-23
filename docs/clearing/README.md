# Clearing

Clearing is the on-chain authority for custody and financial transitions. The
framework-independent Rust financial core performs checked arithmetic; backend
workers request transactions and cannot create balances or override admission.

A **portfolio** is an owner's namespace. A **margin account** owns one funded cash
balance and up to two market positions. Isolated accounts permit one immutable
market; cross accounts combine negative claims and risk requirements across both.
Other subaccounts do not implicitly guarantee its debts. Maker capital is always
isolated to one market.

A **venue** binds identities, mint and authorities. A **market** owns its price,
funding and terms. Each market has separate settlement, insurance and retained-fee
buckets. Shared custody reconciles those buckets with actual SPL tokens; safety
coordinates the complete venue when shared debtors require exceptional resolution.
Users do not choose a technical clearing group.

Read [accounts](accounts.md) for identities, layouts and authority;
[accounting](accounting.md) for money, funding, fees and ordinary exits;
[risk and resolution](risk-and-resolution.md) for sources, orders, liquidation and
complete default. Maker execution pricing belongs to [liquidity](../liquidity/README.md).

## Source map

- [State](../../programs/clearing/src/state/accounts/) and [maker/publisher state](../../programs/clearing/src/state/liquidity.rs).
- [Custody](../../programs/clearing/src/instructions/account_custody/),
  [orders/engine](../../programs/clearing/src/instructions/account_trading/),
  [cash/claims](../../programs/clearing/src/instructions/account_cash/),
  [liquidation/default](../../programs/clearing/src/instructions/account_safety/).
- [Shared transition engine](../../programs/clearing/src/engine/),
  [financial core](../../crates/financial-core/src/) and
  [independent expectations](../../tests/financial/).

### Trace a financial transition

| Action | Financial rule | Where clearing enforces it |
|---|---|---|
| Open or close a position | [Route accounting](../../crates/financial-core/src/route.rs) accrues every participant, applies matched inventory and quote deltas, and charges the cumulative taker fee. | [Route engine](../../programs/clearing/src/engine/routes.rs) checks order reservations and whole-account admission before committing the candidate. |
| Force a reduction | [Liquidation](../../crates/financial-core/src/liquidation.rs) owns the adverse maker price, post-fee progress and paired funded receiver transfer. [Risk engine](../../crates/risk-engine/src/lib.rs) supplies equity and maintenance requirements. | [Maker route](../../programs/clearing/src/instructions/maker_liquidity/routes/liquidation.rs) checks a forced fill. [Receiver adapter](../../programs/clearing/src/engine/risk.rs) checks sources, consent through its caller, receiver margin and strict progress. |
| Turn a claim into cash | [Settlement](../../crates/financial-core/src/settlement.rs) books whole atoms against the originating pool. Collection checks cash against all negative market claims. | [Claim handler](../../programs/clearing/src/instructions/account_cash/claims.rs) authenticates the backing certificate. [Cash adapter](../../programs/clearing/src/instructions/account_cash/engine.rs) refreshes the account, checks post-payment margin and advances its guards. |
| Allocate a frozen shortfall | [Default settlement](../../crates/financial-core/src/clearing/) computes market-attributed recoveries. | [Resolution controller](../../programs/clearing/src/instructions/account_safety/settlement/) authenticates the frozen members, verifies the plan and applies balances. |

The fresh local venue uses schema-10 clearing accounts under profile 6. Paged membership records identities. Pre-funded recovery storage limits how many Financial roots can activate. The launcher provisions 128. [Accounts and custody](accounts.md) · [Deployment](../operations/deployment.md)
