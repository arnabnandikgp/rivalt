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
| P35 component docs/handoff | In progress | Current guides and 93-line agent handoff; documentation checks pass, ready publication pending |
| P36 canonical names/ABI | Open | Extract live records, rename current definitions and coupled IDL/SDK/consumers; preserve wire contract, rebuild/verify affected paths |
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

Documentation checks pass on the P35 working tree: all 111 original documents have
an immutable historical disposition, current relative links/anchors and code paths
resolve, historical Git targets exist, whitespace/evidence policy passes, and the
change contains Markdown only. Detailed final counts and the tested revision will
be recorded with publication. No application, financial, SBF, RPC/WS/PostgreSQL,
browser, load or endurance rerun is needed for this documentation-only change.

About 500 MiB disk space remains. The subsequent SBF build requires at least 1 GiB
before starting and more headroom for compilation/runtime. Permission to remove
five obsolete shared Solana compiler caches (preserving pinned v1.52) is pending;
project evidence/keys/databases and all Rust installations remain untouched.

Next exact action: commit and validate the P35 content revision, publish its ready
PR, then capture the current wire contract for P36 on that exact parent.

## Deployment and operational limits

Current canonical trading is qualified only in its explicit local profile. Default/
devnet remain gated. Earlier devnet and interactive-demo profiles are not current
canonical parity. See [deployment](operations/deployment.md) and
[measured limits](operations/validation.md): finite maker/market bounds, narrow
latency margin, publisher trust, retained unknown-fee reservations and coordinated
unpaid-profit certificates remain explicit. No funded pilot, paid service, outreach
or external hedge is authorized by consolidation.
