# Current status

Updated 11 November 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P50 and M1–M5b/M7–M13 are integrated within their
recorded engineering scopes. The quantity/audit stack #68 → #69 → #71 merged
atomically at **`28db412378317a493459c8cc9e0f7310cb38e151`**, with the complete tree
identical to accepted tip `953cd1fbf40af8e22e7e7a0a60bc396a83966df2` and review fix
`d63e3b17631d8275aaf0e1afac371f1fd03ca8b6` retained as an ancestor.
[Validation](operations/validation.md) records the exact qualification pins and
limits; [HISTORY](HISTORY.md) records the integration and preceding baselines.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| P51A audit-remediation roadmap | Review | [Ready PR #72](https://github.com/arnabnandikgp/rivalt/pull/72); [P51–P62 plan](operations/remediation-plan.md) maps all 20 findings to 25 proposed PR scopes, dependencies, six decision gates and acceptance; clean `4025168` documentation checks pass |
| P51B account/settlement contract and feasibility | Review | [Ready PR #73](https://github.com/arnabnandikgp/rivalt/pull/73), above #72 in stack #74; clean `a5ac218`: 254 independent cohorts, 1,016 actual Rust comparisons, 16 compact scale diagnostics and maintained-backing model; native scope only |
| P52 bounded-progress finalized indexer | Review | [Ready PR #75](https://github.com/arnabnandikgp/rivalt/pull/75), above #73; clean `fe1c754`: 10,642 transactions / 4,306 invocations, three SIGKILL boundaries, continuous-write publication and identical 4,353-event fresh SQL replay |
| P53A shared price policy | Review | [Ready PR #76](https://github.com/arnabnandikgp/rivalt/pull/76), above #75; SBF `2136106`; publisher `55426dc` passes 99 signed outcomes; journal `e98b0eb` passes 120 outcomes and reconciled, byte-identical 72-event fresh replay |
| P53B calibrated ranges | Review | [Ready PR #77](https://github.com/arnabnandikgp/rivalt/pull/77), above #76; user-approved policy 2; SBF `afeb7ea`, publisher `10cadb7` (137 outcomes), boundary/PG and safety `82d2c6a` (228 / 290 outcomes); 176-event fresh replay |
| P54A scalable settlement kernel | Review | [Ready PR #78](https://github.com/arnabnandikgp/rivalt/pull/78), above #77; clean `60c2141`: 774 independent settlements, 307 rejection cases and 16 completed native scale cases; no runtime activation |
| P54B–P62 successor implementation | Planned | Authenticated paging, membership and expanded activation follow their existing gates |
| P50 architecture constraint audit | Closed | [PR #71](https://github.com/arnabnandikgp/rivalt/pull/71) merged; source/provenance inspection of `2a77c24`; [findings](operations/constraints.md) now mapped into the requested remediation plan |
| P48 exact interval allocation | Closed | [PR #68](https://github.com/arnabnandikgp/rivalt/pull/68) merged; clean `5e5aede`: 715 independent cases, 23 affected SDK/service checks, 130 signed RPC/WS outcomes; old limits retained at its revision |
| P49 expanded quantities | Closed | [PR #69](https://github.com/arnabnandikgp/rivalt/pull/69) merged; SBF `49c343e`, verifier `125a2b3`: 231 signed outcomes, 188-event PostgreSQL replay and 146 matched full-book outcomes; review fix `d63e3b1` accepted |
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
integration. The user authorized this stack's review fixes and merge on
10 November 2026; all three PRs independently report MERGED, and the open-PR query
at that closeout returned none. The fetched merge has the accepted tip's exact tree.
The user subsequently requested and accepted the complete remediation roadmap,
authorizing implementation through its dependencies. New PRs stay open and stacked.
Next exact action: implement P54B's authenticated frozen input and rate verification
above ready #78 in stack #74; leave every PR open.

## Remediation planning

P51A uses integrated baseline `e9eb320f65ca62f4bffefe9f1cd73a6f9feb4f1a` and D92.
One [roadmap](operations/remediation-plan.md) owns the human overview and detailed
agent acceptance rather than adding a document per phase. It covers scalable
membership/default/backing, indexer progress, price policy, maker admission,
economic and funding-index calibration, operator costs/scheduling, user capacity
and confirmed vestiges. P51B's executable design decides the detailed settlement
mechanism; the roadmap does not assume paging solves exact arithmetic or approve
different payouts. Later changes remain subject to their stated decision gates.

P51A changed only documentation. Validation at clean
`4025168cb3d4bfcc4e3ee0e7e0d42cc6415892b0` passes for six
changed Markdown files, 129 local links/anchors, all
25 phase headings and ordered dependencies, all 20 findings, six decision gates,
whitespace and the tracked-evidence policy. No runtime suite was needed.
P15B/P16B remain Open and 24-hour endurance Deferred. No access blocker is known.
P51A is published ready as #72 and remains open. Its later handoff update adds
only publication metadata; P51B's newly authorized work is distinguished below.

## Account-scale feasibility

P51B branches from accepted planning tip `0e864d98dc1243e83ee4af113048f9021980fe2b`.
D93 and the existing component documents record the code-to-design matrix,
identity/financial-membership boundaries, versioned layout targets, authority,
retirement, frozen recovery, migration and G1–G3 recommendations. Schema 8 remains
the actual program; no account cap, economic rule, artifact or IDL changed.

Clean **`a5ac218d6e439be74fc136bed67c2d5b9e733a41`** passes six focused tests:
254 cohorts match the independent branch oracle and 1,016 actual retained Rust
rate/mutation/atom/continuation cases. Exact interval composition, reduced LCM and
compact conserving rounding preserve current atom owners. All 16 compact native
scale diagnostics finish, including four 10,000-row shapes; the dense baseline
explicitly stops three at its work/storage budgets. The hardest compact shapes
take about 24–25 seconds in Python, not SBF CU or landed recovery time.
The maintained-backing model completes a 256-row scan under mutations with 1,536
independently enumerated price/funding-corner comparisons. Shell, Python compilation,
links, whitespace and evidence-policy checks pass. The new suites join financial
CI; no larger-runtime acceptance is claimed. Full details and limitations
are in [validation](operations/validation.md#account-scale-native-feasibility-p51b).

P51B is published ready as #73 above #72 in stack #74; both remain open.
This is contract/native acceptance only, not larger-account runtime qualification.
Hosted [run 42872021846](https://github.com/arnabnandikgp/rivalt/actions/runs/42872021846)
completed successfully on exact published tip `b7d7686`: scope, financial and shell
pass; client/report are skipped. CodeRabbit is skipped, so no external review is
claimed. This later hosted result is separate from the clean native measurements.
No access blocker is known. P54/P55 still own compiled paging, complete mutation
coverage, worst-case storage provisioning and bounded continuation costs; P56B alone
can enable expanded local trading after actual RPC/WS/PostgreSQL qualification.
P15B/P16B remain Open, 24-hour endurance Deferred, and no external/funded action
has been performed.

P52 starts above verified #73 tip `b7d768696547c688e4d1de30f2f5c3c78d14092f`.
The implementation now commits one complete block at a time, applies the block
range/work budgets, separates covered/published snapshots and caps API events at
the reconciled cursor. D94 corrects the initial capture proposal: publication needs
one common historical revision vector and complete matching financial fields;
forward-overwriting an older candidate is insufficient proof. SQL format 3 requires
a fresh journal, preserving earlier databases/originals. Program artifacts and
account schema 8 remain unchanged.

Clean **`fe1c754e985b56e653b03795af8daf2b8ca59e62`** passes full signed
Surfpool/RPC/WS/PostgreSQL qualification: 10,642 transactions / 4,306 invocations
at backlog reconciliation, all three real SIGKILL boundaries, WS reconnect,
identical-original recovery during indexing lag, rejected-history/publication/
format checks, three advancing publications during 74 continuous delegate updates
and identical complete state / 4,353-event fresh replay. Seventy entities/eight
margin roots and 8,000,000 actual/allocated collateral atoms reconcile. The full
run lasts 306.954 seconds. Program artifacts and account schema remain unchanged.
[Validation](operations/validation.md#bounded-progress-indexer-p52) records actual
resource observations, exact commands and limitations; this is not larger-account,
production-throughput or endurance acceptance.

The same runtime code at clean `32988bb` passes typecheck, 44 scoped tests and the
small live diagnostic. The later caller adjustment makes demo startup wait for
published readiness, not merely a completed recovery cycle; typecheck and 11
existing demo transport checks pass after this entrypoint-only adjustment. These
checks do not execute browser startup; no new browser run is inferred. D94's fixed
witness solves the observed local RPC account/context skew while retaining full
financial comparisons, canonical finalized history and ten-second freshness.

Full and diagnostic evidence remain at their original ignored paths under
`.local/indexer-progress/`. Failed attempts remain retained; none substitute for
the accepted full run. The owned qualification runtime stopped successfully.
[Ready PR #75](https://github.com/arnabnandikgp/rivalt/pull/75) contains acceptance
closeout `1eb86ff` above #73. All applicable hosted checks (scope/client/shell) pass at `c6913b2` in
[run 42970638033](https://github.com/arnabnandikgp/rivalt/actions/runs/42970638033);
report/financial are correctly skipped. Automated CodeRabbit check also reports
success; this is not independent financial review. No access blocker is known.
P15B/P16B remain Open and 24-hour endurance Deferred.

## Price-policy consolidation

P53 is split into P53A consolidation and P53B calibrated-range acceptance (D95).
P53A names the existing numeric/economic price domains and generates SDK constants
from Rust. Source normalization, order/trigger checks, maker/routing execution bands,
funding, liquidation and UI preserve their current values. No new risk range,
account layout, live parameter authority or deployment is enabled.

Clean SBF `2136106` and actual signed verifiers `55426dc`/`e98b0eb` pass scoped
acceptance: 99 publisher outcomes (12 reports), 120 financial/journal outcomes,
exact published fresh state and all 72 retained event bytes. Seventy entities/eight
roots and 8,000,000 allocated/actual vault atoms reconcile; independent fee checks
pass. Only qualification clearing changes (+896 bytes); makers/defaults/fixtures
are byte-identical to P49. P53A artifacts remain retained; P53B supersedes the local selection below.
Owned runtimes are stopped.

Typecheck, 59 SDK/UI, 22 financial-core and 29 clearing-engine native checks pass,
with generation/ABI/document/shell/evidence checks. No broad local regression,
browser, larger-account or endurance run is inferred. The first projection-only
journal pass and the subsequent host-sleep timeout remain retained. The final
probe requires fresh published readiness and exact event bytes, with unchanged
freshness/deadlines and a temporary supervisor-owned idle-sleep inhibitor.
[Validation](operations/validation.md#shared-unchanged-price-policy-p53a) records
exact pins, results and limitations. [Ready PR #76](https://github.com/arnabnandikgp/rivalt/pull/76)
contains acceptance closeout `a24251e`; all five scoped hosted jobs pass at
`b6fbcb8` in [run 42977315184](https://github.com/arnabnandikgp/rivalt/actions/runs/42977315184).
CodeRabbit is neutral, not external approval. P53A is not integrated.

P53B's [numeric-bound policy](clearing/risk-and-resolution.md#approved-p53b-calibration)
was explicitly approved on 11 November: reference/trigger 2–909,090 and order
limit 1–1,000,000 atoms/lot. Raw assets are positive/checked and the entire risk
interval must fit; source safeguards and the arithmetic/economic boundaries stay
unchanged. P58A's canonical depth search is brought forward without changing impact
notional or adding maker financial admission. Its public helper now accepts canonical
curve records rather than arbitrary quote callbacks; full snapshot authentication
remains the report builder's responsibility.

Clean SBF **`afeb7eae419bc66cf1c902932fea79a994fa4dc1`** builds safely; clearing is
1,538,848 bytes (+64 vs P53A), every other binary unchanged. Clean publisher
**`10cadb7`** passes 137 outcomes / 21 reports, including Q=3m and source faults.
Clean **`82d2c6a`** passes 228 boundary/journal and 290 safety outcomes. Actual BTC/ETH
edge trades, stored limits/triggers, stale-source deposits/cancels/exits, whole-account
reservations, TP/SL, liquidation, complete default and recovery pass. Fresh published
PostgreSQL replay matches all **176 event bytes** and the complete financial state;
8,000,000 actual/allocated atoms reconcile, with independent aggregate fees **848**.
The default audit verifies eight Fraction payouts and rejects ten corruptions.

Scoped checks: 23 financial-core, 29 clearing-engine, 52 client/UI cases including
1,536 independent funding allocations; generation, exact ABI and typecheck pass.
At clean `afeb7ea`, 1,800 CPU measurements peak at 329 distinct quotes,
p95 0.394 ms / p99 0.535 ms. Publisher max is 21,035 CU, three-million-lot sample
21,007 CU; boundary route max 160,356 CU. These are bounded measurements, not full-book,
worst-case latency or production-throughput claims. [Validation](operations/validation.md#numeric-bound-price-policy-p53b)
records pins, commands, limitations and the first Clock-wait harness failure.

The accepted candidate is selected locally, with prior artifacts/failed runs retained
under existing ignored paths. All owned runtimes stopped. No external/funded action,
new browser or endurance run is claimed. P53B is published as [ready PR #77](https://github.com/arnabnandikgp/rivalt/pull/77)
above #76 in stack #74; all five PRs remain open. Scope/client/financial hosted checks pass at `c7fdfb9`
in [run 43009090127](https://github.com/arnabnandikgp/rivalt/actions/runs/43009090127);
report/shell are correctly skipped. CodeRabbit was still running at inspection.
P54A follows on the unchanged numeric proof. P15B/P16B remain
Open, endurance Deferred, and P58's other economic decision gates remain separate.

## Scalable settlement implementation

P54A starts on `implementation/p54a-scalable-settlement` above ready #77 tip
`c7fdfb9`. D96 and the risk contract specify the bounded logical-register cursor.
The pinned platform-tools compiler reports `target_arch="sbf"`, so the initial
`bpf`-architecture exclusion was insufficient. The follow-up guard uses the actual
`target_os="solana"`, with a targeted host cfg declaration. Host checking and actual
SBF-target metadata probes pass: the word cursor remains available and all four
native orchestration modules are absent. This is a compiler-boundary correction,
not a program build/deployment or changed financial result. Clean guard pin
**`7aef54f1d6908f9cef0e9186a386ddb79341793b`** also passes the 774 settlement,
307 rejection and 980 division checks again. The larger native measurements below
remain at their original pin; CI for the guard update is pending.

The complete native kernel now checks count-derived aggregate conservation, exact
rate/greatestness equations, all insurance-clipping evaluations and deterministic
conserving rounding. Hierarchical active arcs and generation marks replace fixed
graphs and resets; normalized atom division avoids repeated whole-width searches.
Cash, market writeoffs/impairment, insurance and retained fees stay explicit.
Clean **`60c2141eb2a7af30bc8a6d99dd752167549c3263`** passes native acceptance: 774 complete
settlements across 258 independent cohorts and 1/7/128-step budgets, 307 rejected
requests, 980 exact division cases and three aggregate/product boundary vectors.
The earlier 2,105 arithmetic/LCM/collection comparisons pass again. The active
hierarchy passes 80,000 independent ordered-set update/search pairs. All 16 scale
cases finish across 64/128/1,024/10,000 rows, with exact cash and atom-owner equality.
Scoped format, documentation, Python/shell and evidence checks pass.
[Validation](operations/validation.md#scalable-native-settlement-p54a) records actual
commands, populations, CPU/work/storage observations and limitations.

No program handler, account layout, selected artifact or account-count activation
changes. Native vector orchestration is excluded from SBF. The hardest 10,000-row
case takes 7.917139 native seconds but uses 2.67 billion arithmetic word steps;
completion does not establish affordable on-chain resolution. P54B/P54C must measure
authenticated continuations and total cost before expanded activation. No SBF,
RPC/WS/PostgreSQL, browser or external qualification is inferred. P15B/P16B remain
Open and 24-hour endurance Deferred. No access blocker is known.
[Ready PR #78](https://github.com/arnabnandikgp/rivalt/pull/78) contains cohesive P54A
acceptance above #77 in stack #74. Hosted checks are pending; no external review is
claimed. Next exact action: implement P54B's authenticated frozen input and rate
work on its child branch, leaving the stack open.

## Integrated quantity work

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
P49 removes both inherited ceilings within the existing **100,000,000-lot**
financial domain. Programs, SDK/API/UI, order reservations and liquidation agree;
signed order fee input uses the existing cash domain, and worker size probes start
at remaining quantity. Two makers, eight regions, position/gross/cash bounds,
2 bps fees, insurance, funding and all risk checks remain enforced.

Clean SBF **`49c343e6e77a327fc9fa00c5b2a2e172dceb380d`** has safe stack frames and
fresh generated IDLs identical to the existing contract. Clean verifier
**`125a2b3eafaa4413a31ba82a4dfcf183258f9f79`** passes **231 signed RPC/WS outcomes**:
100m-lot open/close, million-lot SDK routing and two-program stored partials,
large TP/SL, reservations/transfer/withdrawal, whole-account funding, 500k-lot
liquidation and complete default. Independent raw-byte audits check nine fills,
eight exact Fraction payouts and mutation rejection. The fresh PostgreSQL replay
matches all **188 events**. A separate **146-outcome** matched full-book probe
measures 305,112 CU, versus P47's 305,080; the 100m singleton uses 166,449 CU.
[Validation](operations/validation.md#expanded-quantities-p49) records checks and
[performance](operations/performance.md#expanded-quantity-measurements-p49) records
resource assumptions. Raw evidence remains `.local/quantity/p49-*`.

Thirty-one affected native checks, 62 SDK/UI/service checks, 3,172 independent Rust
quote vectors, 715 independent router cases and 27 curve-contract cases pass.
The new artifact identity is pinned and promoted to `.local/anchor-rc2/current`;
prior C0 files/journals remain retained. No account/IDL layout changed. Both owned
Surfpool runs and their test PostgreSQL container are stopped. Compiler tools were
restored; there is no access blocker. P48's applicable hosted CI passed on #68;
P49 is merged as [PR #69](https://github.com/arnabnandikgp/rivalt/pull/69).
Scope/client/financial/shell hosted checks pass on review fix `d63e3b1` in
[run 42850851592](https://github.com/arnabnandikgp/rivalt/actions/runs/42850851592);
report is correctly skipped. The P49 review identified two valid
interface-documentation corrections and unnecessary source-unavailable order
probes. The worker now stops that order's current pass after a missing-source
result; smaller expiry/depth/health/search-budget probes remain eligible because
allocation can change. Seventeen focused worker/route tests and typecheck pass
on review fix `d63e3b1`.
These are consumer/control-flow checks, not new signed integration evidence;
programs, financial admission and durable-original handling are unchanged.
Pending acceptance detail was removed from HISTORY and replaced with the verified
integration. P48's publication-status finding is corrected here. All three inline
review threads were resolved before the atomic merge. The expiry-shortcut portion
of a review suggestion was rejected with the allocation-dependent counterexample.
The latest P49 automated re-review was still running at merge; no completed
re-review is inferred. No new runtime integration or unrelated local suite was
needed for the early-stop/docs correction; exact earlier evidence stays pinned.
P15B/P16B and deferred endurance are unchanged; no public/funded deployment is
qualified.

## Architecture constraint review

The user requested a detailed audit of inherited prototype assumptions after the
quantity work. P50 inspects current source and targeted local Git provenance at
`2a77c2419a6b80acf452a8604ba0fe904d3f35ff`; it changes documentation only. Findings
cover lifetime membership/complete-default capacity, price bands, funding impact
size, liquidation compensation, indexer progress, maker admission, numeric/OI and
funding lifetime bounds, account/order capacity, client fees and worker scheduling.
Confirmed vestiges include an unused pagination option and reference-only Rust
funding enumeration. The [audit](operations/constraints.md) separates source facts,
constructed examples, proposed remedies and protected deliberate scope.

Validation: source/call-site searches, historical decision checks, exact unit
arithmetic and document/path checks. No new financial test, runtime benchmark,
security certification or production readiness is inferred. There is no blocker.
P50 is merged as [PR #71](https://github.com/arnabnandikgp/rivalt/pull/71).
Its documentation-only delta is outside the hosted code-workflow paths; no P50
hosted code test is claimed. Its automated
review was rate-limited; this is not independent approval. The user deferred audit
remediation, including the 64-account redesign, until after integration. The new
P51A planning request is recorded above; no remedy is implemented by the audit or
the planning document itself.

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
