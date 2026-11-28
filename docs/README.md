# Rivalt documentation

Rivalt clears perpetual futures on Solana. Independent maker programs set prices against their own margin. Clearing selects the fill, applies account risk checks and owns collateral. The fresh demo trades BTC/ETH with internal makers. A separate local profile qualified funded BTC/ETH/SOL trading and default. [Deployment boundaries](STATUS.md)

| If you want to… | Start here |
|---|---|
| Run the wallet or reproduce a local workload | [Local development](operations/local-development.md) |
| Understand accounts, withdrawals, margin and liquidation | [Clearing and source map](clearing/README.md) |
| Publish quotes, follow a fill or understand funding | [Maker liquidity](liquidity/README.md) |
| Build a client, operate workers or follow money through PostgreSQL | [Application and services](application/README.md) |
| Operate an instance, choose tests or find measured limits | [Operations](operations/README.md) |
| Review test biases, open bottlenecks and the evidence needed to close them | [Venue qualification scorecard](operations/qualification-scorecard.md) |
| See what shipped, what can fail and what comes next | [Project status](STATUS.md) |

[Decisions](DECISIONS.md) records the rationale behind current contracts. [History](HISTORY.md) locates earlier designs, measurements and reproduction instructions by immutable revision.
