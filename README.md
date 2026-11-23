# Rivalt

**A Solana perpetual futures venue with common clearing and competing margined maker programs.**

Makers publish liquidity curves and fund their own inventory. For a market
order in the fresh local demo, the trader signs a size, price limit and fee
ceiling. At execution, clearing reads all three registered maker books and
selects the best eligible fill using one or two makers. The trader holds one
position per market in their margin account and can close it against another maker.

The current implementation is a qualified **local engineering prototype** for
BTC and ETH with one test collateral mint, isolated and cross-margin accounts,
and three internal maker instances per market. Current trading remains disabled
in default/devnet builds. At the $61,000 BTC test price, one funded maker carried $15.62 of inventory before
the next lot hit its profit-history storage limit. [Operating limits](docs/operations/performance.md)
records the tested sizes and outcomes. Independent maker validation and funded-pilot review remain open.

## Design

- **Common clearing:** on-chain custody, account authority, margin checks, funding,
  orders, liquidation and complete-cohort default accounting.
- **Competing makers:** separate pricing programs, configurable depth, restricted
  price updaters and isolated capital per market. Every trade checks financial
  admission, signed limits and current maker authority.
- **Explicit accounting:** funded cash is separate from unpaid profit. Positive
  unpaid claims supply no margin credit. Taker fees are 2 bps; provider fees are
  zero. A quarter of collected fees funds the originating market's insurance.
- **Independent risk:** index-derived valuations govern risk; a restricted
  publisher supplies bounded funding reports from published maker depth.
- **Durable applications:** wallet-signed transactions, immutable retry records,
  finalized RPC/WS indexing and PostgreSQL reconciliation.

Supported orders include immediate exact-base trades, persistent limits and
stop-limits, and existing-position reduce-only TP/SL. Rivalt is its own venue;
it does not route trades to other perpetual exchanges.

## Run locally

Install the [pinned toolchain and dependencies](docs/operations/local-development.md#pinned-toolchain)
in the checkout you will run. Fresh local venues use execution-time routing
and verified whole-cohort recovery.
The installer builds from pinned Git revisions and checks all four program hashes.
The verified environment is macOS arm64 with native Surfpool and Apple Containers
for PostgreSQL.

```sh
source ops/env.sh
bash ops/build-demo-programs.sh
export RIVALT_DEMO_ROOT=.local/successor-demo
bash ops/demo.sh start
```

Open **http://127.0.0.1:18083**, choose **Rivalt Local Demo**, and select **Get test
funds**. Create a portfolio and margin account, deposit test collateral, then trade
BTC or ETH. The demo uses synthetic prices, internal makers and valueless assets.
Its wallet is local to the browser tab; never send real assets to it.

```sh
bash ops/demo.sh status
bash ops/demo.sh stop
```

A stopped chain requires `bash ops/demo.sh reset` for a fresh session. Sessions
are limited to 60 minutes. See [local development](docs/operations/local-development.md)
for storage, shutdown, browser and setup details.

## Repository

| Path | Responsibility |
|---|---|
| `programs/clearing` | Account, custody, risk, execution and settlement authority |
| `programs/maker-a`, `programs/maker-b`, shared `programs/maker-*.rs` | Maker program deployments and shared implementation |
| `crates/clearing-accounting`, `crates/risk-engine` | Position valuation, account health and order reservations |
| `crates/financial-core`, `crates/maker-interface` | Execution and settlement transitions, bounded maker quote contract |
| `packages/sdk`, `packages/services`, `packages/indexer` | Clients, durable workers, finalized projections and APIs |
| `packages/maker-kit`, `packages/local-demo`, `apps/trader` | Operator tooling, local runtime and wallet UI |
| `tests`, `ops` | Independent references, compiled/integration checks and pinned tooling |

## Documentation and verification

Start with the [documentation map](docs/README.md), then choose
[clearing](docs/clearing/README.md), [maker liquidity](docs/liquidity/README.md),
[application interfaces](docs/application/README.md) or [operations](docs/operations/README.md).
[STATUS](docs/STATUS.md) tracks the integrated baseline and open work;
[validation](docs/operations/validation.md) records exact tested revisions,
resource measurements and limitations.

Use the checks appropriate to your change; the full integration matrix is not a
routine PR prerequisite. Financial tests use independent expected values, and
integrated acceptance uses actual signed transactions, Surfpool RPC/WS and
PostgreSQL. See [AGENTS.md](AGENTS.md) for contribution and handoff rules.
