# Validation and measured limits

## Persisted scratch foundation (P54B, incomplete)

The current D97 controller adds source binding, actual margin valuation, complete
ancestor closure and bounded public denominator steps. Native source/margin vectors,
schema-specific scoped revisions and the literal ABI extension are implemented.
Clean **`38fc788e82a21c7920d6eda9a35d0272c1bdf771`** passes four actual model/source
native tests and eight scoped-history tests. They check literal layout offsets,
whole-account funding/fractional claims, complete count/conservation, changed
source bindings and rollback of failed native prefixes; scoped writes increment
exactly once and schema 9 cannot substitute for financial schema 8. Generated
client parity/typecheck, literal ABI, evidence and whitespace checks pass. Its
linked qualification SBF builds without unsafe stack diagnostics, SHA-256
`2f1f90825a429da58ef3fd4691cf869d1507c617264311df340b71c1dc27b9d6`.
Logs and candidate remain at `.local/scalable-settlement/p54b-38fc788/`.
The signed prefix check below passes; rate proposals/reset and full P54B acceptance
remain pending. The selected ordinary
runtime is unchanged. Reproduce this scoped candidate probe with
`RIVALT_SETTLEMENT_ARTIFACT_DIR=.local/scalable-settlement/p54b-38fc788 bash ops/scalable-settlement-smoke.sh`.
The launcher checks the exact candidate hash separately from admitted maker/oracle
artifacts and uses an owned offline Surfpool. It never promotes the candidate to
normal runtime. The new probe derives a real frozen cohort from signed deposits,
fills and an adverse synthetic price move; signed continuation acceptance is
recorded below for the completed prefix scope.

Clean verifier **`ce146e0695797fe9b40d3cd2a6b7cd86f8146b9e`**, SBF **`38fc788`**,
passes **194 actual signed RPC/WS outcomes**, with every finalized original fetched,
independently decoded and compared byte-for-byte. Signed fills and adverse synthetic
prices produce a real eight-root freeze; no fixture injects successful financial
state. All nine new entrypoints execute. Each frozen row's cash, accrued claims,
quantities, ID/root/revision and collected cash matches independent arithmetic;
complete totals reconcile. Five arithmetic continuations at budgets 1/7/128 produce
LCM **30,006,000,277,777**, matching independent BigInt rational reduction.

| New verification transaction | Actual CU | Maximum wire bytes |
|---|---:|---:|
| Initialize prepared source | 22,914 | 686 |
| Initialize count node | 22,727–24,432 | 720 |
| Initialize complete member page | 26,172 | 719 |
| Initialize frozen row page | 23,173 | 719 |
| Initialize limb register page | 23,015 | 723 |
| Advance membership / close ancestors | 23,794–28,048 | 685 |
| Value actual root | 35,620–36,639 | 751 |
| Accept frozen denominator row | 24,121–32,920 | 685 |
| Continue bounded arithmetic | 27,203–31,267 | 744 |

Eight controller rejection/atomic-failure transactions preserve all tracked bytes:
stale frozen revision, wrong radix level, replay, omitted/duplicated root, missing
limb page, a second identical continuation rolling back its first instruction, and
completed-denominator replay. Existing financial accounts remain byte-identical
through successful verification too. Legacy and RC2 isolated Anchor clients match
177 clearing instruction encodings/metas, 21 new account decodings and 236 clearing
events (including setup); maker parity also passes. New verification accounts lock
**87,594,440 test lamports** of rent in this fixture, not total venue provisioning.
The owned Surfpool stops after completion. Evidence stays at
`.local/scalable-settlement/runs/p54b-ce146e0/`.

This is eight-root valuation/denominator acceptance only. No rate proposal/reset,
Apply/payout, larger population, PostgreSQL replay, browser, endurance, devnet or
production qualification is inferred; no new artifact is selected for normal use. These checks will use a fresh existing-size frozen cohort;
P55/P56 still own live lifecycle and expanded population qualification.

Clean **`a7adbaf7c1bee16cbc47c304e830f11c393ed507`**, restacked above P54A's
compiler-guard fix, passes five focused Python tests: 774 exact comparisons plus
1,338 arithmetic, 462 LCM and 305 collection vectors. The native adapter enforces
exact next-word permissions and restores checkpoint bytes at 1/7/128-step boundaries.
Four Rust codec regressions and the page-planner regression pass. Pinned SBF
metadata compilation passes; no linked program or resource measurement is inferred.
Logs remain at `.local/scalable-settlement/p54b-a7adbaf/`.

Clean **`1bd8e2e67a1e5b5e203e2d7de76000912ea76a44`** adds and verifies the next
inactive checkpoint:

- **120 complete denominator passes** match independently reduced Python Fractions
  and LCMs at budgets 1/7/128, with populations through 1,024 and common values
  crossing the 256-word page boundary. Eight incomplete/count/order/domain cases
  reject. Native progress refuses a result until the complete row sequence finishes.
- **256 complete valuations / 3,637 encoded prefixes** match independent integer
  sums. Tests check root cash, net/gross lots, positive/negative claims, separate
  pools/insurance/fees and exact final conservation. Fourteen incorrect total,
  count, ordering and position cases reject without committing the failed scalar
  prefix. Claims are already-valued inputs: no oracle/funding/account-admission
  acceptance is inferred.
- **304** independent <2^151 aggregate domain/carry cases and **six** Rust cursor
  regressions pass, including literal formats, frozen binding corruption, failed
  final-row conservation, nested register fences and completed replay rejection.
- **Four clearing native-loader tests** pass: literal Borsh/discriminator/offset
  parity for the 2,129-byte page, all 81 corrupted header-byte positions, foreign/
  wrong-owner/permission/epoch/attempt/revision/length refusals, page-boundary carry,
  dirty-only revision updates and exhausted/stale revision rejection. They use real
  Pinocchio account views over native test memory, not signed transactions or VM
  rollback. The initial missing trait import/mutable-view compile errors were fixed
  before this clean acceptance; development logs are retained separately.
- Affected Rust formatting, Python compilation, shell syntax, evidence policy and
  pinned SBF **metadata** compilation pass. No new selected binary, generated ABI
  qualification, program initialization, RPC/WS/PostgreSQL or financial activation
  is claimed. This child branch has no phase PR yet.

Clean **`6f051bcea8fb5a67f53eebdbfa408f0116e192e8`** adds the read-side financial
index. Two core tests exercise **11 dense/sparse populations, 22,448 total native
entries**, including 10,002 entries in the largest case and u64-maximum IDs. Every
encoded traversal prefix restores exactly; the resulting ordered IDs equal the
independently enumerated list. The exact logical request bound is checked. Missing/
duplicate/out-of-order requests, wrong child counts/masks, unreachable namespace
branches, malformed checkpoints and terminal replay reject. These are synthetic
index entries, not admitted trading accounts.

Three clearing native-loader tests independently check literal 190-/2,699-byte
node/page codecs, complete two-entry traversal and corrupted discriminator/venue/
PDA/count/mask/owner/size/entry-lifecycle bindings. Frozen safety/membership locking
and actual root valuation are not supplied by these readers and remain required.
Scoped formatting, pinned SBF metadata and evidence policy pass. The initial
legacy error-macro compile issue was corrected for RC2 before this clean pin.
Raw logs remain at `.local/scalable-settlement/p54b-6f051bc/`; no signed transaction,
linked SBF build, CU/rent or expanded-capacity acceptance follows from this result.
Reproduce with `cargo test --locked -p financial-core --test scalable_membership`
and `cargo test --locked -p clearing --lib --features liquidity-execution-qualification instructions::account_safety::settlement_membership::tests`.

Reproduce the new checks with `cargo build --locked -p financial-core --bin scalable-wide-driver --bin scalable-snapshot-driver`,
`python3 tests/financial/test_cohort_denominator.py`,
`python3 tests/financial/test_scalable_snapshot.py`,
`cargo test --locked -p financial-core --test scalable_checkpoints` and
`cargo test --locked -p clearing --lib --features liquidity-execution-qualification instructions::account_safety::settlement_pages::tests`.
Logs remain at `.local/scalable-settlement/p54b-1bd8e2e/`; raw evidence is untracked.
The new independent arithmetic checks join financial CI; broader inherited suites
were not rerun locally for this inactive checkpoint. Frozen complete membership,
source binding, the owning on-chain controller, rate/proposal reset and actual
signed full-context resource/rollback acceptance remain P54B work. P54C owns
rounding/Apply/recovery; P56B remains the financial expansion gate.

Clean **`999ce4d`** adds normalized paged arithmetic for later rate work. **1,440**
independent Python integer cases match at resume budgets 1/7/128, across 96-/256-word
boundaries and values through 32,768 bits. Every unused source word is deliberately
nonzero and every physical read/write must match the exact declared plan. Each
step performs at most three word accesses; output normalization is also resumable.
Ten invalid arithmetic/domain cases and two Rust checkpoint/alias tests pass.
Pinned SBF metadata, affected formatting, shell, whitespace and evidence checks
pass. This primitive has no public rate/proposal consumer yet; no new linked SBF,
RPC or financial acceptance follows. Logs remain at
`.local/scalable-settlement/p54b-999ce4d/`. Reproduce with
`cargo build --locked -p financial-core --bin scalable-wide-driver`,
`cargo test --locked -p financial-core --test scalable_normalized` and
`python3 tests/financial/test_normalized_pages.py`.

Clean **`0ff7c53d8a344ba73cf42546778561887091a403`** passes **642** exact persisted
atom divisions against Python `divmod`, at 1/7/128-step boundaries. Three cases
exercise the full-product correction of an overestimated quotient. Inputs cross
96-/256-word boundaries and reach 32,768-bit divisors; poisoned tails remain
inaccessible. Four invalid denominator/quotient/budget cases and the 384-byte
checkpoint's source/scratch/stage/operand corruption checks pass. The affected
1,440 normalized arithmetic cases and two earlier codec tests also pass. Pinned
SBF metadata, scoped formatting, shell, whitespace and evidence checks pass.
Logs remain at `.local/scalable-settlement/p54b-0ff7c53/`; reproduce with
`cargo test --locked -p financial-core --test scalable_atom_division` and
`python3 tests/financial/test_paged_atom_division.py` after building the wide driver.
This is a prerequisite arithmetic schedule, not complete on-chain rate verification
or insurance/payout acceptance.

Clean **`f1cd4a7`** passes **1,185** complete persisted rate evaluations against
independent Fraction/branch equations at 1/7/128-step boundaries. Every incoming
row prefix, strict greatestness, final market residual/loss identities, insurance
floor and fractional flag agrees; **74** hostile/domain/non-greatest requests
reject. Three Rust tests cover checkpoint/input/nested-operation corruption,
ordered complete membership and the separate original-budget clipping controller,
including at-most-once market clipping and the required final integral pass.
Pinned SBF metadata compilation passes. Logs remain at
`.local/scalable-settlement/p54b-f1cd4a7/`; reproduce with
`cargo test --locked -p financial-core --test scalable_rate_work`,
`cargo build --locked -p financial-core --bin scalable-rate-driver` and
`python3 tests/financial/test_paged_rates.py`. This pin is native rate arithmetic,
not signed proposal or settlement acceptance.

D98's subsequent public proposal/upload/recovery implementation is under
qualification. Its source/layout, scoped-history and empty-page-plan development
checks pass; the development linked SBF has no stack diagnostics. No clean pinned
signed rate/recovery result or phase completion is inferred from those checks.

## Scalable native settlement (P54A)

Clean **`47ba74e36c03379560e7ed2eba6392b212c91deb`** builds the native
`scalable-wide-driver` and passes four focused tests against independent Python
integers/Fractions: **1,338** resumable arithmetic cases, **462** exact LCM
extensions and **305** reduced collection rows, plus rejected domains. Resume
budgets 1/7/128 agree; cases cross the inherited 96-limb size and reach 13,757
words. Dirty scratch tails are cleared before widening. Each step touches at most
three words; LCM work follows used input width rather than allocated capacity.
The affected source format, Python compilation, shell and evidence checks pass.
The optional whole-workspace format check detects pre-existing formatting outside
this change; no unrelated files were reformatted.

Clean **`60c2141eb2a7af30bc8a6d99dd752167549c3263`** passes complete native acceptance:

- **258 independent cohorts × three continuation budgets = 774 compiled settlements**
  match the retained branch/Fraction oracle for rates, collections, cash, insurance
  budgets/usage, debtor writeoffs, creditor impairments and every atom owner and
  rounding adjustment. Budgets are 1/7/128 steps. Cases include cashless cycles,
  external creditors, two insurance-clipping passes, maximum claims/cash, unused
  insurance and separate retained fees.
- **307** malformed, incomplete, non-greatest, out-of-domain, missing/duplicate/
  foreign/order-corrupted requests reject. Every unfinished graph prefix refuses
  results and completed graph/cursor replay rejects. This is native continuation,
  not authenticated account replay or process-crash durability.
- **980** normalized atom-division comparisons match independent Python `divmod`,
  plus three literal 151-bit aggregate / 302-bit product cases. All prior **1,338**
  word arithmetic, **462** LCM and **305** collection cases pass again at this pin.
- The active hierarchy matches an independent ordered set across **80,000** paired
  updates/searches, emptying and boundary failures, with tested per-query/per-update
  word limits. Affected literal model regression, scoped format, Python compilation,
  shell syntax, evidence policy and **91** local documentation targets pass.
- All **16** release-build scale diagnostics complete: four shapes at 64, 128,
  1,024 and 10,000 rows. Exact cash/movements and augmentation counts match the
  streaming model, with independent repeated-fraction `1/3` recovery/cash identities.
  These use synthetic already-valued claims; registered, claim-participating,
  empty and funded counts are distinct. No exposed-position admission is claimed.

Representative distinct-denominator cases, on Apple M3 / Rust 1.97.1 release:

| Rows / claim-participating / funded | Used words peak | Arithmetic word steps | Compiled process seconds | Native graph payload bytes |
|---|---:|---:|---:|---:|
| 64 / 63 / 21 | 33 | 133,433 | 0.006383 | 24,832 |
| 128 / 126 / 42 | 60 | 495,525 | 0.005770 | 49,104 |
| 1,024 / 1,023 / 341 | 433 | 29,384,846 | 0.093212 | 389,336 |
| 10,000 / 9,999 / 3,333 | 4,009 | 2,665,849,459 | 7.917139 | 3,797,360 |

The 10,000-row common denominator is 256,232 bits. Its untrusted proposal and
separate Python rounding comparison take 4.481841 / 20.482780 seconds. The all-
participating 10,000-row mixed-link case takes 4.955804 compiled seconds and uses
3,818,720 graph payload bytes. Process timings include startup, transport parsing
and result decoding; the first 64-row cycle launch takes 0.397770 seconds. These
are individual diagnostics, not latency percentiles. Payload excludes scalar rows,
registers, allocator/transport overhead and native test copies; it is not peak RSS
or account rent. Logical steps exclude host allocation/copying. The conservative
O(N+W) storage and finite work bounds in the risk contract are checked in each case.
The large word count explicitly leaves SBF affordability unproved.

A follow-up compiler-boundary check found that pinned platform-tools v1.52 reports
`target_arch="sbf"`, not `bpf`. The native-module guard now checks the actual
`target_os="solana"`; Cargo explicitly recognizes that patched target OS for host
cfg linting. Host `cargo check` and a pinned SBF `rustc --emit=metadata` pass.
A positive metadata probe imports the word cursor; a negative probe fails with
E0432 for all four native modules. Raw probes stay at
`.local/scalable-settlement/p54a-target-guard/`. These are target metadata checks,
not a complete SBF program build, stack/CU measurement or deployment. Clean guard
revision **`7aef54f1d6908f9cef0e9186a386ddb79341793b`** passes both probes, scoped
formatting and all four complete-settlement Python checks again (774 settlements,
307 refusals, 980 divisions and three aggregate/product vectors). No native financial
semantics change; the scale observations remain pinned to `60c2141`.

Reproduce the scoped checks with `cargo build --locked -p financial-core --bin scalable-wide-driver --bin scalable-settlement-driver`,
`python3 tests/financial/test_scalable_wide.py`,
`python3 tests/financial/test_scalable_settlement.py` and
`cargo test --locked -p financial-core --lib clearing::scalable::active::tests`.
The independent settlement suite joins financial CI. The separate scale diagnostic
uses `cargo build --release --locked -p financial-core --bin scalable-settlement-driver`
and `RIVALT_SCALABLE_DRIVER=target/release/scalable-settlement-driver python3 tests/financial/measure_compiled_settlement.py`.
Exact clean logs/results remain in `.local/scalable-settlement/p54a-60c2141/`;
earlier development captures remain separate and retained. No evidence is tracked.

This is native arithmetic/graph acceptance only. Vector orchestration is excluded
from SBF; frozen account authentication, physical pages/cursors, transactional
rollback, continuation CU/rent and token effects belong to P54B/P54C. No new selected
program, runtime transaction, enabled account capacity or financial activation is
qualified. No RPC/WS/PostgreSQL, browser, endurance or external run is inferred.

## Numeric-bound price policy (P53B)

G5 approval on 11 November selects policy 2: reference/trigger 2–909,090 and
stored limits 1–1,000,000 collateral atoms/lot. Raw asset inputs must be positive
and checked; the complete risk interval is validated without clipping. Source
freshness/confidence/agreement/depeg/recovery, fees, margin, numeric arithmetic
and default/devnet gates remain unchanged. This qualifies the local prototype.

Clean SBF **`afeb7eae419bc66cf1c902932fea79a994fa4dc1`** builds with no unsafe
stack diagnostic. Qualification clearing is **1,538,848 bytes** (+64 vs P53A),
SHA-256 `fbd5524190f301a4e82146839fef1a7a3917f9a86e1a871be2e3c9dc509cd1dd`.
Every other binary, including default clearing, is byte-identical to P53A/P49.
Generated SDK/policy parity and D90's exact ABI comparison pass; no IDL, account,
PDA, discriminator, error-number or signed-report change is introduced.

- Clean publisher verifier **`10cadb701a5a41718ad73449559ca25196449065`**:
  **137 signed RPC/WS outcomes / 21 reports**, 11 intentional rejections. Old
  fixture cliffs, both new reference edges, Q=3,000,000, extreme confidence,
  immediate-outside disagreement, stale/depegged sources, complete coverage,
  zero-cash published depth and authority/replay rollback pass. Legacy/RC2
  conformance decoding passes. Maximum publisher CU **21,035**, 838 bytes,
  13 keys; the three-million-lot report uses **21,007 CU**. Budget stays 200k.
- Clean boundary/journal verifier **`82d2c6a1223e8f88529216362102a8e2f93a37a1`**:
  **228 signed outcomes**, eight BTC/ETH open/reduce-only-close pairs at
  2/9,999/100,001/909,090 plus two restart-recovered fills. Stored limit/trigger
  edges accept, immediately outside terms roll back; actual stale-source deposit,
  cancellation with full numeric survivor reservation and flat funded exit pass.
  The actual journal has 225 transactions, eight intentional failures, **176
  events/outbox records**, zero unresolved jobs. Reconciled publication and fresh
  PostgreSQL reproduce the complete state and all **176 original event bytes**.
  Seventy entities/eight roots reconcile 8,000,000 actual/allocated collateral.
  Independent fees total **848**: BTC 436 (109 insurance/327 fees), ETH 412
  (103/309), both carries zero. Failed withdrawal CPI has no financial effect.
- Clean safety verifier **`82d2c6a`**: **290 signed outcomes**, 23 intentional
  failures. Existing-position TP/SL, reservations, transfer/withdrawal, held
  whole-account funding, post-fee liquidation, complete-cohort resolution,
  stale-source terminal exits and recovery/reactivation pass. The independent
  raw-byte audit verifies eight exact Fraction payouts, two rounding augmentations
  and ten rejected corruptions. This uses the current eight-root cohort; it does
  not qualify expanded population or the future scalable solver.
- Observed boundary-route peak **160,356 CU / 1,014 bytes / 19 keys**; paired-market
  publisher peak **44,026 CU / 1,192 bytes / 17 keys**. Safety route peak 279,710 CU;
  safety instruction peak 187,509 CU. These are scoped workloads, not full-book
  maxima, fresh contention measurements or a new throughput claim.
- Source checks pass: 23 financial-core and 29 clearing-engine native tests;
  52 affected SDK/UI cases, including **1,536 independent per-lot exhaustive
  allocations**; typecheck, generation, exact ABI and evidence checks. Canonical
  funding uses interval and convex pair search, preserving deterministic ties,
  two legs and complete coverage without financial admission. At clean `afeb7ea`,
  1,800 timed searches over 18 bounded scenarios (three makers/eight regions,
  including Q=3m) peak at **329 distinct quotes**, p95 **0.394 ms**, p99 **0.535 ms**
  on Apple M3. This measures off-chain CPU, not landed CU or worst-case latency.

The first boundary run at `10cadb7` passed trades/order edges but requested a
21-second expiry wait from a 20-second watchdog. It is not a completed replay.
The corrected verifier splits the wait and leaves source age, waiter deadlines
and publication freshness unchanged. Both attempts and all raw receipts remain
at existing ignored `.local/price-policy/p53b-*` paths. Accepted candidate files
are `.local/price-policy/afeb7ea-artifacts`; the selected runtime uses their exact
hashes. Previous selected files are retained at `.local/price-policy/pre-p53b-current`.
All owned runtimes stopped; no browser, endurance, external or funded run is claimed.
P15B/P16B remain Open, 24-hour endurance Deferred and P58's other economic gates open.

Reproduce with the candidate build command, `ops/funding-publisher-smoke.sh`,
`RIVALT_PRICE_POLICY=1 RIVALT_LIQUIDITY_PROBE=indexer RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15454 bash ops/current-runtime-smoke.sh`,
and `RIVALT_LIQUIDITY_PROBE=safety bash ops/current-runtime-smoke.sh`, using explicit
fresh run/artifact directories. `node --import tsx tests/performance/funding-search.ts`
prints the bounded CPU diagnostic. Historical `phaseAcceptance:false` fields
remain explicit: these scoped P53B constituents do not reopen entire older phases.

## Shared unchanged price policy (P53A)

Clean SBF source **`213610666d7b1ab3136b5b3f0da25c856ad92d1f`** builds with the pinned
RC2/platform-tools profile and no unsafe stack-frame diagnostic. Qualification
clearing is 1,538,784 bytes (+896 versus P49), SHA-256
`a42f1b0affb774c4c8725656b4ce37cb20d6905494ccef31ad94c86d97afc375`.
Both maker binaries, default clearing/makers and fixtures are byte-identical to P49.
Generated IDL/SDK and the pinned wire check have no ABI delta. Numeric policy
version 1 names existing behavior; accepted prices and financial rules do not change.

- Clean publisher verifier **`55426dc676dc55ae790f9b2b7d3c1ccd5b524728`**: 99 actual
  signed Surfpool RPC/WS outcomes, 12 reports. Existing source/reference edges,
  100/600-lot exact depth optima, source values 9,999/100,001, forged available
  reports, collateral depeg, failed verification, expired coverage and publisher
  authority/replay reject or degrade as specified. The isolated legacy/RC2 decode
  checks pass. Single-market publisher transactions peak at 20,939 CU, 838 bytes
  and 13 loaded keys; requested budget remains 200,000 CU.
- Clean journal verifier **`e98b0ebf9a9649fec5fc1c5f02be1b8c197bf3af`**: 120 signed
  outcomes, two actual fills, restart catch-up and reverted-CPI rollback. Fresh
  PostgreSQL reaches reconciled publication after two pending cycles and matches
  the complete financial state plus all **72 event-byte records**. The initialization
  journal contains 117 transactions (four intentional failures), 72 outbox records
  and zero unresolved jobs. Seventy entities/eight roots reconcile exactly
  8,000,000 allocated/actual vault atoms. Independent expected fees are 26 atoms:
  six insurance, 20 retained and carry two; cash plus fees equals vault.
- Scoped actual route peak: 160,001 CU, 1,006 bytes, 19 keys. The paired-market
  publisher transaction peaks at 43,814 CU / 1,192 bytes / 17 keys. These are this
  workload's measurements, not full-book maxima or a new throughput qualification.
- Source checks: typecheck; 59 affected SDK/UI cases; 22 financial-core and 29
  clearing-engine native tests; generated-policy/SDK parity, pinned ABI, shell,
  whitespace, local documentation targets and evidence policy. Literal cases cover
  both market units, source edges/depeg, full numeric fallback reservations and
  post-fee liquidation. Broad regression is delegated to applicable CI.

The first journal slice at `55426dc` matched projection only. Tightening the older
harness to require fresh published readiness exposed a host-sleep timeout at
`73855fc`: macOS logged 170 seconds of idle sleep. The final supervisor holds the
existing temporary idle-sleep assertion for all finite probes; its original
60-second check and ten-second publication freshness are unchanged. Failed and
partial attempts remain local and are not substituted for the final acceptance.

Evidence: `.local/price-policy/{2136106-artifacts,p53a-publisher,p53a-indexer-awake}`.
At P53A qualification these files were selected in `.local/anchor-rc2/current`;
P53B now supersedes that selection. Pre-P53A contents remain retained in
`.local/price-policy/pre-p53a-current`. Use a fresh local domain/
database; do not run old journals/originals against a replacement artifact binding.
No new browser, full-book/load/endurance or external deployment is claimed.
P53B has separate approval and signed acceptance above;
this P53A evidence qualifies only policy 1. P15B/P16B remain external.

Reproduction uses `ops/build-liquidity-execution.sh` with an explicit candidate
destination, `ops/funding-publisher-smoke.sh`, and
`RIVALT_LIQUIDITY_PROBE=indexer RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15453 bash ops/current-runtime-smoke.sh`
with explicit fresh run/artifact directories. The publisher and replay summaries
retain `phaseAcceptance:false` for their historical parent phases: they are scoped
constituents, not a rerun of all P32/P33 qualification.

## Bounded-progress indexer (P52)

Clean **`fe1c754e985b56e653b03795af8daf2b8ca59e62`** passes full signed
Surfpool/RPC/WS/PostgreSQL qualification. Runtime code is identical to clean
`32988bb`, which passes typecheck and 44 focused indexer/API/service tests. No
program, IDL, financial rule or account-schema change; freshly deployed programs
are the existing P49-qualified artifacts, with Surfpool 1.7.0 / PostgreSQL 18.6.
SQL transport format 3 requires a fresh journal, preserving earlier databases and
signed originals with their existing executor.

- Backlog reconciliation contains **10,642 transactions / 4,306 clearing
  invocations**, including 10,100 independently signed/finalized unrelated SOL
  transfers and 4,200 successful delegate changes. Recovery makes durable progress
  through the per-cycle 500-unit budget instead of failing a total-backlog limit.
- Actual subprocess SIGKILL before writes, during SQL before COMMIT and after
  COMMIT leaves the expected covered checkpoints (1731, 1731, 1732), with no false
  publication. WS reconnect recovers through complete RPC history. A pending wallet
  original finalizes with identical bytes/signature while publication is stale.
- Conflicting retained blocks/invocations, forged or regressing publication,
  expired witnesses, append-only mutation and format-2 startup reject. A deliberately
  reverted two-instruction delegate transaction leaves no economic event. Focused
  tests also cover missing blocks/manifests, scoped revision gaps, multi-instruction
  atomicity, oversized/empty-block work, API cursor/freshness fences and RPC byte caps.
- Two actual fills independently require 26 fee atoms: six insurance, 20 retained
  fees and carry two. Root cash plus fees remains 8,000,000 collateral atoms.
- During 74 continuous delegate updates, three distinct nonces (4205, 4229, 4253)
  are published at verified finalized checkpoints. Complete state and **4,353 ordered
  event-byte records** match fresh PostgreSQL replay; 70 entities/eight margin roots
  and 8,000,000 actual/allocated vault atoms reconcile with no surplus.

The [fixed-witness proof](../application/durability.md#attainable-reconciliation-while-the-head-advances)
handles the demonstrated Surfpool account/context skew by waiting for one captured
observation ceiling to finalize; it never serves nonfinalized history or replaces
the captured account bytes while catching up. It retains full financial-field
comparisons and the original ten-second freshness deadline. The smaller diagnostic
at `32988bb` was useful for isolating this issue but is not substituted for the full
run above. Its `phaseAcceptance:false` remains explicit.

| Full run observation | Measured value / scope |
|---|---|
| End-to-end qualification | 306.954 seconds, including provisioning, faults and replay |
| Main recovery | 2,799 committed blocks after the crash checkpoints; 23 pending cycles, zero recorded cycle failures |
| Fresh replay | 5,676 complete blocks / 10,679 transactions; 29 pending cycles before publication |
| Largest observed block | 200 transactions; one complete block per SQL commit |
| Largest observed SQL commit | 140.567 ms in the main recovery process; not a percentile or global worst case |
| RPC | Main recovery 6,052 requests / 40,144,224 response bytes; replay 11,867 / 40,690,414 |
| Largest observed RPC response | 2,576,464 bytes, including artifact checks; configured per-response budget 64 MiB |
| Database size | 106,947,087 bytes at the backlog checkpoint, before live tail/replay database |
| Sampled process RSS peak | 665,387,008 bytes for the combined test harness/indexer, not standalone indexer memory |

This is one Apple M3 local observation at 50 ms simulated slots, not validator TPS,
production capacity, 10,000 live margin accounts or continuous endurance. Changing
accounts across multiple RPC batches may still lack a common witness; oversized
responses and slow finality retain coverage and close readiness. Larger-cohort and
production limits require their own acceptance. The demo caller now waits for
published readiness across bounded cycles. Typecheck and 11 existing demo transport
checks pass after this entrypoint-only adjustment; they do not execute browser
startup, and no fresh browser qualification is claimed.

Reproduce only the affected checks:

```sh
source ops/env.sh
pnpm typecheck
pnpm exec vitest run packages/indexer/src/finalized-indexer.test.ts packages/indexer/src/account-reconcile.test.ts packages/indexer/src/account-api.test.ts packages/indexer/src/scoped-history.test.ts packages/indexer/src/rpc.test.ts packages/services/src/account-runtime.test.ts
RIVALT_LIQUIDITY_PROBE=indexer-progress RIVALT_LIQUIDITY_POSTGRES=1 RIVALT_PG_PORT=15452 bash ops/current-runtime-smoke.sh
```

Raw accepted evidence remains `.local/indexer-progress/fe1c754-20261111-full`;
small live diagnosis remains `32988bb-20261111-live` in that same parent directory.
`RIVALT_INDEXER_DIAGNOSTIC=live` deliberately selects smaller traffic and cannot
satisfy full phase acceptance. Owned runtimes stop and local data/evidence remain.
P15B/P16B remain external, and 24-hour endurance remains Deferred.

## Account-scale native feasibility (P51B)

Clean candidate **`a5ac218d6e439be74fc136bed67c2d5b9e733a41`**, based on planning
tip `0e864d9`. This is a contract/model deliverable. No program, IDL, current schema,
activation limit, artifact or runtime configuration changes. The actual retained
financial-core row and atom drivers were rebuilt with the pinned toolchain.

- Six focused Python tests pass. Across 254 complete <=64-row cohorts, the new
  exact solver and compact schedule match the independently implemented Fraction/
  branch oracle; **508 actual Rust rate/mutated-proposal cases** and **508 actual
  Rust atom/continuation cases** also match. Dense and compact schedules preserve
  the same atom owners/augmentation counts, including reverse-path repairs.
- Literal cashless cycles, external creditors, own-cash proportional debts,
  fractional claims, no/partial insurance, sequential insurance clipping and
  numeric-edge rows are included. Repeated-fraction goldens at 128/1,024/10,000
  roots independently require rates 1/3, preserve fees and conserve every market.
- The backing model passes **1,536 independent explicit-corner comparisons**
  during a 256-row scan with mutations between every step. New shortfalls remain
  visible; repair restores eligibility, invalid sources and out-of-region points
  refuse readiness. This is a maintained-summary proof model, not authorization,
  source-validation or signed transaction/rollback evidence.
- Shell syntax, Python compilation, relative documentation links/anchors,
  whitespace and tracked-evidence policy pass. The two focused suites are added
  to financial CI; no hosted result is inferred from local success.

The reproducible sweep runs four shapes at 64/128/1,024/10,000 registered rows:
cycle plus external creditor, repeated proportional fractions, distinct large
denominators, and mixed large denominators plus cross links. Counts of populated
rows are explicit; remaining rows are zero-state identities. These inputs are
already-valued synthetic claims, **not proof of live position admission**. All
16 compact runs finish; the dense baseline finishes 13 and explicitly declines
three at the configured diagnostic budgets. No partial output is treated as payout.

| 10,000-row native shape | Financial rows | Reduced L bits | Dense flow storage lower bound | Dense / compact visited arcs | Compact solve + round time |
|---|---:|---:|---:|---:|---:|
| Cycle with external creditor | 9,999 | 1 | 160,000 bytes | 30,001 / 13,336 | 0.456 s |
| Repeated fraction | 9,999 | 2 | 160,000 bytes | stopped at 2,000,001 / 16,665 | 0.245 s |
| Distinct fraction | 9,999 | 256,232 | 640,640,000 bytes | dense storage budget / 16,665 | 24.288 s |
| Mixed wide fractions/links | 10,000 | 155,324 | 388,320,000 bytes | dense storage budget / 10,000 | 24.994 s |

Single observed Python runs on Apple M3; these are neither percentiles nor CU.
The 64 MiB dense-flow budget is checked against a lower bound on serialized
numerators, not measured Python peak memory. The 2m-arc cutoff is diagnostic, not
a proposed financial limit. Compact storage uses shared wide work/recomputation;
its timing includes exact ordering/conservation checks. Counted limb visits and
remainder comparisons are abstract operations, not a complete CPU/CU cost model.
The distinct 10,000-row product L was 284,554 bits: exact reduction helps but does
not cure adversarial denominator growth. Streaming response segments also avoids
retaining a wide intercept for every link threshold in the mixed case.

Reproduce only the affected checks:

```sh
source ops/env.sh
cargo build --locked -p financial-core --bin clearing-row-driver --bin clearing-atoms-driver
python3 tests/financial/test_scalable_clearing.py
python3 tests/financial/test_incremental_backing.py
python3 tests/financial/measure_scalable_clearing.py
python3 tests/financial/measure_scalable_clearing.py --compact
```

Raw diagnostics remain `.local/scalable-clearing/p51b-a5ac218-{dense,compact}.jsonl`.
No SBF, Surfpool/RPC/WS, PostgreSQL, new CU/fee/rent or deployed-account result is
claimed. P54/P55 must prove bounded paged arithmetic/graph execution, complete
membership/mutation coverage, worst-case storage provisioning and current-source
backing progress, then measure the stated G1 recovery/resource budgets. P56B still
requires actual larger-cohort integration before enabling local financial paths.
The model does not qualify 10,000 live accounts or close P15B/P16B/endurance gates.

## Expanded quantities (P49)

Clean SBF source **`49c343e6e77a327fc9fa00c5b2a2e172dceb380d`**, clean integrated
verifier **`125a2b3eafaa4413a31ba82a4dfcf183258f9f79`**. Default/qualification
clearing and both makers build without unsafe stack diagnostics. Fresh actual
Anchor IDLs for all three programs are identical to the existing generated
contract; generated SDK and D90 wire-contract checks pass. The fixed allowlist
uses `p49-expanded-quantities-candidate-v1`; old bindings remain historical.
Normal local files are promoted to `.local/anchor-rc2/current`, after preserving
all previous files at `.local/quantity/pre-p49-current` and immutable C0.

Affected native checks: 15 financial-core order/liquidation/safety cases, ten
maker-interface cases and six clearing route cases, all passing. These include
independent literal large-order reservation, 100m-depth prefix arithmetic and a
500k-lot liquidation preserving one scaled fractional unit with strict progress
after fees. Sixty-two affected SDK/UI/service checks pass. Independent Python
comparison passes 715 router cases, 3,172 Rust quote vectors (1,547 exact quotes /
1,625 expected rejects) and 27 curve-contract cases. Typecheck, SDK generation and
ABI checks pass; 23 artifact-verifier/launcher checks also pass after updating pins.
The initial native linking failure was absent Apple compiler
tools; the user restored them before successful native/SBF acceptance.

Actual signed acceptance:

| Fresh run (under `.local/quantity/`) | Result |
|---|---|
| `p49-125a2b3-rpc` | 231 signed RPC/WS outcomes; 100m open/close, million-lot SDK route, two-program stored partials, large TP/SL, numeric/replay/over-close rejections with rollback, reserved transfer/withdrawal, whole-account funding, 500k liquidation, complete default and terminal funded exit |
| Independent raw audits | Nine fills checked against literal flat prices and whole-account funding; eight exact Fraction default payouts; eight route and ten default/accounting corruptions rejected |
| Same run's real PostgreSQL | 188 authenticated finalized events; on-chain cash agrees; fresh database/refetched RPC replay produces identical complete projection |
| `p49-125a2b3-resource` | 146 outcomes retaining the P47 full-book 4,608-lot workload, both program routes, skew crossing and depth-epoch rollback |
| `p49-49c343e/default-gates-svm.json` | All three newly compiled default binaries reject valid initialization with rollback |

Reproduce the larger flow with pinned artifacts and an unused run directory:

```sh
RIVALT_LIQUIDITY_PROBE=quantities RIVALT_LIQUIDITY_POSTGRES=1 \
RIVALT_PG_PORT=18943 RIVALT_RUN_DIR=.local/quantity/new-run \
bash ops/current-runtime-smoke.sh
```

[Performance](performance.md#expanded-quantity-measurements-p49) records exact CU,
wire and account counts. The numeric envelope is finite, not guaranteed liquidity;
source, margin, inventory, gross exposure, signed fee limits and search-work
exhaustion can reject smaller trades. Worker halving is a bounded operational
policy, not an exhaustive subfill feasibility proof. No new endurance, production,
external maker, paid oracle or public deployment acceptance is inferred. Owned
Surfpool and the test PostgreSQL container were stopped; raw evidence stays local.

The 10 November review correction `d63e3b1` stops order-size probing for a missing required
market source, while preserving smaller probes for allocation-dependent expiry,
depth/health and search-budget refusals. Seventeen focused worker/route tests and
typecheck pass: eight order-loop cases, five existing liquidity-worker cases,
one quantity schedule and three route-builder cases including different expiry
at different sizes. Queue/quote doubles establish control flow only; no new
Surfpool/PostgreSQL, SBF or financial acceptance is claimed for this early-stop
change. Existing exact integration pins above remain unchanged.
Scope/client/financial/shell hosted jobs pass on `d63e3b1` in
[run 42850851592](https://github.com/arnabnandikgp/rivalt/actions/runs/42850851592);
report is correctly skipped. P48/P49/P50 integrate at `28db412` with the complete
tree equal to accepted `953cd1f`. Merge equality is not a new runtime measurement.

## Exact quantity search (P48)

Clean verifier `5e5aede846c27bb1c352aa06c14a25ccfc6fe06c` replaces exhaustive
allocation with the interval proof in [routing](../liquidity/routing.md), retaining
4,096/4,608 program limits and the qualified C0 binaries. Independent Python
per-lot/exhaustive full-financial comparison passes 715 cases: 264 allocations,
379 unavailable and 72 invalid requests. Three hundred added cases cover complete
maker books, flat/generation boundaries and nonprefix health. Twenty-three focused
SDK/service tests pass, including interior VWAP bands, a net-proceeds fee-step tie
and exhausted search withholding an otherwise feasible singleton and instructions.
Typecheck passes. The initial test/benchmark failures asserted retired exhaustive
operation counts; their financial expectations passed and the resource assertions
now check bounded search work.

The unchanged four full-book benchmark workloads, 24 warmups / 1,000 iterations,
measure p95 0.302 ms / p99 0.355 ms on Apple M3 / Node 24.22.0. Maximum distinct
quantity quotes is 151, compositions and trader admissions one. This does not
establish a worst-case or larger-domain latency claim. The algorithm explicitly
refuses uncertified results on work-budget exhaustion.

`RIVALT_RUN_DIR=.local/quantity/p48-5e5aede-rpc bash ops/liquidity-execution-smoke.sh`
passes 130 real signed, independently fetched RPC/WS outcomes: current-price and
two-program routes, source/funding dependencies, stored partial fills and rejected
pause/replay cases with rollback. Raw evidence and the clean benchmark are local
under `.local/quantity/p48-5e5aede*`; the owned Surfpool was stopped. There is no new
program build, PostgreSQL run or larger-size acceptance in P48. P49 separately owns
expanded numeric bounds, new artifacts and integrated larger-size qualification.

A pass applies to its exact code, binaries, environment and population. The
consolidation stack integrates P35–P38 at `caa47d2`, with complete tree equal to
accepted `9d3e15f`. Merge verification introduces no new runtime-test claim.
The preceding baseline integrates P29–P34 at `b80bb38`, with complete tree equal to
reviewed `9e6dd07`; documentation closeout is `1f1a5aa`. P35 changes documentation,
not these program artifacts. P36 adds the separately scoped rebuilt-code evidence
below; P37's fresh integrated qualification after retirement is recorded separately.
[Original reports](../HISTORY.md) retain complete commands, failed attempts and pins.

## Anchor RC2 qualification (P47)

P47 local acceptance **passes**; P45–P47 integrated at `fb6c26b` with the complete
tree identical to accepted review tip `c637816`. [STATUS](../STATUS.md) records
integration separately from runtime evidence. Normal artifacts are selected only after the financial,
service and resource checks below. Unchanged C0 artifacts and clean verifiers
are recorded in the bounded
[coverage summary](../../tests/performance/baselines/p47-c0.json). Its **61/61**
entrypoints establish coverage; the distinct financial/service/load/default
constituents below supply their own acceptance. The inventory retains 2,520
executions / 2,493 originals / 27 byte-identical cross-run reexecutions, separating
rejections and operator/browser populations. Retained B stays immutable.

Clean `a01da5d` passes the 12-case focused RPC/WS profile; 123 maker and 84
publisher outcomes; 207 dependency/settlement and 63 retirement outcomes with
149/53-event PostgreSQL replays; 147/165/165 full protected/entry/stored-book
outcomes; and 712 complete-cohort outcomes. Independent arithmetic verifies 64
exact payouts (56 added members are flat), one augmentation and ten corruption
rejections. Eight separate wide-scratch compiled cases pass; they do not execute
payout history. P46's original 57 custody/290 safety/124 journal outcomes remain
separate constituents. All use C0 SBF `366c7ab`.

Clean **`b0b62ff`** completes the services/browser constituent with real
Surfpool/RPC/WS/PostgreSQL in `.local/anchor-rc2/p47-services-jsonb/`: **254 harness
outcomes, 468 durable originals (457 successful / 11 rejected), ten signed browser
actions**, three actual SIGKILL/lost-ack recoveries, stored-order execution,
publisher rotation/revocation, source outage/recovery and live indexer restart.
Fresh replay matches **187 events, 70 accounts/eight members**, zero unresolved
jobs. The independent `p33_services_reference.py` audit verifies **7,999,993 vault
atoms, 7,999,665 funded root cash, fees [267,61], insurance [66,15]**, flat inventory
and zero aggregate unpaid claims. Six makers are internal; hedge assumptions stay
labelled and no hedge was executed. Browser evidence uses installed Chrome and an
instrumented local wallet, not a new external-wallet compatibility claim.

Failed attempts remain local: missing Playwright cache; six browser actions then
an unsigned source-window refusal; and ten browser actions followed by the order
worker timeout. The last failure traced to JSONB key ordering in the readonly
projection comparison, reproduced from nine actual finalized custody events with
identical venue values. Structural comparison fixes that false rejection while
retaining complete field/array/revision guards; the new regression first fails
on old code and then rejects actual metadata changes. Twenty affected indexer
cases and typecheck pass; the clean integrated rerun above supplies runtime proof.

[Performance](performance.md#rc2-qualification-measurements-p47)
records the paired B/C observations, full financial state comparison and explicit
clock/digest mismatch limits. Fourteen affected measurement/provenance cases pass.
Raw wires/logs/database copies stay ignored. No unrelated full host suite, new
program build, funded/devnet deployment, external review or endurance is inferred.
Clean `1a893ed` adds fresh dispatch, load and operational constituents. Dispatch
passes pre-broadcast and post-send SIGKILL, actual expiry proof with seven durable
access rows and retained 20,000-lamport unknown-fee reserve, SQL ordering/fairness
cases and identical 61-event replay. The bounded load records 1,008 offers, 466
submitted originals, 433 fills, 33 stale-version rejections and 542 unsubmitted
(537 generator-inflight / five duplicate originals), zero expired/unresolved.
Live indexing obtains two coherent cycles and 33 revision-ahead retries; final
and fresh replay match 588 events / nine members / 9,000,000 vault atoms.
Operational workers pass liquidation, complete default with proposal-upload
SIGKILL/restart, six-second recovery and all funded account exits. Independent
arithmetic verifies ten exact Fraction payouts, one augmentation and five rejected
corruptions. Identical 192-event replay over ten members leaves **452 atoms** of
insurance/protocol fees only. Evidence is retained under
`.local/anchor-rc2/p47-{dispatch,load,operations}-1a893ed/`.
Clean `eac3755` compiles all three devnet-feature binaries without unsafe stack
diagnostics. All three reject valid-context initialization with full rollback;
maker contexts are explicitly injected negative fixtures because clearing cannot
initialize this profile. All three local/devnet feature combinations fail
compilation at the intended mutual-exclusion guard. No devnet network is used.
Evidence: `.local/anchor-rc2/devnet-gates-eac3755/`, reproduced with
`RIVALT_DEVNET_GATE_ARTIFACTS=<fresh-directory> bash ops/build-devnet-gates.sh`.
Fifteen affected local-demo configuration/process/transport tests pass. Twelve
resource-parser/receipt cases pass; absent heap requests and missing observed
heap/data metrics remain absent. The C0 and comparison summaries reproduce from
retained actual receipts; B still reproduces its unchanged 53,089-byte summary.

Normal launchers/builds select `.local/anchor-rc2/current`, preserving frozen B and
immutable C0. Its actual binary hashes must still match the SDK allowlist. The
artifact binding remains `p46-anchor-rc2-c0-candidate-v1` to preserve the qualified
journal identity; its historical name does not select arbitrary binaries.
The stack review found that runtime/continuation launchers checked only a
self-consistent manifest, while the SDK separately enforced the qualified hashes.
The shared `ops/verify-liquidity-artifacts.ts` preflight now enforces both account
schemas, clean qualification metadata, actual lengths and the fixed SDK hashes
before any normal/continuation/broad-smoke runtime starts. The default build uses
retained staging and validates before copying into `current`; explicit alternate
build outputs remain candidates, not admitted runtime artifacts. Standalone
hostile-maker smoke now selects `current` and applies the same preflight.
Fifteen focused file/manifest/launcher regressions pass, including self-consistent
forgeries rejected before runtime creation; eight existing deployed-code verifier
tests, typecheck, ABI and shell checks pass. The actual retained `current` and
immutable `c0-366c7ab` files pass the new gate. No program or IDL changed, and no
new performance, broad financial, load or endurance result is inferred.
At clean `c637816`, `bash ops/canonical-maker-smoke.sh` uses the default admitted
artifacts and passes 123 actual signed RPC/WS outcomes, 246 WS notifications and
independent fetch/dual decoding. Standalone `liquidity-hostile-svm.ts`, with no
artifact override, passes five hostile rollback cases across 114 signed VM
transactions. Raw evidence remains under
`.local/anchor-rc2/p47-review-{makers,hostile}-c637816/`; the owned Surfpool stops.
The first sandboxed RPC-launch attempt was refused before runtime creation; the
authorized local-network rerun supplies the stated pass. Scope/client/report/shell
CI pass on `c637816` in
[run 41386710747](https://github.com/arnabnandikgp/rivalt/actions/runs/41386710747).
Unchanged Rust financial CI is separately pinned to P46. No new SBF build or
PostgreSQL/service matrix was needed for the preflight/path/documentation changes.
All five review threads are resolved. P46's automated review was skipped for file
count; the bounded self-review of codec/loader/CPI/history adapters is not an
independent audit. Merge tree equality introduces no new runtime claim.
Clean `0591f10` initially caught confirmed provisioning advancing during the first
finalized indexer cycle. Startup now retries only typed `ReconciliationAhead` for
up to 30 seconds before producers start; all other errors remain fatal. Clean
`02f536c` then starts successfully and finalizes six wallet account/cash actions,
but its first unsigned trade refuses unavailable BTC sources. The normal launcher
had still shared one updater/payer across all producers. It now assigns six maker
and two publisher restricted keys through real signed provisioning, as qualified
services already did. Their fee payers no longer serialize all publication.
Neither failure is counted as completed demo acceptance; both remain local.

Fresh demo runtime and clean browser verifier **`083760a`** pass
**thirteen successful actual local-demo-wallet originals** in
`.local/anchor-rc2/p47-demo-browser-083760a/` (runtime/data retained in
`.local/anchor-rc2/p47-demo-083760a/`). Independently fetched finalized wires match
all wallet signatures, both margin modes, deposits/sibling allocation, BTC/ETH
trades, TP/SL cancellation, reduce-only closes, token-reconciled withdrawal and
saved-original/reconciled-fill reload. Actual wallet decline creates no original;
untrusted faucet origin and unauthorized stop reject. Page errors are zero.
The fixture follows the unchanged source contract: Normal for opens and credible
Normal/Degraded for reduce-only closes. It waits for real source recovery and
allows bounded explicit unsigned-source refusal retries. A proven finalized
version conflict or independently proven signed expiry may receive a new bounded
user review; its failed original/fee remains recorded. Ambiguous originals never
rebuild. The owned server and PostgreSQL are stopped, and all seven owned listeners
are released. No new external-wallet claim is made.

The complete demo denominator is **13 signed originals: 13 successful / 0 rejected**,
with **65,000 actual fee lamports**; every finalized receipt is retained. The full
interactive worker set targets four-second funding publication within the existing
2–5-second range, and one-second synthetic feed refresh. These local settings do
not replace the separate two-second service/load measurements.

Earlier demo attempts retained a proven signed expiry (landed slot 2,018 versus
expiry 1,956), an unaccepted MakerQuote 6115 refusal, source-recovery timeouts and
a worker PostgreSQL startup disconnect. Clean `ffceacd` also passed ten actions
before the fixture incorrectly demanded Normal for a reduce-only close with
credible Degraded prices; `083760a` corrects only that fixture condition. None of
these incomplete attempts is counted as a full pass or hidden by accepting more
financial error codes. The final lifecycle does not establish continuous
availability or eliminate those operating limits.

The paired resource report records observed route reductions of 40–44%, with
unchanged requested budgets and paid fees. Full books and 64-member continuation
fit; separate 5,632-bit scratch verification reaches 572,668 CU. Its 56 added default
members are flat and scratch cases never Apply. The bounded load's 433/1,008 fills,
all classified rejection/unsubmitted reasons, two coherent live index cycles /
33 revision-ahead retries and exact final replay remain limitations, not sustained
availability or TPS. P15B/P16B and continuous 24-hour endurance remain unchanged.

P47 is ready in [PR #66](https://github.com/arnabnandikgp/rivalt/pull/66) above #64.
Accepted/report content is `2b677b597912b2a3e9d7b02dab19088eca66ccc7`. All four
applicable hosted checks (scope/client/report/shell) pass in
[run 41296789385](https://github.com/arnabnandikgp/rivalt/actions/runs/41296789385),
including broad client regression, generated output, independent SDK pricing/
allocation and UI build. The unchanged Rust financial job is skipped; its P46
CI/source pins remain separate. Local B/C replay, ABI/evidence checks, four changed
shell scripts, typecheck and 312 documentation file links also pass. The stack
remains open; these results are not an independent review or an integration claim.

## Anchor RC2 serialized port (P46)

This section records P46’s scoped implementation acceptance; **P47’s complete
qualification and local promotion are recorded separately above**. D90 uses exact Anchor `2.0.0-rc.2`, isolated CLI/client installations,
platform-tools v1.52 and SBPF v0. The fresh clearing/account binding is 8, maker
account schema is 5, and quote/report protocol versions and financial rules remain
unchanged. Canonical identifiers replace the explicitly recorded historical IDs;
the immutable predecessor ABI guard checks fields, seeds, privileges and protocol
error codes. Default/devnet financial activation remains disabled.

Clean uninstrumented C0 SBF source is
**`366c7ab4f12c058fbff6538ededca26674ccf5bf`**. All default/qualification binaries
and oracle/hostile fixtures build without unsafe stack diagnostics. C0 binaries
and manifest are retained locally at `.local/anchor-rc2/c0-366c7ab/`; the normal
frozen B directory is untouched. Qualification binaries are 1,537,824 bytes for
clearing, 166,712 for each maker and 60,288 for the oracle fixture. These sizes do
not establish per-transaction CU savings; P47 owns the matched B/C report. C0
retains serialized owned accounts; no optional zero-copy C1 has been introduced.

Fresh RPC harness revision **`8feb24c81affcc98e655f3da7822ca46eaef835c`** is clean.
Commands use `RIVALT_ALLOW_RC2_CANDIDATE=1`, explicit
`RIVALT_ARTIFACT_DIR=.local/anchor-rc2/candidate` and distinct new run directories:

| Scoped gate | Actual result | Local evidence below `.local/anchor-rc2/` |
|---|---|---|
| `ops/account-custody-smoke.sh` | 57 signed/finalized RPC/WS outcomes; raw-byte conservation verifies zero remaining trader cash, 18 reserve/vault atoms and 1,999,982 returned token atoms; eight corruptions rejected | `custody-8feb24c/` |
| `ops/liquidity-safety-smoke.sh` | 290 signed/finalized outcomes, including two-maker cross routes, funding, TP/SL, reserved withdrawals/transfers, strict post-fee liquidation progress, complete eight-member default, exact atom ownership, exits and sustained recovery | `safety-8feb24c/` |
| Independent Fraction/raw safety audit | Eight exact payouts, two augmentations and ten corruptions rejected; tokens/claims/cash/reserves reconcile. Both isolated Anchor clients agree on 560 instructions, two accounts and 787 events | Same safety run |
| `ops/liquidity-journal-smoke.sh` | 124 harness outcomes; real PostgreSQL 18.6 records 121 in-scope transactions, five failures, 74 events/outbox rows and zero unresolved jobs. Actual SQL failure rolls back; restart recovers a missed fill; fresh database replay is identical; fees/carry reconcile to 26 charged atoms | `journal-8feb24c/` |
| Retained safety projection | 244 authenticated invocations and 23 failed transactions; 68 captured entities match at all five liquidation/default/recovery checkpoints. One portfolio body is explicitly uncaptured; this is not another RPC/SQL run | `safety-8feb24c/scoped-projection.json` |

Compiled C0 checks also pass: maker lifecycle **123** cases/**16** exact rejections;
three default initialization gates with rollback; five hostile-maker rejection
cases across 114 signed VM transactions. Hostile testing first rejects an unapproved
binary, then deliberately replaces only its admission hash to test CPI isolation;
this is not an authorized-upgrade or RPC-landing claim. Independent pricing checks
execute each actual maker binary against **3,172** vectors (1,547 exact quotes,
1,625 expected rejections) per program; inserted pricing fixtures do not claim
reachable cash state. Logs are under `.local/anchor-v2-build/`.

Earlier port checks on source `10b4d98` passed 119 clearing and 12 maker-interface
native tests, including bounded registry and foreign-loader negatives. Actual
source-generated IDLs, SDK generation, ABI guard and scoped dual-client conformance
pass. Affected client reruns pass 45/45 after stale-schema fixture corrections;
the other 200 checks passed in the preceding run. Typecheck passes after the CPI
and harness fixes. Broad hosted regression has not yet been observed.

Retained failed attempts are explicit: the first RPC attempt rejected the old
artifact allowlist; the next reached signed provisioning but failed its first
deposit with `AccountBorrowFailed`. RC2 boxed native accounts needed the forwarding
`ToCpiHandle` traits rather than the generic `AnchorAccount` method. The fresh pass
above verifies the fix without bypassing borrow guardrails. Framework failures
now use their exact RC2 named errors; protocol custom codes remain unchanged.

At the P46 checkpoint, P47 still owed full entrypoint/scenario coverage, full-book/64-member width gates,
operator/browser/fault/load qualification, complete operational replay and a
matched B/C resource/fee report. P46's scoped results do not satisfy those gates.
No devnet, external participant, funded deployment, C1 optimization or continuous
24-hour run is claimed. P15B/P16B remain open and endurance remains deferred.

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

### Relevant-market acceptance (P41)

Schema 6 preserves account layouts/seeds while optional canonical market contexts
and four explicit partial payloads remove unrelated source/funding dependencies.
The D86 ABI delta is checked against immutable P40B `d55ab82`. Independent omitted
one-scaled-unit claims, live orders and receiver dependencies reject; absent empty
slots retain their checkpoint/generation and reservation observations.

Clean SBF **`b0c5675f9e511c1d46a6538d22ced16241d6a4f8`** builds default/qualified
programs, IDLs and generated SDK. Clearing is 2,472,208 bytes; SHA-256
`03c475ba72dcc77244ed32b2fc3c79c9ffe58ac0ae0ca90cb06e96d313d11e03`.
The first order handler exceeded the 4 KiB frame by 240 bytes; borrowing typed
markets removes duplicate snapshots. No heap/CU limit or admission check changes.
All three compiled default initialization gates reject. Native coverage comprises
112 passing clearing cases followed by eight affected trading cases including the
new independent negative-prefix/expiry vector; these counts overlap.

- Clean verifier **`ca8bab092ae6bc17b0ba982181a4a8c58f4df3f9`**: 167 actual RPC/WS
  outcomes, 161 successes/six expected rejections; both isolated markets, coupled
  cross roots, transfers/exits, orders/protection, negative funding, actual hold
  expiry/revocation, complete backing, gain payment and explicit flat netting.
  Ten omission cases check signed-message/footer absence and unchanged market bytes.
  Fresh PostgreSQL replay matches all 115 events and reconciles 73 accounts/nine
  members. Literal cash 7,998,935 + pools 999/4 + insurance 9/5 + retained fees
  30/15 equals actual/allocated vault 7,999,997 atoms; fee carries are 3/0.
  Exact quantity and checkpoint-adjusted claim identities pass in both markets.
  Anchor independently checks 148 clearing encodings/257 events plus both makers.
- Clean safety verifier **`078057ae4f0581dfed0228dd098f442d18c99093`**, same SBF:
  290 signed outcomes, 267 successes/23 expected rejections, TP/SL/reservations,
  strict post-fee liquidation, complete eight-root default, cash exit and recovery.
  Independent raw-byte Fraction audit verifies eight payouts and ten corruptions.
  Anchor checks 266 clearing encodings, two account codecs and 487 events plus
  makers. Offline projection matches five raw-body boundaries, with one explicitly
  uncaptured portfolio; it is not additional live SQL/block-fence evidence.

Maximum observed CU is 276,058 in the dependency probe and 480,324 in safety;
these are scoped observations, not P44 full-path bounds or validator throughput.
The first claim probe landed all effects then found a revision-less certificate
payload projection error. The corrected reader binds it to the authenticated
footer; 13 affected projection cases pass, followed by the fresh successful probe.
Current typecheck, generation, source coverage, explicit ABI and inventory checks
pass. The legacy payload itself and on-chain settlement logic were unchanged by
that repair.

Raw records remain under `.local/liquidity-execution/runs/p41-claims-revision/`,
`p41-safety/` and retained failed/earlier attempts; build/check logs use `.local/p41-*`.
Owned RPC/WS/PostgreSQL processes stop after each run. Broader browser, services,
full-cohort resources and endurance are not rerun for this phase; P44 owns final
integration and full profiling. Custody/ledger coupling and continuous-activity
certificate progress remain P42. External/funded gates are unchanged.

## Custody isolation acceptance (P42)

D87's schema-7 implementation is qualified for its scoped local acceptance only.
Clean SBF source **`6aeb7d0cf645fca889a9e3154ac01a129a72a6a8`** builds qualified and
still-disabled default programs without oversized frames. Qualified clearing is
2,482,344 bytes, SHA-256
`d9c83864f5d3b0c5e7dcfa0100486335b1c96c583b62f9c68054318cf3169bcb`.
The explicit D87 ABI delta against immutable P41, generated SDK, eleven ABI guard
regressions, 53-entrypoint/43-context scope coverage and all three compiled default
gates pass. Current static inventory covers 61 entrypoints and 20 custody writers.
All 114 native clearing cases pass on final source. Seventy-one affected client,
projection and Anchor cases pass; four dependency-builder cases overlap three of
those, and one additional worker case verifies atomic final-page/payment enqueue.
The separate custody conformance case passes eleven current instruction/meta
comparisons against isolated Anchor; its obsolete context-name fixture is updated.

| Clean verifier / local run | Actual acceptance |
|---|---|
| `569ed3e` / `p42-custody-distinct/` | 207 RPC/WS outcomes: 196 successes, 11 expected rejections; ten market omission cases, cross funding/claims, exact fractions/netting and atomic certificate/payment with later-instruction rollback. Fresh PostgreSQL replay matches 149 events; 75 accounts/ten members reconcile allocated/actual V=8,099,997 atoms |
| `569ed3e` / `p42-safety/` | 290 outcomes: 267 successes, 23 expected rejections; TP/SL, reservations, strict post-fee liquidation, complete eight-root default, stale-source resolved cash exit and recovery/reactivation. Independent raw-byte Fraction audit verifies eight payouts and rejects ten corruptions |
| `6fbc5d6` / `p42-journal-treasury/` | 124 signed outcomes, five expected rejections; selected-market T→I allocation and actual fee exit retain authority and exact carry. Real SQL write rollback, shutdown/RPC backfill, failed-effect exclusion and identical 74-event fresh replay; 121 clearing-discovered transactions, zero unresolved |
| `6fbc5d6` / `p42-retirement/` | 63 outcomes, seven expected rejections; nested CPI/second-call rollback, two same-slot batches, pause-bound complete-member retirement, cash exit, wrong reserve authority/destination rejection and actual 11-atom selected reserve exit. Fresh 53-event SQL replay; 32 accounts/six members, actual/allocated V=5,999,999 |
| `72e2d18` / `p42-custody-alias/` | 57 signed gateway outcomes, 25 committed custody events, independent SPL/root/pool identities and eight rejected raw-state corruptions. Isolated legacy Anchor account/event parity passes |

All run directories above are under `.local/liquidity-execution/runs/`; logs remain
`.local/p42-*`. Each run uses the same hash-verified SBF source. Safety's separate
retained-receipt projection matches five lifecycle boundaries/68 entities with one
explicitly uncaptured portfolio; this is not additional live SQL/block-fence evidence.

Actual distinct-owner/payer BTC/ETH trades have no protocol **or complete-message**
W/W or W/R overlap. Same-market exact fee/exposure ordering and genuinely cross
roots still couple dependencies. Internal routes preserve custody/vault bytes.
Atomic final-page/payment is **118,337 CU, 604 bytes**, including a beneficiary
promoted writable by the later instruction. A later failed instruction rolls back
both proof and payout. The worker queues both as one immutable original.

Certificate progress has an explicit residual: **four constructed attempts** include
three deliberately interleaved new source observations, all correctly rejected,
and one coordinated-window completion. This is not normal offered availability,
a trading load rate or proof of progress under unbounded sampling. Earlier scan
pages still require stable relevant observations/liabilities; no stale payment or
oracle relaxation is introduced. Funded own-cash withdrawal needs no certificate.

Maximum observed CU is 274,817 in the dependency run and 479,015 in safety; treasury
allocation/fee exit are 17,282/30,465 CU, retired reserve exit 33,493 CU. These are
scoped observations, not P44 full-path bounds or validator TPS. The first dependency
fixture correctly hit self-trade prohibition; a third independently funded owner
fixes that fixture. The gateway's old seed-error expectation was corrected to
Anchor's earlier duplicate-writable rejection (2040). Failed receipts remain local;
no admission rule changed to obtain a pass.

No broad unrelated, browser, full-cohort resource or endurance suite is rerun for
P42. CI owns broad regression; P43/P44 own targeted optimization and fresh complete
qualification. Default/devnet and external/funded gates remain unchanged.

## Targeted CU acceptance (P43)

The optimization consolidates checked whole-account accrual/admission and reuses an
unchanged book-binding model. It preserves input/output/position bounds, per-market
IM rounding, reservations, funding and negative-claim admission. No positive unpaid
credit, changed code trust, ABI/layout, risk setting or compiler migration is added.

Clean uninstrumented SBF source **`fb5d0c546a417796ce615e0d3d3575545c96c178`** builds
qualified/default programs without oversized frames. Clearing is 2,484,144 bytes,
SHA-256 `a9a8f59e5e5fa93c4657ed25313f99199827d1e1ecf56e2f8b8ebb2caa6305f4`;
its size increases by 1,800 bytes. Maker and oracle hashes remain exactly P42's.
Regenerated IDL/SDK and the explicit wire contract are unchanged. All three compiled
default gates still reject valid initialization with rollback.

Clean before harness **`1c9c931`** / P42 SBF `6aeb7d0` and after harness
**`1e86661`** / P43 SBF `fb5d0c5` each pass 117 actual setup outcomes and twelve
focused signed RPC/WS cases. Receipt/wire verification and legacy Anchor parity
pass. Workload, Surfpool 1.7.0 runtime/features, IDL hashes, message shapes, requested
CU, fees and seven lock comparisons match. Each run independently checks every
root's lot/claim conservation, exact fee/insurance carry and actual token-vault
backing. The cross-run summary comparator matches fee totals, aggregate root cash
and root count; it does not compare individual root positions or vault bytes.
The bounded [before](../../tests/performance/baselines/p43-before.json) and
[after](../../tests/performance/baselines/p43-after.json) summaries are reproducible
with `tests/performance/summarize.ts` and `tests/performance/compare.ts`.

| Named state | Before CU | After CU | Reduction |
|---|---:|---:|---:|
| BTC single maker | 257,045 | 256,160 | 885 |
| ETH single maker, same cross root after BTC | 274,817 | 273,918 | 899 |
| Isolated BTC single maker | 265,335 | 264,666 | 669 |
| Two makers, same program | 352,022 | 350,792 | 1,230 |
| Two makers, distinct programs | 479,272 | 478,042 | 1,230 |
| Place / cancel order | 46,968 / 39,203 | 46,352 / 38,925 | 616 / 278 |

These are **small savings, one observation per named state**, not statistical or
worst-case improvements. Repricing stays 18,250 CU and stale-account rejection
33,313 CU. The two report observations each increase by one CU. Observed fees stay
10,000 lamports with two signatures and zero priority bid; requested limits are
unchanged, so no actual lamport saving is claimed.

Diagnostic source **`132e086`** also passes that workload in an isolated artifact.
Five authenticated trade receipts attribute about 131k CU to each distinct full
maker-code hash, about 20k to the singleton financial candidate and 18k to maker CPI.
The [attribution](../../tests/performance/baselines/p43-attribution.json) includes
marker/compiler overhead and nested overlapping intervals; it is not headline CU.
Two broader compiler-size experiments produced oversized frames and were rejected
without deployment or SDK pinning. The full-code check and original compiler flags
remain. Trace code is absent from ordinary builds; accepted artifacts are preserved.

On clean verifier **`1e86661`**, the same uninstrumented source additionally passes:

- 147 full protected-book RPC/WS outcomes and 165 full entry/stored-book outcomes,
  each including six expected rejections. Three full books, two protections per
  root where applicable, eight regions, 4,608-lot aggregate routes, 4,096-lot single
  routes, skew crossing, unfunded-provider rollback and structural invalidation
  retain independent per-lot gross/fee/claim checks. Maximum observations are
  504,141 CU/1,196 bytes/v1 and 503,938 CU/1,099 bytes/v0 respectively. These cases
  deliberately retain broad canonical market dependencies; they are conservative
  resource cases, not minimum-packet production-router measurements.
- 290 safety outcomes, 267 successes/23 expected rejections: full reservations,
  post-fee liquidation, complete eight-root default, stale-source cash exit and
  recovery/reactivation. The raw-byte Fraction audit verifies all eight payouts,
  two augmentations and ten corruption rejections. Maximum observed CU is 477,798.
  Retained-receipt projection matches five boundaries/68 entities, with one
  explicitly uncaptured portfolio; this is not new SQL/block-fence evidence.
- 38 affected financial-core cases, including 108 independently calculated
  admission/accrual combinations and invalid-bound cases, plus all 114 clearing
  native cases. Typecheck, generation/ABI, bounded evidence and documentation checks
  pass. No broader unrelated client/browser/endurance suite is rerun locally.

Raw receipts stay in `.local/liquidity-execution/runs/p43-{before,trace,after,safety,resources,resources-stored}/`;
logs use `.local/p43-*`. All owned listeners stop after each run. SQL, service faults,
complete entrypoint/variant coverage, latency/cost scenarios and full frozen
qualification remain P44; inherited P42 or P16A results do not claim them complete.
P15B/P16B, default/devnet gates and deferred endurance are unchanged.

## Frozen pre-migration qualification (P44)

This qualification reuses the **same uninstrumented programs** built from clean
`fb5d0c546a417796ce615e0d3d3575545c96c178`; no P44 program or IDL change occurs.
Clearing is 2,484,144 bytes, SHA-256
`a9a8f59e5e5fa93c4657ed25313f99199827d1e1ecf56e2f8b8ebb2caa6305f4`.
The bounded [B baseline](../../tests/performance/baselines/p44-pre-v2.json) pins
all four hashes/sizes, current IDL hashes, exact clean verifier commits, retained
summary hashes and per-entrypoint successful/reverted CU and transaction ranges.
The P43 focused, full-book and safety constituents already use these exact binaries;
they are included once, not represented as fresh P44 reruns. P39 remains immutable.

Build pins are Anchor 1.2.1, host Rust 1.97.1, platform-tools 1.52 / SBF Rust 1.89.0
(dev), SBPF v0 with the locked build script and no CU instrumentation. Runtime pins
are Surfpool 1.7.0, Solana core 4.3.2 / features 3383571666, Agave CLI 4.1.2,
Node 24.22.0, pnpm 10.23.0, web3.js 3.1.1, Kit 8.5.0 and PostgreSQL 18.6.
Legacy Anchor conformance remains isolated on Anchor 1.2.1 / web3.js 1.99.0.
Wide/hostile VM checks use LiteSVM 1.6.1 and are not RPC landing evidence.
The hostile fixture first rejects an unapproved replacement, then fault-injects
only its approval hash to test the admitted malicious CPI boundary.

| Constituent | Clean verifier; local run directory | Verified outcome |
|---|---|---|
| Maker lifecycle | `f9d29f6`; `p44-makers/` | 123 actual signed RPC/WS outcomes; both programs, eight regions, controls, revoke/approve and legacy Anchor parity |
| Complete 64-member default | `cbc132b`; `p44-complete-cohort/` | 712 signed outcomes / 11 expected rejections; actual source-emergency deadline, all stages, exit, 64 exact independent Fraction payouts and ten rejected corruptions |
| Dependency/claim/certificate | `f3b73c2`; `p44-market-dependencies/` | 207 outcomes / 11 rejections, ten omitted-market cases, negative funding/revocation, atomic page/payment rollback; 149-event fresh PG replay, 8,099,997 vault atoms |
| SQL journal and treasury | `f3b73c2`; `p44-journal/` | 124 outcomes / five rejections; SQL rollback, shutdown/backfill, failed-event exclusion and immutable identity; identical 74-event fresh PG replay |
| Custody | `9470101`; `p44-custody-pinned/` | 57 signed scenarios, 25 committed events, actual selected-artifact provenance, independent raw-byte conservation/eight rejected corruptions and Anchor parity |
| Retirement/reserve exit | `9470101`; `p44-retirement/` | 63 outcomes / seven rejections, same-slot/nested-CPI ordering, terminal reserve withdrawal; identical 53-event fresh PG replay, 5,999,999 vault atoms |
| Current load / parallel indexing | `8b8c33f`; `p44-load-final/` | 1,008 offers, 465 unique signed outcomes, 430 fills, 2 live coherent cycles / 33 revision-ahead retries; exact independent root/fee/claim audit and identical 585-event fresh PG replay |
| Initial direct offered load | `7e8d042`; `p44-load-first/` | 752 offers, 401 signed outcomes, 377 economic successes; exact per-root replay and identical 524-event fresh PG replay, 9,000,000 vault atoms |
| Dispatch / SQL ordering | `f4490e9`; `p44-dispatch-fair/` | Two lanes, duplicate executors, shared-payer deferral, immutable oldest-waiter ordering, version-1 drain gate, real lost-ack/SIGKILL, expiry; identical 61-event fresh PG replay |
| Review: admission crash window | `da99664`; `p44-review-dispatch/` | 106 harness outcomes, eight durable originals; real SIGKILL immediately after admission, restart after actual expiry, retained 20,000-lamport unknown-fee reserve, post-send recovery and identical 61-event fresh PG replay |
| Services and independent economics | `a5afbc9`; `p44-services-parallel-history/` | 188 harness outcomes, 239 durable originals (236 success / three report rejections), all three actual SIGKILL recoveries, stored-order fill, rotation/revocation/budget handover, source outage/recovery and live indexer restart; identical 137-event fresh PG replay, 7,999,993 vault atoms |
| Compiled hostile maker | `1cc2d6a`; `.local/liquidity-execution/hostile-svm.json` | Five rejected replacement/malicious-CPI cases with complete rollback across 114 signed VM transactions; all financial state provisioned by real instructions |
| Current browser | `f4490e9`; `p44-services-fair/` | Ten finalized internal-wallet actions, BTC/ETH and both account modes, TP/SL/cancel, saved-receipt reload, direct withdrawal/deposit while both APIs blocked |

Run directories above are under `.local/liquidity-execution/runs/`. Browser
acceptance is bounded to its saved receipts and `browser-summary.json`; that run
later fails unsigned order preparation and is **not** a complete service pass.
The dispatch probe's one proven-unexecuted expired original retains its actual
20,000-lamport unknown-fee reservation; it is not classified as fee-free.

Review qualification at clean `da9966401027a6cb92893db29251a2c696ae0fce`
also verifies the finalized-valid witness is committed with successful admission,
before the first status response or broadcast. SIGKILL leaves witness slot 1522,
seven access rows and zero attempts durable. Restart after real expiry proves
unchanged economic authority at slot 1644 and releases access, retaining the
unknown fee. The second process fault recovers the exact landed cash-exit original;
fresh replay matches eight members/70 accounts and 7,999,993 vault atoms. Nineteen
focused service tests and typecheck pass; all four applicable hosted jobs pass in
[run 41280117782](https://github.com/arnabnandikgp/rivalt/actions/runs/41280117782).
This requalifies the changed queue boundary only: no SBF rebuild or repeat of the
unaffected load, browser, default or endurance populations. Frozen B data remains
at its original pins. Integration `6b14e8a` has the exact tested stack tree.

The separate width fixture at clean `f3b73c2`, `.local/p44-width-probe/`, verifies
eight compiled cases on a copy of the captured full 64-row context: 2,796/5,632-bit
common denominators, 186-bit rate factors and mixed signs. Maximum Verify/FlowPlan
costs are 782,453/749,225 CU, 681-byte v0, requested 1.2m CU with at least 20%
headroom. Only arithmetic scratch is constructed; no Apply/payout occurs and the
original capture is unchanged. The actual 64-member lifecycle peaks at 364,614 CU;
its 56 added roots are flat and receive real one-atom deposits. These complementary
checks do not prove arbitrary maximum-width claims arise in a funded lifecycle.

Independent service-only replay verifies all eight roots, literal BTC fees 25
atoms (six insurance / nineteen protocol), cash 7,999,968 and vault 7,999,993;
all positions finish flat and aggregate unpaid claims sum to zero. Six internal
maker reports retain zero funded trading P&L and explicitly unobserved hedges.
All 55 stored funding inputs are retained; 53 available reports match independent
flat-curve arithmetic. Three actual failed originals reject with `FundingReport`
6131 and each pays 5,000 lamports; none is omitted from operator costs.

D88 fixes premature blockhash-expiry inference; its finalized-valid witness is
persisted even while dispatch defers. D89 prevents newer conflicting originals
starving an older committed waiter. Neither releases active/ambiguous locks nor
relaxes source, price, epoch, margin or fee-reservation checks. Qualification also
separates six maker and two publisher fee payers using existing restricted
permissions. The browser's public Vite configuration now forwards mandatory
`accountSchema`; its fixture builds current source and checks actual HTTP fields.

Retained failed attempts distinguish the causes: new-hash false expiry; deferred
witness missed behind a shared payer; live finalized reconciliation ahead of
journal; shared publisher payer starvation; absent bundled browser; stale ignored
UI build; omitted public schema; and newer jobs overtaking a wallet trade. The
corrected custody run supersedes an earlier financial pass whose report pointed
to an obsolete artifact. The first `2281869` service attempt times out during
setup with a recorded roughly twelve-minute runtime/finality stall; no application
recovery result follows from that interrupted attempt. Its subsequent complete-
setup attempt passes economic/worker faults but times out during live indexer
restart. Bounded eight-block body/manifest reads fix that observed catch-up case
at `a5afbc9`, preserving canonical ordering, drain-on-failure and every history/
revision/financial check. Fourteen affected indexer tests and typecheck pass.

For reproduction, use the scoped `ops/current-runtime-smoke.sh` probes with explicit
fresh run directories, RPC/WS ports and PostgreSQL port. `services` needs real PG;
set `RIVALT_CHROME_PATH` to installed Chrome. `RIVALT_SERVICE_BROWSER=0` deliberately
omits already separately accepted browser actions and cannot claim a new browser
pass. `complete-cohort`, `market-dependencies`, `journal`, `performance-load` and
`dispatch` each preserve actual originals and independent financial checkpoints.
`node --import tsx tests/performance/full-baseline.ts --replay` reproduces the frozen
bounded inventory from the retained exact receipts and signed wires. Raw evidence
remains ignored/local; the baseline is not a portable archive of those receipts.

[Performance](performance.md) owns the complete actor/CU/scaling table, offered-load
denominators, fee assumptions and residual constraints. Initial load indexing obtains
one coherent cycle and 27 revision-ahead retries; the scoped current rerun records
2 coherent cycles and 33 revision-ahead retries. Both complete exact
post-stop replay; neither proves sustained read-API readiness or validator TPS. Loaded-data bytes absent
from RPC remain unknown. P15B/P16B and deferred endurance are unchanged. No new
program build, unrelated native regression, external wallet, devnet, 24-hour run,
funded deployment or Anchor v2 migration is claimed by P44; broad regression runs
in scoped hosted CI after publication.

Frozen inventory reproduces **61/61 successful public entrypoints** over
**2,871** distinct harness originals (2,721 success / 150 reverted).
Operator/browser originals and VM cases are separate evidence populations and are
not silently added to that count. Thirty-one focused queue/receipt/cost tests,
fourteen indexer tests and two independent replay-auditor regressions pass.

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
