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

P39's original generated inventory found 50 clearing entrypoints writing custody.
P40B reduces that to 30 by removing twenty sequence-only write privileges. The
current P42 JSON inventory records 20 custody writers after operation-specific
contexts. These counts include setup/rare actions;
they are not counts of frequent runtime operations. The audit below records the
pre-redesign findings and planned dispositions; validation tracks completed work.

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

| Pair/workload | P39 dependency | P42 result / retained reason |
|---|---|---|
| Disjoint isolated BTC/ETH trades, distinct makers/owners | Custody, both markets, cross-ledger conflicts | Actual distinct-owner/payer messages have no protocol or compiled W/W or W/R overlap |
| Independent maker reprices | Protocol-independent, often common test payer | Remain independent; payer cost visible |
| Maker A reprice with maker B-only fill | No protocol conflict | Remain independent |
| Maker A reprice with A fill | Price W/R | Retain current-price atomic ordering |
| Same-market fills to different makers | Custody/market/ledger | Remove venue coupling; exact market ledger/exposure ordering remains |
| Unrelated delegate change with trade | Custody | Only touched-account/lifecycle dependencies; no custody |
| BTC and ETH funding reports | Custody | Separate publisher/market writes; no custody or global discovery write |
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
| P39 | Complete access audit, executable focused baseline, financial/dependency contract and workload definitions | All current entrypoints inventoried; actual message locks verified for the focused scenarios; scoped fresh signed outcomes reconciled; limitations recorded |
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
RIVALT_PROFILE_STAGE=p43-before bash ops/performance-baseline.sh
node --import tsx tests/performance/summarize.ts <local-run-directory> --write
```

The current focused RPC probe requires an explicit P43 before/after checkpoint;
P39 reproduction uses its original pinned source. Its immutable baseline is never
refreshed by a current run. `bash ops/build-cu-profile.sh` builds diagnostic-only
clearing with `cu-profiling` into `.local/cu-profiling/`, preserving accepted
binaries. Select that directory explicitly with `RIVALT_ARTIFACT_DIR` and
`RIVALT_PROFILE_STAGE=p43-trace` for attribution. Trace markers compile out of
normal artifacts; reported gains require uninstrumented before/after receipts.
`node --import tsx tests/performance/attribution.ts <instrumented-run-directory>`
checks actual clearing invocation markers against signed receipts. Its nested
intervals overlap and include marker overhead; never sum them as transaction CU.

The focused RPC probe uses existing verified SBF, fresh signed provisioning and
standard RPC/WS plus isolated Anchor conformance. It has independent literal
fee/cash/claim checks. It does not launch PostgreSQL because it does not test
services/indexing; P40/P44 must run their actual database acceptance separately.

## Current results

P43’s [fresh scoped comparison](validation.md#targeted-cu-acceptance-p43) records
small arithmetic savings (669–1,230 CU per tested route), unchanged observed fees
and a dominant full maker-code hashing cost. The compiler-size experiments were
rejected for oversized frames. P44 freezes full current instruction coverage and
operating-cost scenarios below; its integrated acceptance is recorded in validation. The
original P39 comparison point below stays immutable.

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

### Operator signer configuration

The live P44 shared-key probe uses six maker repricers and two publishers with one
updater/fee payer. Durable reservations retain that payer until finalized outcome,
so every original serializes even when its protocol accounts are independent.
The probe cannot sustain fresh complete publication/recovery under the 50 ms local
slot schedule. This is an operational conflict, not evidence of excessive on-chain
market locks or permission to release ambiguous originals.

The accepted service qualification configures each internal maker's existing updater
authority and each market publisher as distinct signers and fee payers, funded with
test SOL, while retaining owner/capital identities. The intermediate maker-only key
split still leaves publisher starvation: finalized reservations on their shared
payer delay one market while the other's fresh originals progress. Separate role
keys are already supported; no new authority or source-age relaxation is introduced.
Actual service, browser and load results are recorded below and in validation;
no sustained cadence guarantee follows from the key separation.

`tests/performance/operating-cost.ts` computes integer fee/cadence scenarios. It
separates maker costs from venue costs, requested-CU v0 bids from explicit v1 bids,
and retained protocol revenue from insurance. Inputs are assumptions; use measured
receipts to choose a base case. It does not forecast landing, hedge cost or revenue.

## Frozen instruction cost reference

CU below is the inclusive invocation range in successful transactions, including child
CPI. Transaction CU includes every batched instruction and is stored separately in the
bounded baseline. Never sum parent and child CU. These are observed cases, not
worst-case ceilings. Maker control calls occur through clearing; quote calls may be
read-only simulations or execution CPI.

| Instruction | Caller | Observed inclusive CU | Main scaling / contention dependency |
|---|---|---:|---|
| `clearing.activate_liquidity` | Venue authority | 49,936 | Fixed selected market / registry bounds |
| `clearing.advance_account_resolution` | Permissionless keeper/proposer | 235,585–392,895 | Stage/page count and rational width; not linear CU per added maker |
| `clearing.allocate_market_fees` | Fee authority | 16,833 | One market ledger; withdrawal uses token gateway |
| `clearing.approve_liquidity` | Maker owner + venue approval | 221,092 | One maker; complete approved-code hash |
| `clearing.check_account_resolution_order` | Permissionless keeper/proposer | 236,342–280,734 | Stage/page count and rational width; not linear CU per added maker |
| `clearing.check_account_retirement` | Permissionless keeper | 65,626–65,712 | Two roots/page; total full scan grows with cohort |
| `clearing.check_market_backing` | Permissionless keeper | 41,241–54,687 | Two roots/page; total full scan grows with cohort |
| `clearing.classify_market_surplus` | Reserve authority | 22,385 | Selected ledger + actual token custody |
| `clearing.collect_account_loss` | Any keeper/payer | 57,417–68,504 | Whole root + relevant markets; gain requires valid backing certificate |
| `clearing.configure_funding_publisher` | Venue authority | 23,001–23,610 | Fixed selected market / registry bounds |
| `clearing.control_liquidity` | Maker owner / co-signer for scoped control | 210,784–248,563 | One maker/config; code hash and <=8 regions |
| `clearing.create_portfolio` | Owner | 21,435–30,438 | Fixed layout; registration traverses bounded registry |
| `clearing.deposit_account` | Owner | 36,559–48,533 | Selected roots; token gateways share vault/custody |
| `clearing.execute_liquidity_order` | Keeper using stored authority | 274,125–503,488 | Same bounded route plus stored order / protection |
| `clearing.execute_liquidity_route` | Owner/delegate | 255,216–504,141 | <=2 selected maker capitals / programs; whole-account financial admission |
| `clearing.finalize_account_resolution_rates` | Permissionless keeper/proposer | 260,384–298,447 | Stage/page count and rational width; not linear CU per added maker |
| `clearing.freeze_accounts` | Keeper for default; authority for source emergency | 228,903–261,785 | Complete membership binding; global safety barrier |
| `clearing.initialize_account_resolution` | Any storage payer | 167,419 | Fixed account/page sizes; setup count grows with membership |
| `clearing.initialize_account_resolution_page` | Any storage payer | 80,446–92,446 | Fixed account/page sizes; setup count grows with membership |
| `clearing.initialize_account_retirement` | Any storage payer | 17,535 | Fixed account/page sizes; setup count grows with membership |
| `clearing.initialize_funding_publisher` | Venue authority | 30,166–33,166 | Fixed selected market / registry bounds |
| `clearing.initialize_liquidity` | Venue authority | 21,883 | Fixed selected market / registry bounds |
| `clearing.initialize_liquidity_oracle` | Venue authority | 29,036–33,534 | Fixed selected market / registry bounds |
| `clearing.initialize_liquidity_venue` | Verified upgrade authority | 39,365 | One venue initialization |
| `clearing.initialize_market` | Venue authority | 32,160–41,160 | Fixed selected market / registry bounds |
| `clearing.initialize_market_backing` | Any storage payer | 19,720–24,220 | Fixed account/page sizes; setup count grows with membership |
| `clearing.initialize_venue_registry` | Venue authority | 22,941 | Fixed selected market / registry bounds |
| `clearing.liquidate_account` | Consenting receiver owner | 98,590 | Target + receiver, relevant markets, whole books and strict fee-adjusted progress |
| `clearing.manage_account_order` | Owner/delegate; cleanup keeper | 37,490–60,684 | Whole account, <=4 orders / 2 protections |
| `clearing.net_account_claims` | Owner, explicit flat net | 70,182 | Two markets and valid source certificate |
| `clearing.order_account_resolution` | Permissionless keeper/proposer | 203,414–231,247 | Stage/page count and rational width; not linear CU per added maker |
| `clearing.pause_venue` | Venue authority | 24,422–24,424 | Fixed selected market / registry bounds |
| `clearing.pay_account_gain` | Any keeper/payer | 68,473–72,331 | Whole root + relevant markets; gain requires valid backing certificate |
| `clearing.propose_account_resolution` | Permissionless keeper/proposer | 204,024–232,803 | Stage/page count and rational width; not linear CU per added maker |
| `clearing.publish_funding_report` | Restricted market publisher | 30,777–32,075 | No maker scan on-chain; backend covers all 3 makers |
| `clearing.quarantine_liquidity` | Venue authority | 28,529 | Fixed selected market / registry bounds |
| `clearing.reactivate_accounts` | Venue authority | 101,979 | Both qualified markets; fixed current bounds |
| `clearing.recover_accounts` | Keeper observation; authority to resume | 96,379–101,868 | Complete resolved-state and source checks |
| `clearing.register_liquidity` | Maker owner + venue approval | 183,913–198,418 | One maker; complete approved-code hash |
| `clearing.register_margin` | Owner | 36,800–51,719 | Fixed layout; registration traverses bounded registry |
| `clearing.replenish_liquidity` | Maker owner / co-signer for scoped control | 182,736–187,275 | One maker/config; code hash and <=8 regions |
| `clearing.retire_accounts` | Venue authority | 52,189 | Fixed selected market / registry bounds |
| `clearing.round_account_resolution` | Permissionless keeper/proposer | 210,736–236,930 | Stage/page count and rational width; not linear CU per added maker |
| `clearing.seal_liquidity` | Venue authority | 23,440 | Fixed selected market / registry bounds |
| `clearing.seed_market_insurance` | Reserve authority + donor | 29,300–29,304 | One market and actual SPL token transfer |
| `clearing.set_account_delegate` | Owner | 27,456–27,478 | One root; no market or maker dependency |
| `clearing.transfer_account_custody` | Owner | 43,817–43,821 | Selected roots; token gateways share vault/custody |
| `clearing.transfer_funded_account` | Owner | 82,263–93,523 | Relevant markets and whole touched root books; no all-maker scan |
| `clearing.value_account_resolution` | Permissionless keeper | 143,837 | Both source markets; complete resolution epoch |
| `clearing.withdraw_account_custody` | Owner | 48,621–48,625 | Selected roots; token gateways share vault/custody |
| `clearing.withdraw_funded_account` | Owner | 46,327–86,783 | Relevant markets and whole touched root books; no all-maker scan |
| `clearing.withdraw_market_fees` | Fee authority | 30,016 | One market ledger; withdrawal uses token gateway |
| `clearing.withdraw_retired_reserve` | Reserve authority | 33,044 | Selected ledger + actual token custody |
| `maker_a.control_curve` | Clearing controller PDA via CPI | 32,435–44,152 | Selected maker, <=8 regions |
| `maker_a.initialize_curve` | Maker owner | 56,078–69,088 | One config / price pair, <=8 regions |
| `maker_a.quote_curve` | Router simulation or clearing CPI | 16,600–20,047 | Selected maker, <=8 regions and supported quantity |
| `maker_a.reprice` | Owner or restricted updater | 17,800–18,810 | One maker price account; independent payers avoid artificial shared locks |
| `maker_b.control_curve` | Clearing controller PDA via CPI | 32,435–38,386 | Selected maker, <=8 regions |
| `maker_b.initialize_curve` | Maker owner | 56,078–66,088 | One config / price pair, <=8 regions |
| `maker_b.quote_curve` | Router simulation or clearing CPI | 16,573–19,840 | Selected maker, <=8 regions and supported quantity |
| `maker_b.reprice` | Owner or restricted updater | 17,800–18,810 | One maker price account; independent payers avoid artificial shared locks |

## Bounded load and operating envelope

### Initial measurement before parallel indexer reads

Clean harness `7e8d042` runs the unchanged P43 SBF on Surfpool 1.7.0 / core 4.3.2,
feature set 3383571666, with 50 ms slots. The host is Apple M3, eight cores,
Darwin 25.5.0, Node 24.22.0; PostgreSQL is 18.6. A separate service qualification
shared this host for part of the run. These are application observations, not
isolated machine capacity or validator scheduler TPS.

Each row offers for eight seconds, with at most four concurrent constructions;
finality drains afterward. Each workload stops increasing rate when successful
fills/offers falls below 90%, confirmed p95 exceeds 500 ms, or generator lag exceeds
250 ms. All signed outcomes remain in the denominator. The generator explicitly
selects makers and submits direct RPC transactions: this measures neither durable
queue capacity nor optimal router allocation. Producers concurrently refresh real
synthetic source accounts, six maker prices and two funding reports.

| Workload | Offers/s | Offered | Signed / finalized | Successful fills | Stale-version rejection | Not submitted: generator limit | Confirmed p95 ms | Finalized p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Same cross account, concentrated maker | 2 | 16 | 16 | 16 | 0 | 0 | 179 | 1,765 |
| Same cross account, concentrated maker | 8 | 64 | 56 | 49 | 7 | 8 | 255 | 1,827 |
| Same market, spread across makers | 2 | 16 | 16 | 16 | 0 | 0 | 172 | 1,773 |
| Same market, spread across makers | 8 | 64 | 62 | 62 | 0 | 2 | 236 | 1,793 |
| Same market, spread across makers | 32 | 256 | 82 | 73 | 9 | 174 | 253 | 1,802 |
| Disjoint isolated markets / owners / payers | 2 | 16 | 16 | 16 | 0 | 0 | 235 | 1,773 |
| Disjoint isolated markets / owners / payers | 8 | 64 | 64 | 64 | 0 | 0 | 250 | 1,809 |
| Disjoint isolated markets / owners / payers | 32 | 256 | 89 | 81 | 8 | 167 | 262 | 1,830 |

Totals: 752 offers, 401 constructed/simulated/submitted/finalized originals,
377 successful fills, 24 stale-version on-chain failures and 351 generator-limit
rejections. There are no expired or unresolved originals in this load sample.
The same-account ramp stops at 8/s; both other ramps stop at 32/s. Success/offer is
76.56% at the concentrated 8/s row, 96.88% for spread 8/s and 100% for disjoint 8/s.
These finite windows do not establish sustained rates. Latency distributions cover
all signed attempts, including rejected transactions, with nearest-rank quantiles.
Raw p50/p95/p99, construction lag, receipt-fetch and WS-audit timings are retained
in `.local/liquidity-execution/runs/p44-load-first/summary.json`. WS-audit completion
is not the exact WS delivery time.

Independent per-root event replay checks inventory, funding, claims and fees, not
only offsetting aggregate totals. Actual vault backing is 9,000,000 atoms across
nine members/72 reconciled accounts; fresh PostgreSQL replay matches 524 events.
However, live indexing obtains a coherent fence in **1 of 28 cycles**, with 27
classified revision-ahead retries. Final reconciliation passes after activity
stops; sustained live read-API readiness and a replay-lag percentile are **not**
established. Captured successful-cycle metric objects are mutable references, so
their later counter values are not historical snapshots. Cycle counts, reasons,
timestamps and final/replay equality remain independently recorded.

The generator/indexer parent consumes 84.359 s user CPU and 3.253 s system CPU;
end RSS is 526,991,360 bytes. Child Surfpool, PostgreSQL and browser resources are
outside that process measurement. Full-system utilization is not inferred.


### Current indexer and classified-original measurement

Clean `8b8c33f`, `p44-load-final/`, repeats the same declared ramps after bounded
parallel history reads. This run has no concurrent Rivalt service qualification.
Duplicate signed originals are classified before transmission and remain in the offered
denominator; they cannot contribute another fill or fee. The earlier incomplete retry
(`p44-load-parallel-history/`) exposed this case as RPC already-processed; retained
wires independently match byte-for-byte.

| Workload | Offers/s | Offered | Constructed | Unique submitted | Successful | Rejected on-chain | Unsubmitted | Confirmed p95 ms | Finalized p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same-cross-concentrated | 2 | 16 | 16 | 16 | 16 | 0 | 0 | 185 | 1798 |
| same-cross-concentrated | 8 | 64 | 63 | 63 | 62 | 1 | 1 | 222 | 1825 |
| same-cross-concentrated | 32 | 256 | 86 | 83 | 64 | 19 | 173 | 235 | 1821 |
| same-market-spread | 2 | 16 | 16 | 16 | 16 | 0 | 0 | 182 | 1808 |
| same-market-spread | 8 | 64 | 64 | 64 | 64 | 0 | 0 | 216 | 1812 |
| same-market-spread | 32 | 256 | 75 | 75 | 67 | 8 | 181 | 268 | 1847 |
| disjoint-isolated | 2 | 16 | 16 | 16 | 16 | 0 | 0 | 188 | 1835 |
| disjoint-isolated | 8 | 64 | 59 | 59 | 59 | 0 | 5 | 249 | 1868 |
| disjoint-isolated | 32 | 256 | 73 | 73 | 66 | 7 | 183 | 251 | 1845 |

Totals: 1,008 offers, 468 constructions, 465 unique simulated/submitted/finalized
originals, 430 successful fills and 35 on-chain rejections. Unsubmitted reasons:
`generator-inflight-limit`: 540; `duplicate-signed-original`: 3. Expired/unresolved:
0/0. Each offered row remains in exactly one final outcome category.

The live indexer completes 2 coherent cycles and records 33 revision-ahead retries.
Final and fresh PostgreSQL replay match 585 events, with 72 accounts, nine members and
exactly 9,000,000 vault atoms. This is a finite post-fix observation, not a sustained
readiness guarantee; the initial 1/28 result above is not silently replaced. The bounded
baseline retains current p50/p95/p99 and explicit denominators.

Current parent-process resource use: 103.614 s user CPU, 3.816 s system CPU; end RSS
564,117,504 bytes. Child process utilization remains outside this measurement. Different
host co-tenancy and classified duplicates prevent treating the two runs as an isolated
causal speedup experiment.

### Cost scenarios, not a profitability forecast

Actual local bids are zero. A one-signature transaction costs 5,000 lamports;
several setup/focused cases have two signatures and cost 10,000. The initial load's
401 attempts cost 2,005,000 lamports for 377 successful fills, about 5,318 lamports
per fill including failures. The current load's 465 unique attempts cost 2,325,000
lamports for 430 successful fills, about 5,407 lamports per fill. Two otherwise successful one-signature opening/
closing transactions cost 10,000 lamports plus Rivalt's 2 bps on each leg's gross
notional. A round trip can also incur funding, spread, adverse selection and more
failed attempts; unpaid gains are not cash revenue.

| Scenario, one signature | Requested CU | Zero-priority total lamports | Total at hypothetical 10,000 micro-lamports/requested CU (v0) |
|---|---:|---:|---:|
| Route | 800,000 | 5,000 | 13,000 |
| Reprice / report operator policy | 200,000 | 5,000 | 7,000 |
| Wallet cash / order action | 400,000 | 5,000 | 9,000 |
| Wide default continuation | 1,200,000 | 5,000 | 17,000 |

These limits describe named policies, not dynamic optimal limits. A v0 priority
fee uses the requested limit, rounded up, even when consumed CU is lower. Version 1
instead specifies priority lamports explicitly; the last column applies to v1
only if that same explicit priority amount is chosen. No current fee-market quote
or landing guarantee is implied. Reducing consumed CU alone did not reduce P43's
actual fees or requested limits. Choose limits from the particular operation's
measured envelope plus headroom; do not copy the single-maker limit to full books
or wide default stages.

At an assumed one update/second per maker, six makers pay 518,400 submissions/day:
**2.592 SOL/day total**, or 0.432 SOL/day each at 5,000 lamports. Two separate funding
reports every two seconds cost the venue **0.432 SOL/day** for 86,400 submissions.
These are cadence scenarios, not measured sustained operating rates. Distinct
role fee payers remove artificial shared locks, not these fees.

For a hypothetical conversion of **100 collateral units/SOL**, publisher-only
network expense is 43.2 collateral units/day. At the nominal retained 1.5 bps,
that alone requires **288,000 collateral units of daily volume**. The remaining
0.5 bps of collected fees is insurance, not operating revenue. Exact on-chain
fee/carry rounding remains unchanged. This lower-bound scenario omits oracle
submission, settlement/risk/default jobs, failed landings, rent, infrastructure,
operator labor and external hedges. Add venue job counts times their measured
receipt fees; an unresolved original retains its fee reservation. No external
hedge was executed and no independent maker profitability is established.

Reproduce integer assumptions with `tests/performance/operating-cost.ts` and its
literal expected-vector tests. For actual persisted worker originals, run
`node --import tsx tests/performance/operator-summary.ts <service-run-directory>`.
It checks signed wires against fetched receipts and WS discovery, grouping fees
and queue/confirmation/finality observations by responsible role. Persisted jobs
are not an offered-availability denominator; timing includes polling and injected
faults.


Actual service role costs at clean `a5afbc9` are separately verified from 239
originals: 180 maker reprices cost 900,000 lamports; 55 funding reports cost 275,000
(including three rejected reports); three wallet actions cost 15,000; one stored
order fill costs 5,000. Total: 1,195,000 lamports, excluding setup/source/rent.
Finalized transaction CU (from receipt `meta.computeUnitsConsumed`, distinct from
the inclusive invocation CU in the instruction table) is 18,249 per maker update,
peaks at 32,522 for available funding reports and is 256,768 for the order worker.
Wallet persistence-to-first-broadcast ranges
1,235–2,722 ms (three observations), while maker-role p95 ranges 40–2,785 ms and
funding-role p95 77–3,267 ms. These include intentional process faults/reservations,
not pure RPC latency. The full role distributions remain in `operator-metrics.json`.

### What remains expensive or serialized

The focused same-program pair is about 1.37 times the single-maker CU; a pair of
distinct executables is about 1.87 times. Full approved-program hashing costs about
131k CU per unique maker executable in the diagnostic run. This security check
remains; an alternative code-approval trust model needs separate design review.
More published makers would increase backend authentication/allocation/report
work and operator submissions, but do not automatically multiply a two-leg fill's
on-chain CU. More than three makers per market remains unsupported and unmeasured.

Same-root financial versions, selected-market exact fees/exposure, selected maker
capital/depth and price read/write conflicts still serialize genuine dependencies.
Distinct isolated BTC/ETH owners and fee payers have no compiled write conflicts.
A common payer adds an avoidable writable dependency. Dispatcher version 2 prevents
younger conflicting originals overtaking a committed waiter; it keeps active or
ambiguous reservations until definitive resolution and can still block behind an
unresolved original. This is correctness-preserving ordering, not unlimited queue
capacity.

Unpaid-profit certificates still require stable relevant observations across earlier
pages. The final check and payment are atomic, and ordinary own-cash exits do not
need that certificate. The constructed certificate probe has three deliberately
invalidated scans and one coordinated completion, not a normal availability rate.
Complete default retains its global freeze barrier. The 64-member signed lifecycle
and separate maximum-width VM fixtures bound different dimensions; neither proves
an arbitrary 64-active-position worst case. Published funding depth remains an
attestation rather than a guarantee of executable maker margin.

P39's A checkpoint used Surfpool 1.6.1 / core 4.2.1, while B uses 1.7.0 / 4.3.2.
An A-to-B CU difference combines implementation and runtime changes; it does not
isolate the account redesign. Only P43's matched before/after cases isolate its
small arithmetic change. A future Anchor migration must retain B's cases and
financial checks, and distinguish compiler/runtime effects from framework effects.
