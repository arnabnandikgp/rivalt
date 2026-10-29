# P32 bounded continuation comparison

G22's predeclared continuation passes on fresh, separate local deployments.
This is a 120-second prototype comparison per profile, not endurance or P34's
final two-market/service qualification. All makers are internal; collateral and
sources are synthetic. No hedge execution, assumed hedge profit or commercial
profitability is claimed.

| Profile | Clean client | Clean SBF | Local run under `.local/liquidity-execution/comparison/` |
|---|---|---|---|
| Legacy A/B | `2f6281b` | `915d8e8` | `20261029T163106Z-baseline-44116` |
| Canonical control | `34b4325` | `6437f7d` | `20261029T164128Z-control-46693` |
| Three-maker treatment | `34b4325` | `6437f7d` | `20261029T164540Z-treatment-47694` |

The control/treatment client adds explicit report-race classification and a
post-timing depletion supplement. The baseline's timed quote, scheduling,
transaction and financial-audit implementation is unchanged. Artifact SHA-256
values are checked before every fresh deployment; retained runtime state is never
used for provisioning. Each summary retains exact full commits, binary hashes,
original signed transactions, simulation, independently fetched finalized bytes
and log/signature WS observations.

Host: Apple M3 / Darwin 25.5.0; Node 24.22.0; Surfpool 1.6.1, offline 50 ms slots.
The existing locked stack is unchanged. Run each profile sequentially with
`RIVALT_CONTINUATION_PROFILE=baseline|control|treatment bash ops/liquidity-continuation-smoke.sh`.
Then pass their three `summary.json` paths, in that order, to
`python3 tests/load/p32_comparison.py`. Local combined output is `g22-comparison.txt`.

## Population and comparison gates

Seed 2902 identifies the deterministic schedule: 240 offers at 500 ms intervals,
alternating side and cycling 1/2/4/8/16 lots. BTC reference remains 60,000;
sources/funding run on two-second schedules. A/B participating capitals each start
with 500,000,000 atoms, the trader with 1,000,000. The new registry adds a separately
funded third capital per market; its caps are zero in the control. It contributes
no cross-subsidized margin. Whole-vault initial totals therefore differ explicitly.

The control matches legacy A/B's curves in the measured zero-skew inventory range.
Legacy uses one 3,600-slot epoch and cannot reprice; no artificial depth resets.
Canonical control keeps its anchor unchanged. Treatment adds the third curve,
inventory potential and alternating ±1-atom anchors. Differences in configured
spread/depth or funding authority are not attributed to a better allocator.

| Population / result | Baseline | Control | Treatment |
|---|---:|---:|---:|
| Offered | 240 | 240 | 240 |
| Eligible at construction | 207 | 186 | 181 |
| Quoted / attempted / submitted | 207 / 207 / 207 | 186 / 186 / 186 | 181 / 181 / 181 |
| Finalized successful routes | 207 | 186 | 181 |
| Eligible success | 100% | 100% | 100% |
| Offered availability | 86.25% | 77.50% | 75.42% |
| All finalized harness outcomes | 474 | 667 | 729 |
| Expected setup/supplement/report rejections | 0 | 24 | 28 |
| Collected taker fee atoms, timed offers | 15,643 | 14,096 | 13,746 |
| Route network fee lamports | 2,070,000 | 1,860,000 | 1,810,000 |

All 158 matched ordinary successful attempts are used for latency, exceeding the
100-case minimum. Signed-to-confirmed RPC observation includes simulation and WS
subscription; finalization and original-wire equality are verified separately.
It is a landing-latency proxy with polling granularity, not a precise execution
timestamp.

| Latency, milliseconds | Baseline | Control |
|---|---:|---:|
| p50 | 142.25 | 146.98 |
| p95 | 179.14 | 203.92 |
| p99 | 196.63 | 247.17 |

Control p95 is 1.1384× baseline: +13.84%, within the unchanged +25% gate.
Eligible success has zero percentage-point regression, within the 5pp gate.
Independent per-lot prices and exhaustive one/two-maker enumeration agree on
every eligible quote and deterministic tie. Actual landing price sequences are
matched to fetched maker publication events before independently auditing each
fill, fee/carry, full-root funding and funded-versus-unpaid claim delta. All timed
populations reconcile cash plus fees and zero aggregate lots/scaled claims.

## Every omitted offer remains visible

The 30–38-second source pause produces no omissions: the eight-second pause stays
within the unchanged source-age allowance. No shorter safeguard is invented to
manufacture a failure. All 16 offers in that window fill in every profile.

The 60–68-second updater pause does not affect legacy fixed epochs. Control first
loses a publication at offer 132 (66 seconds), then records degraded qualification
for offers 133–152. Treatment loses publications at 131–132, then has the same
degraded interval. Repricing resumes at 68 seconds, but qualified funding must
recover before new opening trades become eligible. These 21/22 lost opportunities
remain in the denominator, including recovery outside the injected window.

Quarantine at 90 seconds and joint recovery at 98 seconds block offers 180–212 in
baseline/control and 180–216 in treatment. All 16 quarantine-window offers are
ineligible; subsequent sustained qualification also takes time. Complete-coverage
requirements are preserved. Treatment has one additional timing race and later
qualification; this is an observed availability cost, not a router improvement.

The first control attempt stopped at the quarantine because its harness treated
a correctly rejected overlapping report as unexpected. That raw failed run is
retained at `20261029T163511Z-control-45132`. Quarantine materializes funding and
advances `sampled_at`; the already prepared report then violates the two-second
sample fence. The revised prototype records the actual rejection and reads fresh
state at its next scheduled tick. Control/treatment retain one/two OraclePolicy
report rejections respectively. No oracle, recovery, coverage or timing rule changes.

## Resources, contention and supplements

Timed route maxima are 451,107 / 589,248 / 599,654 CU for baseline/control/treatment.
The legacy route budget remains 600k; canonical remains 800k. All satisfy 20%
headroom. Largest timed packets are 1,197 bytes v0 / 1,270 bytes v1 / 1,270 bytes v1.
Separate [maximum-book qualification](P32-RESOURCES.md) reaches 615,433 CU.
No ALT or extra heap is used.

Six-reprice batches peak at 110,020 CU / 1,044 bytes v0. Two-market reports peak
at 63,179 CU / 1,226 bytes v0, within the 200k submitted / 160k measured ceiling.
Control/treatment reprice p50/p95/p99 are 108.87/145.36/165.81 and
107.12/154.85/171.63 ms. Report values are 108.94/163.82/194.36 and
110.76/174.33/224.02 ms. Maximum offer schedule lag is 25.47/14.89/36.66 ms.

Fetched lock sets show at most ten route writables, seven for a six-price update
(six price accounts plus the shared test payer), and six for two-market reports.
Price updates do not write custody, markets or capital. They still conflict with
routes reading selected price accounts. Across the population, route/reprice
read/write intersections contain three control keys or four treatment keys,
including the shared payer. Routes and reports overlap on payer, custody and both
markets; legacy sampling additionally reads the route's writable maker capitals
and registrations (eight intersecting keys). No `AccountInUse` or transport retry
was observed; the report/control timing races above are real logical contention.
This bounded single-host result is not a throughput or contention-free claim.

Each canonical run proves 223 price updates after consumption without a reset and
20 actual strict-epoch stale-route rejections. Supplements are outside timed offers.
Treatment additionally gives each maker a declared one-lot ask side, qualifies
sources/funding, actually consumes it, rejects another fill after a price-only
update, then explicitly replenishes and restores the original shape. All three
cases pass: gross 60,020 / fee 13 atoms each, independently reconciled. Those 39
extra fee atoms are excluded from the timed table. Original consumed depth is
never silently reset to improve timed results.

Production services/indexer/API/UI, ambiguous-outcome worker recovery and final
P34 comparative qualification remain separate. P15B/P16B remain Open; continuous
24-hour endurance remains Deferred.
