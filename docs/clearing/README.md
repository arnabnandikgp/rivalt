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

The current runtime uses schema-3 financial accounts under immutable profile 4.
Older profiles still exist in source. Current definitions now have canonical names and shared records live in
`state/records.rs`. Shared reservation, route, funding and liquidation transitions
now live in `engine/`; current and retained group handlers call those same functions.
The in-memory adapters still use the historical scalar records until P37 retires
the prototype runtime. This intermediate extraction does not complete retirement.
No existing bytes acquire different economic semantics. Only the explicit
qualified local artifact activates this implementation; default/devnet gates remain.
