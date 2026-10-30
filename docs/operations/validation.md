# Validation and measured limits

A pass applies to its exact code, binaries, environment and population. The
consolidation baseline integrates P29–P34 at `b80bb38`, with complete tree equal to
reviewed `9e6dd07`; documentation closeout is `1f1a5aa`. P35 changes documentation,
not these program artifacts. P36/P37 must qualify rebuilt code separately.
[Original reports](../HISTORY.md) retain complete commands, failed attempts and pins.

## Checks by change

| Scope | Existing targeted entrypoints |
|---|---|
| Docs/handoff | Relative links/anchors, source/command existence, `git diff --check`, `python3 ops/check-evidence-policy.py` |
| Types/IDL/SDK | `python3 ops/wire_contract.py`, `pnpm typecheck`, `pnpm generate:check`, affected conformance tests in `tests/rpc-contract/`, isolated `tests/anchor-conformance/` |
| Canonical prices | `python3 tests/financial/test_maker_curve_contract.py`, `python3 tests/financial/check_maker_curve_parity.py --implementation sdk` (or explicitly built Rust/SBF variants), `bash ops/canonical-maker-smoke.sh` |
| Exact router | `python3 tests/financial/check_liquidity_allocation.py`, affected SDK adapter/allocation tests, `bash ops/canonical-maker-smoke.sh --adapters` |
| Publisher | `bash ops/funding-publisher-smoke.sh`, independent `tests/load/p34-publisher-reference.ts` on retained actual input rows |
| Current execution | `bash ops/liquidity-execution-smoke.sh` and affected full-book variants |
| Account/default arithmetic | Independent Fraction/bounded integer cases in `tests/financial/`, actual account safety handlers and compiled/RPC tests |
| Services/wallet/replay | `bash ops/liquidity-services-smoke.sh`, independent `tests/financial/p33_services_reference.py` |
| Default/recovery/exits | `bash ops/liquidity-operations-smoke.sh`, independent `tests/load/p34_operations_report.py` |
| Bounded comparison when changed behavior warrants it | `bash ops/liquidity-qualification-smoke.sh`, `tests/load/p34_report.py` |

Do not run the entire table for a routine PR. Financial expected values must come
from literal/independent arithmetic, not the implementation invoked twice. Host
models, compiled program tests, simulations, actually submitted/fetched transactions,
PostgreSQL reconstruction and browser signing prove different layers. Record all
failed/omitted attempts and why checks were skipped. Do not relabel simulation as
landing or a historical capture as a fresh run. Scoped hosted CI supplements these
checks; current workflow selection lives in `ops/ci-scope.py`.

## Qualified baseline and provenance

| Scope | Actual tested pin(s) | Evidence boundary |
|---|---|---|
| Account safety | `915d8e8` | Actual maximum-cohort/default/activation matrix; canonical changes separately qualified in P32 |
| Account services/UI | `13b558f`, `f595fd7`, `5491752` | Whole-account durable worker and concurrent exits/replay; earlier fixed-maker profile |
| Canonical maker/preview | `2d6fcdd`, `e9ee447`, `2fda67b`, `f9a70c3` | Compiled prices/controls, authenticated snapshot and independent exact allocation |
| Canonical execution/safety | SBF `6437f7d`; safety/PG `5d26561`; full books `df70e7c`; continuation `34b4325` | Explicit local execution with independent financial/ABI/RPC/WS/PG checks |
| Canonical services/UI | `fccf062` | Durable processes and instrumented local wallet; browser originals fit v0 |
| Comparative/operational qualification | `fb082de`, `03c4e73`, `aae8bb0`, `875b647` | Separate baseline, control/treatment, default/recovery/exits and maximum-book cases |
| Stack review remediation | `791fb8d` | Real expiry/nonapplication/retry, 370 service originals, 174-event fresh PG replay and per-trader audit |
| Self-review of skipped large PRs | `608f73c` | Unchanged final SBF artifacts; independent price vectors, compiled lifecycle and fresh publisher/execution RPC probes; not independent security approval |

The recorded canonical SBF set is built at `6437f7d`; SDK artifact definitions and
local manifests contain full hashes. P35 adds no build/deployment/soak claim.
Original P13/P14 devnet evidence is earlier behavior; neither the current profile
nor v1 external-wallet compatibility inherits it.

## Resource contracts

| Operation | Submitted CU ceiling | Required measured ceiling | Additional bound |
|---|---:|---:|---|
| Reprice | 100,000 | 80,000 | Price publication only; explicit wire/key checks |
| Control gateway | 400,000 | 320,000 | <=18 loaded keys including payer/co-signers |
| Atomic pair of controls | 800,000 | 640,000 | <=32 keys; combined transaction measured |
| Canonical route | 800,000 | 640,000 | <=32 keys; complete books |
| Publisher init/config/report | 200,000 | 160,000 | <=20 keys |
| Resolution continuation | 1,200,000 | 960,000 | One-row Verify/FlowPlan, other allowed pages 1/2 |

Default heap remains 32 KiB; every SBF stack frame <=4,096 bytes. Complete signed
wire is v0 <=1,232 or v1 <=4,096 bytes. Shared custody/market writes and price
read/write overlaps remain real contention. A context snapshot read ceiling is
not a submitted-transaction key limit. Combined operations need their own proof.

P34 actual maxima: canonical publisher 31,813 CU / 775 bytes v0 / 13 keys;
risk/default worker 419,737 CU / 1,196 bytes v0 / 22 keys; maximum protected/entry/
stored-book route 615,433 CU / 1,165 bytes v0 / 26 keys, with other two-leg cases
1,262 bytes v1. Maximum route headroom is 23.07% under its 800k budget. All sampled
priority prices are zero. These are local results, not production fee estimates.

The maximum-width safety scratch probe measured 774,364 CU Verify and 638,366
FlowPlan. It widened derived scratch, not authenticated financial history; no
Apply/token movement occurred in that fork. The parent financial cohort completed
its separately reconciled lifecycle. Never conflate arithmetic scratch cases with
actual maximum-value financial histories.

## Availability, latency and economics

P34 schedules 600 offers in 300 seconds for each of three profiles. Full denominators:

| Profile | Offered | Eligible | Quoted | Attempted | Submitted | Finalized success |
|---|---:|---:|---:|---:|---:|---:|
| Earlier fixed-maker baseline | 600 | 287 | 287 | 287 | 287 | 286 |
| Canonical control | 600 | 542 | 542 | 542 | 542 | 542 |
| Canonical treatment | 600 | 546 | 546 | 546 | 546 | 546 |

Control omissions: 38 BTC-required Degraded, 18 ETH-required Degraded, 2 stale
publications. Treatment: 35/15/4 respectively. Baseline includes 164/148 Degraded,
one epoch-expired quote and one actual MakerQuote rejection at the selected maker's
expiry slot 4,722. Retain failures/fees; do not drop them from offered availability.
A BTC exposure can require BTC sources for an ETH cross-account request.

The 209 matched ordinary successes give baseline/control p95 signed-to-confirmed
192.262334/240.320167 ms: ratio 1.249959688 against a predeclared 1.25 ceiling.
The margin is less than 0.01 ms, a narrow one-host pass. It is not a stable production
latency margin. Eligible success regression ceiling is five percentage points.
The workload is two offered opportunities/second, not a throughput ceiling.

Exact financial replay explains all cash/claim/fee/insurance changes. All six
internal makers have zero funded trading P&L in that window; positive spread/funding
remains unpaid. Indexes are constant, so 2s/10s markouts describe controlled spreads,
not predicted profitability. The illustrative 1 bps hedge cost is unexecuted.
Network costs remain lamports; quote collateral and SOL must not be silently mixed.

Independent replay reproduces all 508 actual canonical funding reports. Separate
operational qualification completes ten-root default, restart during proposal,
sustained recovery and all remaining funded exits; vault residual is exactly
452 atoms of attributed insurance/protocol fees. Fresh PostgreSQL replay agrees.
These historical results remain pinned, not repeated by document consolidation.

## Remaining limits and external gates

- Restricted publisher honesty/complete coverage is a trust assumption; risk bounds
  limit its effect but do not prove input aggregation. No hypothetical maker margin
  admission occurs in funding.
- Three makers per market, two markets, one mint and at most two route legs are
  qualification bounds. Zero Surfpool AccountInUse errors proves no validator scale.
- Missing/advanced history proofs may keep originals unresolved; unknown fees remain
  reserved and can exhaust budgets/block handover. Required payment certificates
  may need coordination with relevant concurrent mutations.
- Local fixture prices/makers and browser signers are internal. Fresh OS installation,
  external maker profitability, current devnet parity and independent security review
  are not claimed by the recorded local results.
- P15B/P16B remain Open; 24-hour endurance stays Deferred. Reserve sizing, real risk
  calibration and any funded pilot require their independent gates/authorization.
