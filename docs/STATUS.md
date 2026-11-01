# Current status

Updated 1 November 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P38 and M1–M5b/M7–M11 are integrated within their recorded
engineering scopes. The consolidation stack merged at
**`caa47d29d1dc0fe790025d21121b37617669a809`**, with complete tree identical to accepted
tip `9d3e15f`. [Validation](operations/validation.md) distinguishes historical
evidence from the fresh consolidation qualification; [HISTORY](HISTORY.md) records
the integration and preceding baselines.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| M12 performance and contention | Review | P39–P44 acceptance complete; open seven-PR stack awaits review/integration; no framework migration |
| P39 dependency audit/baseline | Review | [PR #55](https://github.com/arnabnandikgp/rivalt/pull/55); accepted focused RPC/WS baseline and 61-entrypoint inventory |
| P40 scoped events/services | Review | A and B acceptance passed; awaiting stack integration |
| P40A bounded service execution | Review | [PR #56](https://github.com/arnabnandikgp/rivalt/pull/56), stacked on #55; scoped RPC/WS/PG fault and fresh replay acceptance passed |
| P40B scoped event history | Review | [PR #58](https://github.com/arnabnandikgp/rivalt/pull/58), stacked on #56; scoped history and exact financial acceptance pass |
| P41 relevant market dependencies | Review | [PR #59](https://github.com/arnabnandikgp/rivalt/pull/59), stacked on #58; accepted clean `ca8bab0` / SBF `b0c5675` |
| P42 custody/accounting isolation | Review | [PR #60](https://github.com/arnabnandikgp/rivalt/pull/60), stacked on #59; D87 schema-7 financial/lock/settlement/gateway/default and fresh SQL replay acceptance passes |
| P43 targeted CU optimization | Review | [PR #61](https://github.com/arnabnandikgp/rivalt/pull/61), ready above #60; Same-workload CU comparison, 147/165 full-book outcomes and 290 safety outcomes pass on uninstrumented SBF `fb5d0c5`; gains and limitations recorded |
| P44 frozen pre-v2 qualification | Review | [PR #62](https://github.com/arnabnandikgp/rivalt/pull/62), ready above #61; frozen 61-entrypoint baseline, integrated recovery/replay and measured cost/load envelope |
| M11 consolidation | Closed | P35–P38 accepted and integrated; merged tree equals accepted stack tip |
| P35 component docs/handoff | Closed | [PR #50](https://github.com/arnabnandikgp/rivalt/pull/50) merged; component contracts, maintenance AGENTS and provenance |
| P36 canonical names/ABI | Closed | [PR #51](https://github.com/arnabnandikgp/rivalt/pull/51) merged; canonical API names, preserved wire contract and passing CI |
| P37 legacy retirement/runtime | Closed | [PR #53](https://github.com/arnabnandikgp/rivalt/pull/53) merged; consolidated runtime and fresh integrated acceptance |
| P38 professional root README | Closed | [PR #54](https://github.com/arnabnandikgp/rivalt/pull/54) merged; professional entrypoint and scoped docs acceptance |
| P15B independent maker validation | Open — external | Actual independent operator/economics; internal bots and assumed hedges cannot substitute |
| P16B independent review/funded readiness | Open — external | Independent review, risk/reserve calibration and separate funded authorization |
| Continuous 24-hour endurance | Deferred | No run scheduled or completion claimed |

Review means accepted work awaiting integration; Closed requires acceptance plus
integration. The user authorized the consolidation stack's merge on 30 October 2026; the new
P39–P44 stack remains open for review.

## Accepted performance stack

P39–P44 follow D82. The integrated baseline remains unchanged until stack merge.
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
[PR #62](https://github.com/arnabnandikgp/rivalt/pull/62) is verified ready/open above
#61; all seven stack PRs remain open. Hosted checks and review are visible on the
PR and are separate from the recorded local acceptance. All four applicable hosted
jobs (scope, shell, client and financial) pass on acceptance content `ade628d` in
[run 41276941491](https://github.com/arnabnandikgp/rivalt/actions/runs/41276941491);
the report job is correctly skipped. Later commits update handoff documentation
only; this does not claim a new code run or independent review approval.
Next exact action: address P44 review feedback when it arrives; await stack
integration authorization before merging. P39–P44 engineering
work is complete within these measured bounds; no Anchor v2 migration is started.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
