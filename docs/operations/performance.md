# Performance contract and reproducible measurements

P39–P44 are authorized engineering work following P38. This document owns the
audit, comparison methodology and delivery gates; the clearing/liquidity/application
documents continue to own financial rules. Proposed layouts below are a successor
contract, not a description of already deployed code. Anchor v2 migration is a
separate evaluation after the pre-migration baseline, not part of these phases.

## Scope and comparison points

Keep BTC/ETH, one collateral mint, three maker instances per market, at most two
selected capitals per atomic route, isolated maker capital, existing risk/source
guards, funded cash versus exact unpaid claims, complete default, 2 bps taker and
25% of collected fees to originating-market insurance. No new loss bearer, credit,
reserve borrowing, fee tier, public listing or paid/funded deployment is authorized.
Default/devnet gates and P15B/P16B remain; continuous 24-hour endurance is Deferred.

- **A: pre-redesign checkpoint.** Current `4f84f2b` source; hash-verified P37 SBF
  source `828fe543`. P39 adds focused fresh measurements and complete static access
  coverage. Historical CU captures remain historical, not a new full benchmark.
- **B: pre-Anchor-v2 baseline.** Exact accepted P44 revision, after contention and
  targeted CU work. Full supported instruction/variant/workflow coverage; no
  successful path may be silently represented by a rejection or an old binary.
- **C: future migration comparison.** Same economic inputs, fixtures, transaction
  shapes and safety requirements. Pin Anchor/runtime/compiler independently. If a
  runtime/toolchain change is required, run old code under the new environment as
  a bridge where compatible; otherwise label combined effects honestly.

No percentage gain or production TPS target is inferred from a framework's sample
programs. Establish a measured capacity envelope and explicit cost scenarios.

## Complete access audit

`node --import tsx tests/performance/inventory.ts` checks the bounded generated
[inventory](../../tests/performance/baselines/current-locks.json) against all three
current IDLs: 53 clearing entrypoints and four each for maker A/B. It includes
nested/optional/signer roles. Dynamic remaining accounts, fee payer promotion,
aliases, lookup resolution and batching must additionally be checked from the
constructed transaction; IDL-only sets are not scheduler evidence.

`lock-model.ts` unions privileges across a transaction and distinguishes W/W,
W/R and R/W conflicts. Shared read/read access is independent. Its wire decoder
reads actual v0/v1 permissions and rejects unresolved ALTs. A shared payer remains
in the compiled result even when it is absent from the declared economic writes.
No account is removed merely because it is also the payer. Future CPI privileges
cannot exceed the outer message; returned events are not separate transactions.

The current generated inventory finds 50 clearing entrypoints writing the same
venue custody PDA. The remaining three are storage precreation (two read custody,
one has no custody). This count includes setup, not 50 frequent runtime actions.

| Dependency | Evidence in current code | Classification / disposition |
|---|---|---|
| Global event sequence | `account_custody/mod.rs`, maker gateway and publisher increment custody; indexer projection requires exactly next sequence | Redesignable coordination; replace with authenticated per-entity revisions plus atomic transaction identity, not a new global counter PDA |
| Custody cash/allocated totals | `state/accounts/layouts.rs`, route `split_fee`, cash/claims handlers | Conservation required; live global recomputation on every fill is implementation coupling. Separate token custody from internal bookkeeping |
| Both market writes | `account_trading/contexts.rs`, authority and cash contexts; `materialize` loops over both | Required only for funding actually consumed by complete touched-account dependencies; derive mask from state, never from caller hints |
| Other-market ledger/vault reads | Route context plus end-of-fill `reconciled` | Reads also conflict with writers. Replace global per-fill reconciliation with local conserving transitions and complete audit checkpoints |
| Fee/insurance carry and gross exposure | `account_trading/engine.rs::split_fee`, `engine/routes.rs` | Exact shared economic state; selected-market ordering initially retained. Do not replace with an eventually consistent sum or per-lane flooring |
| Broad financial contexts | `account_cash/contexts.rs` used by claims, internal transfers, fees and liquidation | Remove unnecessary vault/ledger writes with operation-specific contexts; preserve actual token CPI authority |
| Maker registration/depth and capital | `maker_liquidity/routes/contexts.rs`, `commit.rs`, `ControlLiquidity` | Per-capital ordering required; remove structural config writes from pure depth operations where unused |
| Price versus structural configuration | `maker-canonical.rs::RepriceCurve/ControlCurve/ReadCurve` | Per-instance read/write races are real; independent repricers stay separate. No every-maker atomic batch requirement |
| Account nonce/book/risk | `account_trading/authority.rs`, engine reservations | Same-account financial ordering retained. Splitting order storage alone cannot remove whole-account reservation dependency |
| Registry/membership | Registration handlers, backing and retirement proofs | Stable complete membership required; avoid making lifecycle discovery a dependency of ordinary unrelated fills |
| Payment certificate cursor/stamps | `account_cash/certificate.rs` selected liabilities, relevant observations and funding bounds | Correctness plus liveness issue. A cheaper scan is insufficient if every relevant observation restarts it; qualify progress under ongoing activity |
| Default header/work/page cursor | `account_safety/resolution` | Deterministic continuation and complete cohort retained. Optimize stages separately; page accounts alone do not imply parallel resolution |
| Shared worker payer and budget | `canonical-transport.ts`, worker pending-budget checks | Operational conflict, separately report payer and financial locks; never drop unknown-fee reserves to gain throughput |
| Sequential service execution | `account-execution.ts::execute`, queue advisory locks and immutable originals | Allow bounded independent job progress; serialize conflicting originals and retain same-signature recovery |
| Global projection/checkpoint | indexer `store.ts`, `account-projection.ts`, `account-reconcile.ts` | Application redesign required with event ordering; no silent loss/gap acceptance or incoherent RPC snapshots |

This inventory includes rare administration and safety paths. Effort prioritizes
frequency multiplied by CU/conflict duration, not the longest list of low-impact
initialization optimizations. Program code hashing, deserialization, CPI/event
encoding and financial arithmetic are CU suspects to measure, not unexplained
lock accounts to remove.

## Successor account and transition contract

Use a fresh explicit local deployment domain for account/ABI changes. No in-place
reinterpretation of current accounts, retained databases or unresolved originals.
Keep canonical source names; explicit schema/profile/domain checks identify changed
wire contracts. Before the first runtime layout PR, freeze field order, size,
discriminators, seeds, account metas and migration disposition in the component
spec and wire fixture. P39 does not regenerate the current wire contract.

The selected architecture removes **unrelated venue-wide coordination**, retaining
selected-market exact accounting as a measured residual. More aggressive same-market
lanes remain an evaluated alternative, not permission to weaken global limits.

| State responsibility | Intended placement | Authoritative transitions |
|---|---|---|
| Immutable venue identities/roles/mint | Venue configuration, read by ordinary operations | Initialization/explicit authorized configuration only |
| Freeze/terms gates | VenueSafety, normally read-only | Authorized pause/recovery or exact permissionless default trigger |
| Cash, claims, orders, revisions | MarginAccount | All touched accounts update atomically after complete health/reservation checks |
| Source observations, funding hold and consumed prefix | Per-market state with derived relevant dependency mask | Publisher/control and every action consuming that market's prefix; no irrelevant-market materialization |
| Exposure, settlement, insurance, fees/carry | Per-market authoritative accounting | Selected-market writes retained until a separately proven exact alternative exists |
| Actual token custody and allocated tokens | Custody/vault gateway | Actual deposits/withdrawals/seed/fee exits; pure internal fills/transfers need no token account write |
| Aggregate sum of account cash | Derived complete reconciliation / frozen resolution snapshot | Not an independently stale spendable or withdrawal-authorizing balance |
| Event progress | Scoped account/market/lifecycle revisions plus transaction identity | Every changed entity represented in one authenticated atomic transition envelope |
| Membership and default preparation | Stable registry plus lifecycle revision | Creation/freeze complete enumeration; unrelated fills do not mutate membership |

### Event and application invariants (P40)

An event envelope identifies deployment/genesis/schema, action kind and all touched
entities with predecessor/successor revisions. Where existing economic versions
are reused, prove they cover every mutation; otherwise add a scoped revision, not
another globally writable event counter. Transaction signature and outer/inner
instruction/event ordinal supply immutable transport identity. A multi-entity
transition applies once and atomically; no duplicated fee/cash effect on redelivery.

The indexer must discover finalized clearing history without a writable discovery
account, obtain transaction order from canonical block/instruction position, and
verify entity revisions. Slot alone is not a total order. Authenticate program/CPI
origin and exclude failed effects. A missing predecessor blocks only safe dependent
application, never silently skips it. Checkpoint and projection commit together;
fresh PostgreSQL replay must match incremental state after disconnect/crash.

RPC reconciliation reads authenticated revisions before/after chunks or a proven
consistent dependency snapshot. An unrelated change must not force venue-wide
backfill; a relevant change must still retry. Canonical event bytes/hashes and a
complete discovery fence, not a UI sequence, prove history completeness. Restart,
same-slot multiple transactions, cross-market account actions and late discovery
are acceptance cases. Do not migrate existing journal rows in place.

### Funding, cash and accounting invariants (P41/P42)

The dependency set is the union of nonzero positions/claims, live orders/protections
and requested effects for **all** trader/maker/receiver roots. A caller cannot omit
a losing market. Isolated BTC-only roots must not write ETH merely because a shared
struct contains it. Cross roots with actual BTC/ETH obligations can still couple
both markets. Oracle reads remain independent of maker quotes.

Persist every consumed relevant funding prefix under the existing causal rules.
Time/slot expiry, publisher outage, negative premium, revocation or default cannot
reverse accrued debits or duplicate credits. Changing to publisher-only discrete
funding or accruing previously skipped intervals is not an optimization authorized
here. Read-only projection is permissible only with a proof of irreversible history.

Prove conservation inductively for every ordinary mutation: fill cash decrement
equals exact I/T fee credit; collection/payment moves equal whole atoms between
root and selected settlement pool; internal transfers preserve total cash; token
ingress/egress changes root/pool entitlements and actual allocated tokens equally.
Derive full totals for reconciliation/default. Never let an unverified aggregate,
projection lag, optimistic receipt or off-chain service authorize a withdrawal.

Keep originating-market `floor((carry + fee)/4)` and modulo-four carry exact after
each accepted fill, and preserve available insurance before resolution. Per-maker
fee buckets with independent flooring would change this contract. Retain exact
market exposure admission: stale asynchronous aggregates cannot admit excess lots.
Independent same-market fills therefore retain some shared market writes initially.
Do not claim extra makers yield same-market execution parallelism from this plan.

Certificate progress must bind all economic dependencies. P42 must demonstrate
whether scoped invalidation and atomic final-check/payment suffice for the bounded
population under continuous activity, with explicit rejection/restart denominators.
If the exact complete-debtor rule still needs coordinated windows, document and
measure that residual; no stale-certificate payment or oracle relaxation is allowed.
An economic rule change would require escalation, not silent phase acceptance.

Freeze is a barrier read by all ordinary mutators; after it commits no in-flight
ordinary action may alter frozen inputs. Complete membership, exact fractions,
greatest rates, insurance clipping, deterministic rounding and post-fee liquidation
progress remain independently tested. Retired/resolved cash and reserve exits
must reconcile against the actual vault, including unclassified donations.

## Concurrency targets and workloads

Test both protocol-only and complete signed-message sets; explicitly use distinct
payers when proving independence. Intentional same-account/market conflicts are
not failures. Targets apply to the completed P42 stack, not intermediate commits.

| Pair/workload | Current | Target / retained reason |
|---|---|---|
| Disjoint isolated BTC/ETH trades, distinct makers/owners | Custody, both markets, cross-ledger conflicts | No shared writable protocol dependency |
| Independent maker reprices | Protocol-independent, often common test payer | Remain independent; payer cost visible |
| Maker A reprice with maker B-only fill | No protocol conflict | Remain independent |
| Maker A reprice with A fill | Price W/R | Retain current-price atomic ordering |
| Same-market fills to different makers | Custody/market/ledger | Remove venue coupling; exact market ledger/exposure ordering remains |
| Unrelated delegate change with trade | Custody | Only touched-account/lifecycle dependencies |
| BTC and ETH funding reports | Custody | Separate publisher/market writes; no global discovery write |
| Internal transfer versus actual token deposit | Shared custody/vault context | No unnecessary vault write; genuine shared root/dependency still orders |
| Complete default versus any financial mutation | Safety/accounting dependencies | Retain global freeze barrier intentionally |

Load cases: spread and concentrated maker flow; same and disjoint roots; isolated
and cross; small/max supported sizes and books; simultaneous pricing/publishing;
cash exits and settlement under trading; liquidations; default/recovery. More than
three makers/two markets is not a currently supported benchmark configuration.

Track offered, eligible, constructed, simulated, submitted, finalized-success,
economically-complete, rejected, expired and unresolved separately. Count errors by
reason and never divide successes only by already-successful samples. Record
load-generator backpressure, queue wait, signed-to-confirmed/finalized p50/p95/p99,
RPC/WS delay, replay lag and resource use. Stop ramps when success/latency degrades;
report the curve, not an invented universal TPS. No 24-hour test is required.

Surfpool proves signed RPC/WS effects and resource measurements. A claim about
validator scheduler parallel throughput requires a documented scheduler-capable
runtime with pinned features/hardware and an independent submission generator.
Zero AccountInUse errors and serialized simulation are not throughput evidence.

## CU and economic baseline (P43/P44)

Cover every supported public instruction and meaningful variant: one/two makers,
same/distinct executables, curve regions/quantity, both account modes and relevant
markets, empty/full orders/protection, actual SPL cash flows, claim certificates,
normal/expired source states, default stages and bounded wide arithmetic. Internal
CPIs are attributed without adding them again to transaction totals. Include early
and late rejection/rollback costs separately. Frozen-state fixtures must be marked;
they cannot establish a funded end-to-end history.

Record source/harness commits, binary and IDL hashes, flags/toolchain/runtime feature
set, schema/profile, deterministic seeds/state, slot/time, transaction format,
wire/signature/key counts, read/write sets, loaded data, consumed/requested CU,
base/priority/actual fees and sample count. Instrumented profiling can attribute
costs, but report headline CU from uninstrumented artifacts. Observed maxima are
not mathematical worst-case bounds. Only qualify a supported case on fresh code.

Optimize measured code hashing/decoding, allocations/copies, repeated validation,
math and CPI/event costs without dropping maker upgrade checks, authority, source
admission or arithmetic safeguards. A different maker-code trust model is a
separate authority decision. Smaller binaries may help, but no Anchor v2 factor
is assumed. Compare equal workloads; keep prior baseline records immutable.

Current transport sets zero priority bids in both formats. A v0 bid is based on
requested CU limit; v1 has an explicit lamport priority fee. Never multiply consumed
CU by a rate and call that the observed fee. Use actual receipts and separately
label simulated fee-market scenarios, dynamic limits/headroom and landing policy.
Account for failed landed transactions, unresolved fee reserves, signer base fees,
rent/capital tied up and infrastructure. No live paid service or paid load test.

Report trader cost per successful trade/round trip, maker cost per update and day
at stated cadence, and venue publisher/keeper/settlement/risk cost per day/volume.
Nominal retained protocol revenue is 1.5 bps of collected volume; the other 0.5 bps
is insurance, not freely spendable operating revenue. SOL/collateral conversion,
market fee percentiles and hedge/adverse-selection assumptions must be explicit.
Technical feasibility does not prove maker profitability or future paid throughput.

## Delivery and evidence

| Phase | Cohesive deliverable | Acceptance |
|---|---|---|
| P39 | Complete access audit, executable focused baseline, financial/dependency contract and workload definitions | All current entrypoints inventoried; actual message locks verified; scoped fresh signed outcomes reconciled; limitations recorded |
| P40A | Bounded independent service execution and durable conflict admission | Actual concurrent RPC/PG dispatch, duplicate executors, unknown outcomes, expiry and crash recovery; no journal/ABI change |
| P40B | Scoped event history and indexer/reconciliation | Missing/reordered/duplicate/failed events, recovery and fresh PG replay; new layouts/metas frozen before activation |
| P41 | Relevant-market funding/risk dependencies | No omitted losing market; no lost/doubled consumed funding; expected isolated dependency sets and cross coupling |
| P42 | Token custody/internal accounting and operation-specific contexts | Exact cash/fee/insurance/default conservation; concurrency targets; certificate liveness result and any residual windows |
| P43 | Profile-driven CU optimizations | Affected cases improve or have explained tradeoffs; full financial admission and rollback remain |
| P44 | Full integrated qualification, economic model and frozen B baseline | All supported cases measured on pinned code; actual RPC/WS/PG reconciliation and restart; reproducible resource/latency envelope and residual constraints |

P40 is split into two cohesive PRs: service transport can be verified without a
program rebuild, while scoped history changes 27 event decoders, 53 instruction
contracts and the projection/reconciliation boundary. P40A does not satisfy P40B
or remove global custody writes. This avoids coupling a transport failure to a
financial ABI migration; P41 requires the completed P40B parent.

Dependent phases use verified exact parents in ready stacked PRs; keep open until
merge authorization. Split only a genuinely unreviewable phase using its suffix,
with acceptance boundaries recorded in STATUS. Do not migrate Anchor during this
stack. No new source suffix hierarchy or permanent duplicate implementation is
required for an isolated fresh local deployment; preserve old reproduction in Git.

Keep this human reference and bounded JSON metric/manifest fixtures in source.
Raw signatures/transactions/traces remain at their existing ignored local paths;
no archive or upload. Per-PR tests follow changes. CI owns broad hosted regression;
full integrated performance runs occur at meaningful checkpoints, not every commit.

Commands from the repository root after `source ops/env.sh`:

```sh
node --import tsx tests/performance/inventory.ts
pnpm exec vitest run tests/performance/lock-model.test.ts
bash ops/performance-baseline.sh
node --import tsx tests/performance/summarize.ts <local-run-directory> --write
```

The focused RPC probe uses existing verified SBF, fresh signed provisioning and
standard RPC/WS plus isolated Anchor conformance. It has independent literal
fee/cash/claim checks. It does not launch PostgreSQL because it does not test
services/indexing; P40/P44 must run their actual database acceptance separately.

## Current results

P39's fresh probe passed on clean harness **`0ac6511f912b7675ee5c61c9bc88a112eca0bd4c`**
and hash-verified SBF source **`828fe5431433f19cd562a23f44c45258ddbd61aa`**.
Surfpool 1.6.1 reports Solana core 4.2.1, feature set 565236538. All 129 signed
outcomes were independently fetched: 117 setup and 12 measured scenarios (11
successes and one expected stale-account rejection). RPC wire equality, WS outcome
checks and isolated legacy Anchor parity passed: 207 instruction encodings and
185 event decodes; no new raw account-codec parity claim.

| Focused scenario | Consumed CU | Signed bytes / format |
|---|---:|---|
| BTC single maker | 262,729 | 1,072 / v0 |
| ETH single maker | 264,274 | 1,072 / v0 |
| Isolated BTC single maker | 272,416 | 1,072 / v0 |
| Two makers, shared executable | 339,602 | 1,198 / v1 |
| Two makers, distinct executables | 464,052 | 1,262 / v1 |
| Stale-account rejection | 44,851 | 1,072 / v0 |
| Place / cancel order | 52,948 / 46,594 | 669 / 619, v0 |
| Reprice either independent maker | 18,250 | 460 / v0 |
| BTC / ETH funding report | 31,535 / 31,536 | 871 / v0 |

Each scenario has one observation, two signatures, zero priority bid and an actual
10,000-lamport fee. These are measured inputs, not worst-case bounds. Independent
literal checks reconcile eight roots to 7,999,917 cash atoms plus 83 fee atoms;
BTC insurance/protocol fees are 19/57, ETH 1/6, with exact carries 0/3. Quantities
and claims sum to zero at common funding checkpoints.

Seven access comparisons distinguish protocol state from the common payer:
independent reprices share zero protocol conflicts but one compiled payer conflict;
BTC/ETH reports share custody plus that payer. The BTC/ETH single trades here use
the **same cross root**, so their six declared conflicts do not establish the
separate-owner concurrency case. The BTC-versus-isolated case uses distinct roots
and still has four declared conflicts. P42/P44 must exercise distinct owners and
payers for their stronger independence claims.

The bounded [baseline](../../tests/performance/baselines/p39-before-redesign.json)
records artifact hashes, metrics, reconciliation and limitations. Its generator
checks the retained RPC receipts and signed wires before publishing a summary.
Raw evidence stays in `.local/liquidity-execution/runs/p39-baseline-0ac6511/`;
the launcher log is `.local/p39-baseline-0ac6511.log`. Owned RPC/WS ports are released.

Six scoped access-model tests, typecheck, complete IDL inventory and bounded
evidence-policy checks pass. No program rebuild was needed. PostgreSQL, broad
financial suites, scheduler throughput, full 61-entrypoint CU coverage, endurance,
Anchor v2 comparison and profitability are outside this focused P39 acceptance;
P40/P44 own their fresh integrated and complete profiling gates.
