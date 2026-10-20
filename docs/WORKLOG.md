# Rivalt implementation worklog
Baseline R1 · initialized 20 October 2026

**Current position:** documentation handoff prepared; implementation not started in this kit. **Next phase: P01.** No program build, deployment, protocol tests, soak, maker integration or external review was performed by this documentation task.

This is the sole implementation roadmap and live status record. The old research roadmap remains historical provenance outside the working directory. Update these tables and append a run entry after every substantive implementation run.

## Status rules

- **Open:** not started or awaiting an ordinary prerequisite.
- **In progress:** active implementation; acceptance not complete.
- **Review:** deliverable and recorded checks ready, awaiting required integration/review.
- **Blocked:** a concrete attempted step cannot proceed; name blocker and exact resolution needed.
- **Closed:** scope and acceptance complete with evidence, configuration gates resolved and integrated into the intended baseline. If repository policy requires merge/review, it must be satisfied. Otherwise a verified local committed baseline is sufficient.

Do not mark a phase Closed because its PR was opened. Do not mark unattempted future phases Blocked merely because they depend on earlier work. At most one primary phase is In progress in the ordinary sequential workflow. Reopen a phase if later evidence invalidates its acceptance.

## Milestone overview

| Milestone | Phases | Short description / deliverable | Status | Evidence / blocker |
|---|---|---|---|---|
| M1 | P01–P02 | Reproducible stack, economic core and custody | Open | Not implemented |
| M2 | P03–P04 | Competing makers and atomic execution | Open | Not implemented |
| M3 | P05–P06 | Real services and full trade lifecycle | Open | Not implemented |
| M4 | P07–P10 | Funding, orders, risk recovery and usable UI | Open | Not implemented |
| M5a | P11–P12 | Complete local engineering evidence | Open | Not implemented |
| M5b | P13–P14 | Focused real-cluster parity | Open | Not implemented |
| M6 | P15–P16 | Independent commercial/pilot readiness | Open | Not implemented |

## Phase overview

| Milestone | Phase | PR deliverable | Status | PR / commit | Evidence / next dependency |
|---|---|---|---|---|---|
| M1 | P01 | Toolchain, SDK and RPC spine | Open | — | Ready to start |
| M1 | P02 | Financial core and custody | Open | — | After P01 |
| M2 | P03 | Maker programs and capital authorization | Open | — | After P02 |
| M2 | P04 | Atomic routes and allocation | Open | — | After P03 |
| M3 | P05 | Indexer, database and read API | Open | — | After P04 |
| M3 | P06 | Maker daemons and complete service lifecycle | Open | — | After P05 |
| M4 | P07 | Oracle policy and authenticated funding | Open | — | After P06 |
| M4 | P08 | Persistent orders and TP/SL | Open | — | After P07 |
| M4 | P09 | Liquidation and resumable default | Open | — | After P08 |
| M4 | P10 | Trading UI and direct exit experience | Open | — | After P09 |
| M5a | P11 | Integrated fault and reconciliation matrix | Open | — | After P10 |
| M5a | P12 | Resource budgets, load and 24-hour soak | Open | — | After P11 |
| M5b | P13 | Devnet deployment and real dependency verification | Open | — | After P12 |
| M5b | P14 | Devnet lifecycle, wallet and provider recovery | Open | — | After P13 |
| M6 | P15 | Independent maker integration and economics | Open | — | After P14 |
| M6 | P16 | Risk calibration, review and pilot readiness | Open | — | After P15 |

Acceptance details live in [DELIVERY-PLAN](05-DELIVERY-PLAN.md). Configuration gates live in [DECISIONS](DECISIONS.md). Do not duplicate their full text here.

## Latest checkpoint

- Last completed work: R000 documentation consolidation, scope reconciliation and PR phase plan.
- Current implementation revision: none supplied by this kit.
- Active phase: none; P01 next.
- Immediate task: inspect local repository/instructions, verify toolchain availability, resolve G01 and demonstrate the minimal signed SDK/Surfpool/RPC loop.
- Access needed now: the actual working repository and local toolchain/network access. No devnet key or external maker is needed for P01.
- Deferred external needs: secure devnet/feed access at P13; independent maker participation at P15; independent review/funded-pilot decision at P16.
- Historical archives: optional targeted reference only; not an entry requirement.
- Product decisions required now: none. Rivalt is the selected name.

## Blocker register

| ID | Phase | Concrete blocker | Evidence | Resolution / owner | Status |
|---|---|---|---|---|---|
| — | — | None encountered by an implementation phase yet | Documentation-only handoff | Start P01 locally | — |

A runtime compatibility failure belongs here with the exact package/command/error and smallest viable alternative. Do not turn it into another general research phase.

## Run history

### R000 — 20 October 2026 — documentation handoff

- Scope: consolidate the finalized design for Rivalt and define practical implementation phases.
- Sources: 12 selected current/historical project documents reviewed for consistency; see SOURCE-AUDIT.
- Delivered: 11 Markdown documents including root instructions, seed prompt, five domain/delivery specs, decisions, source audit and this worklog.
- Decisions: name Rivalt; compact current specification replaces mandatory research import; 16 phases; explicit fee/resolution/funding clarifications; web3.js/wallet-adapter 3.1.1 starting pair.
- Validation: documentation link/ID/status/coverage checks and exact arithmetic checks of specification examples are recorded in SOURCE-AUDIT after packaging. These are not protocol tests.
- Historical files: retained as evidence, not rewritten to claim current behavior or copied into this kit.
- Implementation phase status: all Open.
- Next action: P01.

## Template — append after each run

### RNNN — YYYY-MM-DD — PXX — short outcome

- Starting revision / branch:
- Goal and delivered behavior:
- Changed code and specifications:
- Decisions / configuration gates resolved:
- Checks actually run (command, result, revision/environment):
- Checks not run and reason:
- Evidence paths / program-IDL-config identities:
- PR / integrated commit (actual only):
- Phase status and acceptance criteria remaining:
- Blockers and exact decision/access needed:
- Next concrete action:

Update Latest checkpoint and the two overview tables as well as appending the entry. UTC timestamps belong in machine evidence; dates/times shown to Arnab can use Asia/Kolkata. Use explicit zones for long runs.

