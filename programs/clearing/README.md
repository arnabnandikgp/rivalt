# Clearing program source map

The clearing program owns collateral, participant accounting, execution authority,
funding, orders and risk transitions. `financial-core` supplies checked arithmetic;
off-chain services submit transactions but cannot override these rules.

```text
src/
  lib.rs                 Program IDs and public instruction entrypoints
  constants.rs           Versions, test-profile bounds and deployment bindings
  error.rs               Published error codes
  events.rs              Critical event schemas and event snapshot types
  pyth_core.rs            Authenticated sponsored Pyth account decoding
  state/                 Persistent accounts and their serialized nested types
    market.rs            Market configuration and cash pools
    participant.rs       Owner/market balances, position and registry
    maker.rs             Maker authorization and capital binding
    route.rs             Risk observation and aggregate exposure
    oracle.rs            Source/funding observation state
    order.rs             Stored orders and protective groups
    settlement.rs        Complete-cohort exit certificate
    resolution.rs        Frozen cohort header and participant rows
    probe.rs             Nonfinancial SDK/RPC conformance record
  instructions/          Anchor account contexts, handlers and validation
    custody.rs           Register, deposit, custody-only withdrawal and controls
    makers.rs            Register, approve, sync, quarantine and preview makers
    routes.rs            Immediate and stored-order atomic execution
    orders.rs            Place, replace, cancel and manage protection
    settlement.rs        Cohort scan, collect, settle and trading withdrawal
    risk.rs              Funded receiver liquidation
    oracle/
      mod.rs             Source validation, sampling and funding/action policy
      impact.rs          Complete-maker depth sampling and bounded allocation
    resolution/
      mod.rs             Freeze, advance and authorized recovery
      ledger.rs          Per-row allocation and resolution stage transitions
      tests.rs           Serialized state-machine boundary checks
    probe.rs             Nonfinancial conformance handler
```

For a trade, read `lib.rs::execute_route`, `instructions/routes.rs::execute_core`
and `finish`, then `financial-core/src/route.rs` and `Participant::admissible` in
`financial-core/src/lib.rs`. The route checks the trader and each maker's capital
separately. Persistent order reservations are refreshed before final admission.

For an exit, read `instructions/settlement.rs::check` and `withdraw`. A complete
cohort solvency certificate and the withdrawing participant's post-action margin
are separate requirements. Resolution uses its own frozen accounting ledger.

Account fields, instruction arguments, discriminants, PDA seeds, error codes and
event layouts are wire contracts. Moving their Rust definitions must not rename
or reorder those fields. Keep generated SDK files generated, and verify fresh
IDL output against the committed SDK after program refactors.

Use domain names such as `participant`, `registration`, `route_state`, `header`
and `funding_index` in implementation code. `ctx` is retained in clearing handlers
because Anchor's `emit_cpi!` macro refers to that identifier. Rust lifetimes and
generic type parameters are not financial variable names.

The explicit exports in `instructions/mod.rs` expose Anchor's generated client
and CPI account modules without glob-exporting similarly named handler helpers.
Program state and events are re-exported at the crate root for Anchor/IDL clients.
