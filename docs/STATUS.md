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
| M13 Anchor RC2 migration | Planning | P45 plan; proposed P46 port and P47 fresh qualification against frozen P44 B; implementation not started |
| P45 migration contract | Review | [PR #63](https://github.com/arnabnandikgp/rivalt/pull/63) ready; architecture/release research, exact RC2 pins, ABI choice, code gap map and measurement/acceptance plan |
| P46 RC2 implementation | Planned — after plan review | Correct serialized port, explicit fresh ABI and generated clients; separately measured selective zero-copy only if justified |
| P47 post-migration qualification | Planned — depends on P46 | Complete compiled financial/service/browser/load matrix and matched cost report; no inherited qualification |
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

## P45 migration planning checkpoint

The user requests the Anchor v2 architecture documentation first, then the
migration guide and a detailed plan, with implementation in the next PR. The
[migration plan](operations/anchor-v2-migration.md) and D90 propose P45 → P46 → P47.
Current code, lockfiles, tools, financial rules and qualified artifacts are unchanged.

Research inspected baseline `c0bc3aaa3825896fcafbc879fe104362da61c21d`, the eight
official documentation sections, migration guide and RC2 release notes. Four
published Rust archives were checksum-verified against registry metadata; all
identify source `a20660219882af5f199d56ea3f9326f387f89d8b`. RC2 client metadata was
checked separately. Local reference copies and the derived ABI inventory remain
ignored under `.local/anchor-v2-planning/`.

The important compatibility finding is concrete: all 61 current instruction
discriminators are custom eight-byte values, while stock RC2 executable macros
support only canonical hashes or one-byte custom values. Maker-owned account/event
overrides also need explicit treatment. Recommend a fresh bounded ABI with canonical
eight-byte identifiers, clearing schema 8/maker account schema 5 and coordinated
client/journal binding. The plan retains serialized field layouts first, immutable
B evidence, isolated tools/artifacts, guards and actual RPC/WS/PG acceptance.
Small zero-copy conversions require separate measured C0/C1 checkpoints; no saving
or live state migration is claimed.

Planning acceptance: source/IDL counts and discriminator hashes independently
enumerated (53 clearing + four per maker; 17 clearing account types, 28 clearing
events); proposed instruction hashes are unique and disjoint from old identifiers
within each program. At clean planning commit `e48a7ec`, the read-only documentation
check passes with 304 relative links,
112 historical Git targets, 71 source/command paths and no errors;
whitespace and staged evidence-policy checks pass. Immutable upstream source and migration-guide links
return HTTP 200. No install, dependency resolution, SDK generation, SBF build, runtime
test, load, browser check, devnet or full regression was run for this documentation
change. Hosted workflow path filters exclude docs-only PRs; no CI pass is implied.

No access blocker prevents planning. RC2 SBF/tool compatibility, bounded codecs,
IDL/Codama support, CPI borrow behavior and financial/resource equivalence remain
unproved implementation gates, with explicit acceptance in the plan. P15B/P16B
and deferred endurance are unchanged. Ready PR #63 remains open. Next exact action:
after the user's plan review, begin P46's isolated RC2 toolchain and serialized C0
port with the explicit ABI delta. No implementation is started in this run.

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
the active planning checkpoint above owns the next action. Implementation has not
started.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
