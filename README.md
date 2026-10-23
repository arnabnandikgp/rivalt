# Rivalt
Implementation baseline R1 · 20 October 2026

Rivalt is a new Solana perpetual venue with common clearing, isolated collateral and competing margined perpAMMs. The repository contains the implementation specification, local toolchain/SDK/RPC spine, checked financial core, clearing custody, separate A/B maker programs with funded-capital registration, and atomic routes under an explicit synthetic local risk profile. A PostgreSQL-backed indexer and read API rebuild finalized custody and route state over standard RPC/WS. Maker daemons, durable signed execution and guarded ordinary settlement/withdrawal complete the local service lifecycle. Authenticated controlled local sources, causal common funding and a separately budgeted funding worker now extend that profile. The P08 local profile adds persistent limits/stops, conservative reservations and existing-position TP/SL with a separately funded keeper. Exceptional default remains disabled.

## Start here

Read [AGENTS.md](AGENTS.md), then [the live worklog](docs/WORKLOG.md), [product scope](docs/01-PRODUCT.md) and [the delivery plan](docs/05-DELIVERY-PLAN.md). Before implementing a phase, read its domain documents and decision gates.

| File | Authority / purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent workflow, reading order, scope boundaries and completion rules |
| [docs/01-PRODUCT.md](docs/01-PRODUCT.md) | Product scope, customer/maker economics and desired experience |
| [docs/02-PROTOCOL.md](docs/02-PROTOCOL.md) | Economic state, invariants, transitions, funding, orders and risk contract |
| [docs/03-COMPONENTS.md](docs/03-COMPONENTS.md) | Program/service boundaries, account and interface requirements, repository layout |
| [docs/04-STACK-AND-VALIDATION.md](docs/04-STACK-AND-VALIDATION.md) | Stack, test layers, required scenarios, metrics and environment policy |
| [docs/05-DELIVERY-PLAN.md](docs/05-DELIVERY-PLAN.md) | Six milestones, M5 split into local/devnet gates, and 16 PR-sized phases |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Accepted choices, consolidation clarifications and phase-bound configuration gates |
| [docs/WORKLOG.md](docs/WORKLOG.md) | Sole live status tables, chronological run log, blockers and exact next action |
| [docs/SOURCE-AUDIT.md](docs/SOURCE-AUDIT.md) | Consistency audit, historical provenance and explicit supersessions |
| [docs/P01-SPINE.md](docs/P01-SPINE.md) | Reproducible local bootstrap, smoke command and probe contract |
| [docs/P02-ACCOUNTING-AND-CUSTODY.md](docs/P02-ACCOUNTING-AND-CUSTODY.md) | Exact financial units, fractional default rule, custody authority/ABI and checks |
| [docs/P04-ATOMIC-ROUTES.md](docs/P04-ATOMIC-ROUTES.md) | Atomic route authority, synthetic risk boundary, allocation and measured budget contract |
| [docs/P08-ORDERS.md](docs/P08-ORDERS.md) | Durable order authority, remaining reservations, fee prefixes and shared TP/SL allowance |
| [docs/P07-ORACLE-AND-FUNDING.md](docs/P07-ORACLE-AND-FUNDING.md) | Controlled source policy, authenticated common funding, action modes and participant fractions |
| [docs/P06-LIFECYCLE.md](docs/P06-LIFECYCLE.md) | Ordinary settlement/exit guard, maker/executor services, explicit fee budgets and durable retries |
| [docs/P05-INDEXER.md](docs/P05-INDEXER.md) | PostgreSQL journal/recovery, read endpoints, exact service pins and local operations |
| [docs/P03-MAKER-CONTRACT.md](docs/P03-MAKER-CONTRACT.md) | Maker curves, capital binding, bounded read-only CPI, epochs and upgrade controls |

## What “finalized” means

The product architecture, economic contract, scope and delivery order are selected for implementation. Exact financial layouts, arithmetic bounds and synthetic risk parameters are phase deliverables with explicit deadlines in DECISIONS. The pinned P01 stack has its own executable checks; it does not validate later economic behavior.

No phase may close with an unresolved gate it owns. A successful local prototype is not a production launch approval.

This kit supersedes the older continuity guide as the implementation entry point. The historical research files remain reference material outside the working repository. Do not import the 52-record research inventory or every archive. Existing useful source already in the working directory may be reused after inspection; acquiring old archives is not an M1 prerequisite.

## Run the local spine

The verified bootstrap profile is macOS arm64, using native Surfpool and the existing Apple container runtime for PostgreSQL 18.6. Install Python 3.12+, rustup and the pinned tools as described in [P01-SPINE](docs/P01-SPINE.md), then:

```sh
source ops/env.sh
RIVALT_SLOT_TIME=50 pnpm smoke
```

This installs frozen dependencies, builds all three SBF programs and IDLs, checks the generated client against isolated legacy Anchor, runs independent financial and compiled-program tests, then starts offline Surfpool and verifies signed deployment, probe, real token custody, maker controls and atomic routes/hostile-CPI rollback over HTTP/WS. It also verifies PostgreSQL rollback, disconnect recovery, fresh database rebuild and real chain-reset isolation, then runs separate maker/executor/settlement processes through deposit → split → cross-maker close → funded settlement → withdrawal, including acknowledgement loss, worker kills, expiry and fee reconciliation. P07 adds a separately deployed signed oracle fixture, funding worker, source/maker outage and recovery checks, exact fractional funding, and PostgreSQL reconstruction. P08 adds signed order races, a restarted order worker and competing discovery processes, plus fresh order-event reconstruction. It shuts down only its own runtimes/containers. Evidence is written to `.local/runs/`. `RIVALT_SLOT_TIME` selects the local slot cadence in milliseconds (default 100); 50 is the P07 local deployment/acceptance cadence; 20 remains a faster optional test cadence whose shorter blockhash lifetime can exhaust program-upload retries. This changes local wall time, not on-chain slot lifetimes.

Only WORKLOG owns live phase status. The delivery plan defines scope and acceptance, while DECISIONS owns baseline amendments.

All funds and actors remain explicitly synthetic/test assets through the engineering MVP.


Raw run evidence is retained locally at its existing paths and excluded from the tracked tree. See [evidence storage and reproduction](docs/EVIDENCE.md); concise reports and regression fixtures remain in Git.
