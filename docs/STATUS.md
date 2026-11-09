# Current status

Updated 10 November 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P47 and M1–M5b/M7–M13 are integrated within their
recorded engineering scopes. The three-PR Anchor RC2 stack merged atomically at
**`fb6c26ba4c2ff053a132e271bbd0bc67011cc935`**, with the complete tree identical to
reviewed/tested tip `c6378166fe11b856324aee06fdacdf6b2b2374b2`.
[Validation](operations/validation.md) records the exact qualification pins and
limits; [HISTORY](HISTORY.md) records the integration and preceding baselines.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| P48 exact interval allocation | Review | Clean `5e5aede`: 715 independent cases, 23 affected SDK/service checks, 130 signed RPC/WS outcomes; ready PR publication pending; old size limits retained |
| P49 expanded quantities | Planned — authorized | Remove inherited maker/action ceilings within checked numeric bounds; larger actual routes, orders/protection, liquidation and RPC/WS/PostgreSQL reconciliation |
| M13 Anchor RC2 migration | Closed | P45–P47 accepted and integrated as #63 → #64 → #66; qualified C0, review fixes and applicable hosted checks pass |
| P45 migration contract | Closed | [PR #63](https://github.com/arnabnandikgp/rivalt/pull/63) merged; accepted architecture/release research, exact pins, ABI and acceptance contract |
| P46 RC2 implementation | Closed | [PR #64](https://github.com/arnabnandikgp/rivalt/pull/64) merged; serialized C0 and scoped signed RPC/WS/PostgreSQL acceptance pass |
| P47 post-migration qualification | Closed | [PR #66](https://github.com/arnabnandikgp/rivalt/pull/66) merged; full C0 matrix, B/C report, normal demo, artifact review fixes and applicable CI pass |
| M12 performance and contention | Closed | P39–P44 accepted and integrated; measured pre-migration baseline frozen; no framework migration |
| P39 dependency audit/baseline | Closed | [PR #55](https://github.com/arnabnandikgp/rivalt/pull/55) merged; focused RPC/WS baseline and 61-entrypoint inventory |
| P40 scoped events/services | Closed | A and B acceptance passed and integrated |
| P40A bounded service execution | Closed | [PR #56](https://github.com/arnabnandikgp/rivalt/pull/56) merged; scoped RPC/WS/PG fault and fresh replay acceptance |
| P40B scoped event history | Closed | [PR #58](https://github.com/arnabnandikgp/rivalt/pull/58) merged; authenticated scoped history and exact financial acceptance |
| P41 relevant market dependencies | Closed | [PR #59](https://github.com/arnabnandikgp/rivalt/pull/59) merged; accepted clean `ca8bab0` / SBF `b0c5675` |
| P42 custody/accounting isolation | Closed | [PR #60](https://github.com/arnabnandikgp/rivalt/pull/60) merged; D87 schema-7 financial/lock/settlement/gateway/default and SQL replay acceptance |
| P43 targeted CU optimization | Closed | [PR #61](https://github.com/arnabnandikgp/rivalt/pull/61) merged; matched CU comparison, 147/165 full-book and 290 safety outcomes on SBF `fb5d0c5` |
| P44 frozen pre-v2 qualification | Closed | [PR #62](https://github.com/arnabnandikgp/rivalt/pull/62) merged; 61-entrypoint baseline, integrated recovery/replay, measured cost/load envelope and admission-crash review fix |
| M11 consolidation | Closed | P35–P38 accepted and integrated; merged tree equals accepted stack tip |
| P35 component docs/handoff | Closed | [PR #50](https://github.com/arnabnandikgp/rivalt/pull/50) merged; component contracts, maintenance AGENTS and provenance |
| P36 canonical names/ABI | Closed | [PR #51](https://github.com/arnabnandikgp/rivalt/pull/51) merged; canonical API names, preserved wire contract and passing CI |
| P37 legacy retirement/runtime | Closed | [PR #53](https://github.com/arnabnandikgp/rivalt/pull/53) merged; consolidated runtime and fresh integrated acceptance |
| P38 professional root README | Closed | [PR #54](https://github.com/arnabnandikgp/rivalt/pull/54) merged; professional entrypoint and scoped docs acceptance |
| P15B independent maker validation | Open — external | Actual independent operator/economics; internal bots and assumed hedges cannot substitute |
| P16B independent review/funded readiness | Open — external | Independent review, risk/reserve calibration and separate funded authorization |
| Continuous 24-hour endurance | Deferred | No run scheduled or completion claimed |

Review means accepted work awaiting integration; Closed requires acceptance plus
integration. The user authorized the migration stack's review fixes and merge on
2 November 2026; all three PRs independently report MERGED. Fetched main has the
accepted tip as an ancestor and exactly the same complete tree.

## Active quantity work

The user authorized removing both inherited quantity ceilings on 10 November.
P48 changes only search/client behavior and preserves program limits and artifacts.
Clean `5e5aede846c27bb1c352aa06c14a25ccfc6fe06c` passes 715 independently enumerated
financial/price cases (264 allocated, 379 unavailable, 72 rejected), 23 affected
SDK/service checks, typecheck and 130 signed Surfpool RPC/WS outcomes against the
unchanged qualified C0 programs. Full-book four-scenario search benchmark: 1,000
iterations, p95 0.302 ms / p99 0.355 ms on this Apple M3; at most 151 distinct
quantity quotes and one full candidate/trader admission. This is a bounded fixture
measurement, not worst-case latency. Local evidence is `.local/quantity/p48-5e5aede*`.
No new SBF, PG replay or larger quantity is qualified by P48. P49 owns those checks.
Next exact action: publish P48's ready PR and implement P49 above it. P15B/P16B and
deferred endurance are unchanged; there is no blocker.

## P46 serialized port checkpoint

P46 was implemented above accepted PR #63 (`696851e`). The
serialized port's scoped acceptance passes; [PR #64](https://github.com/arnabnandikgp/rivalt/pull/64)
is merged with accepted content `44d1251` and hosted acceptance at `360a247`.
[Validation](operations/validation.md#anchor-rc2-serialized-port-p46) records the
actual checks and exact pins. Frozen P44 artifacts remain untouched.

Delivered: exact RC2 crates/CLI, bounded serialized registry/foreign-loader adapters,
contexts and typed CPI borrowing, scoped event codecs, canonical identifier delta,
clearing binding 8 / maker account schema 5, actual generated IDLs/SDK and isolated
legacy/RC2 clients. Fields, seeds, privileges, signed quote/report domains, financial
rules and default/devnet gates remain intact. No C1 zero-copy conversion is needed
to close this serialized port; P47 records its measured operating envelope below.

Clean C0 SBF source is **`366c7ab4f12c058fbff6538ededca26674ccf5bf`**, retained in
`.local/anchor-rc2/c0-366c7ab/`. Clean RPC verifier
**`8feb24c81affcc98e655f3da7822ca46eaef835c`** passes 57 custody, 290 safety and 124
journal outcomes on fresh Surfpool/RPC/WS. Independent raw audits verify cash/token
conservation and eight exact Fraction default payouts; PostgreSQL rollback,
restart recovery and fresh-database replay match 74 committed events with zero
unresolved jobs. Safety receipts also reproduce five captured financial checkpoints.

Compiled maker lifecycle, default gates and five hostile-maker rollback cases
pass. Both actual maker binaries match 3,172 independent pricing vectors each.
Native adapter/financial tests and affected SDK/conformance checks passed at the
pins recorded in validation. Typecheck, ABI/generated checks and documentation
checks are scoped. All five hosted jobs (scope/client/report/financial/shell) pass
on `360a247` in [run 41289514760](https://github.com/arnabnandikgp/rivalt/actions/runs/41289514760). All evidence remains local.
The initial failed allowlist and boxed native token CPI attempts remain recorded;
the fresh signed custody pass proves the forwarding-handle fix.

P47 completes the remaining qualification below on these unchanged C0 binaries.
P15B/P16B and deferred endurance are unchanged. P45–P47 are now integrated;
local qualification and integration do not establish a funded deployment.

## P47 qualification

The P47 stack tip contains accepted P46 parent `360a247`.
Local acceptance passes; [PR #66](https://github.com/arnabnandikgp/rivalt/pull/66)
is merged. Acceptance/report content is `2b677b597912b2a3e9d7b02dab19088eca66ccc7`.
All four applicable hosted jobs (scope/client/report/shell) pass in
[run 41296789385](https://github.com/arnabnandikgp/rivalt/actions/runs/41296789385);
the unchanged Rust financial job is correctly skipped for this PR. P46’s actual
financial CI and local compiled acceptance remain separately pinned. No access blocker is present. [Validation](operations/validation.md#anchor-rc2-qualification-p47) records
exact constituents and [performance](operations/performance.md#rc2-qualification-measurements-p47)
records all 61 entrypoints, binary sizes, caller/scaling dependencies and the B/C
cost/load comparison. SBF remains clean **`366c7ab4f12c058fbff6538ededca26674ccf5bf`**;
no C1 zero-copy conversion, economic change or new program build is inferred.

| Constituent | Clean verifier | Actual result |
|---|---|---|
| Complete coverage / full books | `a01da5d`, service `b0b62ff`, retained P46 `8feb24c` | 61/61 entrypoints; 2,520 executions / 2,493 originals / 27 cross-run reexecutions; 147/165/165 full-book outcomes |
| Settlement / retirement / default | `a01da5d` | 207/63 dependency/retirement outcomes, 149/53-event PG replays; 712 complete-cohort outcomes, 64 independently audited payouts; eight separate scratch-width cases |
| Services / browser | `b0b62ff` | 468 durable originals, ten browser actions, actual stored fill, three crash/lost-ack recoveries, source/publisher recovery, identical 187-event PG replay and independent accounting |
| Dispatch / bounded load / operations | `1a893ed` | Admission/send SIGKILL and unknown-fee retention; 1,008 offers / 433 fills; complete default/recovery/cash exits with ten independently audited payouts and identical 192-event replay |
| Default/devnet gates | P46 and `eac3755` | All three actual default/devnet initialization refusals with rollback; three mixed-feature compile rejections; no devnet network |
| Normal demo | `083760a` | Fresh startup, thirteen successful local-wallet actions, both modes, BTC/ETH fills, TP/SL/cancel, closes, token-reconciled withdrawal and reload; owned server stopped |

Frozen B remains unchanged and its 2,871 originals reproduce the 53,089-byte
summary. C0's bounded summary is 56,839 bytes. The focused reader compares 33,682
financial/relative-time values across 22 states for eleven successful cases.
330 slot and 176 deployment-digest witnesses remain explicit differences, so the
observed 40–44% route-CU reductions are paired workload observations, not a pure
framework microbenchmark. Clearing/maker binary sizes fall 38.1%/36.1%; requested
CU, zero-priority bids and actual focused fees are unchanged. Wide scratch reaches
572,668 CU; no peak heap metric is invented. Raw evidence remains ignored/local.

Qualification fixes: readonly projection compares complete values independently of
JSONB object-key order; normal startup waits for the existing finalized revision
fence; each of six maker updaters and two publishers has its own restricted key
and fee payer. The demo had otherwise retained the previously measured shared-
payer starvation. Browser tests wait for Normal on opens and credible
Normal/Degraded on reduce-only closes. They retry only explicit unsigned source
refusals or permit a new bounded user review after a proven finalized version
conflict or signed expiry, retaining every failed original/fee. Ambiguous originals
are never rebuilt.
The final demo retains 13 signed originals (13 successful / 0 rejected),
at four-second funding publication and one-second synthetic feed refresh.
The separate service/load policy stays two seconds. Earlier missing-browser,
source-window, JSONB, source-recovery, connection and maker-bound failures remain retained,
not counted as passes. The initial separate-payer demo retained a finalized
FinancialSequence 6122 rejection after seven successful actions. The later test
incorrectly requiring Normal for reduce-only closes is also recorded; the final
fixture follows the existing credible-Degraded reduction contract.
No risk/authority/source safeguard was relaxed.

Actual commands include scoped `ops/current-runtime-smoke.sh` constituents,
`ops/liquidity-services-smoke.sh`, continuation/operations launchers, the independent
Python auditors, `ops/build-devnet-gates.sh`, `ops/demo.sh start|stop` with an isolated
root, and `tests/browser/demo-lifecycle.ts`. Report readers reproduce B/C0 summaries
and the focused comparison from actual original wires/RPC/WS. Typecheck, affected
indexer/measurement/demo tests, ABI/evidence policy, shell and documentation checks
are recorded in validation/PR. Broad supported host regression belongs to CI;
no unrelated local full suite, new external wallet, outreach, funded deployment or
24-hour run is claimed. Inactive disposable Cargo build targets were removed;
programs, tools, logs, keys, databases and failed evidence remain preserved.

Remaining limits: load filled 433/1,008 offered actions (92.92% of 466 submitted);
537 generator limits, five duplicate originals and 33 stale-version rejections
remain explicit. Live indexing achieved two coherent cycles / 33 revision-ahead
retries, so continuous read readiness and sustained TPS remain unproved. The
64-member cohort includes 56 flat additions; scratch-width cases never Apply.
Internal makers, P15B/P16B and deferred endurance retain their existing labels/gates.
The user authorized review fixes and merge of #63 → #64 → #66 on 2 November.
The five review threads contain four actionable artifact/path/schema-documentation
findings and one obsolete plan-approval status finding (the plan was subsequently
approved). Fixes are carried on the stack tip: shared fixed-hash artifact preflight,
staged default-build promotion, consistent smoke/demo paths and current schema
documentation. Fifteen targeted regressions, eight existing artifact-verifier
tests, typecheck, ABI and shell checks pass at review fix `c637816`; actual retained
current/C0 artifacts pass the gate. No programs, IDLs or financial rules changed.
P46 automated review was skipped for file count. A focused self-review checked the
registry codec, loader identity/ownership, event/scoped-history encoding, maker
CPI privilege/return validation and native-token CPI forwarding/revalidation;
no additional defect was found in those inspected paths. This is not independent
review. P46's hosted financial acceptance remains separately pinned above.
At clean `c637816`, the admitted default-path maker launcher passes 123 signed
Surfpool RPC/WS outcomes and 246 notifications with independent fetch/dual decode.
Standalone hostile smoke passes five full-rollback cases across 114 signed VM
transactions. Raw captures remain in `.local/anchor-rc2/p47-review-{makers,hostile}-c637816/`;
the owned Surfpool is stopped. All four applicable hosted jobs pass in
[run 41386710747](https://github.com/arnabnandikgp/rivalt/actions/runs/41386710747);
unchanged Rust financial CI stays separately pinned to P46. All five threads are
resolved. No new SBF build, PostgreSQL/service/load/endurance run was needed for
these launcher/docs fixes; no earlier evidence is relabelled. Stack #65 merged
atomically with exact tree equality. No blocker remains in this delivery.
That closeout scheduled no further work. D91 above now records the separately
authorized quantity work; no external qualification or deployment is scheduled.

## Accepted performance stack

P39–P44 follow D82 and are now the integrated baseline.
P39's immutable focused A baseline uses SBF `828fe543`; P40A adds durable bounded
service lanes, P40B scoped authenticated history, P41 relevant market dependencies,
and P42 schema-7 token custody/internal-accounting separation. Their exact accepted
commits, fresh RPC/WS/PG results and limits are in
[validation](operations/validation.md). No historical results are relabelled as P44.

P43's accepted uninstrumented SBF source is
`fb5d0c546a417796ce615e0d3d3575545c96c178`; clean verifier `1e86661` supplies its
matched CU comparison, full books and complete safety constituents. Route savings
are 669–1,230 CU; requested limits and actual fees are unchanged. Its four applicable
hosted CI jobs and automated review pass on `f9d29f6` in
[run 41244319044](https://github.com/arnabnandikgp/rivalt/actions/runs/41244319044).
Compiler-size experiments with oversized stack frames remain rejected.

## P44 checkpoint

P44 retains the same programs/IDL/economics and fixes the operational failures
found in qualification: D88 finalized-valid blockhash witnesses; D89 immutable
oldest-conflicting-original dispatch; mandatory UI account-schema forwarding; and
bounded eight-block finalized history retrieval with unchanged ordered application,
complete manifests and exact reconciliation. Old dispatcher version-1 originals
must drain before upgrade; ambiguous fees/reservations are never released to make
progress. Operators use separate restricted maker/publisher fee payers.

The B baseline covers **61/61** public entrypoints across
**2,871** independently fetched harness originals on the exact pinned binaries;
reverted calls cannot establish successful coverage. The operator and browser
populations remain separate. Current source, artifacts, fixtures, scenario maxima,
caller/scaling table, priority-fee assumptions and limitations are recorded in
[performance](operations/performance.md) and
[validation](operations/validation.md#frozen-pre-migration-qualification-p44).

Clean `a5afbc9` completes 239 durable originals (236 success / three report
rejections), three lost-ack/SIGKILL recoveries, stored-order execution, publisher
handover/revocation, source outage/recovery and live indexer restart. Fresh PG replay
matches 137 events over eight members/70 accounts; independent audit verifies
7,999,993 vault atoms, 7,999,968 cash and 25 taker-fee atoms. All six makers remain
internal and hedge costs unobserved. Ten browser actions separately pass at
`f4490e9`, including reload recovery and cash actions with both APIs blocked.

Clean `8b8c33f` completes the current bounded load experiment: 1,008 offers,
465 unique finalized originals, 430 fills, 35 on-chain rejections and
543 unsubmitted offers with explicit generator/duplicate reasons. There are no
expired/unresolved load originals. Live indexing records 2 coherent cycles and
33 revision-ahead retries; final and fresh replay match 585 events and exactly
9,000,000 vault atoms. Earlier 1/28 live progress and duplicate-wire failure remain
recorded, not counted as successful full runs. This is not sustained availability
or validator TPS.

The actual 64-member default, eight scratch-only width cases, five compiled
hostile-maker rollback cases, custody/dependency/treasury/retirement lifecycles,
and their independent financial/replay checks pass at the exact pins in validation.
The 56 added default members are flat; wide fixtures perform no payout. Ordinary
own-cash exits remain independent of unpaid-profit certificates; earlier certificate
pages still require stable relevant observations.

Fourteen affected indexer tests, 31 queue/receipt/cost cases, two independent audit
regressions and typecheck pass. Raw originals, failed attempts and databases stay
local/ignored. No new SBF build, unrelated local native suites, endurance, devnet,
external wallet, funded deployment or Anchor v2 migration is run. Broad supported
regression belongs to CI. The 53,089-byte frozen baseline reproduces from its pinned
originals; typecheck, documentation links, shell syntax, whitespace and the staged
128 KiB aggregate evidence budget pass. Acceptance content is `ade628d`.
All four applicable hosted checks (scope, shell, client and financial) pass on
review fix `da99664` in [run 41280117782](https://github.com/arnabnandikgp/rivalt/actions/runs/41280117782).

The review fix commits the finalized-valid blockhash witness with dispatch
admission, closing a process-death window before status RPC or broadcast. Nineteen
focused queue/dispatch/risk-authority tests and typecheck pass. Fresh actual
RPC/WS/PG qualification at clean `da99664` kills an executor immediately after
admission: witness slot 1522 and seven access rows survive with zero attempts.
Restart after real expiry proves nonexecution, releases access and retains the
20,000-lamport unknown-fee reserve. The run also passes post-send SIGKILL recovery,
SQL fairness/drain cases and identical 61-event fresh replay, with eight members,
70 accounts and 7,999,993 vault atoms. Evidence remains in
`.local/liquidity-execution/runs/p44-review-dispatch/`.

All review threads were resolved before merge. The P43 cross-run comparison claim
was narrowed to its recorded aggregates; service-role CU is explicitly labelled
transaction CU. Automated reviews skipped/rate-limited on #56/#58/#59/#60 and the
latest #62 update are not independent approval. No additional program build,
load/endurance run or external qualification was needed for this queue/docs fix.
The fetched merge has identical tree and includes the tested fix as an ancestor.
No implementation blocker remains within this completed scope.
P45 used this frozen B baseline to scope the subsequently accepted RC2 migration;
the integrated M13 checkpoint above records its implementation and qualification.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
