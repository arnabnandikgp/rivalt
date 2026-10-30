# Maker liquidity

Makers supply executable prices against isolated capital in Rivalt clearing.
The two maker programs share configurable curve math; an instance ID identifies a
capital/configuration, not a hard-coded strategy. There are three sealed instances
per market, and a trade selects at most two distinct capitals.

A maker owns its curve shape, inventory caps and permissions. A narrowly delegated
updater changes its price anchor. Clearing owns consumed depth. Repricing never
restores depth: replenishment is a separate owner-authorized transition.

The router reads a coherent authenticated snapshot and chooses the best financially
admissible single/pair within that snapshot. Clearing recomputes current prices,
checks signed bounds, and admits every trader/maker account atomically. A preview
is not a reservation or guarantee of landing.

The funding publisher reads the complete configured published book and computes
impact prices off chain. It deliberately omits hypothetical maker margin checks.
Clearing verifies its bounded signed report against independent sources and derives
funding. Published funding depth and executable trading depth are different promises.

- [Quoting](quoting.md): math, accounts, permissions, lifecycle and CPI contract.
- [Routing](routing.md): snapshot, optimizer, signed execution and transport.
- [Funding](funding.md): publisher authority, coverage, causal accrual and trust.
- [Operator setup and exit](../operations/deployment.md).

Code: [maker-interface](../../crates/maker-interface/src/canonical.rs),
[shared maker implementation](../../programs/maker-canonical.rs),
[clearing gateway/execution](../../programs/clearing/src/instructions/maker_liquidity/),
[SDK](../../packages/sdk/src/), [maker kit](../../packages/maker-kit/src/).
This does not route existing external spot pools or establish independent maker
profitability. Custom capabilities require explicit support/review; unknown ones reject.
