# Current status

Updated 30 October 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P34 and M1–M5b/M7–M10 are integrated within their recorded
engineering scopes. The canonical maker stack merged at `b80bb38b6583e41413cecd0a372548422b45554a`,
with documentation closeout `1f1a5aa`. [Validation](operations/validation.md)
distinguishes historical evidence from the newly rebuilt consolidation candidate.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| M11 consolidation | In progress | P35–P37 in Review; final README acceptance/publication and stack integration remain |
| P35 component docs/handoff | Review | [PR #50](https://github.com/arnabnandikgp/rivalt/pull/50); component contracts, maintenance AGENTS and historical provenance |
| P36 canonical names/ABI | Review | [PR #51](https://github.com/arnabnandikgp/rivalt/pull/51); current API names with preserved wire contract; hosted CI green |
| P37 legacy retirement/runtime | Review | [PR #53](https://github.com/arnabnandikgp/rivalt/pull/53); current runtime and fresh integrated acceptance complete |
| P38 professional root README | In progress | Concise product/design, verified local demo quick start, repository map and current documentation links |
| P15B independent maker validation | Open — external | Actual independent operator/economics; internal bots and assumed hedges cannot substitute |
| P16B independent review/funded readiness | Open — external | Independent review, risk/reserve calibration and separate funded authorization |
| Continuous 24-hour endurance | Deferred | No run scheduled or completion claimed |

Review means accepted work awaiting integration; Closed requires acceptance plus
integration. Keep this ready PR stack open until separately instructed to merge.

## Consolidation checkpoint

P35 maintains 20 component documents and a 93-line agent handoff. All 111 original
documents have a current-owner or immutable-history disposition; raw evidence stays
local and ignored. Validated content `d64cb93`, ready head `72187bc`.

P36 canonical Rust/IDL/SDK names retain original discriminators, layouts, metas,
seeds, errors, numeric schemas and signed domains. Renamed SBF source `cff1cf9`;
final scoped RPC/Anchor verifier `53beba5`. The stale-name CI fixture repair is
`b94381a`; all five hosted jobs pass on final head `3511e44` in
[run 41003463384](https://github.com/arnabnandikgp/rivalt/actions/runs/41003463384).
P37 is stacked on that exact head. No independent review approval is inferred.

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
Broad client/native regression is delegated to P37 CI; its result is pending.

P37's accepted content is `1494881`; PR #53 is ready above #51. Initial GitHub push
timed out; the retry succeeded without changing the content or stack relationships.

P38 rewrites the root README around the current implementation and qualified local
demo, with the component map and exact limits linked instead of duplicated phase
history. The 85-line README and handoff pass 265 relative links/anchors, 112 immutable
historical targets, 42 source/command paths, whitespace and evidence-policy checks.
Its scope is Markdown only; runtime/build/financial suites are not rerun.

Next exact action: publish P38's separate ready PR above #53. Keep all PRs in the
stack open.

## Deployment and operational limits

Current trading is qualified only in its explicit bounded local profile; default/
devnet stay gated. Synthetic sources, internal makers and a local demo wallet do
not establish independent or production readiness. Restricted publisher trust,
finite two-market/three-maker bounds, retained unknown-fee reservations and
coordinated unpaid-profit certificates remain explicit. Historical latency results
are not new P37 measurements. See [deployment](operations/deployment.md) and
[validation](operations/validation.md). No funded pilot, paid service, outreach or
external hedge is authorized by consolidation.
