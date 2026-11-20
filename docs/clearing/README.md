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
The [architecture review](architecture-review.md) records the November 2026
comparison and proposed functional boundaries; it does not replace these contracts.
Its [venue comparison](venue-comparison.md) separates documented liquidation,
backstop and loss-allocation mechanisms from candidate Rivalt changes.

The [clearing roadmap](roadmap.md#functional-ownership) maps today’s source to the
risk engine and other financial domains. The [risk source map](risk-and-resolution.md#risk-equations-in-code) traces a withdrawal or liquidation to its admission check.

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

The account-scale RC2 local profile uses schema-10 clearing accounts under immutable
profile 6, paged Financial membership and maintained ordinary-payment backing.
Its launcher provisions recovery capacity for 128 Financial roots; registration
identity and pages are separate from qualified financial capacity. Earlier
deployments retain their original clients, domains and journals.
Qualification and integration are recorded in STATUS and validation. Shared records live in `state/records.rs`; `engine/` uses
current account records directly for both isolated and cross accounts. The earlier
standalone/group/fixed-maker runtimes are retired, with historical reproduction
pinned in [HISTORY](../HISTORY.md). This is source retirement, not a deployed-account
migration. Only the explicit qualified local artifact activates financial actions;
default/devnet gates remain. [STATUS](../STATUS.md) distinguishes source completion
from qualification of rebuilt artifacts.
