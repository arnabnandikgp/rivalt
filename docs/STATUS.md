# Current status

Updated 1 November 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P44 and M1–M5b/M7–M12 are integrated within their
recorded engineering scopes. The seven-PR performance stack merged at
**`6b14e8a4447729a6b55d38c22166c60a23083250`**, with the complete tree identical to
reviewed/tested tip `da9966401027a6cb92893db29251a2c696ae0fce`.
[Validation](operations/validation.md) records the exact qualification pins and
limits; [HISTORY](HISTORY.md) records the integration and preceding baselines.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| M13 Anchor RC2 migration | Active | P45 plan accepted; P46 in Review with green CI; P47 fresh qualification in progress |
| P45 migration contract | Review | [PR #63](https://github.com/arnabnandikgp/rivalt/pull/63) ready; architecture/release research, exact RC2 pins, ABI choice, code gap map and measurement/acceptance plan |
| P46 RC2 implementation | Review | [PR #64](https://github.com/arnabnandikgp/rivalt/pull/64) ready above #63; serialized C0 and scoped signed RPC/WS/PostgreSQL acceptance pass |
| P47 post-migration qualification | In progress | Separate frozen B/C0 readers reproduce actual coverage; remaining full matrix, resource/fee comparison and normal-runtime promotion |
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
integration. The user authorized the performance stack's review fixes and merge on
1 November 2026; all seven PRs independently report MERGED.

## P46 serialized port checkpoint

Work is on `implementation/p46-anchor-rc2` above ready PR #63 (`696851e`). The
serialized port's scoped acceptance passes; [PR #64](https://github.com/arnabnandikgp/rivalt/pull/64)
is open and ready with accepted content `44d1251`.
[Validation](operations/validation.md#anchor-rc2-serialized-port-p46) records the
actual checks and exact pins. Frozen P44 artifacts remain untouched.

Delivered: exact RC2 crates/CLI, bounded serialized registry/foreign-loader adapters,
contexts and typed CPI borrowing, scoped event codecs, canonical identifier delta,
clearing binding 8 / maker account schema 5, actual generated IDLs/SDK and isolated
legacy/RC2 clients. Fields, seeds, privileges, signed quote/report domains, financial
rules and default/devnet gates remain intact. No C1 zero-copy conversion is needed
to close this serialized port; P47 will assess the measured operating envelope.

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

P47 is still required for full entrypoint/full-book/64-member coverage, services,
browser, fault/load replay and the matched resource/fee comparison. Normal demo
promotion remains gated. P15B/P16B and deferred endurance are unchanged. No access
blocker is present. P47 continues on the accepted exact parent without merging #64.

## P47 qualification checkpoint

`implementation/p47-rc2-qualification` is stacked above #64 at `360a247`. The
separate baseline reader now loads immutable B IDLs and its schema-7 metadata;
replaying all **2,871** retained originals reproduces the unchanged **53,089-byte**
B summary exactly. It refuses baseline rewrites. The separate C0 collector checks
admitted binary hashes, exact source/IDL pins, signatures, RPC/WS, fees and CPI
ancestry. The three clean P46 runs currently establish **43/61** successful
entrypoints across **471** outcomes; their retained rejections cannot inflate
coverage. No new transaction or qualification is inferred from rereading evidence.

Six provenance regression cases reject changed/dirty/instrumented sources and
self-consistent but unadmitted binaries; four evidence-policy cases, typecheck and
documentation checks pass. Broad host suites are not rerun locally.

The approved bounded performance-summary budget moves to 256 KiB aggregate while
retaining 64 KiB per file; raw evidence stays ignored. Continuation/operational
launchers now require explicit RC2 candidate selection instead of selecting old
binaries beneath the new SDK. P47 has not promoted normal demo/operator artifacts.
Fresh clean verifier **`a01da5d`** on unchanged C0 binaries passes the focused
12-scenario/7-lock profile; 123 maker and 84 publisher outcomes; 207 dependency/
settlement outcomes with 149-event PostgreSQL replay; 63 retirement outcomes with
53-event replay; full protected/entry/stored books at 147/165/165 outcomes; and
712 complete-cohort outcomes. The independent audit verifies 64 exact payouts
(56 added members are flat) and rejects ten corruptions. Eight separate compiled
wide-scratch cases pass with unchanged financial bodies; they are not payout
history. The original 471 P46 outcomes remain separate constituents.

Two qualification tooling issues were observed. Fresh isolated chains replayed
27 byte-identical signed setup originals among 2,266 executions; some read different
fixture states and legitimately consume different CU. The collector now records
executions and unique originals separately, retains cross-run references and still
rejects duplicate receipts within a run or conflicting bytes under one signature.
Nine measurement tests and typecheck pass; the revised read-only collection covers
**60/61** entrypoints across **2,239 unique originals / 2,266 executions**. Only
`set_account_delegate` remains, in the incomplete service constituent.
The initial services attempt stopped at browser launch because its Playwright cache
is absent; an installed Chrome is available via the documented `RIVALT_CHROME_PATH`.
The installed-Chrome attempt then finalized six browser actions before a source
window expired during the next unsigned trade preparation. The browser fixture
now waits for live Normal source state before every trade and records at most
three unsigned preparation attempts for that exact refusal. Signed/ambiguous
originals are never retried or rebuilt by this loop; other errors remain fatal.
Neither initial attempt establishes a complete services/browser pass. Clean
`265640e` then finalized all ten browser actions with no page errors, including
API-blocked cash actions and reload. Its subsequent order-worker check timed out:
the live journal had rejected unchanged readonly venue metadata because JSONB
reordered object keys. Nine actual finalized custody events reproduce identical
venue values with different serialized key order in the retained database.
The projection now compares complete values structurally; array order, fields and
readonly enforcement remain exact. A new regression first reproduces the failure,
then accepts reordered metadata and rejects three actual changes. All 20 affected
projection/history/event tests and typecheck pass. A fresh integrated rerun is
still required; no complete service pass is claimed for this attempt. Evidence is
under `.local/anchor-rc2/p47-services-ready/`; logs/databases remain retained and
no financial safeguard, hash format or resource limit changed.

Clean **`b0b62ff`** passes the affected integrated rerun in
`.local/anchor-rc2/p47-services-jsonb/`: 254 harness outcomes, 468 durable originals
(457 successful / 11 failed), all ten browser actions, actual stored-order fill,
three SIGKILL/lost-ack recoveries, publisher rotation/revocation, source outage/
recovery and indexer restart. Fresh PostgreSQL replay matches 187 events over
70 accounts/eight members with zero unresolved jobs. Independent Python arithmetic
verifies 7,999,993 vault atoms, 7,999,665 funded root cash, fees [267,61], insurance
[66,15], flat inventory and zero aggregate unpaid claims. Internal makers remain
labelled; no hedge is executed. Complete service acceptance is now supported.

The bounded C0 entrypoint summary covers **61/61**, with **2,520 executions /
2,493 unique signed originals / 27 cross-run reexecutions**. Browser/operator
originals are separate populations, not silently added to that harness count.
The B/C reader compares 33,682 leaves across 22 reconstructed before/after states
for 11 successful focused cases. All financial fields and relative Unix times
match; 330 slot and 176 deployment-digest witnesses remain explicit differences.
Twelve paired CU observations therefore are not exact-input/pure-framework gains.
The initial C0 wrapper's incorrect `instrumented:true` metadata is explicitly
identified; actual pinned SBF hashes/manifests prove uninstrumented C0. Future
wrapper output is corrected without changing or rerunning those originals.
Fourteen affected comparison/provenance tests and typecheck pass.

Clean **`1a893ed`** now passes all three remaining RPC constituents. Dispatch
preserves seven access rows and a finalized-valid witness through pre-broadcast
SIGKILL, proves nonexecution after actual expiry, retains 20,000 unknown-fee
lamports, and passes post-send recovery plus identical 61-event PG replay.
The matched bounded load offers 1,008 actions: 466 submitted originals, 433 fills,
33 on-chain stale-version rejections, and 542 unsubmitted (537 generator limits /
five duplicate originals). Expired/unresolved are zero. Live indexing has two
coherent cycles / 33 revision-ahead retries; final/fresh replay matches 588 events
and 9,000,000 vault atoms. This does not establish sustained read readiness or TPS.
The operational worker completes liquidation, default with proposal-upload SIGKILL,
independent six-second recovery and all funded cash exits. Independent arithmetic
verifies ten Fraction payouts / one augmentation and rejects five corruptions;
192-event replay leaves only 452 insurance/protocol-fee atoms across ten members.
Evidence directories are `.local/anchor-rc2/p47-{dispatch,load,operations}-1a893ed/`.

The resource reader now records signed heap/data limits explicitly; absent requests
and missing observed heap/data metrics remain absent. Twelve affected parser tests
pass. Frozen B remains immutable. The only outstanding acceptance is compiled
devnet-feature negative gates / mixed-feature refusal, final report and normal
runtime promotion, then P47's ready PR. Disposable inactive Cargo targets under
`.local/anchor-v2-build/{cli,check,idl}` were removed after verifying no compiler
was running, recovering about 1.7 GiB; installed tools, SBF, logs, keys and databases
are preserved. No C1, funded/external gate or endurance run is claimed.
Next exact action: commit the scoped negative-gate/resource tooling, compile and
execute the local devnet-feature refusal checks, then finish P47 closeout.

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
P45 now uses the frozen B baseline to scope the separately requested RC2 migration;
the active P46 checkpoint above owns the next action.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
