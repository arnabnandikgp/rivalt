# Rivalt

**A Solana perpetual futures venue with common clearing and competing margined maker programs.**

Rivalt separates pricing from clearing. Makers publish configurable liquidity
curves and fund their own inventory; an off-chain router selects the best bounded
allocation, and clearing executes up to two maker legs atomically. Traders share
one account and settlement system across makers, so a position can open against
one maker and close against another.

The current implementation is a qualified **local engineering prototype** for
BTC and ETH with one test collateral mint, isolated and cross-margin accounts,
and three internal maker instances per market. Current trading remains disabled
in default/devnet builds. Independent maker validation, independent review and
funded-pilot readiness remain open; 24-hour endurance is deferred.

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
first. The verified environment is macOS arm64 with native Surfpool and Apple
Containers for PostgreSQL. From the repository root:

```sh
source ops/env.sh
bash ops/build.sh
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
| `crates/financial-core`, `crates/maker-interface` | Checked financial arithmetic and bounded quote contract |
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
