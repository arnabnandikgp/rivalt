# Rivalt
Implementation baseline R1 · 20 October 2026

Rivalt is a new Solana perpetual venue with common clearing, isolated collateral and competing margined perpAMMs. The repository contains the implementation specification, local toolchain/SDK/RPC spine, checked financial core, clearing custody, separate A/B maker programs with funded-capital registration, and atomic routes under an explicit synthetic local risk profile. A PostgreSQL-backed indexer and read API rebuild finalized custody and route state over standard RPC/WS. Maker daemons, durable signed execution and guarded ordinary settlement/withdrawal complete the local service lifecycle. Authenticated controlled local sources, causal common funding and a separately budgeted funding worker now extend that profile. The P08 local profile adds persistent limits/stops, conservative reservations and existing-position TP/SL with a separately funded keeper. P09 adds verified local liquidation and complete-cohort resolution with crash/rebuild recovery; the default build rejects these financial paths.

## Start here

[P22–P28's account-centric clearing redesign](docs/P22-ACCOUNT-CENTRIC-CLEARING.md)
is integrated under R073/D67: separate account risk, market eligibility, funded
exits and settlement/default responsibilities. P22B defines the financial contract;
P23–P28 implement and qualify it in an explicit local test profile. Start with the
[P28 operations guide](docs/P28-OPERATIONS.md) for local evaluation and
[the P28 report](docs/evidence/P28.md) for measured limits. V1/V2 are preserved;
default/devnet builds remain gated. WORKLOG owns live status and external gates.

The isolated/cross successor starts at [P17's account/group contract](docs/P17-MARGIN-CONTRACT.md)
and P17–P21 in the delivery plan. It targets a fresh local two-market test group;
the existing V1 implementation is preserved. [P20](docs/evidence/P20.md) qualifies
cross trading only in its explicit local profile after whole-account safety
acceptance. P21 service/UI qualification and the bounded successor stack are now
integrated under R053; WORKLOG records exact evidence and limitations.

Read [AGENTS.md](AGENTS.md), then [the live worklog](docs/WORKLOG.md), [product scope](docs/01-PRODUCT.md) and [the delivery plan](docs/05-DELIVERY-PLAN.md). Before implementing a phase, read its domain documents and decision gates. For program code, start with the [clearing source map](programs/clearing/README.md).

| File | Authority / purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent workflow, reading order, scope boundaries and completion rules |
| [docs/01-PRODUCT.md](docs/01-PRODUCT.md) | Product scope, customer/maker economics and desired experience |
| [docs/02-PROTOCOL.md](docs/02-PROTOCOL.md) | Economic state, invariants, transitions, funding, orders and risk contract |
| [docs/03-COMPONENTS.md](docs/03-COMPONENTS.md) | Program/service boundaries, account and interface requirements, repository layout |
| [docs/04-STACK-AND-VALIDATION.md](docs/04-STACK-AND-VALIDATION.md) | Stack, test layers, required scenarios, metrics and environment policy |
| [docs/05-DELIVERY-PLAN.md](docs/05-DELIVERY-PLAN.md) | Milestone/phase dependencies; P15/P16 engineering A and external B gates |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Accepted choices, consolidation clarifications and phase-bound configuration gates |
| [docs/WORKLOG.md](docs/WORKLOG.md) | Sole live status tables, chronological run log, blockers and exact next action |
| [docs/SOURCE-AUDIT.md](docs/SOURCE-AUDIT.md) | Consistency audit, historical provenance and explicit supersessions |
| [docs/P01-SPINE.md](docs/P01-SPINE.md) | Reproducible local bootstrap, smoke command and probe contract |
| [docs/P02-ACCOUNTING-AND-CUSTODY.md](docs/P02-ACCOUNTING-AND-CUSTODY.md) | Exact financial units, fractional default rule, custody authority/ABI and checks |
| [docs/P04-ATOMIC-ROUTES.md](docs/P04-ATOMIC-ROUTES.md) | Atomic route authority, synthetic risk boundary, allocation and measured budget contract |
| [docs/P08-ORDERS.md](docs/P08-ORDERS.md) | Durable order authority, remaining reservations, fee prefixes and shared TP/SL allowance |
| [docs/P09-RESOLUTION.md](docs/P09-RESOLUTION.md) | Funded liquidation, frozen cohort ledger, deterministic pages and authorized recovery |
| [docs/P10-TRADER.md](docs/P10-TRADER.md) | Wallet UI, exact balance/order views, saved signatures and direct RPC recovery |
| [docs/P11-MATRIX.md](docs/P11-MATRIX.md) | Explicit integrated fault report, independent reconciliation and scoped hosted CI |
| [docs/P07-ORACLE-AND-FUNDING.md](docs/P07-ORACLE-AND-FUNDING.md) | Controlled source policy, authenticated common funding, action modes and participant fractions |
| [docs/P06-LIFECYCLE.md](docs/P06-LIFECYCLE.md) | Ordinary settlement/exit guard, maker/executor services, explicit fee budgets and durable retries |
| [docs/P05-INDEXER.md](docs/P05-INDEXER.md) | PostgreSQL journal/recovery, read endpoints, exact service pins and local operations |
| [docs/P03-MAKER-CONTRACT.md](docs/P03-MAKER-CONTRACT.md) | Maker curves, capital binding, bounded read-only CPI, epochs and upgrade controls |

## Interactive local demo

[The local walkthrough](docs/P28A-LOCAL-DEMO.md) packages the current schema-3
profile for hands-on evaluation. With the pinned tools/dependencies and qualified
artifacts installed, run `bash ops/demo.sh start`, then open
**http://127.0.0.1:18083** and choose **Rivalt Local Demo** in the wallet picker.
Use `bash ops/demo.sh status`, `stop`, or `reset` to manage the owned session.
Sessions use synthetic prices and valueless collateral, last up to 60 minutes,
and start fresh after a reset. WORKLOG records this follow-up's acceptance status.

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

This installs frozen dependencies, builds all three SBF programs and IDLs, checks the generated client against isolated legacy Anchor, runs independent financial and compiled-program tests, then starts offline Surfpool and verifies signed deployment, probe, real token custody, maker controls and atomic routes/hostile-CPI rollback over HTTP/WS. It also verifies PostgreSQL rollback, disconnect recovery, fresh database rebuild and real chain-reset isolation, then runs separate maker/executor/settlement processes through deposit → split → cross-maker close → funded settlement → withdrawal, including acknowledgement loss, worker kills, expiry and fee reconciliation. P07 adds a separately deployed signed oracle fixture, funding worker, source/maker outage and recovery checks, exact fractional funding, and PostgreSQL reconstruction. P08 adds signed order races, a restarted order worker and competing discovery processes, plus fresh order-event reconstruction. P09 adds real funded liquidation, complete-cohort resolution, worker interruption/restart, frozen-state reconstruction and actual source-outage recovery. It shuts down only its own runtimes/containers. The consolidated report is written to `.local/matrix/<UTC-pid>/`, with unique stage environments beneath it. The matrix defaults to and requires `RIVALT_SLOT_TIME=50` milliseconds. Standalone legacy helpers retain their own explicit cadence knobs; those profiles do not replace the verified integrated 50 ms profile. Slot cadence changes local wall time, not on-chain slot lifetimes.

`pnpm smoke` is the broad regression command, not a mandatory pre-PR step. Select affected checks and the current phase's acceptance gates; for P10 the targeted command is `RIVALT_SLOT_TIME=50 pnpm test:browser` after the affected build/client checks. P11 owns the consolidated matrix and P12 the D35 bounded qualification and large-history replay. Only WORKLOG owns live phase status. The delivery plan defines scope and acceptance, while DECISIONS owns baseline amendments.

All funds and actors remain explicitly synthetic/test assets through the engineering MVP.


P09 liquidation and complete-cohort resolution pass clean full acceptance on the stacked child of P08. The local profile includes funded receivers, exact paginated loss allocation and explicit recovery authority; [evidence](docs/evidence/P09.md) records the actual results and [WORKLOG](docs/WORKLOG.md) owns Review/integration status. [P09's contract](docs/P09-RESOLUTION.md) describes the frozen ledger and service interface.

P10 adds the wallet trading UI, exact cash/unpaid-profit views, durable orders, existing-position TP/SL, actual-fill charts and direct RPC recovery. All 15 targeted browser checks pass against real Surfpool/WS/PostgreSQL, including cancellation and withdrawal with the venue API stopped; [P10 evidence](docs/evidence/P10.md) records the tested source and limits. The local instrumented wallet does not establish external wallet-provider or devnet parity.

To explore the UI on this prepared workspace, run `source ops/env.sh` then `pnpm demo:trader`. It opens a visible Chrome session with a funded local test wallet at `http://127.0.0.1:18084` for up to 60 minutes. Close its tab or Ctrl-C to stop. This starts only the required local runtime, with no automated trading, soak or regression suites. See the [manual UI guide](docs/P10-TRADER.md#run-and-recover-directly).

P11 now records fresh A01–A16 acceptance across seven commands, 23 named faults and six independent integer reconciliations. [P11 evidence](docs/evidence/P11.md) retains exact identities and all outcome populations. The matrix is an explicit phase gate; ordinary PRs use affected checks and scoped hosted CI. P12 load, bounded qualification and large-history replay remain tracked in WORKLOG; D42 keeps 24-hour endurance Deferred for separately scoped future work.

P12's D35 bounded qualification passes with 1,249/1,249 submitted trades, 71.19% normal offered availability, affected recovery, actual withdrawal and 12,454-transaction fresh PostgreSQL reconstruction. [P12 evidence](docs/evidence/P12.md) records exact source, the explicit history-stage indexer pause, resource measurements and limitations. D42 keeps continuous 24-hour endurance Deferred outside current P16A acceptance; WORKLOG owns live status.

P13 verifies separate devnet deployment, actual sponsored Pyth Core consumption, a finalized one-lot trade and restrictive stale/source actions. [Evidence](docs/evidence/P13.md) retains the missed live WS notification and successful original-signature recovery, with intermittent feeds and operator-controlled guard clearly limited under D37. P14 owns the bounded service/wallet lifecycle; this is not a funded launch approval.

P14's bounded devnet lifecycle, original-signature/PostgreSQL recovery and actual Phantom registration now pass. [P14 evidence](docs/evidence/P14.md) retains the exact failed attempts, successful continuation and independent wallet/account reconciliation. The [engineering MVP assessment](docs/ENGINEERING-MVP.md) covers M1–M5b; the implementation stack is integrated, and [R030](docs/evidence/R030-DEVNET-CLOSEOUT.md) verifies the subsequent devnet maker hardening/owner-binding follow-up. The closeout is integrated through PR #19; WORKLOG records P13/P14/M5b Closed. Independent maker/review/funded-pilot gates remain M6. Run `bash ops/devnet-demo.sh` for the bounded interactive devnet UI with the existing secure local RPC configuration.

Raw run evidence is retained locally at its existing paths and excluded from the tracked tree. See [evidence storage and reproduction](docs/EVIDENCE.md); concise reports and regression fixtures remain in Git.

D41 extends the completed engineering MVP with **P15A** maker integration/economics tooling and **P16A** availability analysis, focused reliability fixes and bounded operational readiness checks. Both engineering phases are integrated through PRs #20/#21 under D44's explicit merge authorization. D42 keeps the 24-hour qualification Deferred for much later; it is not a current phase gate. **P15B/P16B** remain separate independent-maker/review/funded-pilot gates; internal makers and simulated hedges cannot close them. See [the delivery plan](docs/05-DELIVERY-PLAN.md) and [live worklog](docs/WORKLOG.md).

The [reference maker kit](docs/P15A-MAKER-KIT.md) packages operator configuration, SDK examples, a bot entrypoint and exact economics reporting. `pnpm maker:build` builds its four local artifacts; `pnpm maker:qualify` runs its bounded workflow on fresh Surfpool/PostgreSQL state. Both makers and all prices/collateral remain explicitly internal/synthetic. WORKLOG records the actual acceptance status.

[Operational readiness](docs/P16A-OPERATIONS.md) explains the original 71.19% availability with explicit quote/submission/fill denominators and recorded refusal causes. `pnpm test:readiness` exercises bounded source/signature/indexer recovery and direct exit; `pnpm report:availability` analyzes retained attempt records without claiming a new load or endurance result.

P21A adds the versioned group SDK, PostgreSQL/read API and durable maker/funding/
order/settlement/risk services on P20's explicit qualified local artifacts.
[Fresh interface evidence](docs/evidence/P21A.md) includes complete 64-member
default, process recovery, independent accounting, exact program identity and
API-independent exits. P21B qualifies the successor UI and bounded concurrent
workload; both phases are integrated, with exact evidence in WORKLOG.

[P21B](docs/P21B-QUALIFICATION.md) adds the portfolio-zero isolated/cross wallet UI
and a fresh bounded two-market workload. [Its report](docs/evidence/P21B.md) records
real wallet/RPC/WS/PostgreSQL checks, exact financial reconciliation and measured
limits: continuous sampling invalidated exit certificates; explicit quiescent exits
succeeded. This is an operator-controlled test profile, not funded readiness or
always-live exit availability. The eight-PR successor stack is integrated at
`d07fccc`; WORKLOG closes P17–P21B/M7 within that bounded scope. The user deferred
exit-availability redesign at R053; D56 now resumes it within P22–P28's broader
account-centric work. P15B/P16B and 24-hour endurance remain open/deferred.

[P28's account UI](docs/P28-OPERATIONS.md) exposes owner portfolios and immutable
isolated/cross accounts without a technical group selector. [Fresh acceptance](docs/evidence/P28.md)
verifies 17 wallet originals, 115 submitted trades, six funded withdrawals during
ordinary sampling/trading, complete default/recovery and identical fresh PostgreSQL
replay. Funded cash stays separate from unpaid claims; profit payment still requires
current certified market backing. The P22–P28 stack remains open for review;
WORKLOG owns integration status. These bounded local results do not qualify
independent makers, funded deployment or deferred 24-hour endurance.
