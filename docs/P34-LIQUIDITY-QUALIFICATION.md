# P34 — final bounded qualification

In progress above P33 `964ca5f` / ready #48. A39/G26/M10 exit is not yet passed.
Keep the stack open; M10 closes only after accepted phases integrate.

## Pinned workload interpretation

G22/P29B remains authoritative: seed 2902, baseline/control/treatment each with
600 offered opportunities in 300 seconds, scheduled every 500 ms. Same host,
source values, 2-second source/funding updates, source pause 30–38s, canonical
updater pause 60–68s, and first BTC maker quarantine/recovery 90–98s. Canonical
reprice attempts run every 500 ms; treatment alternates ±1 anchor atom, control
keeps the same anchor. Legacy has no live reprice and retains its 3,600-slot epoch;
expiry remains an observed limitation, not a hidden depth reset.

Use eight-opportunity cycles: isolated BTC buy/sell, isolated ETH buy/sell,
cross BTC buy/sell, cross ETH buy/sell. Each pair uses the same size, cycling
1/2/4/8/16 lots by cycle. This keeps comparable bounded inventory without pretending
that a rejected leg was filled. Six maker roots are funded equally in each profile;
legacy admits only its four supported A/B instances, so two additional isolated
roots hold capital but offer no liquidity. Control's third canonical instance has
zero inventory cap; treatment enables it. State those differences in results.

Separate signed provisioning adds the missing isolated ETH/cross identities as
needed. All offers remain in the denominator, including unavailable books, expired
legacy epochs, source restrictions and known control races. Eligibility checks every market with an open position, as well as the traded
market; the timed trader roots have no live orders. Explicit non-reduce-only
requests require Normal sources for all such markets. Exact independent
per-lot prices/allocation and per-market accounting are required. More than 5pp
eligible-success regression or 25% matched p95 landing regression fails; fewer
than 100 matched attempts is insufficient. No threshold is selected after results.

## Actual concurrency and retained evidence

The timed harness publishes signed maker updates as a controlled strategy fixture
so the 500 ms G22 definition stays identical to P32. It is not described as the
operator kit's one-second reference strategy. Production durable funding and order
workers run with a separate executor, finalized indexer and actual PostgreSQL.
Restart one actual worker and the indexer during the pricing window. Exercise
source-independent funded exits during the same activity. Capture every original,
receipt, network fee, report input/digest, CPU/packet/key budget and lock set.

Measure build/sign/landing p50/p95/p99, price drift and 2s/10s index markouts.
Constant synthetic indexes make those markouts a controlled spread/adverse-selection
measurement, not real market prediction. Inventory, funding, funded versus unpaid
P&L, provider fees, insurance contributions and hedge assumptions remain explicit.

Use one owned PostgreSQL cluster with separate fresh databases per profile and
replay; do not reuse prior acceptance state or delete retained evidence. Runtime
artifacts are the explicitly pinned qualified V3/V4 binaries. No unrelated rebuild
or inherited full suite is required.

## Separate acceptance supplements

Outside timed pricing: maximum order/protection-book resource cases, deterministic
whole-account liquidation/default/recovery, complete flat exits, retained publisher
input replay and identical fresh PostgreSQL reconstruction. P33's actual browser,
original-signature crash recovery and publisher rotation remain separately pinned
interface evidence; they do not substitute for the final workload or default checks.

All financial paths remain bounded local test profiles. Default/devnet remain gated;
internal makers and assumed hedges remain labelled. P15B/P16B Open, continuous
24-hour endurance Deferred. No external review or profitability claim follows.
