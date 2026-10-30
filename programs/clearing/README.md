# Clearing program

Clearing owns custody, account authority and financial transitions. Start with the
[current clearing contract](../../docs/clearing/README.md). Backend workers request
transactions; they cannot create balances or override on-chain admission.

```text
src/
  lib.rs                     Public instruction dispatch and explicit wire discriminators
  constants.rs, error.rs      Limits and stable error codes
  events.rs, event_cpi.rs     Critical financial snapshots and bounded event encoding
  pyth_core.rs               Authenticated Pyth account decoding for the gated adapter
  state/
    accounts/                Venue, custody, roots, ledgers and complete-default state
    liquidity.rs             Maker registry, registration and funding publisher
    identity.rs, records.rs  Shared identity, position and order records
    oracle.rs, order.rs      Source/funding state and durable order terms
  engine/                    Shared isolated/cross financial candidates
    account.rs, authority.rs Whole-account funding, guards and delegates
    book.rs, book/           Reservations and existing-position protection
    routes.rs, risk.rs       Atomic route candidates and liquidation progress
    oracle.rs, sources.rs    Causal funding and authenticated source checks
  instructions/
    account_custody/          Identity, actual SPL custody and authorized pause
    account_trading/          Current identity adapters, orders, source setup, activation
    account_cash/             Own-cash exits, market certificates and explicit claim settlement
    account_safety/           Consenting liquidation, complete default, recovery and retirement
    maker_liquidity/          Maker gateway, bounded CPI, execution and restricted funding reports
```

For trading, follow `maker_liquidity::routes::execute` through the shared engine
and `financial-core`. Both isolated and cross accounts use the same candidates;
every trader/maker account retains complete admission. For cash exits, read
`account_cash::cash`; for claims, read its `claims` and `certificate` modules.
Resolution is market-attributed and complete-cohort under `account_safety`.

Only the explicit local `liquidity-execution-qualification` feature activates the
current profile. Default/devnet remain gated. Historical runtimes are recoverable
at the immutable baseline in [HISTORY](../../docs/HISTORY.md); this source removal
is not an account migration or deployed-program upgrade.

Discriminators, ordered fields, numeric schemas, seeds, metas and error codes remain
wire contracts. Generate IDL/SDK outputs from source and compare the retained
[wire manifest](../../tests/fixtures/wire-contract.json). Layout checks do not prove
SBF resource fit or economic correctness; [validation](../../docs/operations/validation.md)
and [STATUS](../../docs/STATUS.md) record the actual acceptance boundary.
