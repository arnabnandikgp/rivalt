# Rivalt implementation worklog
Baseline R1 · initialized 20 October 2026

**Current position:** P01 implementation and first offline Surfpool acceptance run pass; clean verification on the committed revision and draft PR publication are being completed. **Active phase: P01.** Financial instructions, makers, services and later acceptance phases remain unimplemented.

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
| M1 | P01–P02 | Reproducible stack, economic core and custody | In progress | P01 signed local RPC spine passes; clean committed verification pending; P02 remains Open |
| M2 | P03–P04 | Competing makers and atomic execution | Open | Not implemented |
| M3 | P05–P06 | Real services and full trade lifecycle | Open | Not implemented |
| M4 | P07–P10 | Funding, orders, risk recovery and usable UI | Open | Not implemented |
| M5a | P11–P12 | Complete local engineering evidence | Open | Not implemented |
| M5b | P13–P14 | Focused real-cluster parity | Open | Not implemented |
| M6 | P15–P16 | Independent commercial/pilot readiness | Open | Not implemented |

## Phase overview

| Milestone | Phase | PR deliverable | Status | PR / commit | Evidence / next dependency |
|---|---|---|---|---|---|
| M1 | P01 | Toolchain, SDK and RPC spine | In progress | `phase/p01-spine`; draft pending | First full local smoke passes; clean committed verification and integration remain |
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

- Last completed work: P01 first actual signed deployment/probe, independent decode/signature verification, generated/legacy parity and HTTP/WS/history/rollback checks.
- Current implementation revision: P01 working tree on `phase/p01-spine`, started at `f7ab14c`; clean committed verification pending.
- Active phase: P01.
- Immediate task: run `cargo clean` then `pnpm smoke` on the committed P01 implementation and publish its draft PR.
- Access needed now: none. GitHub ADMIN access was verified with network access; the sandbox-only authentication failure was not an actual credential failure. No devnet key or external maker is needed for P01.
- Deferred external needs: secure devnet/feed access at P13; independent maker participation at P15; independent review/funded-pilot decision at P16.
- Historical archives: optional targeted reference only; not an entry requirement.
- Product decisions required now: none. Rivalt is the selected name.

## Blocker register

| ID | Phase | Concrete blocker | Evidence | Resolution / owner | Status |
|---|---|---|---|---|---|
| B01 | P01 | Default SBF v1.57 download exhausted disk | `cargo_build_sbf::toolchain`: ENOSPC | Removed only this run's downloaded archives; verified existing platform-tools v1.52 on SBPF v0, recorded D16 | Resolved |

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

### R001 — 20 October 2026 — P01 — executable SDK/RPC spine

- Starting revision / branch: `f7ab14cc361fcd2b194fb1b839e65934af130dd9` on `main`; implementation isolated on `phase/p01-spine`. Initial working tree was clean and contained documentation only.
- Delivered: exact Rust/npm locks and verified local binary downloads; actual Anchor probe with event-CPI; Codama SDK and asynchronous web3.js v3 signing; isolated legacy conformance client; native offline Surfpool supervisor, signed deployment and independent HTTP/WS acceptance harness.
- Specifications: README, P01-SPINE, COMPONENTS, STACK-AND-VALIDATION and D16/D17 document the implemented test profile and remaining phase boundaries.
- Configuration gates: G01 pins and G06 foundations implemented; committed clean acceptance verification pending. No economic configuration gate was invented or closed.
- Checks actually run: `pnpm install` in both independent roots; `cargo generate-lockfile`; locked SBPF v0 build; locked `anchor idl build`; `pnpm typecheck`; `pnpm test` (7 ABI/wallet-import checks pass); `pnpm generate:check`; `cargo fmt -- --check`; installed graph check (77 packages, modern SDK/wallet versions, no legacy runtime imports).
- First full `bash ops/smoke.sh`: PASS at `.local/runs/20261020T170408Z-67907`; three successful probes, one failed two-instruction probe, independent Ed25519 verification, live Anchor account/event decode, five WS subscriptions, five history entries and before/until pagination. First probe: 322 bytes, five message accounts, 10,492 simulated CU. This initial result is explicitly from a dirty implementation tree; final committed clean evidence will be appended before closeout.
- Failures resolved: v1.57 download ENOSPC; installed v1.52 missing SBPF v3 target; Anchor's differing SBF/IDL argument forwarding; renderer's package-root output convention; sandbox TSX CLI IPC restriction (use `node --import tsx`); dependency tree CLI expansion exceeded its output buffer (replaced with visited-set traversal of actual installed manifests).
- Checks not run: P02+ economics/custody/SVM cases, PostgreSQL/service recovery, browser wallet signing, load/24-hour soak, devnet and external review. Those programs/services/phases do not yet exist. Optional legacy native accelerators remain disabled.
- Evidence / identities: initial runtime reports Surfpool 1.6.1 / solana-core 4.2.1 / feature-set 565236538; program `Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo`; binary SHA-256 `560c7c6bb499cbf406be7e8e4edbae43cca27bdf13f227b17e6480073bc24002`; IDL SHA-256 `195ec9a1ce4f30117fef4e4774b26232f9f60a70166c812293bd169da1f1235f`.
- PR / integrated commit: pending clean committed verification and draft creation; no merge claimed.
- Phase status: In progress. Acceptance run on recorded code, review/integration and final evidence closeout remain.
- Blockers: no current access/product blocker; B01 resolved by the tested profile. GitHub access was rechecked outside the network-restricted sandbox and succeeds.
- Next concrete action: clean-build and run the full P01 smoke on the committed implementation, then publish the draft phase PR with the recorded evidence.

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

