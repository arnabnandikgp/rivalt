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
| P36 canonical names/ABI | In progress | Extract live records, rename current definitions and coupled IDL/SDK/consumers; preserve wire contract, rebuild/verify affected paths |
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

P36 has renamed current records, accounts, contexts, events, entrypoints and
coupled generated/handwritten consumers. Shared identity/position/order records
now live outside historical state modules. Current names pin the original
account/event/instruction discriminator bytes; numeric schemas and seeds remain.
Colliding older definitions have explicit compatibility names until P37 retirement.
Persisted journal/API event tags remain unchanged.

On the renamed working tree: all three Anchor IDLs build; the frozen 4 KiB ABI
manifest matches parent `72187bc`; 11 mutation/compatibility guard checks, 9 native
state/layout checks, 66 targeted SDK/indexer/UI tests and workspace typecheck pass.
Generated-output parity and documentation link/path checks pass. Initial name/PDA
collisions were corrected before these results. No financial arithmetic changed.
Fresh SBF builds passed on clean source `cff1cf9` with no oversized stack frame.
Clearing is 4,511,952 bytes; each maker is 382,864 bytes; the oracle hash is unchanged.
Prior binaries/manifest remain under `.local/p36-pre-rename-artifacts`. The SDK pins
the exact new candidate hashes. At `0e7851b`, independent SDK and both actual SBF
makers each matched 3,172 pricing vectors (1,547 quotes / 1,625 expected rejects).
The first publisher probe completed 84 signed RPC/WS outcomes and 8 reports, but
its old `_v4` instruction selector captured zero instructions after renaming. Account/
event parity passed; instruction parity was not accepted. The recorder now matches
stable discriminators, rejects empty instruction coverage and has two focused checks.
A corrected scoped publisher/route run remains required before Review. Broad inherited
regression is assigned to scoped CI, not claimed as run locally.

With explicit user approval, only the five older shared Solana compiler caches
v1.41/v1.43/v1.48/v1.50/v1.51 were deleted; pinned v1.52 and all Rust installations,
project data and evidence remain. Free space afterwards: 6.4 GiB.

Next exact action: commit the renamed source/clients, rebuild the explicit local
artifacts and qualify raw codecs plus actual route/publisher RPC resource bounds.

## Deployment and operational limits

Current canonical trading is qualified only in its explicit local profile. Default/
devnet remain gated. Earlier devnet and interactive-demo profiles are not current
canonical parity. See [deployment](operations/deployment.md) and
[measured limits](operations/validation.md): finite maker/market bounds, narrow
latency margin, publisher trust, retained unknown-fee reservations and coordinated
unpaid-profit certificates remain explicit. No funded pilot, paid service, outreach
or external hedge is authorized by consolidation.
