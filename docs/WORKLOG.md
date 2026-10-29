# Rivalt implementation worklog
Baseline R1 · initialized 20 October 2026

**Maker-liquidity implementation (R079 / D70):** the user authorizes sequential
[P29B–P34 implementation](P29-MAKER-LIQUIDITY-ROADMAP.md). P29A remains in Review
as ready [PR #42](https://github.com/arnabnandikgp/rivalt/pull/42). P29B's
[contract/reference](P29B-MAKER-CONTRACT.md) passes A34B/G22 on `b0c504a` and is published in ready [PR #43](https://github.com/arnabnandikgp/rivalt/pull/43), stacked above #42 in Review. P30 A35/G23 acceptance passes on pinned code and ready [PR #45](https://github.com/arnabnandikgp/rivalt/pull/45) is open above #43 in Review. Local quote/control deployment is tested, with new trading disabled. R082 resumes P31–P34 under the user’s new instruction; P31 A36/G24 passes on pinned code above exact P30 head `b7e76e3`; ready [PR #46](https://github.com/arnabnandikgp/rivalt/pull/46) is open in Review. P15B/P16B stay Open; 24-hour endurance stays Deferred.

**Current position:** P01–P14 and M1–M5b are Closed. The original phase stack, readability maintenance and [R030 devnet closeout PR #19](https://github.com/arnabnandikgp/rivalt/pull/19) are integrated into `main`. PR #19 merged at `67059fc99ca3b48cff4d89e9f97aa9c1c51538eb`; its tree exactly matches verified head `633892c`. Actual maker upgrades/joint approvals, corrected ownership checks, independent accounting and fresh PostgreSQL/HTTP verification close the remaining engineering follow-up. P15A maker kit/tooling and P16A engineering reliability are now Closed: PRs #20/#21 merged at `74fc2963341a5a4cfacb027fed7d51c071e72265` under D44, with both review findings resolved and scoped CI passing. M6 remains In progress because external P15B/P16B remain Open. Continuous 24-hour endurance stays Deferred under D42.

**Successor integration (R053):** P17, P18A–C, P19, P20 and P21A–B are Closed within their bounded local test scope. The user authorized merging the complete successor stack; PRs #23/#24/#26/#27/#28/#29/#30/#31 merged atomically at `d07fccc108384381c0c5df743d14c2a0bc4f5089`. The merged tree exactly equals reviewed tip `1a3cc2c0c86e8ec9f1c87d8f8451ac72057274e9`. A22–A26/G13–G16 and the M7 exit retain their phase-specific pinned evidence, including R052 service and receipt fixes; no new runtime qualification is inferred from the merge. All seven prior review findings are resolved, the final sweep found no new findings or requested changes, and every selected hosted check passed. M7 is Closed for the operator-controlled two-market test profile. Busy-group exit redesign is explicitly deferred by the user; P15B/P16B remain Open and 24-hour endurance remains Deferred. No successor devnet/funded deployment or independent-review approval is claimed.

This is the sole implementation roadmap and live status record. The old research roadmap remains historical provenance outside the working directory. Update these tables and append a run entry after every substantive implementation run.

**Account-centric integration (R073 / D67):** P22A–P28 and M8 are Closed within
the qualified local test scope. All eight PRs #32/#33/#35/#36/#37/#38/#39/#40
merged atomically at `0916b9dc7896f9cdfc68081ad56daa93dabf3d94`. Its tree exactly matches
reviewed/remediated tip `e6ba2cfdbdb41dbfe037453ed75444f3baf94aa3`. All 11 inline threads
are resolved; the additional serialization-test suggestion is implemented. Scoped
local checks and all five refreshed hosted jobs pass; CodeRabbit skipped a fresh
review, so no new review approval is claimed. [The review report](evidence/R073-STACK-REVIEW.md)
preserves all dispositions. P26 artifacts and phase-specific P27/P28 runtime pins
are unchanged. P15B/P16B remain Open; continuous 24-hour endurance stays Deferred.

**Stack review checkpoint (R028):** All 21 inline review findings (15 original plus six follow-ups) are resolved with fixes or verified non-issues. The final 13-PR sweep found zero unresolved threads, no requested changes and no failing checks before the authorized atomic merge. Local `main` is fast-forwarded to the merge; its tree exactly matches tested remediation head `3b1c0be`. All 526 raw evidence files remain ignored at their original paths with matching hashes.

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
| M2 | P03–P04 | Competing makers and atomic execution | Closed | Fresh A03–A05/G04/G05 and cross-phase exit pass on `b8e5fb8`; PRs #4/#5 merged at `2bc298e` |
| M3 | P05–P06 | Real services and full trade lifecycle | Closed | Fresh A05–A08/G07 and complete service exit pass on `2578327`; PRs #7/#8 merged at `2bc298e` |
| M4 | P07–P10 | Funding, orders, risk recovery and usable UI | Closed | P07–P09 gates verified; [P10 A15 and M4 browser/direct-exit checks](evidence/P10.md) pass on clean `881ae54`; unchanged program baseline retains G08–G10; merged PR #12; integrated at `2bc298e` |
| M5a | P11–P12 | Complete local engineering evidence | Closed | [P11 A01–A16](evidence/P11.md) and [P12 revised A17](evidence/P12.md) verified; 1,249/1,249 submitted trades, 71.19% normal offered availability, affected recoveries, actual exit and 12,454-transaction fresh PostgreSQL replay; merged PR #14 records the indexer pause during separate history generation; integrated at `2bc298e`; 24-hour endurance deferred to P16 under D35 |
| M5b | P13–P14 | Focused real-cluster parity | Closed | Original [A18/G11](evidence/P13.md) and [A19](evidence/P14.md) pass; PRs #15/#16/#17 merged at `2bc298e`. Clean `3b1c0be` read-only devnet/PostgreSQL/HTTP check passes. R029 source refactor passes scoped validation and is integrated via PR #18 at `4d4a908`; [R030 rollout](evidence/R030-DEVNET-CLOSEOUT.md) and corrected ownership/independent audit/75-transaction PostgreSQL reconciliation pass; closeout PR #19 merged at `67059fc` |
| M6 | P15A/P16A + P15B/P16B | Maker engineering/tooling/reliability plus independent commercial/pilot readiness | In progress | R033: A20A/A21A acceptance retained; two maker-kit findings fixed with nine focused regressions and scoped CI passing. PRs #20/#21 integrated at `74fc296`, closing both A phases; external P15B/P16B Open; endurance Deferred; A cannot close B or M6 |
| M7 | P17–P21 | Bounded two-market isolated/cross successor | Closed | R053: all eight phase PRs integrated at `d07fccc`, tree identical to reviewed `1a3cc2c`. A22–A26/G13–G16 and [bounded M7 exit](evidence/P21B.md) retain their actual pins; R052 recovery/receipt regressions and scoped CI pass. Busy exits 0/3 versus quiescent exits 3/3 remain explicit; redesign now M8 under D56; endurance Deferred, P15B/P16B Open |
| M8 | P22–P28 | Account-centric clearing redesign | Closed | R073: eight PRs integrated at `0916b9d`, tree identical to reviewed `e6ba2cf`; all findings addressed and selected CI passing. [P28 A33/G21/M8 exit](evidence/P28.md) retains browser `f595fd7` / workload-recovery `5491752`; [review corrections](evidence/R073-STACK-REVIEW.md) add scoped checks, not a new runtime run |
| M9 | P28A | Interactive local evaluation follow-up | Closed | [PR #41](https://github.com/arnabnandikgp/rivalt/pull/41) merged at `350e60c`, identical to checked `ba73bcd`; [P28A acceptance](evidence/P28A.md) retains 13 real browser originals on `4f809d3`, plus R076’s 16 focused cases and passing scoped CI; user walkthrough accepted; demo stopped. R077 quoting assessment is discussion only; no qualification/status change |
| M10 | P29A–P34 | Programmable maker liquidity and bounded routing | In progress | R079/D70 authorizes implementation; P29A remains Review in #42, P29B A34B/G22 model/contract checks pass on `b0c504a`; ready PR #43 is in Review above #42. R081: P30 A35/G23 passes, including123 signed RPC outcomes and legacy event parity; P30 is Review in ready PR #45 above #43. R082: P31 A36/G24 passes: 415 independent cases, 47 scoped tests, 73 signed RPC/WS outcomes and 1,000 maximum-width searches; ready [PR #46](https://github.com/arnabnandikgp/rivalt/pull/46) is open above #45. R085/D74: user selects published-liquidity funding without hypothetical maker financial checks; implementation and focused native/reference checks pass. Clean `2a93394`100-lot sample lands with correct event/legacy parity at1,334,329CU, failing20% headroom;600-lot/zero-cash runtime checks not reached. Historical failures remain recorded. R087/D76 freezes and implements the restricted publisher candidate: 6 report-contract +4 causal native tests and6 focused SDK cases pass; generated ABI/typecheck pass. Clean`9129bda`client/`94e0645`SBF reports land at30,511–30,571CU/871bytes/14keys, including600lots/zero cash. Scope probe reaches7 accepted reports and rejects authority/replay/control failures, then a shape-control transaction fails320k headroom at337,446CU. Exact post-CPI verification optimization pending remeasurement. Execution/integrated gates and P33/P34 remain |

## Phase overview

| Milestone | Phase | PR deliverable | Status | PR / commit | Evidence / next dependency |
|---|---|---|---|---|---|
| M1 | P01 | Toolchain, SDK and RPC spine | Closed | [PR #1](https://github.com/arnabnandikgp/rivalt/pull/1), tested `081d614` | [R004 acceptance](evidence/R004-REVIEW.md); G01/G06 foundations pass; merged `3c1aae1` |
| M1 | P02 | Financial core and custody | Closed | [PR #2](https://github.com/arnabnandikgp/rivalt/pull/2), tested `16e51e4` | [R004 acceptance](evidence/R004-REVIEW.md); G02/G03 pass; merged `3c1aae1` |
| M2 | P03 | Maker programs and capital authorization | Closed | [PR #4](https://github.com/arnabnandikgp/rivalt/pull/4), tested `e05a20e` | [A03 evidence](evidence/P03.md); G04 verified; integrated at `2bc298e` |
| M2 | P04 | Atomic routes and allocation | Closed | [PR #5](https://github.com/arnabnandikgp/rivalt/pull/5), tested `b8e5fb8`, stacked above #4 | [A04/A05/G05 evidence](evidence/P04.md); integrated at `2bc298e` |
| M3 | P05 | Indexer, database and read API | Closed | [PR #7](https://github.com/arnabnandikgp/rivalt/pull/7), tested `fb2606f`, stacked above #5 | [A06/G06 evidence](evidence/P05.md); integrated at `2bc298e` |
| M3 | P06 | Maker daemons and complete service lifecycle | Closed | [PR #8](https://github.com/arnabnandikgp/rivalt/pull/8), tested `2578327`, stacked above #7 | [A05/A07/A08/G07 and M3 exit evidence](evidence/P06.md); integrated at `2bc298e` |
| M4 | P07 | Oracle policy and authenticated funding | Closed | [PR #9](https://github.com/arnabnandikgp/rivalt/pull/9), tested `83f70d4`, above #8 | [A09/A10/G08 evidence](evidence/P07.md); integrated at `2bc298e` |
| M4 | P08 | Persistent orders and TP/SL | Closed | [PR #10](https://github.com/arnabnandikgp/rivalt/pull/10), tested `cd2b8fa`, above #9 | [A11/A12/G09 evidence](evidence/P08.md); integrated at `2bc298e` |
| M4 | P09 | Liquidation and resumable default | Closed | [PR #11](https://github.com/arnabnandikgp/rivalt/pull/11), tested `8e8f371`, above exact #10 head `b9e6115` | [A13/A14/G10 evidence](evidence/P09.md); integrated at `2bc298e` |
| M4 | P10 | Trading UI and direct exit experience | Closed | [PR #12](https://github.com/arnabnandikgp/rivalt/pull/12), tested `881ae54`, above exact PR #11 head `828c5e3` | [15 targeted browser/direct-exit checks](evidence/P10.md), affected client/build checks and independent integer reconciliation pass; broad wrapper intentionally stopped after orders; integrated at `2bc298e` with R028 affected regression checks |
| M5a | P11 | Integrated fault and reconciliation matrix | Closed | [PR #13](https://github.com/arnabnandikgp/rivalt/pull/13), tested `8067159`, above exact #12 head `cb42c56` | [Fresh A01–A16 evidence](evidence/P11.md); integrated at `2bc298e` |
| M5a | P12 | Resource budgets, load and bounded qualification | Closed | [PR #14](https://github.com/arnabnandikgp/rivalt/pull/14), tested `c8fd613` plus recorded history-stage indexer pause; published `18b5e38` above #13 | [A17 evidence](evidence/P12.md): real 30-minute qualification, all 1,249 submissions finalized, 10,001 actual deposits, 12,454 RPC transactions rebuilt into fresh PostgreSQL, exact final vault/exit/fees; final harness automates observed pause; 24-hour endurance deferred, not passed; integrated at `2bc298e` with R028 affected regression checks |
| M5b | P13 | Devnet deployment and real dependency verification | Closed | `phase/p13-devnet`, deployed build `b25a857`, live trade `8e3c655`, above exact #14 head `e0c1826`; merged [PR #15](https://github.com/arnabnandikgp/rivalt/pull/15) | [A18/G11 evidence](evidence/P13.md): actual accepted trade at slot 514265248, 17-atom fee, exact upstream/accounting audit, stale rejection; missed live log retained and original signature recovered over WS; 20-second tested policy, 30-second devnet allowance prospective; integrated at `2bc298e`; R030 actual A/B upgrades, joint approvals and corrected owner-binding checks pass; closeout PR #19 merged at `67059fc` |
| M5b | P14 | Devnet lifecycle, wallet and provider recovery | Closed | Merged [PR #16](https://github.com/arnabnandikgp/rivalt/pull/16), `phase/p14-lifecycle` above exact P13 PR #15 head `93c1ef4`; published `f70ac71` | [A19 evidence](evidence/P14.md): 30-second devnet boundary/upgrade, actual PostgreSQL recovery, bounded order/cancel/close/settle/withdraw and independent raw-account audits; actual Phantom registration on clean `e968063` finalized at slot 514303068 with exact indexed signature; original engineering exit passes; integrated at `2bc298e`; [D38 cleanup](STACK-CLEANUP.md) verified and pushed; raw files remain local; R028 review sweep/remediation merged; R029 source refactor passes scoped validation and is integrated via PR #18 at `4d4a908`; R030 independent accounting and fresh PostgreSQL/HTTP reconciliation pass; closeout PR #19 merged at `67059fc` |
| M6 | P15A | Maker integration kit and economics tooling | Closed | [PR #20](https://github.com/arnabnandikgp/rivalt/pull/20), tested `09afdfc`; review fixes `cfd51e1`; merged `74fc296` | [A20A evidence](evidence/P15A.md): fresh operator checkout, actual 127.876-second workflow, 19 unit checks, independent accounting/fees; R033 fixes both findings with nine scoped regressions, passing CI and resolved threads |
| M6 | P16A | Engineering reliability and operational readiness | Closed | [PR #21](https://github.com/arnabnandikgp/rivalt/pull/21), tested `17e88fc`; restacked head `21d8274` above #20 `cfd51e1`; merged `74fc296` | [A21A evidence](evidence/P16A.md): full P12 population diagnosis, eight scoped checks and 128.814-second actual recovery/replay/direct-exit run pass; no actionable PR #21 findings; parent fixes restacked and scoped CI passes; endurance Deferred |
| M6 | P15B | Independent maker validation | Open | — | P15A plus actual independent operator; internal makers/simulated hedges do not qualify |
| M6 | P16B | Independent review and funded-pilot readiness | Open | — | P16A + P15B plus actual review/calibration/authorization; A completion does not close B |
| M7 | P17 | Account/group contract and concrete gap audit | Closed | [PR #23](https://github.com/arnabnandikgp/rivalt/pull/23), tested `5a4dc84`, above `b005478` | A22/G13: code audit, exact layouts, authority/migration and D45–D48; five scoped tests/190 local links pass; integrated at `d07fccc` |
| M7 | P18A | Group/portfolio/account custody and two market identities | Closed | [PR #24](https://github.com/arnabnandikgp/rivalt/pull/24), tested `6389c3e`, above P17 `20daf32` | [A23A custody](evidence/P18A.md): 136 signed SVM / 51 finalized RPC scenarios, ABI parity and independent raw-byte accounting; integrated at `d07fccc` |
| M7 | P18B | Two-market isolated sources/makers/routes/orders | Closed | [PR #26](https://github.com/arnabnandikgp/rivalt/pull/26), tested `286cb4e`, above P18A `1d08944` | [A23B](evidence/P18B.md): 17 focused Rust tests, ABI parity and 154 signed scenarios; isolated activation subsequently qualified in P18C; integrated at `d07fccc` |
| M7 | P18C | Isolated group settlement/liquidation/default and activation | Closed | [PR #27](https://github.com/arnabnandikgp/rivalt/pull/27), tested `b43261f`; active-route extension `298f446`, above P18B `a912ebb` / #26 | [A23C/G14](evidence/P18C.md): 1,132 signed SVM scenarios, two complete 64-member audits, 148 finalized RPC / 81 expected WS outcomes; isolated-only checkpoint; later cross activation qualified in P20; integrated at `d07fccc` |
| M7 | P19 | Bounded cross engine/funding/reserves/transfers/netting | Closed | [PR #28](https://github.com/arnabnandikgp/rivalt/pull/28), tested `4274d28`, published `c0b7898`, above #27 | [A24/G15 core](evidence/P19.md): 40 scoped Rust tests, 226 signed SVM / 224 finalized RPC and 109 expected WS outcomes; cross-disabled core checkpoint; integrated at `d07fccc` |
| M7 | P20 | Cross liquidation/default and qualified activation | Closed | [PR #29](https://github.com/arnabnandikgp/rivalt/pull/29), published `459c84c`, tested `3c7ab4e` core / `aadb69f` budgets, above P19 #28 `c0b7898` | [A25/G15](evidence/P20.md): 1,224 SVM / 1,221 finalized RPC + 215 SVM / 212 finalized RPC maximum-book cases; 820/820 and 95/95 WS; byte-identical qualified local profile; integrated at `d07fccc` |
| M7 | P21A | Group SDK/indexer/API and durable services | Closed | [PR #30](https://github.com/arnabnandikgp/rivalt/pull/30), final head `61bbfba`, merged `d07fccc` | [A26A/G16 interfaces](evidence/P21A.md): exact incremental SDK/service/financial/recovery acceptance through `882f832` plus auditor `ac828f6`; R052 finalized-tail/funding-expiry RPC/WS/PostgreSQL checks pass on `e4a284c`; scoped CI and integration verified |
| M7 | P21B | UI/operations and fresh successor qualification | Closed | [PR #31](https://github.com/arnabnandikgp/rivalt/pull/31), final head `1a3cc2c`, merged `d07fccc` | [A26B/G16/M7](evidence/P21B.md): browser `a0ed6de`, workload `6e9fd2f`, independent audit `813ee20`; 25 wallet originals, 150 offers/101 fills, fault recovery, flat drain, three quiescent token exits and fresh PostgreSQL replay. R052 receipt race passes on `c0e5274`; scoped CI/integration pass. Busy-exit follow-up now M8 under D56 |
| M8 | P22A | Architecture roadmap and financial decision boundaries | Closed | [PR #32](https://github.com/arnabnandikgp/rivalt/pull/32), checked `8321677`, above `9d3c295` | A27A: 244 local links, fences, phase rows/dependencies, D56 consistency and evidence policy pass; no code or financial acceptance; integrated at `0916b9d` |
| M8 | P22B | Exact financial contract and independent reference cases | Closed | [PR #33](https://github.com/arnabnandikgp/rivalt/pull/33) above #32 `64615a4`; checked `0d78bf0`; R059 publication below | [A27B/G17](evidence/P22B.md): complete D60 normal/default/authority/migration/layout contract; bounded integer/independent Fraction parity, payment/netting/replay negatives, 14 inert layouts. 88 Python plus three Rust checks pass; no runtime qualification; integrated at `0916b9d` |
| M8 | P23 | Registry, accounts and custody | Closed | [PR #35](https://github.com/arnabnandikgp/rivalt/pull/35), head `de5db9d`, above #33; checked `4500168` | [A28/G18](evidence/P23.md): 139 signed SVM / 57 actual RPC outcomes, 11-instruction and eight-account legacy parity, exact raw-byte/token audit, 64-member SVM bound; max 89,854 CU / 753 bytes / 16 accounts. Trading disabled; integrated at `0916b9d` |
| M8 | P24 | Risk, funding, routes and orders | Closed | [PR #36](https://github.com/arnabnandikgp/rivalt/pull/36), head `f8f5dac`, above #35; tested `4a0763d` | [A29/G19 core](evidence/P24.md): 329 SVM / 313 finalized RPC outcomes; 23 ABI variants, 28 accounts / 134 event parity, 175 WS notifications; exact 49-transition / 16-fill audit. Max route 473,764 CU, overall 1,191 bytes / 24 accounts. Ordinary activation disabled; integrated at `0916b9d` |
| M8 | P25 | Cash, claim settlement, transfers and atomic exits | Closed | [PR #37](https://github.com/arnabnandikgp/rivalt/pull/37), head `75e34c5`, above #36; tested `12a23e6` | [A30/G19 cash](evidence/P25.md): nine Rust tests, 14 ABI variants, 631 SVM / 629 finalized RPC, 446 WS, 86-account/415-event parity and 57-transition independent audits. P25 cash checkpoint; P26 safety separately qualified; integrated at `0916b9d` |
| M8 | P26 | Liquidation, complete default and local activation | Closed | [PR #38](https://github.com/arnabnandikgp/rivalt/pull/38), above #37 `75e34c5`; tested `915d8e8` | [A31/G20 safety](evidence/P26.md): complete default/recovery/retirement, 837 qualified RPC outcomes / 672 WS, exact 64-root audit, cyclic and both-market/full-book cases, 31 ABI variants, default gating and maximum-width resource headroom. Qualified local activation only; P27/P28 evidence is separate; integrated at `0916b9d` |
| M8 | P27 | SDK, indexer/API and durable services | Closed | [PR #39](https://github.com/arnabnandikgp/rivalt/pull/39), published `b0b589c`, above #38 `fe5757a` | [A32/G21 interfaces](evidence/P27.md): finalized indexer/64-root replay, direct SDK and routing checkpoints plus final `13b558f` worker fault/default/recovery/replay acceptance; 152 finalized durable originals, one expired-unexecuted original, exact seven-root financial audit; integrated at `0916b9d` |
| M8 | P28 | UI, operations and bounded concurrent qualification | Closed | [PR #40](https://github.com/arnabnandikgp/rivalt/pull/40), published `ac894f1`, above #39 `9498d2e` | [A33/G21/M8](evidence/P28.md): 17 browser originals, 115 submitted trades, six busy exits, four bounded history rescans, complete nine-root default/recovery and identical fresh PostgreSQL replay; tested `f595fd7` / `5491752`; R073 scoped review corrections `e6ba2cf`; integrated at `0916b9d` |
| M9 | P28A | Interactive launcher, local test wallet and walkthrough | Closed | [PR #41](https://github.com/arnabnandikgp/rivalt/pull/41), final head `ba73bcd`, merged `350e60c` | [P28A acceptance](evidence/P28A.md): real startup/RPC/WS/PostgreSQL, 13 wallet originals, indexed fills, reload and stop/reset; R076 resolves both reviews, 16 scoped tests and hosted client/shell checks pass; user evaluation accepted and demo stopped. R077 records a separate proposal without reopening P28A |
| M10 | P29A | Maker-liquidity roadmap and scoped gates | Review | Ready [PR #42](https://github.com/arnabnandikgp/rivalt/pull/42), `phase/p29a-maker-roadmap`, roadmap `bb53b53` above R077 `8ca0691` / integrated `1c59592` | A34A: scoped documentation/link/fence/phase/gate/evidence-policy checks pass; no program acceptance; kept open |
| M10 | P29B | Exact quote/update/routing/funding contract | Review | Ready [PR #43](https://github.com/arnabnandikgp/rivalt/pull/43), checked `b0c504a`, published `cfea519`, above P29A `ca14b86` / #42 | [A34B/G22](evidence/P29B.md): 26 model checks, 368 local links, layout/packet/search/transition contract and pinned numeric gates pass; no runtime acceptance |
| M10 | P30 | Configurable maker curves and updates | Review | `phase/p30-canonical-maker` above P29B `b4f43a4` / #43 | [Implementation checkpoint](P30-CANONICAL-MAKERS.md): [A35/G23](evidence/P30.md): build `2d6fcdd`, clean RPC `e9ee447`;123 signed RPC/WS outcomes,104 instruction/20 account/78 event parity;3,172 vectors per evaluator. Ready PR #45 is open; new trading disabled |
| M10 | P31 | Generic adapters and bounded best-pair router | Review | Ready [PR #46](https://github.com/arnabnandikgp/rivalt/pull/46), `phase/p31-canonical-router` above P30 `b7e76e3` / #45 | [A36/G24](evidence/P31.md): clean RPC `2fda67b`, search `f9a70c3`; 415 independent cases, 47 scoped tests, 24 actual quote comparisons / 73 finalized RPC/WS outcomes; p95 36.956ms / p99 45.960ms over 1,000 worst-width searches. Trading disabled |
| M10 | P32 | Clearing/funding and safe local execution | In progress | `phase/p32-liquidity-execution` above P31 `28d5dd0` / #46 | R085/D74 removes hypothetical maker financial checks from funding only; 15 scoped native and 4 independent funding-reference cases pass. Clean `2a93394`100-lot sample lands at1,334,329CU with correct literal event/legacy parity but fails20% headroom;600-lot/zero-cash runtime checks not reached. R087/D76 implements the frozen publisher account/report, authority controls, coherent backend builder and SDK. 10 scoped native/6 SDK checks, regenerated ABI and typecheck pass; clean`9129bda`client/`94e0645`SBF reports land at30,511–30,571CU/871bytes/14keys;7 accepted reports. Final fixture control lands337,446CU, above320k headroom. Post-CPI verification optimization pending clean remeasurement. Execution, safety, integration and continuation gate remain |
| M10 | P33 | Services, SDK, indexer, UI and maker kit | Open | P32 gate passed | A38/G26 interfaces: actual durable recovery, operator/browser flow and financial reconstruction |
| M10 | P34 | Comparative qualification and operations | Open | P33 | A39/G26/M10: complete populations, concurrent updates/fills/exits, reconciliation/recovery and measured limits |

Acceptance details live in [DELIVERY-PLAN](05-DELIVERY-PLAN.md). Configuration gates live in [DECISIONS](DECISIONS.md). Do not duplicate their full text here.


## Latest checkpoint

- R083/P32: branch created through `gh stack add` above verified P31 `28d5dd0` / #46. Inspecting shared route/risk/safety integration and implementing bounded canonical funding search. A37/G25 remains pending; no new activation or deployment.

- R082/P31: [A36/G24](evidence/P31.md) passes on pinned code. Exact three-maker authentication/allocation matches 415 independent cases; 47 scoped tests, 73 real RPC/WS transactions and 1,000 maximum-width search measurements pass. P31 is Review in ready [PR #46](https://github.com/arnabnandikgp/rivalt/pull/46) above #45. Next: P32 financial integration.

- R081/P30: A35/G23 passes on pinned code. Both SBF maker programs and Rust/SDK pass3,172 reference cases;123 finalized RPC cases and104 instruction/20 account/78 event parity pass. Ready PR #45 is open above #43; stopped per user direction. P31 has not started.

- R079/D70: authorized P29B contract/reference is prepared; fresh profile-4 layouts, cumulative pricing, update races, complete funding and numeric resource/comparison gates are specified. 26 scoped model checks pass on `b0c504a`; P29B is in Review as ready PR #43 above #42. Existing runtime profiles remain unchanged.

- Current planning (R078): D69 accepts the five-change direction and [P29–P34 roadmap](P29-MAKER-LIQUIDITY-ROADMAP.md). P29A passes scoped documentation checks and is published in ready PR #42, kept open in Review; no executable contract, runtime or performance acceptance is claimed. R077's assessment remains the inspected-code basis at `1c59592`.

- Latest integration (R076): P28A PR #41 merged at `350e60ca1de2de77b9ed2a80a16b0aa5eb5aa481`, with tree `ea3a96ed66c4f99e3d68cc5a012ac76880e12813` identical to verified `ba73bcd`. Both inline findings are resolved; [hosted run 40678439011](https://github.com/arnabnandikgp/rivalt/actions/runs/40678439011) passes selected scope/client/shell jobs, with unrelated jobs scope-skipped and CodeRabbit neutral. Local main is synchronized; original financial qualifications below are unchanged.

- Current financial work: qualified P26 artifacts remain unchanged. [P27](evidence/P27.md) and [P28](evidence/P28.md) now record actual services/UI, busy funded exits, default/recovery and fresh PostgreSQL replay. Funded own-cash exits need no venue-wide certificate; unpaid profit payment/netting still needs current selected-market backing. Default/devnet remain gated.
- Current roadmap: P22A–P28 and M8 are Closed after authorized atomic integration. P28 A33/G21/M8 exit retains `5491752`, with browser evidence on `f595fd7`; R073 consumer/documentation corrections are verified on `e6ba2cf`. No new deployment or runtime qualification is inferred.
- Integrated baseline: R073 PRs #32/#33/#35/#36/#37/#38/#39/#40 merged atomically at `0916b9dc7896f9cdfc68081ad56daa93dabf3d94`. Local `main` is fast-forwarded and the merged tree exactly equals verified `e6ba2cfdbdb41dbfe037453ed75444f3baf94aa3`. Prior R053 `d07fccc`, R033 `74fc296`, R030 `67059fc` and the original MVP remain integrated.
- Deployment: clean `df336c0` uploads reviewed `a9d9f26` A/B binaries at slots 514709495/514709597; exact finalized code/padding/authority checks pass. Existing clearing stays on `b3a2fc1`, and the guard is unchanged. [R030 identities and evidence](evidence/R030-DEVNET-CLOSEOUT.md) preserve that mapping.
- Current review verification (R073): zero unresolved inline threads or requested changes; all eight final heads mergeable with selected CI successful or scope-skipped. Tip `e6ba2cf` passes all five jobs in [hosted run 40576656720](https://github.com/arnabnandikgp/rivalt/actions/runs/40576656720); CodeRabbit is neutral/skipped for the incremental push. Seven local consumer cases, one Rust wire test, typecheck and trader build pass. This is scoped remediation/integration evidence, not an independent protocol review.
- Storage: raw phase evidence and this run's review/merge captures remain local and ignored. The original untracked design proposal is preserved; no archive/upload or raw JSON enters Git.
- Exact next action: branch P30 above the verified P29B contract (PR #43) and implement the canonical curve/update module and parity checks. Keep the stack open; no merge is authorized.
- Deferred gates: R072 qualifies six busy funded exits in the schema-3 local profile; the older V2 profile keeps its historical limitation. P15B/P16B independent maker/review/funded-readiness gates remain Open; continuous 24-hour endurance remains Deferred under D42. No new devnet/funded deployment or external participation is claimed.

## Blocker register

| ID | Phase | Concrete blocker | Evidence | Resolution / owner | Status |
|---|---|---|---|---|---|
| B01 | P01 | Default SBF v1.57 download exhausted disk | `cargo_build_sbf::toolchain`: ENOSPC | Removed only this run's downloaded archives; verified existing platform-tools v1.52 on SBPF v0, recorded D16 | Resolved |
| B02 | P05 | Multi-platform PostgreSQL image unpack exhausted disk | Apple container NSCocoa 640 / ENOSPC | Removed only new incomplete image (3.6 GB reclaimed); explicit arm64 pull 112.4 MB, then actual PostgreSQL 18.6 acceptance | Resolved |
| B03 | P13 | No configured Hermes API access | Current documented Pyth Hermes endpoint returns HTTP 403 unauthenticated; official docs require API key; user reports no access | D36 user-approved sponsored Core account reads remove this API prerequisite; actual source/deployment verification remains due | Superseded |
| B04 | P22B | Different loss policies pay different creditors; explicit selection required | [P22B example B](P22B-FINANCIAL-CONTRACT.md): current common payout 50/50 versus market attribution 100/0; independent model checks both | R056/D57: user explicitly selects option 2, market attribution. Finish netting/default/layout contract and G17 before P23; no further choice needed to resume | Resolved |

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
- Evidence committed: [report](evidence/P01.md) and actual JSON captures (local: `docs/evidence/p01`); full build/smoke output remains `.local/p01-clean-acceptance.log`. Final `cargo fmt -- --check`, `git diff --check` and clean generated-tree checks pass; no task RPC/WS listener remained.
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
- Evidence: [review verification report](evidence/R004-REVIEW.md) and captured logs/JSON (local: `docs/evidence/r004`). Program/IDL hashes match the earlier phase artifacts. Replies identify fixes and verification; all four original review threads are resolved. Automated review is not M6 independent review.
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
- Resources / evidence: [report](evidence/P03.md), manifest and actual captures (local: `docs/evidence/p03`); preview 426 bytes / eight message accounts / at most 113,216 CU, one read-only config in CPI, 92-byte return. Full output and all failed-transaction metadata remain in the named run directory. Final formatting/whitespace checks pass. These are finite local fixtures, not throughput/soak or external review.
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
- First clean full run on `384f1bd`: builds, 12 Vitest checks, 13 Rust financial tests, 3,000 Python cases, P01/P02/P03 regression and 70 P04 SVM scenarios passed. RPC reached the route fee-budget case and correctly rejected an expired test intent (6117 instead of the intended 6119); `.local/runs/20261021T082719Z-4603` and `.local/p04-full-acceptance.log` retain the failed run. The harness now rebuilds each case's lifetime, while preserving stale fields only where under test. Also added explicit event version/terms and positive unpaid-profit/sell-limit/lifetime coverage. Final acceptance rerun pending.
- Final acceptance authority: `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` PASS on clean `b8e5fb8c14662be7e55aa5126c07efee3be7330d`, run `.local/runs/20261021T083205Z-9450`. Frozen builds, committed SDK drift, typecheck, 12 Vitest tests (600 independent route/health vectors plus 4,000 maker vectors), 13 Rust financial tests, 3,000 Python rational cases/profile and 5 Rust maker tests (4,000 vectors) pass. P04: 74 signed SVM scenarios (33 accepted/41 expected rejected) plus 83 actual setup scenarios; 73 signed RPC scenarios (33 accepted/40 expected rejected), seven committed fills and 29 independently decoded events (sequence 23–51). Default-artifact activation rejection is SVM-only; RPC performs real hostile upgrade and restoration. P01/P02/P03 regressions pass on the same artifacts, including P02 99 SVM/33 RPC and P03 54 SVM/54 RPC. All source identities are clean.
- Final financial/resource evidence: [report](evidence/P04.md), manifest/captures (local: `docs/evidence/p04`). Actual vault=allocated=200,010,008 atoms; C=199,842,067, I=10,007, T=157,934, P=0; net q=0, gross q=9,212, exact aggregate U=0. Successful two-maker routes are 972 bytes/19 accounts/at most 255,777 CU, leaving 36.0% of the declared 400,000 CU. Largest scenario including failed multi-instruction rollback is 1,160 bytes. These finite measurements meet G05; no load/soak is claimed.
- Status: P04 Review; A04/A05/G05 and M2 cross-phase engineering exit verified. P03/M2 remain Review pending integration. Ready PR #5 is stacked above #4; no access/product blocker.
- PR publication/closeout: committed implementation `384f1bd`, corrected/tested `b8e5fb8` and acceptance evidence `2cb0c29`; `gh stack push`, explicit non-draft `gh pr create`, and `gh stack submit --auto --open` published [PR #5](https://github.com/arnabnandikgp/rivalt/pull/5). GitHub verifies OPEN, `isDraft: false`, base `phase/p03-makers`, head `phase/p04-routes`; gh stack shows #4 → #5 with no rebase required. Final changes after the tested source are documentation only. Formatting, whitespace, documentation links and executable-tree parity pass; acceptance RPC/WS ports are released. No independent review or merge is claimed.
- Next exact action: `gh stack add phase/p05-indexer`, then implement G06 on that verified stack without waiting for merge.

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


### R007 — 21 October 2026 — P05 — canonical indexer and read API

- Starting revision / branch: clean `ddd1dc003b7f02dbc4899f80e6d65d5d68323013`, ready PR #5. `gh stack add phase/p05-indexer` created its child; no parent merge required or performed. Unrelated work was absent.
- Delivered: pinned Fastify/pg/PostgreSQL runtime; append-only event/transaction/observation journal; confirmed WS buffering and finalized paginated RPC recovery; immutable chain/run binding; atomic projection/outbox/checkpoint writes; participant/maker/risk/vault reconciliation; bounded read API, actual-fill candles and service health/metrics. Existing programs/IDLs/economics are unchanged and later financial paths stay disabled.
- Specs: P05-INDEXER, README, COMPONENTS, STACK, delivery artifacts and D25/G06 define the implemented schema, endpoints, operational limits and phase boundary.
- Checks so far: exact frozen-compatible dependency resolution, strict typecheck, 18 Vitest tests (six new decoder/independent risk-read checks), installed graph (144 packages; legacy isolation), shell syntax and whitespace. Preliminary RPC suites exercised actual signed custody/makers/routes plus PostgreSQL rollback, live WS, offline backfill, duplicate/reordered replay, failed-event exclusion and HTTP reads. A complete clean final run is still pending; no A06 completion claimed yet.
- Resolved development failures: unrestricted multi-platform image pull exhausted disk; removed only the newly incomplete PostgreSQL image (3.6 GB reclaimed) and pulled its 112.4 MB arm64 variant. Buffer-to-JSON shape caused an initial binding mismatch; canonical hex bytes fixed it. An extra test submission used RPC default preflight against a newer confirmed blockhash; aligned with existing skip-preflight signed runtime harness and explicit finalized success check. Review also moved chain reconciliation before checkpoint advancement so a missing tail event cannot strand the cursor.
- Evidence in progress: `.local/p05-rpc-development*.log`; source trees are explicitly dirty and these are not final acceptance records. The third development run was intentionally stopped at its own route child after the final checkpoint-reconciliation/identity changes superseded the loaded source. Final evidence is recorded below; those development runs are not acceptance authority.
- Not run/claimed: P06 full settlement/withdrawal and ambiguous economic execution, authenticated funding/orders/default, browser wallet, load/24-hour soak, devnet, independent review or funded deployment.
- Final authority: `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` PASS on clean `fb2606f54a77b4fef3c4e327d357ada59e634050`, run `.local/runs/20261021T093232Z-28371`. All eleven identity records report `sourceDirty: false`. Full build/generation/typecheck/18 Vitest/13 Rust financial/3,000 independent Python cases/five Rust maker tests pass; 99 custody, 54 maker and 74 route SVM scenarios plus setups pass; 33 custody, 54 maker and 73 route RPC scenarios are freshly executed. P05 adds 18 real RPC/PostgreSQL checks, five actual-reset/CLI checks, one offline signed pause and 33 more signed custody scenarios on the new chain.
- Actual recovery results: 44 live WS observations; missing-tail and SQL rollback faults preserve the checkpoint; 136 post-route canonical transactions include 71 failures whose events are excluded; 51 events become 52 after the offline pause. Fresh PostgreSQL database rebuild fetches 137 transactions over 46 pages and matches all three participants, both makers, risk/market and vault. Vault = allocated = 200,010,008 atoms, surplus zero. PostgreSQL process/volume restart and genuine new-Surfpool isolation pass; real HTTP reads/candles and standalone CLI readiness/metrics/SIGTERM pass. All six task listeners and the task container are released.
- Evidence: [P05 report](evidence/P05.md), captured JSON/logs and hashes (local: `docs/evidence/p05/manifest.json`), `.local/p05-clean-acceptance.log`. Program/IDL artifacts match P04; current results are new execution, not inherited test counts. Evidence excludes credentials and database data. Only documentation/evidence changes follow the tested implementation.
- Configuration/status: A06/G06 verified; P05 Review pending integration. M3 remains In progress for P06; P03/P04 remain Review. No blocker or product decision.
- PR / commits: implementation `fb2606f`, evidence `d38708c`; ready [PR #7](https://github.com/arnabnandikgp/rivalt/pull/7) opened with base `phase/p04-routes`, then registered via `gh stack submit --auto --open`. The stack reports #4 → #5 → #7, no rebase required. Final follow-up changes are documentation only; executable/lockfile parity with the tested commit is verified. No merge or external review is claimed.
- Next exact action: `gh stack add phase/p06-lifecycle`, then implement G07 plus the real maker/executor/settlement lifecycle above #7.


### R008 — 21 October 2026 — P06 — service lifecycle and guarded ordinary exits

- Starting revision / branch: clean `03f96d1597f592a34a92b9311f74a8e3e56f84ed` on `phase/p05-indexer`; `gh stack add phase/p06-lifecycle` created the child above ready PR #7. No parent merge or unrelated changes.
- Delivered: clearing's complete-cohort sequence-bound ExitGuard, ordinary whole-atom loss collection/gain settlement and owner-signed funded trading withdrawal; generated IDL/SDK/legacy parity; exact C/v/P event projection; separately runnable maker A/B, quote/submission API, durable executor and settlement worker; immutable signed intents, explicit SOL fee budgets, finalized reconciliation, outage/return, bounded retries and protected local key configuration. Specs updated together in LIFECYCLE, protocol/components/validation/delivery plan, README and D26/D27/G07.
- Checks before final run: SBF/IDL/SDK build passes including default artifact and stack-frame rejection guard; strict typecheck, 19 Vitest tests, 49 new signed settlement/cohort/default-build SVM scenarios plus 157 real setup scenarios, installed graph (145 packages, legacy isolation), whitespace. Development real Surfpool/PostgreSQL run `.local/runs/20261021T101945Z-46682` passes 14 service checks, including exact 21/79 split, B-only close during A outage, 94,210 funded gain, full 100,091,789 cash withdrawal, executor acknowledgement loss/SIGKILL recovery, competing/restarted keepers, expiry/ambiguous history and fee reconciliation. These are dirty development results; clean full acceptance is pending.
- Resolved development findings: boxed larger withdrawal accounts after SBF detected a 4,768-byte stack offset; extended setup-only maker epochs after actual finalization outlived 64 slots; serialized concurrent schema creation after PostgreSQL reported `tuple concurrently updated`; corrected the default-build test's unnecessary non-signer key. Review additionally preserves operator fee reservations when expiry proves no economic effect but failed-landing fee history is unavailable, with a real failed-fee recovery scenario added for final acceptance. Complete/partial cohort scans also reject same-stamp rewinds, preventing permissionless revocation of useful exit-check progress.
- Not run/claimed: final clean full gate is pending below; authenticated sources/funding, TP/SL, liquidation/default, UI/browser wallet, load/24-hour soak, devnet, independent-maker economics/review, external hedging and funded deployment remain later work.
- Evidence/publication: development logs `.local/p06-lifecycle*.log`, `.local/p06-svm-development.log`; final report/commit/ready PR recorded below when verified. No unresolved access/product decision. P06/M3 remain In progress; predecessors stay Review.
- Next exact action: commit this implementation, then run `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` on the clean commit and publish a ready PR above #7 using `gh stack`.

- Final acceptance: `source ops/env.sh && RIVALT_SLOT_TIME=20 pnpm smoke` PASS on clean `2578327a74d53191b26e61950c2829ebeef8529f`; regression `.local/runs/20261021T102650Z-52948`, lifecycle `.local/runs/20261021T103231Z-55155`. All 14 captured identity records report that revision and `sourceDirty: false`. Fresh build/generated parity/typecheck/19 Vitest/13 Rust financial/3,000 Python/five Rust maker tests pass; 99 custody, 54 maker, 74 route and 49 P06 SVM scenarios plus real setups pass. RPC regressions freshly execute 33 custody, 54 maker, 73 route, 18 indexer recovery and five chain-reset/CLI checks, with 33 more custody cases on the reset chain. P06 adds 33 real custody setup scenarios and 15 full-service checks.
- Actual P06 outcomes: 21/79 split gross 6,002,790 / fee 1,201; B-only close gross 6,097,000 / fee 1,220; keeper collects 20,580+73,630 atoms, funds 94,210 gain, and wallet withdraws all 100,091,789 funded atoms. A later explicit 10,000,000 redeposit supports expiry testing. Dropped ack plus executor SIGKILL, keeper restart/competition, stale quote, maker outage/return, actual blockhash expiry, unresolved deposit history and hidden failed-fee recovery all pass. Final sequence 28: C=109,905,790, P=0, I=10,007, T=2,421, actual/allocated vault=109,918,218, three participants, no surplus. Fifteen WS notices and finalized RPC reconcile two fills/four settlement events. Maker fees are 5,000 lamports each; keeper fees 30,000 including the real failed probe; no remaining reservations. P06 successful signed SVM scenarios measure at most 41,053 CU / 626 bytes.
- Evidence: [P06 acceptance report](evidence/P06.md), capture/identity/hash manifest (local: `docs/evidence/p06/manifest.json`), `.local/p06-clean-acceptance.log`. Captures omit all local signing keys, credentials and database data; actual password absence is checked. All seven task listeners are released. Only documentation/evidence changes follow the tested implementation.
- Configuration/status: A05/A07/A08/G07 and M3 engineering cross-phase exit verified. P06/M3 are Review pending integration; predecessors remain Review. No unresolved product/access blocker. Ready PR publication is pending below.
- Next exact action after publication: `gh stack add phase/p07-oracle-funding`, then implement G08 and authenticated common funding above the P06 PR.

- Publication: implementation `2578327`, evidence `19925d1`; ready [PR #8](https://github.com/arnabnandikgp/rivalt/pull/8) opened with base `phase/p05-indexer`, then registered through `gh stack submit --auto --open`. Verified OPEN, `isDraft: false`, exact head `19925d1f24e8ab3412052b05a38e9924cc620f3f`; stack #6 is #4 → #5 → #7 → #8. Final follow-up changes only these documentation links; executable/lockfile parity with the clean tested implementation is verified. No merge or external review is claimed.
- Final next action: `gh stack add phase/p07-oracle-funding`, then implement G08 and authenticated common funding above ready PR #8.


### R009 — 21 October 2026 — P07 — controlled sources and causal common funding

- Starting revision / branch: clean `30b0837542e11754d31499078bdd8481c53e156c` on `phase/p06-lifecycle`; `gh stack add phase/p07-oracle-funding` creates the child above ready PR #8. User authorizes continuing every verified phase as a ready stack without waiting for merges. No unrelated work or external access needed.
- Delivered: four immutable authenticated local fixture feeds, finite source/risk/mode/recovery profile, full two-maker bid/ask impact sampling with conservative funded depth and exact bounded optimum, causal held funding at every position/settlement transition, retained fractions, no-credible-price flat-cohort exits, generated ABI, event/SQL projections, funding worker with explicit SOL budget, signed fault scenarios and actual service integration harness. D28 and affected protocol/component/validation/delivery/README specifications change together.
- Development commands/results: pinned `bash ops/build.sh` passes with default/local artifacts and regenerated IDL/SDK; typecheck and 22 Vitest tests pass; Rust financial tests plus the independent 3,000-case Python reference pass. `pnpm test:oracle` passes 253 new signed scenarios after 33 actual custody setups, including 600-lot depth, actual capped premium, source/maker faults, causal close/reopen fractions, exact claims, default-build rejection and source-outage flat exits. Max observed sampling is 660,590 CU / 796 bytes in this development revision; final committed resource report remains pending. The 49 P06 settlement scenarios also regressed successfully during development.
- Resolved findings: SBF caught a 4,416-byte settlement frame, fixed by boxing; the first full-quantity impact enumeration exceeded 1.2M CU, replaced by conservative guaranteed-admissible depth and exact convex/concave search with once-per-module code authentication. Both maker directions still execute checked CPI. Oracle account/privilege substitution rejects instead of allowing caller-induced restrictive mode. Exit certificate bounds include possible fallback to the last materialized index. PostgreSQL key-order comparison and legacy Buffer canonicalization were corrected without changing financial outcomes. A concurrent loaded Vitest run hit its 5-second route-reference timeout; the unloaded rerun passes all 22 unchanged assertions.
- Actual integration development: initial 20-ms Surfpool deployment failed before scenario execution (write retries); no acceptance claim. Explicit protected deployment buffers avoid recovery secrets in CLI logs; the declared P07 cadence is 50 ms. `.local/runs/20261021T111657Z-80537` reaches source/maker/gap/stale recovery before the JSON-order issue; `.local/runs/20261021T112336Z-85232` passes RPC/WS/PostgreSQL recovery and fresh reconstruction, then exposes only the test's Buffer representation mismatch. Offline verification of its actual captured bytes passes two accounts and all 38 oracle events against isolated legacy Anchor. These dirty development runs are not clean acceptance.
- Not run/claimed: final clean full acceptance, final fee/resource additions, ready PR and integration are pending below. P08 orders/cancellation, P09 default/liquidation, browser, load/24-hour soak, devnet/real upstream verification, independent participants/review and funded deployment remain later work. No genuine access/product blocker.
- Evidence/publication: `.local/p07-build.log`, `.local/p07-unit.log`, `.local/p07-svm.json`, `.local/p07-financial.log`, `.local/p07-rpc-*.log` and the two development run directories. Final evidence/commit/PR will be recorded after actual verification. P07/M4 remain In progress; earlier ready PRs remain Review.
- Next exact action: commit the coherent P07 implementation and run `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke` on the clean revision; then publish ready above #8 and immediately start P08.

- Clean attempt `988a884`: build/SDK parity, typecheck, 22 Vitest, financial/reference and all signed SVM suites pass before RPC deployment. The run was deliberately stopped at `.local/runs/20261021T113036Z-90073` after final boundary review found funding's integer marginal-price envelope one tick wider than the exact route inequality for non-multiple-of-ten references. Corrected to ceil(lower)/floor(upper); no full acceptance is claimed for this interrupted attempt. Next exact action: commit the boundary correction, then rerun the entire clean smoke.

- Clean attempt `8cb2bd1`: all build/ABI/type/22 Vitest/financial and signed SVM gates pass; `.local/runs/20261021T113303Z-93670` passes the complete custody/maker/route/indexer/reset RPC regression. P06 lifecycle `.local/runs/20261021T114438Z-98091` stops because its inherited 20-second test deadline expires 23 slots before maker B's legitimate 512-slot expiry at the newly declared 50-ms cadence. The daemon is healthy; no financial failure or full-suite pass is claimed. Fix the fixture wait to include the declared slot duration, stop maker producers before final funding reconstruction, and add explicit funded collect/settle fractional checks to the P07 signed suite. Next exact action: commit these validation corrections and rerun clean acceptance.

- Clean attempt `cf1733f`: all build/ABI/type/unit/SVM gates and 18 real RPC/WS/PostgreSQL indexer checks pass at `.local/runs/20261021T115227Z-3512`; the later reset fixture refuses occupied port 18080. Inspection identifies an unrelated Cinder workspace relay, which remains untouched. Reset acceptance now uses configurable `RIVALT_RESET_API_PORT` (18082 by default), and full smoke preflights every declared listener before long work. No full-suite pass is claimed. Next exact action: commit the isolated-port fix, rerun clean acceptance, publish P07 ready and continue P08.

- Clean `f072147`: full builds/unit/reference/SVM and P01–P06 RPC acceptance pass at `.local/runs/20261021T120540Z-10115` and `.local/runs/20261021T121652Z-14890`. The wrapper then stops before P07 because its bind-only listener preflight treats TCP TIME_WAIT as a live listener. A real local socket experiment reproduces errno 48 after close; SO_REUSEADDR plus listen accepts the closed socket and still rejects an occupied listener. P07-only run `.local/runs/20261021T122138Z-16710` passes source/funding/turnover/outage scenarios but fails during final recovery when concurrent explicit/periodic fixture publications produce identical signed bytes; Surfpool correctly rejects already-processed input. Serialize the fixture publisher at distinct actual chain timestamps and share a reuse-aware listener preflight. Venue program, SDK and service financial code are unchanged. Next exact action: commit the harness fixes, rerun affected P07 acceptance and fast gates, retain the already-passed unchanged P01–P06 evidence with its exact revision, then publish P07 and begin P08.

- Final acceptance: clean `83f70d43f1cff43622310362b4d5307e6fed4bac` passes `pnpm generate:check`, `pnpm typecheck`, 22 Vitest checks, 18 Rust financial tests, 3,000 independent Python cases, five Rust maker tests/4,000 vectors, and all signed SVM suites (99 custody / 54 maker / 74 route / 49 settlement / 258 P07, plus setup). `RIVALT_SLOT_TIME=50 bash ops/oracle-smoke.sh` exits zero at `.local/runs/20261021T122928Z-20487`, with 11 real RPC/WS/PostgreSQL checks, 38 independently fetched funding samples and two accounts/39 events decoded by isolated legacy Anchor.
- Regression authority: `f07214707e4ac2c2da5d56a649b43c564e5f312b` passes P01–P06 builds and complete RPC regression/lifecycle at `.local/runs/20261021T120540Z-10115` / `.local/runs/20261021T121652Z-14890`; wrapper exits 1 only before P07 at the now-fixed socket preflight. Program/core/SDK/services/indexer/dependency/fixture trees are byte-identical to `83f70d4`; unchanged earlier integration was not repeated after harness-only fixes. Both revisions and all 17 clean identity records are in the manifest.
- Final evidence/resources: [P07 report](evidence/P07.md), manifest/captures (local: `docs/evidence/p07/manifest.json`). Maximum SVM sample 660,691 CU / 781 bytes / 20 accounts (44.9% CU headroom); RPC maximum 585,160 CU. Final V=allocated=1,100,010,008 atoms, C=1,099,999,855, I=10,007, T=146, P=0; q and exact claims sum to zero. Funding worker spends exactly 190,000 lamports with zero unresolved reservations. Actual PostgreSQL rebuild and WS recovery pass. Real preflight tests distinguish TIME_WAIT from live listeners; unrelated Cinder processes remain untouched.
- Status: P07 Review; A09/A10/G08 verified. M4 In progress because P08–P10 remain. Ready stacked publication pending, no access/product blocker.
- Not run: persistent orders/cancellation/TP-SL, liquidation/default, browser, load/24-hour soak, devnet, independent-maker/review/funded gates. They belong to later phases and are not claimed.
- Next exact action: publish this verified P07 branch ready above #8 through `gh stack`, record its actual URL/head, then create `phase/p08-orders` and implement G09 immediately.

- Publication: `gh stack push`, explicit ready `gh pr create`, and `gh stack submit --auto --open` publish [PR #9](https://github.com/arnabnandikgp/rivalt/pull/9) above #8. GitHub confirms OPEN / `isDraft: false` with base `phase/p06-lifecycle`. Closeout changes only documentation/evidence from tested `83f70d4`; artifact hashes, local documentation links, unchanged executable trees and all seven task listeners pass. Next exact action: create `phase/p08-orders` above this verified ready PR and implement G09/A11/A12.

### R010 — 21 October 2026 — P08 — persistent orders and TP/SL

- Starting baseline: exact local/remote P07 ready PR #9 head `efc1278414d722759b1785af13f4986a784c6fd2`; `gh stack add phase/p08-orders` creates the next child without a merge wait.
- Scope: G09 bounded stored authority/reservations, cumulative-fee partial subfills, cancel/replace, standalone stop-limit and existing-position shared TP/SL; separate keeper and canonical projection. G09 values and authority boundaries are selected in P08-ORDERS; acceptance remains pending.
- Status: P08/M4 In progress; P07 and predecessors remain Review; M1 remains Closed. No access/product blocker. No P08 implementation test is claimed yet.
- Next exact action: implement the bounded order state and independent reserve/fee arithmetic, then integrate guarded route/withdrawal paths and generated ABI.


#### R010 development checkpoint

- Implemented bounded wallet order/group state, versioned cancel/replace, exact partial fee prefixes, independent remaining-reserve arithmetic, guarded keeper execution and direct source-independent cleanup. Regenerated IDL/SDK; added full-book canonical projections and discovery service with a separate operator budget. Updated protocol/component/validation specifications together.
- Actual developmental checks: locked host/SBF builds and strict type checks pass. Initial 22 baseline Vitest checks grew to 26 passing checks, including isolated legacy order ABI and literal reserve/trigger previews. Two new independent Rust order tests pass. Signed SVM grew through 181, 219 and 265 P08 scenarios plus 45 setup scenarios; final resource fixtures are still being exercised. Existing 99 custody, 74 route and 258 oracle signed scenarios pass against the changed development artifact.
- Corrections during development: boxed enlarged Anchor accounts and split the route finish function to satisfy SBF stack limits; changed placement start validation to permit already-started authority at landing; checked funding reservations against newly derived bounds; versioned protective group cancellation after child replacement. A new negative test initially expected the wrong error number (6116); actual RouteLimit is 6119 and the assertion was corrected.
- Real Surfpool/WS/PostgreSQL acceptance is running; no P08 live-service result or clean acceptance is yet claimed. No browser/soak/devnet/external work run. No access/product blocker.
- Next exact action: finish the P08 RPC order/keeper/rebuild acceptance, commit the coherent implementation, then run the complete clean regression before publishing a ready PR above #9.

- Further developmental evidence: all twelve bounded trader/maker order slots populated in the signed split fixture use 298,776 CU, 824 bytes and 18 accounts, below the unchanged 320,000-CU/1,232-byte/20-account gates. Final SVM harness batches each four-feed signed publication, yielding 203 P08 transactions plus 45 setup transactions (the earlier 287 count used four separate source transactions). Assertions and economic scenarios are retained; these are actual transaction counts, not independent proof counts.
- Live harness findings: the first 100 ms run failed sustained recovery after serial source publication; a 50 ms rerun correctly rejected new risk when a manual sample followed a gap beyond the six-second recovery hold. Batched fixture updates and explicit sustained recovery/real maker renewal address the test timing without changing source policy. Final live acceptance remains pending.

- Third live development run passed cancel/fill, both cancel/replace, duplicate-keeper and withdrawal/fill races, then the harness attempted early maker renewal. The maker correctly rejected its still-active lease with Lifetime 6002. The harness now waits for the actual expiry slot before signed renewal; no maker lifetime rule is weakened.

- Implementation checkpoint: 26 Vitest checks, 20 Rust financial tests, fresh 3,000-case Python reference, final 203 signed P08 transactions plus 45 setup transactions, strict type checks, generated determinism and formatting pass in development. The remaining work is clean integration verification; P08/M4 remain In progress. Next exact action: run `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke` on the committed P08 implementation and resolve any actual failures before Review.


#### R010 clean regression and final harness correction

- Clean implementation commit `1f27fa810675eb12185c518b67f0604b4cd2619a`: `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke` passed locked builds/generated parity, 26 Vitest checks, 20 Rust financial tests and 3,000 fresh independent Python cases; 99 custody, 54 maker, 74 route, 49 settlement, 258 oracle and 203 order signed SVM scenarios (setup transactions reported separately).
- Fresh actual P01–P07 integration passed: `.local/runs/20261021T132105Z-44134` (33 custody / 54 maker / 73 route / 18 indexer checks plus chain-reset/CLI isolation), `.local/runs/20261021T133300Z-47934` (15 lifecycle checks), `.local/runs/20261021T133642Z-49108` (11 oracle/funding checks). All inspected identity records report the exact commit and `sourceDirty: false`; funding payer fees reconcile to 190,000 lamports with zero reservations.
- The wrapper exited **1** in P08 `.local/runs/20261021T134138Z-50696`, after both cancel/fill and replace/cancel orderings, duplicate keepers, withdrawal/fill, TP/SL orderings, close/reopen, source-independent cancellation, actual expiry cleanup and the persisted/restarted competing keeper 64+6 fill had passed. Its next harness `fresh()` call attempted a manual sample while the real funding worker was already sampling; the program correctly rejected the too-soon SampleOracle with 6124. No full-wrapper exit-zero result is claimed.
- Correction is isolated to the test harness: when the live source/funding service is running, wait for its fresh Normal observation instead of injecting competing samples. Program, economic core, SDK, indexer and service code remain unchanged. P08/M4 remain In progress; no external blocker. The full output is `.local/p08-clean-acceptance.log`.
- Next exact action: commit the harness correction, then run `source ops/env.sh && RIVALT_SLOT_TIME=50 bash ops/orders-smoke.sh` on the clean child commit to finish A11/A12/G09 and capture both clean revisions. Unchanged passing P01–P07 suites need not be repeated for this harness-only correction.


#### R010 verified P08 closeout

- Clean child `cd2b8fa7c886d75b7f81cf654ab0cc2171a962fc`: `source ops/env.sh && RIVALT_SLOT_TIME=50 bash ops/orders-smoke.sh` exits **0**, `.local/runs/20261021T135143Z-53292`. All ten A11/A12 service checks pass, including actual races, source-independent cancellation, real expiry, kill/restart after persistence, competing discovery, 64+6 execution and the one-lot fee-constrained fallback. The unchanged signed suite has 203 P08 transactions (168 accepted / 35 rejected) plus 45 setup transactions.
- Fresh rebuild matches all participant books, cash, checkpoints, market and vault. Legacy Anchor decodes one actual Participant and 47 critical order/route events. Live WS notices: 140; transient failed indexer cycles: nine, followed by successful reconciliation/rebuild. Operator fees: orders 15,000 lamports, funding 45,000, zero outstanding reservations. Final C=1,099,997,178, I=10,007, T=2,821, P=0, V=1,100,010,006; exact adjusted claims and net lots sum to zero. Trader flat, makers −7/+7; no claim that all participants are flat.
- Resource gate: fully populated signed split 298,776 CU / 824 bytes / 18 accounts; largest actual keeper fill 296,723 CU / 18 accounts. G09 is verified. [Report](evidence/P08.md) and manifest (local: `docs/evidence/p08/manifest.json`) capture 45 public evidence files, 19 clean identity records and both actual command outcomes. Password exclusion checked; keys, buffers and volumes excluded.
- Disk upkeep: with 162 MiB available, confirmed no failed-run containers remained and removed only the four failed P08 runs' disposable PostgreSQL volumes, recovering about 225 MiB. Their logs/reports remain. No unrelated files or services were removed.
- Specs/decisions: P08-ORDERS, protocol, components, validation, README and D29/G09 updated with implemented authority, reservations, finite resources and actual acceptance. P08 is Review; M4 remains In progress. No deployment/soak/external review is claimed. Browser wallets, liquidation/default, load/24h soak and devnet were not run in this phase.
- Blockers: none. Next exact action: commit the evidence, use `gh stack submit --auto --open` to publish P08 ready for review above #9, verify the remote head, then begin the P09 child without waiting for merge.

- Publication: `gh stack submit --auto --open` created ready [PR #10](https://github.com/arnabnandikgp/rivalt/pull/10), base `phase/p07-oracle-funding`. `gh pr view` and `git ls-remote` verified OPEN / `isDraft: false`, exact published evidence head `baccbf4` and unchanged P07 parent `efc1278`. This documentation link update does not change the tested implementation. P08 stays Review; no merge/review approval is claimed.


### R011 — 21 October 2026 — P09 — funded liquidation and complete-cohort resolution

- Starting revision: clean `b9e61151938a3d19a0add374195cf506ee21e899`, ready PR #10 verified OPEN/non-draft above #9 by `gh pr view` and exact `git ls-remote`. Created `phase/p09-resolution` with `gh stack add`; no merge wait and no unrelated work changed.
- Read P09 delivery scope, protocol liquidation/default/fee rules, component/indexer contract, validation requirements and P02 fractional allocation/derived-bound rationale. Inspected existing financial-core closeout, current custody/action guards and source policy. Existing pure default math is not treated as implemented operational resolution.
- Selected G10 finite local controls and staged complete-cohort semantics in P09-RESOLUTION and D30. In particular, frozen partial application requires explicit staged claim reconciliation rather than falsely applying ordinary net-q invariants to a mixed cohort.
- Status: P09/M4 In progress; P08 and prior verified stack remain Review. No P09 test, deployment or external review claimed. No access/product blocker.
- Next exact action: implement and independently test funded liquidation arithmetic, then build authenticated freeze/value/collect/plan/apply/reconcile pages with ordinary financial paths disabled during freeze.

- First P09 developmental check: `cargo test --locked -p financial-core --test liquidation` passes four tests: independent long/short literals, in-band non-improving price rejection, receiver IM failure, exact funded/absolute fee caps and an independent integer grid. Added the guarded owner-signed non-maker receiver handler; host compilation caught a mistaken existing error-variant name (`Snapshot`), corrected to `FinancialSequence`. No signed program/RPC acceptance is claimed yet.

- Developmental P09 implementation: added signed funded liquidation, a bounded frozen resolution PDA, exact 1–4-member passes for complete-cohort collection/allocation/payout/reconciliation, source recovery and authority-only resume. Added critical events, frozen-ledger SDK/indexer reconciliation and a separate risk role/budget. Host and both SBF profile builds, regeneration, typecheck and 28 Vitest checks pass on the dirty development tree; all five instruction families match isolated legacy Anchor.
- Signed developmental results: page sizes 1/2/3/4 pass 103/84/74/74 P09 scenario transactions respectively, each with 45 setup transactions and the same independently computed Python payout. The 64-member plus source-emergency run passes 456 P09 transactions plus 45 setup; maximum resolution page 255,482 CU / 561 bytes / 13 accounts. A pure handler-state test also covers 2/5/64 members, all page sizes, Borsh persistence after every page, derived valuation beyond ordinary stored-v limits and terminal generation exhaustion. These are development results, not clean acceptance or phase completion.
- Findings corrected: SBF stack overflow by splitting calculation/page work from emission; 64-member collection exceeded the standard heap when copying four full books, resolved with compact exact balance events and deterministic final book invalidation; one-lamport new-account test fixture violated rent minimum, corrected to real minimum rent. Found and corrected restrictive oracle sampling erasing the last credible deadline needed for emergency grace; the amended source-outage test/build is pending.
- With 203 MiB remaining, verified no task PostgreSQL containers existed and removed only the four completed P08-run disposable database volumes whose evidence is already committed, recovering about 259 MiB. Public reports/logs remain.
- Both status tables remain P09/M4 In progress; no RPC/WS/PostgreSQL P09 acceptance yet. Blockers: none. Next exact action: rerun the amended source-emergency signed test, then exercise the risk worker across process restart with actual Surfpool RPC/WS and PostgreSQL reconstruction.

- First actual P09 RPC development run `.local/runs/20261021T145255Z-77161` deployed all programs and passed 33 custody scenarios, then correctly rejected the matrix's first opening trade with OraclePolicy 6124: provisioning/certification had exceeded the 12-second qualified-funding window. No protocol relaxation. The harness now requalifies sources after provisioning, refreshes liquidation observations within the real grace window, renews genuinely expired maker epochs, and requires specific liquidation errors for financial rejections. Added an actual positively funded but insufficient-margin receiver case. The failed run is retained at `.local/p09-rpc-development.log`; actual P09 service acceptance remains pending.

- Second developmental RPC run `RIVALT_SLOT_TIME=50 bash ops/resolution-smoke.sh` exits **0** at `.local/runs/20261021T145807Z-78591`, still a dirty implementation tree. Seven checks pass: real liquidation/default matrix, funded 10→5-lot receiver fallback, persisted freeze/discovery kill and two keepers, frozen/final PostgreSQL rebuild, actual source grace/recovery and authorized resume, exact fees, and live legacy account/event decoding. There are 81 critical liquidation/resolution events and 51 successful risk-worker transactions, at most 216,545 CU / 601 bytes; risk spends 255,000 lamports and funding 20,000, with zero outstanding budget reservations. Final all-participant q/v/R and P are zero; vault V=1,001,440,107, C=1,001,439,865, T=242, I=0. The interrupted checkpoint was Collect/cursor 0.
- Final acceptance refinement: use a real five/five split so both makers receive impaired claims; retain active TP/SL through partial liquidation and final cleanup; replenish actual insurance for two residual debtors; interrupt only after collected cash is nonzero; test omitted/reordered pages and immutable pinned price. Add a separate exact half-atom stable-ID tie vector and an API check that applied claims are zero. These changes require the final clean acceptance and do not retroactively change the developmental result above.
- G10/P09 remain In progress pending the clean regression, evidence commit and ready stacked PR. No access/product blocker. Next exact action: verify the strengthened signed scenarios, commit the coherent implementation, then run `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke` and capture actual source identities/results.

- Final precommit development checks pass: pinned default/local SBF builds without unsafe stack diagnostics, fresh IDL/SDK generation and drift check, typecheck, 29 Vitest checks, three pure resolution-state tests and the strengthened signed matrix (130/111/101/101 P09 transactions for page sizes 1/2/3/4; 485 for the 64-member/source-emergency run; each uses 45 signed setup transactions). Both makers now receive impaired claims with equal-and-opposite terminal adjustments of 389,415,519 scaled units. Resolution account allocation is 8,031 bytes; largest measured page is 255,514 CU. Funding coverage closes its materialized prefix at freeze and explicitly counts frozen time as skipped; the signed matrix and pure coverage vector pass. Fresh financial-core checks and 3,000 Python cases also pass in development.
- Next exact action: commit this implementation checkpoint, run clean `RIVALT_SLOT_TIME=50 pnpm smoke`, retain actual clean-source evidence and publish P09 ready above #10. P09/M4 stay In progress until that verification completes.

- First clean full acceptance on `ef6e4bb9e1467ab8f242ba9dc9bebbd7c2f1956c`: `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke` exits **1**. Builds, exact generated output, 29 Vitest checks, 24 financial-core tests, fresh 3,000 Python cases, five maker tests, three resolution-state tests and all compiled-program suites pass. The actual P01–P08 regression also passes: `.local/runs/20261021T152000Z-90635` (18 indexer and fresh-chain reset checks), `20261021T153257Z-94804` (15 lifecycle checks), `20261021T153718Z-96174` (11 oracle checks), and `20261021T154239Z-97785` (ten order checks), all `sourceDirty: false` on that exact revision.
- P09 run `.local/runs/20261021T155128Z-750` passes the signed RPC matrix against independent Python and real funded 10→5-lot receiver fallback, then fails fresh PostgreSQL reconstruction after nonzero collection with `Order slot/reserve mismatch`. Candidate projection retained references to historical event books; later resolution cleanup mutated those same payloads before SQL replay. This is an indexer defect, not a relaxed test or an on-chain payout failure. `project` now copies canonical event data before retaining it. A regression proves the original active order and 100-atom reserve survive candidate cleanup/replay; it fails without the fix and passes with it. All 30 Vitest checks, typecheck and whitespace checks pass after the correction.
- Evidence: failed full log `.local/p09-clean-acceptance-ef6e4bb-failed.log`, red regression `.local/p09-replay-regression-red.log`; failed P09 database/logs retained. No full exit-zero or A13/A14 completion is claimed. Both status tables remain P09/M4 In progress.
- Disk upkeep: confirmed completed containers were gone before removing the first four completed acceptance scratch databases and nine earlier completed Rivalt scratch databases with public reports. All reports/logs remain; exact paths are in `.local/p09-disposable-volumes.json`. Active containers and unrelated services were untouched.
- Blockers: none. Next exact action: commit the replay correction and rerun clean `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke`, then capture and publish P09 only after all gates pass.

- Final clean acceptance: `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm smoke` exits **0** on `8e8f3716135fdcd7548271c5c508ddf4d4ac9740`. Builds/IDL/generated parity, typecheck, 30 Vitest checks, 24 financial-core tests with 3,000 fresh Python cases, five maker tests and three resolution-state tests pass. The same clean revision passes every inherited compiled-program suite and all five real RPC/WS/PostgreSQL environments: regression `20261021T160226Z-7061`, lifecycle `20261021T161515Z-11294`, oracle `20261021T161928Z-12698`, orders `20261021T162450Z-14523`, resolution `20261021T163430Z-17140` under `.local/runs/`.
- Actual P09 outcome: all seven checks pass. Real ten-lot liquidation falls back to five funded lots with a 105-atom fee; signed freeze survives discovery kill. Two keepers stop at Collect/cursor 4 of 6 after 199,774 atoms collected and zero paid. Fresh frozen reconstruction now passes, restarted workers complete the independent two-debtor/two-maker allocation, and a 104-second actual outage/recovery exercise retains zero valuation until authenticated sources recover. Separate authority resumes only after full payout/reconciliation and source qualification.
- Actual final state: all participant q/v/R and P are zero; C=1,001,449,872, I=0, T=242, allocated/actual V=1,001,450,114. The service cohort collects 229,879 and uses 10,007 insurance atoms; maker payouts are 119,921/119,965 atoms with terminal adjustments −419,324,699/+419,324,699 scaled units. These actual-time values are independently computed, not copied from SVM fixtures.
- Actual service resources: 81 critical liquidation/resolution events, 51 successful risk-worker transactions; maxima 216,278 CU / 601 bytes / 14 accounts. Risk spends 255,000 lamports and funding 20,000, each with zero outstanding reservations and exact fetched fee reconciliation. Live WS and fresh final PostgreSQL reconstruction pass; five transient indexer cycles recover. Legacy Anchor independently decodes the actual resolution account and all critical risk events.
- G10 resource/profile closure: all four legal page sizes agree with independent Python; the 64-member/source-emergency run passes. Largest signed page 255,514 CU / 561 bytes / 13 accounts, resolution account 8,031 bytes, default financial activation rejected. [Report](evidence/P09.md) and manifest (local: `docs/evidence/p09/manifest.json`) capture 54 public files and 26 clean identities, including the first failed run and red regression. Credentials/keys/volumes excluded; actual run passwords checked absent.
- Both tables now mark P09 Review and M4 In progress; G10 verified. Not run: browser wallets, integrated P11 matrix, load/24h soak, devnet/upstream verification, independent makers/review, external hedging or funded deployment. Completed corrected-run scratch databases were reclaimed only after container absence checks; all reports/logs remain and exact paths are retained in `.local/p09-disposable-volumes.json`.
- Blockers: none. Next exact action: commit public evidence, publish P09 via `gh stack submit --auto --open`, verify OPEN/non-draft/base/head, then create `phase/p10-ui` and continue immediately.

- Publication: `gh stack submit --auto --open` created ready [PR #11](https://github.com/arnabnandikgp/rivalt/pull/11), base `phase/p08-orders`. `gh pr view` and `git ls-remote` verify OPEN / `isDraft: false`, exact published evidence head `3f93609a7449acc5e0b6ab5e3f2ad08573636e05` and unchanged P08 parent `b9e6115`. Manifest hashes, 26 clean identities, changed documentation links, Rust formatting and executable-tree parity with tested `8e8f371` pass. All task containers are shut down; unrelated `buildkit` remains untouched. This link-only closeout does not change executable code. P09 remains Review; no merge or review approval is claimed.
- Next exact action: push this link-only closeout, create `phase/p10-ui` with `gh stack add`, and implement P10 browser/direct-exit acceptance on the verified P09 baseline.

### R012 — 21 October 2026 — P10 — trading UI and direct exit

- Starting baseline: clean published P09 head `828c5e321ae501e77e1bbcf70aa83ec36b549778`, ready PR #11 above #10. `git ls-remote` verifies the exact head; `gh stack add phase/p10-ui` creates the child without a merge wait. P09 full clean acceptance remains recorded at `8e8f371`.
- Read P10 delivery/validation/UI scope, current SDK and service interfaces, Wallet Standard adapter source and direct cohort/withdraw rules. Applying frontend design guidelines for accessible forms, states and responsive layout; the repository React/Vite stack is retained. Optional branding/telemetry setup does not interrupt the authorized unattended implementation, and no telemetry is sent.
- Selected exact browser tooling from installed packages/registry metadata: existing React/react-dom 19.3.0, wallet-adapter 3.1.1, Kit 8.5.0 and web3.js 3.1.1; Vite 7.3.7 (already in the locked graph); React types 19.3.0; Playwright core 1.64.1 with the already installed Chrome executable, avoiding a browser download. Install/build/browser behavior remain to be verified. Legacy Anchor remains isolated.
- Both status tables mark P10/M4 In progress. No browser test, real-wallet provider, performance or phase-completion claim. Blockers: none. Next exact action: install exact app/browser dependencies, implement a validated direct RPC client and wallet transaction lifecycle, then wire the trading UI and actual browser harness.

- Implementation progress: exact app dependencies installed; production Vite build, typecheck and runtime dependency isolation pass. `pnpm test` passes 37 tests at that point; subsequent targeted client/receipt regressions pass, including independent split prices, altered instruction/fee rejection, cryptographic saved-byte verification and concurrent receipt retention. No program economic rule changed. Form quantities and balance labels use integer arithmetic; browser receipt state distinguishes confirmed/finalized/unresolved.
- First development browser run `.local/runs/20261021T172250Z-30541` passes 33 actual custody scenarios but fails before browser signing because the Vite middleware registration returned a Connect app as a post-hook. Fixed by returning no post-hook. Second run `.local/runs/20261021T172655Z-31955` loads real API-backed UI but its instrumented wallet fails with `__name is not defined`; fixed by injecting plain JavaScript stripped with pinned Node instead of serializing tsx helper references. Independent headless Chrome 156.0.8078.47 registration/connect check passes with zero page errors. Failed logs/screenshots are retained; neither run satisfies A15.
- Direct-exit correction: compiled-message privilege inspection proves that a cohort proof containing the exiting participant cannot share a transaction with its cash mutation, since Solana promotes writability globally and the existing proof requires read-only participants. The SDK now exposes explicit proof transactions before a fresh exit preview, preserving the on-chain contract. Regression verifies actual compiled participant writability and the subsequent withdrawal instruction; D31 and P10 specification agree.
- Both tables remain P10/M4 In progress. Stopped historical Rivalt scratch database volumes were reclaimed after container inventory, with reports/logs retained; `.local/p10-reclaimed-volumes.json` records paths. No unrelated service or container was changed. Blockers: none. Next exact action: finish the third fresh browser lifecycle, resolve actual failures, then commit and run clean full acceptance before publishing a ready P10 PR.

- Further P10 development runs: `20261021T173157Z-33622` verifies wallet connection/rejection and a real deposit, then exposes insufficient fixture collateral for a second preview. Provisioned additional classic test tokens and added a fresh wallet-token balance check. Production SDK error text now retains custom instruction/code information instead of Codama’s production-only placeholder. `20261021T173700Z-35367` additionally verifies account switching, second-wallet registration and wrong-genesis recovery, then rejects a quote during a local RPC slot/account mismatch (`risk.validFrom=4012`, reported finalized context slot `3992`). No financial instruction succeeded under that mismatch.
- The next run `20261021T174336Z-37063` uses a declared five-second sampler cadence (service default remains two; configuration restricted to 2–5, on-chain policy unchanged), records unsigned quote retries, and passes 12 browser checks through real two-maker open/close, funded profit settlement, partial/replaced/cancelled orders, protective generation and lost-ack/reload recovery. It then hits a harness selector error after reload correctly reset the unsigned order form: the optional New order button no longer exists. Corrected the selector to account for the actual form state. Stopped-API exit, responsive screenshots/final reconciliation and clean full acceptance still remain. All failures are retained under their run directories.
- Updated specifications/D31 describe separate read-only exit proofs, local sampler scheduling and observed Surfpool preview limitations. Full fast suite now passes 41 tests across 17 files; current typecheck/build pass. Both status tables remain P10/M4 In progress. Next exact action: commit this coherent implementation checkpoint, run the full browser harness on clean code, inspect screenshots, and then run full P01–P10 acceptance before publication.

- Implementation committed as `9b38b5a75f62c8fbe84ea0fadb4fc8be9faf625d`. The first clean browser run (`20261021T175030Z-38996`, `.local/p10-browser-clean-9b38b5a.log`) passes nine checks then observes a genuine finalized route rejection (6118) when the risk observation changes after review. The app correctly records failure; the harness incorrectly waited only for success. Updated the harness to independently fetch a known finalized failure, verify the actual vault and all funded participant accounts are unchanged, record its signature/code/network fee, and model a new explicit review/sign only after that proof. Missing/expired/unresolved results never qualify for this path; retries are bounded. The deliberate stale-quote assertion now binds the newly signed receipt so an earlier rejected route cannot satisfy it.
- UI notices now follow the independently reconciled terminal/unresolved result instead of leaving an obsolete submission notice. Typecheck, production build and 10 targeted client/receipt regressions pass after this correction. Both tables remain P10/M4 In progress. No A15/full-suite completion claimed. Next exact action: commit the race/status correction and rerun clean browser acceptance, then full P01–P10 acceptance.

- Race/status correction committed as `98fab1f0e2b46a4729006ef5bb15537d81199300`. Clean run `20261021T180003Z-41793` reaches actual API-stopped cancellation, then direct withdrawal receives a preflight-only rejection after signing. No transaction enters history; the client correctly retains an unresolved receipt and does not replace it. Aligning direct RPC transport with the existing relay: retain unsigned simulation before wallet review and cryptographic verification/persistence after signing, then send exact bytes with `skipPreflight:true` so on-chain rejection can be fetched as failed with its actual fee. On-chain enforcement and unknown-outcome handling are unchanged; this does not guarantee inclusion.
- Reclaimed only completed stopped P10 development database volumes after confirming the sole active Rivalt container belonged to run 41793. Reports, logs, screenshots and captured public state/queue diagnostics remain; `.local/p10-development-volumes.json` records exact paths. Both tables remain P10/M4 In progress. Next exact action: commit the direct transport correction, rerun clean browser acceptance and inspect its screenshots before full P01–P10 acceptance.

### R013 — 23 October 2026 — P10 — resumed browser acceptance

- Resumed on `98fab1f` with the four documented pending transport/spec/worklog files; no unrelated changes found. Re-read the current instructions, product, delivery, interface and validation contracts. Started the existing Apple container service after its API reported inactive; only the stopped buildkit container existed, and test ports were free. No host database or unrelated service was changed.
- `pnpm typecheck` and `pnpm build:trader` pass; build retains the reported >500 kB bundle warning. An initial targeted Vitest command used nonexistent `tests/unit` paths and ran no tests; corrected verification with `pnpm test` passes all 41 tests across 17 files. No browser or full acceptance success inferred from these checks.
- Both status tables remain P10/M4 In progress. Blockers: none. Exact next action: commit the direct submission correction and run fresh browser acceptance on that clean commit, then inspect screenshots and run inherited full acceptance before publishing the ready stacked P10 PR.

- Direct submission correction committed as `6466ae8b6412ef4fcc2fd98b8c5aae91190135d9`. Fresh 50 ms browser run `20261022T195129Z-55894` fails during clearing upload with the CLI's default five blockhash signing attempts; no browser checks ran. Fresh 100 ms run `20261022T195322Z-56481` exits zero: all 15 browser checks, 24 finalized receipts, one independently proven failed quote race (6118, 5,000 lamports), one expired unresolved quote, 68 WebSocket notifications and exact PostgreSQL replay. Zero page/source errors. Actual API-stopped cancel and withdrawal pass. Desktop dark/mobile light captures inspected; six 375/768/1280 light/dark captures satisfy overflow/labels/focus checks. An independent Python integer calculation also confirms cash/vault, zero net lots and fully accrued claims equal P. This instrumented wallet is not external-provider evidence.
- Full clean `RIVALT_SLOT_TIME=100 pnpm smoke` on `6466ae8` exits 1 in order recovery (`oracle.status=1`, expected 2). Builds/ABI/typecheck, 41 fast tests, independent arithmetic, all compiled-program suites, 33/54/73 custody/maker/route RPC scenarios, 18 indexer checks plus reset isolation, 15 lifecycle checks and 11 source/funding checks pass first. Reports: `20261022T200316Z-67791`, `20261022T202355Z-73772`, `20261022T202930Z-75399`; failed order setup `20261022T203637Z-77585`. `.local/p10-full-acceptance-100ms-failed.log` retains the failure. The sequential harness waits for both publication and sampling finality; at 100 ms slots these intervals can exceed the existing six-second recovery-gap limit. The program correctly remains restrictive. No change to funding/source rules or relaxation of the assertion is made.
- Return full integrated acceptance to the selected 50 ms profile. Local program upload/upgrade commands now explicitly permit at most 20 CLI blockhash signing attempts instead of five; only identical program/buffer provisioning is affected, not financial retries. CLI help verifies the flag. The standalone browser success at 100 ms does not certify all manual harnesses at that cadence. Both tables remain P10/M4 In progress; no P10 PR exists yet. Exact next action: verify shell/type checks, commit the upload-only allowance and documentation, then rerun clean full `RIVALT_SLOT_TIME=50 pnpm smoke` before publication.

- Upload allowance verification: `bash -n` passes for every acceptance supervisor; `pnpm typecheck` and `git diff --check` pass. No economic/program code changed. Next exact action: commit and run clean full acceptance at 50 ms.

- Upload-only correction committed as `881ae54a5816c09ca5dd1324723f4010b135a46c`. The 50 ms full run passes locked builds/ABI drift/typecheck, production UI build, 41 fast tests, independent arithmetic/compiled-program suites, fresh regression/indexer/reset (`20261022T204515Z-83101`), lifecycle (`20261022T205749Z-87247`), sources/funding (`20261022T210200Z-88680`) and orders (`20261022T210723Z-90717`). Actual RPC counts are 33 custody / 54 maker / 73 route, 18 indexer + five reset, 15 lifecycle, 11 oracle and ten order checks. No historical counts substituted.
- User explicitly directs change-scoped PR tests and CI for broad regression where supported. Stopped only this run's verified process group while unrelated P09 deployment was underway (`20261022T211700Z-94432`); wrapper exits 143. No risk/default check or wrapper browser check is claimed. Existing host services were untouched. AGENTS/validation/README/D32 preserve the instruction; P11's matrix and P12's real soak remain required phase work. No CI job exists or is claimed to have run yet.
- Targeted `source ops/env.sh && RIVALT_SLOT_TIME=50 bash ops/browser-smoke.sh` on clean `881ae54` exits 0, run `20261022T211757Z-94891`: all 15 checks pass, including actual API-stopped owner cancel and withdrawal. 25 wallet signatures comprise 23 finalized / one independently proven failed quote race (6118, 5,000 lamports) / one expired unresolved quote. An unsigned withdrawal preview rejects 6122 and refreshes before signing. Exact wire/history agreement, 53 WS notifications, fresh database replay, zero page/source errors and final actual vault 1,101,100,007 atoms reconcile. One transient indexer cycle recovers. Funding spends 110,000 lamports, maker budgets zero, outstanding reservations zero.
- Inspected fresh desktop-dark/mobile-light captures; six viewport/theme captures pass automated overflow/labels/focus checks. Independent Python integer sums confirm cash/pools/vault, net exposure, gross lots and fully accrued claims in all five captured successful environments. Evidence export initially selected the wrong report field name (`actual` instead of `actualVault`); corrected the exporter and regenerated the bundle without rerunning tests. [P10 evidence](evidence/P10.md) and its 46-file manifest contain 20 clean source identities. Program/financial-core trees match the verified P09 parent.
- Both status tables now P10/M4 Review, not Closed; ready PR publication pending. Build bundle warning remains. Not run: remaining unrelated wrapper stages, A16 matrix/load/soak, external wallet/provider/devnet, independent review/maker or funded deployment. Blockers: none. Exact next action: commit reviewed P10 evidence and verification-scope docs, submit `gh stack submit --auto --open`, record its actual PR, then start P11 above that exact head.

- Publication: `gh stack submit --auto --open` creates ready [PR #12](https://github.com/arnabnandikgp/rivalt/pull/12), independently verified OPEN / `isDraft:false` / base `phase/p09-resolution` / head `c016715c1555ccf409e8f3003392c72eb67163c2`. Body/title describe final scope and targeted evidence. P10/M4 remain Review. Exact next action: push this link-only closeout, create `phase/p11-matrix` with gh stack above that exact published head, and implement P11 without waiting for merge.

### R014 — 23 October 2026 — P11 — integrated matrix and scoped CI

- Started `phase/p11-matrix` with `gh stack add` above exact published P10 head `cb42c567838971e0800e744ceb4edc4db60b0f6f`; PR #12 independently verified ready and correctly based on P09. No unrelated work found. Read phase A16, protocol accounting, component interfaces and validation requirements.
- Scope: one reproducible scenario-by-scenario A01–A16 command, immutable revision/binary/IDL/config/seed identity, independent integer reconciliation, retained rejected/unfilled/unresolved populations and failures/not-run stages. Existing actual-RPC/WS/PostgreSQL fault harnesses remain the execution mechanism; no fixture may fabricate economic success.
- User's scoped-test instruction remains authoritative. P11 itself owns one fresh complete integrated matrix; it is not a prerequisite for every future PR. GitHub API reports zero self-hosted runners; repository is public. Plan focused free hosted CI for affected fast checks, without claiming Apple Containers support or configuring paid/external infrastructure. Official Action release commit pins were resolved directly from GitHub. No CI execution claimed yet.
- Both tables: P11/M5a In progress; P10/M4 Review. Blockers: none for local implementation. Exact next action: implement the orchestrator/report and independent rejection tests, verify the changed harness, commit clean source, then run the phase-owned matrix once before publication.

- Implemented `tests/e2e/run.py`/`matrix.py`, seven sequential actual-runtime stages, atomic progress reports, unique service run IDs, source/IDL/lock/config/binary hashes, explicit partial-stage mode, independent integer cash/claims/cohort checks and 23 named fault observations. Public intent/cohort exports preserve non-success populations. `pnpm smoke`/`pnpm test:matrix` now use the explicit orchestrator; ordinary targeted commands remain available.
- Added scoped `pull_request` CI with pinned official checkout/setup-node commits, read-only permissions and actual stacked-base diff selection. Only free standard hosted jobs are configured; no self-hosted or full-runtime compatibility claim. Added MATRIX contract and D33 alongside component/validation/README updates. No financial/program source changed.
- Focused validation: 20 Python report/scope/process tests pass on Python 3.15.0; exact one-scaled-unit drift, changed checkpoints, incomplete cohort, wrong binary, stale/dirty identity, missing/modified reports, retained rejected/unresolved orders, failed exits and scoped timeout cleanup are exercised. TypeScript passes after replacing an unavailable root `pg` type import with a narrow structural journal-reader interface. All acceptance shell scripts pass `bash -n`, workflow YAML parses, and `git diff --check` passes. Saved reports were used only for data-format compatibility checks, never as new A16 evidence.
- Both tables remain P11/M5a In progress; no P11 PR or A16 completion claim. Hosted CI has not run. Exact next action: commit the coherent harness and run one fresh clean `RIVALT_SLOT_TIME=50 pnpm test:matrix` for this phase's explicit A01–A16 gate; record actual outcome before ready publication.


- Final phase acceptance: `source ops/env.sh && RIVALT_SLOT_TIME=50 pnpm test:matrix` exits **0** on clean `806715981a5012a0ec48f452766dc636c52d0c81`, run `.local/matrix/20261022T214423Z-4148`, 21:44:23–22:32:28 UTC on 22 October (**2,885.331 seconds**, 23 October local time). All seven stage commands exit zero, all A01–A16 rows and 23 named fault observations pass, and six complete cohorts reconcile independently using Python integers. All captures are new on that exact revision; [P11 evidence](evidence/P11.md) and the 95-file allowlisted manifest retain identities, stage logs, primary/legacy reports and all non-success populations.
- Actual browser stage: all 15 assertions pass, 24 wallet signatures (22 finalized / one failed / one unresolved), 50 WS notifications, one transient recovered indexing failure, no remaining browser errors. Actual failed Buy code 6118 pays 5,000 lamports and has unchanged funded state before explicit renewed review. API process is really stopped for direct cancellation/withdrawal. Browser vault=1,101,100,007 atoms, C=1,101,087,504, I=10,007, T=2,496, P=0, net q=0 and gross q=4. Browser funding fees=100,000 lamports, zero outstanding commitments. No external wallet-provider claim.
- During acceptance reclaimed only ten completed/stopped P10 PostgreSQL test volumes after checking container inventory; reports/logs remain and `.local/p11-reclaimed-p10-volumes.json` records exact paths. No active P11 database, host database, unrelated container or user data was removed. Scoped `caffeinate` ended with the matrix process. No program/financial source changed. Evidence-only closeout corrects README matrix cadence/path and documents inherited base64-text versus decoded-byte wire-hash representations; no unrelated rerun is needed.
- Both tables: P11 Review, M5a In progress; P12 not started. Not run: P12 load/24-hour soak, devnet/external wallet parity, independent review/maker or funded deployment. Hosted CI is pending the first PR publication; zero self-hosted runners means no broad runtime CI claim. Actionlint is unavailable; YAML parse and shell syntax passed. No access/product blocker. Exact next action: commit this evidence/spec closeout, submit ready `gh stack submit --auto --open`, inspect the actual scoped CI jobs and publish their results, then start P12 above the exact P11 head without waiting for merge.

- Publication and hosted validation: `gh stack submit --auto --open` creates ready [PR #13](https://github.com/arnabnandikgp/rivalt/pull/13), independently verified OPEN / `isDraft:false` / base `phase/p10-ui` / head `6d24616785a48f503c673c7c6564ad9863511de7`. The first [actual CI run](https://github.com/arnabnandikgp/rivalt/actions/runs/39866000756) completes successfully: scope, client, financial, report and shell all pass. P11 stays Review; M5a stays In progress. Exact next action: push this documentation-only publication record, create `phase/p12-load-soak` with gh stack above the exact published P11 head, then measure 1/5/10 offered attempts per second and implement the bounded local long-run profile. No merge wait.

- Hosted follow-up correction: documentation-only head `2849fc7` [CI](https://github.com/arnabnandikgp/rivalt/actions/runs/39866221647) passes four jobs but the client job hits the default 5-second timeout in the unchanged exhaustive 600-vector allocation test (actual 6.854 s). No arithmetic assertion fails. A separate `/private/tmp/rivalt-p11-ci` worktree isolates this correction while P12's first clean sweep runs. Increase only that test timeout to 15 seconds; retain every independent vector/assertion, all economic code and the tested local matrix. Both tables retain P11 Review / M5a In progress, with the latest hosted correction pending. Exact next action: publish the timeout-only correction, verify hosted client completion, and incorporate the new P11 head into P12 after its active sweep finishes. No full local matrix rerun is relevant to this change.

### R015 — 23 October 2026 — P12 — measured load and sustained recovery

- Started with `gh stack add phase/p12-load-soak` above exact published P11 head `2849fc7`; ready PR #13 and its first five hosted checks pass. Read P12/A17, metric definitions, protocol/interface constraints and actual worker/indexer code. No unrelated work found.
- Host inventory: Apple M3, eight logical CPUs, 16 GiB memory; 3.2 GiB free before long-run preparation. Only the unrelated stopped buildkit container remains after P11; host PostgreSQL 14 is untouched. Measure actual disk/memory growth before selecting the soak envelope.
- Implement explicit loopback-only `soak24` service fee caps (500,000,000 lamports per operator role and 5,000,000 per maker), preserving default smoke caps and immutable persisted budget identity. At the existing two-second sampler floor, one day is at most 43,200 ordinary samples; the cap covers 216,000,000 lamports at the observed 5,000 fee plus headroom. Actual payer funding/fees remain required, with no automatic top-ups. Extend the explicitly bounded indexer recovery option to at most 200,000 transactions; default stays 10,000 and history/metadata/cohort reconciliation remain mandatory. These are implementation choices, not yet verified long-run measurements.
- Both tables: P12/M5a In progress; P11 Review. No A17/load/soak completion claimed. Exact next action: finish the focused actual-RPC load supervisor and metrics, test the new bounds/report arithmetic, then run a short 1/5/10 sweep to identify actual bottlenecks before the real 24-hour run.

- Focused implementation: new standalone load supervisor provisions only the required real fixture, with separate maker/funding/order/settlement/risk/executor/indexer processes; three trader accounts use HTTP quote/immutable submission and independent RPC fetch/decode. Complete attempt populations, exact fees, per-stage latency/resource summaries, independent Python chain checks and final history/budget/rebuild checks are recorded. Five new profile/metrics/bounds tests pass. Initial typechecks exposed missing workspace declarations and an inferred unknown opening-balance type; fixed using the existing exact dependency pins and an explicit structural type. No package version changed. Load/24-hour results remain pending; next action is the clean short sweep after final typecheck.

- First clean probe on `33ff3d02c8e63e36ab328c1ab5168d214e2ba75a`, `.local/load/20261022T224549Z-26453`, exits 1 during source setup: a mistyped clock sysvar address is rejected by real RPC. Twenty-five actual provisioning transactions were fetched; **zero load attempts ran**. The failure JSON/log remain. Corrected to the existing verified clock address with SDK address validation. Typecheck, shell syntax, five focused tests and saved-report format compatibility had passed; that compatibility check was not new financial evidence.
- P11 follow-up [CI](https://github.com/arnabnandikgp/rivalt/actions/runs/39867566681) passes on exact `42ba20911186d250898aca668f62ef4c5a9a31ca`. Incorporated it through `gh stack rebase --no-trunk`; resolved only WORKLOG/DECISIONS append conflicts while preserving both histories. The isolated CI worktree was removed cleanly. Both tables remain P12/M5a In progress, P11 Review. No full matrix rerun is relevant to the timeout-only parent change. Exact next action: typecheck the clock correction, commit it, and rerun the same short scoped sweep.

- Second clean probe on `f2415ad`, `.local/load/20261022T225134Z-28214`, completes all three 60-second sweeps and exits **2** because the performance target fails. At 1/s: 60 offered, 43 submitted, 40 successful (93.023%), 17 unavailable quotes and three finalized 6118 observation races; quote p95 25.125 ms, first observed processed p95 327.857 ms. At 5/s: 300 offered, 66 submitted, 65 successful, 190 busy-account attempts, 44 unavailable quotes, one 6119 bound rejection. At 10/s: 600 offered, 46 submitted, 35 successful, 265 busy-account attempts, 289 unavailable quotes, eight 6119 and three 6117 rejections. No failure population is dropped or reclassified as an injected fault.
- Financial/resource checks pass in that failed-target probe: maximum route 298,176 CU / 884 bytes / 18 accounts; six-member vault=allocated=1,400,000,000 atoms; independent Python checks, PostgreSQL fresh projection rebuild and deliberate too-small history-limit rejection pass. Every operator's actual SOL balance change equals its journal fee total, all commitments are zero, and source publisher errors are empty. Primary DB grew from 8,722,111 to 14,743,231 bytes across the sweeps; with fresh rebuild it reached 19,486,399. This is insufficient elapsed time for a soak claim and requires disk-growth budgeting before 24 hours.
- Measured correction in progress: transaction insert issues a PostgreSQL notification delivered only after commit; the existing separate executor wakes on its run's hint and retains its 250 ms durable fallback scan. No API broadcast authority, immutable signature, fee-reservation, unknown-history or on-chain rule changes. Add explicit safe quote-unavailability reason codes for the report. Two scheduling tests pass (notification during scan and bounded fallback); typecheck passes after explicitly inferring the promise-returning pg connect overload. Both tables retain P12/M5a In progress. Exact next action: complete typecheck, commit, exercise the actual missed-notification/lost-ack/executor-kill recovery inside the new load environment, then repeat its sweep. This avoids repeating unrelated inherited scenarios.

- Clean wake-up probe on `bca5c6e6d585518b4f50c311b4a1082625d95ba6`, `.local/load/20261022T230923Z-33208`, completes all sweeps and final checks but exits **2**. Actual missed-notification/lost-ack/SIGKILL/restart proof passes in 2,912 ms: original signature only, cash 100,000,000→100,000,001, actual fee 5,000, changed-byte idempotency request rejected. Final six-member vault/allocated=1,400,000,001; exact payer/journal budgets and independent reconciliation/rebuild pass, no source publisher errors.
- Measured scheduling result: 1/s 42/43 successful (97.674%), first-observed processing p95 127.013 ms (previous 327.857), quote p95 26.773 ms; one 6118 rejection remains. 5/s 68/69 successful; 10/s 46/51. Max 298,176 CU / 884 bytes / 18 accounts. Explicit quote reasons identify 17/60/142 observation-not-finalized responses in 1/5/10 and 132 risk-increase restrictions during the 10/s maker-epoch recovery. Failed/unsupported requests remain fully retained. These short samples do not satisfy 99% and are not discarded.
- Next scoped diagnostic: retain actual executor broadcast-attempt timestamps (public request/signature only) and allow a declared 300-second 1/s qualification without repeating the unchanged higher-load sweep. No admission/finality/economic relaxation. Both tables remain P12/M5a In progress. Exact next action: typecheck this instrumentation, commit, then run `pnpm test:load --sweep-seconds 300 --rates 1` and measure its complete outcome population and storage growth before selecting the 24-hour profile.

- Clean 300-second 1/s qualification on `53f861cdf955e1df3144ff074ef75baf499020d1`, `.local/load/20261022T231925Z-36005`, completes in 300.808 seconds and exits **2**: 300 offered, 196 submitted, 193 finalized successes (98.469%), 104 unavailable quotes, three failed transactions. Quote p95 32.158 ms; actual signed-ready→broadcast p95 33 ms, maximum 235 ms; first observed processing p95 127.254 ms. Max route 298,197 CU / 884 bytes / 18 accounts. Two 6118 failures follow an immediately preceding funding broadcast; the 6117 failure is adjacent to maker epoch expiry. Failed attempts remain eligible and retained.
- This qualification's real missed-notification/lost-ack/SIGKILL proof passes in 2,914 ms; six-member vault=allocated=1,400,000,001 atoms, independent Python checks, PostgreSQL reconciliation and fresh projection rebuild pass. Actual payer/journal fees: funding 270,000; settlement 545,000; makers 5,000 each; orders/risk zero. All commitments zero and source errors empty. No soak or large-history claim.
- Removed only nine completed, inactive test PostgreSQL volumes (six P11 matrix environments and three prior P12 probes) after inspecting the active container inventory. Reports/logs/transaction evidence remain. The active P12 database, unrelated host PostgreSQL 14 and stopped buildkit were untouched; `.local/p12-reclaimed-completed-volumes.json` records paths. Free disk increased to about 3.5 GiB; long-run capacity remains unresolved.
- Measured boundary correction: quote preparation rejects pending operator-budgeted funding updates and quotes with <=10 remaining processed slots. The declared P12 five-second sampler additionally selects a one-second pre-sample dispatch margin; the default margin is zero. All resulting unavailability stays in the offered population. No on-chain validity, funding cadence, economic bounds or signature retry rule changes. Worker pending queries bind the actual budget, and public ingress rejects reserved worker request prefixes, preventing callers from shadowing internal intent identities. Two new focused boundary/namespace tests and typecheck pass; the real immutable-submission probe now also asserts reserved-prefix rejection with actual signed bytes and no inserted row.
- Both tables remain P12/M5a In progress. Unchanged program/matrix/browser suites are not rerun for this service-only correction. Exact next action: commit the correction and rerun the declared 300-second 1/s qualification, then implement the remaining resource/real-soak instrumentation after the complete result is known.

- Corrected clean 1/s qualification on `7dc9f1c`, `.local/load/20261022T233538Z-40242`, **exits 0** after 300.006 seconds. All 107 submitted trades succeed; 193/300 offered attempts receive an unavailable quote (35.7% offered availability). Quote p95 31.725 ms, actual dispatch p95 32 ms, maximum 298,197 CU / 884 bytes / 18 accounts. Actual lost-ack/restart plus reserved-worker-namespace checks pass in 3,008 ms. The six-member vault remains exactly 1,400,000,001 atoms; independent chain checks, projection rebuild, zero commitments and all actual operator fee deltas pass. Source errors empty. These results supersede the pending boundary verification, not the retained prior failures.
- Storage measured 8,820,415→15,087,295 primary DB bytes over the 300-second baseline; a new projection brings the same DB to 19,928,767. Reclaimed only the inactive 903 MiB `target/debug` cache and the preceding completed qualification's 94 MiB PostgreSQL volume after confirming no build was active. Deployed SBF artifacts and all reports/logs remain; `.local/p12-reclaimed-debug-cache.json` records the paths. Approximately 4.35 GiB is now free. A declared 0.25 offered attempts/second sustained candidate will measure resource viability; this does not erase the required 1/5/10 populations or claim lower offered load improved prior failed submissions.
- Sustained implementation: distinct 900-real-second harness exercise and exactly 86,400-real-second soak modes; sleep/clock/stall detection, process CPU/RSS and disk/DB samples, periodic independent chain reconciliation, active production-built Chrome UI observer, six predeclared maker/worker/indexer faults and actual stored-order work. Maker outages last 210 real seconds and must show expired epochs. Final one-atom withdrawal, fresh PostgreSQL **database** replay and source/operator fee reconciliation are required. Long acceptance additionally requires >10,000 fetched transactions. No accelerated clock or automation was created.
- Add separate prefunded synthetic source payer with a 1,000,000,000-lamport cap and actual fee reservation/reconciliation. Raw fetched transactions and quote inputs are losslessly gzip-journaled. Public quote audit fields expose only the already-read public balances/inputs; a separate Python per-lot exhaustive reference checks every load quote with empty effective books, literal aggregate-fee/split-benefit vectors, and no positive-unpaid-profit margin credit. Shortfall stays an exact rational; SOL and collateral costs remain separate. UI latency includes unavailable/censored observations; no external wallet claim. Funding coverage/skips/cap samples and retained fractions are reported from actual events/accounts.
- Focused checks so far: new continuity test, independent reference test, three affected metric tests and TypeScript check pass. CI is extended to run the new Python reference tests; broad hosted checks remain deferred to publication. Unchanged Rust/SBF/matrix/browser regressions were not rerun. Both status tables keep P12/M5a In progress. Exact next action: finish the affected scope/syntax/type checks, commit, and run `pnpm test:load --exercise-seconds 900 --rates 0.25` before the actual full-day run.

- Sustained harness committed as `5c29a18`; its first exercise provisioning (`.local/load/20261022T234950Z-44321`) was intentionally stopped before fixture/load startup after inspection found the reused lost-ack proof assumed no concurrent cash movement. No exercise result is claimed. The initial idle-account proof retains exact cash +1; the in-load proof instead decodes the one-atom deposit event and independently reads the source SPL token decrement, while retaining the original signature/idempotency checks. This avoids treating normal concurrent settlement/trade cash changes as a test failure. Scope checks (four), typecheck, shell syntax and diff checks passed before that start. Exact next action: typecheck/commit this harness-only correction and restart the same 900-second exercise.

- Clean exercise on `93c7fecf67bf1db047c4b1a07482b6325e1a5356`, `.local/load/20261022T235134Z-44950`, exits **1** after roughly 624 seconds when the third durable order (reopening after a close) incorrectly supplied a nonzero generation for an ordinary order. Actual code 6126 is retained in fetched transaction logs; the program correctly rejects it. Fix the harness to use generation zero for ordinary entries and the current generation for reduce-only exits. No program rule changed.
- Partial actual results retained: 157 offered / 27 successful submitted routes / 130 unavailable; maker A/B both show expired on-chain epochs then recover (284.445 / 556.212 elapsed seconds), and the in-load lost-ack/executor kill proof passes in 3,124 ms at second 600. Two durable orders fill (open gross 60,011 fee 13; close gross 59,988 fee 12). Minute-by-minute independent snapshots pass; at second 603 DB is 14,046,911 bytes with 4,533,424,128 free. Funding/indexer/settlement faults and final reconciliation/rebuild were **not reached**; no complete exercise/soak claim.
- UI observation exposed a separate real read-model defect: 13 of 27 fills became censored after sequence crossed 100, while API data existed. PostgreSQL `ORDER BY sequence` resolved the selected `sequence::text` alias and sorted lexically, placing 98 ahead of 218. Reopened only the completed run's PostgreSQL volume in a temporary diagnostic container; actual queries show old latest `98,87,...` versus numeric latest `218,213,...`. Proof is `.local/p12-sequence-order-proof.txt`; that diagnostic container is stopped/deleted, the unrelated buildkit/host PostgreSQL untouched. Fix trades/event pagination and candle chronology to qualify the original numeric `events.sequence` column.
- Scoped follow-up: add `--exercise-tail-seconds 360 --rates 0.25` covering real ordinary open/close/reopen, the three unfinished funding/indexer/settlement faults, UI visibility, final withdrawal and fresh-database replay. Previously verified maker/loaded-executor faults are retained rather than rerun solely for this correction; the eventual full-day run still exercises all six. A new check uses actual PostgreSQL rows through Fastify handlers and an independent numeric sort/per-minute price ordering to validate forward/latest pagination and candles across sequence 100. Unexpected worker exits now fail the sustained monitor; unsigned quote unavailability remains recorded. Both status tables remain P12/M5a In progress. Exact next action: commit these focused fixes and run the 360-second tail exercise; no unrelated suite is needed.

- Clean 360-second follow-up on `ede6e1da4109584a59eb2c3146deebf3121c6f64`, `.local/load/20261023T001053Z-50644`, completes the offered interval but exits **1** in the new offline quote audit, before withdrawal/read checks/rebuild. All three remaining faults pass: funding recovery at 103.932 s, actual indexer sequence 90→113 at 211.422 s, settlement recovery at 301.643 s. Three real stored open/close/reopen fills pass. Continuity is 360.319 wall / 360.336 monotonic seconds, max heartbeat gap 627 ms, max clock drift 17.651 ms. Thirty submitted routes all finalize (22/22 normal eligible); 60/90 offers unavailable. Quote p95 18.292 ms, actual dispatch p95 17 ms, max 298,180 CU. Primary DB grows 8,853,183→13,088,447 bytes. This is still not a complete final verification or soak.
- UI correction evidence: all 22 normal fills are observed, normal UI p95 617 ms / API p95 535 ms; one of eight fault fills is censored during the planned indexer outage, with 142 unavailable API polls and no page errors. The prior lexical-staleness observations are retained. Formal full pagination/candle checks still await execution.
- Quote audit failure diagnosis: at `load:36`, snapshot slot 5,162, the independent checker incorrectly considered maker A without its epoch window and expected a better split than the actual B-only route. The fetched maker A initialization is at slot 1,548 with duration 3,600 (initial exclusive expiry 5,148); the original quote audit omitted validity inputs. Add version/start/expiry to public audit metadata, and independently enforce the fixed profile's epoch window. Literal boundary and future-epoch cases pass. Old captures lacking this context remain incomplete audit evidence, not silently repaired.
- Narrow remaining verification to `--final-check-seconds 180 --rates 1`: it keeps real services, UI observation and independent chain/resource samples, but does not repeat the six already observed fault windows or stored-order regressions. It must verify complete quote inputs, final withdrawal, actual numeric pagination/candles and fresh-database replay. Also correct the new candle reference to compare high/low VWAP values by exact cross multiplication: equivalent ratios from different fill sizes are valid representations. A literal equality/one-atom-inequality test covers that assertion, not a production price change. Both tables remain P12/M5a In progress. Exact next action: commit after focused type/reference checks and execute the final-check probe; actual 24 hours remains outstanding.

- Clean final-check probe on `912bf81ce1142c8cf6472f52186851c208520fb3`, `.local/load/20261023T002409Z-54485`, completes 180.920 seconds of load and all **59 independent quote audits**, with four two-maker quotes, exact aggregate fees, zero independent-optimum regret, and 1,761 atoms of feasible same-state split benefit. All 59 submitted routes finalize; 121/180 offers unavailable, quote p95 33.788 ms, actual dispatch p95 32 ms, max 298,152 CU / 884 bytes / 18 accounts. All 59 fills reach API/UI with zero censorship, UI p95 1,595 ms/API p95 510 ms and no page errors. No inherited fault suites were repeated.
- The probe then exits **1**: the harness tries to start a new exit-cohort scan at the same stamp as a certificate already completed by the settlement worker; on-chain code correctly rejects the rewind with 6121. Withdrawal, formal read checks and fresh-database replay are not reached. Fix the harness to reuse an already complete certificate or resume its exact cursor, checking current market/observation/member-count bindings. No protocol permission or gate is relaxed.
- Long-run measurement refinement before launch: the actual 360-second exercise showed about 48 ppm wall/monotonic clock slew. Retain the 10-second heartbeat and 2-second per-sample clock-jump failure gates; allow cumulative slew of at most 2 seconds plus 100 ppm elapsed. Require **both** clocks to reach the requested duration, extending steady offered load if the wall clock lags. Two focused continuity tests, including 86,400 synthetic one-second samples at 50 ppm and an abrupt clock jump, pass; these test the measurement arithmetic only and are not elapsed soak evidence.
- Move potentially long offline quote analysis after all live financial/final-history work so it cannot block the source publisher's Node event loop during withdrawal. Bound read-API checks to forward pages at every reached decimal boundary plus latest pages, while retaining complete independent history reconstruction; there is no need to send thousands of redundant HTTP pages after a long soak. Resource sampling now includes owned browser/service descendants and host VM counters, with PostgreSQL's declared 512 MiB VM cap separate. Both tables remain P12/M5a In progress. Exact next action: commit after typecheck and rerun only the 180-second final-check probe; no completed outage is repeated.

- Final scoped probe on clean `2e76c7b674ac523a6f419e224d9acc497aea3f44`, `.local/load/20261023T003724Z-58126`, **passes**: actual 181.924-second offered load, 181 offers / 60 submitted / 60 finalized / 121 unsigned unavailable, quote p95 27.439 ms, dispatch p95 30 ms, maximum 298,161 CU / 884 bytes / 18 accounts. All 60 independent quote audits match, including three split routes, zero optimum regret and 234 atoms of feasible same-state benefit. All 60 fills reach API/UI without censorship; API p95 463 ms, UI p95 1,508 ms, no page errors. The supervisor log records `Load targets pass` and `load.json` records `result: pass`; its shell session had already been collected on resume.
- Actual one-atom withdrawal passes; 178 numeric events, 60 trades and four actual-fill candles pass independent read checks. Fresh PostgreSQL database reconstruction fetches 189 transactions and matches final sequence 178 and vault=allocated=1,400,000,000 atoms. Source/operator fees match actual SOL deltas; outstanding commitments and source errors are zero. Public reports and hashes are committed under [P12 preflight evidence](evidence/P12-PREFLIGHT.md). No faults or stored-order scenarios were repeated in this probe.
- Resource preflight: Apple M3/eight logical CPUs/16 GiB, AC power and 100% battery. After confirming no active containers or load processes, reclaimed six completed test PostgreSQL volumes (422,522,880 allocated bytes), retaining all reports/logs/public transaction evidence, SBF artifacts and unrelated host PostgreSQL. Free disk is 4,706,996,224 bytes. The measured 301.426-second tail at 0.25 offers/s projects approximately 1.043 GB primary DB and 2.347 GB including a 125% replay reserve. This short-run extrapolation is not a measured 24-hour capacity claim; minute disk/memory/DB samples remain authoritative. `capacity.json` records inputs and cleanup paths.
- Both tables remain P12/M5a In progress. Not rerun: unchanged financial/program suites, the P11 matrix, completed outage exercises or broad unit checks; no actual 24-hour soak, hosted P12 CI or P12 PR exists yet. No credential/product blocker. Exact next action: commit this evidence and start `pnpm test:load --soak-seconds 86400 --rates 0.25` on clean source with scoped idle-sleep prevention, then verify the actual full-duration report before publication.

- Actual full-day run started: `source ops/env.sh && pnpm test:load --soak-seconds 86400 --rates 0.25` on clean `8c602c351eb1b179b16fd3e5b88b2c1fc0b7ee81`, environment `.local/load/20261023T004958Z-61926`, supervisor PID 61926, log `.local/p12-soak-8c602c3.log`. All four binaries deploy and actual RPC/WS/PostgreSQL/services/production UI start. First sustained independent snapshot is `2026-10-23T00:52:28.465Z`, source Normal. At second 60.496, database 10,057,407 bytes, free disk 4,638,019,584 bytes and summed owned RSS 5,032,704 KiB (shared pages may be counted more than once), with PostgreSQL's separate 512 MiB VM cap. At 00:53:32 UTC: 17 completed offers, eight finalized and nine unsigned unavailable; one actual durable order fills for 60,030 atoms plus 13 fee atoms. No failure report at that checkpoint. These are partial observations only; neither continuity through 24 hours nor any later outage/final replay is claimed.
- Both tables remain P12/M5a In progress; no P12 PR. Scoped `caffeinate` stays attached to the actual supervisor; no scheduled automation or unrelated test suite was started. Runtime source remains exactly the committed launch revision; this closeout changes documentation only. The earliest full interval ends around 24 October 00:52:28 UTC / 06:22:28 IST, with final reconciliation/replay afterward. Exact next action: inspect the existing run after completion, preserve any failure, and require every A17 gate before exporting full evidence, committing and publishing ready above PR #13 via `gh stack submit --auto --open`. P13 remains Open until that verified predecessor exists; no devnet credential needed yet.

### R016 — 23 October 2026 — P12 — live status and interrupted-soak diagnosis

- User requests current status and an explanation of the 24-hour soak. Read the run artifacts and current Git/PR state; no tests launched. GitHub confirms all nine P03–P11 PRs remain OPEN and ready, with P11 #13 above P10 #12. Local P12 documentation head was `e91a117`; tracked tree was clean.
- The actual full-day run on clean `8c602c3` **exits 1**, recording `Continuity gap, clock jump or system sleep; soak incomplete` at `2026-10-23T03:54:27.848Z` (09:24:27 IST). Narrow host power-log evidence confirms **Clamshell Sleep at 09:06:51 IST**, lasting 1,056 seconds before a 09:24:27 dark wake. Idle-sleep prevention does not guarantee execution through lid closure. The prior expected completion time is invalid. All owned load/Surfpool/caffeinate processes and containers have stopped. No restart performed.
- Retained actual partial evidence: 2,468 completed offer records, **832 finalized routes / 1,635 unsigned unavailable / one unresolved signed transaction**; the unresolved transaction reached confirmed observation but was not independently finalized before interruption and remains unresolved in this report. Thirty-two actual stored orders fill. Maker A's hour-one outage/expiry/recovery passes; the other five scheduled long-run outages are not reached. There are 164 periodic resource/reconciliation samples; the last is at 9,836.570 seconds / 03:36:24 UTC, source Normal, sequence 4,337. Primary DB grows 8,877,759→105,666,239 bytes; available disk falls 4,641,820,672→2,372,218,880 bytes. That filesystem-wide loss is not attributed solely to Rivalt. Final quote audit, withdrawal, read checks and full-history reconstruction are not run. Public interruption evidence (local: `docs/evidence/p12/interrupted-soak/summary.json`) preserves the failure, unresolved identity and narrow sleep log.
- Current free disk is approximately 2.35 GB, below the existing 3 GiB long-run preflight; continuous-host availability also needs resolution. Both status tables remain P12/M5a In progress, with the full-day gate incomplete and no P12 PR. P13–P14 remain Open. No code, financial policy, acceptance duration or system power setting changed; no unrelated tests or CI rerun. Exact next action: establish an uninterrupted host with at least 3 GiB free, then restart only the phase-owned full-day run; retain this interrupted attempt separately. A continuous-run requirement cannot be satisfied by adding short runs.

### R017 — 23 October 2026 — P12 / existing P10 UI — manual access

- User asks about the UI and how to access/test it. Existing browser acceptance shuts its environment down and does not provide a persistent interactive session. Add `pnpm demo:trader` using the existing Surfpool/PostgreSQL/service provisioning and built UI, with visible Chrome and the already-used local Wallet Standard fixture. Fund a real additional 50 test collateral tokens for deposits; existing cash starts at 100 test USD. Keys remain in Node; main-frame/origin/account checks bound the binding. No automated trades, fault injection, broad test suite or 24-hour run starts.
- Launcher defaults to 60 minutes (explicit 1–120 allowed), cleans up on tab/browser close or terminal signal, and writes a public URL/PID/expiry pointer. README/UI instructions/D31 document exact commands, test-wallet behavior, quote expiry, actual-fill empty states and external-wallet limits. This is manual access work in response to the user, not a new delivery phase or an acceptance claim. Both status tables retain P12/M5a In progress with the interrupted soak gate outstanding.
- Focused verification so far: TypeScript, supervisor shell syntax and whitespace checks pass. No financial/program change; unrelated suites and full browser acceptance are not rerun. Exact next action: commit this small launcher, start one fresh manual environment, verify live API/config/UI and funded wallet, inspect its screenshot, then leave the bounded session open for the user.

- Manual launch verified on committed `e069044ed19921b3e08b59a12a0fc8a97cde7fa6`: `source ops/env.sh && pnpm demo:trader`, `.local/demo/20261023T050338Z-18329`, log `.local/trader-demo-launch.log`. Real program deployment/provisioning completes; visible Chrome reaches source Normal with Rivalt Test Wallet connected. Screenshot `manual-ui.png` inspected: 100 test USD cash, 50 test USD wallet tokens, zero position, both makers Online and correctly empty actual-fill chart. No page errors recorded. Public configuration, indexer readiness and proxied latest-trades endpoints each return HTTP 200. No automatic trades were submitted; this is live UI/runtime verification, not a new financial lifecycle test.
- Public session pointer `.local/trader-demo.json` records Node PID 19105, URL `http://127.0.0.1:18084`, ready at 05:06:30 UTC / 10:36:30 IST and automatic expiry 06:06:30 UTC / 11:36:30 IST. User can close the demo tab or terminal to stop earlier; the instrumented wallet is confined to that Chrome context. Both tables retain P12/M5a In progress. No soak or unrelated tests restarted. Exact next action: leave this bounded session for user interaction; before any later soak, confirm it has stopped and resolve the previously recorded continuous-host/disk requirements.

### R018 — 23 October 2026 — P12 — evidence assessment and duration discussion

- User asks whether the recorded ~2h44m can support a shorter MVP gate, what 24 hours adds, and what the run demonstrated. No new runtime, outage test, build or broad regression was started. Read retained attempts/resources/visibility/transactions and the current P12/A17 contract. A targeted post-hoc Python check independently audits **all 833 saved quote inputs** (49 split quotes, zero bounded-optimum regret) and reconciles **all 165 saved chain snapshots** (initial plus 164 minute samples). These checks validate captured inputs only and do not reconstruct the stopped chain's terminal state. Analysis and source hashes (local: `docs/evidence/p12/interrupted-soak/analysis.json`) preserve this distinction.
- Actual normal submitted population is 828: 827 finalized and one unresolved, or 99.879% observed success when the unresolved case stays in the denominator. Five fault-window submissions also finalize. Quote p95 23.896 ms; first observed processing p95 222.463 ms, finalization p95 1,890.991 ms. Maximum 298,596 CU / 884 bytes / 18 accounts leaves 25.351% of the declared 400,000 CU unused. All 832 tracked successful fills reach API and UI, with no censored fills or page errors; normal API/UI p95 693/2,283 ms. These are local-profile measurements, not devnet or throughput claims.
- Principal limitation: only 833/2,468 offers (33.752%) reach submission; 1,635 unsigned unavailable results remain visible, mostly observation/funding timing. Logical PostgreSQL growth is about 35.42 MB/hour over the observed window. The greater filesystem free-space decline is not attributed wholly to Rivalt, and falling/variable RSS cannot prove leak freedom. The run's last signed action remains unresolved. Final large-history replay and terminal exit/reconciliation did not occur, although the separately recorded short final probe passed its own exit/read/replay checks.
- Recommendation presented for product-scope consideration: retain the measured pre-sleep window and all explicit limitations, finish specific missing history/recovery checks without rerunning unrelated suites, and defer full-day endurance to before a funded pilot. There is no identified protocol operation requiring a 24-hour wait; the duration increases repeated-cycle, resource-growth and recovery-history exposure. The full-day and >10,000-history requirements cannot silently be called passed or erased. No acceptance plan, D34 criterion, phase status or dependency has been changed. Both tables remain P12/M5a In progress. Exact next action: resolve the requested acceptance-scope decision, then update the plan/validation/decision records consistently and run only any checks retained by the revised gate; otherwise the existing A17 requirement remains.


### R019 — 23 October 2026 — P12 — approved bounded qualification and targeted fixes

- User explicitly approves the proposed fixes/missing checks and bounded gate. D35 amends plan/validation/component/UI contracts, deferring continuous 24-hour endurance until positive P16 funded-pilot readiness. Both status tables remain P12/M5a In progress; no PR or revised A17 success claimed yet.
- Diagnosed actual Surfpool RPC: finalized account context trails Clock account contents by about 31 slots, while confirmed trails by one. Implement explicitly labeled confirmed quote/client previews with exact confirmed pending-sample event matching. Keep finalized accounting/receipts/fees, the one-second dispatch margin and all on-chain risk/expiry/authority constraints.
- Retained diagnostic PostgreSQL clone contains `load:2466` in the finalized RPC journal despite the executor row remaining unresolved. Verify the original wire's Ed25519 signature, every signed message field, successful metadata and decoded route event; this resolves the outcome from retained evidence, not a new RPC fetch from the stopped chain. Preserve original unresolved reports. The diagnostic container is stopped/deleted; the original volume is unchanged.
- Add 15-second submission-RPC interruption to the actual lost-ack/restart proof; add owned file/WAL/table/index measurements alongside host swap/free disk. Add 1,800-second qualification and a separately counted 10,001-deposit real-history stage followed by >10,000-transaction reconstruction into fresh PostgreSQL. Declare >=50% normal offered availability before measurement, retaining >=99% submitted success, <=200 ms quote p95 and >=20% CU headroom.
- Checks so far: typecheck, 14 focused preview/client/metrics tests and production trader build pass. Program/IDL/stack pins are unchanged; no inherited financial suite or full matrix is rerun. Actual new RPC recovery, availability, bounded qualification and large replay are pending. Existing manual UI remains active until its recorded 06:06:30 UTC expiry; do not interrupt it for test ports.
- Evidence: retained recovery artifacts under `evidence/p12/interrupted-soak/`; new runtime measurements will record their exact clean source. Blockers: none for offline preparation; bounded runtime awaits manual demo expiry and capacity preflight. Exact next action: finish source review/typecheck, commit the coherent change, then run only the 300-second timing qualification before the revised A17 command.

- Implementation checkpoint `bd7c3a3` is committed and clean. The server restart interrupted orchestration, not a test: no new runtime had started. The manual demo expires normally at 06:06:30 UTC; all owned processes/containers and required ports are released. Host free disk fell to 526 MiB during offline work, recovering only to ~729 MiB after demo cleanup. Avoid unrelated host cleanup: archive only the two completed run PostgreSQL volumes losslessly, verifying every archived file hash before removing the uncompressed volumes, and remove the disposable diagnostic clone. Archive manifests and full original data remain local.
- Select the pinned Surfpool flag to disable unused instruction profiling after inspecting the actual CLI help and the old first-sample 1.91 GiB Surfpool RSS. This is a measured resource investigation, not a claim of reduced memory before execution. New metadata/history/CU checks remain mandatory. Both status tables remain P12/M5a In progress; exact next action is the clean 300-second quote/recovery probe, then D35 qualification if its actual targets and disk reserve permit.

- First clean D35 probe `7868736c23b9a6aee79411b0f8e16a28a7fa15aa`, `.local/load/20261023T061003Z-38759`, exits 1 before offering load: `post-fault normal recovery` times out. Diagnostic SQL confirms the original lost-ack deposit finalized once after 15 reconciliation attempts, while the overly broad proxy also blocked an unrelated `funding:6` intent beyond its local blockhash lifetime. That intent is correctly `expired-unexecuted`, its economic effect is not applied, and its 20,000-lamport fee reservation remains held because absence of history does not prove zero network fee. No automatic re-sign or fabricated fee release was introduced. Failure and diagnosis (local: `docs/evidence/p12/preview-probe-1`) are retained; this is not a passing full-provider outage recovery.
- Correct the harness to interrupt only original-signature status/transaction reads and exact-wire rebroadcast, leaving unrelated intents reachable. Persist recovery evidence immediately so a later failure cannot discard a completed proof. The funded worker's existing fail-closed behavior after an unrelated expired intent remains an explicit operational limitation; the bounded proof is scoped, not a claim of recovery from every provider-wide interruption. Typecheck and whitespace pass; unchanged unit assertions were not rerun. Both tables remain In progress. Exact next action: commit the harness correction and rerun the still-unmeasured 300-second quote probe.

- Corrected clean probe `cc43694`, `.local/load/20261023T061551Z-40794`, **passes**: 300.737 actual seconds; 300 offers, 216 submissions/finalized successes, 84 unsigned unavailable; normal offered availability 72%, submitted success 100%. Quote p95 45.955 ms, independent SDK validation p95 41.866 ms, dispatch p95 33 ms; maximum 298,169 CU / 884 bytes / 18 accounts. All 216 independent quote audits pass (22 splits, zero optimum regret). The exact original deposit recovers after the scoped 15-second RPC interruption; fee/cash and changed-byte rejection checks pass.
- Final conservation/fees and fresh projection reconstruction pass: 417 actual fetched transactions, sequence 409, actual vault=allocated=1,400,000,001 atoms, zero outstanding reservations/source errors. This finite sweep does not claim fresh-database >10,000 history, UI/fault qualification or final withdrawal. Probe evidence (local: `docs/evidence/p12/confirmed-preview`) records its scope and identities. A mid-probe sample records Surfpool 191,488 KiB RSS and total owned 2,052,176 KiB, with no browser in this mode; do not treat the comparison to the earlier full UI run as a controlled total-memory benchmark. Free disk is about 4.7 GiB.
- No unrelated suites rerun. Both status tables retain P12/M5a In progress. Exact next action: commit this probe evidence and run `pnpm test:load --qualification-seconds 1800 --rates 1` on clean source, retaining the complete UI/fault/resources, real large history, final withdrawal and fresh-database reconciliation before ready P12 publication.

- D35 qualification is active on clean `c8fd613`, command `pnpm test:load --qualification-seconds 1800 --rates 1`, run `.local/load/20261023T062413Z-43283`, supervisor 43283, log `.local/p12-qualification.log`, active pointer `.local/p12-active-qualification.json`. The initial scoped interruption proof passes. At 683 recorded offers, 468 trades are finalized with no submitted failures; these are partial observations, not A17 acceptance. Funding's 30-second stop recovers at second 342.866; loaded executor/lost-ack/original-signature RPC recovery passes at second 618.639 with exactly one deposited atom and changed-byte rejection. Indexer outage, complete duration, large history and terminal checks remain pending.
- Both status tables remain In progress. Runtime source is unchanged during the active run; this checkpoint updates only the worklog. No duplicate run, broad suite or scheduled automation is started. Exact next action: inspect this existing run through completion and only then export full evidence and submit the ready stacked P12 PR if every revised gate passes.

- Final D35 run **exits zero** on recorded `c8fd6138d915c5b5b774da716e4bdc9748d70f64`, ending 07:10:02 UTC. Trading runs 1,801.940 wall / 1,801.967 monotonic seconds; all 1,249 submitted trades finalize (1,196 normal, 53 fault), with 553 unsigned unavailable retained. Normal offered availability is 71.190%; quote p95 33.658 ms, client validation p95 34.991 ms, dispatch p95 30 ms, maximum immediate route 298,361 CU / 884 bytes / 18 accounts. All 1,249 independent quote audits pass, including 114 splits and zero bounded-optimum regret. Six stored orders fill. Funding/executor/indexer recoveries pass; normal API/UI p95 is 725/2,338 ms, zero normal censorship/page errors; 26 fault-window censored observations remain explicit.
- A recorded operator step gracefully stops the live indexer at 06:58:37–06:58:40 UTC, after the continuous trading/UI phase and after 2,046 history deposits, to avoid repeatedly chasing the dense changing batch. Runtime source is unchanged during execution. The final harness now calls the already-used graceful stop before history generation; this small scheduling correction is typechecked/reviewed, not claimed as a second full unattended run. No authority, balances, history bound or assertions are relaxed. Operator record (local: `docs/evidence/p12/qualification/history-operator-step.json`) preserves provenance.
- All 10,001 distinct actual deposits are fetched/decoded and reconcile 50,015,001 cash/token atoms and 50,005,000 lamports network fees in 707.859 seconds. Complete-cohort one-atom withdrawal passes. Primary backfill, numeric API reads (12,420 events / 1,255 trades / 29 candles), and fresh PostgreSQL reconstruction pass: 12,454 fetched transactions across 13 pages, 65.787 seconds for the fresh rebuild, matching full state. Final vault=allocated=1,450,015,002 atoms, six participants, zero surplus/reservations/source errors. The default 10,000 recovery limit fails without advancing checkpoint or committing rows; post-run read-only SQL from a clone independently compares stored primary/rebuilt state hashes/counts and retained bound failure. Diagnostic container stops/deletes; original volume remains unchanged.
- Resource evidence: 30 trading samples, primary DB 8.97→57.67 MB, owned summed RSS 2,561,728–3,068,320 KiB plus separate 512 MiB PostgreSQL VM cap. After history/replay: primary/rebuild DBs 161.11/151.84 MB, WAL 285.21 MB, other PG allocated files 337.41 MB, archives 24.05 MB, logs 3.38 MB; 4.27 GB remains free. Overlapping database/file measures and host-wide swap/residual disk changes are disclosed; no long-term leak claim. [P12 report and hashes](evidence/P12.md) retain complete populations and limitations. Active pointer is marked passed; no repeat run remains active.
- Both status tables now mark P12/M5a Review, not Closed. Revised A17/local exit evidence is complete subject to integration; 24-hour endurance remains deferred to P16. Fourteen focused unit checks, typecheck, production trader build and shell/whitespace checks pass. No unrelated inherited financial/program suites, full matrix, new high-rate sweep, devnet, external review or funded test was run; earlier exact-scope evidence remains separately identified. P12 hosted CI/publication is not claimed yet. Exact next action: commit the coherent deliverable, submit ready above #13 through gh stack, verify its actual base/head/readiness, then start P13 without a merge wait.

- Publication checkpoint: commit `18b5e383e8dae373dbba6371b5c2d1ba57d9b24b` is published with `gh stack submit --auto --open` as ready [PR #14](https://github.com/arnabnandikgp/rivalt/pull/14), independently verified OPEN, `isDraft:false`, base `phase/p11-matrix`. Both tables retain Review. All 15 final evidence hashes, 10,001 retained deposit records and changed-document local links verify; whitespace passes. The [first scoped hosted run](https://github.com/arnabnandikgp/rivalt/actions/runs/39917222687) is queued; no CI success is claimed. No runtime was restarted and no unrelated tests ran. Exact next action: start stacked P13 above this published deliverable and resolve G11 against actual devnet dependencies/configuration.

### R020 — 23 October 2026 — P13 — devnet preparation and oracle explanation

- User asks for phase objectives and the oracle architecture while authorized implementation continues. Explain that the implemented publisher signs synthetic source updates, clearing independently validates four configured feeds and both makers, and oracle-derived risk/funding/trigger prices are distinct from maker fills. Real primary verification remains P13; an operator-controlled guard does not close G12 independence.
- Create `phase/p13-devnet` using `gh stack add` above actual ready P12 head `e0c18260a09a4cb40432a6bcc3ce6875a949b52a`. P12 hosted CI passes all five scoped jobs; CodeRabbit skips its review due to the 103-file limit. No review approval or integration is inferred. Both overview tables start P13/M5b In progress; P14 remains Open.
- Public read-only Solana devnet probes return genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, core `4.4.0-beta.1`, feature-set ID `3993424257`; no private RPC credential is needed for these probes. Current official Pyth Solana documentation requires an API key for its Hermes update endpoint. Both legacy discovery and the current documented latest-BTC endpoint return HTTP 403 without credentials. User responds that no access is configured. Record access as a concrete prerequisite, not proof of an invalid signature or missing on-chain program.
- Add a read-only preflight with exact devnet genesis, secure RPC/WS configuration, credential-free failures, actual receiver/ProgramData owner/layout/hash/authority inspection and a real WS slot observation. It cannot sign/deploy or report A18 completion. [P13 contract](P13-DEVNET.md) records remaining source, mint, authority, SDK compatibility and real-cluster timing gates. Local financial paths and protocol parameters are unchanged.
- Three targeted preflight trust-boundary tests and typecheck pass; no inherited financial/matrix/load/browser suites are rerun. Actual new inventory/WS evidence is pending a committed run. No P13 PR exists. Exact next action: commit this preparation, run only its read-only preflight, then record the actual result and the blocked signed-update requirement.

- Clean `0a6e2c92cfdfadf8507c70cab4c60bd1f4ef3fa4` read-only preflight exits zero in 1.595 seconds, `.local/devnet/preflight/2026-10-23T07-32-35.596Z/inventory.json`. Actual finalized receiver/ProgramData reads at slot 514171961 and WS notification at slot 514171968 pass; both upstream programs remain upgradeable and their common public upgrade authority and allocated-byte hashes are retained. [Public evidence](evidence/P13-PREFLIGHT.md) explicitly marks `a18Complete:false`, `signedUpdateVerified:false`, `rivaltDeployed:false`. No signer, faucet, deployment or financial instruction was invoked.
- Three targeted trust-boundary tests, typecheck, evidence hashes and whitespace pass. Broader financial/program/load/browser suites and P13 signed-update/deployment checks are not run because they are unchanged or require the missing access. The user reports no Pyth API access; both tables now mark P13/M5b Blocked on B03, with preparation preserved in reviewable local commits and no incomplete P13 PR. P12 stays Review with passing CI; no merge/review completion is claimed. Exact next action: configure accessible authenticated upstream updates securely, then implement and prove the real verification path before completing P13.

### R021 — 23 October 2026 — P13 — sponsored Core path

- User explicitly approves sponsored Pyth Core contract reads for the test-asset MVP and postpones paid Pro. Record D36 and align P13, component and validation contracts. Both status tables return P13/M5b to In progress; B03 is superseded, not an assertion that paid API access was obtained. P14 remains Open.
- Targeted official documentation and upstream source at `145e9b4a88ef0bf2795357fdce8c0c2fe57b77d2` establish original/compatible receiver and push identities, shard-zero seeds and PriceUpdateV2 layout. Actual public devnet RPC finds all four BTC/USDC accounts, full verification and the expected owners. Preliminary reads show some prices minutes old; no availability claim. Exact original-account posted slots locate real successful UpdatePriceFeed/PostUpdate CPI transactions, unlike newer read-only references. Final provenance/availability report remains pending.
- Add a bounded read-only three-minute confirmed/finalized RPC and confirmed account-WS probe with chain Clock, retained raw evidence, strict identity/full-verification decoding and conservative integer -6 normalization. No wallet, funds, deployment or financial path is enabled. Four focused decoder/normalization/freshness tests and `pnpm typecheck` pass. Broad financial/SVM/matrix/load/browser checks are not run because no financial runtime code changed.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.

- Clean `ffc20f3f9c75489b5124e8d011b9bdc81932da1a` completes the actual 180,522-ms observation: 74 RPC batches, four WS subscriptions/seven notifications. Original pair eligibility is 1/37 per commitment; compatible pair 3/37. This is sampled source eligibility, not trading availability or recovery completion. Independent Python raw-message/CPI decoding passes for compatible BTC/USDC and their actual successful VAA verification transaction. [Checkpoint evidence](evidence/P13-SPONSORED.md) retains exact signatures, snapshots and hashes.
- Implement the separate, mutually exclusive devnet profile with private random IDs, pinned compatible primary accounts, full verification, checked conservative exponent conversion, publish anti-regression, shared sampling/resolution bindings and existing G08–G10 action rules. Zero-only route allocation creates no executable synthetic observation; ad hoc price setters remain disabled. Existing SDK ABI matches generated devnet IDLs after explicit address mapping. Default/local identities remain separate.
- Four focused TypeScript tests, three Rust decoder tests (including captured source bytes), typecheck, separate SBF/IDL builds and 41 signed LiteSVM checks (20 setup) pass. The first SVM assertion incorrectly treated a fully authenticated future source identity as a schema failure; correct the harness expectation without changing policy. Independent one-lot price/fee/cash/position/vault checks pass. Actual devnet Rivalt consumption remains unrun. No inherited matrix, broad financial suite, load, browser or endurance tests are repeated.
- Build recovery: IDL generation hits ENOSPC, then detects two incomplete generated dynamic libraries. Remove the failed outputs, 633,047,633 bytes of current-run host-test cache files and only the stopped disposable P12 diagnostic database clone after checking container inventory. Preserve original P12 database/run data, JSON reports and unrelated stopped buildkit. Subsequent SBF/IDL build passes. No deployment follows from a successful build alone.
- Public faucet returns `-32603 Internal error`; follow-up deployer balance is zero. User explicitly authorizes using existing local CLI devnet funds. Verify devnet genesis and wallet balance, transfer exactly 15 test SOL to the isolated deployer, and independently fetch/decode finalized signature `4YV3HSNUyDbUh3gENAA2Dgzax8gkGiBc4fJYQNUUG2Gyo8kXiiG2VMeWxm84reK1r1uu8KPCVvQSqahoBeyMRfZj` at slot 514224240: recipient +15,000,000,000 lamports, fee 5,000. No additional credential/access blocker remains and no real funds are used.
- Both status tables retain P13/M5b In progress; no P13 PR, deployment or A18 completion is claimed. Exact next action: commit/build the exact tested profile, perform selected dependency inventory and deploy the separate artifacts, then execute actual A18 source/accepted/rejected actions.

- Commit `b25a8573ea23991da7c1e327bcb8d4f13a80abc6` builds cleanly; all four ELF hashes exactly match the 41-check SVM report. Actual six-program upstream ProgramData/authority/hash and devnet WS preflight passes on this clean revision at `.local/devnet/preflight/2026-10-23T11-18-48.256Z/inventory.json`. No upstream source code rebuild/security review is implied.
- Deploy clearing, maker A, maker B and the explicitly operator-controlled guard fixture using separate private IDs and resumable upload buffers, with the isolated test payer. Independent finalized RPC reads verify every deployed ELF byte (plus zero padding), expected upgrade authority and actual deployment transaction/slot: clearing 514229096, A 514229704, B 514229788, guard 514229863. Public manifests and transactions (local: `docs/evidence/p13/deployment/deployed.json`) retain hashes and actual rent balances; payer has 5,893,094,800 lamports after deployment. This establishes deployment, not A18 consumption or M5b completion.
- Prepare bounded actual-cluster acceptance with a 10,000,000-lamport test network-fee cap, durable exact signed wires, independent finalized wire/history/event decoding, retained failed logs and no automatic resigning of unknown outcomes. Critical-event decoding accepts an explicit deployment ID while retaining the local default; four scoped event tests and typecheck pass. Reviewer build/local SVM no longer require operator secrets; the RPC harness refuses isolated SVM keys. The new isolated-key SVM run passes the same 41 signed checks on unchanged tested ELF hashes; its distinct report is retained.
- Both status tables remain P13/M5b In progress. P13 PR/publication and full A18 are still pending. No broad matrix, inherited financial suites, browser/load/endurance or external review is rerun. Exact next action: commit the live harness, execute it against these deployed programs and sponsored accounts, then retain verification provenance for the actual consumed messages.

### R022 — 23 October 2026 · P13 public-RPC confirmation recovery

- Live acceptance on clean `75baaa3cf883fe5f698f7810c89f92f18d9ce89d` creates the real six-decimal test mint, market and funded participant accounts. Two attempts stop during setup because the public RPC returns HTTP 429 while confirming original signed transactions. Actual WS success is retained as a hint, never substituted for finalized history. The first pending deposit independently resolves finalized over RPC before resume; its exact signature is reused, with no duplicate deposit. Attempt reports (local: `docs/evidence/p13/acceptance/attempts`) retain the actual failures.
- Add acceptance-only pacing and finite 1/2/4/8/16-second backoff for explicit HTTP 429. Preserve original signed bytes and stop on ambiguous transport failure; no new signature or wider oracle age is introduced. Three targeted fault checks verify exact-byte reuse, no timeout retry and finite rejection budget. The first test run exposed non-mocked promise timers, corrected to a controllable standard timer; all three scoped tests and `pnpm typecheck` now pass.
- P13/M5b remain In progress in both tables; no P13 PR or A18 pass. No program rebuild, unrelated financial suite, broad matrix, browser, load or endurance rerun is warranted by a test-transport change. Exact next action: commit the checked transport fix and resume the persisted journal, then prove real source consumption and retain its exact upstream verification provenance.

R022 source-window follow-up: all 20 signed setup checks and both actual wrong-source-account rejections finalize. Two live windows on clean `1d59824` arrive with maximum source age 11 seconds; sequential harness queries delay their first samples to age 15, and the third sample expires. No priced route is submitted. The unsigned remainder is stopped after both identical outcomes, with every journal entry finalized; this is not a full 600-second observation. The retained window report (local: `docs/evidence/p13/acceptance/attempts/2026-10-23T11-46-window-overhead.json`) records actual samples. Optimize only harness reads: finalized transaction history itself establishes finality, and its decoded oracle event supplies sampled state without redundant account/Clock reads. Guard writes remain a separate transaction because source accounts must be read-only during sampling. No freshness, recovery, account binding or program binary changes. Add bounded read-only exact-consumed-message retrieval and an independent Python event-byte/integer auditor; four adverse provenance tests pass on existing retained RPC data, while actual consumed-message audit remains pending the new run. Scoped typecheck and three transport tests pass. Exact next action: run the optimized committed live harness, then audit the exact messages used in its accepted action.

The resumed live harness also refreshes owner-signed maker epochs through the existing publish/sync path when fewer than 3,000 slots remain, preserving the existing 3,600-slot maximum. Setup delays must not silently turn the next source check into an expired-maker check. Scoped typecheck passes; these actual refresh transactions will be independently recorded in the next run.

R022 bounded observation and renewal correction: clean `f8b412063594a465786168e9ceaaa8fccaeffe6f` runs from 11:57:15.172 to 12:07:22.089 UTC, completes both actually expired maker renewals, encounters zero HTTP 429s and finds no pair meeting its unsigned age allowance during the 600-second source wait. No priced action is signed. Exact Pyth messages from the earlier actual credible observations independently pass push/receiver/VAA decoding (`.local/devnet/observation-proof/provenance/audit.json`); this is source consumption evidence, not the missing trade. A following resume attempts maker-A renewal while its next epoch is still active and finalizes error 6002, with no emitted clearing event. The harness's 3,000-slot early-renewal condition was wrong under G04; replace it with actual expiry checks during the unsigned wait, retaining the failed wire/log and using a new explicit intent only after expiry. No maker lifetime or program change. Scoped typecheck passes. Both tables remain In progress; no A18/PR completion. Exact next action: run the corrected bounded acceptance through a usable source cycle, or retain source availability as an explicit unresolved gate if it cannot complete.

R022 Normal observation / provider configuration: clean `4380cde79305ce8a88555073554b1ddf485e3d2d` renews both makers only after expiry, observes a pair aged five seconds and reaches Normal after samples at 1792757591, 1792757594 and 1792757597. Three public `getTransaction` HTTP 429s add 1/2/4-second backoffs to the last sample's evidence fetch. The one-lot route lands at 1792757607, beyond source deadline 1792757604, and correctly rejects with 6124. Exact upstream/VAA and actual clearing Normal-event bytes pass the independent `--source-only` audit; A18 remains incomplete. A separate finalized fetch confirms affected market/trader/maker cash, positions, fees and vault unchanged. All failed signed wires/logs remain in the retained normal-observation bundle (local: `docs/evidence/p13/acceptance/normal-observation-proof.json`).

- Reuse existing SDK `oracleMode` with Clock in the final quote snapshot before signing; a delayed evidence lookup must not create another avoidably stale signature. A newly observed route receives a distinct explicit journal label after the original failure is conclusively finalized; no ambiguous outcome is replaced. Typecheck passes. Source-only Python auditing passes on the actual Normal observation.
- Request secure RPC configuration only after this concrete provider limit. The user supplies a devnet provider; it is stored only in ignored owner-readable `.env.devnet`. Actual configured HTTP/WS and dependency preflight passes at 12:18:17 UTC (dirty harness source accurately recorded); sanitized inventory (local: `docs/evidence/p13/deployment/configured-provider-inventory.json`) contains no credential. No paid Pyth service or additional funding is requested.
- P13/M5b remain In progress; no successful priced action, completed A18 or P13 PR. No unrelated suites or soak run. Exact next action: execute the committed bounded acceptance with `node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-acceptance.ts`, then audit the exact consumed messages and publish the ready phase only after the remaining gate passes.

R022 confirmed-observation scheduling: the configured-provider run on clean `0c8dd46f3e7649c78f1f7ad97d67a4b358b6b9ac` ends at 12:29:54 UTC without a qualifying recovery window and with zero HTTP 429s. Its one candidate arrives age 11; mandatory sequential finalized-history reads consume the remaining source window. Preserve that failed run, then restrict a provisional confirmed path to guard publication/sample instructions only. All original signatures, exact wires and event payloads must match finalized history before acceptance; financial instructions retain finalized result checks. Three targeted tests verify promotion only after finalized wire retrieval, rejection of changed provisional events (including retry), and exclusion of financial routes from the provisional path; typecheck passes. D36 and P13 contract record this scheduling distinction without changing policy or financial authority.

Disk preparation removes only 3,491 recorded P13 host-cache files (819,526,689 bytes) under `target/debug` created since 10:56 UTC, after compilation completes. The manifest remains `.local/devnet/host-cache-reclaim.json`; deployed SBF/IDLs, original PostgreSQL data and all evidence remain intact. No Rust rebuild/full matrix is relevant to this harness-only change. P13/M5b remain In progress in both tables. Exact next action: run the committed configured-provider acceptance with provisional observations followed by mandatory finalized reconciliation, then complete the exact-message audit and ready PR if it passes.

R022 atomic final sample/trade: clean `5194a62af8a88a6e64d384e6851612d402fe3fc0` reaches Normal through confirmed observations but the final quote Clock check finds the source expired and stops before signing. No RPC rate limit or accounting error is observed. The remaining avoidable gap is between the last sample and trade. Compose the existing instructions atomically, binding the route to the next observation sequence; clearing still decides whether recovery and freshness hold at actual landing. `pnpm typecheck` and `node --import tsx tests/rpc-contract/devnet-svm.ts --atomic-recovery-only` pass: 20 necessary setup transactions plus six focused guard/sample/bundle checks, including five-second rejection with complete state rollback and six-second success. The successful bundle is 1,113 bytes / 755,064 CU under 1,232 bytes / 960,000-CU acceptance ceiling within the 1,200,000-CU instruction limit. Independent trader/maker cash, lots, virtual quote, fee and vault vectors match. Actual local report (local: `docs/evidence/p13/sponsored/atomic-recovery-svm.json`) identifies dirty preparation source and unchanged ELF hashes; it is not devnet proof. No unrelated inherited tests are rerun. P13/M5b stay In progress. Exact next action: execute this committed composition over configured devnet RPC/WS, then independently audit the actual source/financial outcome.

R022 atomic live observations and host-power correction: clean `8e3c6554f2dcad671ceb17d70971ea08e355932c` first runs 12:53:02.524–13:03:09.366 UTC, sees no candidate meeting its unsigned preparation allowance and no HTTP 429. A later run starts at 13:07:04.188 and ends at 13:22:49.536 UTC with no candidate or trade. **Do not attribute that later result to sustained source unavailability:** actual `pmset` logs show Clamshell Sleep from 13:07:50 to 13:22:49 UTC (899 seconds); the process is awake only about 46 seconds. Power evidence (local: `docs/evidence/p13/acceptance/attempts/power-interruption.json`) corrects the initial availability interpretation. The separate read-only snapshot shows compatible BTC age 15 and collateral age 198 seconds, but a snapshot is not continuous availability evidence. The earlier configured-provider window also overlapped host-cache cleanup and is not an isolated latency benchmark.

The optional 30-second devnet question is withdrawn pending an awake atomic run; **no timing change is approved or implemented**. Resume the unchanged 20-second/6-second policy using `caffeinate -i -t 900 node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-acceptance.ts`, with a temporary idle-sleep assertion only; lid-close sleep still requires the host to remain open. The user's configured HTTP/WS access works and all tracked files scan clean of its supplied credential. Both tables remain P13/M5b In progress, P14 Open, no P13 PR or A18 completion. Exact next action: finish the awake atomic run and audit its finalized source/trade/expiry evidence; do not count sleep-interrupted elapsed time or local SVM as a live pass.

### R023 — 23 October 2026 — P13 — actual trade and proportionate devnet closeout

- Existing awake run on clean `8e3c6554f2dcad671ceb17d70971ea08e355932c` finishes at 13:43:53 UTC. The one-lot sample/trade actually finalizes at slot 514265248, signature `5Jn9eXTPYMQX8XyrWVaXcS3uY3jpK66Ujr8Z7Hu9w5hKKw8mxqjhx1bhPY3yYqm7EyoKdV5cFUZhGh4zcuFwQjys`. Source age 18 seconds, qualified recovery seven seconds; existing 20-second policy unchanged. Gross 81,909 atoms, fee 17, cash/positions/virtual quote/vault reconcile. Packet 1,113 bytes / 765,194 CU. Subsequent stale observation and old-route rejection pass. No duplicate trade is submitted; trader/maker retain +1/−1 lots for P14.
- The last live-log assertion fails: the WS subscription receives maker renewals but misses the trade. Preserve the entire original failed report. Its available diagnostics do not establish the gap's cause. A fresh read-only finalized signature subscription at 13:50:27 returns the same successful slot; no signing or resubmission occurs. User explicitly directs proportionate testing given intermittent free devnet oracle updates. D37 records this composed qualification, keeps accounting/authentication/unknown-outcome requirements and carries one focused service/backfill recovery into P14. Do not claim an uninterrupted live listener or a zero-exit original harness.
- The user also explicitly approves 30-second source age on devnet only. Record authorization separately: deployed/tested P13 still uses 20 seconds. P14 may enable the approved setting with explicit boundary/profile evidence; six-second recovery and all other funding/risk checks stay unchanged. No relaxed input is needed to explain the actual successful P13 trade.
- `node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-provenance.ts` retrieves the exact consumed BTC/USDC push/receiver/VAA transactions. Independent `audit_devnet_consumption.py ... --recovered-ws` passes on the public immutable bundle. Four focused audit tests pass, rejecting wrong WS slot, unrelated runtime failure and wrong cash delta. Bundle preserves 62 distinct finalized signed journal entries, including two unexpected failed trials; actual total network fees 500,000 test lamports. [P13 report](evidence/P13.md), bundle (local: `docs/evidence/p13/acceptance/final-bundle.json`), audit (local: `docs/evidence/p13/acceptance/final-audit.json`).
- No program rebuild, another trade, full financial matrix, load, soak, browser or broad regression runs in this closeout; deployed binary and TS runtime are unchanged. Existing phase-specific checks remain attributed to their actual commits. Scoped hosted CI is left for publication and not claimed yet. Both tables now record P13 Review and M5b In progress; P14 remains Open. G11 is satisfied only for the declared engineering profile; independent guard/source, external review and funded readiness remain M6. Exact next action: commit/publish the ready P13 PR above #14 with gh stack, verify actual base/readiness, then begin bounded P14 without waiting for merge.

Publication checkpoint: `b55226a02a13853a70ab7723680cab96929cf00f` is published through `gh stack submit --auto --open` as ready [PR #15](https://github.com/arnabnandikgp/rivalt/pull/15), independently verified OPEN / `isDraft:false`, base `phase/p12-load-soak`. Both tables retain P13 Review / M5b In progress. Forty-four evidence hashes and changed-document links verify; 96 phase files scan with zero configured-credential matches. [Hosted scoped CI](https://github.com/arnabnandikgp/rivalt/actions/runs/39965768807) has passing scope/report/shell, financial correctly skipped, client still running at observation; no overall success or review approval claimed. Browser inventory identifies an existing Phantom extension for later P14 wallet work; no wallet interaction/signature or configuration change has occurred. Exact next action: create the P14 stacked branch and implement explicit devnet program binding for the existing indexer, services and user client.

### R024 — 23 October 2026 — P14 — explicit devnet binding and approved timing preparation

- Create `phase/p14-lifecycle` with gh stack above exact published P13 head `93c1ef4`; no merge wait or P14 PR. Add explicit pinned test-deployment selection across indexer, service snapshots/queue ingress, SDK PDA/instruction building and wallet UI. Default local IDs stay unchanged; explicit devnet requires its genesis and immutable initialization/program binding. Public browser URLs reject query credentials; private RPC configuration remains server-side. No wallet interaction or actual P14 transaction has occurred.
- Implement the approved 30-second age ceiling only in the clearing devnet source-selection path, including rereads for exceptional resolution. Shared default/local validation stays at 20. Version the devnet profile; six-second recovery/hold, funding and confidence/future checks stay unchanged. Current deployed P13 ELF still has 20-second policy. Add a focused compiled-program age-29 trade / exclusive age-30 rollback mode; it has not run yet because the new SBF build is pending.
- Actual checks: `cargo test -p financial-core devnet_profile_tests --locked` passes two targeted boundary/adverse tests (unrelated cases filtered); `pnpm typecheck` passes after correcting test input types; 12 affected deployment/user-client/confirmed-preview tests pass, followed by three rerun deployment tests after the type correction. `pnpm build:trader` passes with its existing large-chunk advisory. No broad financial suite, matrix, load, soak, wallet, PostgreSQL or devnet transaction test is claimed. Exact prior P13 evidence remains immutable.
- Both tables retain P13 Review, set P14 In progress, keep M5b In progress. No new access blocker encountered. Exact next action: commit this coherent implementation checkpoint, build the separate devnet SBF/IDL profile, run only `devnet-svm.ts --source-age-only`, then perform the real read/indexer/service check and recorded test-only upgrade/lifecycle.

R024 build/read/upgrade checkpoint: clean `b3a2fc12c7d1744f647133460a03b6dc3394c592` builds separate SBF/IDLs with exact generated ABI parity. Only clearing ELF changes; A/B/guard hashes are unchanged. `devnet-svm.ts --source-age-only` passes 28 signed checks including 20 setup: age-29 atomic trade 755,126 CU / 1,113 bytes, age-30 exclusive-deadline rejection with rollback and exact accounting. The client independently reads/reconciles actual finalized sequence 43, correctly reporting NoCredibleBounds; an initial stdin import-path error is corrected before any RPC read/signature. No P14 financial action or wallet test is claimed.

- Reclaim only 2,095 completed P14-generated host-cache files newer than the checkpoint (517,297,602 bytes), recording `.local/devnet/p14-host-cache-reclaim.json`. Preserve SBF/IDLs, all source/evidence and original PostgreSQL data. No unrelated user cleanup.
- Upgrade preparation twice rejects locally because the CLI requires at least 10,240 additional bytes rather than the needed 752; both attempt reports remain retained. Apply the actual minimum, then upgrade the tested clearing with the same isolated authority. The already-authorized existing local devnet wallet covers temporary buffer rent of 6,528,678,840 lamports; it returns after deployment, with payer balance decreasing by 14,050,000 lamports in this interval. Extension rent/fee uses the isolated deployer and is separate. No real SOL or new funding request.
- Upgrade `i2oZjJxbrRnvsAT1MUneD5B8nqKFSyEhXY22rDxwazkuUgY27YPoukg6GqGN1hhMDFM5zmwT1M35Eqj7DJ3LU7h` independently fetches successful finalized at slot 514275649. `devnet-deployment-check.ts` verifies all four program/authority/ELF identities; only clearing changed. The 30-second devnet policy is now active for new observations; local/default remain 20 and old cached observations are not retrospectively extended. Public artifacts (local: `docs/evidence/p14/sha256.json`) retain the exact build/test/read/upgrade results. P13 CI passes scope/client/report/shell, financial skipped as scoped; CodeRabbit reports review completed, not an independent security approval.
- Add a read-only actual-RPC/WS → fresh PostgreSQL → HTTP supervisor, with no signer or fabricated projection. It is typechecked and shell/whitespace checked, not yet executed. Both tables remain P14/M5b In progress, P13 Review; no P14 PR/A19 completion. Exact next action: commit the runnable indexer check and execute `bash ops/devnet-indexer.sh`, then implement the bounded lifecycle/recovery and actual wallet check.

R024 actual PostgreSQL checkpoint: `bash ops/devnet-indexer.sh` passes on clean `df77351706b691b346bf9efeb437d866ac5bf2f1`, from 14:29:17.057 to 14:29:50.412 UTC. Actual devnet finalized RPC history reconstructs 52 transactions and 43 critical events into fresh PostgreSQL 18.6, with zero unresolved jobs. Complete account/vault reconciliation matches 1,100,000,000 atoms and the P13 finalized trade/17-atom fee appears through the real HTTP read API; service readiness passes. Source state correctly remains unavailable. One real WS subscription is acknowledged; zero live notifications occur in this read-only interval, so this is not a disconnect/new-event proof. No signer, fabricated projection, new financial transaction, load or source wait is used. Supervisor stops/deletes only its own container and retains its database directory. Exact report (local: `docs/evidence/p14/indexer.json`). Both tables remain P14/M5b In progress and P13 Review. No additional tests are rerun for this evidence-only update. Exact next action: implement/run the bounded service lifecycle and original-signature/provider recovery, then obtain actual external-wallet signing evidence.

### R025 — 23 October 2026 — P14 — resume bounded actual provider recovery

- Resume routine authorized implementation from clean `97e30ab`; the prior status-only stops were not an access or product blocker. Preserve the existing P13 position and all deployed artifacts. Add a bounded actual devnet/PostgreSQL recovery harness: provision 1,000 test collateral atoms, persist one wallet-owned signed deposit through HTTP ingress, close the actual WS before broadcast, discard the real RPC acknowledgement, restart service/indexer instances, and reconcile the original signature and missed event exactly once. No fabricated chain/SQL state. Add an independent offline raw-account integer auditor.
- Give the existing devnet journal helper an optional run-specific path so P14 never rewrites P13's immutable journal. The original default and observation-finality rules remain unchanged. The fault is deliberately injected around the actual provider, not claimed as a spontaneous provider outage.
- `pnpm typecheck`, three targeted devnet-journal tests, shell syntax and whitespace checks pass; actual signed recovery and the independent audit have not run. No Rust rebuild, full matrix, load, soak or unrelated suite is relevant. Both tables remain P14/M5b In progress; no P14 PR/A19 pass.
- Blockers: none encountered. Exact next action: commit the checked harness, run `bash ops/devnet-recovery.sh` once, independently audit the retained raw RPC evidence, then continue the bounded close/settle/withdraw and external-wallet checks.

R025 actual recovery checkpoint: `bash ops/devnet-recovery.sh` and independent `audit_devnet_recovery.py` pass on clean `dcc7f9d5eb6c9750c4200af3a09020c76e672533`. Run `.local/devnet/p14-recovery-20261023T150332Z-83506` uses actual PostgreSQL 18.6 and configured provider RPC/WS. A real 1,000-atom deposit signs once as `kBaU5P88rXFyYURgJW67U9VvrNNJoqzKPKuzjkgUW6CD4dAJPwhKbobc84fncqqisZrp9MsqCHEqzcPTdA8h69q`; the listener is already disconnected, and a locally discarded actual broadcast acknowledgement leaves its SQL intent unresolved. New service/indexer instances recover the same finalized signature/wire and backfill one transaction/event/outbox entry, with zero live notifications for that transaction and zero unresolved jobs. Raw participant/vault/token deltas independently reconcile exactly once. No oracle wait or position change occurs. Actual report (local: `docs/evidence/p14/recovery.json`), independent audit (local: `docs/evidence/p14/recovery-audit.json`). The supervisor stops only its own container and retains its PostgreSQL directory. No full matrix/rebuild/load/soak is relevant. Both tables remain P14/M5b In progress. Exact next action: implement and run the bounded service close/settlement/withdrawal and selected order/funding check, followed by actual external-wallet signing.

R025 lifecycle preparation: implement one bounded actual source/order/cancel/close/settlement/withdrawal harness and an independent raw-account integer auditor. It retains the original P13 +1/−1 position, renews expired makers through their owner-funded service queues, uses the real quote/submit HTTP API and independently fetches every original signed wire. Source preparation has one aggregate 600-second bound; reduce-only actions may use existing Degraded rules rather than forcing Normal. Close against A flattens the complete cohort, allowing existing on-chain source-outage settlement/exit; cross-maker closing remains separately evidenced locally, not claimed here.

Inspection finds the service settlement worker unnecessarily refused all source-outage work even when the complete cohort was flat, despite clearing already permitting this path. Permit that existing mode-2 flat path only; exposed, paused and frozen cohorts remain restricted, with the complete on-chain certificate unchanged. Six targeted service/source tests, typecheck, shell and whitespace checks pass. P13's default TS source-age helper remains 20; P14 explicitly selects 30. No on-chain change/rebuild or unrelated suite is needed. Both tables remain In progress. Exact next action: commit and run `bash ops/devnet-lifecycle.sh`, retain all actual outcomes, audit independently, then prepare the external-wallet smoke.

R025 first lifecycle attempt: clean `e22b366` renews both expired maker epochs through actual owner-funded SQL queues and independently fetches both successful original wires. It stops at unsigned source preparation before any guard/sample/order/close signature; no lifecycle pass. Original report's generic failure omitted the underlying exception, so its cause remains undetermined. A separate actual read succeeds and reports stale BTC/USDC ages 52/233 seconds; that snapshot does not prove the failed call's cause. Preserve attempt (local: `docs/evidence/p14/lifecycle-attempt-1.json`), add sanitized exception/failed-read reporting and at most five transient read-only polling errors within the existing 600-second bound. Do not change financial retry policy or repeat successful maker renewals. Correct the independent auditor's manually derived oracle offset from 105 to 97 before using it. Exact next action: run the corrected committed bounded harness once; no new user intent has been left unresolved.

R025 wallet preparation: add a bounded interactive devnet service/UI supervisor using real PostgreSQL, indexer/API and an executor for already wallet-signed submissions. It loads no private signer and starts no automated financial/source/maker intent. Typecheck and shell syntax pass; the complete launcher has not run. A separately started Vite UI is available on port 18088, and the browser client's actual public-RPC snapshot reads sequence 46 / NoCredibleBounds successfully. Native Brave control twice fails with “Sky Computer Use native pipe startup failed”; no external wallet interaction/signature is claimed. Ask the user to connect their devnet test wallet and supply its public address while continuing the independent lifecycle check. The concrete access limitation is browser control, not a requirement to approve routine implementation. [P14 contract](P14-DEVNET-LIFECYCLE.md) and [evidence index](evidence/P14.md) distinguish pending gates. Both tables stay P14/M5b In progress. Exact next action: finish the bounded lifecycle retry, audit its actual outcome, then run the interactive supervisor and reconcile an actual external-wallet signature.

R025 bounded order/cancel checkpoint: clean `6964704` runs 15:24–15:35 UTC. Both existing maker epochs are reused without new renewals. After 438 unsigned source polls, an actual pair aged 14 seconds supports Degraded reduction authority. The reduce-only order and its cancellation independently finalize through the HTTP/SQL queue (`2SLWNBq8Mo6UukRJ8DJTgEEoPcpqetgrBs4CcD6acz4jr4UR34FvLn1ACVkD9iYGVPRhpmRPqA4ByNoDpycPLDWB`, `2HX7i37CNuUWeScnHWwgSS9CrwLXYQVxkUngLc2HgqxojnRgmZsJnRu5RAVNRWtH86rw97T4SnxsiMJ351ZghTjn`). The aggregate preparation deadline is then exhausted before even polling for the close; no close intent is signed and no unknown action remains. Preserve original failed attempt (local: `docs/evidence/p14/lifecycle-attempt-2.json`).

Resume only this exact finalized post-cancel checkpoint: hash the original failed report, independently refetch both original wires and require unchanged financial account bytes. Skip the completed order/cancel; give the remaining unsigned close preparation one 300-second budget. Allow preparation up to age 20 rather than 15, leaving the actual 30-second on-chain bound and eight-second post-sample scheduling requirement intact. Record current unsigned poll counts/age for diagnostics. This is a continuation of one lifecycle, not a claimed successful original wrapper or a repeated opening/order. Both tables remain In progress. Exact next action: run the committed checkpoint continuation, then audit all recorded actions and continue the pending external-wallet gate.

R025 actual lifecycle checkpoint: the exact post-cancel continuation passes on clean `df67ff1c130e4bc7a255cef1867cb10f070964a8`, run `.local/devnet/p14-lifecycle-20261023T153840Z-92935`. It independently re-fetches both original order/cancel wires and verifies unchanged financial bytes, then renews actually expired makers. A usable close source pair arrives at six seconds of age after 43 unsigned polls. Actual HTTP/SQL close `5xvTXrrCtim1TfCTrdtV2uwstC6p5oeNcavhsYBnpVpN2XCWhbX771DwDCvbyFovWQYBpXdccQkniLmvMmquF9RG` flattens the complete cohort. Expired-source sampling remains restrictive; the corrected worker collects the trader's actual loss, scans all participants, settles the maker's gain and rescans before withdrawal `4eFZdDw5Sez7CDuoii1jPGH1pen1iDEkhoAFHD79y39ZXUf1SnQXbyUHCyrGRdpt1FjYeZfhz2REk1okwZ17puP8`. All original wires independently fetch; SQL has zero unresolved intents/jobs.

Independent `audit_devnet_lifecycle.py` passes on raw account bytes: place/cancel/close/collect/settle/withdraw, exact A marginal/2bps fee, causal funding and skipped expiry, cash/claim/exposure invariants, actual token exit. Final vault 1,000,000,470 atoms, settlement zero, all lots and unpaid claims zero; retained action network fees total 50,000 test lamports, separately from guard/sample fees. Composed actual report (local: `docs/evidence/p14/lifecycle.json`), audit (local: `docs/evidence/p14/lifecycle-audit.json`). Original failed wrappers remain failed and hashed; no claim that the composed actions all ran on one revision. Both tables stay P14/M5b In progress solely pending external-wallet/exit closeout. No on-chain rebuild, matrix, load or soak was run.

The user reports the UI is not loading. Actual host HTTP returns 200 for the page and public configuration, but native browser control still cannot start; the visual symptom is not yet known. Replace the standalone development server with the built UI plus the actual interactive service/indexer supervisor. Correct the devnet index label to sponsored Core/operator guard; `pnpm build:trader` passes with the inherited bundle-size advisory. This build is scoped UI verification, not a wallet pass. Exact next action: verify the complete UI/API launcher and unblock the user's external-wallet registration/signature, then publish the ready stacked P14 PR after remaining A19 evidence.

R025 wallet-provider checkpoint: the complete interactive supervisor starts on port 18088 with actual PostgreSQL/indexer/service readiness at sequence 57. Host HTTP returns 200 for HTML, built JS/CSS, configuration, both readiness endpoints and actual two-trade history. The user confirms the UI loads and Phantom connects. Their supplied test wallet has 28,927,088,080 devnet lamports and no participant; no SOL transfer is needed. The initial wallet check's root-stdin dependency import fails before RPC, then the same read succeeds from the pinned RPC-test package.

Actual Phantom registration returns “Wallet returned a different transaction. Nothing was sent.” The exact-message guard blocks broadcast; no wallet registration/acceptance is claimed. Inspect the installed adapter's modifying-signer path and add public, signature-free message-difference diagnostics (payer/blockhash changes, instruction counts, preserved originals and added program/data) while preserving strict equality. Eight affected SDK tests pass, including an independently signed compute-instruction mutation that is still rejected; typecheck and rebuilt UI pass. The user must retry once to expose the actual difference because native UI control remains unavailable. Do not infer which field Phantom changed from the generic first error.

Strengthen the independent composed-lifecycle audit with the exact failed-predecessor hash/revision and unchanged original action prefix; five targeted actual-evidence/adverse tests pass, including modified signature lineage, wrong withdrawal token balance, missing unpaid claim and duplicate recovery event. No unrelated matrix, load, soak or on-chain rebuild is run. Both tables remain P14/M5b In progress. Exact next action: obtain the actual wallet message diagnostic, implement the smallest verified compatibility correction, then independently fetch the external-wallet landing.

R025 actual wallet diagnostic/correction: the user reports unchanged payer/blockhash and original registration, with Phantom adding limit 200,000 CU and price 375,000 micro-lamports/CU (75,000 priority lamports). Preserve the reported diagnostic (local: `docs/evidence/p14/wallet-diagnostic.json`); nothing was broadcast. Fully specify the existing 400,000-CU limit and zero price before simulation, fee query and immutable preview. Keep exact returned-message equality and cryptographic signature verification. Narrowly extend queue ingress for the explicit zero-price instruction; nonzero/duplicate/late budgets still reject. Add a read-only actual-wallet verifier; it has not run and signs nothing.

Eleven focused SDK/deployment tests pass, including real signed ingress/adverse vectors and the complete two-maker message fitting 1,232 bytes with identical simulation/fee/signing messages; typecheck passes. An earlier verifier typecheck failure omitted required event-authority/program parameters and was corrected before any execution. No on-chain rebuild, financial lifecycle repetition, full matrix, load or soak is relevant. Both tables retain P14/M5b In progress: actual Phantom compatibility remains unverified. Exact next action: commit the coherent correction, rebuild/restart the owned interactive UI and obtain one actual external-wallet registration, then independently reconcile it.

R025 external-wallet acceptance / engineering exit: restart the owned interactive supervisor on clean `e96806314735caaba6632138f69d8c2f8060aa3b`; production UI build passes, actual served asset hash matches disk, public config and service/indexer/history endpoints return HTTP 200. The user reports Phantom registration succeeds without error. `devnet-wallet.ts` signs nothing and independently fetches finalized signature `2iLPo97byRamHdtR7Tq1aQfgvQN8JbsbDXDqza7MYa9CaVJpHpANXoMhDpEi1dsvA1sXh166AaZfA5dtXexrGTnc`, slot 514303068: valid Ed25519 signature, exact canonical previewed message, correct owner/registry/zero-cash participant, same actual PostgreSQL signature at sequence 58. Actual fee is 5,000 test lamports, rent 4,790,440; no added priority fee or collateral-vault change. Wallet evidence (local: `docs/evidence/p14/wallet-registration.json`), raw-account/fee audit (local: `docs/evidence/p14/wallet-audit.json`), UI identity (local: `docs/evidence/p14/wallet-ui-ready.json`). Native UI automation is unavailable; the provider interaction is user-reported, the landing is independently fetched.

The independent offline wallet audit passes; three focused tests also pass, including foreign indexed-signature and unexplained payer-debit rejection. Earlier eleven SDK/ingress tests and typecheck apply to unchanged product code. No repeated lifecycle, financial matrix, Rust build, load, soak or broad regression is needed; hosted scoped CI follows publication and is not claimed yet. The [engineering exit assessment](ENGINEERING-MVP.md) attributes G01–G11 and local/devnet gates to their recorded revisions, preserves the composed-lifecycle limitation and keeps M6 separate. Both tables move P14/M5b to Review, not Closed. Blockers: no engineering acceptance blocker remains; integration/review is pending. Exact next action: commit/publish the ready P14 PR above #15 using gh stack, verify base/readiness and record actual CI status.

R025 publication checkpoint: `f70ac711a747e09c0e7e60c336278c055299c9f2` is published using `gh stack submit --auto --open` as ready [PR #16](https://github.com/arnabnandikgp/rivalt/pull/16). Independent PR inspection confirms OPEN, `isDraft:false`, head `phase/p14-lifecycle`, base `phase/p13-devnet`. Submit initially warns that GitHub stack metadata could not update after successfully creating/pushing the PR; `gh stack link 6 16 --open` then succeeds and adds #16 to the existing remote stack. No existing branch is rebased or merged.

All five actual [hosted scoped CI jobs](https://github.com/arnabnandikgp/rivalt/actions/runs/39986004046) pass on `f70ac71`: scope, client, report, financial and shell. CodeRabbit is pending at the final observation; no independent review approval is claimed. Twenty evidence hashes and new report links verify; 69 phase-changed files have zero configured-credential matches. This final publication/status update changes documentation only; no repeated local regression or financial transaction. Both tables remain P14/M5b Review. The bounded UI remains available through its owned session. Exact next action: address concrete P14 review findings when available and integrate the ready stack; M6 external maker/source/review and funded authorization remain separate.

### R026 — 23 October 2026 — P14 / stack evidence cleanup

- User authorizes removing raw evidence from Git tracking while preserving it in its existing local folders. Exclude 526 raw paths from this phase tree, retain concise reports and original tested tip `5361efb712a04f5661fc947bb22e11e0f5df4c9f`, and include cleaned parent `211f907f90c38d595daf8187e650679c1198e3e8`. No archive, upload, file move or raw-data rewrite. Historical acceptance and phase/milestone statuses are unchanged.
- Normalize raw report links to explicitly local paths. Add the D38 policy and tracked-output/fixture guard. Curated fixtures and deployment-reader changes appear only in the phases that own those readers. Original financial implementation in crates/packages/apps is byte-identical to this phase's tested tip; the only Rust edit in later phases is a test fixture include path.
- Focused cleanup checks: SDK observation tests, independent auditor regression cases, typecheck and one captured-account Rust test; exact outcomes are recorded at the P14 closeout. Full financial matrix, deployed programs, RPC lifecycle, load and soak are not rerun because their behavior is unchanged. No new acceptance or CI pass is implied by the cleanup.
- Blocker: none. Exact next action: verify retained-file hashes and cleaned phase ancestry/diffs, publish through gh stack, then record actual scoped CI status.

R026 verified publication checkpoint: all 12 existing phase branches are updated via `gh stack push`, with remote head identities, ready state and base names independently checked. Original tested commits and cleaned predecessor ancestry remain present; no force rewrite or main-branch change was needed. PR descriptions explain local-only evidence. The [cleanup report](STACK-CLEANUP.md) records actual before/after diffs, curated fixtures and the PR #4 inherited-file removal. All 526 raw files retain their original path and SHA-256; zero remain tracked and all are ignored. No bundles or uploads were created.

Actual affected checks: three SDK observation tests, 19 Python auditor/policy cases from a clean checkout with no raw reports, typecheck, one captured-account Rust test (five unrelated cases filtered), tracked-evidence policy and all-phase source/ancestry comparisons pass. The initial fixture projection omitted trader/maker identities and failed two cases; adding the required fields resolves them without changing original evidence or audit logic. Public tracked data has zero configured-credential matches. Full financial/integrated/load/soak checks and new transactions are not run because behavior is unchanged. Hosted P11–P14 cleanup CI is queued/running at observation, with superseded runs canceled by existing concurrency; no overall pass or external approval claimed. Both status tables retain existing Review/integration status and record the storage cleanup. Exact next action: observe the queued scoped CI and address any concrete cleanup regression, then continue review/integration of the existing stack. M6 remains separate.

R026 CI checkpoint: actual cleanup runs for [P11](https://github.com/arnabnandikgp/rivalt/actions/runs/39992103745), [P12](https://github.com/arnabnandikgp/rivalt/actions/runs/39992147824) and [P13](https://github.com/arnabnandikgp/rivalt/actions/runs/39992142336) complete successfully. P14's replacement run remains queued; earlier overlapping runs are canceled by existing concurrency, not counted as passes. The final closeout commit changes only WORKLOG and the concise cleanup report; no local tests are repeated. Exact next action: observe P14 scoped CI and address any concrete cleanup regression, then resume stack review/integration.

### R027 — 23 October 2026 — whole-stack review and merge eligibility

- Scope: user requests checking all unresolved reviews and merging only if clear. Inspect all 12 open PRs that are ready for review (#4, #5, #7–#16), inline review threads, submitted review states, current source and GitHub check/merge metadata at P14 head `e36272cb10926700541cdfa779a836dc3964a529`.
- Actual checks: GitHub connector `list_pull_request_review_threads` and `list_pull_request_reviews` for each PR; `gh pr list --state open --limit 100 --json number,headRefOid,baseRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup`; read-only source inspection and `git status`. All 12 are mechanically mergeable, with no formal changes-requested review, but **15 inline threads remain unresolved across 8 PRs**. A successful bot status does not resolve its findings.
- Thread inventory: [#4](https://github.com/arnabnandikgp/rivalt/pull/4) 2 (maker-config ownership, slot commitment); [#5](https://github.com/arnabnandikgp/rivalt/pull/5) 1 (negative-test isolation); [#8](https://github.com/arnabnandikgp/rivalt/pull/8) 3 (terminal-intent retry, setup counter, Markdown pipe); [#9](https://github.com/arnabnandikgp/rivalt/pull/9) 3 (funding retry, live-listener detection, API-port preflight); [#10](https://github.com/arnabnandikgp/rivalt/pull/10) 1 (stale status heading); [#11](https://github.com/arnabnandikgp/rivalt/pull/11) 3 (frozen insurance funding, recovery-check loop, stale heading); [#12](https://github.com/arnabnandikgp/rivalt/pull/12) 1 (API mismatch disables RPC exits); [#16](https://github.com/arnabnandikgp/rivalt/pull/16) 1 (stale A19 evidence status). #7/#13/#14/#15 have no unresolved inline threads.
- Current-code confirmation: maker initialization still derives its config only from unchecked capital; `process_fund_insurance` still permits mode 3 through `active`; indexed-deployment mismatch still throws into `setRpcError`. These three findings require remediation, not administrative resolution. Remaining comments are recorded for individual triage; this run does not claim all findings reproduced or fixed.
- Hosted status: P11–P14 scoped check rollups contain successful current runs, with superseded cancellations and P13's intentionally skipped financial job retained. Earlier PRs expose CodeRabbit status only. No active failure is reported; no missing test suite is inferred to have run.
- Outcome: no PR merged, no thread resolved or dismissed, no source behavior changed. Both status tables retain Review and record the merge hold. Raw evidence remains local and untouched. No local tests, RPC transactions, integration matrix, load or soak run: this is a review-metadata/source audit with a documentation-only closeout. No specification/decision change is needed.
- Blocker: unresolved review findings. Exact next action: remediate PR #4's maker-config ownership finding with a focused regression, then address the remaining stack threads and recheck eligibility before `gh stack merge`. This audit is committed locally on P14; no remote branch update is needed for the conditional merge check.

### R028 — 23 October 2026 — stack review remediation

- Scope: user authorizes addressing the reviews and merging the whole stack. Add `fix/stack-review` above P14 using gh stack; retain all phase commits and local evidence. Implement D39 maker ownership, durable bounded retries and recovery-check cap, UI/API error separation, precise rejection checks, port preflight and stale-document corrections.
- Triage correction: the insurance-funding finding is not a live exploit. Freeze already sets `paused=true`, `active()` rejects funding, and custody controls cannot unpause mode 3. Add an actual signed regression proving rejection and unchanged ledger/token balances instead of changing clearing economics. The previous read-only sweep did not inspect that complete path.
- Initial affected checks: 10 service unit cases pass; three actual socket cases pass; typecheck passes after fixing test-only missing event accounts and readonly tuple types. Signed LiteSVM settlement/maker/route harness passes 49 P06 plus 159 setup scenarios; one resolution page-size case passes 102 P09 plus 45 setup scenarios, including paused insurance rejection. These initial runs use the dirty implementation tree, retained locally under `.local/review-remediation/`; they are not relabeled clean acceptance. Both maker SBF builds pass; generated IDL/SDK parity and real service/browser regressions are in progress.
- Do not rerun the full financial matrix, load, history replay or soak: the changes require targeted program, durable service and UI checks. Hosted broader regression remains CI-owned. Existing devnet deployment is unchanged; no new devnet acceptance is claimed by these edits. Both status tables remain Review pending verified remediation/integration.
- Blockers: focused runtime checks and review resolution still due. Exact next action: commit the coherent remediation, run the new Surfpool/PostgreSQL retry checks and affected browser/program gates, publish the ready remediation PR, resolve the addressed findings with evidence, then merge the full stack with gh stack.

R028 targeted verification checkpoint: ready [PR #17](https://github.com/arnabnandikgp/rivalt/pull/17) is stacked above P14. Clean `e2920342468fe96e6110c7cb99f0cc31be031848` passes the 208-scenario signed maker/route/settlement harness and 147-scenario resolution/setup harness. Actual Surfpool/RPC/WS plus PostgreSQL 18.6 prove both funding-failure retry and unbroadcast maker expiry recovery across Runtime restarts; original wires/unknown fee reservations are preserved, and one new publication advances the maker epoch once. The affected browser run passes all 16 checks, including an actual withdrawal despite wrong indexed deployment, API-stopped direct exits and fresh PostgreSQL replay. It records 25 signatures: 24 finalized and one deliberately expired/unresolved quote, zero signed rejection retries, one unsigned withdrawal preview rejection and two transient indexing-cycle failures followed by exact recovery. No page/source errors. Independent Python integer reconciliation verifies 1,101,077,504 cash + 0 settlement + 10,007 insurance + 2,496 fees = 1,101,090,007 actual vault atoms, zero net lots and zero aggregate claims.

Local raw results stay under `.local/review-remediation/`; all 526 earlier evidence files retain their original hashes and paths. Both local and devnet-profile maker builds pass, generated SDK parity is unchanged, 12 distinct affected unit/ABI cases and three real socket tests pass, and typecheck/trader build pass. [Hosted CI 40003276524](https://github.com/arnabnandikgp/rivalt/actions/runs/40003276524) succeeds on `e292034`: scope/client/report/shell pass, financial job is correctly skipped. The standalone maker RPC expiry/upgrade suite, full financial/integrated matrix, load/history/soak and devnet deployment are not rerun; unchanged behavior and targeted coverage do not justify them. The optional handler-renaming nitpick is deferred because existing module-qualified dispatch is unambiguous; the toolchain note and reopened TP/SL assertion are addressed.

All 15 original inline findings are resolved with evidence (14 fixes and the already-protected frozen-insurance path). A new P14 review then adds six items: clarify the P14 CI run link and three phrases, independently re-fetch the Phantom signature, and align the read-only devnet harness with the existing allowed unallocated surplus. The latter now rejects deficits and reports allocated/surplus atoms separately; it changes no financial rule. The fixture, evidence Markdown and current PR description already agree on `RamHdtR7`; an actual RPC re-fetch is recorded separately. Both status tables remain Review until merge. Exact next action: verify the small read-only devnet checker change, resolve the six new findings, then perform the authorized atomic stack merge.

R028 final review/integration checkpoint — 24 October 2026 IST (23 October UTC): the six follow-up items are resolved. The unchanged canonical Phantom signature is independently re-fetched at finalized slot 514303068 with a 5,000-lamport fee. Clean `3b1c0be` passes `bash ops/devnet-indexer.sh`: actual devnet HTTP/WS backfill into fresh PostgreSQL, 69 transactions / 58 events, zero unresolved jobs, HTTP views ready, 1,000,000,470 actual/allocated vault atoms and zero surplus. This run signs/sends nothing and explicitly has `a19Complete:false`; it is a focused read-only regression, not a new lifecycle acceptance. Raw report: `.local/devnet/p14-indexer-20261023T183601Z-49680/indexer-report.json`.

The final fresh review sweep finds zero unresolved threads across #4/#5/#7–#17. GitHub confirms all 13 ready PRs merged by `gh stack merge 6 --yes --merge` into `main` at `2bc298e3a0d084340fe037c11a182fc4238361a2`; no open PRs remain. Final [CI run 40004608246](https://github.com/arnabnandikgp/rivalt/actions/runs/40004608246) succeeds on exact remediation head `3b1c0be`, whose complete tree matches the merge. The local main branch fast-forwards without rewriting history. Crossing the old main tree temporarily reapplies removal of 48 formerly tracked raw paths; they are restored from original blobs only after matching the saved SHA-256, and all 526 original files are verified intact at their original paths.

Both status tables close the integrated local phases P03–P12/M2–M5a using their recorded phase/cross-phase acceptance plus affected D39 regressions. P13/P14/M5b retain Review pending the narrowly scoped live maker update; their previous on-chain acceptance is not relabeled as a deployment of these new binaries. No merge blocker remains. Exact next action: apply and verify the reviewed A/B maker initialization hardening on test-only devnet. This post-merge closeout changes documentation only; no local suites are repeated. M6 remains separate.


### R029 — 24 October 2026 — P01–P14 maintenance — readable program structure

- Starting baseline: clean `366b09d` on `main`; `gh stack init refactor/program-readability --base main` created the maintenance branch. User explicitly requests a ready PR and merge after the cleanup. No unrelated tracked work was present.
- Delivered so far: clearing `instructions/` contexts/handlers and `state/` account layouts, root constants/errors/events, separate oracle impact and resolution ledger/test modules, descriptive local/closure bindings, readable account constraints and a source map. Maker context names/constraint formatting are clarified. Program IDs, seeds, account/argument/event layouts, error codes, arithmetic and financial authority are unchanged.
- Preliminary checks: host clearing tests (six) and CPI compilation pass; all three freshly built IDLs preserve the original wire ABI. Clearing's pre-existing top-level IDL profile-description drift is refreshed from the actual source; no generated SDK code changes. A local token audit matches all 155 clearing functions after the explicit identifier/module/format normalization, including moving the probe handler. These are development checks, not yet clean-commit acceptance.
- Environment: disk initially had about 428 MiB free. Removed only reproducible `target/debug` build artifacts after saving program/IDL identities; no run evidence, deployment keys or retained local data was removed. Tool versions and dependencies are unchanged.
- Evidence: ignored `.local/program-readability/` contains baseline identities, development logs and the function audit. Initial refactor compile failures exposed required Anchor `ctx` and generated CPI exports plus a shadowed group name; corrected before the passing checks.
- Validation remaining: clean committed pinned SBF builds (default/local/devnet), affected ABI/generated-client and signed compiled-program regression checks, scoped hosted CI, PR and merge verification. No additional test count or runtime outcome is claimed yet.
- Not run: service/PostgreSQL/browser E2E, load/history/endurance, live devnet upgrade or lifecycle; those paths are unchanged by this source refactor. P13/P14/M5b remain Review for the separately recorded deployment follow-up.
- Blockers: none. Exact next action: commit the coherent refactor, build and verify its affected program/ABI surfaces, publish a ready PR through `gh stack submit --auto --open`, then merge after required checks and review findings are addressed.

- Clean acceptance revision: `a9d9f26c8f862258378bd7a85195b5bbd47ba3d1`; all five signed-runtime reports record that exact revision and `sourceDirty: false`. Pinned `anchor build --no-idl --tools-version v1.52 --arch v0 -- -- --locked` builds clearing default/local and both local makers. `cargo build-sbf --tools-version v1.52 --arch v0 -- --locked --features devnet-test-profile` builds all three into isolated `.local/program-readability/devnet/`; all stack-frame guards pass. Devnet artifacts are not deployed and existing `.local/devnet/deploy` is unchanged.
- ABI/client checks: fresh Anchor IDLs for all three local/devnet programs preserve the original wire contract (devnet compared after the declared program-address mapping). `pnpm generate:check`, `pnpm typecheck` and `pnpm exec vitest run tests/rpc-contract/*abi.test.ts` pass: 15 tests in eight files, including isolated legacy Anchor conformance. The only tracked SDK change is clearing's one-line IDL description; generated implementation code is unchanged. `cargo test -p clearing --locked --offline --lib` passes six host checks; `cargo check -p clearing --locked --offline --features cpi` passes. Rustfmt and whitespace checks pass. The two host Anchor `target_os=solana` macro warnings are retained; no new program warning is suppressed.
- Actual signed LiteSVM checks: settlement 49 + 159 setup = 208; oracle/funding 258 + 33 = 291; orders 203 + 45 = 248; resolution with page size 4 / cohort 64: 309 + 45 = 354; compiled devnet source-age boundary: eight + 20 = 28. These are scenario executions including overlapping setup, not unique financial vectors or RPC/devnet landings. Existing independent assertions and CU/message limits pass. Maximum observed CU/bytes by runner: settlement 298,479/972; oracle 666,799/796; orders 589,478/824; resolution 666,744/980; devnet bundled sample/trade 758,510/1,113.
- Reproduction/evidence: the existing `tests/rpc-contract/{settlement,oracle,order,resolution,devnet}-svm.ts` runners were copied under `.local/program-readability/runners/` with only relative import and binary/report destinations adapted, preserving prior raw reports and live deployment artifacts. Invocations use `node --import tsx`, resolution arguments `4 64`, devnet `--source-age-only`; `runners.json` records both hashes. `validation.json` records current program hashes, IDL parity, source identity and exact populations; all raw files remain ignored. Wrapper-only attempts (zsh loop-variable PATH collision; relocated Node dependency lookup) failed before acceptance and were corrected; their logs are retained. No financial assertion failed in the final signed runs.
- Scope/status: P01–P12 remain Closed; P13/P14/M5b remain Review for current deployed/source parity; P15/P16 remain Open. No unchanged financial-core reference suite, service/PG/browser integration, load/history/soak or live devnet deployment was rerun. Hosted CI and merge are still pending and are not claimed. Exact next action: submit the ready maintenance PR, inspect its checks/reviews, and merge the verified change as authorized.

- Publication/integration: `gh stack submit --auto --open` published ready [PR #18](https://github.com/arnabnandikgp/rivalt/pull/18), base `main`, exact head `5d5b38ca26b649a671a9a7c5b04b439ef4569213`. [Hosted CI run 40120031701](https://github.com/arnabnandikgp/rivalt/actions/runs/40120031701) passed scope/client; unrelated report/financial/shell jobs were intentionally skipped. The final premerge sweep found zero posted inline findings/reviews; CodeRabbit was still pending, so no completed external review or approval is claimed.
- Authorized merge: `gh stack merge --yes --merge` could not locate a remote stack for this single-PR submission; `gh pr merge 18 --merge --match-head-commit 5d5b38ca26b649a671a9a7c5b04b439ef4569213` completed through normal repository rules, without bypass. GitHub independently reports MERGED at 2026-10-24 18:19:53 UTC, commit `4d4a9087ff1e0088c5e6944dd80213982d20c215`. Local `main` is fast-forwarded and its full tree matches the PR head. All 526 retained raw evidence files still match their original hashes/paths.
- Final scope/next action: this requested readability task is integrated. P13/P14/M5b still await the existing test-only devnet hardening rollout and recorded artifact/source mapping; P15/P16 remain Open. Exact next engineering action is the recorded A/B deployment/approval/owner-binding check, not another inherited matrix or soak. This closeout changes documentation only after the verified merge.


### R030 — 25 October 2026 — P13/P14 — reviewed maker devnet rollout

- User authorizes the narrow test-only deployment/verification and integrated closeout. Start `fix/devnet-maker-closeout` above clean `main` (`7def8a7`) with gh stack; preserve all original captures and the existing clearing deployment.
- Actual read-only configured RPC/WS preflight passes: devnet genesis, all four upgrade authorities match the pinned deployer; its balance is 5,736,538,080 lamports. Both makers still have their original code. No faucet, transferred funds or source-freshness wait is needed.
- Add an explicit bounded rollout manifest and commands for exact reviewed A/B artifact verification, resumable CLI uploads, original-wire signed ownership/approval checks and account reconciliation. Target source is clean tested `a9d9f26`; existing clearing remains `b3a2fc1` and guard retains its original identity. No financial or program source changes.
- Preparation verification: `pnpm typecheck` and `git diff --check` pass. Actual upgrade, signed ownership tests and post-upgrade PostgreSQL reconciliation are pending; no new deployment/acceptance or closure claimed. Unrelated financial matrix, browser, load/history and soak checks are not rerun.
- Both status tables retain P13/P14/M5b Review until this focused follow-up passes and is integrated. Blockers: none. Exact next action: execute the committed maker upgrade command against configured devnet, then the journaled ownership/approval checks and scoped PostgreSQL reconciliation.

R030 upgrade checkpoint: clean `df336c0` runs `node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-maker-upgrade.ts` successfully. Maker A finalizes at slot 514709495 and maker B at 514709597; finalized RPC reads verify exact reviewed ELF bytes plus zero allocation padding, unchanged deployer authority and unchanged clearing/guard hashes. The original baseline and structured upload results remain local under `.local/devnet/maker-rollout-r030/`. Deployer balance changes from 5,736,538,080 to 5,630,599,680 lamports, including program extension rent and upload fees. No faucet or transfer is needed. Add an independent raw-byte account auditor and optional exact-event/indexed-hash checks to the existing PostgreSQL acceptance command; scoped typecheck passes. Both phases remain Review: joint hash approval, signed ownership checks and PostgreSQL reconciliation are still pending. Exact next action: run the committed journaled closeout, then independently audit its accounts and reconcile the new events through PostgreSQL/HTTP.

R030 fixture correction: clean `b95b970` finalizes all 12 signed checks (six intended rejections), including actual joint approvals of both new ProgramData hashes. Fresh PostgreSQL/HTTP reconciliation passes at `.local/devnet/p14-indexer-20261024T191359Z-54579/indexer-report.json`. The independent raw-byte auditor then rejects the fresh test configs' domain: the harness used `devnetContext`'s current profile-derived hash, while this existing market retains its original stored domain. These configs have zero-capital test participants and were never registered for quoting; existing maker registrations, capital, consumption and vault bytes reconcile. Preserve the failed fixture/audit and original transactions; do not count them as valid full initialization acceptance. Fix the harness to read the stored market domain and assert it explicitly. Support a separate fresh ownership-only run that retains completed approvals instead of repeating uploads/approvals. Scoped typecheck passes. Exact next action: capture a fresh read-only baseline, execute only the corrected ownership cases, audit their continuation from the first run, then reconcile the new participant over PostgreSQL.

R030 corrected acceptance: clean `a1c793c` captures a new baseline without sending an upgrade (`commands: []`), then finalizes eight ownership-only transactions, including four exact intended rejections. Both legitimate configs bind the actual stored market domain. The independent Python audit verifies the unchanged original approval/accounting scope, byte-identical continuation into the corrected baseline, valid new configs, six actual participants and the unchanged 1,000,000,470-atom vault/allocation. Five deliberately changed cash/domain/owner/hash/vault captures all reject. Fresh actual RPC/WS → PostgreSQL 18.6 → HTTP passes at `.local/devnet/p14-indexer-20261024T191720Z-55579/indexer-report.json`: 75 fetched/retained transactions, 62 events, zero unresolved jobs, both original rejected upgrade transactions retained without events, and approved hashes/new participant matched. The idle WS subscribes successfully with zero notifications; this is finalized backfill, not new fault injection. Add final-state checks on resumed ownership runs and per-check source attribution. No financial/program source or economic rules change. Exact next action: verify that read-only resume, publish the concise evidence/ready closeout PR, then merge after scoped checks and close both status tables.

R030 final local checkpoint: clean `8a4ba7b` resumes the corrected ownership command with zero new steps/signatures. It rechecks live configs/domains and complete maker-registration state, with the eight original signed checks explicitly attributed to `a1c793c`. Its independent composed audit passes again (`.local/devnet/maker-ownership-r030/audit-resume.json`); all new raw report/journal/checkpoint identities are retained in the local `sha256.json`. Scoped typecheck, whitespace, evidence-storage policy and changed-file configured-credential scan pass. Original acceptance/PG evidence is unchanged; no extra financial/browser/load suite is run. Both tables remain Review pending ready PR publication and merge. Exact next action: submit the ready closeout with gh stack, inspect scoped CI/reviews and merge the verified change.

R030 integrated closeout: ready [PR #19](https://github.com/arnabnandikgp/rivalt/pull/19) targets `main` at exact head `633892c285dd2040eb706f6d3191e2a1a2b3fa96`. [Scoped CI run 40125003627](https://github.com/arnabnandikgp/rivalt/actions/runs/40125003627) passes: scope/client/report succeeded, financial/shell intentionally skipped. The pre-merge sweep has zero review threads/submitted reviews and no failing checks; CodeRabbit remains pending, with no independent approval claimed. `gh stack submit --auto --open` created the ready PR; `gh stack merge` reports missing singleton-stack remote metadata, so the authorized merge uses `gh pr merge --merge --match-head-commit` against that exact head. GitHub records merge `67059fc99ca3b48cff4d89e9f97aa9c1c51538eb` at 2026-10-24 19:24:25 UTC. Local main fast-forwards and its tree exactly matches the verified head. Both phase/milestone tables now close P13/P14/M5b; original A18/A19/source/wallet evidence remains attributed, with R030 covering the actual later maker change. This post-merge status-only change runs whitespace checks and repeats no unchanged tests. Blockers: none for the engineering MVP. Exact next action: hand off the integrated M5b baseline; P15/P16 external/funded gates remain Open.


### R031 — 25 October 2026 — P15A/P16A scope split and maker kit

- User explicitly authorizes standalone P15A maker integration/economics tooling and P16A availability/endurance/operations work, while keeping P15B/P16B external gates Open. New PRs must be stacked, ready and remain open; earlier merge authorization is superseded for this stack.
- Inspect clean `main` at `f37f409`, current source/tooling and phase contracts. Create `phase/p15a-maker-kit` above main with gh stack. Update delivery dependencies, acceptance IDs, G12 ownership, both status tables and D41 without relabeling original P12 or P13/P14 evidence.
- P15A implementation/qualification and P16A diagnosis/full-day evidence are pending. No claim of independent maker activity, review, observed hedges or funded readiness. No tests run for this scope-only amendment; executable verification follows the actual implementation.
- Blockers: none encountered. Exact next action: package the actual reference maker/SDK/operator configuration and implement independently checked economics reporting plus fresh-environment qualification.

R031 scope correction before implementation: the user says the new full-day requirement was accidental and directs keeping it deferred until much later. Record D42 and align current P16A scope/acceptance and both status tables with targeted bounded engineering checks. No 24-hour test was launched, no elapsed duration is claimed and no substitute long soak is imposed. P15A stays In progress, P16A/P15B/P16B Open; new PRs remain stacked/open. The scope-only amendment passes `git diff --check`; no tests are relevant to documentation alone. Exact next action remains the P15A operator kit/economics implementation and fresh-environment qualification.

R031 implementation preparation: add the owner/config-bound reference bot, SDK deposit/publication examples, repeatable-read finalized economics capture, offline report CLI and ordinary-lifecycle integer accounting. Add 10 hand-derived economics/adverse cases and nine configuration/permission checks; `pnpm typecheck` and both focused Vitest files pass (19 tests). An initial overloaded PostgreSQL client-type error was corrected before those checks. `pnpm maker:build` builds the four required local SBF artifacts successfully with pinned tools/frozen dependencies and no stack-frame diagnostic. Shell syntax and whitespace pass. The operator guide states shared-database/authority/exit limitations and labels all internal makers, synthetic sources and hedge assumptions. No program/IDL or financial rules change. Both tables retain P15A In progress and M6 In progress; A20A real-runtime/fresh-environment qualification is pending. No inherited financial matrix, browser, load/history or soak suite rerun, and no CI/PR result claimed. Exact next action: run the committed scoped maker qualification from a fresh operator checkout, preserving any failures and reconciling actual signatures/fees through PostgreSQL.

R031 fresh-environment finding: clean `ea396d2` runs from `.local/operator-p15a-ea396d2` with a fresh workspace install and regenerated public local keys; only pinned tool binaries and the four freshly built ELF artifacts are reused explicitly. Offline package installation lacks one locked tarball, so the frozen online install completes (239 packages); no versions change. First qualification `.local/operator-p15a-ea396d2/.local/maker-qualification/20261024T194917Z-66176` stops before lifecycle execution because the shared toolchain recorder unnecessarily requires the isolated legacy Anchor conformance installation. Preserve that failure. Add an explicit runtime-only recording mode that still traverses the modern dependency graph and forbids legacy Anchor, while truthfully marking isolated conformance not checked; default full recording is unchanged. Move this preflight ahead of deployment and ensure startup-hook failures stop owned resources. Scoped typecheck/dependency traversal/shell syntax/whitespace pass. P15A/M6 stay In progress. Exact next action: rerun the scoped workflow on the corrected committed source, without installing or running unrelated legacy conformance tests.

R031 qualification correction: clean `2caab12` completes real deployment, both new owner-bound bot publications and SDK deposit in fresh run `20261024T195046Z-67119`, then fails before signing the opening trade. The harness incorrectly passed internal BigInt quote data directly into the SDK HTTP-contract validator, which correctly requires decimal strings. Preserve the unsigned failures and successful setup transaction; this is not a financial execution failure or an A20A pass. Use the actual quote HTTP endpoint and retain its refusal codes. Also compare each finalized fetched transaction byte-for-byte with the originally journaled wire. Exact next action: rerun only the corrected maker workflow on its committed revision; risk/source/fee rules stay unchanged.

R031 A20A acceptance: clean `09afdfc7c13f15ed1d4d1dad4e35fbad205f1707` passes `pnpm maker:qualify` from the fresh operator checkout, run `20261024T195355Z-68540`, exit 0. The 127.876-second workflow proves both bot renewals, seven finalized SDK actions including two split routes and two actual one-atom owner exits, nonzero causal funding, whole-atom funded settlement and residual unpaid fractions. The interval has 21 critical events (sequence 21→42) and 27 finalized transactions, none failed. Both actual maker SOL deltas equal reported fees (20,000/15,000 lamports), with no reserved fees left. Capture/recompute CLIs agree; independent Python identities and five adverse mutations per maker pass. A separate read-only PG checkpoint records seven actual WS notifications and 29 finalized-RPC observations; final projection/RPC reconciliation passes. All 89 unsigned admission refusals remain classified and are not a load metric. [P15A evidence](evidence/P15A.md) retains exact source/artifact/report identities and both earlier failed attempts. Both tables move P15A to Review and retain M6 In progress; external gates stay Open and 24-hour endurance Deferred. No unrelated suites were rerun. Exact next action: publish the cohesive ready PR with gh stack, keep it open, and start P16A above its exact verified commits.

R031 publication: `gh stack submit --auto --open` creates ready [PR #20](https://github.com/arnabnandikgp/rivalt/pull/20), base main, head `01ab6db`. Keep it open under the latest user instruction. P15A remains Review and M6 In progress; hosted results are not yet claimed. Exact next action: add P16A as a gh stack child of this verified branch, explain the preserved P12 availability population and verify only the affected reporting/operational checks.

### R032 — 25 October 2026 — P16A availability and bounded operational readiness

- Start a gh stack child above verified P15A `4c09c00` / ready open PR #20. Reconstruct all 1,802 original P12 attempts: outside-fault 1,196/1,680 signed/finalized, 484 unsigned refusals (380 due, 82 risk-restricted, 11 preview-behind, seven pending-proof, four expiry); fault 53/122 signed/finalized and 69 refusals. No original signed trade failed or remains unknown. Preserve the original records and label missing deeper cause information.
- Correct eligible-versus-submitted metric semantics, add exact numerator/denominator reporting and public confirmed-preview refusal diagnostics, preserving guard predicates/order. Add an explicitly bounded source/acknowledgement/executor/indexer recovery and direct-exit harness plus operational/technical-limit documentation.
- `pnpm typecheck` and eight focused metrics/availability/dispatch tests pass. The first test invocation also discovered five inherited tests inside the ignored fresh operator checkout (13 executions, only eight distinct scoped cases); add explicit Vitest exclusions for `.local`/`.tools` and verify the eight intended cases alone. No unrelated financial/browser/load/history/soak suite is run.
- Both tables retain P15A Review/M6 In progress, advance P16A to In progress and leave external gates Open. Raw reconstruction is `.local/p16a-p12-availability.json`; source attempt SHA-256 is recorded in the operations guide. Actual bounded RPC/WS/PG acceptance is pending. Exact next action: commit this focused change, run `pnpm test:readiness` on that exact revision and retain actual outcomes/limits before publishing its ready stacked PR.

R032 A21A acceptance: clean `17e88fc87cebf9d338f8b2959034b0d83d129549` passes `pnpm test:readiness`, exit 0, at `.local/readiness/20261024T200640Z-73449/` in 128.814 workflow seconds. Actual source NoCredibleBounds/refusal and unchanged recovery pass. Lost acknowledgement, executor SIGKILL and 15-second original-signature RPC interruption reconcile exactly one one-atom deposit/5,000-lamport fee; conflicting bytes/reserved identities reject. An actual killed indexer remains offline through direct complete-cohort withdrawal, then the original projection fetches 11 missing transactions and a separate empty PG projection fetches all 39 from RPC; both equal chain state at sequence 30, with seven retained WS observations and zero unresolved jobs/intents. All 57 quote diagnostic records are explicitly unsigned (14 eligible outside the outage, 43 refusals total); they are not new trading availability or throughput. The standalone analyzer reproduces the embedded report. [P16A evidence](evidence/P16A.md) records source/artifact/report identities, exact populations, timings and limited resource measurements. Both tables move P16A to Review and retain M6 In progress; external B gates remain Open and 24-hour endurance Deferred. P15A hosted scope/client/report/shell checks pass at run 40127776584; financial is intentionally skipped and automated review remains pending. Exact next action: publish the verified child with gh stack, inspect scoped hosted checks/reviews and keep both PRs open.

R032 publication: `gh stack submit --auto --open` publishes ready [PR #21](https://github.com/arnabnandikgp/rivalt/pull/21), exact initial head `0cf0d9f`, above open P15A PR #20 (`4c09c00`); GitHub stack #22 contains both. The posted P15A review/inline-comment sweep is empty; automated review is still pending, not claimed complete. Both A phases stay Review and M6 In progress; both B gates stay Open. New raw evidence remains ignored and no full-day run was started. Scoped hosted checks for the new child are pending at this publication checkpoint. Exact next action: inspect the open stack's hosted results and concrete review findings, retaining the requested open state; external/funded work and deferred endurance await separate future scope.

R032 hosted closeout: [P15A CI 40128707338](https://github.com/arnabnandikgp/rivalt/actions/runs/40128707338) passes on `4c09c00`; [P16A CI 40128786605](https://github.com/arnabnandikgp/rivalt/actions/runs/40128786605) passes on `081a5eb`. Both run scope/client/report/shell successfully and intentionally skip unchanged financial checks. The posted review/inline-comment sweep is empty for both PRs. CodeRabbit reports “Review rate limited”; its green status is not a completed review or approval. Both PRs are confirmed OPEN and non-draft, with #21 based on #20 in gh stack #22. This final worklog-only record repeats no executable tests; it preserves the actual checked heads rather than claiming future CI. Both phase rows stay Review and M6 stays In progress. Exact next action: address concrete findings when review is available while keeping the stack open; independent P15B/P16B and deferred endurance require their separately scoped future work.

### R033 — 25 October 2026 — P15A/P16A review remediation and authorized merge

- The user explicitly authorizes addressing findings and merging the stack, superseding the earlier keep-open instruction for PRs #20/#21. Inspect clean top `6d2095a`, both PR discussions, all review threads and hosted results. PR #20 has two unresolved actionable findings: missing configured-maker checkpoint binding and opaque maker outage logs. PR #21 reports no actionable findings and has zero inline threads. The bot docstring-coverage advisory is not a repository acceptance gate; no unrelated documentation churn or CLI installation is introduced.
- Fix both confirmed issues in owning parent commit `cfd51e1`: reject a foreign checkpoint owner/capital before capture/output, and log one bounded, URL-redacted reason per outage while preserving recovery/suppression behavior. Update the operator contract. Nine focused tests pass: four actual CLI-module boundary cases with mocked runtime/capture I/O (explicitly not a financial E2E), and five diagnostic redaction cases. `pnpm typecheck` and whitespace checks pass.
- `gh stack rebase --no-trunk` restacks P16A onto the corrected parent without conflicts; comparison to the original top contains exactly those six parent files, with P16A implementation unchanged. Preserve all original acceptance captures locally. No program build, financial/SVM matrix, RPC/PG qualification, browser/devnet, load/history or soak rerun: the changes affect config selection and logs, with broad client regression delegated to hosted CI.
- Both status tables retain P15A/P16A Review and M6 In progress until the authorized merge is verified. B gates stay Open, 24-hour endurance Deferred. Exact next action: publish the restacked fixes, reply/resolve both confirmed review threads after verification, inspect current CI and atomically merge stack #22 through gh stack.

R033 integration closeout:

- `gh stack submit --auto --open` publishes parent `cfd51e118177e38f8fb48df34cd30f10e89bbbcb` and child `21d827456d7fcf19b3082a8d4f733b1f688803d3`. [Parent CI 40167519249](https://github.com/arnabnandikgp/rivalt/actions/runs/40167519249) and [child CI 40167518460](https://github.com/arnabnandikgp/rivalt/actions/runs/40167518460) pass scope/client/report/shell; unchanged financial jobs are intentionally skipped. CodeRabbit's green check says “Review rate limited,” not completed re-review or approval.
- The GitHub connector can read threads but returns HTTP 403 for write operations; authenticated `gh` successfully posts [diagnostic remediation](https://github.com/arnabnandikgp/rivalt/pull/20#discussion_r4369848311) and [checkpoint-binding remediation](https://github.com/arnabnandikgp/rivalt/pull/20#discussion_r4369848394), then resolves both threads. An independent final thread sweep confirms both resolved on #20 and zero threads on #21; both PRs are mergeable with current scoped checks passing.
- `gh stack merge 22 --yes --merge` atomically integrates #20/#21 without bypass at `74fc2963341a5a4cfacb027fed7d51c071e72265`. Independent PR API checks report MERGED at 2026-10-25 06:03:12Z / 06:03:13Z respectively with that same merge commit; remote `main` agrees. Local `git merge --ff-only origin/main` succeeds, and `git diff --exit-code 21d827456d7fcf19b3082a8d4f733b1f688803d3 HEAD` confirms an identical tree.
- Update both status tables, README, delivery-plan workflow and evidence introductions after verified integration: P15A/P16A Closed, M6 In progress, P15B/P16B Open, 24-hour endurance Deferred. No new runtime tests for this documentation-only closeout; all 103 local Markdown links across the five changed documents and `git diff --check` pass. A final `gh pr list --state open` returns no open PRs. Preserve the unrelated untracked `rivalt-isolated-cross-margin-design.md` and all ignored raw evidence in place.
- No merge blocker remains. Exact next action: scope P15B's independent-operator participation and evidence requirements before any separately authorized outreach. P16B, funded work and deferred endurance remain separately scoped future gates; no independent review, funded readiness or full-day qualification is claimed.

### R034 — 25 October 2026 — P17 successor contract and actual code audit

- Read the supplied proposal and current baseline `b005478`, existing instructions/state, financial engine, maker initialization, source/funding/order/exit/liquidation/default paths and SDK/service/indexer assumptions. The proposal's `366b09d` premise was not current; its arithmetic is not test evidence. Preserve the original local proposal unchanged and untracked.
- Deliver `docs/P17-MARGIN-CONTRACT.md`: concrete code-to-design matrix, exact normal/frozen invariants and transitions, group/portfolio/root authority and bounds, ordered schema-2 layouts, fresh deployment/no live conversion, independent-case acceptance ownership and D45–D48 supersessions. Add M7/P17–P21 with justified P18A–C/P21A–B PR-sized splits. M6 external P15B/P16B stay Open; D42 endurance stays Deferred.
- Add inert versioned Rust account layouts and immutable identity validation, with a hard false cross-activation gate. No new instruction, balance mutation, deployment or financial activation. V1 handlers/layouts are unchanged. Layout preparation measured 970-byte margin roots, 446-byte markets and 9,127-byte full 64-member resolution state; transaction/CU/heap acceptance remains due in executable phases.
- Development `cargo test -p clearing --lib state::v2::tests --locked` first found a hand-counted exit-layout assertion of 227 versus actual 223 bytes; independently recount the fields and correct the expected size. Four scoped layout/identity tests then pass; add discriminator rejection coverage before the committed check. Existing Anchor macro `target_os=solana` host warnings remain; no new dependency or toolchain changes.
- P17/M7 remain In progress pending committed verification/publication. No economic/SBF/RPC/WS/PostgreSQL/browser/load/soak tests run: P17 introduces no executable financial path and does not claim those gates. Exact next action: verify the committed P17 layout/contract checks, publish ready through gh stack, then start P18A custody on the exact verified predecessor.

R034 committed verification: `5a4dc84602dc6b559e6de01aa6b6f4cbb5616e46` has no tracked modifications. All five scoped layout/identity/discriminator tests pass with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p clearing --lib state::v2::tests --locked`; 190 changed-document local links and whitespace checks pass. The unchanged user proposal is the sole untracked input. No new dependency, SDK/IDL generation or deployed financial code; those checks belong to P18 onward. P17 moves to Review pending publication/integration, M7 stays In progress. Exact next action: publish ready P17 and start P18A on its verified branch.

R034 publication: `gh stack submit --auto --open` creates ready PR #23 at `0a8ea19`; no merge is claimed. Continue P18A above the verified P17 branch without waiting for integration.

### R035 — 25 October 2026 — P18A versioned group custody

- Continue above exact P17 ready PR #23 head `20daf328c086ba067a988ba3074a8249ba1eb026`. P17 hosted scope check passes in CI run 40168616614; client/report/financial/shell are intentionally skipped, not represented as passing runtime coverage. Original proposal remains untouched/untracked.
- Implement fresh schema-2 group/registry/vault, canonical BTC/ETH market identities, owner portfolios and immutable margin roots, actual token deposits/withdrawals, same-owner/group allocation, pause and explicit surplus classification. Keep all financial activation absent; custody refuses financial/frozen modes and any residual position/claim/funding/order authority. Add critical group events and generated SDK/IDL; all existing V1 IDL instructions/accounts/types/events/errors compare unchanged.
- Explicit successor/default SBF builds, normal/CPI host compilation, deterministic generation and TypeScript checks pass during development. Initial host compile caught unsupported `try_to_vec`; use pinned Borsh serialization instead. SDK checks caught readonly seed types/required event program inputs, and the modern parity test initially ran from the isolated legacy workspace; move it into the modern test workspace without changing either dependency graph.
- Focused conformance now passes all nine instruction data/account-flag comparisons. Development signed LiteSVM run passes 136 scenarios, including 64 actual registry members, same-owner foreign-group rejection, rollback, debt/frozen corruption rejection with restored bytes, and explicit default-build rejection. Initial measured custody maxima are 69,703 CU / 614 bytes / 12 accounts under a declared 400,000-CU ceiling; committed verification remains pending.
- Fresh development RPC attempt `.local/group-custody/20261025T062338Z-27016` deploys the real binary and independently fetches all 51 finalized signed scenarios. It then fails the harness's legacy event comparison because modern `Option::Some` must normalize to the legacy nullable value; retain that failed run. Correct the comparison and add independent raw-byte audit capture before the committed acceptance run. No PostgreSQL/service/UI/load/soak, source/funding/trading/default acceptance or devnet rollout is claimed in custody-only P18A.
- P18A and M7 remain In progress. P17 Review; later successor phases Open; P15B/P16B Open and endurance Deferred. Exact next action: commit the coherent custody implementation, run the scoped checks and fresh RPC/WS acceptance on that revision, publish ready if A23A passes, then continue P18B above it.

R035 committed acceptance: clean `6389c3ecb9f1752e1a258db41cec82419d276895` passes the scoped default/successor SBF build, committed generated-artifact comparison, TypeScript, nine-instruction legacy conformance, 136 signed LiteSVM scenarios (107 successes / 29 exact rejections), and fresh Surfpool deployment/RPC/WS acceptance at `.local/group-custody/20261025T062847Z-29374`. All 51 signed RPC scenarios finalize and are independently fetched: 29 successes, 22 exact rejections, 23 committed group events and 45 WS notifications. Five live account codecs and event bytes match isolated legacy Anchor. The independent Python raw-byte audit passes: all roots flat with zero cash, vault/insurance exactly seven atoms, owner token balance 1,999,993 atoms. Maximum observed custody budget is 69,703 CU / 614 packet bytes / 12 accounts; actual submitted RPC fees total 455,000 lamports. These counts include shared setup and are not distinct financial vectors or throughput. [P18A evidence](evidence/P18A.md) records hashes and limitations. Both status tables retain M7 In progress and move P18A to Review; trading/recovery/PG/UI gates are not passed. No unchanged broad regression, devnet or endurance run; hosted CI remains unclaimed until observed. Exact next action: publish the ready custody PR with gh stack and start P18B on its exact predecessor.

R035 publication: `gh stack submit --auto --open` publishes ready [PR #24](https://github.com/arnabnandikgp/rivalt/pull/24) at `fc73094`, based on open P17 PR #23. GitHub stack #25 contains both. P17/P18A remain Review and hosted P18A checks are pending, not claimed. Continue P18B above the published verified predecessor; no merge or financial activation is performed.

### R036 — 25 October 2026 — P18B two-market isolated primitives

- Continue above exact ready P18A PR #24 head `1d08944`; retain all prior local custody evidence and the untouched user proposal. P17/P18A remain Review. Implement one shared fixed-position accounting adapter, market-unit source conversion, group-bound A/B config/registration/CPI, causal source/funding candidates, atomic one/two-maker route candidates and market/generation-bound four-order/two-protection authority. Both isolated and cross financial entrypoints remain hard-disabled pending their safety gates.
- G14 ordinary configuration: six signed fixture feeds (BTC 1/3, shared collateral 2/4, ETH 5/6); ETH 100,000 lots/unit with raw USD source range 1,000–10,000, converted value/confidence by checked factor ten before ratio rounding. BTC remains 1,000,000 lots/unit and USD 10,000–100,000. Both retain 20-second local source age, all confidence/recovery/funding rules and existing quote/execution/order limits. Maker V2 envelopes bind group and use the same pricing arithmetic; each capital root remains isolated. Fresh local profile only, no devnet upgrade or dependency version change.
- Development: seven new financial-core/market-source golden tests pass; nine actual clearing transition tests pass after correcting an underfunded test fixture (20,000 atoms was below 15,150 position IM + 1,500 loss + 3,930 new reserve; use 21,000 before the separate funding debit). These tests exercise real Rust candidates with independent literal outcomes, not activated on-chain trading. Host compilation catches and fixes Anchor event borrow lifetimes and an explicitly typed checked quantity accumulator.
- First SBF build exposes a 4,800-byte route-candidate frame (4,096 limit); do not accept the artifact. Heap-bound trader candidates and a separate maker-admission frame are under rebuild. The first wrapper also tries an Anchor-only workspace name for the external fixture; correct to its pinned `cargo build-sbf --manifest-path` command. Preserve `.local/successor-p18b/build-failed-frame.log`. No signed runtime, ABI acceptance, financial activation or phase completion is claimed yet.
- Both status tables show M7/P18B In progress; P18C–P21 Open, P15B/P16B Open and endurance Deferred. Unrelated inherited financial/service/PG/browser/devnet/load/soak suites are not run. Exact next action: verify SBF stack bounds, generated ABI and signed four-maker/six-source setup/authority/disabled-entrypoint cases, then record committed A23B acceptance and publish ready before P18C.

R036 development checkpoint: P18A hosted scope/client/financial/shell checks pass on `1d08944` at [CI 40169455043](https://github.com/arnabnandikgp/rivalt/actions/runs/40169455043); report is intentionally skipped. P18B's first route-frame correction passes; explicit account snapshot DTOs then expose a 4,224-byte order-handler frame, resolved with isolated boxed event construction and Anchor's dereferenced event interface. The build wrapper now rejects immediately at the first unsafe SBF artifact. Both failed frame logs remain local. All three changed default/successor builds and the fixture now pass the pinned frame guard. Codama's shared-type heuristic initially nested V1 request inputs; an explicit visitor preserves the original flattened route/order/preview/quote APIs. Distinct `group_binding` naming preserves V1's PDA helper. Four focused ABI tests pass, including 21 new envelope/optional/variant comparisons and affected V1 maker/routes. Ten clearing candidate/snapshot tests and seven financial/source tests pass during development; TypeScript passes.

R036 signed development checkpoint: `.local/group-trading/20261025T065043119Z-45865` passes all 152 signed compiled-program scenarios but the independent auditor initially uses the wrong source-field offset, omitting Feed's sequence field. Correct that raw-byte decoder from the declared fixture layout; preserve the failed command/report. Fresh `.local/group-trading/20261025T065236480Z-46802` passes all 152 scenarios, 22 actual account decodes against isolated legacy Anchor and the independent ledger/source audit. Four distinct maker roots hold 500,000,000 atoms each; two trader roots hold 1,000,000 each; the seventh cross identity has zero. Vault/C are exactly 2,002,000,000, P/I/T=0 and all positions/funding/nonce remain zero. Both markets independently reach Normal, and malformed/stale ETH prices, required-maker quarantine and changed code produce the expected restrictions. Even an explicitly labelled/restored group-mode corruption cannot activate isolated or cross trading. Source samples peak at 760,706 CU with 781-byte packets / 20 accounts; other scenarios peak at 174,525 CU. This remains dirty development evidence, not committed A23B acceptance. Exact next action: commit coherent P18B and run the scoped committed build/ABI/candidate/signed checks with the independent auditor before publishing ready.

R036 committed acceptance: clean `286cb4ecf2ce467d6ddf36f711d66c1bdca908c9` passes seven scoped financial/source golden tests, ten actual clearing candidate/payload tests, pinned default/successor builds of all three changed programs, required source-fixture build, frame guards, exact generated-output comparison and TypeScript. Four ABI test functions pass (21 new instruction/optional/variant cases plus affected V1 maker/routes). Fresh `.local/group-trading/20261025T065644054Z-48290` passes 154 signed scenarios: 103 successes / 51 exact rejections, 22 live account decodes against isolated legacy Anchor and independent raw-byte reconciliation with six adverse mutations. Source samples peak at 760,706 / 1,200,000 declared CU, 781 bytes and 20 accounts; other scenarios peak at 174,525 / 400,000 CU, 788 bytes and 15 accounts. All raw source identities/hashes/results are in [P18B evidence](evidence/P18B.md). Both status tables move P18B to Review; M7 stays In progress and financial activation remains false. No inherited full matrix, new RPC/WS/PG/service flow, devnet, load/history or endurance is claimed. Exact next action: publish the verified ready child with gh stack and continue P18C group safety on its exact head.

R036 publication: `gh stack submit --auto --open` publishes ready [PR #26](https://github.com/arnabnandikgp/rivalt/pull/26) at `79a2392`, above #24 in stack #25. P17/P18A/P18B remain Review; hosted P18B checks are not yet claimed. Exact next action: create P18C above this verified predecessor and implement complete-group safety before enabling isolated trading.

### R037 — 25 October 2026 — P18C complete-group safety

- Continue above ready P18B PR #26 head `a912ebb` in stack #25. Preserve the original proposal and all prior raw evidence. P17/P18A/P18B remain Review, M7/P18C In progress; P15B/P16B Open and endurance Deferred.
- Implement guarded complete-group exits, ordinary cash/claim changes, post-fee liquidation and a paginated group default ledger. Dormant cross identities must remain part of custody/complete-group reconciliation without gaining trading authority. Both compile-time activation gates remain false during implementation.
- No new acceptance is claimed yet. Exact next action: complete and independently test the actual safety transitions and signed failure/recovery paths before qualified isolated activation. Unrelated inherited full suites, devnet, PostgreSQL/UI and endurance are not run; their owning successor phases remain pending.

R037 development checkpoint: seven financial safety golden tests and five actual default-ledger tests pass, including all 1–4 page sizes, the 64-member tie case, fractions and terminal claims beyond stored-v bounds. Initial compilation caught event-borrow lifetimes and temporary signer-seed storage; corrected before host checks. One golden expectation incorrectly kept generation 4 on closing a position; the established implementation/contract advances it to 5, and the independently reviewed expectation is corrected. A test used a nonexistent `LIVE` constant; use the existing `OPEN` state. Host profile compilation passes with inherited Anchor cfg warnings. SBF/signed/RPC acceptance is still pending; both gates remain false. Disposable `target/debug/incremental` cache alone was cleared to recover 437 MiB; prior raw evidence is retained. Exact next action: add the remaining safety boundary goldens, build with fatal frame guards, and exercise actual compiled paths before activation acceptance.

R037 safety-candidate checkpoint: all 18 affected clearing tests pass (eight safety/certificate/liquidation/default tests plus ten inherited candidate tests), and seven financial safety goldens pass. The SBF guard rejects a 4,928-byte liquidation frame; boxed event construction fixes it. A subsequent maker dependency build exposes a cash-context validation frame. Automatic approval review rejects a proposed removal of redundant PDA constraints before it executes; preserve all seed/owner/token checks instead, split the unchanged cash identity/token constraints into a nested Accounts context and retain the market/guard PDA constraints outside it. Host compilation passes. Failed build logs remain local. With the safety handlers and host cases present, make isolated mode executable only in the explicit local test profile for fresh compiled acceptance; cross stays hard-false and default/devnet reject it. No A23C pass or deployment is claimed. Exact next action: finish frame/build/IDL checks and run signed safety cases against this candidate.

R037 runtime development checkpoint: P18B head `a912ebb6b6126f7f9eeb5742d1bdf4613ad264b5` has observed hosted scope/client/financial/shell SUCCESS; report SKIPPED, no independent approval claimed. P18C default/successor builds now pass all frame guards. The first generated SDK renamed inherited PDA helpers after new instructions sorted earlier; bind helper names to exact seed schemas, restoring every inherited instruction file unchanged. TypeScript passes. A failed build-only import of a transport outside its workspace is replaced by local seed-label identity conversion; the first visitor used a node where Codama supplies a path, corrected before generation checks.

R037 signed findings: `.local/group-safety/20261025T071729198Z-61382` reaches 115 scenarios then fails the first two-maker fill with heap exhaustion. Bound route candidate/event allocations and preserve exact Anchor event CPI wire/authority, verified by the focused payload comparison. Fresh `20261025T071952790Z-62327` passes 148 ordinary signed lifecycle scenarios. Extended `20261025T072139453Z-62989` reaches 395 before full-cohort resolution decoding exhausts the heap; `20261025T072331312Z-63562` reaches 422 before the four-member collection page exhausts it. Bound Vec deserialization to one <=64-member allocation without changing wire layout, reuse stack storage for each page root, and pre-size event payloads without enlarging the 32 KiB heap. All failures retain signed wires/logs; none is acceptance evidence.

R037 full-cohort development: `20261025T072540907Z-64213` passes 746 signed scenarios and the independent raw-byte auditor with six altered captures rejected. Actual 64-member default collects/pays 684,639 atoms, impairs 654,816,119,027,760 scaled unpaid units and has exactly zero summed terminal rounding; insurance is zero in this run. Healthy sibling cash and T remain outside the waterfall. Eighteen affected clearing tests and six layout/decoder tests pass; seven financial safety tests and the event-payload comparison also pass. All runtime evidence is on a dirty development tree, not clean A23C acceptance. Exact next action: commit the coherent safety candidate, add remaining insurance/order/emergency cases and fresh RPC/WS/legacy parity, then verify the final committed phase before ready publication. No inherited broad runtime matrix, PostgreSQL/UI/devnet/load/soak or external gate is claimed.

R037 clean host checkpoint: `fbcd158e3f32dda352be5c12dbe43ff3e07b2256` passes 37 scoped host tests on a clean tracked tree: 12 financial margin/safety, 18 clearing group, six layout/bounded-decoder and one Anchor-compatible event-payload test. Commands use `--locked --offline`, `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0`, with the explicit successor feature for clearing. Logs remain in `.local/successor-p18c/checkpoint-*.log`. This does not convert earlier dirty compiled runs into clean acceptance. Both status tables retain P18C/M7 In progress. Exact next action: add signed order/insurance/emergency cases, then fresh RPC/WS and legacy parity before final committed acceptance/publication.

R037 extended acceptance development: clean host checkpoint remains `fbcd158`; additional harness changes are uncommitted. Signed run `20261025T073809721Z-69865` passes 1,131 scenarios: actual partial stored fills/fee prefixes, pending funding, TP/SL shared allowance and generation cleanup, reserved withdrawal/transfer rejection, high-fee liquidation rejection, 65th-member rollback, explicit 1,000-atom T→I plus seven donated atoms, paused default, stale-source emergency/AwaitValuation, simultaneous price pinning, repeat 64-member resolution, recovery and stale-but-completely-flat funded exit. Independent raw-byte auditors reconstruct both waterfalls and reject six corruptions. The insured default pays 683,846 atoms, uses 1,007 insurance atoms and impairs 653,811,107,651,160 scaled units; the later emergency pays 7,225 with no impairment; both rounding sums are zero.

R037 development corrections: the first small order produced zero premium because inventory had not crossed the fixed maker skew step; use a real 100-lot fill to exercise nonzero pending funding. The first claim loop attempted to pay more than whole-atom collections funded; retain unpaid fractional claims and cap payment at actual P. An initial liquidation golden omitted the unchanged 1% risk bands; correcting the independent [51,480, 52,520] calculation yields 50 atoms of apparent improvement consumed by a 1,222-atom fee. These are harness expectation corrections, not relaxed program safeguards. All failed signed wires remain local. Two ABI test functions pass (15 safety cases plus 21 inherited group primitive cases); three live account layouts and 692 emitted events across eight types agree with isolated legacy Anchor. TypeScript passes. Fresh Surfpool RPC/WS deployment is running; it is not yet acceptance. No unrelated full suite, PG/UI/devnet or endurance run. Exact next action: complete real RPC/WS and independent lifecycle audit, pin the final phase revision, then run its scoped acceptance and publish ready above #26.

R037 RPC development finding: fresh Surfpool `20261025T073615Z-68796` deploys all four programs and independently finalizes/fetches 78 signed scenarios, but the sequential finality wait between every source publication keeps recovery in ReduceOnly rather than Normal. Retain the failed run; no safeguard is changed. The next harness observes confirmed transactions during the causal sampling loop and independently refetches every original signature finalized before acceptance. The standalone ordinary-flow auditor first used a combined side-consumption counter; correcting the independent curve arithmetic to separate buy/sell counters gives 780 maker-A / 1,800 maker-B atoms per market, 1,802 total taker-fee atoms and 100 atoms withdrawn. Its four deliberate mutations now reject. Fresh optimized RPC acceptance remains pending.

R037 RPC/build development pass: `20261025T073952Z-71938` passes all 148 signed both-market lifecycle scenarios; every original signature is independently fetched finalized and matches its confirmed outcome. Five live account codecs and 56 emitted events match legacy Anchor, all 81 expected clearing-mention outcomes arrive on WS, and the independent literal-curve/cash audit plus four mutations pass. Source/guard/risk limits remain unchanged. This is dirty-development evidence. The full default/successor build of all three programs plus fixture, frame guards and exact generated-output comparison passes with program/generator source at `d197786` (unchanged from `fbcd158` for Rust); all five focused ABI test functions pass, including inherited route/maker parity. A23C still needs the final pinned runtime run; no broad inherited suite or service/PG qualification is claimed. Exact next action: commit the final harness, run its clean signed SVM and fresh RPC/WS acceptance, then publish ready through gh stack and proceed to P19.

R037 committed A23C/G14 acceptance: clean `b43261f12e4f5100d7397d6d49582b1e1d760c03` passes 1,132 signed SVM scenarios (1,084 successes / 48 exact rejections) at `.local/group-safety/20261025T074207672Z-73819`, including default-build rejection, 64-member insured and emergency resolution, both independent audits and three-account/692-event legacy parity. Fresh `.local/group-safety-rpc/20261025T074210Z-73847` independently finalizes/fetches all 148 signed outcomes (141 successes / seven rejections), observes all 81 expected WS notifications, compares five live account codecs/56 events, and passes the independent literal-curve ledger audit/four corruptions. Both runs record identical start/end revision and no tracked modifications. Full source hashes, scope and maxima are in [P18C evidence](evidence/P18C.md). Both status tables move P18C to Review; M7 remains In progress. Isolated local activation is qualified; cross/default/devnet remain gated, P15B/P16B Open and endurance Deferred. No unrelated full suite or new PG/UI/service/load/devnet claim. Exact next action: publish the ready P18C child through gh stack, then implement P19 above its verified head without waiting for merge.

R037 activated-route audit extension: after the main pinned acceptance, add six active-route negatives covering fee budget, stale second quote epoch, foreign-market second config after the first CPI, duplicate makers, foreign actor and self-alias. Compare maker registration/config/binding bytes as well as all financial roots on rejection. Development `20261025T074556711Z-75738` passes 1,142 signed scenarios and unchanged independent audits. Duplicate mutable identities reject earlier in Anchor with 2040; the initial harness expected the later domain Alias error and was corrected without changing program code. TypeScript passes. No program/SDK/RPC lifecycle changes; pinned `b43261f` RPC evidence remains applicable. Exact next action: commit this scoped acceptance/report change, verify the extended SVM run on the committed tree, publish ready P18C, then start P19.

R037 extended committed verification: clean `298f4460edbcd3c4525dc39b4ca27aa26a94c4a7` passes all 1,142 signed SVM scenarios (1,088 successes / 54 exact rejections), the unchanged 692-event/three-account legacy parity and both independent default audits with six corruptions rejected. Raw run: `.local/group-safety/20261025T074629663Z-75825`. Program, SDK and RPC source are unchanged from the pinned `b43261f` fresh RPC acceptance; no redundant deployment or unrelated suite is rerun for this additional SVM-only check. P18C stays Review, M7 In progress. Exact next action: publish ready P18C through gh stack, then start P19 on its verified predecessor.

R037 publication: `gh stack submit --auto --open` publishes ready [PR #27](https://github.com/arnabnandikgp/rivalt/pull/27) at `f1479f06b299392c4ff5761276a3e224ffa8e82f`, above #26 in stack #25. GitHub confirms OPEN and non-draft. Scope succeeds and report is skipped on that head; client/financial/shell were queued when observed, not claimed as passing. No review approval or merge is claimed. P17/P18A/P18B/P18C remain Review. Exact next action: continue P19 on the verified P18C branch, keeping the stack open.

### R038 — 25 October 2026 — P19 bounded whole-account core

- Continue with `gh stack add phase/p19-cross-core` above exact ready P18C #27 head `0742c20ba5359bc9f1f6e44ae3203ad7a6b16c1c`; keep all four predecessor PRs open. Preserve the original untracked proposal and all ignored evidence. Both status tables now show P19/M7 In progress; P20/P21 Open, P15B/P16B Open, endurance Deferred.
- Add candidate-only exact flat-claim cancellation and whole-account donor/recipient transfer arithmetic to the shared engine, with six independent literal golden cases for G01–G04/G09. The first two fill vectors fell below the unchanged 1,000-atom minimum order; use ten 100-atom lots without changing the economic limit. `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p financial-core --test cross_core --locked --offline` now passes all six development cases. Log: `.local/successor-p19/cross-core-development.log`. These are uncommitted host arithmetic checks, not authority, deployed cross or A24 acceptance.
- Record ordinary D51 choices and [P19 contract](P19-CROSS-CORE.md), including nonce invalidation on delegate changes, exclusive expiry bounded by the existing order lifetime and inactive historical protection metadata. No account-layout or activation change. No broad inherited suite, SBF/ABI/RPC/WS/PG/UI/devnet/load/soak run for this initial arithmetic addition; owning phase gates remain pending.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.

R038 committed arithmetic checkpoint: clean `a1eb4abfa44ad465a5769598b6c23167e5e61885` passes all six scoped `cross_core` tests with `--locked --offline`; log `.local/successor-p19/cross-core-committed.log`. P18C #27 head `0742c20` now has observed scope/client/financial/shell SUCCESS at CI 40174192760; report SKIPPED, no external review approval claimed.

R038 dependency/authority development: add the shared root model, complete canonical BTC/ETH dependency validation and root-scoped owner/exclusive-delegate checks without exposing a new financial instruction. Four scoped clearing tests pass, including omitted/reordered/duplicate/foreign dependencies, malformed delegation, cross-maker identity and the unchanged cross release gate. Log `.local/successor-p19/dependencies-authority-development.log`; inherited Anchor cfg warnings and the not-yet-wired candidate helper warning remain. A24 is still pending. Exact next action: generalize the existing four-order/two-protection engine and wire actual handler authority/dependencies, then verify concurrent/expiry/revocation and whole-account funding behavior.


### R039 — 25 October 2026 — P19 whole-book and delegated execution

- Starting checkpoint `30f7f61` on `phase/p19-cross-core`, including the prior uncommitted whole-book refactor. Preserve the untracked supplied proposal; four predecessor PRs remain open/Review. P19 and M7 remain In progress in both tables.
- Generalize the existing book to both market slots with complete funding, summed reservations, market/generation-bound TP/SL and exclusive delegate epochs. Retain isolated adapters over the same engine. Wire owner-only per-root grants/revocation, critical authority events, delegated isolated routes/orders, immediate nonce invalidation and stored execution checks. Owner replacement reauthorizes epoch zero; delegate replacement adopts the live grant epoch. No cash or maker configuration authority is delegated. Explicit transfers now accrue recipient funding through the shared candidate too.
- D51 clarification: grants are available only in the qualified unfrozen financial group, including its dormant cross roots. Pause permits owner revocation; frozen resolution/custody mode rejects mutation. A dormant grant cannot authorize cross trading or block its legitimate cash exit. This deliberately supersedes D50's temporary no-delegate restriction, preserving its no-cross-exposure/claim/order guard.
- Actual development checks: eight focused whole-book/dependency tests pass at `.local/successor-p19/whole-book-development.log`; after wiring, `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p clearing --lib instructions::group --features successor-test-profile --locked --offline` passes 28 affected tests at `.local/successor-p19/authority-wiring-development-3.log`. Cases include two-market reserve totals, ETH pending funding before BTC admission, market substitution, expiry/revocation/regrant, owner/delegate replacement and partial TP/SL generation/allowance ownership. These are dirty-tree host checks, not signed A24 acceptance.
- Development failures retained: the inherited test expected the former isolated-only model to reject cross before its separate release gate; update it to assert shared-model acceptance AND actual trading rejection. The next test build found three mistaken helper names in new tests; corrected without program behavior changes. Original logs remain `authority-wiring-development.log` / `authority-wiring-development-2.log`. Anchor's existing host cfg warnings remain.
- Not run at this checkpoint: new SBF/IDL/SDK/signed RPC acceptance, unrelated inherited full suites, PostgreSQL/services/UI/load/devnet or endurance. New runtime/ABI acceptance is still required for P19; P20 owns enabled-cross liquidation/default qualification and P21 owns integrated services. No A24 pass, P19 PR or deployment claimed.
- Blockers: none. Exact next action: wire complete canonical two-market route/order and owner flat-netting handlers, add the remaining independent candidate vectors, then build/generate and run scoped signed acceptance before ready stacked publication.


R039 full-dependency development: shared two-market route/order handlers now authenticate complete canonical dependencies and exact sequence/observation snapshots, use one Clock, require Normal for all relevant increase markets, materialize both funding prefixes and emit both market snapshots. Owner-only flat netting authenticates the root/group and rejects active orders/open exposure without moving cash. Cross activation remains false. Thirty-two affected clearing tests pass at `.local/successor-p19/candidate-goldens-development.log`, including the actual route's 15,332-atom admission boundary versus 15,331 rejection, 2,000-atom pending ETH funding debit, unmodified maker cash, source relevance, exact fractional netting and expired-hold prefix persistence. The first nested handler compile rejected Anchor's segmented type paths; importing the same account types unqualified resolves it, with no constraint removal. Logs `full-handlers-development.log` / `full-handlers-development-2.log` retain both outcomes. Program source checkpoint follows `5e25692`; these remain development host results. Both status tables retain P19/M7 In progress. Exact next action: build default/successor SBF and new IDL/SDK, then run scoped signed authority/transfer/order regression and default/cross negatives with legacy parity before ready publication. No unrelated full suite, PG/UI/devnet/soak or external gate was run.


R039 build/runtime development: the first SBF frame guard rejects the large manage/netting frames; retain `build-unsafe-frames.log` and `build-unsafe-frames-2.log`. Separate candidate/source frames and bounded event factories resolve them without larger stacks/heaps or removed constraints. The first SDK generation exposes a pinned-generator limitation for events nested as defined types; flatten only the new whole-account events, retaining every existing wire layout. Preserve `build-nested-events.log`, `typecheck-development-2.log` and the pre-execution SDK import failure. Full default/successor builds, three IDLs and generated SDK now pass. TypeScript and three scoped ABI functions (12 new, 21 group primitive, 15 group safety cases) pass.

R039 signed development: `.local/margin-core/20261025T081120481Z-89569` passes 224 signed SVM scenarios (203 success / 21 rejection). Fresh `.local/margin-core-rpc/20261025T081135Z-89645` independently fetches/finalizes all 222 RPC outcomes (203 success / 19 rejection), receives all 107 expected WS outcomes, matches five accounts/75 events with legacy Anchor, and passes raw accounting plus five corrupted captures rejected. Exact final C=2,001,999,866, T=134, P=I=0, vault=2,002,000,000; ten atoms explicitly transfer between owner roots and 100 dormant cross atoms actually deposit/withdraw. Both runs are dirty development on `358989a`, not clean acceptance.

R039 final harness extension: actual keeper execution of a live delegated durable order and revoked-order rejection pass in `.local/margin-core/20261025T081226076Z-89927`: 226 scenarios (204 success / 22 rejection), three account/76 event parity and the independent audit/five corruptions. Full-route price-trigger/protection and literal 2,000+2,000+2,000 cumulative-fee goldens bring affected clearing host checks to 34, passing at `final-goldens-development.log`; their extra code is test-only. Updated source map/components describe the shared engine and complete event snapshots. The original supplied proposal and raw evidence stay untracked/ignored. No new cross activation, P19 PR, PostgreSQL/service/UI/devnet/soak or external gate claimed. Exact next action: commit the final P19 acceptance candidate, run its scoped clean host/ABI and signed SVM/fresh RPC/WS checks, then publish ready above #27 and continue P20.


R039 pinned A24/G15 core acceptance: clean `4274d28afa4c8278ca263816a7455e55c7656462` passes 34 affected clearing tests, six financial goldens, three ABI functions (48 cases), generated drift/type checks, 226 signed SVM scenarios (204 success / 22 rejection) at `.local/margin-core/20261025T081513897Z-91621`, and 224 fresh finalized RPC scenarios (204 success / 20 rejection) at `.local/margin-core-rpc/20261025T081459Z-91587`. All 109 expected WS outcomes arrive; five live account/76 event legacy parity and independent raw-byte audit/five corruptions pass. Both runtime identities are clean and unchanged start/end. The first clean SVM launcher raced SDK regeneration and failed before execution; `svm-committed.log` retains that import failure, and `svm-committed-2.log` records the successful rerun after generation completed. [P19 evidence](evidence/P19.md) pins artifacts, budgets, scopes and limitations. Both tables move P19 to Review; M7 stays In progress. Cross remains disabled, no unrelated runtime/PG/UI/devnet/soak or external gate claimed. Exact next action: publish ready P19 through gh stack above #27, then begin P20's complete cross liquidation/default acceptance on that exact verified parent.


R039 publication: `gh stack submit --auto --open` publishes [ready PR #28](https://github.com/arnabnandikgp/rivalt/pull/28) at `c0b7898894a7b70bc8a1873014fcbea15fdd2f7e`, base `phase/p18c-group-safety`. GitHub confirms OPEN/non-draft and stack #25 now has five open PRs. Hosted scope is running and client/financial/shell are queued when observed; no CI pass or external review/merge is claimed. Title/body describe final phase scope and actual evidence. Continue with `gh stack add phase/p20-cross-safety` on that exact head.

### R040 — 25 October 2026 — P20 cross safety candidates

- Start above verified P19 #28 `c0b7898`; preserve the supplied untracked note and all ignored evidence. P17–P19 remain Review/open. Both tables show P20/M7 In progress; P21 Open, P15B/P16B external Open, endurance Deferred.
- Audit P17's G05–G08/G12, actual complete-group certificate, liquidation and frozen ledger. Generalize the pure liquidation candidate to both modes and all target/receiver positions, funding and surviving receiver reservations. Runtime handlers explicitly retain the cross release gate. Do not reinterpret conservative negative risk equity as economic bankruptcy.
- Development verification: `CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p clearing --lib instructions::group_safety::tests --features successor-test-profile --locked --offline` passes five focused tests (44 filtered out) in `.local/successor-p20/liquidation-development.log`. Independent cases exercise both-market funding, receiver reservations, stale secondary exposure, exact fee/progress boundary and G05's worsening post-fee deficit. The earlier three inherited cases also pass at `.local/successor-p19/p20-safety-inherited-development.log`; preserve that original path. These are dirty host development checks, not signed acceptance. Only inherited Anchor host cfg warnings remain.
- Not run: P20 SBF/RPC/WS, mixed complete-group default, unrelated inherited suites, PostgreSQL/services/UI, devnet, endurance or external gates. No activation or A25 pass claimed; P19 evidence retains its original scope.
- Blockers: none. Exact next action: recreate mixed cross/isolated net-default and fractional page/restart cases against the frozen ledger, then finish source-missing recovery and exit certification before local signed cross qualification.


R040 safety/ledger checkpoint: generalize the frozen ledger's pure model, preserving
external member/profile gates. Independent G06/G07/G08/G12 cases verify economic
versus risk equity, literal final cash `[0,50,370]`, no sibling seizure, 64 mixed
roots, both registration orders, all page sizes and serialization/restart after
every page. Verify both-market derived bounds without storing oversized terminal
claims. Ordinary exits now refresh the full book and certify mode-2 held funding
endpoints, including the adverse mixed corner. Add gated cross activation with
complete certification/Normal sources and preserved funding history; recovery
returns to isolated mode and requires explicit cross reactivation.

Ten ledger tests pass at `.local/successor-p20/default-development-2.log`. The
first attempt failed to compile a test-only comparison of PositionV2 without
PartialEq/Debug; compare exact fields instead, preserving the original log. Full
affected safety verification passes 19 tests at `safety-development.log` (39
filtered) and again under the separate internal candidate feature at
`safety-candidate-development.log`. These are development checks above `54d6aa6`,
not clean/SBF/RPC acceptance. Add `ops/build-cross-safety.sh` for the separately
named local candidate; normal artifacts retain the false release constant.

P19 hosted scope/client/financial/shell checks are observed SUCCESS on exact
`c0b7898894a7b70bc8a1873014fcbea15fdd2f7e`; report is SKIPPED. PR #28 remains OPEN
and non-draft. No independent review approval or merge claimed. P20/M7 remain In
progress in both tables. No unrelated full suite, PG/services/UI/devnet/soak or
external gate was run. Exact next action: build the gated and local candidate SBF
artifacts/IDL, then exercise signed cross lifecycle/liquidation/default with fresh
RPC/WS and independent raw-account reconciliation before release promotion.


R040 signed candidate development: default/ordinary/candidate clearing SBF, the
unchanged maker programs/fixture, new activation IDL/SDK and frame guards build
successfully at `.local/successor-p20/build-development.log`. A subsequent focused
clearing candidate build adds mode-2 membership/control support and its one host
regression (`membership-candidate-development.log`, `build-membership-development.log`).
Together with the 19 safety checks, 20 scoped host tests now pass. Generated
activation ABI matches isolated legacy Anchor in 16 safety cases; typecheck passes
at `abi-development.log` / `typecheck-development-3.log`. The first TS attempt
exposed an overly narrow harness route return type; widen it to the shared
Instruction interface without changing instruction bytes.

Signed local development retains all attempts. The first run correctly rejects a
fixture trying to collect an open position's virtual field as a closed loss; skip
open positions in that closed-claim helper. The next rejects an inherited isolated
size that exceeds the shared cross cash budget; use a smaller funded ETH leg in
the cross fixture, with no changed admission rule. The third completes 1,137
scenarios (1,087 successful / 50 exact rejections) at
`.local/cross-safety/20261025T083332687Z-907`. Its auditor initially still assumed
root ID 0 was the default target; use the explicitly recorded cross target and
rerun the raw audit successfully, including seven corrupted captures rejected.
These are harness corrections, not financial-rule relaxations.

Extend signed coverage with a root-scoped delegate, delegated second-market fill,
delegate netting rejection and G06's actual negative-risk/positive-economic-net
freeze rejection. Its extra fees require the cross fixture's ETH default leg to
remain within its remaining summed IM; the fourth failed setup is preserved. The
fifth run passes 1,224 scenarios (1,172 success / 52 exact rejections) at
`.local/cross-safety/20261025T083641403Z-1948`: 704 events across ten types and three
accounts match isolated legacy Anchor. Both actual 64-member resolutions and seven
mutations pass independent raw-byte accounting; the report explicitly marks the
economic sign case exercised. These remain dirty development above `e903d4e`.
The earlier 1,137-case version does not claim the added sign/delegate checks.

The SVM measurements include the actual owner transfer plus two-maker cross route:
469,350 CU under 600,000 declared, 1,154 bytes and 22 accounts in the first complete
run; ordinary paths max 176,165/400,000 CU and sampling/resolution max
802,610/1,200,000. All passed the 20% headroom assertion; final revised/RPC bounds
remain to be recorded separately. Fresh loopback RPC qualification is running at
`.local/cross-safety-rpc/20261025T083413Z-1261`; no completion is claimed yet.
No PG/services/UI, devnet, endurance or external gate was run. Ordinary/default
cross release remains false; the internal candidate is explicitly labelled.
Exact next action: finish fresh RPC/WS, pin the final candidate including the
expanded sign/delegate cases, run scoped clean acceptance and record A25 before
release promotion and ready stacked publication.


R040 first fresh RPC attempt independently fetches 916 confirmed signed outcomes
through the initial complete default/recovery, then its generic 15-second polling
deadline times out while the emergency test intentionally waits 21 actual seconds.
Preserve `.local/successor-p20/rpc-development.log` and the full run directory.
No RPC/WS acceptance or complete finality pass is claimed. Correct only the P20
harness clock-wait deadline to requested real elapsed time plus 15 seconds, bounded
to 60 seconds; retain standard RPC reads and every source age/grace/health rule.
The owned runtime exits through its cleanup trap. The expanded SVM maximum is
469,063/600,000 CU for atomic transfer plus two-maker cross open, 1,154 bytes/22
accounts; sampling/resolution maximum 802,613/1,200,000 CU.

Prepare the complete P20 internal qualification candidate with SDK, shared harness
adapters and independent raw auditor. The source remains gated in ordinary builds.
Exact next action: pin this candidate, rebuild its artifacts and run clean scoped
checks plus the complete expanded SVM/fresh RPC/WS flow; then promote only on
recorded acceptance. No P20 PR/closure or external-gate progress is claimed.


R040 pinned safety/core qualification: clean `3c7ab4e83e14cb0f3f91f5a3ddb2f34d22b0ef4c`
passes the full rebuild/frame guard, generated drift/type checks, 16 safety ABI
cases, 19 safety tests and three distinct release/membership/root checks across
ordinary successor, internal candidate and devnet host profiles (28 Rust test
invocations total). SVM `.local/cross-safety/20261025T084148915Z-6056` passes 1,224
outcomes (1,172 success / 52 exact rejection); fresh RPC
`.local/cross-safety-rpc/20261025T084150Z-6088` independently fetches/finalizes all
1,221 outcomes (1,172 success / 49 rejection), receives all 820 expected WS
outcomes and matches five accounts/704 events across ten types with legacy Anchor.
Both runs are clean with matching start/end revision. Independent complete default,
emergency recovery, economic sign and seven corrupted-capture checks pass.
Scenario fees are 8,690,000 local lamports, excluding deployment. RPC maxima are
177,048/400,000, 470,829/600,000 and 804,379/1,200,000 CU; route/atomic packet maximum
is 1,154 bytes/22 accounts. These actual exercised paths meet 20% headroom.

R040 maximum-book follow-up: a separate focused harness fills all four cross order
slots with both positions exposed, then submits an actual owner transfer plus
two-maker open. It succeeds at 487,360 CU but correctly fails the 20% headroom
assertion under 600,000 (`budget-development.log`). Add the SDK's distinct
`groupTransferRouteComputeBudget` at 700,000 CU for this combined transaction;
standalone routes keep 600,000 and risk/fee/capacity rules stay unchanged. The
focused harness also liquidates a two-market receiver with all four receiver order
slots occupied and cancels all four target risk orders. SVM development and raw
conservation pass (`budget-development-2.log`, `budget-development-3.log`);
program artifacts are unchanged from the clean core run. Do not rerun the full
resolution lifecycle for this client-budget-only addition.

Both tables retain P20/M7 In progress. Full P20 acceptance still needs the pinned
focused maximum-book RPC budget check and recorded release promotion. No
PG/services/UI/devnet deployment, endurance or external gate is claimed. Exact
next action: pin the focused budget change, run its SVM/RPC checks, then promote
the byte-verified local artifact and publish P20 ready above #28.


R040 focused budget acceptance: clean `aadb69f478625c26af4e33313845fbd0df99479f`
passes 215 SVM outcomes (209 success / 6 rejection) at
`.local/cross-budget/20261025T085049170Z-8610`, and 212 independently finalized RPC
outcomes (209 success / 3 rejection) at
`.local/cross-budget-rpc/20261025T085050Z-8674`. All 95 expected WS outcomes arrive;
five account/79-event legacy parity and independent raw conservation pass. Both
run identities are clean and unchanged. Actual RPC maximum-book transfer/route is
489,126/700,000 CU, 1,154 bytes/22 accounts; full-book standalone reduction is
417,604/600,000 CU, 1,037 bytes/20 accounts; two-market receiver liquidation with
four remaining orders is 83,908/400,000 CU, 589 bytes/11 accounts. All meet 20%
headroom. Scenario network fees are 1,820,000 local lamports excluding deployment.

R040 release qualification: promote the release marker only for the same explicit
local `cross-safety-qualification` feature, preserving the older isolated/default/
devnet gates. No general-profile cross launch or migration is introduced. The first
comparison detected different binaries after formatting moved diagnostic code
locations; retain `promotion-parity.json` and those logs. Preserve the existing
locations and rebuild: `promotion-verified-parity.json` now confirms byte identity
for all three clearing profiles, including qualified hash `dce212e4...b28a7`. Six
focused identity/profile checks also pass. No full financial rerun is needed for
byte-identical artifacts. [P20 evidence](evidence/P20.md) records exact sources,
outcomes, hashes, scopes and remaining service/PG/UI/contention limits.

Both tables move P20 to Review; M7 remains In progress, P21A/B Open, P15B/P16B
external Open and 24-hour endurance Deferred. PR publication/integration is still
pending at this checkpoint. No unrelated full suite, new devnet/funded deployment
or external review is claimed. Exact next action: commit the qualification record,
publish P20 ready above #28 through gh stack, then begin P21A on that exact head.


### R041 — 25 October 2026 — P20 publication and P21A group indexing/client checkpoint

- P20 publication: commit `459c84c43188e9080ccf6c0639a9b121e9a5bb76` records the verified release-marker promotion and concise A25 evidence. `gh stack submit --auto --open` creates ready [PR #29](https://github.com/arnabnandikgp/rivalt/pull/29) above #28; independent `gh pr view` confirms OPEN, non-draft, exact head/base. Keep all successor PRs open. `gh stack add phase/p21a-group-services` creates the dependent branch on that exact head. Original untracked proposal is preserved unchanged.
- Delivered so far: authenticated schema-2 event decoding, whole-group finalized projection (both markets, one cash balance/root, exact claims, maker isolation, delegate/order state and paginated resolution), a versioned journal adapter reusing existing PostgreSQL append-only/checkpoint semantics, and a shared finalized scanner retaining V1 behavior. Group reconciliation validates canonical PDAs/discriminators/owners, all account fields, complete membership and SPL vault identity. RPC chunks include the group sequence to reject inconsistent multi-request snapshots.
- Added direct canonical market/maker PDA helpers and read-only SDK group balance/funding/reservation/protection previews. `/v2` group/account/portfolio/event/trade HTTP endpoints expose finalized projection and separately labelled current on-chain Clock inputs. No preview grants withdrawal permission. Standalone group indexer requires explicit local profile/run configuration. Direct signed user builders and durable group workers remain pending. D53 and P21A-INTERFACES document the interface boundary.
- Scoped checks: seven group projection/schema cases plus inherited four event/five projection cases pass; seven independent literal SDK financial/authority preview cases pass (23 total). Initial type checks caught generated event naming, branded-string recursion and test fixture typing; corrected before the pinned check. `git diff --check` passes. Retained signed P20 history replay passes 704 committed events / 49 rejected transactions / 64 roots; this is a new consumer regression on historical inputs, not fresh A26A. The audit output stays at `.local/cross-safety-rpc/20261025T084150Z-6088/p21-projection-regression.json`.
- Initial fresh integration attempt `.local/group-indexer-rpc/20261025T134657Z-27855` stops before scenarios because the existing Apple container service was down (XPC connection invalid); no database result claimed. Start the existing service with `container system start`; no new platform installed.
- Fresh development run `bash ops/group-indexer-smoke.sh` at `.local/group-indexer-rpc/20261025T134839Z-28330` passes: 215 original signed outcomes independently fetched finalized; 102 group-related canonical transactions, 81 events/outbox entries, zero unresolved jobs, actual live group WS, a reverted first-instruction deposit excluded, original-signature recovery after actual WS disconnect/restart, and exact replay into a new PostgreSQL 18.6 database. Eight roots/21 accounts reconcile; actual/allocated vault both 2,003,200,018 test atoms, zero surplus. This run is explicitly dirty development code; HTTP and the subsequently added SDK preview are not covered by it. Raw local logs: `.local/p21a-indexer-development*.log`, `.local/p21a-projection-tests.log`, `.local/p21a-typecheck.log`.
- Not rerun: unchanged P20 SBF financial/default suites, generation/IDL parity, V1 broad lifecycle, browser/load/endurance or devnet. New services/direct-client/whole-resolution process interruption and API-disabled exits are incomplete; prior P20 financial evidence does not close these P21 gates. P21B contention/UI and external P15B/P16B remain Open; 24-hour endurance Deferred.
- Status: both tables keep M7/P21A In progress, P20 Review; no P21 PR/acceptance or merge claimed. No access/product blocker after the local container restart. Exact next action: commit the indexer/API/preview checkpoint, run its scoped pinned HTTP/PostgreSQL check, then implement the group queue/workers and direct SDK paths.

R041 pinned checkpoint: `705e1a63dc5bcdd03a1a4777e51d7148f1ab82ce` runs the
new HTTP continuation at `.local/group-indexer-rpc/20261025T135923Z-31547`. All 215
original signatures finalize; initial group reconstruction and deposit rollback/
WS recovery complete, but `/v2/accounts` returns 503 before fresh-database replay.
This attempt is **not acceptance**. The account endpoint contained three extra
characters in its Clock public key. A short independent Surfpool Clock-only RPC
check confirms the canonical 43-character account, sysvar owner and 40-byte layout.
The SDK preview reproduces successfully from retained finalized account projections.

Correct the constant and validate it with `address()` at module load. One focused
HTTP-injection regression asserts the exact Clock RPC parameters, finalized context,
exact cash/risk output, no implied withdrawal and unhealthy 503 behavior. It passes;
this fixture check is not real HTTP/chain acceptance. Typecheck and evidence-policy
checks pass. Preserve both the failed pinned run and prior passing development
indexer run. Do not repeat the complete financial fixture for a string correction;
the next fresh group-service qualification will include the repaired HTTP endpoint.

Both tables remain M7/P21A In progress; P20 stays Review in #29. No P21 PR exists.
Exact next action: implement schema-2 immutable queue authority and market-specific
worker budgets, then extend the fresh service qualification through the repaired
HTTP and direct-client paths.


### R042 — 25 October 2026 — P21A durable group execution infrastructure

- Base: local `b659cd1` above exact verified P20 #29. R041's API Clock correction and focused regression are committed; P21A remains In progress, without a PR.
- Delivered: schema-2 nonce/group-sequence/maker-epoch nonexecution proofs, exact signed wallet ingress (including the measured 700k atomic transfer/route envelope), shared immutable operator retry implementation, group execution supervisor and actual executor process entrypoint. No user message is rebuilt after signing. V2 account discriminator/schema/group checks precede an expiry proof; missing history still retains fee reservations. Operator intent namespaces cannot be claimed by wallet submissions.
- Configuration: separate `(run, market, maker)` heartbeat table; fixed local budgets of 1,000,000 lamports per maker, 5,000,000 per market funding worker and 5,000,000 each for group order/settlement/risk roles. These are explicit service SOL caps, not test collateral/venue fees. No top-up, paid service or external spend is introduced. Financial discovery/worker decisions are not implemented by this execution infrastructure.
- Checks: `pnpm typecheck`, three affected Vitest files (3 authority/budget + 5 signed ingress + 9 inherited immutable retry/recovery = 17 checks), `git diff --check` pass. No on-chain code or IDL changed; unrelated SBF/full matrix/browser/load/devnet tests not rerun.
- Qualification extension prepared: commit exact signed bytes to PostgreSQL, drop the acknowledgement after actual upstream broadcast, SIGKILL the owned executor, restart it and verify the original transaction once; preserve conflicting-byte rejection and budgeted original oracle-sample fees. Then exercise the repaired actual HTTP endpoints and fresh database reconstruction. This test is not yet run and no result is claimed here.
- Both tables keep M7/P21A In progress, P20 Review, P21B Open, P15B/P16B external Open and 24-hour endurance Deferred. Blockers: none. Exact next action: pin this checkpoint and run `bash ops/group-indexer-smoke.sh`, then integrate the market-specific financial workers/direct SDK.


### R043 — 25 October 2026 — P21A pinned recovery and direct account SDK

- Starting checkpoint `ff34275e32c96c5baab7baf936fc00a5561bd5f6`, branch `phase/p21a-group-services`, preserves the original untracked design proposal. `bash ops/group-indexer-smoke.sh` passes on clean, unchanged ff34275 at `.local/group-indexer-rpc/20261025T142829Z-40215`; log `.local/p21a-execution-pinned.log`.
- Actual recovery: 215 fixture outcomes independently finalize, plus two original queued transactions. PostgreSQL reconstructs 104 group-related transactions / 83 events and outbox entries, zero unresolved jobs; 21 accounts/eight roots reconcile, vault and allocated cash both 2,003,200,020 atoms. A real owned executor is SIGKILLed after upstream broadcast while acknowledgement is dropped, then restarted; original wire/signature finalizes with exactly two deposited atoms, duplicate submission has no extra effect and conflicting bytes reject. Operator sampling charges exactly 5,000 lamports against its 5,000,000 cap, with zero pending fee reservation. Fixture fees are 1,850,000 lamports; queued wallet/sample fees are separately 5,000 each, excluding deployment. HTTP group/account/portfolio/trade reads, unhealthy 503, actual WS recovery and exact fresh PostgreSQL reconstruction pass. This is scoped infrastructure acceptance, not full A26A.
- Delivered next: shared immutable wallet transport preserving V1 message/signature checks; direct schema-2 group client with authenticated deployment hash, coherent bounded RPC snapshots, explicit owner accounts, deposits, market-bound orders/cancel, delegation, flat claim netting, owner transfers and paginated funded exits. Source-independent cancellation and flat-cohort exits retain clearing's checks. Each certificate page is a separate signed transaction; no writable member is combined with its read-only proof. Wallet compute declarations retain the measured 400k/600k/700k/1.2m envelopes.
- Scoped checks: seven direct SDK cases plus eight inherited shared-wallet cases pass (15); 64-root/64-portfolio mock checks explicitly test bounded RPC coherence, not new chain capacity acceptance. Typecheck initially caught a test-only readonly byte type; corrected. Final `pnpm typecheck`, `git diff --check`, and evidence-policy check pass. Logs `.local/p21a-direct-tests.log`, `.local/p21a-direct-typecheck.log`.
- Prepared fresh check `bash ops/group-indexer-smoke.sh --direct-sdk`: actual isolated/cross registration, cash deposit, orders/delegation, API shutdown, stale-source cancellation, flat-group proof/transfer/withdrawal, literal token/cash audit and fresh PostgreSQL replay. It has not run at this checkpoint; no result claimed.
- Not rerun: unchanged on-chain/IDL/SBF financial suites, broad V1 lifecycle, browser/load/devnet/endurance or external review. Financial worker decisions, route quoting/direct quote validation, artifact binding, interrupted resolution and full A26A remain required. No P21 PR exists; all predecessor PRs remain open/ready. Both tables keep M7/P21A In progress, P20 Review, P21B Open, external P15B/P16B Open and endurance Deferred. No blocker. Exact next action: pin this SDK checkpoint and run the scoped direct RPC check, then integrate financial workers.


R043 direct RPC acceptance: clean, unchanged `fed5f55f9d62fdd24d317935dec328975381c8c4`
passes `bash ops/group-indexer-smoke.sh --direct-sdk` at
`.local/group-direct-rpc/20261025T144212Z-44869` (log
`.local/p21a-direct-pinned.log`). All 147 fixture/provisioning outcomes and 20
SDK-signed wallet actions independently finalize. Actual API shutdown precedes
account creation, isolated/cross deposits, market-bound orders and delegate actions.
After 21 seconds without source publication, delegated cross and owner isolated
cancellation succeed; complete flat-group proofs, explicit 17-atom allocation and
two five-atom withdrawals succeed without the API. Literal cash outcomes are
49,978/50,012 atoms; token and vault deltas are exactly 99,990 atoms, venue fees zero.
Wallet network fees total 100,000 lamports, separately from fixture/deployment.
Maximum wallet packet is 719 bytes; maximum actual CU 111,563. Nine roots/22 accounts
reconcile; vault/allocated both 2,002,099,990 atoms; 28 actual WS notifications and
exact fresh PostgreSQL reconstruction pass. These are direct account/order/cash
checks, not route or default-worker acceptance.

### R044 — 25 October 2026 — P21A market-specific maker and funding workers

- Base: exact direct SDK checkpoint fed5f55, no unrelated files changed. Add actual V2 maker config/isolated capital/program-data authentication to the SDK; every dependency fetch repeats the group state. Code approval and synchronized quote epochs remain distinct. Add `GroupRuntime` maker heartbeats/owner-only publication and sync, plus independent BTC/ETH funding samplers through the existing immutable queue and separate fixed budgets. The standalone worker accepts only maker/funding roles and private local signer files; other financial workers are not exposed as stubs.
- Sampling deliberately continues through source/quote loss so clearing records restrictive oracle modes; it does not falsify freshness or require an off-chain heartbeat to validate prices. Maker workers cannot approve code, rotate group authority or move collateral. No fee/risk/oracle policy changes. Market owner keys may remain internal, explicitly not independent makers.
- Checks: four focused worker policy tests pass, including all four heartbeat/budget identities, wrong-owner rejection, exact publish+sync envelope, independent source-loss sampling and retained pending/unresolved attempts. Typecheck caught a test-only mock tuple type; corrected. Final typecheck/diff/evidence-policy checks pass; logs `.local/p21a-worker-tests.log`, `.local/p21a-worker-typecheck.log`. No unchanged SBF, full-body matrix, browser, devnet or endurance rerun.
- Fresh worker harness is prepared but not yet executed: six market-worker processes and one executor, actual maker SIGKILL/restart, source expiry, independent market stop, original fee/signature reconciliation and new PostgreSQL replay. Actual expired-epoch publication, funded-position funding previews, quoting/orders/settlement/risk/default recovery, explicit artifact binding and full A26A remain pending.
- Both status tables retain M7/P21A In progress; P20 Review, P21B Open; P15B/P16B external Open, endurance Deferred. No access/product blocker or P21 PR. Exact next action: pin this checkpoint and run `bash ops/group-indexer-smoke.sh --market-workers`, then implement quote and remaining financial worker decisions.


R044 pinned worker acceptance: clean, unchanged
`fbc70b9fbefb4f5c464dfa11d27140d55c0fefed` passes
`bash ops/group-indexer-smoke.sh --market-workers` at
`.local/group-workers-rpc/20261025T145537Z-49213` (log
`.local/p21a-workers-pinned.log`). All 115 fixture/provisioning outcomes finalize;
24 actual funding transactions independently match their original queued wire,
finalized result and fee. Six worker processes plus an executor maintain four
separate market-maker heartbeats, recover an actual maker SIGKILL (PID
49797 → 49819), record both sources becoming NoCredibleBounds, and continue ETH
observations after the BTC funding process stops and drains. BTC/ETH fees are
55,000/65,000 lamports; each four maker budgets spends zero in this live-epoch
check. All six budgets reconcile with zero reservations and no unresolved intents.
Margin account bytes remain unchanged by sampling. Seven roots/19 accounts,
vault/allocated 2,002,000,000 atoms, 24 WS observations and exact fresh PostgreSQL
replay pass. Expired maker epoch publication and nonzero-position pending funding
are still separate outstanding checks; no such evidence is inferred here.

### R045 — 25 October 2026 — P21A whole-account allocation and quote integration

- Base fbc70b9, preserving unrelated proposal. Reuse the same bounded A/B price search, fee prefix and stable tie-breaking with an explicit whole-account admission callback. Group candidates accrue both canonical funding prefixes, refresh both-market order/protection reserves, count funded cash once and give zero positive unpaid credit. Reductions below IM require strictly lower whole-account MM deficit after fees. Makers stay isolated; same-owner providers are excluded. Rust/program/IDL/fees/source bounds are unchanged.
- Add direct route/stored-order builders with group sequence, both observations, account nonce/generation, exact reviewed fee/all-in bounds and the measured route budget. GroupUserClient can obtain direct confirmed RPC quotes. Add a separate loopback execution API, classified quote refusal, immutable submission/status, and an order-discovery method that uses the durable group budget/queue. The order process is not yet exposed by the standalone worker; signed quote/order acceptance is the next check.
- Scoped checks: nine group financial/builder cases and the inherited independent 600-vector allocation comparator pass (10 Vitest checks); two quote-event/API tests pass, including actual generated snapshot fields/bump and malformed-request rejection. Literal vectors independently check split notional/fees, one cash balance, fractional opposite-market loss, no positive unpaid credit, pending ETH funding without root writes, reserve release after fill, post-fee deficit improvement, source relevance and common-owner exclusion. Typecheck caught a test-only branded PDA bump type; corrected. Current typecheck/diff/evidence checks pass; logs `.local/p21a-allocation-tests.log`, `.local/p21a-allocation-typecheck.log`, `.local/p21a-quote-tests.log`.
- These consumer tests are not new compiled-program acceptance. No financial SDK/core parity is claimed until actual signed routes/order fills pass. Unchanged broad SBF/IDL, V1 lifecycle, browser/load/devnet/endurance and external review were not rerun. Full settlement/default services, artifact binding, funded-position/source scenarios and full A26A remain pending. P21B remains Open and external gates/endurance are unchanged.
- Both tables keep M7/P21A In progress and P20 Review. No P21 PR or merge. No access/product blocker. Exact next action: pin this quote checkpoint, then exercise actual signed quote submission and stored-order fills against Surfpool/WS/PostgreSQL before continuing settlement/risk integration.


### R046 — 25 October 2026 — P21A signed quote/order qualification preparation

- Base: committed quote checkpoint `9093e88`. Enable the implemented group-wide order role in the standalone worker with an explicit payer and its separate fee budget; maker/funding roles retain required market identities. Add a scoped fresh trading-services driver, actual quote/submission HTTP API, independent direct RPC quote reconstruction, exact original wire/signature retention, two-market cross open/close and one durable order fill through a separate executor/order process. Expected cash/fee transitions use literal notional arithmetic and observed on-chain funding checkpoints, independently of the allocator/preview.
- Preparation checks: `pnpm typecheck` and `git diff --check` pass; `.local/p21a-trading-typecheck.log`. No new financial, process or signed-flow acceptance has run yet. Existing R043/R044 pinned checkpoints retain their exact scope; no inherited SBF/full-body suite repeated for this client/service harness.
- Both tables retain M7/P21A In progress; no new P21 PR. P20 remains Review; P21B and external gates remain Open, endurance Deferred. No blocker. Exact next action: pin the harness and run `bash ops/group-indexer-smoke.sh --trading-services`; retain and diagnose actual failures before proceeding to settlement/risk/default integration.


R046 first pinned attempt: `30e766f` at
`.local/group-trading-services-rpc/20261025T152003Z-56681` (log
`.local/p21a-trading-pinned.log`) completes fixture setup and starts four maker
processes/executor. The first wallet deposit independently finalizes, but the
harness then asserts a `wire` field on `Queue.get`, whose status interface
intentionally returns only identity/status/result. This is a harness accessor
error, not a failed deposit or passing route check. Fetch the persisted immutable
wire directly from PostgreSQL and compare it without dumping its bytes on failure.
No protocol/queue behavior changes. Preserve the failed attempt. Both status tables
retain P21A/M7 In progress. Exact next action: commit this focused harness correction
and rerun the still-unexercised signed trade/order continuation.


R046 second pinned attempt: `e9da206` reaches a finalized deposit and identical
HTTP/direct-SDK split economics (6,002,790 gross, 1,201 fee; 21/79 lots). The
comparison incorrectly included the RPC context slot, which legitimately advanced
from 1555 to 1557 between separate reads. Compare economic fields exactly and
require the direct read at or after the advisory context, without requiring the
contexts to be equal. No financial tolerance or runtime behavior changes. The
failed local log is `.local/p21a-trading-pinned-2.log`; no signed route acceptance
is claimed. Both tables remain In progress. Exact next action: pin this harness
correction and run the still-unexercised signed trading/order continuation.


R046 signed trading acceptance: clean, unchanged
`345ddc5f25ac509261b4db90b2c24eaca9ebbcb6` passes
`bash ops/group-indexer-smoke.sh --trading-services` at
`.local/group-trading-services-rpc/20261025T152946Z-59496` (log
`.local/p21a-trading-pinned-3.log`). All 179 fixture/provisioning outcomes finalize.
Seven original wallet transactions and one actual order-worker fill finalize with
identical persisted/fetched wire. HTTP advisory and independent RPC-built quotes
match economics; two-market cross open/close and a stored one-lot BTC order pass.
Six independent fill transitions check cash fees, both funding checkpoint deltas,
lots and virtual claims; final cash 997,453 atoms, fees 2,547, zero exposure/reserve.
Wallet network fees are 35,000 lamports; order budget spends 5,000 with zero
reservations. Seven roots/19 accounts, vault/allocated 2,003,000,000 atoms, 24 WS
notifications and exact fresh PostgreSQL replay reconcile. This qualifies signed
quote/order integration only, not full A26A or oracle-premium derivation.

### R047 — 25 October 2026 — P21A ordinary group settlement worker

- Add the explicit group-wide settlement role using its own durable fee budget. Candidates apply both funding prefixes, preserve fractional claim ownership, bound losses by actual funded cash and gains by P, and enforce full post-gain IM/reservations. No implicit owner closed-claim netting. Complete canonical read-only proof pages stay separate from cash changes; actual simulation and clearing remain authoritative. Confirmed snapshots prepare unsigned actions; original effects and fee reservations still await finality.
- Seven focused checks pass for exact whole-atom/fraction/cash/pool arithmetic, pending other-market funding, zero positive unpaid credit, refreshed reservations, stale selected-price relevance, exact proof cursor/identity and retained ambiguous intents. Typecheck initially caught a harness-only generic row inference; corrected before pinning. No Rust/IDL/economic/source changes or unrelated full regression.
- Prepare a fresh mixed isolated/cross funding and settlement driver with actual source expiry, original-intent worker kill/restart, independent raw account/pool/fraction checks and new PostgreSQL replay. Preparation is not signed settlement acceptance. Continuous funding/trading may invalidate a global certificate; no sampler pause, cadence relaxation or availability guarantee is introduced. Busy-group certificate progress/limits remain for the bounded workload.
- Both tables retain M7/P21A In progress, P20 Review; P21B/external gates Open and endurance Deferred. No P21 PR or access/product blocker. Exact next action: pin this worker and run `bash ops/group-indexer-smoke.sh --settlement-services`, then implement risk/default service coordination and finish remaining A26A acceptance.


R047 pinned settlement acceptance: clean, unchanged
`4fe5ed66a4459e59de2b7f6cde8e83a6435b2c98` passes
`bash ops/group-indexer-smoke.sh --settlement-services` at
`.local/group-settlement-services-rpc/20261025T154000Z-63051` (log
`.local/p21a-settlement-pinned.log`). All 166 fixture/provisioning outcomes finalize;
12 original settlement/proof transactions finalize and match stored wire, spending
60,000 lamports with no retained reservation. A real settlement SIGKILL/restart
(PID 63677 → 63685) preserves its pre-broadcast intent. Cross BTC/ETH funding
previews independently match 12,500,000/10,763,860 scaled pending debits without
root writes. Mixed isolated/cross actual positions close, 21 seconds without source
publication produce NoCredibleBounds, and existing flat-cohort settlement completes
with per-root fractions/entitlements preserved. P ends at zero; venue fees remain
483 atoms, vault/allocated 2,003,000,000. Maximum observed maintenance transaction
is 88,378 CU / 674 bytes; seven roots/19 accounts, 21 WS observations and exact new
PostgreSQL reconstruction pass. This does not establish busy-group certification,
maximum-cohort risk/default services, source-premium derivation or full A26A.

### R048 — 25 October 2026 — P21A risk/default service preparation

- Add an explicit funded receiver account and group-wide risk budget. Bounded rotating bankruptcy simulations reread authenticated sources on chain even during a pause/stale cached observation; negative adverse risk is never substituted for economic net bankruptcy. Flat net-positive roots need no price probe. Liquidation uses the index reference, at most 64 lots with bounded halving, and actual simulation of strict whole-account post-fee progress/receiver admission. Transport/budget/ambiguous-intent errors do not select replacement actions. No emergency freeze, automatic resume or cross reactivation authority is delegated to the worker.
- Frozen work follows the exact epoch/stage/cursor and next 1–4 complete-registry members; only collection/apply pages make roots writable. Permissionless valuation/recovery checks are distinct from explicit authority resume; completed recovery has the existing eight-paid-check ceiling. The one-second local risk loop bounds discovery to two default probes and one target's bounded liquidation search per iteration.
- Correct settlement proof expiry metadata: checking a guard does not increment group sequence, so that stamp cannot prove proof-page nonexecution when history is missing. Proof intents now carry no such expiry authority and keep unknown history/fee reservations. No signed financial bytes or successful R047 outcome changes; a dedicated regression covers this distinction.
- Checks: 16 focused risk/settlement tests pass; typecheck catches then resolves the generated event-account type and fixture discriminator omissions. Prepare the actual 64-member/60-portfolio RPC/WS/PostgreSQL driver, receiver liquidation, current-source paused-group default, killed worker/indexer reconstruction, exact independent raw-byte waterfall/fraction audit, scoped resource checks and owner maker renewal. The driver explicitly selects a 2,400-slot initial maker epoch; existing fixture callers retain 3,600 and daemon renewals remain 3,600. Signed risk-service acceptance has not run yet. No unchanged SBF/IDL/full-body matrix/browser/devnet/endurance rerun.
- Both tables retain M7/P21A In progress, P20 Review, P21B/external gates Open and endurance Deferred. No P21 PR or access/product blocker. Exact next action: pin this checkpoint and run `bash ops/group-indexer-smoke.sh --risk-services`; record actual failures/results, then finish missing-price recovery, artifact binding and the remaining A26A checks.


R048 first pinned attempt: clean `f41cfff` at
`.local/group-risk-services-rpc/20261025T155808Z-68596` (log
`.local/p21a-risk-pinned.log`) completes actual 64-lot receiver liquidation, its
both-market close continuation and 64-member/60-portfolio initialization. It stops
at the bounded maker-renewal wait: publication and clearing sync in one transaction
fail at instruction 2 with MakerBinding (`0x17de`). The retained Surfpool/executor
logs show each maker reaches the existing 16-attempt ceiling. Source inspection
identifies transaction-wide writable promotion of config against clearing's
explicit read-only `config_state` contract. No default pages or full financial
audit/replay pass is claimed. A later direct RPC diagnostic was unavailable because
the owned validator had already shut down; do not invent fetched failure metadata.

Split the two immutable intents, retaining original publication finality before
owner sync and no publication nonexecution inference from registration epoch.
The intermediate maker remains unavailable. Keep financial/program safeguards
unchanged. Update the focused worker regression and retain original failed-run
transaction metadata before cleanup on future risk harness failures. Both tables
remain In progress. Exact next action: verify and pin the service correction, then
rerun the still-unexercised renewal/default/restart continuation.

R048 correction verification: four focused market-worker checks pass, including
separate publish/sync wires, read-only clearing config and null publication expiry
authority. Typecheck, diff and evidence-policy checks pass. Logs remain local at
`.local/p21a-maker-renewal-tests.log` and `.local/p21a-maker-renewal-typecheck.log`.
No unrelated regression was repeated. Signed correction/default acceptance remains
the next pinned run; no P21 PR or phase completion is claimed.


R048 pinned risk acceptance: clean, unchanged
`2767cdd172366b51c0450ab012820432b751c606` passes
`bash ops/group-indexer-smoke.sh --risk-services` at
`.local/group-risk-services-rpc/20261025T160635Z-71689` (log
`.local/p21a-risk-pinned-2.log`). All 459 fixture/provisioning outcomes finalize;
173 original service transactions independently match stored/fetched wire and
finalized success: four publications plus four separate owner syncs, one funded
64-lot liquidation, one authenticated paused-group freeze, 160 complete-registry
resolution pages and three permissionless recovery checks. Explicit authority
resume returns to isolated mode, without automatic cross activation.

An actual risk SIGKILL after collection begins (PID 72837 → 73100, observed stage
3/cursor 4), original-intent drain, indexer close/reopen and exact partial-state
reconstruction pass. The maximum cohort has 64 roots and 60 distinct portfolios;
134-account reconciliation uses actual RPC chunks of 100 and 35 (repeated group),
318 WS observations and exact fresh PostgreSQL replay. Actual/allocated vault is
2,004,000,007 atoms, with zero surplus. Each maker spends 10,000 lamports; risk
spends 825,000, all reservations zero. Overall largest transaction is 272,934 CU
(maximum default page) / 708 bytes (freeze). The 64-lot liquidation uses 74,365 CU,
493 bytes and transfers exactly 1,664 funded fee atoms, with strict whole-account
post-fee progress and both-market receiver accrual.

The independent raw-byte audit and six deliberate corruptions pass: 1,097,771
atoms collected, 1,007 insurance, 1,098,778 paid, 548117504344380 scaled impairment,
zero aggregate terminal rounding. Every final root/claim/pool/fee and unchanged
sibling is checked; prior reference code is exercised against this new run, not
counted as historical evidence. Missing-price AwaitValuation service recovery,
explicit artifact identity and final A26A coverage remain separate; no P21B,
endurance, devnet/funded or independent-review acceptance follows.

### R049 — 25 October 2026 — P21A deployment binding preparation

- Prepare the exact P20-qualified clearing/A/B/source artifact set (binary hashes and lengths, loader/PDA, zero padding and local deployment authority), then connect its verifier to live SDK environment checks, indexer initialization/reconciliation and execution. The journal records the artifact set; older unbound service journals require a fresh explicit replay. No V1 migration, binary rebuild, source/risk change or deployment occurs.
- Develop this independent gate in an isolated local worktree while R048's pinned source remains unchanged; apply it only after R048 finishes. Eight artifact-boundary cases plus seven affected direct-client checks pass (15 total), covering bad code/authority/pointer/padding, same-slot and unfinalized upgrades, finality regression and cached header rechecks. Full binary caching requires a finalized context strictly later than deployment, matching header/authority/allocated size and a current context at least as new; same-slot/unfinalized code is rehashed. Worktree typecheck passes. These are preparation/consumer checks, not actual artifact-bound RPC acceptance.
- Both tables keep M7/P21A In progress; P20 Review, P21B/external gates Open and endurance Deferred. No P21 PR or access/product blocker. Exact next action: implement the focused real artifact-binding/AwaitValuation recovery continuation, pin and run it, then audit A26A acceptance coverage before publication.

R049 continuation preparation: add `--recovery-services` for a fresh seven-root
actual AwaitValuation refusal/restart, both-source restoration, permissionless
pages/recovery and owner SDK withdrawals with the read API stopped. The harness
also measures actual cold/warm artifact reads and rejects wrong authority/hash
against RPC. These signed checks have not run yet. Typecheck, diff and evidence
policy pass. Generalize the independent default auditor's explicit count/price
inputs while preserving its 64-member defaults; replaying R048's retained bytes
still passes its financial audit and six corruptions (auditor regression only).
No SBF/IDL, broad matrix, browser, devnet or endurance rerun is needed. Pin this
checkpoint, then run the focused recovery command; no phase/PR completion claim.

R049 first pinned attempt: clean `32940f9` at
`.local/group-recovery-services-rpc/20261025T163334Z-79662` (log
`.local/p21a-recovery-pinned.log`) verifies actual artifact hashes/authority,
wrong-authority/hash rejection, one cold eight-header plus four-code read and
one warm eight-header-only read. Actual emergency freeze reaches AwaitValuation
after ETH source grace. The harness then reads the worker log before the stream
creates it (ENOENT); no worker recovery/default/exit pass is claimed. Create the
owned log synchronously before polling it. No service/program/risk change. Both
tables retain In progress; exact next action is pin this harness correction and
rerun the still-unexercised recovery continuation.

R049 second pinned continuation: clean, unchanged
`882f8328532309076d46468918d57e4f88d9d9ba` at
`.local/group-recovery-services-rpc/20261025T163703Z-80883` (log
`.local/p21a-recovery-pinned-2.log`) completes all real financial/service checks:
176 fixture outcomes, 25 original risk transactions (one valuation, 20 pages, four
completed recovery checks), four original SDK proof/withdrawal transactions,
AwaitValuation SIGKILL/restart (81589 → 81600), unchanged partial-price frozen state,
actual stopped API, stale post-resolution exits, 31 WS observations and exact fresh
PostgreSQL replay. Both prices pin atomically; worker never resumes, and explicit
authority returns mode 1. Artifact cold reads are eight headers then four binaries;
warm checks read only eight headers. Wrong authority/hash fail against actual RPC.

The command exits at its final independent auditor: its mode assertion reads
offset 205 (terms epoch), rather than layout offset 229. The generated decoder
and live transaction assertion already verify mode 1; fix the independent raw
offset, add a deliberate mode-byte corruption, and require the complete exact
resolution row count. The corrected auditor passes all retained fresh captures
and six corruptions: 222 atoms collected/paid, no insurance or impairment, zero
rounding, two atoms withdrawn, ending funded cash 2,002,999,906 and vault
2,002,999,998. Risk fees are 125,000 lamports, wallet fees 20,000, zero reservations;
maximum service transaction 226,821 CU / 659 bytes, wallet 88,362 CU / 686 bytes.
The unchanged R048 64-member auditor also passes with its six corruptions. These
are auditor corrections/rechecks, not another live run or an unqualified claim
that the original command exited successfully. No runtime needs redeployment.
Exact next action: pin the auditor correction, rerun only these independent byte
audits, then close A26A coverage and publish P21A ready above #29.

R049 A26A closeout: clean `ac828f67d76cc35861cb95af903d778bcfc1b3fd` passes
both independent raw-byte commands above, with six corruptions rejected each.
The new [P21A report](evidence/P21A.md) maps every A26A acceptance item to its
actual pinned execution, direct SDK, worker, settlement, risk and recovery evidence.
Final changes are auditor/docs only; prior scoped TypeScript tests/typecheck and
real runtime checks retain their stated scope. Unchanged Rust/SBF/IDL, unrelated
V1 matrix/browser/devnet/endurance were not rerun; broad client regression remains
the hosted scoped workflow, not claimed as already run. No raw capture is tracked.
Both tables move P21A to Review; M7 remains In progress, P21B Open, external gates
Open and endurance Deferred. No access/product blocker. Exact next action: publish
the ready P21A PR above #29, then create its P21B child without waiting for merge.

R049 publication: `gh stack submit --auto --open` publishes ready, non-draft
[PR #30](https://github.com/arnabnandikgp/rivalt/pull/30) at `286d0835b49afd60e97d85692b25a26a634dc0c2`,
base `phase/p20-cross-safety`. Stack #25 contains seven open PRs; nothing merged.
Title/body now reflect final A26A scope and evidence. Both status tables retain
P21A Review/M7 In progress. CI outcome is not yet claimed. Exact next action:
create P21B above this verified parent and implement the account-aware wallet UI.

### R050 — 25 October 2026 — P21B account-aware wallet UI preparation

- Start `phase/p21b-group-ui` with `gh stack add` above exact P21A `a3a9807`.
  [PR #30 CI](https://github.com/arnabnandikgp/rivalt/actions/runs/40213178236)
  reports scope/client/financial/shell SUCCESS, report SKIPPED, CodeRabbit pending.
  The seven predecessor PRs stay open; no merge or external review approval claimed.
- Add a version-2 trader view for portfolio zero, immutable isolated/cross selection,
  explicit funded allocation, two-position cash/claims/funding/reservation views,
  direct exits/cancellation, durable limits/stops/TP-SL, owner delegate controls,
  recent actual fills and saved original-signature recovery. Separate UI sections,
  action preparation and wallet transport keep the source navigable. Wallet/account/
  market changes invalidate unsigned reviews and prompt-time scope mismatches.
- Authenticate owned classic token accounts and empty portfolio PDAs in the SDK;
  a registry-only view cannot discover a portfolio before its first root. Add
  bounded latest finalized history without changing existing cursor ordering.
  [P21B contract](P21B-QUALIFICATION.md) records boundaries and pending acceptance.
- Actual checks: 13 focused cases pass (two exact unit/account-selection, two API
  history/health, nine affected direct SDK including token/empty-portfolio identity).
  Typecheck first catches an untyped state callback, then passes; browser build
  passes after source organization. Logs `.local/p21b-ui-focused.log`,
  `.local/p21b-ui-typecheck-3.log`, `.local/p21b-ui-build-2.log`; 715.60 kB JS /
  207.07 kB gzip with Vite's existing >500 kB warning, not a latency benchmark.
- Prepare actual Chrome/Wallet Standard/RPC/WS/PostgreSQL lifecycle and immutable
  service-ingress driver, including API-stopped stale exits and fresh database
  replay. It has not run yet. No unchanged SBF/IDL or unrelated broad matrix,
  devnet, endurance or external gate repeated. Both tables keep M7 In progress,
  P21A Review, P21B In progress, external gates Open/endurance Deferred. No access
  or product blocker. Exact next action: pin this checkpoint and run the scoped
  browser command, fix observed failures, then implement the bounded workload.

R050 first pinned browser attempt: clean `d514d1d` at
`.local/group-browser-rpc/20261025T170527Z-91287` (log
`.local/p21b-browser-pinned.log`) finalizes actual portfolio creation, cross account
registration and 1,000,000-atom deposit through the instrumented Wallet Standard
provider; each original is independently fetched and compared. Rejecting the next
wallet prompt creates no signed transaction. The unsigned wallet-switch review
clears, then exact-label account selection times out: the wrapping select label
includes option text rather than a stable control name. No JavaScript page error
or financial failure; screenshot and failure capture remain local. Add explicit
accessible names to the shared group fields. No on-chain/risk change. Both tables
retain P21B In progress. Exact next action: pin this UI correction, rebuild only
the affected browser bundle and rerun the still-unexercised lifecycle continuation.

R050 continuation adds the independent raw-byte browser auditor before the next
pin: literal six-fill venue-fee/cash expectations, explicit seven-atom allocation,
two-atom token exit, complete account/claim/pool conservation and six corruptions.
This auditor has not yet received a completed browser capture; no pass is claimed.
It checks browser cash/fees/tokens, not the future workload's per-fill contention.

R050 second pinned browser attempt: clean `56d1f59` at
`.local/group-browser-rpc/20261025T170924Z-92642`, log
`.local/p21b-browser-pinned-2.log`, finalizes 16 independently fetched wallet
originals: creation, both account registrations/deposits, six actual fills,
TP/SL placement/cancellation and complete-group pages followed by seven-atom
allocation. Eight named checks pass; zero page errors. The next unsigned order
simulation rejects `OrderTerms` (6126): UI supplied the closed position generation
for a non-reduce order, and the harness left ETH selected with a BTC trigger value.
No malformed transaction was signed or broadcast. Correct ordinary generation,
market-unit limit/trigger validation, reduction/replacement invariants and prefill;
explicitly select BTC and add actual replacement to the browser continuation.
Five focused model tests and typecheck pass (`.local/p21b-order-model.log`,
`.local/p21b-order-typecheck.log`). No unchanged on-chain/IDL or broad regression
rerun. D54/contract and both tables updated; P21B/M7 remain In progress. No access
or product blocker. Exact next action: commit this correction, rebuild the affected
bundle, rerun `bash ops/group-indexer-smoke.sh --browser`, then implement the
separate 300-second workload. No browser or A26B completion claimed yet.

R050 final browser authority: `bash ops/group-indexer-smoke.sh --browser` PASS on
clean `a0ed6deab9e2a1c8b20e9d4b674ebb5dfa655576`, run
`.local/group-browser-rpc/20261025T171941Z-95651`, log
`.local/p21b-browser-pinned-3.log`. Twelve checks and 25 actual wallet originals
include both modes, six fills, protected cancellation, post-close ordinary order
and replacement, allocation, unsigned stale refusal, API-stopped stale cancellation
and two one-atom exits. Every original is fetched and byte-compared; reload retains
all receipts, no page errors, 101 actual WS observations. Fresh PostgreSQL matches
sequence 138 / 22 reconciled accounts / nine members; vault and allocated collateral
2,003,999,998 atoms. Independent raw audit and six adverse mutations pass: cross
cash 999,810, isolated ETH 999,945, venue fees 243, user tokens 8,000,002; wallet
network fees 125,000 lamports. Maximum wallet packet 769 bytes / 238,919 CU.
Desktop capture inspected; mobile has no horizontal overflow, but its full-page
capture repeats viewport tiles and is not claimed as visual acceptance. Real
wallet behavior is the internal Wallet Standard fixture, not Phantom/devnet parity.
No unchanged program/IDL/broad regression repeated. Both tables keep P21B/M7 In
progress pending the independent concurrent workload.

### R051 — 25 October 2026 — P21B bounded workload preparation

Prepare a distinct 300-second/150-offer qualification driver on the unchanged
qualified binaries: equal 1,000,000-atom cross versus combined isolated capital,
real unsigned capital probes, absolute two-second offers, concurrent samplers and
four maker processes, source outage, original accepted-send acknowledgement loss
and executor kill/restart, maker/funding/indexer kills and fresh replay. Record
all offer/refusal/failure populations, separate drain and busy/quiescent exits,
network budgets, packet/CU and actual p95/p99; no risk/oracle limits change.
Independent Python financial replay enumerates maker ticks and recalculates fees,
whole-account funding realization, generations, cash and retained fractions against
raw initial/final accounts and tokens. No generated economics is used as expected
math. The auditor has not run on a workload capture yet.

Two denominator/quantile regressions and scoped TypeScript typecheck pass
(`.local/p21b-workload-metrics.log`, `.local/p21b-workload-typecheck.log`). The actual
workload remains unrun at this preparation checkpoint; no endurance, successor
external/devnet/funded or review claim. Both tables retain P21B/M7 In progress,
P15B/P16B Open and 24-hour Deferred. No access/product blocker. Exact next action:
pin this preparation and run `bash ops/group-indexer-smoke.sh --workload`, investigate
actual failures, then qualify the pinned correction and publish the ready child PR.

R051 first pinned workload: `26ac8b7`,
`.local/group-workload-rpc/20261025T173016Z-98844`, log
`.local/p21b-workload-pinned.log`. All 150 scheduled offers complete over 300 seconds:
101 quotes, 100 prepared/submitted originals, 94 finalized fills, six on-chain
rejections; 48 quote refusals and two preparation refusals. Codes: required-market
source unavailable 27, observation-update pending 20, maker-capacity/health one,
snapshot changed one, simulation 6108 one, chain 6108 six. Retained chain logs bind
6108 to `group_margin/mod.rs:21`'s group-sequence guard; this is contention, not an
activation change. Successful-offer latency p95 2,613 ms / p99 3,232 ms (94 samples).
Five additional drain attempts produce four fills/one guarded race and flatten all
participants. These are partial-run measurements, not completed A26B acceptance.

Actual ETH publisher outage/recovery, accepted-send acknowledgement loss and executor
SIGKILL/restart, maker/funding/indexer kills/restarts execute; zero source publication
errors. Final exits fail before queue admission: the harness sent signed certification
pages to the trade-only ingress (HTTP 400), instead of the established direct SDK RPC
path. It makes no token-withdrawal, final replay or independent-audit claim. Correct
the harness, retain direct originals before broadcast, reconcile lost acknowledgements
and abort rather than replace any unresolved direct signature. No service authority
or program/risk guard changes. The full bounded checkpoint must rerun because this
attempt ended before final capture/reconciliation.

A separate read-only live mobile check uses a 390×844 initial viewport and two paint
frames, sends zero signatures and shows a single 5,084-pixel page with no horizontal
overflow. `.local/p21b-mobile-{viewport,balances,full}.png` inspected; the earlier
post-resize tiled capture was not representative of this actual layout. This extra
read client ran at UTC milliseconds 1792949571175–1792949572561 during the first
workload; its partial metrics are not a controlled UI performance benchmark.

That check exposes numeric history sorted by the textual SELECT alias (`97` above
`180`). Qualify `events.sequence` in ORDER BY; actual PostgreSQL 18.6 endpoint
regression now returns latest `101,999,1000,1001` and cursor `10,99,100`.
`.local/p21b-history-postgres.log`, four affected API/metric tests and typecheck pass.
D54/contract updated; no unchanged Rust/SBF/IDL, broad matrix, external or devnet work.
Both tables retain P21B/M7 In progress. Exact next action: pin the corrections and
rerun only `bash ops/group-indexer-smoke.sh --workload` through final independent
accounting and replay, then prepare the ready stacked PR.

R051 corrected runtime checkpoint: clean `6e9fd2f1549b447abd9d93f0a68ae050d83fa506`,
`.local/group-workload-rpc/20261025T174005Z-2208`, log
`.local/p21b-workload-pinned-2.log`. All 150 scheduled offers complete: 108 advisory
quotes, 107 submissions, 101 fills, six signed group-sequence races; 24 required-
market source/coverage refusals, 15 pending-observation refusals and four changed-
snapshot preparation refusals. Offered 101/150, submitted 101/107; successful-offer
p95/p99 2,594/2,695 ms (101 samples). Three additional drain fills flatten all
inventory. Actual fault/restart evidence and all 383 queued originals reconcile
with zero unresolved intents/reservations. Funding budgets spend 670,000/655,000
lamports; four maker budgets spend 10,000 each; all wallet originals total 640,000.

Twelve proof transactions finalize during continuous samplers, but **0/3 busy
exits** reach a withdrawal before certificate invalidation. Explicitly quiescing
publication/maker/funding workers after flat drain yields three proof/withdrawal
pairs and three actual token atoms. This is a measured availability limit, not an
always-live exit or complete-capital-redemption claim. Combining proof and cash
mutation would violate the deliberate read-only member contract; guards are not
weakened. The operations guide requires a disclosed maintenance window for this
bounded profile. Future live exit availability needs separately scoped acceptance.

Runtime then passes actual numeric HTTP history, 387 WS observations, 19-account /
seven-member reconciliation at sequence 430 and exact fresh PostgreSQL replay.
It writes the complete raw checkpoint before the Python auditor rejects the export's
lexicographic row order. Fix that export query and canonicalize audit inputs by
integer sequence, still rejecting omissions/duplicates. The original capture is
unchanged. Corrected standalone audit passes 104 actual fills and eight corruptions:
fee 4,612 atoms, funded cash 2,001,995,385, P/I zero, actual/allocated vault
2,001,999,997, three-atom token exit and retained fractions. Command exit 1 is retained;
no full-command PASS or extra financial rerun is invented.

A separate unsigned live SDK probe at UTC milliseconds 1792950282695–1792950289602
accepts 8/8 confirmed versus 7/8 finalized preparations; the final finalized preview
rejects the stale group sequence (6122). No signatures/broadcasts. Use confirmed
state for unsigned UI preparation and keep displayed balances finalized. Typecheck
and affected build pass (`.local/p21b-final-typecheck.log`,
`.local/p21b-final-ui-build.log`); corrected audit log
`.local/p21b-workload-audit-corrected.log`. The probe adds read/simulation traffic
in the recorded workload; this is not an isolated UI benchmark. Disk headroom fell
below 1 GB; remove only 265 MB of reproducible Rust incremental cache, preserving
all raw evidence and pinned binaries. No unchanged program or broad suite rerun.

[P21B evidence](evidence/P21B.md) maps the measured checks, limitations and prior
failures; D54 and the runbook retain external/deferred gates. Both tables remain
In progress until the corrected independent auditor is checked on a clean pin.
Exact next action: commit this correction/report, run the standalone auditor on the
retained capture, then publish P21B ready above #30 and keep every successor PR open.

R051 clean audit authority: `813ee20` has no tracked changes. Running
`python3 tests/financial/group-workload-reference.py .local/group-workload-rpc/20261025T174005Z-2208`
passes the retained runtime capture and all eight adverse mutations; output is
`independent-audit-corrected.json` in that same ignored directory. No evidence
file was added to Git and no runtime result was relabelled. The runtime checkpoint
remains `6e9fd2f`; UI browser is `a0ed6de`; scoped confirmed-preview probe/typecheck/
build and report corrections retain their separate attribution. Both status tables
move P21B and M7 to Review, with every predecessor exact commit included. No merge,
funded readiness or always-live exit is claimed. No access/product blocker. Exact
next action: publish ready P21B above #30, verify its base/draft state and CI status,
and keep the stack open as instructed.

R051 publication: `gh stack submit --auto --open` creates ready, non-draft
[PR #31](https://github.com/arnabnandikgp/rivalt/pull/31) at
`b5c98139e79fde56a911d8583cd472b0d9a59865`, base `phase/p21a-group-services`.
Stack #25 contains eight OPEN successor PRs; none merged. Title/body describe the
final qualification and explicit busy-exit limit. Initial hosted
[run 40218864000](https://github.com/arnabnandikgp/rivalt/actions/runs/40218864000)
has scope SUCCESS and client/report/financial/shell IN_PROGRESS; CodeRabbit status
SUCCESS is not independent review approval. Both tables retain P21B/M7 Review.
No additional local test was needed for publication/documentation. Exact next action:
inspect scoped CI/review findings and fix actionable issues while keeping the stack
open; no external/funded/24-hour action is authorized.


### R052 — 25 October 2026 — successor stack review recovery

- Review sweep: #23/#24/#27/#28/#31 have no unresolved threads; #26 has two minor notes, #29 one provenance note, #30 two actionable availability findings plus stale acceptance wording. PR #31 at `e47a759` passes all five hosted checks in run `40218988634`. No merge or independent review approval is claimed.
- Add bounded finalized-tail catch-up after authenticated forward sequence movement; unchanged history is not fetched again and no unreconciled cursor advances. New funding originals use their canonical market observation stamp, preserving original bytes and unknown fee reserves after expiry. Update stale P21A acceptance text, explicit P20 promotion hash and the exact qualified-image compute boundary. Existing originals retain their authority; no program/risk/oracle/fee change.
- Preparation: 15 scoped scanner/authority/worker regressions pass. Initial mock health callback lacked a Promise; corrected test harness before acceptance. Typecheck initially found an overly narrow address literal in the new test, then passes after correction. Logs: `.local/r052-focused-tests.log`, `.local/r052-typecheck.log`. Prepare the real RPC/WS/PostgreSQL review driver; it has not run yet.
- Both tables retain successor Review pending review remediation/integration; P21B's existing evidence remains on its child branch. P15B/P16B Open, endurance Deferred. No credentials/product blocker. No unchanged Rust/SBF/IDL, broad V1 matrix, browser/workload/devnet or endurance rerun: this changes service recovery only; scoped hosted CI handles broad client regressions.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.


R052 pinned acceptance: clean, unchanged `e4a284c4f519cba64e86ef31f9dfcd1f6385cadf`
passes the focused real command (exit 0) at
`.local/group-review-recovery-rpc/20261025T181318Z-11563`; log
`.local/r052-review-rpc.log`. One actual finalized deposit races reconciliation;
one tail extension commits its seven atoms only after complete reconciliation.
Unrelated ETH progress advances group sequence 44→45 with BTC observation 9
unchanged; real original blockhash expiry proves economic nonexecution. The new
immutable retry finalizes (BTC observation 10/group sequence 46), exact fetched
wire and 5,000-lamport fee. Its original keeps the 20,000-lamport unknown-fee
reservation. Zero pending/unresolved economic intents; three WS observations,
seven roots/19 accounts, independent raw cash/token/pool/sibling checks and exact
fresh PostgreSQL replay pass. Vault/allocated cash is 2,002,000,007. Full mapping
is in [P21A evidence](evidence/P21A.md). Both tables retain Review, external gates
Open and endurance Deferred. No program or risk changes; no inherited broad
suite rerun. Exact next action: publish this evidence, restack #31 and respond to
resolved/superseded review findings while leaving every successor PR open.


R052 local restack: `gh stack rebase --upstack --no-trunk` includes parent
`61bbfba` in P21B (`e78ec34` before this log). Resolve only overlapping decision,
worklog and launcher edits; retain complete R050/R051 histories and all three
review/browser/workload entrypoints. Comparing with prior P21B `e47a759` shows
only the intended parent recovery/docs/test additions, with UI/workload sources
unchanged. Hosted publication/checks for the new heads are still pending; prior
`e47a759` scoped CI run `40218988634` passed all five jobs. No phase is merged.


R052 publication/review: `gh stack submit --auto --open` publishes #30 `61bbfba`
and restacked #31 `7c4e07a`, both OPEN/non-draft with correct bases. Six original
threads are answered/resolved: two service fixes, stale/current documentation and
the qualified-artifact compute boundary. Hosted runs `40220571676` (parent:
scope/client/financial/shell pass, report intentionally skipped) and `40220571936`
(child: all five pass) complete successfully. Original P21B UI/workload sources
are unchanged by the restack; post-conflict typecheck/shell/evidence policy pass.

The final sweep finds a newly arrived seventh thread on #31: writing the saved
receipt ref during render can overwrite a newer synchronous signing write during
React preemption. Remove render-time assignment, centralize explicit receipt
writes, and update both ref and presentation on reload/clear. Prepare a real
React/Chrome scheduling regression with a suspended transition and higher-priority
render; deliberately restoring the old assignment must reproduce loss, while the
fix preserves original bytes through delayed polling and reload. This is a client
state test with labelled receipt-shaped fixtures, no signed/RPC financial evidence.
Both tables remain Review; receipt test/build/publication pending. No unchanged
SBF/program, workload, full browser financial or devnet/endurance rerun is needed.
Exact next action: pin and run `node --import tsx tests/browser/receipts.ts`, then
publish the verified correction and update the seventh review thread.


R052 receipt acceptance: clean `c0e5274` passes
`node --import tsx tests/browser/receipts.ts` (exit 0). Real React/Chrome deliberately
restoring the old assignment loses the newly saved original (one receipt remains);
the fixed hook preserves both, merges the prior finality result without altering
the new immutable bytes, and clears/reloads both memory and presentation correctly.
Zero browser errors; `.local/r052-receipts-browser.log`. Two existing focused
receipt merge/retention unit tests, typecheck and trader production build pass;
logs `.local/r052-receipts-{unit,typecheck,build}.log`. Bundle is 717.24 kB /
207.71 kB gzip with the retained >500 kB warning. This is client-state evidence,
not new financial/RPC acceptance. No full wallet/workload/SBF suite repeated.
Both tables retain Review; external gates remain Open and endurance Deferred.
Exact next action: publish this correction and address the new thread, then inspect
scoped CI/reviews while leaving the eight-PR stack open.


R052 final review checkpoint: #31 receipt correction/evidence is published at
`e264f0e57a17754e67c11cbaf3f93c83b59daa91`. Its scoped hosted
[run 40221182595](https://github.com/arnabnandikgp/rivalt/actions/runs/40221182595)
passes scope/client/report/financial/shell. Parent #30 `61bbfba` retains its
successful run `40220571676`. Seven review threads are answered/resolved; the
latest complete sweep reports zero unresolved threads on all eight PRs, all OPEN,
non-draft, with correct adjacent bases. No independent review approval or merge
is inferred from those checks. PR descriptions now describe the final recovery
and receipt behavior and retain the measured busy-exit limitation.

This final change is documentation only. All raw evidence remains local/ignored;
the user's original proposal remains untouched/untracked. Both milestone and
phase tables keep M7/P17–P21B Review, pending requested open-stack review/integration.
P15B/P16B remain Open, endurance Deferred, no funded/devnet successor deployment.
No remaining access/product blocker for the completed bounded engineering scope.
Exact next action: inspect newly posted review findings before any integration,
keeping this stack open; do not start the separate external gates without their
required participants/authorization.


### R053 — 26 October 2026 — authorized successor stack integration

- The user explicitly authorizes reviewing and merging the whole open successor stack and defers the withdrawal redesign. D55 supersedes the prior keep-open instruction only for #23/#24/#26/#27/#28/#29/#30/#31; it does not authorize external/funded work or a new economic implementation.
- Fresh `gh pr list`/GraphQL sweep covers all eight open PRs, every review thread, general reviews/comments, draft/base/head/mergeability and check status. Zero unresolved threads, no requested changes, all non-draft and CLEAN/MERGEABLE; the seven R052 findings remain resolved and no new actionable finding needs a code change. Selected checks pass on every head; untouched scopes are explicitly skipped. Final tip `1a3cc2c` passes scope/client/report/financial/shell in [run 40221453594](https://github.com/arnabnandikgp/rivalt/actions/runs/40221453594). Automated review success is not external independent review.
- `git fetch origin` plus exact local/remote head comparisons and parent ancestry checks pass for all eight branches. `git diff --check origin/main...HEAD` and `python3 ops/check-evidence-policy.py` pass. No financial, SBF/IDL, browser, RPC/WS/PostgreSQL, workload, devnet or endurance suite is repeated: source is unchanged from reviewed/tested heads, and the only follow-up is integration documentation.
- `gh stack merge --yes --merge` succeeds atomically. GitHub independently reports all eight MERGED on 26 October, 08:22:46–08:22:54 UTC, with merge commit `d07fccc108384381c0c5df743d14c2a0bc4f5089`. `git diff --exit-code 1a3cc2c origin/main` passes, establishing byte-identical tracked tree before this documentation closeout; local `main` fast-forwards without touching unrelated work.
- Local ignored review/merge captures: `.local/r053-open-prs.json`, `.local/r053-review-sweep.json`, `.local/r053-merge-status.json`. Original phase acceptance/economic audits retain their exact hashes and local paths; no historical count is claimed as a new test. Both status tables now mark P17–P21B and bounded M7 Closed after actual integration. M6 remains In progress with P15B/P16B Open; endurance and busy-exit redesign stay Deferred. README/roadmap/decisions reflect integration without weakening any financial guard.
- No blocker remains for this merge. Exact next action: scope the deferred exit-availability work when the user returns to it; external validation and funded deployment remain separate, unauthorized gates.

### R054 — 26 October 2026 — account-centric architecture roadmap (P22A)

- User requests current/proposed diagrams, a PR-sized approach and a durable document
  for the approved redesign direction. Read AGENTS/README/WORKLOG, product/decisions,
  protocol/components/validation and successor contract/plan; inspected actual group
  state, certificate/withdrawal, whole-account route/netting and financial-core paths
  at `9d3c295871136c356bf0028b0b2f9506e9391218`. Existing tracked source was clean;
  local `phoenix/` and the original design note remain untouched/untracked.
- Delivered [P22 roadmap](P22-ACCOUNT-CENTRIC-CLEARING.md): current/proposed diagrams,
  concrete code map, preserved scope, cash-versus-profit proof distinction, explicit
  loss/netting decisions, independent case inventory and eight cohesive stacked PRs
  P22A/P22B/P23–P28. P22's justified split separates the roadmap from the exact
  financial contract. D56 resumes the exit redesign without rewriting old acceptance
  or authorizing an unspecified new loss bearer, credit facility or funded rollout.
- Updated AGENTS, entry points, domain-document scope notes, roadmap and G17–G21;
  both live tables add M8 and its phases. P22A is Review; P22B/P23–P28 are Open.
  M7 remains Closed within its recorded limits, M6 In progress, P15B/P16B Open and
  24-hour endurance Deferred. New ordinary financial activation remains gated until
  P26 safety acceptance, with fresh integrated qualification in P27/P28.
- Actual checks: `git diff --check` passes; scoped Python documentation validation
  checks all ten changed Markdown files, 243 local links, balanced code fences,
  unique M8 phase rows in plan/worklog and one D56 record. Manual review confirms
  preserved baseline behavior, explicit future contract gates and sequential phase
  ownership. These checks validate documentation, not financial behavior.
- Not run: financial/unit/SBF/IDL, RPC/WS/PostgreSQL, browser, workload, devnet or
  endurance suites; no executable behavior changed. No new runtime result or CI
  success is inferred. Raw Phoenix binaries/research are not added to Git.
- `gh stack init --base main phase/p22a-clearing-roadmap` creates the review branch
  above `main`; publication is pending this run's commit. No runtime/access blocker
  is established. Exact next action: P22B — specify the funded-withdrawal proof and
  complete cash/claim transition/dependency matrix separately from profit-payment
  and default rules, then resolve G17 before dependent implementation.

R054 publication: documentation commit `8321677c690ea35fc0ca7fde8138c2274f68c3bc`
passes a committed-tree recheck of all ten Markdown files, 244 local links, balanced
fences, eight sequential phase dependencies/unique status rows and D56 uniqueness.
`git diff --check main...HEAD` and `python3 ops/check-evidence-policy.py` pass.
`gh stack submit --auto --open` creates [PR #32](https://github.com/arnabnandikgp/rivalt/pull/32)
above `main`; this closeout records publication and supersedes the pending note.
Only the requested Markdown documents are tracked in this change. No runtime test,
external review approval, merge or new deployment is claimed. Exact next action
remains P22B's separate funded-exit and profit/default contract proof.

### R055 — 26 October 2026 — P22B funded-exit proof and loss-allocation decision

- User authorizes proceeding through the roadmap with stacked phases. Started
  `phase/p22b-financial-contract` with `gh stack add` above exact P22A/#32 head
  `64615a4fa3afe699b8a74a5e136e3146ad1da148`. Inspected required specifications,
  actual V2 cash/claim/risk/netting/authority/layout code and hosted CI selection.
  The user uploads remain untouched/untracked; no program/runtime source changes.
- Delivered [developing contract](P22B-FINANCIAL-CONTRACT.md): local funded-cash
  coverage/conservation proof, production authentication/funding/reservation/atomicity
  obligations, separate gain-payment timing counterexample, exact common versus
  market-default outcomes, shared-debtor and cross-market netting/cycle examples.
  P22B recommends market-attributed losses but does not silently authorize different
  loss bearers. The complete default solver, layouts and G17 contract remain due.
- Added independent Python Fraction reference plus 20 focused checks. The bounded
  withdrawal check covers 23,328 cases; no Rust/SDK implementation is imported.
  The market-default example explicitly rejects mixed-sign/cyclic input rather
  than presenting an incomplete general solver as success. Floats reject. Literal
  cases preserve cash, fees versus insurance, exact claims and funded/unpaid status.
- Actual commands: `python3 tests/financial/test_account_contract.py` passes 20
  tests (0.228 seconds in the current pre-commit run); `bash -n ops/financial.sh`
  and `git diff --check` pass. An initial 19-check run also passed before the
  explicit float-input rejection check was added. `ops/financial.sh` adds this
  command to the existing hosted financial job; no CI outcome is claimed yet.
- Not run: inherited full Rust/financial suites, SBF/IDL/conformance, signed SVM,
  Surfpool/RPC/WS/PostgreSQL, browser/workload/devnet/endurance. This phase currently
  changes independent specification models/documentation and the CI entry command;
  it does not implement or enable financial paths. Model checks are not A27B closure.
- Both live tables keep M8/P22B In progress, P22A Review and P23–P28 Open. P15B/P16B
  stay Open and 24-hour endurance Deferred. Material G17 decision: example B pays
  BTC/ETH creditors 100/0 with market attribution versus 50/50 with the existing
  common waterfall. A concrete choice is needed under D56 before dependent work;
  no routine start permission is requested. Publication/checked commit follows.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.
  settlement/netting/default contract and versioned layouts. Independent authority,
  dependency and funding-proof work may continue meanwhile; P23 cannot start yet.

R055 continuation/publication: committed `2f5edc5e9d38b0efc98483472948b4c4d7c98b09`
passes all initial 20 model tests, shell syntax, parent-diff whitespace and evidence
policy. The scoped documentation scan checks 177 local links. `gh stack submit
--auto --open` creates ready PR #33 above #32 (GitHub stack #34); its base and
`isDraft:false` are independently fetched. The exact financial decision is asked
asynchronously after publication; no response/approval is inferred from elapsed time.
The initial hosted run `40355281643` reports scope/financial/shell SUCCESS with
client/report SKIPPED; this is distinct from local model and runtime evidence.

While the decision is pending, the follow-up adds an authority/dependency matrix,
post-withdrawal adverse held-funding corner coverage, immutable consumed-prefix
counterexample and legitimate signed/fractional funding cases. The affected suite
passes 24 tests in 0.277 seconds before commit. No unrelated local suite was added.
The finite 23,328-input enumeration remains a bounded model check; the additional
endpoint examples are separate checks, not an exhaustive source/concurrency proof.
Both tables now record P22B Blocked on B04, while M8 remains In progress. P23–P28
stay Open. The PR is ready for review of the work so far, not complete A27B/G17.
Exact next action: apply the user's loss-policy choice and complete its full
settlement/netting/default/layout contract in this same PR before starting P23.

R055 checked follow-up: `7f62c79626920b195a4af496fdc7210a8db3218a` passes
all 24 targeted reference tests (0.234 seconds) and the exact parent-diff whitespace
check. Only the original two user research paths remain untracked. This subsequent
closeout changes documentation only; no additional runtime result is implied.
The asynchronous loss-policy question remains unanswered at this checkpoint, so
B04/P22B remains Blocked and the next action stays the explicit G17 decision.

### R056 — 26 October 2026 — selected market attribution and insurance assessment

- Starting branch/head: `phase/p22b-financial-contract` at `14586f9021d18f9975fb4202664b4d388261eb9c`,
  above P22A `64615a4`. Tracked tree initially clean; preserve the user's untracked
  `phoenix/` and design note. PR #33 remains the P22B phase PR above #32.
- User explicitly selects option 2. D57 resolves B04 and records market-attributed
  losses for the fresh profile while retaining existing V1/V2 contracts. Both live
  tables now show P22B/M8 In progress; P22A Review, P23–P28 Open, external P15B/P16B
  Open and endurance Deferred. Exact G17 is incomplete; no P23 start or new activation.
- Inspect actual group custody/state and staged default code: external surplus
  classification, explicit T-to-I allocation, whole-atom insurance use after
  collection and complete residual impairment. No automatic fee percentage or live
  reserve balance is claimed. Record seed-plus-fee replenishment as a recommendation,
  with market attribution and no extra charge, public insurance product or implicit
  cross-market guarantee. Existing manual allocation permits engineering to continue.
- Targeted reference: public Quicknode PDF downloaded locally after the web reader
  failed; `pdfinfo`, `pdftotext` and `pdftoppm` inspect chapter 20, especially pages
  259/262/271–273/276/278, with rendered page 272 visually checked. The book explicitly
  teaches a simplified Percolator-inspired pool, not Rivalt's maker architecture.
  Local files `/private/tmp/rivalt-quicknode-percolator.pdf`, its `.txt` extraction
  and `/private/tmp/rivalt-percolator-page-272.png` stay outside Git. Author wrapper
  README pinned at `5cb331dde354517c6371a8acf92cecb194f3bb73`; engine README/spec at
  `4db11a8cb0053815e23a35d3a7d3edc265d8d866`. No upstream proof or deployment is certified.
- Actual scoped checks: `python3 /private/tmp/rivalt-r056-doc-check.py` passes seven
  documents, 173 local links, balanced fences, D57 uniqueness and active status
  consistency. `python3 ops/check-evidence-policy.py` and `git diff --check` pass.
  Changed product/protocol/roadmap/decision/contract documents agree. Publication
  verification follows the documentation commit; no new hosted CI result is claimed.
- Not run: unchanged financial/model suites, Rust/SBF/IDL, SVM, Surfpool/RPC/WS/
  PostgreSQL, browser/load/devnet/endurance. This run changes documentation only;
  earlier 24 model checks retain their `7f62c79` attribution and limitations.
- Blockers: B04 resolved; no access or routine product approval blocks continuing
  the selected contract. An automatic fee percentage and funded reserve calibration
  remain unselected policy, not prerequisites for explicit-allocation engineering.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.
  insurance and cross-market netting/default identities for mixed-sign debtors,
  cycles and fractional ownership, then finish G17 transitions/layouts in PR #33.

R056 publication checkpoint: committed `1dbd89d5cd537617c22b8b81fdde6792507f545d`
passes the same scoped documentation and parent-diff checks. `gh stack submit
--auto --open` publishes it to existing PR #33; GitHub independently reports that
exact head, OPEN/ready, base `phase/p22a-clearing-roadmap`, not merged. The PR body
now records B04 resolved and the remaining G17 work. This closeout changes only
the worklog; no new financial test, CI pass or phase completion is inferred.

### R057 — 26 October 2026 — approved 25% reserve allocation and independent cases

- Starting branch/head: `phase/p22b-financial-contract` at `1563f0dbe98ac9f2edb2492a546f21a2451ed370`,
  tracked tree clean, P22B/#33 above P22A/#32 `64615a4`. Read current instructions,
  README/worklog, product/decisions, P22 roadmap/contract and protocol/component/
  validation documents. Preserve both user-uploaded research paths untracked.
- User first approves the proposed insurance model, then explicitly chooses 25%.
  D58 records 25% of collected taker fees for the originating market's insurance,
  75% retained protocol revenue, with unchanged total 2 bps/zero-provider fee.
  Seed capital remains a separate actual injection; no amount or funded deployment
  is authorized. Existing V1/V2 fee behavior remains unchanged.
- Add exact reserve transitions and per-market modulo-four fee carry to P22B:
  splitting the same collected fee total cannot change cumulative allocation;
  zero-fee fills, payer/order changes, allocations, treasury withdrawals, default
  consumption and recovery do not reset carry. Separate settlement/insurance/fees
  and actual vault conservation; forbid an implicit foreign-reserve backstop.
  Pin authority/gate obligations and assign actual acceptance across P23–P28.
- Extend the independent Python reference with bounded market reserves, funded
  fee collection, seed injection, explicit extra fee allocation, fee withdrawal
  and the cash effect of post-collection insurance. No Rust/SDK import, source or
  signer authentication, token CPI, stage/replay enforcement or general default
  proof is supplied by this arithmetic model.
- Actual checks so far: `python3 tests/financial/test_account_contract.py
  InsuranceReserveContract` passes 15 tests in 0.030 seconds on the working tree,
  including 2,048 exact partition histories, both market carries, finite exhaustion,
  fractional residuals, retained-fee withdrawal, bounded input/custody rejection
  and an integral shared-debtor composition. The initial 14-test run passed before
  adding the treasury-withdrawal/carry case. `git diff --check` passes. Final
  documentation checks and committed revision/publication follow below.
- Not rerun: the unchanged 24 reference cases, broad financial/Rust suites, SBF/IDL,
  signed SVM, Surfpool/RPC/WS/PostgreSQL, browser/load/devnet/endurance. The new
  model/contract has no runtime implementation yet; broad reference regression
  remains in the existing hosted financial command, with no new CI result claimed.
- Both status tables retain P22B/M8 In progress, P22A Review and P23–P28 Open.
  B04 remains resolved; no access or unselected fee policy blocks this work.
  G17/A27B are incomplete, the new profile remains disabled, P15B/P16B stay Open
  and endurance stays Deferred. Keep the ready stack open.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.
  reference for mixed-sign debtors, cycles and fractional ownership using D58's
  reserve ledger, then pin terminal recovery and versioned layouts before P23.

R057 checked publication: `6cd6e6ca55104148103e20fdc7643f5fc3cbe031` passes the
15 targeted reserve tests in 0.030 seconds. The scoped documentation command
`python3 /private/tmp/rivalt-r057-doc-check.py` passes ten changed Markdown files,
213 local links, balanced fences and D58/status/policy consistency. Evidence policy
and parent-diff whitespace pass. `gh stack submit --auto --open` publishes that
exact head to PR #33; independent GitHub metadata confirms OPEN/ready, base P22A,
not merged. The PR description now records the approved split and remaining G17.
This final worklog-only closeout adds no runtime or hosted-CI claim.

### R058 — 26 October 2026 — complete-cohort clearing and whole-atom references

- Starting branch/head: `phase/p22b-financial-contract` at `9f0b5b7`, above P22A/#32
  `64615a4`, tracked tree clean. Read current repository instructions and phase/
  domain specifications; inspect actual V2 netting, margin/group state and staged
  resolution. Preserve the user's two research uploads untracked. Continue the
  planned phase in existing P22B PR #33; no routine approval is requested.
- Add an independent exact two-market clearing benchmark for all frozen rows,
  mixed-sign debtors, capped source-to-destination recoveries and cycles. Enumerate
  piecewise-affine branches and select the greatest fixed point; closed cashless
  cycles discharge without reserve use, while external creditors remain included.
  Assert per-market writeoff/impairment identity and total cash conservation.
- A literal integer-input case requires fractional insurance in the raw ideal.
  Add a separate whole-atom output candidate: whole own-cash collection, at most
  two fractional insurance-capacity clips, then deterministic conserving flow
  rounding. Every market's terminal adjustments sum to zero; cash retained after
  collection stays protected. Sub-atom debts cannot each round up a funded debit.
  The final error bound is against the adjusted benchmark, not the unrestricted
  ideal. D59 and the [reference contract](P22B-CLEARING-REFERENCE.md) state that limit.
- Actual targeted command: `python3 tests/financial/test_clearing_network.py`
  passes 29 checks in 0.193 seconds on the final working tree. Cases include a
  378-case independently solved cycle family in the rational and atom layers,
  source failure, own debt versus unpaid profit, clipping requiring three
  evaluations, market/identity ordering, fractional owners and 64-member bounds.
  `bash -n ops/financial.sh` and `git diff --check` pass. Add only this target to
  existing hosted financial CI; no hosted outcome is claimed yet.
- Resolved failures: the first 16-check run exposed an incorrect permutation
  expectation; hand calculation confirms that the one recovered BTC atom must
  first service the same account's two-atom ETH debt, so cash is `(0,0,1)`.
  The first atom-layer run exposed shortest-path preference defeating the intended
  larger-remainder linked award; change the reference to deterministic remainder-
  priority depth-first augmentation with repair arcs, preserving the literal
  expectation. Additional whole-collection cases prevent taking an extra funded
  atom for a sub-atom obligation. Do not count these failed runs as passes.
- A bounded seeded exploratory search exercises 2,000 small integer histories;
  a separate fractional search (limit 2,000, stopped on discovery) finds the
  three-evaluation clipping case. Preserve it as a hand-verified literal regression,
  not as an extra independent acceptance count. The inspected 64-row case uses
  289 branch pairs, one insurance evaluation and 16 flow augmentations, with zero
  payout; those are reference operations, not SBF/CU/packet measurements.
- Remaining engineering: arbitrary-size rational internals still need a checked
  bounded representation, explicit persisted stage/layouts and runtime authority.
  Normal netting/payment eligibility, terminal reserve recovery and full G17/A27B
  remain incomplete. Both live tables retain P22B/M8 In progress, P22A Review and
  P23–P28 Open. No new financial path is enabled; B04 remains resolved, P15B/P16B
  Open and endurance Deferred. No external access/product blocker is established.
- Not rerun: unchanged exit/reserve reference targets, broad Rust/financial suite,
  SBF/IDL, signed SVM, Surfpool/RPC/WS/PostgreSQL, browser/load/devnet/endurance.
  This is new specification-model work; no actual financial-program acceptance
  is inferred. Scoped documentation/committed checks and publication follow.
- Exact next action: use the integrated [P28 operations guide](P28-OPERATIONS.md) for local evaluation of the completed account-centric MVP. P22–P28 implementation/merge work is complete; further product work or external P15B/P16B execution needs its own scope. Do not start deferred endurance or funded deployment.
  state for D59's clearing/rounding candidate, then finish normal settlement/
  recovery authority and exact versioned layouts before P23.

R058 checked publication: `0e9ca912dca659fbdac8a93c9a3082016068b683` passes all 29
new reference checks in 0.205 seconds, recorded locally in ignored
`.local/r058-clearing-reference.log`. `python3 /private/tmp/rivalt-r058-doc-check.py`
passes seven changed Markdown files, 181 local links, fences and D59/status/limit
consistency. Evidence policy, shell syntax and parent-diff whitespace pass.
`gh stack submit --auto --open` pushes successfully but reports a GitHub HTTP 504
while querying PR #33; a separate metadata fetch verifies the exact new head,
OPEN/ready state, unchanged P22A base and not merged. The PR description is updated
and independently verified. This subsequent worklog-only closeout adds no new
runtime or hosted-CI result; the stack stays open and G17 remains In progress.

### R059 — 27 October 2026 — complete P22B financial contract

- User explicitly requests completion of P22B and autonomous continuation through
  P28, keeping each phase in a ready stacked PR. Start at `60dc59c` on P22B/#33;
  preserve untracked `phoenix/` and the supplied design note. Read repository/domain
  instructions, roadmap and actual V2 custody/margin/resolution implementation.
- D60 and [the executable contract](P22B-EXECUTABLE-CONTRACT.md) pin exact normal
  collection/payment, funded flat-only netting, account-local funded exits,
  dependency/version rules, complete-venue freeze with market loss attribution,
  terminal retirement/recovery, migration and phase-specific acceptance.
- Replace the unbounded-internals gap with a 6,144-bit integer schedule: shared
  collection denominator, bounded small-factor operations, at most three insurance
  evaluations and common-denominator circulation. A complete on-chain rate verifier
  can check the greatest fixed point from equations/right derivatives without
  trusting the keeper or enumerating every branch. Later SBF implementation remains
  P26 work; the contract does not claim measured runtime compute.
- Add 14 inert schema-3 account layouts, separate identity/custody/safety/market
  ledgers, exact wide/page/work records and serialization/PDA/legacy-isolation
  checks. No entrypoint, profile activation or V1/V2 financial handler changes.
- Focused Python commands pass: `test_account_contract.py` 39 checks,
  `test_clearing_network.py` 29, `test_bounded_clearing.py` nine and
  `test_market_settlement.py` 11. The new integer comparison includes 200 seeded
  complete histories, 64-row denominator/link cases, three-pass clipping and
  malicious smaller-cycle certificates. Expected outputs use the separately
  implemented Fraction model/literal examples, not implementation self-comparison.
- `cargo test -p clearing --lib state::v3::tests --locked --offline` under pinned
  env/debug-off passes three checks, including all 14 exact account sizes. The first
  attempt caught an incorrectly hand-added Resolution header size (expected 3,627
  versus serialized 3,514); correct the independent field sum, then add explicitly
  required source/proposal/gross fields, final size 3,644, and rerun successfully.
  Existing Anchor target-os warnings remain warnings, not runtime evidence.
- Local ignored logs: `.local/r059-{account,clearing,bounded,settlement,layout}.log`.
  Evidence policy, shell syntax and diff whitespace pass. Scoped committed checks,
  documentation validation and PR publication are recorded below. Both tables mark
  P22B Review (not Closed) and M8 In progress; P23–P28 retain their own gates.
- Not run: unrelated V1/V2 financial/regression, SBF/IDL, signed SVM, Surfpool/RPC/WS/
  PostgreSQL/browser/load/devnet/endurance. Those are implementation-phase checks;
  no inherited runtime or hosted CI count is relabelled as this contract acceptance.
- No external/product blocker. Exact next action: publish verified P22B, stack P23
  and implement/qualify actual schema-3 custody with new trading disabled; continue
  the dependent phase sequence without waiting for predecessor merges.

R059 committed acceptance: `0d78bf052c29d490b14fc299c09d08d68a3c66a5` passes all 88 focused Python
checks and three Rust layout/identity checks. Documentation validation passes
11 files/236 local links, fences and D60/status consistency; evidence policy and
parent-diff whitespace pass. GitHub reads show no inline review threads on #32/#33;
that is not independent review approval. This following evidence-only commit
records the immutable tested source; P23 depends on it and its completed G17.

### R060 — 27 October 2026 — P23 custody implementation and verification

- Predecessor P22B complete contract/acceptance `0d78bf0`, evidence closeout
  `c412bdb2cfc426e29002954f371165a310cfe5fc`; `gh stack submit --auto --open`
  succeeds and independent GitHub metadata confirms #33 OPEN/ready above #32,
  exact head and unmerged. Update its completed phase description and create
  `phase/p23-account-custody` with `gh stack add`; do not wait for a merge.
- Implement D61's 11 fresh custody instructions, separate venue/custody/safety/
  ledger authorities, actual donor reserve transfers, exactly attributed surplus,
  debt-free owner deposits/exits/transfers and immutable bounded account admission.
  Add versioned event-CPI and generated SDK/legacy checks; all existing V1/V2 IDL
  instructions/accounts/types/events compare identical by name/content.
- Initial targeted host check passes. First SBF build rejects generated resolution
  array stack frames (up to 14,024-byte offset). Move WideV3's fixed array into Box
  without changing Borsh bytes; rebuild default/local SBF and IDL successfully with
  frame guard. No on-chain wide arithmetic acceptance is inferred.
- Initial dirty-tree signed LiteSVM run passes 139 scenarios, including actual
  64-member registry, maximum capacity rejection, SPL custody, independent market
  reserve balances, role/alias/schema/profile/frozen negatives and atomic rollback.
  All 11 new instruction encodings/flags match isolated legacy Anchor. Integrated
  TypeScript check passes. Final committed acceptance follows below.
- First real RPC launcher fails at loopback port preflight with `Operation not
  permitted`, before launching Surfpool. Retry requires the sandbox's execution
  permission, not credentials, a new provider or a product exception. No RPC pass
  is claimed from that attempt. Disk is currently 2.1 GiB available; preserve all
  historical raw evidence and user uploads. No unrelated full suite is run.
- P23/M8 remain In progress, P22A/P22B Review; P24–P28 Open. Exact next action:
  committed SVM/RPC/WS/legacy/raw-byte acceptance and P23 publication, then P24.

R060 committed acceptance: clean `450016802f8a17d27261fb1ad1fbe49084e20872`
passes the default/local SBF/IDL frame-guard build, integrated TypeScript, 11 new
instruction legacy comparisons, 139 signed SVM outcomes (104 success / 35 expected
reject), generated SDK/HEAD parity, and 57 actual finalized Surfpool outcomes
(31 success / 26 expected reject). All eight account types/25 committed events
match isolated Anchor; 51 WS notifications observed. The independent raw-byte
auditor reconciles final user tokens 1,999,982 plus BTC/ETH reserves 7/11 to the
2,000,000 minted total and rejects eight mutations. Maximum 89,854 CU / 753 bytes /
16 accounts; network fees 515,000 lamports. These are scenario populations, not
throughput or distinct-vector counts. Exact hashes/limits are in [P23 evidence](evidence/P23.md).

The approved local-listener retry succeeds; the owned Surfpool shuts down cleanly.
Raw RPC data stays at `.local/account-custody/20261026T194527Z-85296/`, SVM at
`.local/account-centric/p23-svm.json`. Both status tables now mark P23 Review, not
Closed; publication follows in the existing stack. No genuine blocker. Next: P24
risk/funding/routes/orders and exact insurance split under the isolated candidate
harness, preserving the P26 ordinary-activation gate.

### R061 — 27 October 2026 — P24 account trading implementation

- P23 documentation closeout `de5db9d60c614919b1625ef7ec9ae0856bbc70d2`
  records the unchanged tested source `4500168`. Documentation/link/evidence checks
  pass. `gh stack submit --auto --open` creates ready PR #35 above #33; `gh pr view`
  verifies OPEN, not draft, correct base/head. No merge or independent approval.
  Create P24 with `gh stack add phase/p24-account-trading`.
- Implement the separate candidate build, schema-3 maker config/request namespace,
  shared risk/order scalar adapters, authenticated source/funding handlers, root
  delegate/order guards, atomic routes and market-specific collected fee split.
  Current source and SBF checks are preliminary dirty-tree evidence only.
- Targeted locked/offline host compilation passes for clearing and both makers.
  First SBF guard rejects oversized route-context and order/route handler frames
  (maximum 7,872 bytes). Split context validation/event assembly and retain only
  needed position snapshots; rebuild and signed qualification remain in progress.
- Raw build logs stay `.local/p24-*.log` and `.local/account-trading/`; P23 artifacts
  remain at their recorded paths. No runtime success, CI, PostgreSQL, UI, devnet,
  load/endurance or independent review is claimed. P15B/P16B stay external and the
  24-hour test Deferred. No product/access blocker is established.
- Both tables retain P22A/P22B/P23 Review, P24 In progress and P25–P28 Open.
  Exact next action: pass the affected SBF frame guard, then independently verify
  P24 funding, reservations, authority/rollback and fee carry in signed SVM/RPC.

R061 targeted progress: corrected frame construction passes the SBF guard. A
subsequent two-maker route exposes 32 KiB heap exhaustion at event serialization;
borrow account snapshots with exact IDL wire-parity tests instead of copying them.
The route then exposes insufficient 20% compute headroom at maximum three-root
books. Retain the 600,000-CU ceiling and complete module hashes; size-optimize the
maker binaries and remove repeated validation of one immutable model within a book
scan. The measured maximum-book route then uses 470,479 CU / 1,169 bytes. These
are preliminary local figures; final artifact/commit acceptance remains pending.

Eight focused actual-adapter/event Rust checks pass. The first funding-vector run
caught inconsistent test setup (stored historical F with a zero held funding base)
and a test premium beyond the retained cap; correct the fixture to a consistent
historical base and independently calculated sub-atom positive/negative funding.
No production funding cap changes. The new live-event view exactly matches the
owned IDL wire encoding. TypeScript and 23 isolated-Anchor ABI variants pass.
Signed SVM currently passes 283 outcomes, including whole-account routes, actual
maker/source setup, same-intent execution after sampling, delegates, TP/SL,
maximum live books, permissionless partial fills, stale sources and rollback.
The independent raw-byte audit checks 44 transitions/13 fills and rejects eight
mutations. Raw path `.local/account-trading-runs/20261026T202552037Z-2441/`.

Real Surfpool HTTP/WS acceptance is now running under the authorized local listener
permission. RPC omits the three-minute idle epoch-expiry wait; signed SVM separately
qualifies that rotation. No time warp or synthetic RPC success is used. P24 remains
In progress, and no P24 PR/phase acceptance or downstream completion is claimed.

R061 further qualification: 304 signed SVM outcomes (245 success / 59 expected
reject) now include actual triggered SL execution, selected-maker consumption
changes, pause/cancel authority, module changes and default-build rejection for
both account modes. The raw-byte auditor checks 49 transitions / 16 fills and
rejects eight mutations. Maximum stored two-maker execution with all three full
books measures 472,160 CU; no route limit increase. Evidence remains preliminary
at `.local/account-trading-runs/20261026T203711827Z-5652/`.

Real RPC first rejects a sample only one second after its predecessor. Respect
the existing two-second interval in the harness. Subsequent RPC runs correctly
reject a risk-increasing BTC action: time spent in the order scenarios exceeds
held sampling coverage, and one fresh sample does not satisfy the unchanged
six-second recovery. Decode the actual committed oracle events to identify the
Recovering state; explicitly complete four normal samples before the stale-ETH
independence case. No source age, recovery, risk, funding or CU rule changes.
Keep the failed runs at `.local/account-trading-rpc/` and their simulation/log
files. Latest corrected RPC verification remains in progress.

Pin the generated V1/V2 maker PDA helper names after finding Codama reassigned
`findConfigPda` to the new namespace. The targeted conformance now checks all six
old/new maker helper identities. All inherited IDL definitions remain identical
(80 clearing instructions / 26 accounts / 23 events / 80 types / 32 errors;
each maker six instructions / two accounts / 16 types / four errors). Ten affected
shared route/order/oracle Rust tests, five maker arithmetic/authentication tests,
and one affected event-CPI serialization test pass. Do not run unrelated full
financial/UI/service suites; scoped hosted CI remains configured but no CI run
is claimed here. Commit the cohesive source candidate, build its exact artifacts,
then run final P24 SVM and actual RPC/WS acceptance before publishing the PR.

R061 final acceptance passes on clean tracked source
`4a0763ddb0c5942239bdc751316faa98a67bed91`. Rebuild default/candidate clearing and
both makers with `bash ops/build-account-trading.sh`; all SBF frame guards pass,
IDL generation matches HEAD and the source/artifact manifest records a clean tree.
`pnpm typecheck`, `pnpm generate:check`, the 23-variant conformance plus six PDA
helper checks, eight new Rust vectors, ten affected shared-engine checks, five
maker vectors and one affected event-CPI check pass on this pin.

Final signed SVM produces 329 outcomes (270 successful / 59 expected rejects).
Actual Surfpool produces 313 independently finalized originals (262 successful /
51 expected rejects), 134 committed events and all 175 expected WS notifications.
Legacy decoding matches all 28 accounts/11 program-qualified types and every
committed event. Each independent raw-byte audit verifies 49 financial transitions,
16 fills and rejects eight mutations. Max route/order CU is 473,764 on RPC with
21.04% headroom; maximum packet/accounts is 1,191/24. Both runtimes retain BTC
I/T/carry 67/203/2 and ETH 3/10/1 with zero P and exact paired claims/cash. Network
fees are separate: 2,710,000 test lamports in RPC, including rejected attempts.

The [P24 report](evidence/P24.md) pins all reproduction commands and limits. Raw
final paths: `.local/account-trading-runs/20261026T204511910Z-10104/` and
`.local/account-trading-rpc/20261026T204514Z-10132/`; artifact manifest and scoped
logs remain ignored/local. No remaining P24 blocker. No broad unrelated matrix,
PG, UI, concurrency, devnet, endurance, hosted CI or external review is claimed.
Both status tables mark P24 Review pending integration/publication, not Closed.
Commit this concise closeout, publish the ready stacked PR, then continue P25.

### R062 — 27 October 2026 — P25 cash and market claims

P24 closeout `f8f5dac56d0c5d251c82fb87c5b8f4e8ed44eb55` preserves tested source
`4a0763d`. Changed Markdown fences/108 local links and evidence policy pass.
`gh stack submit --auto --open` creates ready PR #36 above #35; `gh pr view`
verifies OPEN, non-draft and the exact head/base. The stack stays open. Create
`phase/p25-account-cash` with `gh stack add` and continue without waiting for merge.

Read D60's actual normal-settlement/funded-exit contract, V3 layouts and existing
risk/book/funding helpers. Record the P25 implementation contract. Begin typed
cash/claim candidates over the shared engine, including actual current accrual,
full donor admission, all four held-funding corners, gross-debt collection and
funded-only flat netting. This is implementation in progress, not acceptance or
activation. The ordinary build stays disabled; P26 safety, P27 PG/services and
P28 concurrent qualification remain due. Exact next action: compile the candidates,
add authority-bound handlers/canonical certificate paging, then independent vectors
and signed SVM/RPC checks. No financial runtime result is claimed for P25 yet.

R062 implementation: add nine authority-bound cash/claim/certificate/fee handlers,
active deposit/identity/reserve donation paths, exact current-plus-held funding
checks and complete canonical one/two-root market scans. Keep ordinary activation
disabled. The new 234-byte certificate retains scoped liability/source stamps;
no certificate is required for funded cash exits. Typed snapshots/events and the
generated SDK preserve the earlier ABI.

Nine targeted Rust tests pass (`cargo test -p clearing --lib
instructions::account_cash::tests --features account-cash-qualification --locked
--offline`, debug symbols disabled), including 28,158 independently enumerated
withdrawal boundaries, four mixed funding corners, fraction ownership, funded-only
netting and shared-debtor coverage. The direct broad-corner helper case is not
claimed as an observed legal six-second premium. Fourteen instruction variants
match isolated legacy Anchor. TypeScript, initial default/candidate builds and SBF
frame guards pass; the final clean source pin/build remains pending.

Preliminary signed SVM grows from 145 to 610 outcomes as phase-owned cases are
added. Actual RPC run `.local/account-cash-rpc/20261027T064046Z-27756/` independently
finalizes 377 originals, decodes 252 committed events with legacy parity and observes
all 278 expected WS outcomes. Its 25-transition wire audit now passes with ten
mutation rejections. The first RPC attempt's 22-second stale-source wait exceeded
the harness's 15-second polling deadline; use bounded clock waits without changing
source policy. An auditor initially assumed cancellation accrues participant
funding; correct it to preserve pending funding while the market prefix advances.
No successful transaction or fault is fabricated.

A new actual TP/SL→withdraw→cancel→close→net scenario catches an implementation
error: netting rejected cancelled protection history whose remaining allowance is
still recorded. Check refreshed live order authority, not inert historical fields;
the retained flat-only and no-live-order requirements still apply. The nine Rust
checks pass after the fix. Add maximum live books, actual insolvent isolated/shared
debtors created by signed trading and price changes, complete 64-member scans,
foreign authority/destination, stale replay and atomic actual-token rollback.
No raw evidence is tracked. Exact next action: pin the coherent P25 source, rebuild,
then finish its signed SVM/RPC/WS and independent accounting acceptance before
publishing the ready stacked PR. P26–P28 remain due. No unrelated broad suite,
PostgreSQL/UI qualification, devnet, endurance, hosted CI or external review is
claimed; P27/P28 own the new integrated service/concurrency checks.

R062 pre-pin checks now pass: 631 signed SVM outcomes at
`.local/account-cash-runs/20261027T064737036Z-29864/`, 57 independently audited
financial transitions/ten fills and ten rejected mutations. Full order-book cash
outflow/transfer, actual cancelled TP/SL settlement, real shared-debtor rejection
and unrelated-market insolvency are included. All inherited IDL definitions remain
identical (clearing 90 instructions/28 accounts/29 events/95 types/32 errors; each
maker nine instructions/three accounts/22 types/four errors). TypeScript and generated
client checks pass. Pin the source and rebuild before final RPC acceptance; these
preliminary paths are not a clean-commit qualification claim.

R062 final acceptance: clean source `12a23e6150042b633ee20564d1482888585793ee`
passes `bash ops/build-account-cash.sh` (default/candidate SBF frame guards, IDL,
SDK and clean manifest), the nine targeted Rust checks, TypeScript, generated parity
and 14 legacy instruction variants. Final SVM is 631 outcomes (598 success / 33
expected reject); actual Surfpool is 629 finalized originals (598 / 31), with all
446 expected WS notifications, 86-account/12-type and 415-event legacy parity.
The two extra SVM rejects prove ordinary-build gating. Both independent raw audits
verify 57 financial transitions / ten fills and reject ten mutations.

Pinned paths: `.local/account-cash-runs/20261027T070735947Z-34004/` and
`.local/account-cash-rpc/20261027T070740Z-34033/`. Source pins and all candidate hashes
match the clean manifest. [P25 evidence](evidence/P25.md) records commands, hashes,
scenarios and limits. Full-book funded exit/transfer maxima are 84,648/101,269 CU;
backing-page maximum 136,744. Sampling is the tightest envelope at 870,906/1,200,000
CU (27.42% headroom). Maximum packet/accounts is 985/22. RPC network fees are
4,765,000 test lamports. No remaining P25 blocker. Both tables mark Review, not
Closed. No unrelated broad suite, new PG/UI/concurrency, devnet, endurance, hosted
CI or external-review result is claimed. Exact next action: commit this closeout,
submit the ready PR above #36, verify its metadata, then start P26 on that exact head.

### R063 — 27 October 2026 — P26 bounded safety implementation

Publish P25 with `gh stack submit --auto --open`: ready PR #37, OPEN/non-draft,
base `phase/p24-account-trading`, exact head
`75e34c55ef9447aa8b5a94b78c1912c00f920bc3`. Set its description from the verified
final behavior and scoped acceptance. `gh stack add phase/p26-account-safety`
creates the child on that exact predecessor; no merge is requested or performed.

Read D60's complete executable/financial/clearing contracts, current V3 resolution
layouts, shared liquidation and the independent Fraction/integer references.
Record the P26 implementation sequence. Begin allocation-free 96-limb arithmetic
in financial-core, with fixed small multipliers, bounded debt division and 58-step
whole-flow quotient/remainder. Add an isolated test transport and independently
generated Python integer vectors. This is implementation in progress; no complete
safety handler/runtime/activation evidence is claimed. Exact next action: verify
the new arithmetic, then implement whole-account liquidation and the authenticated
frozen denominator/rate/flow/application schedule. P15B/P16B and endurance deferral
remain unchanged; unrelated inherited suites are not rerun.

R063 initial checks: the actual fixed-width Rust transport passes 2,060 independent
Python integer operation cases, including 6,144-bit carries/borrows, overflow,
maximum debt divisors and the 58-bit quotient boundary. The actual row/rate
primitives pass 337 independent Fraction comparisons/rejections: complete own-cash
collections, mixed-sign links, greatest rather than lower cyclic rates, each
insurance clipping evaluation and a >5,000-bit denominator at 64 rows. Commands:
`cargo build -p financial-core --bin clearing-wide-driver --bin clearing-row-driver
--locked --offline` with dev debug/incremental disabled, then
`python3 tests/financial/test_clearing_wide.py` and
`python3 tests/financial/test_clearing_rows.py`. Logs remain `.local/p26-*-vectors.log`.

The V3 consenting-receiver liquidation handler now wraps the shared checked
post-fee candidate with schema-3 root/safety guards, exact custody/market identity,
liability invalidation and a dedicated event. Its candidate feature is separate;
ordinary activation remains false. Locked offline host compilation passes after
fixing Anchor's unqualified composite-context requirement and the shared adapter's
active-mode spelling. Focused V3 liquidation vectors are running. The full frozen
state machine, SBF/RPC safety acceptance and explicit activation are not implemented
or claimed yet. Continue those within P26's single cohesive PR.

R063 candidate checkpoint: all three V3 liquidation financial cases and the borrowed
event's exact owned-IDL wire comparison pass. The first SBF attempt correctly
fails its 4,096-byte frame guard on construction of the owned liquidation event
(estimated 5,120-byte frame). Replace it with borrowed account views and prove
byte parity; the corrected clearing SBF build passes the guard. No larger stack,
heap, CU ceiling or omitted event field is used. Initial IDL/SDK generation and
TypeScript pass. This is a local intermediate source checkpoint, not a P26 PR or
A31/G20 completion; frozen clearing and real signed runtime work remain the exact
next action. The new wide/row primitives have host evidence only until those
actual SBF resolution paths invoke and qualify them.

R063 frozen/proposal continuation on `5920428` plus the recorded working diff:
implement precreated header/work/32 pages, canonical bankruptcy/source-emergency
freeze, fixed-F AwaitValuation, complete one/two-row Value and Denominator, bounded
hashed rate uploads, complete fixed/greatest verification and prescribed insurance
clipping. Complete wrong proposals reset work without applying cash or spending I.
Events preserve original frozen inputs, proposal chunks and exact budget decisions.
No account-layout or financial-policy change is introduced.

`cargo test -p clearing --lib instructions::account_safety --features
account-safety-qualification --locked --offline` passes 15 tests (including the
four earlier liquidation/event tests). New literal vectors cover gross flat debt,
positive-net risk deficit, source grace/authority, both fractional F endpoints,
corrupt cohort sums, every legal page range through 64 members, incomplete/changed
proofs, lower cyclic fixed points and three complete clipping evaluations. The
candidate SBF build passes its 4 KiB frame guard; IDL generation, SDK generation
and TypeScript pass. Initial host compilation exposed unsupported `try_to_vec`;
use the existing Anchor serializer directly.

`node --import tsx tests/rpc-contract/account-safety-svm.ts` passes 157 signed,
blockhash/signature-verified outcomes (151 success / six expected rejects), using
actual deposits, maker fills and signed source updates to create bankruptcy.
Its first attempt correctly rejected an unrecovered post-activation oracle;
add the unchanged sustained recovery before opening the position. No source limit
is relaxed. Final preliminary path:
`.local/account-safety-runs/20261027T083056722Z-51578/`. Precreation/complete freeze/
valuation/denominator/proposal/rate verification reaches FlowPlan; live roots,
ledgers and actual vault stay unchanged during frozen preparation. Measured
header/work initialization 163,964 CU; freeze 220,801; two-row valuation 245,084;
denominator 228,264; proposal 232,892; two-row verification 795,374, each within
1,200,000 CU with at least 20% headroom. Largest proposal packet is 1,176 bytes.
These seven-member preliminary measurements do not establish worst-case arithmetic,
64-member resolution, final payouts, RPC/WS, restart/recovery or phase acceptance.

Exact next action: implement complete deterministic conserving FlowPlan/Round and
exactly-once Apply/Reconcile plus authorized recovery/retirement, then run the
maximum-cohort and real RPC/WS safety gates before publishing P26. P27/P28 remain
dependent work. No unrelated inherited regression, new PostgreSQL/UI/endurance,
devnet/funded deployment, hosted CI or external review was run or claimed.

R063 deterministic atom continuation on `21f2569` plus the recorded working diff:
implement exact whole-flow/cash floors, verified complete remainder permutations,
fixed-array deterministic DFS with repair arcs, persisted bounded continuation and
complete node conservation audit. Order verification cannot be replaced mid-pass;
a wrong committed permutation resets deterministically. No participant payout or
recovery is implemented by these preparation instructions.

`cargo build -p financial-core --bin clearing-atoms-driver --locked --offline` and
`python3 tests/financial/test_clearing_atoms.py` pass 549 independent comparisons
(183 inputs, each with one/seven/128-slot continuations), including 64-member
inputs, conserving market adjustments, exact atom ownership and augmentation
counts. The first test transport used the wrong reference attribute name; correct
it to the existing `signed_movements` field, with no expected arithmetic change.
The first signed two-row FlowPlan exceeds 1,200,000 CU. Optimize checked arithmetic
by skipping zero columns/unused high limbs and leading zero quotient bits. Fresh
2,060 independent wide, 337 row/rate and 549 atom comparisons all pass after that
change; the 15 focused program tests and TypeScript pass. Fix an ordinary borrow
checker conflict in the new order checker before compiling SBF; the final build
passes the unchanged stack-frame guard. IDL/SDK generation remains additive.

The extended signed two-maker bankruptcy reaches a complete rounded plan with
actual fractional creditor allocation: 182 outcomes (174 success / eight expected
rejects), at `.local/account-safety-runs/20261027T090129594Z-60224/`. It verifies
both market conservation equations, each account's <1-atom error, retained own
cash, wrong/duplicate permutations, immutable in-progress checks and deterministic
reset. Live roots/vault/ledgers remain unchanged until Apply. Earlier preliminary
178-outcome path `.local/account-safety-runs/20261027T085631002Z-58633/` is retained.
Two-row FlowPlan maximum is 508,227 CU, exact rate verification 299,285 and bounded
Round 200,047 in this seven-member run. These are preliminary measured cases,
not worst-case cohort/arithmetic acceptance. Raw logs/evidence remain ignored.

Exact next action: implement exactly-once Apply/Reconcile and authorized terminal
cash access/recovery/retirement, then maximum-cohort and real RPC/WS safety acceptance
before P26 publication. Ordinary activation remains disabled. No unrelated broad
suite, new PostgreSQL/UI/endurance, devnet/funded deployment, CI or external review
is run or claimed; P27/P28 and external P15B/P16B remain separate obligations.

R063 terminal-application continuation on `a75e69d` plus the recorded working diff:
implement canonical exactly-once Apply and separate complete Reconcile, original
frozen aggregate/staged-row accounting, market insurance debited once, authority
cleanup and resolved/retired own-cash withdrawal without new funding. Preserve an
isolated account's forbidden slot as all-zero; the shared engine correctly rejects
nonzero generation/F there. Use explicit scalar zero checks rather than changing
V2's traits/layout. Preserve monotonic order IDs and all fee carry. Add complete
freeze market snapshots and final ledger/version event data for P27 projection.

The focused program suite now passes 19 tests: four additional literal terminal
cases verify unrelated funded cash preservation, market insurance accounting,
cashless-cycle clearing, isolated slot constraints and rejection of residual
claims/revived authority. Candidate SBF passes the frame guard. IDL/SDK generation
and TypeScript pass after correcting the test's order field spelling to `state`.
The seven-member signed runtime passes 197 outcomes (185 success / 12 expected
rejects), including both affected active withdrawal and source-independent terminal
withdrawal, actual token-credit/vault-debit checks, stale old authority, apply replay,
premature reconciliation and frozen exit rejection. Evidence:
`.local/account-safety-runs/20261027T091726855Z-64590/`; earlier 196-outcome path
`.local/account-safety-runs/20261027T091446369Z-63845/` remains retained.

Measured two-row Apply maximum is 259,164 CU, final Reconcile 237,698, terminal
withdrawal 62,430 and affected active withdrawal 78,880. This remains preliminary
seven-member SVM coverage, not full A31/G20, maximum-width/cohort, actual Surfpool
RPC/WS, recovery/retirement, PostgreSQL or qualified activation. Read-only `gh pr
list` verifies #32/#33/#35/#36/#37 remain open, non-draft and correctly stacked;
no merge/publication of incomplete P26 occurs. No unrelated inherited suites,
endurance, devnet/funded deployment, CI or external review are run or claimed.
Exact next action: implement explicit sustained-source recovery and irreversible
retirement/reserve custody, then finish maximum-cohort/real RPC safety acceptance.


### R064 — 27 October 2026 — P26 recovery and terminal retirement

Continue on `phase/p26-account-safety` at `ac6b3a6` with its existing recovery
working changes, preserving unrelated user uploads. Implement sustained authenticated
source recovery, authority-only Resolved→Custody, separate fresh maker/source
qualification and explicit candidate reactivation. Preserve earned funding, fee
carry and historical root generations. Fix recovered custody access to test actual
liabilities rather than virgin nonces/generations; flat cash deposit/transfer/exit
remains source-independent. Add D64's 80-byte retirement certificate, canonical
complete flat scan and irreversible authority retirement. Only afterward may reserve
authority withdraw selected-market I to the immutable destination owner's canonical
classic SPL ATA; C/T remain separately backed. Record additive layout/authority
clarifications in the protocol, components, executable contract, roadmap and D64.

Scoped `cargo test -p clearing --lib instructions::account_safety --features
account-safety-qualification --locked --offline` passes 23 checks; the affected
exact-layout test passes separately. The first retirement compile catches missing
Anchor composite-context generated imports; import those explicit modules/bumps.
Candidate `anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 --
-- --locked --features account-safety-qualification` passes the unchanged 4 KiB
frame guard. IDL generation, `pnpm generate`, `pnpm typecheck` and generated parity
pass. All 99 inherited instructions, 29 accounts, 31 events, 99 types and 32 errors
from exact P25 `75e34c5` remain identical. No ordinary activation is enabled.

`node --import tsx tests/rpc-contract/account-safety-svm.ts` passes 308 signed
outcomes (278 success / 30 expected rejects), including invalid-source recovery
reset, foreign/premature resume, fresh reactivation qualification, stale retirement
scan restart, retirement irreversibility and actual owner/reserve token exits.
Paths `.local/account-safety-runs/20261027T094207331Z-71212/` and the extended raw
snapshot run `.local/account-safety-runs/20261027T094702029Z-72589/` remain ignored.
The first runtime attempt expected the wrong OraclePolicy code (6123 versus actual
6124); correct the harness expectation without altering risk behavior. Recovery/
retirement are candidate seven-member coverage, not phase acceptance.

`python3 tests/financial/account-safety-reference.py` independently decodes frozen
and complete raw accounts, derives all seven Fraction-model payouts and exact
market movements, and audits cash/insurance/fee/funding/authority/token invariants
through recovery and retirement. Ten corruptions reject, including a conserving
wrong atom recipient. The mutation check caught the auditor ignoring an unsigned
flow for a zero claim; explicitly verify its magnitude too. This is an auditor
correction, not a changed payout. Raw logs stay `.local/p26-recovery-*`.

Exact next action: complete the actual Surfpool RPC/WS/legacy parity run and
64-member signed case, then maximum-width/remaining safety acceptance and the clean
P26 pin before publication. P27/P28 remain dependent; P15B/P16B stay external and
24-hour endurance stays Deferred. No unrelated broad suite, PostgreSQL/UI, devnet/
funded deployment, hosted CI, outreach or external review is run or claimed.


R064 runtime continuation: the canonical 64-member signed path passes 680 outcomes
(650 successful / 30 expected rejects) at
`.local/account-safety-runs/20261027T095019343Z-73526/`. Complete-cohort overhead
remains within declared envelopes: two-row Value 267,521 CU, Verify 320,043,
FlowPlan 530,263, order check 273,368 and Reconcile 262,535; maximum packet 1,176.
This cohort includes funded makers/the real bankrupt position and additional empty
registered roots; it does not establish maximum arithmetic width. The independent
raw auditor reproduces all 64 exact Fraction payouts and rejects ten corruptions.
A separate signed complete-resolution→Retired path passes 208 outcomes (190/18)
at `.local/account-safety-runs/20261027T095314623Z-74634/`; its independent audit
also passes. This checks retirement without reactivation or an unused flat proof.

`RIVALT_SAFETY_MAXIMUM_COHORT=1 bash ops/account-safety-smoke.sh` passes on actual
Surfpool HTTP/WS at `.local/account-safety-rpc/20261027T095143Z-73879/`: 680 original
signatures independently finalized, all 563 expected WS outcomes, 119 accounts /
15 program-qualified types and 694 committed events with isolated legacy parity.
All 64 independent raw payouts/recovery/retirement/token checks pass and ten
mutations reject. Largest observed CU is 823,226 (sampling) under its 1.2M budget.
The earlier seven-member RPC run finalized 308 originals but failed its final
comparison because legacy Buffer JSON differs from generated byte arrays. Normalize
legacy Uint8Array values without changing codecs; saved input then independently
passes 62-account/151-event parity. Its missing WS closeout is not claimed. Preserve
that failed run at `.local/account-safety-rpc/20261027T094709Z-72694/`.

All runs above use `ac6b3a6` plus recorded working changes, not a clean final P26
qualification pin. Candidate ordinary activation remains disabled. Exact next
action: signed liquidation/malicious-stage and maximum-width arithmetic/resource
acceptance, followed by the clean P26 build/pin and ready PR above #37. No new
PostgreSQL/UI, broad inherited regression, endurance, devnet or external gate is
claimed; P27 and P28 continue afterward with the stack left open.


R064 commits recovery/retirement as `2113a44` (ready publication still pending full
P26). Extend signed safety coverage with actual pre-bankruptcy liquidation. A
346-outcome SVM run passes at `.local/account-safety-runs/20261027T095935484Z-76281/`;
independent raw equations verify both positions, consumed funding, the 270-atom
cash fee, strict post-fee whole-account deficit improvement and receiver IM. Bad
prices that worsen health, flips, substituted consent, maker receivers and stale
guards reject. Correct the harness's generic arithmetic error expectation to actual
6100; no program rule changes. A separate liquidation→default→direct retirement
RPC run passes 246 finalized originals (223/23), all 166 expected WS, 62-account/
133-event legacy parity and the raw financial audit at
`.local/account-safety-rpc/20261027T100030Z-76584/`; actual liquidation is 95,283 CU.

Add a pure arithmetic SBF resource fixture, with no venue/root/token state or
financial authority. Cargo.lock adds only this local package and reuses exact
existing dependencies. Its first compile catches array seed type inference; use
an explicit byte slice. Fix the fixture's TypeScript account-existence narrowing.
`cargo-build-sbf --manifest-path tests/fixtures/clearing-math/Cargo.toml
--tools-version v1.52 --arch v0 -- --locked` passes the SBF frame guard.
`node --import tsx tests/rpc-contract/account-safety-math-svm.ts` records 18 signed
resource measurements at `.local/account-safety-math/20261027T101218952Z-80439/`,
with actual fixed-width results checked against independent integers. The earlier
15-measurement path `.local/account-safety-math/20261027T100633330Z-78429/` is retained.
The fixture deliberately does not claim successful financial settlement.

Two maximum-width flows use 1,011,805 CU before full clearing context, exceeding the
960,000 CU headroom threshold. Make Verify/FlowPlan one-row continuations and
separate final complete rate/insurance verification. Record the explicit D64
resource amendment; retain all economic/risk rules, account layouts, heap and CU
ceilings. Single-row resource-only maxima are 524,723 CU flows / 391,738 atom floors;
two-market insurance finalization peaks at 423,042. These exclude full-context
costs and do not close the maximum-width venue acceptance obligation.

The changed stage checks pass all 23 focused safety tests (legal ranges now cover
all six paged stages through 64 roots), SBF frame guards, IDL/SDK generation and
TypeScript. Revised 64-member liquidation/default/recovery/retirement passes 787
signed outcomes at `.local/account-safety-runs/20261027T101544468Z-81426/`, with
64 independently reproduced Fraction payouts and ten mutation rejections. This
predates the additional invalid-rate-encoding case and is not a clean final pin.
An actual two-market debtor opened by signed BTC/ETH routes and signed price drops
passes 217 outcomes at `.local/account-safety-runs/20261027T101713146Z-81947/`.
It exercises proportional own-cash collection, both market reserves and two exact
rounding augmentations; independent raw audit reproduces all seven payouts and
rejects ten corruptions. Test proposals now come from the separate Fraction model;
program handlers still verify complete rows and insurance budgets themselves.

Exact next action: finish revised-schedule actual RPC/WS and remaining safety cases,
then pin/rebuild the coherent P26 candidate and publish above #37. The local RPC
rerun initially remains in deployment before beginning signed cases; its owned
runtime reports healthy and the exact clearing program is deployed. No credential
or user decision blocks progress. Do not equate this intermediate dirty-tree
coverage with P26 Review/qualified activation, P27 PostgreSQL or P28 UI/concurrency.

R064 final runtime results: the revised one-row schedule plus separate finalization
passes 791 independently finalized actual RPC outcomes (752 successful / 39 expected
rejects), all 650 expected WS, 119-account/15-type/771-event legacy parity at
`.local/account-safety-rpc/20261027T101824Z-82282/`. Maximum packet is 1,176 bytes;
sampling peaks at 823,232 CU, liquidation 95,289 and rate finalization 281,976.
Independent raw audit reproduces all 64 payouts and rejects ten corruptions.
Source-emergency plus actual two-market default passes 229 SVM outcomes (207/22)
at `.local/account-safety-runs/20261027T102438180Z-83816/`; full live books on target
and receiver plus liquidation passes 369 (330/39) at
`.local/account-safety-runs/20261027T102439153Z-83831/`. The independent audits pass;
liquidation's receiver check now explicitly includes the retained live reservation.
These runs use `2113a44` plus candidate changes, not the final clean P26 pin.

### R065 — 27 October 2026 — P26 resource envelope and pinned acceptance preparation

Continue on `2113a44`, preserving the existing P26 candidate changes and unrelated
user uploads. Inspect current specs, Git and exact installed LiteSVM snapshot API.
Add a separately labelled full-context resource fork of the genuine signed runtime.
Scale derived L/factor to 2,796/5,632 and 186 bits without changing rational payouts;
separate maximum-cash/claim scratch rows exercise double-debt and mixed-sign paths.
This is deliberately not a canonical financial history: no Apply/token movement is
allowed, all financial roots/ledgers/vault remain identical and the parent runtime
is unchanged. Independent BigInt formulas check exact numerators and atom floors.

`RIVALT_SAFETY_MAXIMUM_COHORT=1 RIVALT_SAFETY_TWO_MARKET=1
RIVALT_SAFETY_CONTEXT_BUDGET=1 node --import tsx
tests/rpc-contract/account-safety-svm.ts` passes on the dirty candidate at
`.local/account-safety-runs/20261027T114253609Z-88343/` (258 resource transactions)
and `.local/account-safety-runs/20261027T114429400Z-88702/` (266 including extremal
rows). Both genuine parent histories independently complete 619 signed outcomes
(602 success / 17 expected rejects) with 64-root two-market clearing, separate
from the resource counts. The first parent raw Fraction audit passes all 64 payouts,
two augmentations and ten rejected corruptions. Verify peaks at 774,364 CU and
FlowPlan 638,366; all measured continuations retain 20% headroom under 1.2M and the
default heap. No higher budget, lower precision or relaxed financial rule is used.

Extend the same isolated resource probe to actual proposal upload and complete
remainder/circulation contexts; add default-artifact profile rejection probes and
a self-contained `ops/build-account-safety.sh`. Move this phase's runtime artifact
references into its own explicit build directory. These last additions await their
pinned build/run; no inherited binary is presented as a new clean build. TypeScript
checks pass through the initial resource implementation; final affected checks
remain part of the pin. Update both status tables; P26 stays In progress.

Exact next action: commit/rebuild this coherent candidate, run affected default,
maximum-width and source-emergency/full-book actual RPC qualification, then enable
only the qualified local profile and publish the ready P26 PR above #37. P27/P28
follow without merge waits. No unrelated broad regression, hosted CI, PostgreSQL/UI,
24-hour run, devnet/funded deployment or external review is claimed. P15B/P16B stay
Open external gates and endurance stays Deferred; no access/product blocker exists.

R065 pinned candidate continuation: commit `34cf747` records the bounded schedule,
resource harness and independent raw checks. `bash ops/build-account-safety.sh`
rebuilds default/candidate clearing, both makers and the source fixture on that
clean pin; SBF frame guards, IDL generation and generated-tree parity pass. Manifest
`.local/account-safety/build-manifest.json` records exact hashes and no tracked
changes. Candidate clearing is SHA-256 `d30520441525111be845e88a6a4f91bab72a4bf12c1fec94212f19faed5e637e`.
All 23 focused safety tests pass again on that pin; unrelated 79 host tests are
filtered out. The resource fixture's readonly array initially failed TypeScript
encoding; copy it to the encoder's mutable input shape. The final typecheck passes.

The clean-pinned 64-root two-market SVM run at
`.local/account-safety-runs/20261027T115139648Z-92413/` passes 619 financial outcomes,
three separate default-artifact rejections and 534 separately labelled resource
transactions. Maximum measured full-context proposal/Verify/FlowPlan/finalize/
remainder/circulation costs are 250,651 / 774,364 / 638,366 / 333,538 / 272,859 /
237,068 CU. No Apply or financial account mutation occurs in resource forks.
The genuine signed parent independently reconciles 64 Fraction payouts and rejects
ten corruptions. The separate full-book liquidation/recovery/retirement path at
`.local/account-safety-runs/20261027T115139648Z-92414/` passes 799 financial outcomes
(760/39), eight default-artifact rejection probes and its independent raw audit.

Actual pinned Surfpool full-book/64-root acceptance passes 799 finalized originals,
all 658 expected WS, 119-account/779-event legacy parity and the independent audit
at `.local/account-safety-rpc/20261027T115141Z-92444/`. Actual source-emergency/
two-market acceptance passes 229 finalized originals (207/22), all 167 expected WS,
62-account/134-event legacy parity and seven independently reproduced payouts at
`.local/account-safety-rpc/20261027T115339Z-93090/`. Both report clean `34cf747` and
retain their own logs/transactions locally; owned Surfpool processes are stopped.

Add the missing isolated legacy instruction-shape matrix: 30 variants across all
17 P26 instruction families, including large integers, all paged opcodes, chunk
bytes, maximal permutations and every optional retirement-proof shape. Its first
run exposed the legacy client's requirement for Buffer on a Vec<u8>; add a typed
byte marker only in the isolated conformance transport. The generated instruction
bytes and all account flags then match. No production codec change is made.

Extend actual signed coverage to mixed-sign reciprocal claims on two independently
funded cross roots and to liquidation with live BTC/ETH exposure plus full books.
Preliminary SVM runs pass 238 outcomes (216/22) at
`.local/account-safety-runs/20261027T115821496Z-94458/` and 263 (241/22) at
`.local/account-safety-runs/20261027T115821494Z-94457/`. The cycle resolves both
directions fully with zero insurance use; both independent raw audits pass. The
second case consumes nonzero fractional funding on both markets. Neither test
injects financial root state. Add complete LiteSVM snapshot/reload at partial
valuation, Verify, circulation and Apply; this checks persisted program continuation,
not a claim that P27's durable worker/process recovery is already implemented.

Exact next action: finish those affected cyclic/shared-exposure RPC and restart
checks, add the explicit storage-ready qualified-local activation gate, and publish
P26 above #37. No additional broad/inherited test run or external gate is implied.

Persisted-continuation follow-up passes 238 signed cyclic outcomes with four
complete runtime reloads at `.local/account-safety-runs/20261027T120200268Z-95889/`.
The first attempt exited 137 while comparing entire serialized snapshots after
reload; serialized maps have no canonical byte order. Replace that assertion with
sorted actual program/system/token account equality and exact clock/blockhash
checks, then continue actual signed handlers from their stored cursors. No program
rule changes. The focused 30-variant legacy matrix and TypeScript pass; the two
new RPC scenarios remain the next check on the committed harness.

R065 final candidate additions: commit `05db32b` changes only tests/docs; `git diff
--exit-code 34cf747 05db32b -- programs crates packages/sdk` confirms identical
program/core/SDK sources and the verified binary hashes remain unchanged. The clean
cyclic SVM run `.local/account-safety-runs/20261027T120312297Z-96229/` passes all 238
outcomes and four persisted-state reloads. Actual cyclic RPC passes 238 finalized
originals (216/22), all 176 expected WS and 63-account/146-event parity at
`.local/account-safety-rpc/20261027T120314Z-96269/`; the independent eight-root audit
confirms full reciprocal recovery with zero reserve use. Actual both-market/full-
book liquidation/default passes 263 (241/22), all 183 expected WS, 62-account/
150-event parity and exact seven-root/fractional-funding audits at
`.local/account-safety-rpc/20261027T120317Z-96285/`. Both RPC reports are clean
`05db32b`; both owned runtimes stop. The separate P27 worker/process recovery gate
is not claimed by the program continuation snapshots.

With that candidate safety matrix verified, add the explicit qualified-local
`activate_accounts_v3` transition. It checks the existing authority/Normal-source/
zero-initial-liability contract plus all precreated safety pages and no prior
resolution. The older P24/P25 candidate entrypoint is disabled only in this full
safety profile, preventing a storage bypass; recovered venues retain their separate
reactivation path. The local release marker reflects the explicit safety feature;
default/devnet remain disabled. Record D64's scoped supersession in protocol,
components and roadmap. A new focused storage-readiness host test, 31-variant
legacy ABI parity, IDL generation and TypeScript pass. The final qualified SBF/RPC
run is still required before P26 Review/publication. All inherited P25 ABI
definitions remain identical; the new instruction is additive.

Exact next action: pin/rebuild this qualified-local gate, execute affected signed
activation/default-profile and complete recovery checks, then publish P26 ready
above #37 and proceed to P27. No ordinary production/devnet activation, external
gate closure or deployment is authorized or claimed.

The final affected profile checks pass three schema-3 identity/layout tests in
each of default and explicit safety builds; the release marker is false/true
respectively. `pnpm generate:check` passes. Inherited P25 definitions remain exactly
99 instructions, 29 accounts, 31 events, 99 types and 32 errors; P26 adds 18
instructions, four accounts, 15 events and 21 types without changing those entries.

R065 qualified local closeout: commit `915d8e8` builds clean with the unchanged
SBF frame guard and complete three-program/source artifacts. Qualified clearing
SHA-256 is `213041a4a9ec5a2b4800d53ddd778aa73189c469a1f9643dc00907fa4188cda7`;
maker/source hashes remain identical to the candidate, recorded in the local build
manifest. Full-book/64-root SVM passes 837 financial outcomes (792/45), eight
separate default-artifact rejects and four complete runtime reloads at
`.local/account-safety-runs/20261027T121639258Z-1969/`. Two-market/64-root SVM passes
656 (634/22), three default rejects, four reloads and 534 separate resource probes
at `.local/account-safety-runs/20261027T121639258Z-1968/`. Actual full-context
maximum-width continuation peaks at 774,367 CU under the unchanged limits. The
qualified cyclic SVM passes 275 outcomes and four reloads at
`.local/account-safety-runs/20261027T121846263Z-2792/`. All independent raw audits
reproduce the complete payouts/token/authority/funding results and reject ten
corruptions. These reports record clean `915d8e8`.

Final qualified actual RPC passes 837 independently finalized originals (792/45),
all 672 expected WS, 119-account/15-type/787-event isolated legacy parity and the
independent 64-root audit at `.local/account-safety-rpc/20261027T121726Z-2284/`.
It records clean `915d8e8`. Initial activation costs 49,170 CU, full-book liquidation
101,133, sampling peaks at 823,235 and maximum packet is 1,176 bytes. Partial storage,
old candidate bypass, foreign authority, initial replay and recovered-path bypass
all reject. Actual source-independent owner/reserve exits and irreversible terminal
retirement pass. The owned runtime is stopped. [A31/G20 report](evidence/P26.md)
separates real financial runs, resource-only scratch probes and earlier candidate
pins; no maximum-value live 64-trader portfolio or P27 worker recovery is claimed.

Update protocol/component/current phase/source map to the qualified local boundary.
Wire the actual wide/row/atom reference comparisons and scoped safety/profile host
tests into hosted financial CI; program changes now select that job. Four selector
tests, shell syntax and tracked-evidence policy pass. Do not rerun the broad local
financial/client/UI suites for these CI/documentation/label-only closeout changes;
their new hosted execution is pending publication and is not claimed. Raw evidence
stays at its existing ignored paths. No PostgreSQL/UI/devnet/funded/external or
24-hour result is added. Both status tables move P26 to Review (publication pending),
not Closed; M8 stays In progress. Exact next action: submit the ready P26 stack
child above #37, verify its actual URL/base, then begin P27 on that verified head.


R065 publication: `gh stack submit --auto --open` creates ready
[PR #38](https://github.com/arnabnandikgp/rivalt/pull/38) above
`phase/p25-account-cash` (#37), publication head `ea7e36a`. GitHub independently
reports OPEN / `isDraft: false`; all earlier five PRs stay open and need no rebase.
Update its description with the actual accepted sources, limitations and phase
boundary. P26 remains Review, not Closed; no merge or completed hosted CI/review
is claimed. This publication/status closeout changes no executable code. Exact next
action: `gh stack add phase/p27-account-services`, then implement A32/G21 interfaces
and qualify real RPC/WS/PostgreSQL recovery on the verified P26 parent.


### R066 — 27 October 2026 — P27 finalized account reconstruction (in progress)

Start P27 on `phase/p27-account-services`, containing verified P26 parent
`fe5757a`. GitHub confirms #38 OPEN/ready with that exact head and base #37.
The prior publication finished its remote update but rejected its local metadata
write because the new child was added concurrently. Read-only stack inspection
confirms the P27 parent is `fe5757a`, no rebase is requested and all six PRs remain
open. Defer the next submit until P27 is ready; do not publish an unfinished phase.

Add the [P27 implementation contract](P27-ACCOUNT-SERVICES.md), 24 authenticated
schema-3 critical event decoders, separate financial projection, canonical-PDA and
finalized-byte reconciliation, qualified artifact binding, PostgreSQL store/indexer
and version-3 read endpoints. Reuse the existing append-only journal and loader
verifier. Preserve V1/V2 and P26 financial binaries. During partial Apply, reconcile
mixed roots against remaining original plus applied cash while preserving the frozen
aggregate C/P/I/T; never treat that intermediate sum as available venue cash.
Market claims/fractions, fee carry, isolated slots and reservations are checked.
The API reports accounting facts, not a fabricated current withdrawal allowance.
Wide solver registers remain continuation state, not an event-derived payout model.

Actual checks so far: `pnpm typecheck` passes; six focused
`account-projection.test.ts` regressions pass after correcting the variable-length
initial-event test fixture. Explicit retained finalized histories reconstruct 787,
134, 146 and 150 events (64-root recovery/retirement, source emergency, cyclic
claims, and both-market funding/liquidation respectively). Those are current
projection checks on old financial traces, not fresh financial or P27 acceptance.
The first retained replay found an incorrect display-unit conversion in partial
Apply valuation; corrected to the contract's collateral-atoms-per-lot price. It
now conserves each market separately. Generated Option fields are handled explicitly.
An initial attempted IDL read used nonexistent `target/idl`; the tracked generated
interface is `packages/sdk/idl/clearing.json`. No ABI or program change was needed.

Prepare `ops/account-indexer-smoke.sh` and its signed transport/driver for a fresh
local deployment, PostgreSQL 18.6, four staged indexer restarts, actual failed CPI
exclusion, WS-outage backfill, immutable journal, read HTTP and fresh database
replay. This command has not yet run. Shell syntax and diff whitespace checks pass.
Both status tables retain M8/P27 In progress, P22–P26 Review and P28 Open. No P27
PR exists yet. Direct wallet SDK, durable workers/proposer and the rest of A32 are
still due. Broad inherited suites, SBF rebuild, browser/load/devnet/external/24-hour
checks are not run: unchanged binaries or separate gates. Exact next action: pin
this checkpoint and run `bash ops/account-indexer-smoke.sh`, address actual failures,
then continue P27's direct SDK and durable workers on this branch.


R066 fresh integration result: clean `ba19119898ceb6d0241317f54555dd8a27f61c13`
passes `bash ops/account-indexer-smoke.sh` at
`.local/account-indexer-rpc/20261027T125035Z-13048/`. All 409 signed originals are
independently fetched finalized (363 success, 46 intentional rejection); the actual
WS capture has 244 notifications. The seven-root, full-order-book financial scenario
includes liquidation, complete default, recovery/reactivation and retirement.
Independent raw-byte/Fraction reconciliation passes seven payouts and rejects ten
mutations. Actual PostgreSQL reconstruction and indexer pool/lease/WS restart pass
at partial Value, Verify, completed circulation and partial exactly-once Apply.
These are indexer restarts, not future worker-process restart evidence.

The final venue-address journal retains 248 transactions, 187 committed events,
187 outbox entries and zero unresolved jobs. A reverted two-instruction withdrawal
retains failed CPI/history but no financial events. An actual one-atom funded exit
during WS disconnection is recovered exactly once from its original signature.
Fresh `rivalt_p27_replay` PostgreSQL reconstruction exactly matches all projected
state and 29 finalized accounts; allocated/actual vault both equal 2,002,399,898
atoms. HTTP venue/account/portfolio/trade reads and unhealthy 503, immutable-event
rejection and schema-2 journal incompatibility checks pass. The owned Surfpool and
PostgreSQL container are stopped/deleted; raw database/evidence files stay ignored.

First attempt `.local/account-indexer-rpc/20261027T124816Z-12495/` completed all four
local deployments but stopped before financial checks because the existing Apple
Containers service was not running. `container system start` restored that existing
service; no runtime replacement or installation. No assertions from that attempt
are counted. No SBF rebuild was needed: artifact verification binds unchanged
qualified P26 bytes. Both tables keep M8/P27 In progress. Six earlier PRs remain
open; P27 is not published yet. This checkpoint does not cover direct SDK, durable
financial workers, maximum-cohort PostgreSQL chunking or P28 UI/concurrency. Exact
next action: implement and qualify the schema-3 direct wallet SDK, then complete
the P27 workers and remaining interface acceptance on the same phase branch.


### R067 — 27 October 2026 — P27 direct account SDK (in progress)

Add version-3 local public configuration, qualified artifact/genesis/anchor binding,
canonical one/two-root snapshots, owner portfolio/registration/deposit/allocation,
root-local order/delegate/cancellation, explicit closed-claim netting and atomic
funded withdrawal builders. The ordinary snapshot discovers immutable root/portfolio
identities then fetches its complete financial dependencies in one bounded RPC
batch; it neither scans the venue registry nor rejects solely because unrelated
custody discovery events advanced between reads. Cash intents bind safety/venue
terms and the selected root's nonce/state version. Explicit scoped market payment
certificates remain necessary for netting and do not enter ordinary withdrawals.
Reuse immutable wallet signing/broadcast/reconciliation and exact measured budgets.

Seven focused `packages/sdk/src/account-client.test.ts` consumer/codec tests pass,
including selected-only dependencies, unrelated discovery mutation, atomic exit,
no positive unpaid cash credit, owner/delegate restrictions, schema/alias rejection,
explicit netting certificate and profile/budget selection. `pnpm typecheck` passes
on the final source; it initially caught the new netting builder's generated
`sourceMarket` name and required registry account, corrected before runtime testing.
Shell syntax and whitespace pass. These are SDK tests, not new SBF financial evidence.

Add fresh signed service provisioning and `--direct-sdk`: use the qualified P26
artifact, complete safety storage and actual sources; then stop the read API and
exercise wallet portfolio/accounts/deposits, orders, delegated stale cancellation,
allocation, two atomic exits, an unrelated signed sample between cash preparation
and execution, injected post-send acknowledgement loss/original-signature recovery,
exact token arithmetic and fresh PostgreSQL replay. This runtime command has not
run yet. The default indexer command remains the separate R066 check. Preflight
now checks existing container-service status before spending time on deployment.

Both tables remain M8/P27 In progress; no new PR or acceptance closure. Route
preparation/quotes, current risk previews, durable maker/funding/order/settlement/
risk workers, production untrusted proposer and maximum-cohort interface checks
remain due before P27 Review. No inherited full regression/SBF rebuild, P28 browser/
concurrency, devnet/external/funded or 24-hour check is run. Exact next action: pin
this checkpoint, execute `bash ops/account-indexer-smoke.sh --direct-sdk`, address
actual failures, then continue the same P27 branch's remaining interfaces/workers.


R067 fresh direct acceptance passes on clean
`9e269697d6876a25b4034507695c8940071b2aee` at
`.local/account-direct-rpc/20261027T130842Z-17845/` using
`bash ops/account-indexer-smoke.sh --direct-sdk`. All 14 wallet originals finalize
with exact saved-wire/RPC equality after the API is stopped. Actual post-submit
acknowledgement loss recovers the original deposit. Owner/delegate cancellation
works with stale sources; a signed sampler update between preparing and executing
a flat cash exit does not invalidate its root-local guard. Two withdrawals each
perform the account check and token transfer in one instruction/transaction; no
verification-only certificate transaction or registry scan is involved.

The independent literal account/token arithmetic is cross C=49,978, isolated
C=50,012 and wallet/vault/custody delta=99,990 atoms after 50,000 per-root deposits,
17-atom allocation and two 5-atom exits. Claims and I/T/carries are unchanged.
Maximum wallet packet 702 bytes; maximum 91,662 CU within 400k, total 70,000 test
lamports. All 158 setup/source originals are independently finalized separately;
23 actual indexer WS observations and identical fresh PostgreSQL replay reconcile
26 accounts/nine members. This is an API-independent flat SDK lifecycle, not route,
whole-account risk-preview or sustained concurrent-exit acceptance. No SBF rebuild
or unrelated regression was run. Owned runtimes cleaned up; raw data stays ignored.

[The incremental P27 report](evidence/P27.md) records both checkpoints and open
acceptance explicitly. Both tables retain P27/M8 In progress; no P27 PR yet and all
six earlier PRs remain open. Exact next action: finish the actual 64-root PostgreSQL
chunk/restart check on the unchanged indexer, then continue routing/current risk
previews and durable workers on the same phase branch.


### R068 — 27 October 2026 — P27 maximum cohort and account routing (in progress)

`RIVALT_ACCOUNT_MAXIMUM_COHORT=1 bash ops/account-indexer-smoke.sh` passes on clean
`98e2e4939153988edea33c9ad30541d8c18df2fa` at
`.local/account-indexer-rpc/20261027T131338Z-19121/`: 839 signed originals,
793 successful and 46 expected rejections, independently finalized; 674 transport
WS notifications. The independent raw Fraction audit checks 64 exact payouts,
one augmentation, recovery/retirement/token invariants and rejects ten corruptions.
Four PostgreSQL close/reopen checkpoints reconcile 118 accounts across the RPC
100-account boundary at partial Value, partial Verify, persisted circulation and
partial Apply. The final 119-account/64-member reconciliation and fresh database
replay match exactly: 678 venue-address transactions, 788 events/outbox records,
zero unresolved; allocated/actual vault 2,002,399,898 atoms, no unallocated surplus.
Owned Surfpool and PostgreSQL runtimes are cleaned up. No SBF rebuild.

Add schema-3 current balance and route SDK interfaces. V2/V3 wrappers now share
pure two-market funding/claim/reservation/admission arithmetic while retaining
separate identity, mode and exit policies. V3 indicative exit headroom tests all
four held-funding corners and labels current sources, pause/freeze and terminal
requirements; it never reports an authorized withdrawal amount. Route discovery
reads only the trader and selected market's two authenticated maker capitals and
pricing/code dependencies, then uses one bounded financial RPC batch. It binds
current root/safety/terms, maker epochs and consumed prefixes, without signing an
old observation or global discovery sequence. A/B allocation, 2 bps taker fee,
zero provider fee and exact stored-order prefix remain unchanged.

Add focused literal risk/allocation and codec/authentication cases plus the fresh
`--route-sdk` harness: signed owner routes, permissionless existing-position TP,
independent four-fill/whole-account funding/cash/fee-split checks, unrelated sampler
between signed preparation and execution, stale consumed-prefix rejection and
fresh PostgreSQL replay. Runtime acceptance is pending on a clean checkpoint.
Validation: `pnpm typecheck` passes; focused SDK tests pass (seven existing group
balance, nine group allocation, seven direct account client, six account balance
and eight account route cases). `bash -n ops/account-indexer-smoke.sh` and
`git diff --check` pass. The inherited group tests are relevant to the shared
arithmetic extraction; no other old suites are rerun.
The initial new fixture mutation test used a misspelled loader owner string; the
fixture is corrected to retain the actual original loader owner. No financial
implementation change resulted from that failure.

Both live tables keep M8/P27 In progress and P22A–P26 Review, with P28 Open. No new
PR is published. Durable maker/funding/order/settlement/risk workers and production
untrusted proposer remain due. No inherited full regression, program rebuild,
devnet/external/funded run, P28 UI/concurrency or deferred 24-hour qualification is
run. Exact next action: execute the fresh `--route-sdk` command on a clean pinned
commit, resolve actual failures, then continue the same phase's durable services.

R068 first route integration on clean
`a0bd27b3dc51e116d6f0311580f5e3ec74c8822b` stops before the second fill at
`.local/account-route-rpc/20261027T133323Z-24437/`. The deposit and first two-maker
BTC wallet route independently finalize, and the route survives the signed ETH
sample after preparation. The next ETH route is correctly refused because BTC
is Degraded: actual oracle events show BTC samples seven seconds apart after the
intentional interleaving/finality wait, resetting its required six-second recovery.
This is incomplete acceptance, not an SDK financial bypass or a passed route run.
The harness now observes bounded actual recovery (up to five fresh two-second
sampling rounds) before proceeding, and saves per-fill inputs/captures immediately
for diagnosis. No risk/source rule changes. Owned runtimes cleaned up. Both tables
retain P27/M8 In progress; exact next action is the same focused fresh `--route-sdk`
run on this corrected harness pin, then durable service implementation.


R068 corrected route integration passes on clean
`8267a27547133709d49a624d1031c58e84be704e` at
`.local/account-route-rpc/20261027T133716Z-25537/` with
`bash ops/account-indexer-smoke.sh --route-sdk`. Five wallet originals independently
finalize (deposit, three owner fills, existing-position TP placement); 214 separately
signed setup/source/keeper outcomes finalize, including the permissionless TP fill
and one intentional stale maker-consumption rejection. Four independently literal
fill vectors reconcile exact A/B marginal sums, whole-account materialized funding,
zero provider cash fees and 25% insurance/carry allocation. Cross cash is exactly
1,997,586 after 2,414 taker-fee atoms; both positions close, while unpaid claims and
fractional funding remain explicitly on their market slots. The signed first BTC
route lands after an unrelated ETH sampler write. Twenty-eight indexer WS
observations and identical fresh PostgreSQL replay reconcile 23 accounts/seven
members; actual/allocated vault is 2,004,000,000, zero surplus. Wallet maximum is
1,093 bytes / 456,261 CU, within the 600k envelope with >20% headroom; five wallet
transactions pay 25,000 test lamports. Owned runtimes cleaned up.

A subsequent focused preview review tightens custody/terminal labels to the actual
`liability_free` predicate: expired but still-active order records, cached reserves
and order reserves must be cleared, not just excluded from current live risk.
The six account-balance cases include these negatives; no on-chain behavior or
source policy changes. This small preview guard is separately unit-checked, not
claimed to be part of the preceding runtime pin. Current specs already require an
unsettled terminal account to expose no indicative exit capacity.

SDK/current-risk/routing and finalized indexer checkpoints are now recorded in
[evidence](evidence/P27.md); P27/A32 remains In progress pending durable service
workers, production untrusted rate proposal and process/fault acceptance. Both
status tables retain M8 In progress, P22A–P26 Review and P28 Open. No new PR,
inherited broad regression, SBF rebuild, UI/concurrency, external or 24-hour run.
Exact next action: implement schema-3 durable execution/authority and workers,
then qualify their original-signature/process recovery on fresh RPC/WS/PostgreSQL.


### R069 — 27 October 2026 — P27 exact untrusted rate proposer (in progress)

Implement the production TypeScript proposer with normalized bigint rational
arithmetic, complete two-market claim identities, proportional whole-cash debt
collection, exact capped claim links, greatest fixed-point branch intersections,
market insurance spend/fraction flags and the bounded 1,560-byte proposal/hash.
It proposes one current evaluation; only clearing decides verification and any
next insurance-clipping pass. No worker trusts it for payouts, and it imports no
Python test reference, external service, evidence file or floating-point arithmetic.

The current frozen-state reader discovers the canonical resolution then fetches
venue/safety/registry/header and all up-to-32 pages in one bounded RPC batch. It
checks schema/PDA/owner, exact freeze/epoch/stage, membership version/hash/order,
complete non-applied rows, cash/collection/positive-claim aggregates, insurance and
on-chain common denominator. It rejects changing or incomplete frozen snapshots.
Service execution and live default-worker wiring remain pending; these exports do
not submit transactions or expose a successful financial stub.

Actual checks: `pnpm typecheck` and focused Vitest files
`packages/services/src/account-rate-proposal.test.ts` (eight cases) and
`account-frozen-proposal.test.ts` (five cases) pass. The proposer cases include
378 independently closed-form coupled equations, 80 new deterministic fractional
cohorts cross-checked against the independent Python Fraction oracle, explicit
market/cycle/insurance goldens, three insurance clipping passes and a 64-root
common denominator exceeding 5,000 bits. Frozen-reader tests reject incomplete,
misordered, foreign, applied or changed-stage inputs and aggregate mismatches.
Initial development caught an incorrectly transcribed three-pass fixture and a
non-exported assertion helper reference; the complete four-row fixture and native
assertions correct them. Neither failure warranted an economic-policy change.

Targeted development comparisons on the retained R066 seven-root and R068 64-root
financial captures show exact proposal/common/factor/numerator and serialized
registry-hash parity with their recorded on-chain verification. This is a new
consumer comparison on existing inputs, **not new live proposal acceptance**.
Fresh producer upload/verification must run with the durable risk-worker lifecycle.
No new runtime or inherited full financial/SBF suite was launched for this helper.

Both status tables retain M8/P27 In progress, P22A–P26 Review and P28 Open. Six
existing PRs stay open; no P27 publication or closure. Exact next action: implement
schema-3 durable authority/ingress/execution, then wire maker/funding/order/
settlement/risk workers and qualify original-signature/process recovery using
fresh Surfpool/RPC/WS/PostgreSQL and this proposer.


### R070 — 27 October 2026 — P27 durable execution infrastructure (in progress)

R069 implementation is committed as
`ddbe7fb79ef70cb75833f0eab73bca6e2b0d4e67`; its 13 tests and retained-input
comparisons remain helper/consumer checks, not fresh worker-default acceptance.

Add schema-3 durable execution over the existing immutable signed-intent queue
and PostgreSQL journal. Bind services to the qualified artifact set and exact
venue genesis/anchor. Wallet ingress uses generated schema parsers for each
allowed owner/delegate action, exact payload/account counts, one signer/action,
explicit measured 400k/600k compute and zero priority price. It binds the actual
owner/actor and venue without copying V2 positional assumptions. No sponsorship
or operator-only action enters wallet ingress.

Root state-version, selected-market observation and maker-sync epoch proofs use
canonical schema-3 accounts. Only finalized blockhash expiry plus unchanged
relevant authority can prove no economic success. Missing or changed state stays
unresolved; a possible hidden failed fee stays reserved. Deposits/registration/
custody actions without a signed pre-state stamp retain no invented replacement
proof. Original pending/unresolved wire bytes remain immutable and retry unchanged.
Four maker budgets, two market-funding budgets and order/settlement/risk budgets
are separate local lamport allowances, not collateral or insurance. Add the
market/maker heartbeat table; no worker pretends to be running yet.

Actual checks: `pnpm typecheck` passes after fixing two overly narrow negative-test
fixture types. Focused tests pass: account authority (three), signed ingress (five),
queue fault behavior (three), plus affected inherited group authority (four), group
ingress (five) and immutable retry/recovery (nine). The 29 distinct cases include
wrong owner/venue/schema/PDAs, trailers/extra accounts, unsafe fees/envelopes,
finalized expiry, unresolved changed state, retained fee reservation and identical
post-ack-loss retries. `git diff --check` passes. The queue cases are explicit unit
transport fixtures, not actual PostgreSQL/process acceptance. No new integrated
run, SBF rebuild, unrelated whole suite, hosted CI, P28 or external check is claimed.

Both live tables retain P27/M8 In progress and all six predecessor PRs in Review;
P28 stays Open. No P27 PR is opened prematurely. Exact next action: wire the real
schema-3 maker/funding/order/settlement/risk worker loops to these execution and
proposal primitives, then qualify actual durable submission/restart/default and
replay on fresh Surfpool/RPC/WS/PostgreSQL before submitting P27.

R070 implementation checkpoint:
`ea81a6756725b9b8a57bf4ab70d0b655881482d5` (same source as the passing focused
checks above). A fresh `gh pr list --state open --json ...` confirms #32, #33, #35,
#36, #37 and #38 are all open, non-draft and retain their sequential bases. P27
has no PR yet. The tracked worktree is clean; unrelated `phoenix/` and the supplied
design note remain untouched/untracked. No access/product blocker; the exact next
action remains worker wiring and fresh integrated fault/default acceptance.


### R071 — 27 October 2026 — P27 worker implementation and live qualification

Wire schema-3 maker publication/synchronization, independent market funding,
permissionless stored orders, market-scoped claim collection/payment and consenting
liquidation/complete default workers into the durable execution queue. Add separate
CLI processes and version-3 quote/submission API. Ordinary quotes do not acquire
a pending-sampler barrier. Owner netting, emergency freeze, resume/reactivation
and retirement remain explicit actions. Default uploads use current frozen rows
and exact production proposals; remainder order and continuation come from current
chain state. No reference process or retained acceptance capture authorizes runtime
financial actions.

Add a focused fresh RPC/WS/PostgreSQL harness for all worker roles, actual executor
acknowledgement loss/SIGKILL, maker restart, stored TP, settlement, liquidation,
proposal/verification/application restarts, sustained source recovery, explicit
authority resume and owner exit. A separate raw-byte Fraction auditor checks
actual payout ownership, financial conservation and post-fee liquidation. This
harness is not yet acceptance evidence.

Actual checks so far: `pnpm typecheck` passes; four new worker financial/remainder
checks pass and the existing eight exact-proposer/five frozen-reader cases pass.
Development corrected a variable-length registry test fixture and copied harness
transport/exit return-type mismatches. No program/IDL change or SBF rebuild; no
unrelated inherited full suite, hosted CI, soak, devnet or P28 evidence claimed.
Both tables retain P27/M8 In progress, predecessor phases Review and P28 Open.
Next: execute `bash ops/account-indexer-smoke.sh --workers` on this committed
source, fix actual failures, record outcomes and submit P27 ready for review, then
continue P28 in the open stack.

R071 first live attempt, clean `b324e9c`, command above, retained at
`.local/account-workers-rpc/20261027T155703Z-53560/`: fresh deployment/PG, actual
executor lost-ack/SIGKILL recovery (one two-atom deposit), four maker heartbeats/
restart, independent samplers, API wallet route, process TP fill, ordinary claim
collection/certified gains and a consenting liquidation ran. The next scenario
correctly refused a new route: the harness replenished cash without accounting
for the target's remaining closed loss after liquidation. No complete default,
final replay/audit or A32 pass is claimed. Fix the harness to flatten residual
exposure and fund its measured risk-equity shortfall, retaining the unpaid claim
and all admission rules; save the intermediate liquidation/quote input explicitly.
Owned runtime cleanup completed. Next: rerun the same focused worker gate.

R071 second live attempt, clean `bb9a4cde5410f381e1040d6b55eff468bc4cf722`,
`.local/account-workers-rpc/20261027T160218Z-55707/`: all 139 durable originals
finalized and 432 setup/source originals independently finalized. Actual maker
restart, TP, settlement, consenting liquidation, exact on-chain proposal upload,
SIGKILL/restart at partial upload (512 bytes), verification (row 1) and Apply
(row 2), indexer reopen, complete default, sustained recovery and explicit resume
plus a 100-atom terminal cash exit ran. Independent raw-byte Fraction audit passes
seven exact payouts, one circulation augmentation and four corruption negatives.
Fresh PostgreSQL replay matches; final 29-account/seven-member reconciliation
at sequence 206 has vault/allocation 2,002,707,133 and zero surplus. Maximum
worker CU 823,235 / packet 1,176 bytes. All spent budgets reconcile; 43 WS
notifications after the indexer restart are recorded, not the whole-run WS total.

Despite the harness's completion, inspection exposed 72 repeated intermediate
projection failures: `AccountResolutionCompletedV3` carries `[u8;2]` as canonical
hex, but reconstruction indexed its characters. A later withdrawal's complete
ledger snapshot masked that error in final parity. P27 therefore remains In
progress. Decode the actual two bytes and assert per-market carries below four;
add encoder-through-journal regression and reject unexpected indexing errors in
the harness. Also strengthen acceptance to force real maker epoch publication/
sync (earlier heartbeat-only run spent zero maker lamports) and actual finalized
expiry with unchanged authority and retained fee reservation. Next: rerun only
this affected worker gate on the corrected clean source; no SBF/full-suite rerun.

User-authorized storage cleanup: removed exactly 49 inactive `postgres-data`
directories after verifying no running container mounted them; retained the
latest qualification database and every other evidence/log/key/configuration
file. `.local` fell from 5.0 GiB to 1.7 GiB; measured free disk became 5.4 GiB.
The ignored removal manifest is `.local/storage-cleanup/20261027.json`. Earlier
run database copies no longer exist; their signed captures and reports remain.
This is storage maintenance, not new financial acceptance or a blanket evidence
retention change.

Carry correction checks: all seven account-projection tests pass, including
encoded fixed-byte carries `[3,1]`, `[0,0]`, `[2,3]` at both completion stages and
a malformed-carry rejection. `pnpm typecheck` passes after correcting the harness
exception-module import. The retained second-run raw financial audit also passes
with a fifth corruption targeting fee carry; this is a consumer recheck, not a
new live run. Next action remains the strengthened fresh worker gate.

R071 third attempt, clean `05cc6ec`,
`.local/account-workers-rpc/20261027T161517Z-59228/`, stopped during the new
renewal setup: maker simulation correctly returned Lifetime/6002 because an
active epoch cannot be replaced early. No new worker/default acceptance. Correct
the fixture to initialize valid 720-slot epochs (the default setup remains
3,600), let activation complete, then wait for actual expiry before daemon start.
This tests real owner renewal without changing the maker program or safeguards.
The owned runtime was cleaned; this failed-run database remains retained because
the earlier deletion authorization covered the enumerated 49 older copies only.


R071 final acceptance, clean `13b558f4a3329b2c6a004422f2d12cbd6c40ad7f`:
`bash ops/account-indexer-smoke.sh --workers` passes at
`.local/account-workers-rpc/20261027T162214Z-61062/`. Actual maker expiry/renewal/
sync, immutable lost-ack/executor recovery, TP, settlement, liquidation, exact
proposal upload, three risk process restarts, indexer reopen, complete default,
sustained recovery, explicit resume and 100-atom exit pass. Of 153 durable
originals, 152 finalize and one deliberately unbroadcast original expires with
unchanged authority; its 20,000-lamport reservation is retained. There are 462
separate signed setup/source outcomes, and 44 indexer WS notifications after
restart. Fresh PostgreSQL replay matches sequence 215, 29 accounts/seven roots,
slot 6804, actual/allocated vault 2,002,707,133 atoms with zero surplus. Independent
Fraction/raw-byte audit verifies seven exact payouts, one circulation augmentation,
post-fee liquidation/funding/recovery/exit and five corruption rejections.

The saved-wire resource audit verifies at least 20% declared CU headroom for every
finalized worker original: maximum 823,234 CU, 1,176 bytes, 23 message accounts
(maxima occur on different paths). All scoped spent budgets reconcile; only the
intentional expiry retains a commitment. Completion-event carries remain consistent
through intermediate reconciliation; no unexpected projection failure is hidden
by later events. [The report](evidence/P27.md) records per-role denominators and
prior failures. Scoped projection/worker/proposer/frozen-reader checks and
`pnpm typecheck` pass; `git diff --check` passes. No program/IDL change, new SBF
build, unrelated full suite, hosted CI, devnet, soak or P28 acceptance is claimed.
Both tables retain M8 In progress and move P27 to Review; ready publication is
next, followed immediately by P28 UI/bounded qualification. Stack stays open.

R071 publication: `gh stack submit --auto --open` creates ready PR #39 above
`phase/p26-account-safety`, head `b0b589c`. All seven phase PRs stay open.
P27 remains Review pending integration; next create P28 above this exact accepted
parent and implement A33. No hosted CI or external review result is inferred.

### R072 — 27 October 2026 — P28 account UI and concurrent qualification

Created `phase/p28-account-ui` with `gh stack add`, retaining verified P27
`9498d2e` / ready PR #39. Both tables show P28/M8 In progress; predecessors
remain Review. Pin the 300-second/150-offer workload, six busy funded exits and
source/maker/indexer fault windows in [the phase contract](P28-ACCOUNT-QUALIFICATION.md)
before execution. Browser and workload evidence are pending; do not inherit old
P21/P27 counts. Next: implement account-aware UI, then fresh scoped qualification.

R072 implementation checkpoint: version-3 UI adds portfolios 0–3, immutable
cross/isolated accounts 0–8, selected-root current preparation, explicit cash
allocation, BTC/ETH routes/orders/TP-SL/delegates, direct exits and saved-original
recovery. Shared presentation widgets retain separate V2/V3 controllers. New
SDK owner discovery authenticates canonical portfolio children without scanning
the venue registry. Read API latest-history support accompanies the UI.

The new browser/load drivers extend the actual fresh worker environment with the
pinned population, six busy exits, source/maker/indexer interruptions, followed
by fresh complete default/recovery and database rebuild. An independent raw-byte
auditor reconstructs maker marginal pricing, both funding slots, cash/fees/carry,
market ownership and token conservation. These drivers have not executed yet.
Fifteen focused SDK/order-form/receipt cases, `pnpm typecheck` and trader build
pass; build reports its existing-size chunk advisory. A formatting command found
no installed Prettier and made no changes. No new dependencies or program build.
Next: commit this checkpoint and execute `bash ops/account-indexer-smoke.sh
--qualification`, address actual failures, then publish P28 ready above #39.

R072 first live attempt, clean `dfdbc95`,
`.local/account-qualification-rpc/20261027T164936Z-68507/`: real browser passes
17 independently fetched wallet originals and seven named lifecycle/authority/
API-loss checks. All six signed busy exits finalize after unrelated trades and
sampler advances. Of 150 scheduled offers, 114 finalize and 36 are unavailable:
19 required-source, five expiring-quote and 12 combined capacity/health refusals.
Source/maker/indexer fault windows execute. The run stops during post-window
closeout on a refused quote, so no final audit/default/replay or A33 pass. Owned
runtimes are cleaned and raw evidence/this database are retained.

Inspection shows all four makers renewing around closeout; the generic quote
classification obscured unsynchronized/expired epochs. Add explicit renewable
maker-state diagnostics and bounded recorded closeout retries. Waiting for
original finality also delayed scheduled offers (last completes at 304,777 ms);
the amended pinned harness records entirely missed slots as driver backpressure
instead of replaying them late. Driver refusals and HTTP quote availability must
have distinct denominators. Improve the UI's retained account selection, existing
balance-grid styling, and assert finalized labels/history after reload. These
changes do not loosen any program/source/risk guard. Next: scoped checks, pin the
correction, and rerun only P28's affected fresh qualification.

Observed P27 CI: scope/client/financial/shell pass on hosted run 40542871085;
report is skipped. CodeRabbit check reports pass, which is not independent audit
approval. PR #39 and the prior stack remain open.

R072 correction checks: maker expiry/unsynchronized/admission/offline reason
regression passes; `pnpm typecheck`, trader build and diff whitespace checks pass.
Partial raw financial captures now checkpoint alongside load outcomes, and the
independent final checkpoint must match the last captured financial transition.
No unrelated suites, SBF build or full-day run. Exact next action: run the same
fresh `--qualification` gate on this clean correction, retaining both attempts.

R072 second attempt, clean `a8ab4c0`,
`.local/account-qualification-rpc/20261027T170227Z-71892/`: browser again passes
17 originals, now including exact funded/position displays, latest fill history
and retained selection/direct RPC balances after API-loss reload. A retained
partial independent audit verifies 22 actual fills, one busy exit and five
corruptions. The population later has 28 completed fills, seven driver refusals
and two completed busy exits before the harness's next original deadline expires.
No complete workload/default/replay qualification is claimed.

Read-only diagnosis of the retained PostgreSQL journal proves that original
`4847Tzgx…Pdtz` finalized at slot 4879, fee 5,000, error null; the queue records
three attempts and final status. Its timestamps jump from 17:06:47 to 17:21:48
UTC. `pmset -g log` independently records Clamshell Sleep at 22:36:48 IST for
900 seconds, followed by maintenance wake. This is a suspended host, not evidence
of an economic/retry failure. The original journal payload is retained locally
as `recovered-original.json`; the owned diagnostic database container is stopped
and removed. Original bytes are never replaced. Add process-scoped macOS
`caffeinate -is` to the finite qualification wrapper (no global power setting;
explicit lid closure still suspends the host). Remove a raw internal enum from
the UI caption; this is copy only. Next: run the same qualification with the host
awake, preserving the interrupted attempt as a limitation.

R072 third attempt, clean `f595fd74beb3112219b20ef5dab547d679c1d587`,
`.local/account-qualification-rpc/20261027T173831Z-75752/`: browser passes 17 wallet
originals and all seven checks. The 300-second schedule completes its last original
at 301,164 ms and drain/audit at 306,897 ms. Of 150 scheduled intents, 30 are driver
backpressure, 120 actually request quotes, 110 submit/finalize and ten are refused
(eight required-source, two maker-renewal). All 108 observed both-Normal quote
attempts finalize; two additional reductions finalize under allowed conditions.
All six one-atom ETH-exposed withdrawals finalize with original bytes after an
unrelated trade and a sampler advance. The independent audit passes 112 actual
fills (110 scheduled plus two separate drains), six exits and five corruptions.
Max workload route: 259,283 CU / 901 bytes / 18 accounts; exits 79,033 CU / 702 bytes.
Submission-to-finality p50/p95 is 2,255/2,481 ms; these include the sequential
driver/executor polling and do not establish venue throughput.

The later settlement assertion times out because it incorrectly requires every
maker to be flat: actual ETH maker quantities are -1/+1 after competing-maker
round trips. This is legitimate isolated inventory; all trader slots are flat,
closed claims have settled to sub-atom residuals, and actual BTC maker gains paid.
No complete A33/default/replay pass is claimed. Preserve exposure rather than
force it away. Qualify ordinary certified gains on the initial seven-root state
before the nine-root workload, then carry residual inventory/claims through
complete default. The affected `--workload` entrypoint uses real signed SDK
provisioning without rerunning the already-passing browser suite. Strengthen the
normal settlement gate to require actual finalized loss and gain jobs and only
require closed slots to have sub-atom claims. No production financial code changes.

Both tables keep P28/M8 In progress; P27 and predecessors stay Review. Tests not
repeated: browser, unchanged SDK/form cases, programs/SBF/ABI, full suite/devnet/
endurance. Next: typecheck and commit the fixture correction, then run `bash
ops/account-indexer-smoke.sh --workload` on a clean revision, completing its fresh
recovery and PostgreSQL replay before ready publication.

R072 fourth attempt, clean `2d40c24ece48d79bf79ae605ef9721917306978b`,
`.local/account-workload-rpc/20261027T175501Z-81046/`: normal actual loss/gain jobs
pass before the workload. The 300-second population records 150 scheduled,
123 attempted quotes, 112 finalized submissions, 27 driver-backpressure slots and
11 refused quotes (ten required-source, one renewal). All 111 observed both-Normal
quotes finalize. Six busy exits pass; 114-fill/six-exit independent audit and five
corruptions pass. Default completes with real proposal/Verify/Apply restarts,
source recovery, authority resume and actual 100-atom exit. A separate raw-byte
Fraction audit confirms all nine payouts, two circulation augmentations, post-fee
liquidation progress and five corruption rejections.

The final strict gate catches an unexpected intermediate indexer-cycle error;
it refuses to hide that error behind successful later reconciliation. No complete
A33/fresh replay is claimed. The harness previously kept those diagnostics only
in memory until success, so persist each retry immediately and emit unexpected
errors; retain the same strict acceptance assertion. This is diagnostic coverage,
not a new exception or relaxed readiness rule. Both tables retain P28/M8 In
progress. Next: pin the diagnostic change and repeat only the affected fresh
`--workload` gate to capture and resolve the exact error; do not rerun browser,
SBF, inherited full suites or devnet. Raw evidence/database remain local.

R072 diagnostic run, clean `81f391d`,
`.local/account-workload-rpc/20261027T180940Z-84626/`: captures the exact transient
errors at 18:16:09/18:17:37 UTC: repeated history pagination signature, then a
critical sequence gap. Later cycles recover, but the strict final gate again
fails; no fresh replay or complete A33 is claimed. Workload independently verifies
119 actual fills (116 scheduled plus three drains) and six busy exits, with five
corruptions rejected. The same default/recovery/exit flow executes. A bounded
read-only 29-page/557-signature diagnostic finds no duplicate after the transient;
32 fetched same-slot originals retain descending critical order. These later
reads do not establish the earlier provider's precise cause. A failed root-level
Node diagnostic import is corrected using the existing indexer workspace, without
adding dependencies.

Implement bounded finalized-history read recovery: on those two specific input
conflicts, discard the candidate and rescan from the durable checkpoint at most
twice. No missing rows are skipped, no financial/identity errors are waived and
no incomplete projection becomes healthy. Add persistent/transient overlap/gap
cases and a duplicate-critical-sequence negative; retain original economic-error,
older-state, tail and batch-bound coverage. Record per-instance indexer metrics
across intentional restarts. D66/components document the shared transport change.
Both tables retain P28/M8 In progress. Next: finish scoped history/type checks,
commit, then run the affected fresh workload/default/replay gate on the correction.
Browser, programs/SBF/ABI, devnet and unrelated local suites remain unrerun.

R072 history correction checks pass: 12 focused `finalized-indexer.test.ts` cases,
`pnpm typecheck`, diff whitespace and evidence policy. The V1/V2 projections already
require the same contiguous critical sequence; the transport precheck preserves
that contract. Exact next action: pin this correction, then execute only
`bash ops/account-indexer-smoke.sh --workload` on its clean revision.

R072 final acceptance (28 October local / 27 October UTC), clean
`5491752df10a4280114d5e042a73984681908015`,
`.local/account-workload-rpc/20261027T182447Z-89677/`: `bash
ops/account-indexer-smoke.sh --workload` passes end to end. Of 150 scheduled intents,
123 request quotes and 115 submit/finalize; 27 are driver backpressure, six required-
source refusals and two maker renewals. All 113 observed both-Normal attempts
finalize, plus two allowed reductions. All six ETH-exposed one-atom withdrawals
finalize with their original bytes after unrelated fills and sampler advances.
Three separate drain fills complete. Independent raw-byte audit verifies 118
fills/six exits with five corruption rejections. The last original completes at
300,828 ms; drain/audit ends at 308,056 ms. Max scheduled route 259,341 CU / 901 bytes /
18 accounts; p50/p95 finality latency 2,268/2,354 ms; no throughput claim.

The same fresh environment completes actual lost acknowledgement/executor SIGKILL,
maker publication/sync/restart, TP fill, normal collection/certified gains,
consenting post-fee liquidation, complete nine-root default with three risk
restarts and indexer reopen, sustained source recovery, explicit authority resume
and a 100-atom withdrawal. 581 durable originals finalize; one actual unbroadcast
expiry retains its 20,000-lamport risk commitment and has no economic effect.
Another 1,518 setup/source originals are independently fetched without errors.
All actual wires/fees match. Maximum durable use: 818,735 CU, 1,176 bytes, 23
accounts (different paths); every durable/setup source original has at least 20%
declared CU headroom. Per-budget fees reconcile to actual RPC records.

Four full history rescans discard incomplete candidates and recover from durable
checkpoints; 41 sequence-ahead tail extensions and one expected externally retried
sequence-ahead cycle occur. There are zero unexpected financial/identity errors.
WS counters across three instances are 364/129/67, not distinct transaction counts.
Final sequence 646, slot 13,639 reconciles 33 accounts/nine roots against exactly
2,004,707,117 allocated/actual vault atoms and zero surplus. A fresh PostgreSQL
database reconstructs identical state. Independent Fraction audit verifies all
nine payouts, one circulation augmentation, frozen funding, insurance/carry,
strict post-fee liquidation progress and actual exit; five corruptions rejected.

The browser retains its separate passing clean `f595fd7` pin: 17 originals,
seven named checks, zero page errors; API access blocked from that browser,
direct cancel/withdraw, retained selection/history and exact balances verified.
Browser/UI code is unchanged by the final history/fixture correction. Original
browser resource audit passes 20% CU headroom; max 259,271 CU / 901 bytes / 18
accounts, 85,000 test lamports. Visual inspection confirms the retained screenshot.
[The P28 report](evidence/P28.md) preserves all attempts, exact denominators and
remaining profit-certificate coordination limits; [operations](P28-OPERATIONS.md)
documents explicit configuration, current test limits and reproduction.

Both tables advance P28 and M8 to Review, not Closed. The qualified artifacts,
fees, financial/authority rules, oracle limits and V1/V2 economics are unchanged.
Affected specs/D66 are updated; raw evidence stays ignored/local. Scoped history
regressions (12), earlier SDK/UI/quote cases, typecheck/build, shell syntax and
evidence policy pass. A report-only budget helper initially compared decimal
strings without conversion; it is corrected to explicit integers and confirms
all source headroom, without another runtime test. No browser repeat, program/
IDL/SBF build, inherited full suite, V1/V2 runtime, devnet, 24-hour run or external
review. P28 hosted CI/publication still pending. Exact next action: check changed
document links/diff/evidence policy, commit and publish a ready P28 PR above #39;
keep the stack open and record the actual remote result.

R072 documentation closeout: all 250 local file links and fenced blocks in changed
Markdown pass; diff whitespace and tracked-evidence policy pass. The final evidence
report and operations guide contain only concise Markdown, with raw captures at
existing ignored paths. Next: commit this closeout and publish P28 ready above #39.

R072 publication: `gh stack submit --auto --open` succeeds and creates ready
[PR #40](https://github.com/arnabnandikgp/rivalt/pull/40), source head
`ac894f15e79ce2dc6360d1903054e75ed1db07ae`, base `phase/p27-account-services`.
Actual GitHub metadata confirms OPEN / isDraft=false, and all eight phase PRs
#32/#33/#35/#36/#37/#38/#39/#40 remain open/ready with the intended consecutive
bases. No phase is merged or marked Closed. The PR description matches the final
implementation and evidence. Hosted run `40562352370` has scope/report/shell
success; client/financial and CodeRabbit are still running at this observation.
No hosted pass or independent review is inferred. Both status tables record
Review; exact next action is to address actual review/check findings while keeping
the stack open. This publication note changes documentation only; runtime pins
and all qualification results remain those above.


## R073 — P22–P28 full-stack review remediation (28 October 2026)

User authorization now includes addressing all reviews and merging the stack.
Inspected all eight ready PRs (#32/#33/#35/#36/#37/#38/#39/#40), inline threads,
submitted review bodies and discussion comments. There are 11 inline findings and
one additional serialization-fixture suggestion. Six inline findings are already
addressed downstream (including ACTIVE deposits in P25 `12a23e6`); preserve their
historical phase checkpoints and resolve against the final integrated tree.

Delivered receiver-version metadata for safe liquidation expiry recovery, visible
role-labelled operator account slots with trader gating, V3 latest/cursor rejection,
explicit runbook environment loading, corrected D59/D60 reference wording and
nonzero/distinct nested route serialization fixtures with a swapped-market negative.
The new event regression is included in the existing hosted financial job. Affected
component/service contracts and D67 are updated. Both status tables retain Review
until actual merge. Raw reviews remain ignored at `.local/reviews/R073/`.

Focused validation: four Vitest files / seven cases pass across the real risk
worker plus expiry queue, queue acknowledgment/expiry consumers, both Fastify
history endpoints and SSR account UI using real SDK-decoded fixtures. The single
Rust borrowed/owned route-event wire test passes (102 unrelated tests filtered).
TypeScript and trader production build pass; existing Vite bundle-size and Anchor
macro cfg warnings remain. Initial new fixture attempts failed on omitted registry
membershipVersion and invalid cross subaccount identity; corrected canonical
fixtures pass. Type-only test setup corrections also pass. No runtime financial
success is inferred from consumer fixtures.

No program/IDL/SBF rebuild, unrelated local full suites, fresh RPC/WS/PostgreSQL
qualification, devnet, endurance or external review was run: financial runtime and
qualified artifacts are unchanged; P27/P28 retain their recorded real integration
pins. Refreshed broad regressions belong to the existing scoped hosted workflow.
The initial remote snapshot confirms every selected inherited check passed (or
was scope-skipped); remediation CI and merge are not yet claimed. No access or
product blocker. Exact next action: finish documentation/diff/evidence checks,
commit and submit the coherent fix at PR #40, then resolve verified findings and
merge the complete stack after refreshed checks.


R073 integration closeout: remediation commit `e6ba2cfdbdb41dbfe037453ed75444f3baf94aa3`
is published with `gh stack submit --auto --open` on existing PR #40. All 11 inline
threads are resolved through authenticated `gh api graphql`; the read-capable
connector could not mutate reviews (`Resource not accessible by integration`).
No user access change was needed. The final full-stack sweep confirms zero
unresolved threads, no requested changes, unchanged reviewed heads and CLEAN merge
states. Every selected inherited check passes or is scope-skipped. Refreshed
[run 40576656720](https://github.com/arnabnandikgp/rivalt/actions/runs/40576656720)
passes scope/client/report/financial/shell on exact `e6ba2cf`; incremental CodeRabbit
is neutral/skipped, not a new review approval. The local changed-document check
passes 193 links/fences, diff whitespace and tracked-evidence policy.

`gh stack merge --yes --merge` succeeds for all eight PRs. Independent GraphQL
verification confirms every PR MERGED at common commit
`0916b9dc7896f9cdfc68081ad56daa93dabf3d94`. `git fetch origin main`, `git switch main`
and `git merge --ff-only origin/main` synchronize the local baseline. Its tree
`08b7c1f65ae0ea6d6d20ecc5c426975700ce2efd` exactly equals reviewed `e6ba2cf`.
Both tables now close P22A/P22B/P23/P24/P25/P26/P27/P28 and M8; roadmap, README,
D67 and this report record integration while preserving historical acceptance pins.
Raw captures remain in ignored `.local/reviews/R073/`; unrelated `phoenix/` and
`rivalt-isolated-cross-margin-design.md` remain untouched/untracked. No new runtime
or financial tests are warranted for this documentation-only merge closeout.
P15B/P16B remain Open and endurance Deferred. No outstanding review/access blocker.
Exact next action: commit/publish the documentation closeout and verify clean local/
remote `main`; implementation and stack integration are then complete.


## R074 — P28A interactive local environment (28 October 2026)

The user authorizes the first recommended follow-up only. Read current specs and
Git state; preserve untracked `phoenix/` and the design proposal. Created
`phase/p28a-local-demo` above integrated `4338af6` with `gh stack init`. D68/P28A/M9
record this extension without reopening M8. A real installed Surfpool persistence
probe retains balances/history but changes genesis and resets slot 56 to 1; result
at ignored `.local/demo-persistence-probe/result.json`. Stopped its owned process
(after graceful exit hung, used SIGKILL on its verified PID). No existing DB copy,
raw phase evidence or user work was deleted. Existing Apple Containers was stopped;
started that service without installing/replacing the user's runtime.

Implemented one-DB interactive supervisor, explicit control lifecycle and deployment
configuration, real signed provisioning, unchanged existing workers, bounded logs,
finite lease/disk guards, local-origin faucet and opt-in browser-generated local
wallet. The wallet signs only after current deployment authentication and explicit
confirmation; keys never enter server responses. Documents explain immutable
accounts, funded cash/unpaid claims and stop/reset semantics. A small private local
workspace package reuses exact installed dependencies; offline pnpm install added
no downloads. Typecheck/build and scoped wallet/faucet tests are being completed.
No actual interactive/browser acceptance or PR is claimed yet. Both new status
rows remain In progress. No program rebuild, broad local regression, real devnet,
external participant or endurance run is warranted for this scope. Exact next
action: commit the coherent implementation, run fresh launcher/browser/stop/reset
acceptance on that pin, fix only demonstrated defects, and publish ready.


R074 first-launch correction: clean `81d5682` deploys all four qualified programs
and starts PostgreSQL, but the first provisioning SOL transfer is rejected by
`sendTransaction` before venue creation. The original signature/wire and failed
session stage remain in `.local/interactive-demo/sessions/20261028063101477-5a145c05`.
The generic RPC wrapper did not retain the underlying error, so its exact cause is
not claimed. Match send preflight to the confirmed blockhash commitment explicitly,
retain initial confirmed simulation and any structured submission error, and
verify the returned signature. Owned runtime cleanup completes. Both new rows
remain In progress. Exact next action: commit this transport-only correction and
reset the owned disposable demo state for a new launcher attempt.


R074 interactive continuation: `dc471de` reaches ready with actual Normal BTC/ETH,
four live internal makers, acknowledged WS and reconciled PostgreSQL. Its first
interactive session stops on the existing low-disk guard (about 539 MiB free);
the owned DB/logs occupy only 49 MiB. Reclaimed about 950 MiB of rebuildable
`target/{debug,release,sbpf-solana-solana,flycheck0}` compiler output, preserving
qualified binaries, evidence and user files. A fresh session reaches ready and
a second start returns the same session/venue. Browser acceptance then identifies
`process is not defined` in generated SDK code served by Vite development mode,
before any wallet transaction. Change this launcher to build/serve the production
UI, matching existing qualification. Failed captures remain at
`.local/demo-checks/R074-first` and `R074-browser`; no browser pass is claimed.
Fix malformed new status-table row placement and an obsolete README stack sentence.
Both M9/P28A remain In progress. Exact next action: commit the launcher correction,
verify owned stop, and rerun fresh startup/browser/reset acceptance. No financial,
IDL/SBF, broad legacy, devnet or endurance suite is needed for this correction.


R074 browser harness correction: clean `f79bdf5` starts the compiled UI and the real
browser wallet successfully creates a portfolio/account and deposits 10 test USD.
The new harness incorrectly assumed receipt array order, repeatedly fetched the
old portfolio original and attempted another deposit before its actual original
was finalized. The UI correctly blocked the unresolved action. Fix the harness to
select the newly added signature by set difference and await that exact original.
Retain the failed run at `.local/demo-checks/R074-production`; it does not count as
full browser acceptance. No application/financial change is needed. Both status
rows remain In progress; next action is rerunning the corrected wallet lifecycle.


R074 wallet lifecycle: `87099f7` passes all 13 distinct signed wallet originals on
the `f79bdf5` production runtime: portfolio, cross/isolated accounts, deposits,
explicit 0.5 allocation, BTC/ETH opens, TP/SL/cancel, both closes and exactly one
test USD token withdrawal. Actual wallet decline creates no original; reload
restores the same account and all finalized receipts. Zero browser errors.
Evidence: `.local/demo-checks/R074-originals`. The screenshot also captures a
transient indexed-history refusal while reconciliation is active; direct balances
and exits succeed. Match the standalone indexer's one-second delay *after* each
cycle instead of a fixed timer, retaining fail-closed readiness and independently
running the disk guard. Add a final indexed-fill-display check. Typecheck and
evidence/shell checks pass. Both tables remain In progress until this final fresh
startup/browser/control check; no new economic or API readiness rule is introduced.


R074 control correction: the final immediate port check on `704e79d` catches
PostgreSQL still listening after `stop` reports completion. The control handler
blocks briefly during synchronous container shutdown, and the old one-second
HTTP timeout was incorrectly treated as process exit. Cleanup subsequently
finishes and all listeners/container disappear; this is not a persistent orphan.
Fix stop to wait for its authenticated recorded process to exit **and** all owned
ports to release; only connection refusal means no control listener, while timeout/
reset errors remain errors. Final focused wallet/faucet/UI tests pass 3/3 and
typecheck passes. Raw control failure retained at `.local/demo-checks/R074-controls`.
M9/P28A remain In progress; exact next action is fresh reset/browser and immediate
stop/reset verification on the corrected launcher, then ready PR publication.


R074 acceptance closeout: final runtime/browser/control pin
`4f809d31065d21a23e017c41e23d765bf4ea8758` passes fresh startup and all 13 distinct
wallet originals, independent original-wire/history checks, both account modes,
exact allocation balances, BTC/ETH opens/closes, TP/SL/cancel, actual signature
decline, a 1,000,000-atom token withdrawal, reload and all four indexed fills.
Zero browser errors; final screenshot inspected. The immediate stop check now
passes every owned port and container check before returning. Ended-chain start
refuses, reset changes session/venue/genesis, repeated start is idempotent, and
UI/config return HTTP 200. A fresh usable 60-minute demo remains running.

Evidence stays ignored at `.local/demo-checks/R074-final`,
`R074-final-controls` and `.local/interactive-demo/sessions/`; concise results
are [P28A](evidence/P28A.md). Three focused Vitest cases, final TypeScript, actual
production UI build, shell syntax, evidence policy and 311 local documentation
links/fences pass. Only the existing Vite bundle-size warning remains. Broader
financial/Rust/SBF/IDL regression, devnet, external wallet/participant qualification,
funded deployment and endurance are not run: program/economic paths are unchanged
and outside this follow-up. Hosted results are not yet claimed. Both new tables
move to Review, not Closed; original M8 stays Closed. No outstanding runtime/access
blocker. Exact next action: commit the evidence/spec closeout, submit with
`gh stack submit --auto --open`, and record the ready PR and observed hosted checks.


R074 publication: `gh stack submit --auto --open` creates ready
[PR #41](https://github.com/arnabnandikgp/rivalt/pull/41) above `main`, head
`338506557b9c51a14f505b112168b0a339542384`. Metadata independently confirms OPEN and
`isDraft=false`; the final description covers the whole launcher/wallet deliverable.
Both status rows remain Review. Actual listener inspection confirms all seven
ports bind 127.0.0.1; the one current DB is 67 MiB and retained session logs total
1.1 MiB at this observation. Final changed-document validation passes 316 local
links/fences, with evidence policy and diff whitespace clean. Untracked `phoenix/`
and the original design proposal remain untouched. No new local tests are needed
for this publication-only documentation update. Hosted scope/shell pass and
financial/report jobs are scope-skipped; client/CodeRabbit are still running at
this observation, not claimed complete. Exact next action: record the selected
hosted outcome, publish this metadata and leave PR #41 open for review.

R074 hosted outcome: [run 40648078942](https://github.com/arnabnandikgp/rivalt/actions/runs/40648078942)
succeeds on exact `3385065`: scope, client (generated-client check, TypeScript,
Vitest and trader build) and shell pass; unrelated financial/report jobs are
intentionally scope-skipped. CodeRabbit was still running at the last observation;
no independent review approval is claimed. The remaining metadata change affects
only documentation and leaves the verified `4f809d3` runtime unchanged. Next
action after publication: address actual PR #41 review findings when available;
keep the PR open and leave M9/P28A in Review until authorized integration.


## R075 — user demo evaluation and shutdown (28 October 2026)

The user tried the UI, found it acceptable for now, requested shutdown and wants
to discuss the next work. On `17e36d7`, `bash ops/demo.sh stop` reports already
stopped; the retained session `ended.json` records the low-disk guard. Independent
`ops/check-ports.py` checks all seven demo listeners free and `container list
--format json` returns no running containers. No reset, deletion or restart is
performed. Existing evidence and unrelated untracked files remain untouched.

PR #41 remains open/ready. Read-only review inspection finds two unresolved minor
comments concerning early supervisor exit and faucet allowance on definite versus
ambiguous submission failure; remediation is not claimed. Both M9/P28A rows remain
Review. No tests are rerun for this operational/documentation-only action, and no
new financial/deployment phase or economic decision is authorized by the discussion.
Exact next action: agree the next scope, with PR #41 review cleanup first and a
focused profit-payment progress investigation recommended before schema-3 devnet/
maker-kit updates. P15B/P16B remain Open; endurance remains Deferred.


## R076 — P28A review remediation and authorized merge (28 October 2026)

The user requests addressing PR #41 reviews and explicitly adds merge authorization.
Inspected Git state, current contracts, all review threads (pagination complete),
submitted reviews and discussion comments. Exactly two inline findings are valid:
early supervisor exit could wait through startup polling, and a definite faucet
failure consumed the one-grant allowance. Added child exit/error observation and
explicit send outcomes, with a small session-local faucet admission controller.
Preparation/preflight rejection releases a grant; finalized failure also releases
it, while confirmed failure, unknown history, lost acknowledgment and other
ambiguous results retain it. Successful faucet responses now await finality.
No financial program, source safeguard, artifact or production deployment changes.

`pnpm exec vitest run packages/local-demo/src/processes.test.ts
packages/local-demo/src/faucet.test.ts packages/local-demo/src/transport.test.ts
--maxWorkers=1 --no-file-parallelism` passes 3 files / 16 cases. Tests use actual
child processes and actual signed transactions with scripted RPC faults, including
durable original-before-send checks; they are not fresh on-chain acceptance.
The demo remains stopped. No browser/Surfpool/PostgreSQL restart, financial/Rust/
IDL suite or endurance run is warranted for these error paths. Local TypeScript
and build are delegated to the existing hosted client job because free disk is
about 318 MiB; no user data or evidence is deleted. The generic bot docstring-
percentage warning is advisory, not a repository gate; added focused documentation
for the changed boundaries rather than unrelated comment churn.

Raw review/test captures remain ignored at `.local/reviews/R076/`. The unrelated
`phoenix/`, newly observed `GoonFi_V2/` and design proposal remain untouched.
Both M9/P28A remain Review until
actual integration. Exact next action: commit/publish the cohesive corrections,
verify refreshed hosted checks, resolve the two findings and merge PR #41; then
record the integrated commit and stop until the user chooses the next work.

R076 hosted correction: published runtime remediation `f4ee9c8`. Hosted run
`40678061790` passes scope/shell but TypeScript rejects an inferred `never` in
the new faucet concurrency fixture's deferred callback. Add explicit `void`/
callback promise types; this changes the test only. The 16 runtime-focused local
cases already passed, but no hosted client pass is claimed for that failed run.
Both rows remain Review; exact next action is publish the fixture correction,
verify the refreshed client job and complete the authorized merge.

R076 integration closeout: fixture-only correction `ba73bcd` passes the two
affected local cases. [Hosted run 40678439011](https://github.com/arnabnandikgp/rivalt/actions/runs/40678439011)
succeeds on exact `ba73bcdfc128470de7c9969a6e2185124873f479`: generated-client
consistency, TypeScript, hosted Vitest and trader build pass in client; scope/shell
pass; unrelated financial/report jobs are scope-skipped. CodeRabbit is neutral,
not a fresh review approval. All review threads are resolved; final inspection
shows zero unresolved findings, no requested changes and CLEAN/MERGEABLE state.

The branch was managed/published with `gh stack`; its single-PR merge command
reported no submitted remote stack despite identifying PR #41. Used GitHub's normal
`gh pr merge 41 --merge --match-head-commit ba73bcdfc128470de7c9969a6e2185124873f479`
fallback without bypassing checks. Independent metadata confirms MERGED at
`350e60ca1de2de77b9ed2a80a16b0aa5eb5aa481`. Fetched main, switched and fast-forwarded;
its tree exactly equals the checked head (`ea3a96ed66c4f99e3d68cc5a012ac76880e12813`).
Both tables now close P28A/M9 within the original local-evaluation scope.

Raw outcomes remain at `.local/reviews/R076/`; concise evidence/spec/roadmap are
updated in this documentation-only closeout. No runtime or unrelated local suites
are rerun. The demo remains stopped, no user files/evidence were deleted and no
next phase is started. Exact next action: publish this closeout on main and await
the user's next instruction. P15B/P16B remain Open; endurance stays Deferred.

## R077 — maker quoting and routing architecture assessment (28 October 2026)

Scope: the user requests an explanation and deep assessment before another
development cycle. Inspected baseline `1c59592eeaf96f0f2fec144ea0a5e63eebeff933`;
this is not a new numbered implementation phase. Both status tables retain
P28A/M9 Closed and note the separate research. P15B/P16B and deferred endurance
are unchanged.

Delivered [the assessment](MAKER-QUOTING-ASSESSMENT.md): source-level GoonFi tier,
cumulative-price, inventory, consumption/decay, staleness and route-context
findings; primary Jupiter adapter/parity, Phoenix spline and Meteora bin references;
actual Rivalt code-to-proposal gaps; configurable curves/common quote contract,
funding implications and a bounded proposed evaluation. The supplied GoonFi
metadata identifies an incomplete reconstruction, so no binary equivalence,
deployed behavior or real aggregator-adapter conformance is claimed. Its external
price-context publisher is outside the inspected implementation.

Actual checks: `git status --short --branch`, `git rev-parse HEAD`, targeted
`rg`/`sed` source/specification inspection, Python metadata extraction and source
SHA-256, primary-source web reads, and documentation diff/link validation. Runtime
tests, financial suites, builds, CI and qualification were not run: executable
behavior is unchanged. Existing test counts remain historical evidence. No
vendor program was executed, no archive downloaded, and no service restarted.

The coherent documentation change is retained as a reviewable local research
commit; no implementation PR is opened. Current protocol decisions and delivery
phases remain authoritative, so no supersession is recorded for an unaccepted
proposal. User-supplied `GoonFi_V2/`, `phoenix/` and the prior design note stay
untracked and untouched; raw evidence remains in its original local paths.

Blockers: none for this assessment. Custom pricing admission, funding sampling,
replenishment and a possible bounded-latest quote policy are design questions for
the proposed next contract, not silently implemented choices. Exact next action:
discuss the recommendation with the user before defining or starting a bounded
prototype; agree quantitative acceptance rather than opening a long new stack.

## R078 — P29A maker-liquidity roadmap (28 October 2026)

The user accepts R077's five proposed changes and requests phase-scoped planning.
Delivered [P29–P34 / M10](P29-MAKER-LIQUIDITY-ROADMAP.md), D69 and G22–G26:
P29A roadmap, P29B exact executable contract/reference, P30 canonical curve/update
module, P31 generic best-singleton/pair allocation, P32 safe clearing/funding and
comparative prototype gate, P33 services/UI/kit, P34 concurrent qualification.
The A/B suffix separates planning from contract closure, following P22's convention.
No later implementation phase is started by this run.

Recorded existing-code coupling at `1c59592` / research `8ca0691`: fixed strategy
constants/identities, clearing's exact formula recomputation, expired-only update,
fixed pair allocator and funding evaluator. The plan targets at least three
separately funded maker instances per market while retaining at most two execution legs;
G22 must freeze feasible exact bounds, race/funding semantics and numeric comparison
tolerances before implementation. P32 must pass real financial/resource evidence
before consumer expansion. Unknown/custom modules, risk relaxation, changed
financial loss/fee/insurance policy, external pools/hedges, paid/funded deployment
and a new 24-hour requirement are excluded.

Updated both status tables, delivery plan, decisions, product/protocol/component/
validation pointers, README and AGENTS phase range. Existing qualifications are
retained, not reused as proof for new behavior. All supplied research files stay
untracked/untouched; the demo remains stopped. P15B/P16B remain external Open gates.

Checks: `git diff --check` and `python3 ops/check-evidence-policy.py` pass.
The scoped Python documentation check passes across 11 changed documents and 354
existing local link targets, balanced fences, seven consistent phase rows and five
unique new gate IDs; later phases remain Open. Fetched `origin/main` and confirmed
it still equals `1c59592`. Roadmap commit `bb53b53` is published through
`gh stack init --base main phase/p29a-maker-roadmap` and
`gh stack submit --auto --open` as [PR #42](https://github.com/arnabnandikgp/rivalt/pull/42).
Independent `gh pr view` confirms OPEN, `isDraft=false`, base `main`, exact roadmap
head `bb53b5325812ddec6b1100ea0e933edf1d069c7e`. Both status tables now record
P29A Review/M10 In progress. CodeRabbit was still running at inspection; no new
review approval or hosted test pass is claimed. No runtime tests,
financial suites, builds or RPC/PostgreSQL run are needed or claimed for this plan;
the hosted workflow excludes documentation-only changes. No new runtime benchmark
is reported. Blockers: none for planning. Exact next action: present ready PR #42
and the seven-PR plan; P29B is the proposed next step when execution is directed.


## R079 — P29B canonical maker contract and independent reference (28 October 2026)

The user authorizes proceeding through the accepted plan. D70 supersedes D69's
planning-only boundary while preserving open stacked PRs and all external gates.
Created `phase/p29b-maker-contract` with `gh stack add`, above P29A `ca14b86`.
Inspected actual maker/registration/route/funding/whole-root admission code and
retained the user research directories and stopped demo unchanged.

Delivered [P29B's contract](P29B-MAKER-CONTRACT.md): exact profile-4 account layouts
and quote/route/control ABI, fixed three-maker registry with unique capital,
eight-region canonical pricing and integer inventory potential, reprice/shape/
replenish authority, bounded-latest execution with strict security/shape/depth epochs,
complete executable funding coverage and causal structural-update truncation.
Retain schema-3 financial accounts, fees/insurance, risk and loss ownership. G22
pins lookup-table provisioning, packet/search/CU envelopes and quantitative P32/P34
workloads before measurements. No runtime instruction or activation is added.

Added an independent Python reference and 26 scoped checks: literal notional
vectors, separate per-lot evaluation, fragmented fills/round trips, region/capacity
bounds, update/replenish races, whole-root negative/fractional claims and fees,
Cartesian-versus-pair enumeration including nonprefix feasibility, complete funding,
causal truncation, layouts and transaction-size envelopes. First run caught an
incorrect hand-written three-maker expected total (4015 instead of4014); direct
per-lot sums confirmed maker0+maker2 wins, and the literal vector was corrected.
This was a reference expectation error, not a production behavior change.

Actual working-tree checks: `python3 tests/financial/test_maker_curve_contract.py`
passes26; `git diff --check`, `python3 ops/check-evidence-policy.py` and
`bash -n ops/financial.sh` pass. The new suite is included in hosted financial
regression; that broader suite was not rerun locally. No Rust/SBF/SDK builds,
RPC/WS/PostgreSQL runs or performance/compute measurements are claimed: these
remain the owning implementation phases' acceptance. Resource figures are a
serialization-size model, not fetched transactions. No raw evidence was tracked.

Candidate preparation checkpoint: pending exact committed rerun and publication.
Blockers: none. Exact next action: verify the committed P29B candidate, publish its
ready PR above #42, then implement P30 canonical curves and update/control paths.

R079 pinned verification: candidate `b0c504a394a3b7b5a3fbd779088fa46825542d4b`
passes all26 scoped Python tests, evidence policy, shell syntax and diff checks.
The documentation check passes12 changed Markdown files,368 local link targets,
balanced fences and all seven phase rows. A34B/G22 design/reference acceptance
is complete and P29B enters Review; runtime feasibility and implementation remain
P30–P34. No external test/CI result is inferred. Exact next action: submit the ready
P29B PR above #42, verify its published head/base, then begin P30.

R079 publication: `gh stack submit --auto --open` creates ready
[PR #43](https://github.com/arnabnandikgp/rivalt/pull/43) above #42. Independent
`gh pr view` confirms OPEN, `isDraft=false`, base `phase/p29a-maker-roadmap`,
published head `cfea5192b0875266c2ff194c29b69679c63d478d`. No merge or CI/review pass
is claimed. Both status tables record Review. Exact next action: branch P30 above
this verified contract and implement the canonical curve/update module and parity.


## R080 — P30 canonical arithmetic and native/SDK parity (28 October 2026)

Continued directly after publishing P29B: `gh stack add phase/p30-canonical-maker`
creates the dependent branch above `b4f43a4` / PR #43. Implemented checked canonical
Rust arithmetic and bounded shape/request/response/config/price payloads in
`maker-interface::canonical`, finite dual-clock expiry, owner/updater CAS publication
and exact producer/return-byte validation. Legacy dispatch and all program handlers
remain unchanged. Added SDK bigint quoting plus separate native/SDK wire drivers
consuming the independent P29B reference expectations.

Actual candidate checks: `cargo test --locked -p maker-interface canonical::tests`
passes5; `cargo build --locked -p maker-interface --bin curve-reference-driver`
passes; `pnpm exec vitest run packages/sdk/src/canonical-quote.test.ts` passes9.
`python3 tests/financial/check_maker_curve_parity.py` passes2,884 vectors for each
implementation (1,481 exact quotes and1,403 expected rejections). After splitting
the CI entrypoints, both `--implementation rust` and `--implementation sdk` pass
those same vectors. Focused `tsc` over the new SDK/test/driver, `rustfmt --check`,
`git diff --check`, shell syntax and four `test_ci_scope.py` checks pass.

Initial development failures were an unclosed Rust delimiter and using a serialization
convenience method absent from the pinned Anchor/Borsh version. Fixed both; use the
existing `AnchorSerialize::serialize` API. Neither failure reached a deployed program.
The scoped crate build used cached dependencies; no new dependency or lockfile change.
Available disk space is3.7GiB after the build; no database or raw evidence copy created.

Configured hosted financial/client jobs for the relevant native/SDK parity and
ensured maker-interface-only edits select the financial job. Broad regression is
left to CI; no new hosted pass is claimed. No SBF build, generated ABI/legacy-client
parity, Surfpool/RPC/WS/PostgreSQL check, resource measurement or deployment is
claimed in this checkpoint. P30 stays In progress, not Review.

Blockers: none. Exact next action: implement fresh profile-4 custody provisioning
and actual maker account/control instructions, keeping all new trading gated, then
prove generated ABI and signed local RPC/WS parity for the complete P30 lifecycle.


## R081 — P30 on-chain lifecycle, generated ABI and size-based v1 transport (28 October 2026)

Continued on `phase/p30-canonical-maker` above `ad179d4`, preserving the research
directories and stopped demo. Implemented the profile4 custody-only entrypoint,
fixed registry/capital binding, two canonical maker programs, scoped owner/delegate
repricing and restricted controller shape/permission/mode lifecycle. Added explicit
replenishment, module-independent quarantine and joint hash approval. New financial
activation remains disabled. Structural operations reject active/held financial
state; P32 must implement causal funding integration before allowing it.

Build corrections: a registration stack frame exceeded the4,096-byte SBF limit;
move complete decoded-config validation into an uninlined helper before writes.
Six default/qualified SBF builds then pass with no stack-overflow diagnostics.
Generated event types initially imported nested account types incorrectly; use
separate discriminator-free payload structs and check byte parity. IDL generation
and TypeScript checking now pass. No dependency/lockfile change.

D71 follows the user's transaction-format instruction and explicitly supersedes
mandatory ALT provisioning. Measured signed single-control1,222bytes (10 spare),
initialization1,039, reprice460 and approval775 all fit v0. The genuine two-market
atomic control pair is1,896 bytes in v0 (664 over),1,854 in v1,22 loaded keys.
Surfpool accepts that v1 transaction; standard RPC fetch matches signed bytes and
both decoders, with WS confirmation and629,056/800,000CU. Actual local evidence:
`.local/canonical-maker/runs/20261028T163536Z-61219/transaction-85.json`, original
signature`5sQ4ifM3Wbszz1a2Cyg4B9NUHS68NunWhpCjfQ6g3akbdA1hVHjqS5hJeai7BuhDxJVnNvZjuyXxh18A8rtaYcjP`.
This was a dirty-tree development run based on`ad179d4`, not final phase acceptance.

Actual checks: `cargo test --locked -p maker-interface canonical::tests` passes7;
clearing `instructions::maker_liquidity::tests` passes4 both default and combined
`maker-liquidity-qualification,account-safety-qualification`; focused Vitest passes9
quote and5 transport cases. The26 Python contract checks pass. Both `sbf-a` and
`sbf-b` selections in `check_maker_curve_parity.py` pass2,884 independent cases each:
1,481 exact quotes and1,403 expected rejections. The signed compiled lifecycle
passes123 cases/16 rejections with6,000,000 test-collateral atoms reconciled across
six isolated accounts and the real vault. Isolated legacy Anchor matches104
instruction encodings/metas across16 APIs and20 actual account decodes; RPC event
parity remains pending. Full TypeScript, generation check, shell syntax and evidence
policy pass. No full matrix or unrelated inherited financial suite ran; broad
regression stays in CI, with no hosted pass claimed.

Development RPC failures were (1) a fixture registering makers before both markets
existed, (2) an eight-region positive-spread quote anchored at the global maximum
price, correctly rejected by marginal bounds, and (3) a test incorrectly expecting
shape replacement to invalidate the anchor. Correct the fixtures: initialize both
markets, use900,000 anchor with independently summed marginals, and reject the old
shape-bound request as specified. The implementation/economic contract did not
change to satisfy these expectations. Fast SBF execution now validates the entire
corrected lifecycle before another RPC run.

The RPC run also exposed WS `err:null` for a finalized rejected transaction. Retain
that discrepancy; WS only triggers authoritative finalized fetch. Failed signed
transactions must remain rejected and preserve all tracked state; do not treat the
notification as success. Full corrected RPC/event acceptance is next, not claimed.
Raw logs/transactions remain local; no archives/database copies. Available disk
was2.0GiB at the last check. No external access blocker; only remaining phase checks.

User steering: stop after opening the ready P30 PR; do not start P31. Exact next
action: commit the coherent candidate, run the corrected pinned RPC/WS and event
parity gate, record its actual measurements, then submit P30 above #43 and stop.


R081 pinned candidate preparation: committed implementation at
`2d6fcddeaef59b638eb4d897563e81a1c0e91aef`. Rebuilt all six artifacts and generated
IDL/SDK from that clean tracked tree; no changed generated files. Before final RPC,
add a post-simulation signature-subscription acknowledgement and fresh log cursor
so simulation notifications cannot satisfy the landing check. Preserve both log
and signature WS payloads alongside authoritative fetched status. This is a
qualification-harness correction, with program sources/artifacts unchanged.
Exact next action: run the pinned full RPC/WS/event parity check, publish P30 and stop.


R081 final acceptance: clean tracked RPC revision
`e9ee447c99fa7913bfb0be328674a7375e867995`, with identical program/SDK sources to
clean artifact build`2d6fcdd`, passes all123 signed/finalized/fetched scenarios
(107 successes,16 expected rejections). The post-simulation WS barrier observes
123 log and123 signature notifications. All signature statuses agree with finalized
RPC; all16 rejected log hints misleadingly report`err:null`. Raw failed statuses,
logs and unchanged-state assertions are retained, never applied as success.
Isolated Anchor matches104 instruction encodings/metas across16 APIs,20 actual
account decodes and78 committed events. See [P30 report](evidence/P30.md) for exact
byte/CU/latency/fee populations and artifact hashes. Raw evidence remains at
`.local/canonical-maker/runs/20261028T165549Z-69894/`.

Final coverage audit added288 one-sided/reduce-only/consumption reference vectors;
Rust, SDK and both actual SBF evaluators each pass3,172 total (1,547 quotes and
1,625 rejections). This only expands the test generator; it does not change the
program, SDK or RPC harness tested above. The unchanged scoped SDK suite passes14
on the pinned source. Both status tables now record P30 Review, never Closed.
Broad CI, PostgreSQL, routing, financial activation and wallet compatibility were
not run or claimed; they are outside P30. P15B/P16B and deferred24h remain unchanged.
Exact next action: commit the final report/coverage addition, submit the ready P30
PR above #43, verify its base/head/non-draft state, record publication and stop.


R081 closeout checks: the scoped new Rust files pass`rustfmt --check` after moving
one import into canonical order; this is formatting only, with no executable
change. The final follow-up contains reference-vector coverage, affected specs and
report/status updates. Runtime evidence remains pinned to the recorded build and
RPC revisions; no repeat deployment is required for an import-order/doc-only edit.


R081 publication: `gh stack submit --auto --open` creates ready
[PR #45](https://github.com/arnabnandikgp/rivalt/pull/45) above #43 in stack#44.
Independent `gh pr view` confirms OPEN,`isDraft=false`, base
`phase/p29b-maker-contract`, head`phase/p30-canonical-maker` at
`0d067791e8d800fe65d1ff028fd7e7e2d930c11d`. The title/body now describe the complete
P30 implementation, acceptance, WS limitation and remaining financial gates.
Both status tables retain Review; no merge, hosted CI pass or external review is
claimed. Local test validator was stopped by its owned-process trap; user demo
remains stopped. Exact next action: answer the user's questions; do not begin P31.

## R082 — P31 authenticated discovery and exact allocation (28 October 2026)

- User resumes P31–P34 after the P30 stop/discussion. Create `phase/p31-canonical-router`
  through `gh stack add` above exact P30 `b7e76e3` / ready PR #45. Preserve all three
  unrelated research paths. D72 records the resume and separate 48-key RPC discovery
  bound; both status tables mark P31/M10 In progress.
- Implement authenticated three-instance canonical adapters, coherent profile-4
  discovery, exhaustive singleton/pair allocation and shared whole-account
  funding/risk/reservation admission. Preview only; no program/financial activation.
  Extract existing real provisioner/transport for scoped P31 quote acceptance.
- Development checks: 27 focused adapter/allocation cases and 415 independent
  exhaustive reference cases pass (198 allocated, 145 unavailable, 72 rejected).
  Initial fixture import/type annotations were corrected; final affected reader
  regression, clean runtime and full-width search measurements remain pending.
- New raw evidence will remain local/ignored. P30 binaries and qualifications are
  unchanged. No PostgreSQL, browser, whole financial suite, devnet or endurance run:
  these do not test P31's changed preview interfaces; broader SDK regression is in
  CI, not claimed run here. No new PR or A36/G24 completion yet; no external blocker.
- Exact next action: pin this coherent implementation, run the scoped real
  Surfpool adapter comparisons and 1,000-search latency gate, then record results
  and publish the ready P31 PR above #45 before continuing P32.

R082 pre-runtime correction: a late extra check incorrectly expected a stored bump
in `CapitalBindingV3`, whose 106-byte layout intentionally has no bump field. The
positive adapter cases exposed it before runtime qualification. Remove that field
assumption and retain canonical PDA derivation plus exact owner/layout/venue/
capital/registration checks. Final typecheck and 44 focused SDK cases pass. The
415-case independent comparison still matches; no program artifact changes.

R082 pinned development observations on `79a8578`: the first 1,000-search stress
run (half maximum-composition Q=4,097, half maximum-request Q=4,608) records
p95 37.649ms / p99 42.964ms, max 12,288 compositions/quotes/trader checks on Apple
M3/Node24.22.0. Retain `.local/canonical-maker/p31/search-79a8578.json`; tighten the
final G24 benchmark to **all 1,000** at maximum-composition width, and retain a
separate literal maximum-request regression rather than claim mixed-width runs
satisfy that wording. The first RPC attempt reaches 38 real finalized setup/reprice
transactions, then rejects the snapshot because an added assertion requires Clock
slot≤reported context. R019 already documents Surfpool's lagging commitment context.
Preserve actual Clock and monotone reported RPC context independently, retaining
on-chain expiry rules; add a regression. Raw attempted evidence remains at
`.local/canonical-maker/runs/20261028T175501Z-87682`; it is not A36/G24 acceptance.
Typecheck and 46 focused tests pass after that correction and two additional
maximum-size/index-band regressions. Final clean RPC and worst-width benchmark
remain the exact next action, with no program binary change or external blocker.

R082 strict search gate passes on clean `f9a70c3`: all 1,000 measured searches use
Q=4,097 and eight regions/full books, with buy/sell and funded/unfunded traders.
p95=36.956ms, p99=45.960ms, maximum=51.113ms; all maximum work counters reach12,288.
Report: `.local/canonical-maker/p31/search-f9a70c3.json`. The second RPC attempt
(`.local/canonical-maker/runs/20261028T180050Z-89308`) authenticates the real 31-key
batch (reported context2267, actual Clock2268) but a harness deep-object assertion
compares `Buffer` with `Uint8Array` discriminator containers. Their bytes agree;
replace that assertion with exact encoded-account bytes versus independently
fetched raw bytes. No production reader/pricing/risk change follows. Preserve the
38 actual finalized setup/reprice transactions as partial evidence, not a passed
RPC gate. The final scoped RPC retry is the next action; search need not rerun for
this test-only byte-comparison correction.

R082 acceptance closeout: A36/G24 passes on clean runtime `2fda67b` and clean search
`f9a70c3`. The real offline Surfpool run at
`.local/canonical-maker/runs/20261028T180430Z-90147` finalizes all73 signed outcomes,
including24 authenticated SDK/literal/program quote comparisons across six real
maker instances/two markets. All73 log and73 signature WS observations agree with
independently fetched finalized results and exact original bytes. Pure quotes are
462bytes /28,093–29,162CU; largest setup transaction1,039bytes; minimum headroom
33.62225%. The31-key actual discovery batch retains Clock one slot ahead of RPC
context. No financial trading is enabled. The complete P30 binaries retain their
recorded hashes; no historical test count substitutes for these new outcomes.

All47 focused SDK checks and415 independent oracle cases pass on `2fda67b`.
The final reference-driver cleanup sends financial integers as decimal JSON
strings; its scoped415-case recheck also passes. Maximum-request literal, index
band/minimum-notional and actual-Clock regressions are included. The strict1,000-run
search gate remains unchanged by that test-only wire cleanup. [P31 evidence](evidence/P31.md)
records all pins, measurements, failed attempts and limitations. Both tables now
mark P31 Review/M10 In progress; ready PR publication pending. Affected protocol,
component and validation documents agree. Broad inherited checks belong to CI;
no unrelated suites, PostgreSQL/browser/devnet/deployment/endurance claims.
Exact next action: publish ready P31 above #45 with `gh stack submit --auto --open`,
then create P32 above its exact head and implement the qualification-gated execution
and complete-coverage funding path. P15B/P16B remain Open; 24-hour endurance Deferred.

R082 publication: `gh stack submit --auto --open` creates ready PR #46 above
`phase/p30-canonical-maker` / #45, with exact submitted head `17d45a3`. GitHub
confirms OPEN and `isDraft:false`; stack #44 contains #42 → #43 → #45 → #46.
All remain open. P31/M10 status is Review/In progress; CI outcomes are not assumed.
319 local Markdown links, eight fence balances and `git diff --check` pass for
closeout. No additional runtime was needed for evidence/publication-only changes.
Exact next action: create P32 above the P31 publication commit and implement the
qualification-gated clearing/funding integration and A37/G25 checks.

## R083 — P32 bounded funding-search preparation (28 October 2026)

- Create `phase/p32-liquidity-execution` using `gh stack add` above exact ready P31
  head `28d5dd0` / PR #46. Both tables mark P32/M10 In progress; all four predecessor
  PRs remain open. Read P29B transitions, wire/funding/budget contract and current
  shared route/risk/order/oracle/activation/safety boundaries before implementation.
- Add the allocation-free `QuoteLadderV4`: one validated shape, exact marginal
  region/potential increments, sticky invalid-prefix rejection and independent
  capacity. This optimizes mathematical prices only; it does not infer monotone
  maker health. Add pure three-maker single/pair sampling over admitted quantities,
  explicit deterministic ties and one-side14,424-byte scratch representation.
- Development checks on the prepared tree: three targeted maker-interface tests,
  four targeted financial-core tests, actual native consecutive-quote comparison
  against3,172 independent vectors (1,547 quotes/1,625 rejections), and642 independent
  exhaustive sampling allocations all pass. Actual commands: `cargo test --locked
  -p maker-interface canonical::ladder --lib`, `cargo test --locked -p financial-core
  liquidity:: --lib`, scoped native-driver builds, `check_maker_curve_parity.py
  --implementation rust-ladder`, and `check_liquidity_sample.py`. Logs are retained
  locally under `.local/canonical-maker/p32/`; no raw evidence enters Git.
- [P32 implementation](P32-LIQUIDITY-EXECUTION.md) records the remaining route/CPI,
  full-coverage funding, causal controls, shared safety and qualified activation,
  actual RPC/WS/PostgreSQL audit and predeclared comparison workload. These helpers
  are not wired to public financial instructions; no P32 runtime, CU, total heap,
  activation or A37/G25 completion is claimed. Native scratch size is not SBF
  resource acceptance. No unrelated inherited suite, new deployment or endurance
  run; no external blocker. Exact next action: pin the native helpers, then add
  authenticated V4 clearing quote views and complete per-quantity maker admission.

R083 pinned follow-up: clean `5c5f1dd` repeats the three ladder/four sampling
native checks, 3,172 independent ladder vectors and 642 exhaustive allocations,
all passing. Logs retain the tested pin in `.local/canonical-maker/p32/`.

## R084 — P32 authenticated pricing, maker admission and causal funding (29 October 2026)

- Continue the same local P32 branch above #46; preserve all four open ready PRs
  and untracked user research. Add exact capital/registration/code/config/price
  authentication, read-only canonical CPI comparison and complete three-input
  impact preparation. Every positive quantity uses actual whole-root maker funding,
  the shared route's order/generation/reservation refresh and admission. No assumed
  healthy prefix, synthetic trader, taker fee or consumption mutation.
- Factor the one-side checked fill arithmetic from the existing paired fill so
  funding admission and execution share it. Add independent literal non-prefix,
  fractional debt and full-order-book checks. Quantity-one price validation is
  separate from post-fill admission; later invalid mathematical prefixes do not
  erase earlier valid quantities. Valid zero-capacity inputs still authenticate.
- Add native causal sample/control candidates. D73/P29B records materializing the
  old valid interval before a failed new sample, publication-bounded held funding,
  recovery restart after a coverage gap, and exact covered/skipped accounting for
  repeated controls. Source observations and V1–V3 behavior are preserved. Frozen
  mode and old slot/catchup limits remain enforced.
- Actual prepared-tree checks: `cargo test --locked -p financial-core --lib --test
  economics --test margin --test cross_core` passes 31 tests; affected liquidation
  and margin-safety files pass 11. `cargo test --locked -p maker-interface
  canonical:: --lib` passes 11; `cargo test --locked -p clearing maker_liquidity::
  --lib` passes 10, including four literal funding and two actual admission tests.
  Native `cargo check --locked -p clearing --lib` passes for pricing/impact helpers;
  unused-helper warnings are expected while entrypoints are unwired. No SBF, CU,
  total heap or integrated acceptance inferred from native results.
- Raw logs remain in `.local/canonical-maker/p32/`. No public financial instruction
  is newly enabled, no deployment or database copy is created, and no unrelated
  inherited suite or 24-hour run is executed. Both tables retain P32/M10 In progress;
  P15B/P16B Open. No external blocker. Exact next action: wire the gated complete
  sampler and structural controls, then current-state atomic/stored-order routes
  and the shared safety boundary before A37/G25 runtime qualification.

R084 continued implementation: checkpoint `9739e1c` records the pricing/admission/
causal helpers above. Wire separate `initialize_liquidity_oracle_v4` and
`sample_liquidity_v4` handlers, the exact extended oracle event and generated SDK.
Structural controls now close held funding in the new candidate feature only;
legacy/default/custody profiles retain their prior gates and profile4 still cannot
activate trading. Twelve focused clearing tests pass in the candidate and default
builds; native candidate check, Anchor IDL build, generation and TypeScript checking
pass. A test initially used unsupported `try_to_vec`; explicit `serialize` fixed
that test-only compile error before the successful IDL/native runs.

The initial SBF builds reject sampler frames (estimated5,056 then4,864 bytes).
Separate decoding/admission construction and side-search boundaries produce safe
compiled artifacts; the second failed log remains
`.local/liquidity-execution/sbf-attempt-2.log`, and subsequent full build attempts
have unique local logs. First resource probe on the dirty prepared tree above
`9739e1c`, `.local/liquidity-execution/runs/20261028T190442Z-7610`, finalizes45 signed
provisioning/source/publication transactions with fetched-byte/WS agreement. The
next100-lot sampler serializes to1,101-byte v0 but its simulation exhausts1.4mCU;
it is **not broadcast** and is not a successful sample. Existing P30/P31 binaries
remain untouched. No PostgreSQL instance/copy or financial trading activation.

Optimize fixed reservation preparation rather than reducing coverage or risk:
the existing reservation function now shares validated `ReservationRate` terms;
search reuses those terms and scalar fill/risk arithmetic without full root/book
copies per quantity, then rechecks selected legs through the complete route path.
Three focused admission tests pass, including103,680 comparisons against the full
route across both markets, funding, cash, fractional claims, partial orders,
expiry/delegation and protection. Two independent order-reservation tests pass;
TypeScript checking passes. Build/resource remeasurement is pending. The probe now
provisions only BTC makers, retaining both market identities, to avoid irrelevant
ETH maker setup for this diagnostic. No A37/G25, CU headroom, full-book, integrated
or hosted-CI pass is claimed. Exact next action: measure the optimized sampler at
100 and600 lots under the unchanged1.4mCU/default32KiB limits, then finish atomic/
stored-order execution and shared safety before full phase qualification.

R084 resource follow-up: clean SBF build/probe `db2628f` at
`.local/liquidity-execution/runs/20261028T191745Z-11673` finalizes30 setup/source/
publication transactions. The100-lot sample reaches the selected buy quote but
still exhausts1.4mCU in simulation, before completing both sides; it is not sent.
The reservation optimization improves progress but does not close the gate.

Add checked prepared isolated-risk projection (same funded cash plus negative
claim, exact per-position IM ceiling and shared generation transition) and avoid
repeated allocation tie-vector scans by visiting in the complete agreed tie order.
Every selected leg still runs the full route transition/book/admission. Scoped
financial-core command `cargo test --locked -p financial-core --lib --test economics
--test margin --test orders --test liquidation --test margin_safety` passes40 tests,
including literal fractional/ceil expectations and1,650 extreme-bound comparisons.
The initial boundary test's expected population was miscounted as3,300; all numeric
comparisons passed, and correcting that count to1,650 fixes the test-only failure.
All13 focused clearing cases pass, including103,680 full-route equivalence cases;
`check_liquidity_sample.py` passes642 independent exhaustive allocations after the
tie-order optimization. Logs remain under `.local/canonical-maker/p32/`.

Growing prepared records exposes another SBF call-frame violation in impact
preparation; a separate `prepare_inputs` frame resolves it. The latest candidate
SBF build passes without frame warnings; record it as prepared-tree evidence,
not a clean runtime acceptance. Complete unique build logs are retained under
`.local/liquidity-execution/`. Both tables retain P32/M10 In progress. Actual routes,
orders, shared safety, integrated PostgreSQL and the comparison workload remain;
no unrelated broad checks, external services, fresh database copies or endurance.
Exact next action: pin and measure this prepared-risk candidate's100/600-lot
sampler resource probe; optimize further if it fails, without weakening G22/G25.

R084 latest resource result: clean build/runtime `478613a`,
`.local/liquidity-execution/runs/20261028T193112Z-17106`, again finalizes30 preceding
setup/source/publication transactions. The100-lot sample now reaches the sell-side
search, then reports `memory allocation failed, out of memory` at1,201,380 simulated
CU. It is not broadcast; there is no successful sample or20% headroom claim. This
is the first measured heap failure, in addition to the earlier compute failures.
The user's explanation questions are answered: this is periodic funding sampling,
not a trader route or per-curve collateral reservation; existing pending-order
reservations are only one part of the financial admission check.

Replace retained duplicate root boxes in sampler admission with references to the
already-loaded capital and short-lived scalar stack adapters. Preserve the existing
boxed adapter for other callers and its exact fields/validation. All13 scoped
maker-liquidity native cases pass, including103,680 projection/full-route comparisons.
The affected account-trading adapter tests and safe-SBF build are pending at this
checkpoint; no memory savings or runtime pass is claimed without measurement.
P32/M10 remain In progress, all predecessor PRs remain open, P15B/P16B stay Open
and24-hour endurance Deferred. Exact next action: complete the borrowed-capital SBF
check and measure the sampler again, addressing remaining per-quantity compute
and heap costs before wiring routes or claiming A37/G25 acceptance.

R084 borrowed-capital checkpoint: all seven affected `instructions::account_trading::tests`
pass, including adapter identity/schema and whole-account financial expectations.
`bash ops/build-liquidity-execution.sh` passes for the prepared tree without unsafe
SBF-frame diagnostics. No real sampler retry is run for this last heap change yet;
100/600-lot compute, default-heap fit, full books and final financial paths remain
unqualified. Source changes retain exact V3 account bytes/validation and ordinary
boxed callers. Save the scoped logs locally; commit this coherent checkpoint.
Both status tables remain unchanged in classification: P32/M10 In progress with
failed resource acceptance. Exact next action: run the borrowed-capital sampler
probe and use its measured stage costs to remove remaining repeated per-quantity
work before enabling or qualifying any new trading path.


## R085 — P32 published-liquidity funding amendment (29 October 2026)

- User explicitly selects published curve depth for impact pricing, trusting maker
  funding capacity for now; D74 supersedes funding-only financial admission. Keep
  full execution risk/order checks, authenticated complete coverage, freshness,
  declared depth/inventory caps, independent price bounds and causal funding.
  Temporary exclusion after repeated economic failures is deferred.
- Remove maker hypothetical funding/cash/claim/IM/reservation evaluation and selected
  financial rechecks from the sampler. Keep its price checks/CPI authentication and
  existing instruction/event layouts. Retain prior financial projection comparisons
  as test-only regression code. Update protocol/component/validation/roadmap/contract
  records together; no old measured result qualifies this changed contract.
- Prepared tree above `5e69e6d`: scoped `cargo test --locked -p clearing --features
  liquidity-execution-qualification --lib instructions::maker_liquidity` passes15
  cases, including published zero-cash depth versus actual financial rejection,
  literal price-band boundaries, consumption/reduce-only limits and prior103,680
  projection comparisons. `python3 tests/financial/test_maker_curve_contract.py
  FundingContract` passes4 independent cases. `pnpm typecheck` and `git diff --check`
  pass. Logs are local; no full inherited
  suite, PostgreSQL, CI or endurance run is claimed.
- Extend the scoped RPC harness with real owner-signed withdrawals of all three
  makers' funds and unchanged publication sampling. Save fetched transaction
  evidence before resource assertions so a landed over-budget outcome cannot lose
  its independent RPC record. Runtime test is pending, not passed.
- Both status tables keep P32/M10 In progress. No external blocker; all predecessor
  PRs stay open, P15B/P16B Open,24-hour endurance Deferred. Exact next action: pin
  this change, build candidate SBF and measure the100/600-lot published-depth probe
  under the unchanged resource ceilings, then record actual outcomes before
  continuing P32 execution/safety/integration.

R085 runtime result: clean `2a93394` candidate build passes safe SBF checks. The
scoped Surfpool probe at `.local/liquidity-execution/runs/20261028T201121Z-29627`
finalizes30 setup/source/publication transactions, then successfully simulates,
lands and independently fetches the100-lot sampling transaction at1,334,329CU,
1,101 bytes v0,29 unique static accounts. Signature:
`5zkqnkyDdLyABEVRPLVGASkJHAgV514jUFpNyTQTUKufUavqPtTrSjXHEU1RBZLPxhrAHSnqjBnuoqCCZGYztTWi`.
The transaction succeeds but exceeds the1,120,000CU headroom target. The harness
stops at that resource assertion before its binary/WS parity checks,600-lot case,
zero-cash withdrawals, expiry cases or overall summary; none are reported passed.
The owned runtime exits through its cleanup trap. No full-books or scaling pass.

A targeted offline check of the independently fetched successful event verifies
literal quantity100, bid5,999,900, ask6,000,300, premium1e9, three inputs and one leg
per side. Generated SDK and the isolated legacy Anchor client agree on that actual
event; `landed-event-check.json` records it. This is event parity, not completed
transaction binary/WS qualification. The logs bound530,849CU before the first quote
CPI,237,366CU inside eight quote CPIs, and566,114CU elsewhere. Those are stage
boundaries, not an isolated hash/financial-cost profile; the remaining sampler
contains no hypothetical maker financial admission. Removing that work alone does
not solve the resource problem. Raw build/RPC/native/typecheck logs remain local
under `.local/liquidity-execution/d74/`; unchanged generated ABI needs no regeneration.
Changed Markdown fences and326 local links pass; `git diff --check` passes.

Both tables retain P32/M10 In progress. No remote PR publication, CI, full
PostgreSQL/financial execution or endurance is claimed. Exact next action: profile
and reduce the remaining authenticated price-search overhead, then rerun the
100/600-lot published-depth resource gate without restoring financial sampling
checks or weakening execution/source/identity safeguards.


## R086 — P32–P34 restricted publisher delivery amendment (29 October 2026)

- The user accepts the proposed restricted backend funding publisher and asks how
  it fits the active phases. D75 and [the delivery contract](P32-FUNDING-PUBLISHER.md)
  keep the existing phase IDs and PR stack. P30/P31 remain reusable for canonical
  pricing/snapshots and trader routing. Update the earlier funding contract by
  explicit supersession inside P32, without claiming it was already implemented.
- P32 now freezes report/configuration layouts, authority and causal transitions,
  builds the real snapshot/calculation/publisher client plus bounded report handler,
  then completes its existing trading/safety/RPC/WS/PostgreSQL and continuation
  acceptance. Do not postpone the essential off-chain producer until P33. P33 owns
  durable service recovery, provenance, operator/SDK/indexer/UI integration; P34
  owns final comparative cost, contention, coverage and incident qualification.
- Retain two-second publication initially, independent index/risk prices, bounded
  causal funding, full execution financial admission and unchanged fees/insurance.
  Maker snapshot completeness and aggregate correctness become explicit publisher
  attestations, not on-chain proofs. Signer rotation/revocation, replay/configuration
  invalidation and input audit retention are required. Automatic failure-based
  exclusion remains deferred. No new deployment, external participant or endurance.
- Documentation-only change above `a6d6188`; existing code still implements D74.
  No publisher runtime/benchmark/financial test is claimed. Validate changed local
  Markdown links/fences, phase ownership and `git diff --check`: all pass, including
  398 local link targets and both current status rows. No Rust/TS/full
  regression, Surfpool, PostgreSQL or CI run is needed for this planning amendment.
  Both tables retain P32/M10 In progress; predecessor PRs stay Review/open and
  P33/P34 Open. P15B/P16B Open and24-hour endurance Deferred are unchanged.
- No external blocker. Exact next action: freeze the P32 publisher configuration/
  report layout, authority/expiry/replay/structural-control transitions and reduced
  resource target before implementing the real producer-to-clearing flow.


## R087 — P32 restricted publisher implementation and resource probe (29 October 2026)

- Freeze D76 before measurement:140-byte configuration,203-byte report payload,
  market/domain/authority/sequence and observation/config/terms fences, two-second
  observation age, six-second/150-slot maximum hold, explicit unavailable outcomes.
  Venue authority rotates/revokes the signer; controls close the previous causal
  interval. Clearing independently reads all four sources, derives risk bounds,
  checks reference quantity/price bands and applies the unchanged funding cap.
  The old sampling instruction now rejects. New financial execution stays disabled.
- Implement the real coherent SDK producer: discovery chooses keys, one final RPC
  batch supplies Clock, sources, all makers/config/price/capital/code and publisher
  state. Authenticate complete coverage and enumerate exact one/two-maker published
  prices off-chain, with deterministic ties and no hypothetical financial admission.
  Digest references ordered raw inputs; it is not an on-chain proof. Add generated
  configuration/report/event codecs and a scoped actual-RPC/WS authority/resource
  harness with local input retention. P33 durable worker/indexer recovery is separate.
- On the candidate above`964c938`: scoped`cargo test -p clearing --locked --features
  liquidity-execution-qualification maker_liquidity::publisher` passes6 tests;
  `maker_liquidity::funding` passes4 causal cases. Independent literal vectors in
  `pnpm exec vitest run packages/sdk/src/funding-publisher.test.ts` pass6 cases,
  including100/600-lot optima, disconnected quantities, no third leg, source rules
  and digest mutations. Regenerate clearing IDL with pinned Anchor and`pnpm generate`;
  `pnpm typecheck` passes. No unrelated inherited regression, CI, PostgreSQL,
  financial execution or endurance is claimed. Earlier native fixture expectations
  were corrected for schema/profile and slot-expiry rules; the rules were preserved.
- Publisher budget is fixed before runtime:200,000 submitted CU,≤160,000 measured,
  ≤20 loaded keys, default32-KiB heap. These are targets, not measured results yet.
  Test logs are local under`.local/liquidity-execution/publisher/`; raw evidence
  remains ignored. Reclaimed580MiB only from rebuildable`target/debug/incremental`
  after free disk fell to~1GiB; no database/evidence/key files were deleted.
- Both tables retain P32/M10 In progress. No P32 PR exists yet; predecessor PRs
  remain open/Review, P33/P34 Open, P15B/P16B Open and24-hour endurance Deferred.
  No external blocker. Exact next action: build the pinned publisher candidate and
  run`bash ops/funding-publisher-smoke.sh` to measure real signed100/600-lot reports,
  authority/replay/control/unavailability failures and independent fetched ABI/WS parity.


R087 runtime follow-up: clean`94e0645`SBF build passes the stack-frame scan;
`.local/liquidity-execution/runs/20261029T103257Z-81719` records32 finalized
RPC/WS transactions. Publisher initialization succeeds at29,380CU/537bytes;
the retired sampler rejects with6131 at37,208CU and leaves state unchanged.
No price report is sent: the new client incorrectly required Clock.slot≤RPC
context.slot. A separate10-read owned Surfpool diagnostic records Clock consistently
one slot ahead of context in the same batch (`publisher/clock-probe/results.json`).
Remove this extra, uncontracted comparison; retain monotonic RPC context checks,
actual Clock observation fences and all on-chain future/age/expiry checks. This is
not an oracle-age or risk-policy relaxation. The owned runtimes are stopped.
Exact next action: rerun the corrected client against the unchanged pinned SBF
artifacts and finish the scoped publisher resource/authority/parity probe.


R087 second probe: clean client`9129bda`with unchanged`94e0645`SBF artifacts,
`.local/liquidity-execution/runs/20261029T103745Z-83030`. Seven reports land and
match independent expected prices:100lots30,511CU;600lots/zero-cash30,571CU;
all report packets871bytes/v0 with14 loaded keys. Publisher controls measure
22,699–22,704CU; initialization29,380CU. Rotation/revocation/replay, wrong market/
domain/time/quantity, stale structural-control reports and unavailable source/
zero-cap publication checks pass.80 transactions complete fetched-byte/RPC/WS
checks. The81st lands successfully but fails the unchanged400k-control/320k
headroom gate at337,446CU, before the final insufficient-depth report and legacy
parity finish. Do not call the entire probe passed or claim its final summary.

Inspecting the control handler finds it derives the same three PDAs and revalidates
all identities after an already authenticated CPI. Preserve its complete pre-CPI
code/hash/identity/shape validation, read-only price account and full expected-state
comparison; replace only redundant post-CPI reauthentication with owner/layout/
non-executable checks and equality against EVERY field of the expected next curve.
A scoped native test flips every one of691 serialized bytes and also tests foreign
owner, executable flag and length: all invalid outputs reject. The single-control
budget remains400k, not raised. Exact next action: pin/build this optimization and
rerun the scoped publisher/control resource probe to completion.

Additional scoped publisher cap case passes in both signed directions (the allowed
10% price envelope still clamps funding to±50bps of index). Publisher native suite
now has7 passing tests; with4 causal and1 complete-control-result check,12 scoped
native tests have passed. No ABI changed in this optimization, so unchanged
IDL generation/typecheck and unrelated financial suites are not repeated.
Free space subsequently fell below200MiB; after the native checks completed,
remove only rebuildable`target/debug`(~1.7GiB). Preserve all evidence, keys,
configuration, databases, deploy/SBF artifacts and unrelated work.
