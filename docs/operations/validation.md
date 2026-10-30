# Validation and measured limits

A pass applies to its exact code, binaries, environment and population. The
consolidation stack integrates P35–P38 at `caa47d2`, with complete tree equal to
accepted `9d3e15f`. Merge verification introduces no new runtime-test claim.
The preceding baseline integrates P29–P34 at `b80bb38`, with complete tree equal to
reviewed `9e6dd07`; documentation closeout is `1f1a5aa`. P35 changes documentation,
not these program artifacts. P36 adds the separately scoped rebuilt-code evidence
below; P37's fresh integrated qualification after retirement is recorded separately.
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
| Maker CPI isolation | `node --import tsx tests/rpc-contract/liquidity-hostile-svm.ts`; compiled fault injection, distinct from real RPC landing/upgrade evidence |
| Account/default arithmetic | Independent Fraction/bounded integer cases in `tests/financial/`, actual account safety handlers and compiled/RPC tests |
| Durable dispatch/conflict scheduling | `bash ops/dispatch-smoke.sh`, scoped `dispatch`, queue and expiry-authority tests; P40A acceptance tracked separately |
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

## Performance redesign checkpoint

P39's [focused baseline](performance.md#current-results) uses clean harness
`0ac6511` and unchanged hash-verified SBF `828fe543` on actual Surfpool RPC/WS.
Twelve measured signed outcomes include one expected stale-account rejection;
all actual receipts/wires agree. Eight-root cash/claims, 83 fee atoms and the
25% insurance carry reconcile independently. The complete static inventory covers
61 entrypoints; only the named twelve cases have new CU measurements. Separate
payer versus protocol locks are recorded. No PostgreSQL, throughput, full
instruction-profile or Anchor v2 claim follows from this focused audit.

P40A service code at **`9134fd6aceed0b910b556bfb24c52134b5b280d0`** passes actual
Surfpool RPC/WS/PostgreSQL dispatch: two independent originals progress concurrently
under duplicate executors, shared-payer conflicts defer, expired nonexecution
releases access but retains a 20,000-lamport fee reserve, and actual SIGKILL after
upstream acceptance recovers the same cash-withdrawal original. Eight queue
originals yield six successes, one charged on-chain rejection and one proven
unexecuted expiry. Cash reconciles to 7,999,993 atoms; operator fees are 60,000
lamports. Fresh 61-event PostgreSQL replay matches. The RPC harness separately
verifies 106 signed setup/price-advance outcomes on unchanged SBF `828fe543`.

The SQL follow-up at **`a2860f93af6190ba116ad752a6e26359305abce0`** checks read/read,
W/W and both W/R directions, committed reservation persistence, rejection of
ambiguous legacy queues and idempotent activation after their known receipt. Those
encoded access fixtures are not additional financial executions. Fourteen scoped
consumer tests and typecheck pass. Raw records remain under
`.local/liquidity-execution/runs/p40a-dispatch-9134fd6/` (`dispatch.json` and
`dispatch-database.json`); owned processes/ports are released. P40B event migration,
validator scheduler throughput, broad financial/build/browser checks and endurance
are outside this service-only acceptance. The current global on-chain writes remain.

### Scoped history acceptance (P40B)

Fresh schema-5 accounts and SQL journal format 2 use no global writable discovery
counter. Native layout/source coverage binds all 17 headers, 42 contexts and 53
clearing entrypoints. The independent ABI delta derives from immutable P40A
`f8984e0`; generated SDK parity and relevant legacy Anchor encodings pass. Twenty
sequence-only custody writers become readonly; 30 economic/administrative writers
remain. No old state/database is reinterpreted.

- `02bbdec` with SBF `ba2f15f`: separate actual journal and live indexer runs, each
  120 signed outcomes and 72-event fresh PostgreSQL replay. SQL rollback, duplicate
  byte checks, restart, reverted-effect exclusion and 70-account/eight-root live
  reconciliation pass. Exact initial backing is 8,000,000 atoms; fees are 26 atoms.
- `a44b26b` with SBF `6123dc8`: independent custody/insurance/token audit passes
  57 signed outcomes and eight corruptions. Multichunk tests use 109 encoded
  accounts, advancing unrelated slots and relevant revision/unversioned-byte races;
  these are transport fixtures, not additional financial executions.
- Final clean verifier `b495b38`, SBF **`304da5c`**: 57 signed same-slot/nested-CPI/
  retirement outcomes, including two batches of three originals in one slot,
  later-CPI rollback, zero-payload storage, pause-epoch proof invalidation and cash
  exit. Live PostgreSQL reconciliation covers 32 accounts/six roots, 5,999,999 atoms;
  51-event fresh replay matches. Anchor checks 49 clearing encodings, three account
  codecs and 97 events, plus makers.
- The same final pins pass 290 safety outcomes (267 successes, 23 expected rejects):
  TP/SL, reservations, whole-account liquidation, complete two-market eight-root
  default, stale-source resolved exit and recovery/reactivation. Independent Fraction
  audit checks all payouts and ten corruptions. Anchor checks 266 clearing encodings,
  two account codecs and 487 events, plus makers. Max observed 477,424 CU; two-row
  Apply max 268,620 CU. A retained-receipt projection regression separately compares
  five raw-state boundaries, excluding one uncaptured portfolio; no new live SQL or
  complete-block proof is attributed to that offline comparison.

Final clearing is 2,452,824 bytes; makers are 261,056 each. Artifact hashes are in
SDK pins and retained manifests. The first two-row Apply failed on 32 KiB heap;
borrowed row/footer serialization fixes it without changing bytes, heap or CU limits.
Four borrowed-payload parity tests and seven footer/header cases include the maximum
32-entity footer. Default SBF initialization remains rejected in all three programs.
The earlier retirement projection initialization bug after zero-payload storage is
also fixed and regression-tested. Failed attempts remain alongside successful runs.

D85 changes Surfpool to checksum-pinned 1.7.0 (core 4.3.2, feature 3383571666) because
1.6.1 inconsistently reconstructed empty-block parent hashes. Full bodies also match
separate signature manifests. P39 measurements are not a same-runtime comparison.
Raw evidence stays under `.local/liquidity-execution/runs/p40b-*`; owned RPC/WS/PG
processes are stopped. No browser, full P44 instruction/resource coverage, validator
scheduler throughput, funded deployment or endurance result is claimed. Scoped
client/typecheck/generation/source/ABI checks pass; broad regressions run in CI.

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

The historical canonical SBF set was built at `6437f7d`; P36 rebuilt at `cff1cf9`.
The current P37 candidate is built from clean `828fe543`; SDK artifact definitions
and local manifests pin actual hashes. P35 adds no build/deployment/soak claim.
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

## Canonical-name refactor qualification

P36 preserves the three-program wire manifest captured at `72187bc`, including
layouts, field/variant order, discriminator bytes, metas, seeds, errors and domains.
Current source names are different; numeric schema and journal/API tags remain.
SBF source `cff1cf9` builds without oversized stack diagnostics: clearing 4,511,952
bytes, each maker 382,864, oracle fixture unchanged. This is a scoped refactor pass,
not a rerun of the earlier full operating qualification.

At clean `53beba5`, the corrected publisher and execution probes submit/fetch/decode
84 and 125 actual RPC/WS outcomes. Isolated Anchor comparison covers 283 instruction
payload/meta pairs, 4 accounts and 258 events. Publisher control/report cases peak
at 30,585 CU, 871 bytes, 14 keys; routes at 589,748 CU, 1,262 bytes v1, 26 keys.
These are scenario maxima; full-book/default/service contention is P37's gate.
Independent Python/per-lot pricing agrees on 3,172 inputs for the current SDK and
each actual rebuilt maker SBF, including 1,625 expected rejections per implementation.

The first publisher run's zero-instruction name-filter selection was rejected as
instruction-parity evidence. The harness now uses discriminator identity and fails
empty coverage. Both runs remain local. P36 additionally checks native wire sizes,
PDA/schema negatives, generated parity, typecheck and affected consumer projections.
No PostgreSQL replay, new external wallet, endurance or external approval follows
from these scoped P36 tests. P37's changed implementation is qualified below.

## Current-runtime consolidation qualification

P37's clean SBF source is `828fe5431433f19cd562a23f44c45258ddbd61aa`; allowlist
`629d44a` records measured binaries. Later commits change consumers, launchers,
verification or documentation; no program/IDL change follows that build. Retained
wire hashes match the exact pre-retirement `b89768b` interface. Removed APIs are
listed explicitly in `tests/fixtures/wire-contract.json`; old deployments are not
upgraded or migrated. Clearing is 2,290,224 bytes, each maker 260,560; oracle fixture
unchanged. Qualified/default builds and stack diagnostics pass.

| Fresh scope | Verifier / evidence under `.local/` | Actual result |
|---|---|---|
| Custody | `629d44a`; `liquidity-execution/runs/p37-custody-629d44a/` | 57 signed outcomes, 25 events; raw token/cash audit and eight corruptions rejected |
| Publisher | `6819b1f`; `liquidity-execution/runs/p37-publisher-current/` | 84 outcomes / eight reports; 87 instruction, two account, 88 event Anchor comparisons |
| Execution | `6819b1f`; `liquidity-execution/runs/p37-execution-6819b1f/` | 130 outcomes; cash/claims/fees/depth plus foreign pause authority, active pause/unpause and epoch invalidation |
| Safety/default | `6fd5d02` transaction harness; corrected auditor `9703039`, final captured-byte conformance `a9878a0`; `liquidity-execution/runs/p37-safety-pages/` | 290 signed outcomes; liquidation, complete default, stale-source terminal exit, recovery/reactivation; eight exact Fraction payouts and ten audit corruptions rejected |
| Full books | `liquidity-execution/runs/p37-resources-{protected,entry,stored}/` | 147 / 165 / 165 outcomes; all three book variants, eight regions, maximum quantity, two-maker rollback and stale depth authority |
| Services/browser | `a9878a0`; `liquidity-execution/runs/p37-services-a9878a0/` | 343 durable originals, 84 reports, ten browser and two CLI actions, three real SIGKILL/lost-ack recoveries; identical 169-event fresh PostgreSQL replay |
| SQL journal | final recorder `f6b84a0`; `liquidity-execution/runs/p37-journal-canonical/` | 120 outcomes, 89 stored transactions / three failed, 72 events; SQL rollback, restart, immutable conflicts, reverted-event exclusion and fresh replay |
| Operational recovery/exit | runtime `d62c709`; `liquidity-execution/qualification/p37-operations-tcp/operations/` | 343 harness outcomes; 84 worker originals, restart during proposal upload, ten-root default/recovery/full funded exit, identical fresh PG replay; 452 vault atoms remain as insurance/fees only |
| Interactive demo | `a0a3651`; `demo-checks/p37-current-receipts/` and `p37-interactive-demo-current/` | 13 actual local-wallet originals; both modes, allocation, BTC/ETH, TP/SL/cancel, closes, withdrawal and reload; owned runtime stopped and ports released |
| Compiled hostile CPI | `15ee603`; `liquidity-execution/hostile-svm.json` | Five rejection/rollback cases across 114 signed VM transactions; wrong price/length, read-only write, maker error and unapproved replacement |

Full-book verifiers are respectively `7816aa4`, `9703039`, `a9878a0`. The first was
recorded before a local amend of the independent safety auditor; its current
counterpart `9703039` changes only that unrelated auditor, with identical program
and resource harness. Raw provenance is retained verbatim. Operational and journal
source stays identical during later unrelated harness/demo commits; their recorded
runtime/final-recorder pins remain distinct from the SBF pin.

Independent `p33_services_reference.py` reconciles each trader's cash, funding,
claims and fee carries, all six internal maker reports and exactly 267/61 fee atoms.
Independent `p34_operations_report.py` reproduces ten Fraction payouts, rejects five
corruptions and verifies each worker original's actual receipt/resources. All ten
roots finish flat, claim-free and with zero cash. No hedge or external maker result
is inferred. Demo signatures/bytes are independently fetched from finalized RPC.

| Fresh measured operation | Maximum CU | Complete wire / loaded keys |
|---|---:|---|
| Publisher/control scoped cases | 30,317 | 871 bytes / 14 |
| Ordinary execution probe | 463,965 | 1,262 bytes v1 / 26 |
| Full protected / entry / stored book routes | 489,571 / 488,255 / 489,401 | Maximum pair route 1,165 bytes v0; other pair cases 1,262 bytes v1 / 26 |
| Operational publisher reports | 31,535 | 775 bytes v0 / 13 |
| Operational risk/default worker | 419,054 | 1,196 bytes v0 / 22 |

The maximum route leaves 38.80% of its 800,000-CU budget. These are bounded scenario
measurements, not a new throughput, production priority-fee or latency qualification.
No lookup table is required. Published funding depth remains an attestation.

Current client suite passes 229 cases in 55 files; subsequent scoped conformance/
demo checks pass 19 cases (overlapping, not an additional aggregate count). Clearing
passes 102 native tests in each qualified/default build. Both maker crate targets
compile but contain zero native cases; actual compiled lifecycle has 123 cases /16
rejections. Independent Rust/SDK/SBF A/SBF B pricing each agrees on 3,172 vectors;
allocation has 415 independent cases. Financial reference checks include 2,060 wide
arithmetic, 337 collection/flow/rate and 549 atom/continuation comparisons. Three
compiled defaults reject valid provisioning with rollback; mixed local/devnet maker
features reject compilation. Typecheck, generated parity, wire guard, 21 tooling
checks, UI build and docs/evidence checks pass.

The hostile VM first rejects an unapproved binary replacement. It then deliberately
replaces only that registration's approval hash to reach malicious CPI behavior;
all financial state came from signed instructions. This tests isolation even from
an admitted malicious maker; it is not authorized-upgrade or RPC-landing evidence.

Failed attempts remain local: obsolete publisher launcher path; dynamic resolution
metas and variable-byte handling in isolated Anchor conformance; the safety raw
auditor's original discriminator; PostgreSQL's temporary init-server readiness;
a stale test-only journal label; and demo rejection-only provisioning/old receipt
prefix. The safety lifecycle completed before its final conformance error; corrected
post-run comparison of captured original bytes passes 560 instructions / two accounts /
543 events. Do not describe its original shell exit as successful. Every other
failed integrated attempt was followed by the scoped fresh pass recorded above.

The separate indexer smoke is not repeated: services/operations already exercise
the current projection and fresh database reconstruction, with journal-specific SQL
faults separately checked. Retired-profile suites, new comparative load, 24-hour
endurance, external wallet/devnet and independent/funded gates are not rerun or
claimed. Hosted CI supplies broad supported client/native regression after PR
publication; local acceptance does not imply an unobserved CI result.
