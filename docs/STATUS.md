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
| P40 scoped events/services | Review | A and B acceptance passed; awaiting stack integration |
| P40A bounded service execution | Review | [PR #56](https://github.com/arnabnandikgp/rivalt/pull/56), stacked on #55; scoped RPC/WS/PG fault and fresh replay acceptance passed |
| P40B scoped event history | Review | [PR #58](https://github.com/arnabnandikgp/rivalt/pull/58), stacked on #56; scoped history and exact financial acceptance pass |
| P41 relevant market dependencies | In progress | D86 freezes complete on-chain dependency unions and optional market contexts; no schema-6 activation/acceptance yet |
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
D84's schema-5 account revisions, bounded authenticated envelopes and canonical
account/event discriminators now cover all 53 clearing entrypoints and 42 contexts.
Twenty sequence-only custody metas become readonly. Explicit ABI delta checks
against immutable P40A, generated SDK parity and the affected native/layout tests
pass. SDK/SQL bindings reject old state; fresh domain/genesis/database are required.

The active journal reconstructs whole transactions from scoped read/write revision
dependencies and complete finalized block manifests. SQL format 2 atomically stores
original blocks/transactions, envelopes, projection, revisions and local outbox
cursor. Two account passes fence multichunk reconciliation; only relevant advances
request bounded tail catch-up. Old global event sequence is removed from payloads.
The maker economics consumer now uses explicitly labelled local stream cursors.

Clean verifier **`02bbdec15a04b8cfea64ea63b4f8a098bfca7f56`** passes both journal
and live indexer RPC/WS/PostgreSQL probes using SBF `ba2f15f`. Each fresh run verifies
120 signed outcomes and identical 72-event replay, including four failed originals
without financial effects. SQL rollback, byte-checked duplicates and restart pass.
Live reconciliation checks 70 accounts/eight roots, 8,000,000 vault atoms and the
independently checked 26-atom fee partition. Raw records remain in
`.local/liquidity-execution/runs/p40b-journal-170/` and `p40b-indexer-02bbdec/`.

D85 pins Surfpool 1.7.0 (core 4.3.2, feature 3383571666) after an independently
reproduced 1.6.1 empty/stored-block parent-hash bug. Strict parent/hash checks remain;
full blocks must also match separately requested signature manifests. The old
runtime and P39 receipts remain intact; no same-runtime performance comparison is
claimed. The failed first probe remains in `p40b-journal-first/`.

The test-only external-CPI fixture rebuilds clearing through its oracle dependency;
current clean SBF is **`6123dc8fc590e498ae98e8371f496f67424a32ad`**, allowlisted at
`9d489ce`. All 108 affected native clearing tests pass; no oversized stack frame.
Clean verifier **`7ac00b2925dc2d1dee85b139cb855e794d49aba4`** then passes 51 actual
signed outcomes: two financial calls below one external CPI, later-call rollback,
zero-payload storage, paused complete-member retirement, unpause/repause proof
invalidation and a token-reconciled retired cash exit. PostgreSQL reconciles 32
accounts/six members to 5,999,999 atoms and fresh replay is identical. Isolated
Anchor checks 43 clearing instruction encodings, three accounts and 85 events,
plus maker encoding/event parity. Evidence: `p40b-scoped-cpi-revision/`.
The preceding attempts exposed a negative-test error-code mismatch, then a real
projection bug initializing retirement revision after zero-payload storage; both
are fixed with retained failed evidence and a targeted regression.

Clean verifier `a44b26b` passes the same-slot extension: 57 signed outcomes, two
three-transaction same-slot batches recorded at distinct canonical block positions,
51-event fresh PostgreSQL replay, and unchanged exact terminal cash. The independent
custody run also passes 57 signed outcomes and eight deliberate raw-state corruption
rejections. Seven targeted snapshot/API/economics tests, 17 affected SDK/conformance
cases, typecheck, generated parity and all three compiled default gates pass.

The first affected liquidation/default run reached Apply but exhausted the 32 KiB
heap after two row payloads and before the footer. Borrowing the resolution root
snapshot and captured footer rows removes duplicate allocations; four borrowed
payload parity tests and seven footer/header cases pass. Clean SBF **`304da5c`**
builds default/qualified clearing without oversized frames (qualified 2,452,824
bytes); it retains the default heap and unchanged CU ceilings/financial checks.
Failed evidence remains in `p40b-safety-a44b26b/`.

Clean verifier **`b495b386f069d55aac89e093f75f97bff078a370`** passes the rebuilt
safety run: 290 signed outcomes (267 successes, 23 expected rejections), live
TP/SL/reservations, strict post-fee liquidation, complete eight-root default,
resolved cash exit and sustained recovery/reactivation. Independent raw-byte
Fraction audit checks every exact payout and rejects ten corruptions. Maximum
observed CU is 477,424; two-row Apply remains within the default heap and records
at most 268,620 CU. Isolated Anchor checks 266 clearing encodings, two accounts and
487 events plus both makers. This is scoped coverage, not P44's full resource bound.

The same rebuilt artifact passes 57 actual same-slot/CPI/retirement outcomes,
51-event PostgreSQL fresh replay and exact 5,999,999-atom exit reconciliation.
All three compiled default gates still reject. Evidence stays in
`.local/liquidity-execution/runs/p40b-safety-heap/` and `p40b-scoped-heap/`.
A separate retained-receipt projection check compares the safety lifecycle at five
boundaries; it is not a new live SQL/block-fence run. The capture omits only the
trader portfolio, explicitly reported rather than fabricated. Current static
inventory covers 61 entrypoints and 30 custody writers, down from 50 declared in
P39; complete financial write contention remains for P41/P42.

Typecheck, generated/ABI/source coverage and affected consumer tests pass. Broad
unrelated/browser/endurance suites are omitted; CI owns broad regression and P44
owns full fresh integrated qualification. P40B acceptance content is `df042ce`; [PR #58](https://github.com/arnabnandikgp/rivalt/pull/58)
is ready for review above #56. The retained safety projection verifier passes at
that same clean commit. Owned RPC/WS/PG listeners and containers are confirmed
stopped. Initial hosted client/financial/scope/shell jobs passed; report failed
because its regression still compared schema-5 output directly with the immutable
pre-change fixture. The regression now verifies both the original predecessor and
the enumerated D84 delta, without refreshing the fixture; its CI checkout includes
that predecessor. All 11 ABI regression cases and the explicit wire guard pass
locally. The hosted recheck passed the ABI tests, then exposed the report fixture
still embedding its cursor inside the financial payload. Moving the fixture cursor
to its journal envelope preserves the literal cash/claim/fee expectations; all
three report/availability reader tests now pass locally, including five financial
corruption rejections. P41 rebuild preparation also found the private borrowed footer serializer derived
an unsupported lifetime for Anchor IDL generation. Explicit ordered serialization
fixes that build path: seven scoped/header/wire-parity tests pass and a fresh
Anchor-built clearing IDL equals the accepted contract. Public fields and financial
behavior do not change; this is an IDL-source repair, not a new SBF/RPC acceptance.
Hosted recheck and integration remain pending; no production/throughput claim.
P39/P40A remain open (#55/#56); their last checked applicable CI jobs passed on
`96790ef` / `f8984e0`. No external access blocker remains.

P41 is on `performance/p41-market-dependencies`, above ready P40B. D86's
required-market union, optional route/order/cash/liquidation contexts, neutral
empty-slot arithmetic and checkpoint preservation are implemented in source.
Schema-6 SDK builders derive minimum dependencies; partial event projections
preserve omitted markets. Treasury paths may also omit unused market inputs.
Default/devnet gates and complete default/retirement contexts remain unchanged.

All 112 affected native clearing cases pass on the current candidate, including
independent fractional-claim, cash-exit and receiver-dependency checks. Eight
affected SDK/service/projection files passed 49 cases; the schema literal fixture
repair passes all seven transport cases, three maker economics cases, and the new
market SDK/partial-projection checks pass 19 cases (overlapping prior coverage).
Typecheck, source coverage, generated parity, eleven ABI guard regressions and
the explicit D86 delta against immutable P40B pass. Failed first native/transport
attempts are retained in `.local/p41-*.log`; their reserve-refresh ordering and
schema literal issues are fixed. No new compiled/RPC/WS/PG result is claimed.

A dedicated signed dependency/rollback/cash reconciliation and fresh PostgreSQL
replay driver is prepared. Existing P40B artifacts remain pinned pending the clean
P41 rebuild. Broad unrelated/browser/endurance suites are omitted; P41's affected
compiled integration and P44's final qualification are still required.

Next exact action: build the committed schema-6 source, pin its measured artifacts,
then run the dedicated market-dependency RPC/WS/PostgreSQL probe and affected
liquidation/default/funding acceptance before opening P41 above #58.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
