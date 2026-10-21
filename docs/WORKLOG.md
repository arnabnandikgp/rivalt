# Rivalt implementation worklog
Baseline R1 · initialized 20 October 2026

**Current position:** M1/P01/P02 are Closed after both reviewed PRs merged into `3c1aae1`. P03's separate A/B programs, capital authorization and read-only quote contract pass A03/G04 on clean `e05a20e`; [acceptance evidence](evidence/P03.md) records the actual RPC/WS and independent checks. **P03 is Review in ready [PR #4](https://github.com/arnabnandikgp/rivalt/pull/4); M2 is In progress.** P04 atomic routes are In progress on `phase/p04-routes`, stacked above that exact baseline; final RPC acceptance is pending. Later financial paths remain disabled.

This is the sole implementation roadmap and live status record. The old research roadmap remains historical provenance outside the working directory. Update these tables and append a run entry after every substantive implementation run.

## Status rules

- **Open:** not started or awaiting an ordinary prerequisite.
- **In progress:** active implementation; acceptance not complete.
- **Review:** deliverable and recorded checks ready, awaiting required integration/review.
- **Blocked:** a concrete attempted step cannot proceed; name blocker and exact resolution needed.
- **Closed:** scope and acceptance complete with evidence, configuration gates resolved and integrated into the intended baseline. If repository policy requires merge/review, it must be satisfied. Otherwise a verified local committed baseline is sufficient.

Do not mark a phase Closed because its PR was opened. Do not mark unattempted future phases Blocked merely because they depend on earlier work. At most one primary phase is In progress in the ordinary sequential workflow. Reopen a phase if later evidence invalidates its acceptance.

Under D18, verified Review phases satisfy development dependencies through a stacked branch containing their exact commits. Merge remains necessary for Closed, but does not block the next phase's implementation.

## Milestone overview

| Milestone | Phases | Short description / deliverable | Status | Evidence / blocker |
|---|---|---|---|---|
| M1 | P01–P02 | Reproducible stack, economic core and custody | Closed | Fresh A01/A02/M1 exit check on `16e51e4`; integrated unchanged at `3c1aae1` |
| M2 | P03–P04 | Competing makers and atomic execution | In progress | P03 A03/G04 verified on `e05a20e`, ready [PR #4](https://github.com/arnabnandikgp/rivalt/pull/4); P04 implementation active; cross-phase exit awaits fresh acceptance |
| M3 | P05–P06 | Real services and full trade lifecycle | Open | Not implemented |
| M4 | P07–P10 | Funding, orders, risk recovery and usable UI | Open | Not implemented |
| M5a | P11–P12 | Complete local engineering evidence | Open | Not implemented |
| M5b | P13–P14 | Focused real-cluster parity | Open | Not implemented |
| M6 | P15–P16 | Independent commercial/pilot readiness | Open | Not implemented |

## Phase overview

| Milestone | Phase | PR deliverable | Status | PR / commit | Evidence / next dependency |
|---|---|---|---|---|---|
| M1 | P01 | Toolchain, SDK and RPC spine | Closed | [PR #1](https://github.com/arnabnandikgp/rivalt/pull/1), tested `081d614` | [R004 acceptance](evidence/R004-REVIEW.md); G01/G06 foundations pass; merged `3c1aae1` |
| M1 | P02 | Financial core and custody | Closed | [PR #2](https://github.com/arnabnandikgp/rivalt/pull/2), tested `16e51e4` | [R004 acceptance](evidence/R004-REVIEW.md); G02/G03 pass; merged `3c1aae1` |
| M2 | P03 | Maker programs and capital authorization | Review | [PR #4](https://github.com/arnabnandikgp/rivalt/pull/4), tested `e05a20e` | [A03 evidence](evidence/P03.md); G04 verified; integration pending |
| M2 | P04 | Atomic routes and allocation | In progress | `phase/p04-routes` above PR #4 | Compiled scenarios/independent allocation pass provisionally; full clean RPC acceptance pending |
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

- Last completed work: P03 maker qualification, exact A/B quotes, unique owner-funded capital authorization, read-only CPI, epoch/quarantine/upgrade controls and fresh combined acceptance.
- Current implementation revision: `e05a20e69fb5dedb23734881d88137b2dcb986e7`; clean full acceptance `.local/runs/20261021T072031Z-79492`. All probe, financial, custody and maker source identities report `sourceDirty: false`.
- Active checkpoint: M1/P01/P02 Closed; P03 Review with G04/A03 verified; M2/P04 In progress.
- Immediate task: commit P04 implementation and run `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` on its clean revision, then publish a ready stacked PR.
- Access needed now: none. GitHub ADMIN access was verified with network access; the sandbox-only authentication failure was not an actual credential failure. No devnet key or external maker is needed for P04.
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
- Configuration gates: G01 pins and G06 foundations satisfied on the clean committed acceptance revision. No economic configuration gate was invented or closed.
- Checks actually run: `pnpm install` in both independent roots; `cargo generate-lockfile`; locked SBPF v0 build; locked `anchor idl build`; `pnpm typecheck`; `pnpm test` (7 ABI/wallet-import checks pass); `pnpm generate:check`; `cargo fmt -- --check`; installed graph check (77 packages, modern SDK/wallet versions, no legacy runtime imports).
- First full `bash ops/smoke.sh`: PASS at `.local/runs/20261020T170408Z-67907`, explicitly a dirty implementation tree. Final authority: `cargo clean` then `source ops/env.sh && pnpm smoke` PASS on `9170a3862e19b93e6780abf2a245b277c9bdf09a`, `sourceDirty: false`, run `.local/runs/20261020T171159Z-71622`. Three successful probes, one failed two-instruction probe with a retained-but-reverted event, independent Ed25519 verification, live Anchor account/event decode, five WS subscriptions, five history entries and before/until pagination all pass. First probe: 322 bytes, five message accounts, 10,492 simulated CU.
- Failures resolved: v1.57 download ENOSPC; installed v1.52 missing SBPF v3 target; Anchor's differing SBF/IDL argument forwarding; renderer's package-root output convention; sandbox TSX CLI IPC restriction (use `node --import tsx`); dependency tree CLI expansion exceeded its output buffer (replaced with visited-set traversal of actual installed manifests); pnpm lifecycle inherited a relative store into the separate conformance root (fixed with an explicit absolute store and noninteractive repair).
- Checks not run: P02+ economics/custody/SVM cases, PostgreSQL/service recovery, browser wallet signing, load/24-hour soak, devnet and external review. Those programs/services/phases do not yet exist. Optional legacy native accelerators remain disabled.
- Evidence / identities: initial runtime reports Surfpool 1.6.1 / solana-core 4.2.1 / feature-set 565236538; program `Egn8THHpn7AxDMZKgBKui5YTdTcwn2wxwXkFuKzDDbKo`; binary SHA-256 `560c7c6bb499cbf406be7e8e4edbae43cca27bdf13f227b17e6480073bc24002`; IDL SHA-256 `195ec9a1ce4f30117fef4e4774b26232f9f60a70166c812293bd169da1f1235f`.
- Evidence committed: [report](evidence/P01.md) and [actual JSON captures](evidence/p01/); full build/smoke output remains `.local/p01-clean-acceptance.log`. Final `cargo fmt -- --check`, `git diff --check` and clean generated-tree checks pass; no task RPC/WS listener remained.
- PR / integrated commit: [draft PR #1](https://github.com/arnabnandikgp/rivalt/pull/1); executable commit `9170a38`; evidence closeout is documentation only. No merge or main-baseline integration claimed.
- Phase status: Review. A01/G01 and G06 foundations pass; integration remains. M1 remains In progress because P02 is Open.
- Blockers: no current access/product blocker; B01 resolved by the tested profile. GitHub access was rechecked outside the network-restricted sandbox and succeeds.
- Next concrete action: review and integrate PR #1; then start P02 by freezing and independently testing G02/G03 before adding real SPL custody.

### R002 — 20 October 2026 — review workflow amendment

- Starting revision: `88b6319`, `phase/p01-spine`; clean working tree.
- Delivered: adopted existing P01 with `gh stack init --base main phase/p01-spine`; `gh stack submit --auto --open` converted PR #1 to ready for review. AGENTS, DELIVERY-PLAN, DECISIONS D18 and live status now allow verified dependent implementation without merge waits.
- Actual checks: installed `github/gh-stack` v0.1.0 help; `gh stack view --json` reports main → phase/p01-spine, no rebase required; `gh pr view 1` reports OPEN, `isDraft: false`, base main, head `88b6319`.
- Evidence / PR: [PR #1](https://github.com/arnabnandikgp/rivalt/pull/1); P01 remains Review. No merge, review approval or new financial test claimed.
- Tests not rerun: executable code unchanged; P01's recorded acceptance remains applicable.
- Blockers: none.
- Next action: create the P02 child with `gh stack add phase/p02-custody` and implement its financial/custody deliverable.

### R003 — 20 October 2026 — P02 — accounting and real SPL custody

- Starting revision / branch: `e060979106a126217dc71619934c3ca656119f11`, clean `phase/p02-custody`, created by `gh stack add` above P01. No unrelated work was present or changed.
- Delivered: framework-independent checked financial core; exact fees/accrual/risk/reservation/generation and full-cohort default math; versioned synthetic profile; guarded real SPL initialization/registration/deposit/withdraw/insurance/surplus/pause; generated SDK/IDL; shared signed custody scenarios for LiteSVM and Surfpool; isolated legacy conformance for all new instruction families and live accounts/events.
- Decisions/specifications: D19/G02 precision and fractional allocation, D20/G03 profile and custody authority; README, PROTOCOL, COMPONENTS, STACK-AND-VALIDATION and P02-ACCOUNTING-AND-CUSTODY updated. Later financial paths remain absent/disabled.
- Actual checks so far: `cargo fmt -- --check`; pinned SBF/IDL generation with fatal stack diagnostics; `pnpm typecheck`; `pnpm test` (8 tests, including all seven custody instruction families); `pnpm test:financial` (11 targeted Rust tests, 1,200 arbitrary-precision allocation cases, 1,200 funding cases, 600 full-default cases, compiled profile check); `pnpm test:svm` (99 signed scenarios, including actual 64-member registration and rejected 65th); installed graph validation (82 packages, legacy isolation).
- Preliminary full `pnpm smoke`: PASS at `.local/runs/20261020T175331Z-94259`, explicitly dirty/uncommitted. P01 regression plus 33 signed Surfpool custody scenarios, 10 committed custody events, failed-token-CPI rollback/event exclusion and independent live Anchor decode. Final cash C/P/T is zero, vault and insurance exactly 10,007 atoms. The later valuation-headroom test/change separately passed the financial suite; a final combined clean-commit run remains required.
- Resolved findings: Anchor token `init` derives require the token_2022 helper feature while all actual account/CPI types remain classic Token; Anchor IDL requires a single error definition; fixed-array registry exceeded SBF stack and was replaced with a bounded vector; Anchor rejects aliases with 2040 before the explicit constraint; canonical legacy/generated byte-array JSON shapes normalized; default valuation retains headroom beyond the ordinary stored-v bound and generation exhaustion reserves a final close.
- Final authority: `source ops/env.sh && pnpm smoke` PASS on clean `3d9c8c30e5a8299f91b8fca0f22d5dc686e1ae0b` at `.local/runs/20261020T175800Z-96722`; financial, SVM, P01 and custody reports all record `sourceDirty: false`. 8 Vitest tests, 11 targeted Rust tests, 3,000 independent rational cases plus profile check, 99 signed LiteSVM scenario transactions (81 accepted / 18 expected rejections) and 33 Surfpool scenario transactions (18 accepted / 15 expected rejections). Counts include fixture provisioning and rejection cases. Ten committed custody events match live legacy decode; a failed transaction retains one explicitly excluded event. Final vault/insurance is exactly 10,007 atoms. [Committed evidence](evidence/P02.md) includes the actual acceptance log, hashes, raw events/account bytes and signatures. Published ready [PR #2](https://github.com/arnabnandikgp/rivalt/pull/2) with `gh stack submit --auto --open`; `gh pr view 2` confirms OPEN, `isDraft: false`, base `phase/p01-spine`. P01 #1 remains OPEN/ready. No merge, independent review or nonlocal deployment claimed.
- Not run: maker execution/route A03–A05, PostgreSQL/services A06 onward, authenticated funding, operational paginated default, browser, load/soak, devnet and external review; those implementations belong to later phases. V05 route/protection checks are model-only, not A04/A12 completion.
- Phase status: P02 Review; G02/G03 and A02 verified on the committed branch. Combined A01/A02 meets the M1 engineering exit check. M1 remains Review until both PRs integrate.
- Blockers: none; no credential, participant or product decision needed.
- Next exact action: `gh stack add phase/p03-makers`, then implement G04's maker interface/curves and capital authorization on verified P02 without waiting for merge.

### R004 — 21 October 2026 — P01/P02 — address reviews and integrate

- Starting revision / branch: clean `d9aff94d4fe1337e09c59d4e1da2c09201e90842`, `phase/p02-custody`. Read both PRs' review summaries and all four inline findings. No unrelated changes were present.
- Delivered: P01 `081d614` fixes committed SDK/IDL drift detection, explicit bounded Surfpool readiness failure and stale draft status. P02 `16e51e4` replaces the undeclared ripgrep SBF check with system grep and rejects checker failures. `gh stack rebase --no-trunk` cleanly restacked P02; `gh stack submit --auto --open` pushed both ready PRs.
- Specifications: P01-SPINE, STACK-AND-VALIDATION and D21 record the strengthened acceptance contract. Economics, program ABI, dependencies and G02/G03 profile are unchanged.
- Actual checks: P01 `source ops/env.sh && pnpm smoke` PASS on clean `081d614` at `.local/runs/20261021T063225Z-56957`; 7 ABI tests, signed deployment/probes, independent RPC decode/signature verification, five WS subscriptions, history and rollback. Combined P01/P02 `pnpm smoke` PASS on clean `16e51e4` at `.local/runs/20261021T063416Z-59770`; 8 ABI tests, 11 Rust tests, 3,000 independent reference cases plus profile check, 99 signed LiteSVM scenarios (81 accepted / 18 expected rejections), 33 signed Surfpool custody scenarios (18 accepted / 15 expected rejections), 10 committed custody events and exact final vault/insurance 10,007 atoms. All source identity records are clean. Shell syntax, Rust formatting and whitespace checks pass.
- Targeted failures: 15 shell guard fixtures pass, covering committed/staged/untracked SDK drift, IDL drift, startup timeout/HTTP error/process death, each unsafe SBF pattern, missing log and missing checker. These synthetic harness checks are separate from real signed RPC acceptance.
- Evidence: [review verification report](evidence/R004-REVIEW.md) and [captured logs/JSON](evidence/r004/). Program/IDL hashes match the earlier phase artifacts. Replies identify fixes and verification; all four original review threads are resolved. Automated review is not M6 independent review.
- Checks not run: later-phase makers/routes, PostgreSQL/services, oracle/funding/orders/operational default, browser, load/soak, devnet and independent/funded gates; those implementations do not exist yet.
- Integration: user explicitly directed proceeding without waiting for the automated re-review. `gh stack merge --yes --merge` atomically merged #1/#2 into `3c1aae1d85b86829d0f921612c1b7e834d4fcf76`; GitHub reports MERGED at 2026-10-21T06:41:52Z / 2026-10-21T06:41:53Z. P01 re-review was still pending at the last premerge check; no completed re-review is claimed. Fetched main and `git diff --exit-code a19c79c 3c1aae1d85b86829d0f921612c1b7e834d4fcf76` passed for the entire tree; executable content also equals tested `16e51e4`. M1/P01/P02 Closed. Documentation links, clean evidence identities and released loopback ports also pass. No further full rerun was needed after the content-identical merge.
- Blockers: none.
- Next exact action: implement G04 on `phase/p03-makers`, created with `gh stack init --base main phase/p03-makers`; open the next phase PR ready for review.

### R005 — 21 October 2026 — P03 — maker programs and capital authorization

- Starting baseline: verified merged main `3c1aae1d85b86829d0f921612c1b7e834d4fcf76`; branch created with `gh stack init --base main phase/p03-makers` after the user's instruction to merge and start the next PR.
- Delivered so far: separate A/B deployments and owner-bound configs; shared bounded pricing contract; distinct owner-funded clearing registrations and anti-alias capital bindings; read-only CPI/return validation; checked expired-epoch publication/sync; quarantine and whole-ProgramData hash approval; three generated clients and bigint off-chain pricing. Financial fills remain absent.
- Configuration/specifications: D22/G04 and P03-MAKER-CONTRACT pin exact curves, capacity, duration, reset, control, hash and return contracts. README, PROTOCOL, COMPONENTS and STACK-AND-VALIDATION updated. Existing participant PDA SDK entry point preserved as an alias after Codama's new capital-role naming.
- Actual preliminary checks: locked SBF/IDL build for all three programs; 5 Rust maker tests with 4,000 independently enumerated marginal-lot vectors; typecheck; 10 Vitest tests including all eleven new instruction families against isolated legacy Anchor and the same 4,000 vectors in bigint TypeScript; 51 signed P03 LiteSVM scenarios plus 33 real custody setup scenarios. Wrong/unfunded/withdrawn capital, alias reuse, wrong module/config, stale/expired epochs, early/same-epoch reset, quarantine, wrong approval owner and unapproved ProgramData metadata reject. Quotes preserve actual balances and consumption. Full RPC acceptance remains pending at this checkpoint.
- Failures resolved during implementation: Borsh 1.8 serialization uses serialize into Vec rather than removed try_to_vec; Codama flattens request structs and renames the shared participant PDA after the capital role; explicit common instruction typing preserves separate program IDs in cross-client tests. No external dependency versions changed.
- Evidence so far: `.local/p03-build.log`, `.local/p03-math.log`, `.local/p03-abi.log`, `.local/p03-makers.log`, `.local/p03-svm.json` are preliminary dirty-tree results, not final acceptance authority.
- First full clean-commit run: `RIVALT_SLOT_TIME=20 pnpm smoke` PASS on `5212272` at `.local/runs/20261021T071101Z-74416`; 53 signed P03 RPC scenarios, 12 committed clearing events, 18 legacy-decoded returns, real signed maker upgrade rejection and joint reapproval. Final checks additionally require explicit whole-vault reconciliation, the minimum epoch bound and unsupported config-version rejection; rerun pending on that final checkpoint.
- Final acceptance authority: `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` PASS on clean `e05a20e69fb5dedb23734881d88137b2dcb986e7`, run `.local/runs/20261021T072031Z-79492`. All three pinned SBF/IDL builds, generated drift/type checks, 10 Vitest tests, 5 Rust maker tests with 4,000 independently enumerated vectors (also checked in TypeScript), 11 Rust financial tests and 3,000 Python reference cases plus profile comparison pass. P03 has 54 signed LiteSVM scenarios and 54 signed RPC scenarios (each 34 accepted / 20 expected rejections; the runtime-specific four cases differ). LiteSVM also uses 33 actual custody setup scenarios. P01/P02 regression passes on the same new artifacts, including 99 P02 SVM and 33 P02 RPC scenarios. Twelve committed clearing events, 18 legacy-decoded quote returns, real local upgrade rejection/joint reapproval and raw token-balance reconciliation pass. Final vault=allocated=1,000,010,007 atoms; maker C totals 1,000,000,000, I=10,007 and P/T=0.
- Resources / evidence: [report](evidence/P03.md), [manifest and actual captures](evidence/p03/); preview 426 bytes / eight message accounts / at most 113,216 CU, one read-only config in CPI, 92-byte return. Full output and all failed-transaction metadata remain in the named run directory. Final formatting/whitespace checks pass. These are finite local fixtures, not throughput/soak or external review.
- Not run: atomic routes, PostgreSQL/service lifecycle, authenticated sources/funding, orders/default, browser, soak, devnet and external/funded gates, which belong to later phases.
- PR publication: `gh stack push`, `gh pr create` with an explicit title/body (no draft), then `gh stack submit --auto --open`. GitHub confirms [PR #4](https://github.com/arnabnandikgp/rivalt/pull/4) OPEN, `isDraft: false`, base main, branch `phase/p03-makers`; gh stack records the correct parent. Final closeout changes only documentation from tested `e05a20e`; formatting, documentation links, executable-tree parity and released RPC/WS ports pass.
- Status: P03 Review; A03/G04 verified, ready PR #4 awaits integration. M2 In progress until P04 and the cross-phase exit pass. M1/P01/P02 remain Closed with recorded integration evidence.
- Blockers: none.
- Next exact action: `gh stack add phase/p04-routes`, then implement G05 atomic one/two-maker execution and independent allocation on the verified P03 baseline; no merge wait.

### R006 — 21 October 2026 — P04 — atomic routes and allocation

- Starting baseline: clean `4ef648cac57f17df06f15c3cdb77d0d7cb271eeb` on P03; `gh stack add phase/p04-routes` created the child branch above ready PR #4 without waiting for merge.
- Delivered: exact one/two-maker FOK authority, bounded read-only CPI, paired q/v, aggregate fee, post-health/caps, checked nonce/generation and cumulative consumption; critical execution events; exact bigint allocation; explicit compile-gated synthetic risk observations; exposed deposits with trading-mode withdrawals disabled; hostile replacement fixture and full rollback checks.
- Specifications: P04-ATOMIC-ROUTES, D23/D24, README, PROTOCOL, COMPONENTS and STACK-AND-VALIDATION describe the implemented boundaries and G05 values. No external versions changed; Cargo.lock adds only the local hostile fixture crate.
- Preliminary checks: locked default/local SBF and IDL builds; typecheck; 12 Vitest checks including new ABI families against isolated Anchor and 600 independent allocation/health vectors; 2 new Rust candidate-accounting tests plus 11 financial regressions; 67 signed P04 LiteSVM scenarios plus 83 real custody/maker setup scenarios. These dirty-tree results are provisional. Additional execution-band case and final full acceptance remain pending.
- Preliminary evidence: `.local/p04-build.log`, `.local/p04-core.log`, `.local/p04-unit.log`, `.local/p04-routes.log`, `.local/p04-svm.json`; observed maximum 254,011 CU and 972 bytes in this finite SVM fixture, not final RPC qualification.
- Resolved implementation issues: build per program to isolate the clearing feature; explicit PDA error conversion; event borrow lifetime; optional Codama accounts use undefined while legacy Anchor uses null.
- Not run yet: final clean full acceptance and actual P04 RPC/WS. PostgreSQL/services, authenticated source/funding, orders/default, UI, soak, devnet and external/funded gates belong to later phases and are not claimed.
- Status: P04 In progress, M2 In progress; P03 remains Review. No access/product blocker.
- Next exact action: commit the coherent P04 checkpoint, then run `RIVALT_SLOT_TIME=20 pnpm smoke` and publish the ready child PR once acceptance passes.

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

