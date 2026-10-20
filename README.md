# Rivalt
Implementation baseline R1 · 20 October 2026

Rivalt is a new Solana perpetual venue with common clearing, isolated collateral and competing margined perpAMMs. This repository kit contains the current implementation specification and delivery plan. It contains no implemented programs, running services, historical research archives or inherited test results.

## Start here

Read [AGENTS.md](AGENTS.md), then [the live worklog](docs/WORKLOG.md), [product scope](docs/01-PRODUCT.md) and [the delivery plan](docs/05-DELIVERY-PLAN.md). Before implementing a phase, read its domain documents and decision gates. Use [SEED-PROMPT.md](SEED-PROMPT.md) to start a coding session.

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
| [SEED-PROMPT.md](SEED-PROMPT.md) | Ready-to-paste instruction for the implementation agent |

## What “finalized” means

The product architecture, economic contract, scope and delivery order are selected for implementation. Exact binary layouts, arithmetic bounds, dependency lockfiles and synthetic risk parameters are phase deliverables with explicit deadlines in DECISIONS. They have not been invented or represented as tested configuration.

No phase may close with an unresolved gate it owns. A successful local prototype is not a production launch approval.

This kit supersedes the older continuity guide as the implementation entry point. The historical research files remain reference material outside the working repository. Do not import the 52-record research inventory or every archive. Existing useful source already in the working directory may be reused after inspection; acquiring old archives is not an M1 prerequisite.

## Where to place it

Extract the contents of the included `rivalt/` directory into the intended repository root. If that directory already has files or instructions, reconcile them deliberately rather than overwriting them. Keep AGENTS.md and README.md at the root and the supplied specifications under docs/.

Only WORKLOG owns live phase status. The delivery plan defines scope and acceptance, while DECISIONS owns baseline amendments. Do not maintain a second competing status spreadsheet or copy of the old research roadmap.

## First outcome

Complete P01: exact toolchain/dependency pins, Anchor IDL → generated application SDK parity, and one signed transaction against Surfpool independently fetched and decoded through RPC. Follow with P02's financial core and custody. Do not start with a new research survey or cosmetic frontend.

All funds and actors remain explicitly synthetic/test assets through the engineering MVP.

