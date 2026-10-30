# Current status

Updated 30 October 2026. This is the live handoff, not a cumulative run diary.

## Baseline and active work

P01–P14, P15A/P16A, P17–P34 and M1–M5b/M7–M10 are integrated within their recorded
engineering scopes. Canonical maker stack merge is `b80bb38b6583e41413cecd0a372548422b45554a`,
tree identical to reviewed `9e6dd07`; documentation closeout `1f1a5aa`.
[Validation](operations/validation.md) retains the distinct actual runtime pins.

The user approved [repository consolidation](REPOSITORY-CONSOLIDATION.md) after
planning checkpoint `84c46d4`, and separately requested a final README PR after it.

| Work | Status | Deliverable / next acceptance |
|---|---|---|
| M11 consolidation | In progress | Component docs, canonical names, justified retirement and final README |
| P35 component docs/handoff | Review | [PR #50](https://github.com/arnabnandikgp/rivalt/pull/50); 20 maintained docs, 93-line handoff, scoped checks pass |
| P36 canonical names/ABI | Review | [PR #51](https://github.com/arnabnandikgp/rivalt/pull/51); renamed current API, preserved ABI and scoped compiled/RPC acceptance |
| P37 legacy retirement/runtime | Open | Consumer audit, current launcher/API consolidation, retained independent cases and fresh financial/RPC/WS/PG/browser/resources |
| P38 professional root README | Open | Separate final PR after P35–P37; concise product/architecture/quick-start/status entrypoint |
| P15B independent maker validation | Open — external | Actual independent operator and economics; internal bots/assumed hedges cannot substitute |
| P16B independent review/funded readiness | Open — external | Actual independent review, risk/reserve calibration and separate funded authorization |
| Continuous 24-hour endurance | Deferred | No run scheduled or completion claimed |

Open means not started/prerequisite pending; In progress means incomplete; Review
means acceptance recorded and ready PR awaiting integration; Closed means accepted
and integrated. Do not relabel external gates or inherited checks as complete.

## Current checkpoint

P35 replaces the phase-document reading campaign with clearing/liquidity/application/
operations contracts and compact decisions/history/status. Historical text remains
recoverable at the exact pre-consolidation revision. Raw local evidence, keys,
databases and unrelated research stay untouched. Source names and runtime behavior
are unchanged; P36/P37 are not implemented by this documentation change.

Validated content commit `d64cb93435e10db4b2f858c06bc5e0e79502e297`: all 111
original documents have dispositions; 251 relative links/anchors, 170 historical
Git targets and 37 source/command paths resolve across 25 Markdown files.
`git diff main --check` and `python3 ops/check-evidence-policy.py` pass. PR #50 is
ready and remains open. This following status update does not alter those contracts.
No application, financial, SBF, RPC/WS/PostgreSQL, browser, load or endurance suite
was rerun because this phase changes Markdown only.

P36 current records/accounts/contexts/events/entrypoints and generated/handwritten
consumers use canonical names, with shared identity/order/position records outside
historical state modules. Explicit discriminator overrides preserve old wire bytes;
numeric schemas, seeds, fees and authority remain. Persisted journal/API event tags
retain their schema identities. P37 still owns live group-engine extraction and
justified retirement; a suffix alone never established dead code.

Renamed content/SBF source: `cff1cf946f4507c7df61797fbe016bef0a51453b`.
Final scoped RPC/Anchor verifier: `53beba54dedbc588546b1373775620d3c2250be2`, clean.
All three IDLs match the original wire manifest at `72187bc`; generator parity,
typecheck, 11 ABI-guard checks, 9 native layout checks, 66 affected consumer tests
and 2 recorder regressions pass. Independent pricing matches 3,172 vectors for
each of SDK/SBF A/SBF B (1,547 quotes / 1,625 expected rejections). Source review
found only identifier/module/discriminator changes, with no financial arithmetic edit.

Actual corrected Surfpool probes: 84 publisher outcomes / 8 reports, then 125
execution outcomes; 283 isolated Anchor instruction comparisons, 4 account and
258 event comparisons in total. Publisher cases max 30,585 CU / 871 bytes / 14
keys; route cases max 589,748 CU / 1,262 bytes v1 / 26 keys. Fee/cash/claim and
consumption assertions pass. Raw evidence is at
`.local/liquidity-execution/runs/p36-{publisher,execution}-53beba5/`.

The first publisher run at `0e7851b` retained 84 actual outcomes but selected zero
instructions for parity because of a stale name-suffix filter. It was not accepted
as instruction evidence. The fixed recorder selects by discriminator, rejects empty
coverage and passed a fresh run. Prior binaries/manifest remain at
`.local/p36-pre-rename-artifacts`; the oracle binary is unchanged.

No new full safety/default/PG/browser/full-book/endurance qualification is claimed.
P37 owns the fresh integrated matrix after retirement. Broad inherited regression
is delegated to scoped CI. PR #50's observed CI passed scope/financial; other jobs
were skipped. Its automated review was skipped for the file-count limit; no external
review approval is claimed for the consolidation stack.

P36 CI at `a189b9b` passed financial/report/shell jobs but failed three client
conformance fixtures still looking up old `_v3` IDL names. Their canonical labels
are corrected without changing vectors or weakening assertions. The three affected
tests pass locally, comparing 68 instruction variants against isolated Anchor.
Fix `b94381a8395d0a9b824a8c4c0aa563dc752ac311` passes hosted
[run 41002830322](https://github.com/arnabnandikgp/rivalt/actions/runs/41002830322):
scope, client, financial, report and shell jobs all succeeded. Generated parity,
typecheck, the client suite and trader build pass there. No SBF/RPC rerun is needed
for test-label changes; program source and binaries are unchanged by this repair.
PR #51 remains ready/open. The empty P37 branch is restacked on the repaired parent.

With explicit user approval, only the five older shared Solana compiler caches
v1.41/v1.43/v1.48/v1.50/v1.51 were deleted; pinned v1.52 and all Rust installations,
project data and evidence remain. Free space afterwards: 6.4 GiB.

Next exact action: resume P37's live-consumer audit and extract the shared financial
engine before retiring its historical group handlers; no P37 implementation or
qualification is claimed yet.

## Deployment and operational limits

Current canonical trading is qualified only in its explicit local profile. Default/
devnet remain gated. Earlier devnet and interactive-demo profiles are not current
canonical parity. See [deployment](operations/deployment.md) and
[measured limits](operations/validation.md): finite maker/market bounds, narrow
latency margin, publisher trust, retained unknown-fee reservations and coordinated
unpaid-profit certificates remain explicit. No funded pilot, paid service, outreach
or external hedge is authorized by consolidation.
