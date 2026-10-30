# Current status

Updated 30 October 2026. This is the live handoff, not a cumulative run diary.

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
| P39 dependency audit/baseline | In progress | Complete IDL inventory and signed-message lock harness; focused fresh RPC measurement and contract acceptance pending |
| P40 scoped events/services | Planned | Verified P39 parent; atomic per-entity event reconstruction, PG replay and independent execution |
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
integration. The user authorized this stack's merge on 30 October 2026.

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

The user subsequently authorized P39–P44 under D82. P39 is on
`performance/p39-contract`, based on `4f84f2b`; current program binaries are unchanged.
The new audit inventories 61 deployed-program entrypoints, including 50 clearing
custody writers. Scoped harness checks pass six cases and typecheck passes after
correcting a branded blockhash fixture mismatch. The performance
workspace reuses exact existing dependency versions; offline installation failed
because tarball caches were absent, then normal pinned installation succeeded.
No program rebuild or full financial/integration suite is warranted by harness/docs
changes. Fresh scoped RPC/WS measurement and final conformance are still pending;
no throughput or phase completion is claimed. Disk has about 1 GiB free; preserve
all user research, keys, DBs and existing evidence and reuse verified artifacts.

Next exact action: pass scoped performance/type checks, commit the P39 harness and
contract, then run `bash ops/performance-baseline.sh` against the pinned SBF set.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
