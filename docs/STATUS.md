# Current status

Updated 31 October 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P38 and M1–M5b/M7–M11 are integrated within their recorded
engineering scopes. The consolidation stack merged at
**`caa47d29d1dc0fe790025d21121b37617669a809`**, with complete tree identical to accepted
tip `9d3e15f`. [Validation](operations/validation.md) distinguishes historical
evidence from the fresh consolidation qualification; [HISTORY](HISTORY.md) records
the integration and preceding baselines.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| M12 performance and contention | In progress | Authorized P39–P44; [contract](operations/performance.md), fresh pre-v2 baseline before any framework migration |
| P39 dependency audit/baseline | Review | [PR #55](https://github.com/arnabnandikgp/rivalt/pull/55); accepted focused RPC/WS baseline and 61-entrypoint inventory |
| P40 scoped events/services | In progress | Split into two cohesive PRs under D83; umbrella acceptance requires A and B |
| P40A bounded service execution | Review | [PR #56](https://github.com/arnabnandikgp/rivalt/pull/56), stacked on #55; scoped RPC/WS/PG fault and fresh replay acceptance passed |
| P40B scoped event history | In progress | D84 layouts/envelopes wired through all 53 entrypoints; scoped native/IDL checks pass, generated SDK/ABI parity passes; journal/SBF acceptance pending |
| P41 relevant market dependencies | Planned | Preserve all consumed funding and complete risk dependencies |
| P42 custody/accounting isolation | Planned | Exact cash/fees/insurance, narrower contexts, measured certificate progress |
| P43 targeted CU optimization | Planned | Profile the redesigned financial paths without weakening admission |
| P44 frozen pre-v2 qualification | Planned | Fresh complete supported-path profiling, integrated reconciliation, cost and capacity envelope |
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

## Consolidation checkpoint

P35 maintains 20 component documents and a 93-line agent handoff. All 111 original
documents have a current-owner or immutable-history disposition; raw evidence stays
local and ignored. Validated content `d64cb93`, ready head `72187bc`.

P36 canonical Rust/IDL/SDK names retain original discriminators, layouts, metas,
seeds, errors, numeric schemas and signed domains. Renamed SBF source `cff1cf9`;
final scoped RPC/Anchor verifier `53beba5`. The stale-name CI fixture repair is
`b94381a`; all five hosted jobs pass on final head `3511e44` in
[run 41003463384](https://github.com/arnabnandikgp/rivalt/actions/runs/41003463384).
P37 included that exact parent head. No independent review approval is inferred.

P37 uses one current account engine, canonical maker/publisher API, SDK, indexer,
services, UI and demo. Obsolete isolated/group/fixed-maker runtimes and disabled
on-chain sampling leave the active tree after shared primitives and applicable
regressions move. D81 and the [dispositions](REPOSITORY-CONSOLIDATION.md#p37-disposition-and-compatibility-boundary)
record intentional API retirement. Existing deployments, databases, keys, signed
originals and user research remain untouched. Current wire expectations are frozen
from pre-retirement `b89768b`, not regenerated from changed layouts.

Clean SBF source: **`828fe5431433f19cd562a23f44c45258ddbd61aa`**. Current binaries
and IDLs have not changed since that build; measured allowlist commit `629d44a`.
Clearing is 2,290,224 bytes; each maker 260,560 bytes; no oversized stack diagnostic.
See [fresh qualification](operations/validation.md#current-runtime-consolidation-qualification)
for exact verifier pins, failures repaired, evidence paths and resource bounds.

Actual acceptance includes 229 client tests, 102 native clearing tests in each of
qualified/default builds, independent financial/pricing/allocation references,
three compiled default gates, five compiled hostile-CPI rollback cases and actual
Surfpool RPC/WS custody, publisher, trading, safety and full-book transactions.
Services at `a9878a0` resolve 343 originals and 84 reports, pass ten browser actions,
three SIGKILL/lost-ack recoveries and identical 169-event PostgreSQL replay.
Independent per-trader cash/claim/fee/insurance reconciliation passes.

Operational run `d62c709` completes restart during proposal upload, ten-root default,
sustained recovery and every funded exit. All 84 worker originals resolve; vault
residual is exactly 452 atoms of market insurance/protocol fees. Independent exact
Fraction replay and five corruption rejections pass. Journal run `f6b84a0` verifies
SQL rollback, restart, reverted-event exclusion and 72-event fresh replay.

The migrated demo passes at `a0a3651`: 13 actual browser-wallet originals covering
creation, both margin modes, deposit/allocation, BTC/ETH trades, TP/SL/cancel,
reduce-only closes, token-reconciled withdrawal and saved-receipt reload. Owned
processes and PostgreSQL are stopped; all test ports are released. Previous stopped
runtime and every failed attempt remain in place. Final scoped client checks pass
19 cases; typecheck, generated parity, wire/evidence policy and doc links pass.

No new load/latency comparison, endurance, external wallet, independent-maker,
external review or current devnet/funded qualification is claimed. Dedicated indexer
smoke was omitted because the broader services/operations runs exercise its current
projection/rebuild and the journal run adds real SQL rollback/reverted-event checks.
P37's scope, client, financial, report and shell jobs all pass on `159ea27` in
[run 41016415771](https://github.com/arnabnandikgp/rivalt/actions/runs/41016415771).
Its automated reviewer skipped the large diff; no independent review is claimed.

P37's accepted content is `1494881`; PR #53 merged with its #51 parent. Initial GitHub push
timed out; the retry succeeded without changing the content or stack relationships.

P38 rewrites the root README around the current implementation and qualified local
demo, with the component map and exact limits linked instead of duplicated phase
history. Clean content `9a59ca8` passes 265 relative links/anchors, 112 immutable
historical targets, 42 source/command paths, whitespace and evidence-policy checks.
Its scope is Markdown only; runtime/build/financial suites are not rerun. PR #54
merged with its #53 parent. The executable CI workflow's path filter does not run for this
Markdown-only PR; its local checks are recorded, not described as a hosted pass.

The stack **#50 → #51 → #53 → #54** merged atomically with no unresolved review
threads. P54's automated review was still running; no independent approval is claimed.
The merge was fetched, every PR's MERGED state checked and tree equality verified;
local `main` fast-forwarded without touching unrelated research or local evidence.
Only documentation/whitespace/evidence checks apply to this closeout. No financial,
RPC/WS/PostgreSQL, browser, load or endurance suite is rerun for merge metadata.

## Performance checkpoint

The user authorized P39–P44 under D82. P39 is on `performance/p39-contract`, based
on `4f84f2b`; no runtime layout or program binary changed. Clean harness `0ac6511`
passes the focused signed probe against hash-verified SBF `828fe543`: 117 setup
outcomes and 12 measured scenarios, including one expected stale-account rejection.
Every outcome is fetched over RPC with WS confirmation and original-wire equality.
Independent cash/claim/fee/insurance checks reconcile all eight roots. Isolated
legacy Anchor conformance checks 207 instruction encodings and 185 event decodes.
See [measurements](operations/performance.md#current-results) and the bounded
[baseline](../tests/performance/baselines/p39-before-redesign.json) for exact values,
binary pins, conflict comparisons and limitations. Raw receipts remain at
`.local/liquidity-execution/runs/p39-baseline-0ac6511/`; owned ports are released.

The complete static access inventory covers 61 deployed entrypoints, 50 clearing
custody writers. Six scoped lock-model tests, typecheck, inventory and evidence
policy pass. The receipt summarizer verifies twelve retained transactions and seven
access comparisons. Offline dependency installation initially failed due to missing
cache tarballs; pinned normal installation succeeded without dependency upgrades.
No SBF rebuild, broad financial suite or PostgreSQL run is warranted for these
harness/docs changes. No full CU coverage, scheduler throughput, endurance or
migration result is claimed. P40/P44 must supply their own integrated acceptance.

The user approved deletion of exactly 23 older stopped PostgreSQL test-data copies
(2.18 GiB). Container state was independently checked before deletion; all approved
copies were removed. Current P40A data, every interactive demo, raw evidence, logs,
keys, configuration and installed dependencies remain. The local manifest is
`.local/p40-inactive-db-cleanup.json`; P40B's disk-space blocker is cleared.

P39 review clarifies that compiled-message coverage applies to the focused scenarios,
while the 61-entrypoint inventory is static. No metric or runtime changes.

P39 is published ready for review as [PR #55](https://github.com/arnabnandikgp/rivalt/pull/55).
Measured harness is `0ac6511`; verified summary/acceptance content is `b810b13`.

P39 CI passes all five applicable hosted jobs on `2df1c30` in
[run 41031665229](https://github.com/arnabnandikgp/rivalt/actions/runs/41031665229).
P40A is based on that exact parent. It adds two bounded execution lanes and durable
signed-message conflict reservations, with an explicit drain-before-upgrade gate.
Fourteen targeted dispatch/expiry/liquidation-authority consumer cases and typecheck
pass. Actual RPC/WS/PostgreSQL acceptance passes at clean `9134fd6`: two independent
originals concurrently broadcast once despite duplicate executors; shared-payer
work defers without an attempt; a genuine failed original releases access and
charges its actual fee. Real finalized expiry releases resource locks while
retaining 20,000 lamports of unknown-fee reserve. Actual SIGKILL after upstream
acceptance recovers the original seven-atom withdrawal exactly once; cash totals
7,999,993 atoms and fresh 61-event PostgreSQL replay matches. Eight originals are
six finalized successes, one landed rejection and one proven unexecuted expiry;
operator spent fees total 60,000 lamports. Owned test ports are released. Raw
records are in `.local/liquidity-execution/runs/p40a-dispatch-9134fd6/`.

Additional SQL checks pass at `a2860f9` on that retained owned database: read/read
sharing, W/W and both W/R conflicts, persistence after releasing the connection,
legacy ambiguity rejection and idempotent activation after a known receipt.
`dispatch-database.json` records these as SQL access fixtures, not new economic
executions. Their first typecheck found an unresolvable direct `pg` import from
the test workspace; using the existing store's public pool type fixes it, and
typecheck passes. The database is stopped again. Executable service code is
identical to the successful `9134fd6` run; `a1a44a5` merges P39's documentation-only
review correction without rewriting either tested commit. No on-chain ABI/event migration or validator throughput
is claimed. Broad financial/build/browser suites are unnecessary for this service
part; no prior evidence is presented as a new pass.

P40A is ready for review in [PR #56](https://github.com/arnabnandikgp/rivalt/pull/56),
stacked on #55. Accepted content is `0d124c1`; service runtime remains `9134fd6`.

P40B is on `performance/p40-scoped-history`, based on accepted P40A `f8984e0`.
D84 freezes schema-5 account revisions, bounded envelopes, transaction-atomic
read/write ordering, a fresh journal domain and the terminal retirement pause
barrier replacing its old global sequence dependency. Six independent ordering
cases pass; the ordering primitive is not connected to the active journal.

The current P40B source candidate now has all 17 schema-5 layouts, canonical
account/event discriminators, bounded counted financial payloads and final scoped
envelopes on all 53 clearing entrypoints. Explicit coverage checks all 42 contexts,
including nested/optional fields and stage-authorized remaining roots. Twenty
sequence-only custody writer variants become readonly; cash/liability writers
remain. Six revision/header/envelope cases and eleven affected layout/event/retirement
cases pass, including borrowed-event parity and readonly privilege promotion.
The retirement scan requires the same paused safety epoch and complete membership.

Default native compilation and all three isolated IDL builds pass. The rebuilt
IDLs match the independently specified delta from immutable P40A `f8984e0`;
maker-owned ABIs remain unchanged, with their imported clearing types revised.
The first check correctly exposed those three imported types, now explicitly
covered by the contract. Raw checks are `.local/p40b-native-tests.log`,
`.local/p40b-layout-tests.log` and `.local/p40b-idl*.log`; candidate IDLs stay in
`.local/p40b-idl/`. Clean native/layout/IDL checkpoint: **`6dad247e2daa87a36220c81fd3f195dba285f385`**,
with all 17 scoped cases and source/ABI guards rerun in
`.local/p40b-checkpoint-6dad247.log`.
No qualified SBF/deployment, active journal change, RPC/WS/PostgreSQL, throughput
or CU pass is claimed. A compile-time guard explicitly
blocks the unfinished financial artifact. Broad financial/browser/endurance suites
are not run for this disabled native/ABI checkpoint. No external blocker remains.

Both parent PRs remain open. P39's five hosted jobs pass on `96790ef` in run
41035788407; P40A's applicable scope/client/shell jobs pass on `f8984e0` in run
41036264509, with financial/report jobs explicitly skipped by scope.

The additional schema-5 transport parser authenticates compiled-message privileges,
loaded keys and CPI ancestry for direct/external-wrapper financial invocations.
It rejects missing/duplicate/trailing/foreign footers, unknown critical payloads,
revision/slot/domain/instruction mismatches and reverted effects. The transport-only checkpoint is `5ffa09d`; its six scoped fixtures and typecheck
passed before SDK regeneration. These fixtures are not signed financial executions.

The schema-5 IDLs and generated SDK are now in the working successor. Explicit
predecessor-delta verification and `pnpm generate:check` pass; seven transport
cases include literal-envelope/generated-codec parity. Ten account-client tests
pass, including explicit schema selection and coherent selected-root reads. SDK
account checks and public config producers now select the incompatible schema.
SDK/consumer checkpoint: **`3b7d8eb`**. This is not a runnable replacement
deployment: the whole-project typecheck currently reports 27 diagnostics from
remaining old sequence/revision uses
in projection, reconciliation, risk-worker keys and their fixtures/RPC harnesses.
`.local/p40b-schema-types.log` records the actual failures; no suppression or legacy
sequence substitution is used. The active journal still needs complete migration.

The subsequent journal candidate now connects authenticated envelopes to causal
whole-transaction projection, complete finalized blocks, SQL format 2, per-entity
revision reconciliation and explicit local outbox cursors. Fresh databases are
mandatory. Remaining service/schema consumers and current RPC journal fixtures
are migrated; whole-project typecheck and 93 targeted transport/projection,
worker, authority, adapter and conformance tests pass in
`.local/p40b-journal-types.log` and `.local/p40b-journal-unit.log`. This is local
candidate verification, not a signed integration result. Broad unrelated suites
and endurance are not run. The temporary build prohibition is removed solely to
build and qualify fresh local artifacts; default/devnet activation gates remain.
P40B remains In progress, with P41–P44 dependent on its actual acceptance.

Clean SBF source **`ba2f15fe545380edc4211abe8b7912278970f046`** builds all three
programs in default and explicit local profiles with no oversized-frame diagnostic.
The previous `828fe543` binaries are preserved at their local artifact revision
path. New measured SDK artifact hashes select only this candidate; RPC acceptance
is still pending. Build log: `.local/p40b-build.log`.

Next exact action: qualify the
complete-block journal against real signed Surfpool RPC/WS/PostgreSQL history,
including reverted effects, SQL rollback, restart, duplicate delivery and replay.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
