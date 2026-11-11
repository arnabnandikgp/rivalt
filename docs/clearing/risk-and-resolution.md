# Risk, orders and complete resolution

## Scalable exact resolution candidate (P51B)

This section specifies the selected **native successor kernel**, not the
implemented schema-8 default path documented below. P54B now qualifies authenticated
bounded SBF valuation/rate continuations. P54C still owns conserving rounding and
application; P56B owns expanded local activation. See the
[account contract](accounts.md#account-scale-successor-contract-p51b) for membership,
authority and deployment. No payer, keeper or off-chain solver becomes trusted.

### Exact arithmetic and work representation

Retain own whole-cash collection, proportional market allocation, greatest recovery
rates, each market's insurance priority/clipping, fractional ownership and the
existing deterministic circulation's atom owners. The changes are representations
and search schedules, not a different payout rule:

1. Reduce each double-debt collection's denominator **exactly**, then use their
   LCM instead of blindly multiplying every total debt. For scaled debts a,b and
   own collection k, the necessary divisor is `(a+b)/gcd(a+b,k*S*a)`; the second
   collection has the same denominator because their sum is integer k*S.
   Computing LCM requires a wide remainder/division by a <=88-bit divisor and
   small Euclid, not an unbounded wide-by-wide gcd. Euclid can be bounded by 176
   small iterations; wide scans have persisted limb cursors.
2. Off chain, construct each continuous nondecreasing piecewise-affine market
   response using sorted link thresholds and coefficient prefixes. Compose
   `F0(F1(r0))` with a monotone interval merge. Every boundary is crossed at most
   once; solve exact affine equalities, including identity intervals at their
   greatest endpoint. This replaces Cartesian branch enumeration. On chain still
   verify every original equation and the greatest-solution right-slope condition.
3. Store frozen scalar rows and three **whole-flow floors/flags**, not two wide
   numerators for every root. Shared paged registers reconstruct exact flows and
   remainders when needed. An untrusted proposer supplies market remainder order;
   verify a complete permutation and every adjacent ordering/tie before rounding.
   Local root edge order is checked too. Stable member ID breaks ties as before.
4. Preserve the existing residual DFS, but skip zero-capacity arcs with ordered
   active-bit summaries. Skipping an unavailable arc cannot change the first
   reachable path. Updates include both forward and reverse arcs; reverse repair
   paths remain essential. A paged bit hierarchy must find the next active index
   with bounded work; a large Python bit operation is not its SBF implementation.

The [candidate](../../tests/financial/scalable_clearing_candidate.py) implements
both dense and compact schedules. P54A's compiled native kernel compares the <=64
domain with the independent Fraction/branch oracle and larger populations with
the streaming candidate and literal financial invariants. The compact schedule stores O(N+B)
scalar/limb words rather than O(N*B) wide row values, where B is the exact common
width. Recomputing/sorting does extra arithmetic. On-chain adjacent verification
needs linear comparisons after the untrusted off-chain sort, but storage reduction
does **not** make all arithmetic linear in population: adversarial B grows with N.

For `b=87+ceil(log2(max(N,1)))`, positive/linked totals are below 2^b and a rate
factor below 2^(2b) suffices. Conservative scheduled width is `88*N+4*b+16` bits,
rounded up to limbs, before checked allocation/index bounds. This is an upper
bound, not a promise that the reduced LCM stays small. Later price, funding or
claim-domain changes must rederive K and this bound. Retain factored writeoff
records; never expand arbitrary products into ordinary margin state. Whole-flow
quotients retain the existing <2^58 bound; exact flow rounding remains <one atom.

### Compiled native kernel and work bounds (P54A)

`financial-core::clearing::scalable::wide` supplies the first compiled successor
primitives. Logical registers implement `LimbStorage`; `Cursor::step` performs
one bounded addition/subtraction/product/division word step with no allocation.
Inputs and output cannot alias. Width comes from the count-derived proof above;
allocation/physical-storage failure remains an explicit error, not a partial plan.
Small factors are <2^302 (five limbs), divisors are nonzero and <2^88. Division
processes two half-words per step, preserving the exact remainder with u128.

For width W, add/subtract/divide finish in W steps; multiplication by k limbs
finishes in W*(k+1), including output clearing. A step accesses at most three
storage words. Completed cursors reject another step. On any arithmetic/storage
error, discard scratch changes; an eventual program adapter must persist cursor
and page changes in one atomic invocation. Register identifiers are private work
addresses, never signer or account authority. Native tests use vector storage;
this does not claim that all words fit a Solana heap or one account.

`scalable::collection::ReducedCollection` cancels bounded factors before computing
own-cash proportional numerators; the intermediate product can exceed u128 and is
kept in three exact limbs. Both markets share the same reduced denominator.
`scalable::denominator::LcmCursor` computes exact LCM extensions by small remainder,
bounded gcd, exact division and multiplication. It scans the **used** common width,
not every word of the population-derived maximum. Input length is canonical and
nonzero; two scratch high words are cleared before widening. For W used words,
an extension needs at most 5*W+11 steps, each touching at most three storage words;
the one small gcd is bounded to 176 scalar iterations. This is an algorithmic work
bound, not measured SBF CU. Output remains unusable on any failure.

`scalable::number` drives those word operations with normalized native registers.
Whole-atom division uses a normalized two-word numerator / one-word divisor
estimate, at most two downward corrections, then full exact product/remainder
checks. Its quotient remains strictly below 2^58. This replaces a 58-pass search
without floating-point approximation or relaxed precision. Comparison, register
initialization/normalization and orchestration must also acquire persisted cursors
in P54B; the vector-backed native runner is deliberately excluded from SBF builds.

`scalable::settlement::verify` checks every bounded row, allocated cash including
both markets' insurance/fees and complete per-market claim conservation. Positive
and negative totals can exceed u128; count-derived aggregates need at most 151
bits and slope products at most 302. It recomputes the reduced common LCM, each
flow, the original two min equations and greatestness at the exact proposed rates.
Each rate factor is positive and bounded by 2b bits. An absent positive population
requires rate one. If neither rate is one, the product of strict right slopes must
be below the product of positive claims; an interior point of an identity interval
rejects. Supplying a fixed point alone is insufficient.

Insurance starts from the frozen reserves. A fractional usage clips that market's
next budget to its exact floor; each market can clip only once. At most three
verified proposals are accepted, with no omitted or extra evaluations. A caller
cannot supply a lower starting budget. The verified plan owns only scalar flow
floors/fraction flags per root. Reconstructed rows supply own collections, claim
flows, cash entitlement and creditor impairment. Debtor writeoffs remain factored
as `row_residual * market_loss / market_residual / D`; no wide-by-wide product is
stored in an ordinary root. Exact market loss equals creditor impairment, and
remaining insurance and retained fees reconcile with final cash and original V.

`scalable::rounding` accepts only a constructed verified plan. It checks each
market's complete frozen-row permutation and every adjacent positive-claim remainder/tie;
root-local outgoing order is independently derived. It constructs the canonical
graph itself. Three scalar floors/flags per root replace retained wide flow arrays.
`scalable::active` supplies an ordered hierarchy over contiguous adjacency ranges.
Successor search reads at most 21 words and capacity changes update at most eleven
levels for u64-addressable storage, including reverse arcs. No giant integer bitset
or unavailable-arc scan is used. Generation marks avoid resetting every node after
an augmentation while preserving the exact DFS path/ties.

One rounding continuation advances one DFS transition, one minimum/apply path
edge, or one audit item. Each original edge is floor or ceil of its exact value;
the terminal audit checks every node and auxiliary capacity before exposing a
result. Results remain unavailable at every unfinished prefix; a completed graph
rejects replay. Rust borrowing binds results to the exact frozen verified plan.
Native row ordinals follow ascending stable member identity; omitted identities
or a reordered freeze cannot be excused by reassigning ordinals. P54B must authenticate
that mapping. This native binding is not a substitute for authenticated program pages.

Finite bounds, with N roots and W count-derived register capacity:

- At most `8*N+6` residual arcs and `N+5` nodes; indices/capacities and allocations
  reject unrepresentable sizes. Required remainder flow is at most `3*N` atoms,
  so there are at most `3*N` augmentations. Each augmentation visits each outgoing
  slot at most once and has at most `N+4` path edges. A conservative total is
  `3*N*(11*N+32) + 4*N+5` graph steps, plus bounded hierarchy word work.
- Verification/floors/order use a constant number of complete row passes. No
  Cartesian branch enumeration occurs in verification. Each row has at most two
  collection/link terms and three floor/remainder terms; multiplying factors has
  at most five columns. `2048*(N+1)*(W+16)` bounds arithmetic and comparison word
  work conservatively, including three insurance evaluations and row attribution.
  Native allocation, normalization/copying and input parsing are separate CPU work;
  each is also linear in its value or population, never a fixed-cost CU claim.
- Storage is O(N+W). On the qualified 64-bit native host, `512*N+512*W+4096` bytes
  conservatively bounds scalar/register payload, excluding allocator metadata,
  transport text and native test snapshots. It is **not** a Solana account/rent
  measurement. Sorted proposals retain IDs, never N wide remainder numerators.

The independent branch/Fraction oracle tests exact cash, collections, insurance,
writeoffs and atom ownership against the compiled kernel. Larger diagnostics
separately compare the selected streaming model and literal repeated-fraction
invariants. Native completion does not establish SBF affordability: distinct
denominators still give O(N*W) work and adversarial W grows with N. See
[validation](../operations/validation.md#scalable-native-settlement-p54a) for exact
pins, actual counts and omissions. Neither native driver is a program instruction.
No account/PDA layout, selected artifact, enabled account count or default path
changes. P54B/P54C own authentication, physical paging, replay/recovery, actual
signed continuation costs and token effects before P56B can activate any expansion.

### Authenticated paged verification (P54B)

The word, LCM and comparison cursors now have explicit internal checkpoint format
**1**, distinct from the reserved account schema 9 and current price policy 2.
Encodings use little-endian integers and zero reserved/unused opcode bytes:

| Cursor | Bytes | Encoded state / structural validation |
|---|---:|---|
| Arithmetic | 128 | Operation/flags/column/factor length; width and three register IDs; position/carry; five factor words or small divisor. Check width against trusted allocation, output/source separation, carry domain and exact pending/completed position relationships. |
| LCM | 224 | Stage, three IDs, used/span/divisor, scan/result lengths and the complete arithmetic checkpoint. Check stage-specific operand bindings, divisor relationships, used+2 span, scan/completion consistency and reserved bytes. |
| Comparison | 40 | Width, two IDs, remaining high-to-low words and pending/less/equal/greater result. Check range/completion consistency; equal is terminal only after all words. |
| Normalized magnitude | 192 | Trusted allocation capacity and input used lengths; arithmetic checkpoint and output normalization scan. Source words above used length are virtual zero, never fetched from dirty scratch tails. Output length becomes available only after bounded normalization completes. |
| Atom division | 384 | Normalized numerator/divisor, two private scratch IDs, exact prefix/quotient/correction count, nested normalized-arithmetic/comparison checkpoints. Quotient is derived on chain, bounded below 2^58, corrected at most twice, and exposed only with a verified remainder strictly below the divisor. |
| Complete rate evaluation | 960 | Authenticated common denominator, proposed numerator lengths/factor, complete claim totals and current insurance budgets; exact row ordinal, incoming sums, strict slopes, residual/loss identities and derived whole-atom insurance use. Nested arithmetic/comparison/division work follows a program-owned named schedule. |
| Insurance rounds | 64 | Original and current budget pairs, exact spent atoms, clipped-market mask and completed evaluation count. Each market clips at most once; at most three complete evaluations, ending with integral use. Invalid attempts consume no evaluation. |
| Cohort denominator | 320 | Frozen count, processed ordinal, last stable ID, used common length, alternating common register and nested LCM checkpoint. Check stage/operand bindings and expose the denominator only after every row. |
| Membership | 544 | Frozen count, path depth/stage, page mask/count and fifteen radix traversal frames. Check complete subtree counts, canonical child path, processed ordinal and terminal replay. Program-owned nodes/pages and a frozen membership epoch are separate required authority. |
| Valuation totals | 288 | Frozen count/custody/pool/insurance/fee/gross-OI bindings; processed ordinal/last ID; cash, signed quantities and gross totals; separate unsigned positive/negative claim totals. Check complete conservation before accepting the final row. |

`accesses()` returns the exact next register/word permissions before execution.
Arithmetic/LCM use at most three descriptors; comparison reads exactly two words
and finishes after at most W steps. A writable descriptor permits the multiply
accumulator read as well as its write. Source aliases may share a read page, but
an arithmetic output cannot alias an input. Completed cursors reject more work.
The native test adapter denies any undeclared word access and restores encoded
bytes at 1/7/128-step boundaries, including every LCM stage. `PagePlan` groups
these accesses into at most three canonical `(register,page)` requests with merged
permissions and trusted-capacity checks. Pages contain 256 words (2 KiB payload),
an I/O size rather than a population limit. Physical PDA/owner validation remains
the program adapter's responsibility; a page request alone supplies no authority.

`SnapshotScan` consumes already-accrued whole-account claims and position lots in
stable ID order. Each accepted row updates constant-size totals; positive and
negative claim sums use three words with an explicit <2^151 bound. Completion
requires exact root cash, zero net lots, frozen gross OI and
`positive_m = negative_m + pool_m*S`. Insurance and retained fees remain separate
frozen buckets; they do not enter claim sums. An invalid final row preserves the
previous scalar prefix. The program must independently authenticate membership,
role/mode and derive claims from the actual root and frozen prices/funding.

`DenominatorPass` initializes common=1, consumes each frozen ordinal once and
extends the reduced LCM with the existing bounded word cursor. Registers 0 and 1
alternate; register 2 is quotient scratch. The keeper cannot choose register IDs
or operations. Integral rows advance without an unnecessary LCM pass. Used lengths
exclude dirty unused tails; widening clears the words it will read.
`normalized::NumberCursor` gives later rate operations the same contract for
addition/subtraction, bounded-factor multiplication and small division: used lengths
come from authenticated preceding work, while a missing word inside that length
is an error. It performs at most three physical word accesses per step and one
output-normalization read per step. Some zero-tail operations are metadata-only
steps; they still consume the controller budget. Capacity limits allocation, never
forces a scan of all allocated words. This is arithmetic infrastructure, not
proposal authorization or a completed rate verifier.
`atom_division::AtomDivision` persists exact division for whole-atom insurance and
later payouts. It reads a bounded normalized prefix, derives the quotient estimate,
checks the full product, performs at most two downward corrections, and verifies
`numerator = quotient*denominator + remainder` with `remainder < denominator`.
Physical work remains at most three words per step, including comparison and
normalization; no wide local arrays or repeated whole-width quotient search are
introduced. Input normalized lengths remain authenticated metadata, not uploaded
proof. No result is exposed during incomplete arithmetic. A result is
unavailable until all frozen rows complete. Each arithmetic step still accesses at
most three words, including across physical page boundaries.

The program's `PageWindow` adapter now authenticates the reserved
[SettlementLimbPage layout](accounts.md#successor-limb-page-layout-p54b-inactive)
directly: exact discriminator/size/owner, venue, epoch, attempt, revision, register,
page index, addressable word count and PDA. It reads/writes individual words without
copying the 2 KiB payload. A batch must stop before an unavailable next page; missing
words never become implicit zeros. Public continuations advance each declared write-page revision once through scoped
history; the standalone native adapter commits dirty pages only. These two owners
are never both called. Writable revision exhaustion rejects before writes. The
handler derives the plan/bindings from authenticated work and commits the work
checkpoint and page revisions in the same successful transaction.

These codecs validate syntax and internal scalar consistency, **not historical
execution**. Decode only authenticated program-owned work; a caller's cursor is
never proof of completed work. Native account-loader tests do not establish a
signed chain transition. The bounded membership traversal and canonical account readers now follow the
[reserved index contract](accounts.md#successor-membership-reads-p54b-inactive).
D97 now implements source/root binding and public valuation/denominator control
against the existing actual frozen cohort. The exact bridge, layouts and authority
limits are in [accounts](accounts.md#prepared-frozen-verification-p54b-inactive-financial-paths).
The bounded `rate_work::RateWork` schedule now recomputes both rate equations,
every row's incoming debt payments, strict right slopes/greatestness, market
residual/creditor-loss equality and exact whole-atom insurance floors. A row uses
only its own whole-cash collection plus its capped opposite-market recovery;
it cannot consume sibling cash or exceed its debt. `InsuranceRounds` preserves
original reserves across rejected proposals and permits each market's fractional
budget to clip once. These primitives do not authenticate uploaded numerators:
the owning handler must verify normalized lengths, frozen row order and current
attempt, then advance rounds only from a complete `RateWork::result()`.
Per-root final cash and deterministic atom attribution remain P54C work.
Public upload, rate continuation and proposal/reset handlers now consume these
owned checkpoints (D98). Numerator normalization follows complete contiguous
upload with a nonzero final used word; callers cannot upload a cursor or opcode.
Metadata-only steps use an empty remaining-account plan, which permits no physical
word. Mathematical rejection is recorded separately from guard failures. Actual
signed rate/recovery/resource acceptance is recorded in [validation](../operations/validation.md#authenticated-frozen-and-rate-verification-p54b). Current schema-8 financial accounts, selected binaries and
enabled capacity are unchanged. This is verification-only acceptance, not complete on-chain settlement.

### Persisted flow and graph primitives (P54C in progress)

`scalable::flow_work` consumes a completed, integral-insurance rate evaluation and
an authenticated frozen row. Its 768-byte checkpoint derives both exact market
payments and cash, checks retained uncollected cash, derives three atom floors,
retains exact fractional remainders and orders them descending with kind as the
stable tie-break. It preserves all verified rate registers and uses only fixed
scratch registers 25–40; each word step declares at most three accesses. A
fractional insurance evaluation cannot authorize this flow work. The owner must
also authenticate the complete insurance-round history; a native result type is
not on-chain authority.

`scalable::active_work` persists each word of the ordered active hierarchy in a
64-byte checkpoint, with at most eleven update or 21 successor steps even at the
u64 address boundary. `scalable::graph_work` persists canonical DFS, path minimum,
residual updates and complete edge/node audit in 352 bytes. Each transition declares
at most three scalar records and performs at most four record accesses. Following
parent arcs replaces the native path vector without changing visitation order.
Generation marks avoid population-sized clearing after each augmentation. Active
index updates occur before search resumes; an interrupted pair update cannot make
an unfinished graph available for Apply.

`scalable::order_work` verifies exact positive-claim remainders and stable-ID
ties in a 576-byte checkpoint, using scratch registers 41–45. The owner must also
prove the complete permutation with authenticated per-root attempt/seen markers;
counting accepted arithmetic rows alone is not a membership proof. Rejected numeric
order is explicit and never enables construction.

`scalable::graph_build` constructs every edge, balance and adjacency from verified
flow floors and complete canonical order in a 384-byte checkpoint. It clears the
used active hierarchy before populating it, overwrites every readable graph record
and derives all auxiliary capacities; no uploaded edge is accepted. Each step
accesses at most two records and performs at most three reads/writes. Native
transport compares every constructed node/arc/adjacency with the retained canonical
model before independently checking final atom owners. This native comparison is
not a signed on-chain construction proof. Checkpoint codecs validate structure, exact bindings
and nested operation types, but cannot authenticate caller-provided progress.
D99 specifies exclusive plan adoption and recoverable order attempts. The current
program controller now authenticates the frozen source, completed rate/insurance
history and canonical scalar pages. It derives each flow in ordinal order, then
accepts exactly one occurrence of every frozen ordinal in each market order using
per-root attempt/seen markers. Exact positive remainders and stable-ID ties are
checked before constructing the graph. Attempts cannot overwrite completed rate
pages. Invalid order records Rejected; malformed account/epoch/revision access
fails atomically. Only the order proposer supplies permutation rows; anyone may
continue arithmetic. Proposer cancellation or 64-slot stalled/rejected recovery
restarts ordering, retaining original floors and insurance. There is no heartbeat.

Both complete permutations advance irreversibly to deterministic construction and
audited circulation. Ready means that verification finished, **not** payout
authority. All six new entrypoints keep the original financial accounts read-only.
Adoption, exactly-once application/reconciliation, recovery, token exits and signed
RPC/WS/SQL acceptance remain unfinished. No selected artifact, financial writer or
expanded population is activated by this construction checkpoint.

Application primitives now retain a 368-byte complete-cohort scan: original cash,
lots/gross and three-word positive/negative claims remain separate from applied
cash and signed market movements. Each row checks canonical ordinal/ID, verified
fractional increments, exact cash conservation and retained uncollected cash.
Completion requires all original obligations plus market movements exactly equal
to their own pool/insurance supply. Partial live balances are never substituted
for that original scan. Structural checkpoint validity alone supplies no authority.

The root helper rechecks actual whole-account funding/claims and original revision,
clears positions/reservations/orders/delegation, preserves both order and protective
group IDs, advances generations/nonces and leaves an isolated forbidden slot zero.
It prepares a private candidate before committing any root mutation. Reconciliation
checks the next scoped revision, frozen funding endpoints, exact generations and
all dormant book bytes. These helpers are native-tested and **not yet connected to
a public financial instruction**; exclusive adoption and complete ledger/recovery
integration remain required before they can be used on-chain.

### Frozen work, completion and adversarial proposals

The successor stages are `Freeze → Value → Denominator → Propose → VerifyRates →
VerifyOrder → Round → Apply → Reconcile → Resolved`, with the existing optional
valuation wait and insurance clipping loop. Freeze commits safety/membership,
complete live-index count/root, terms, source prices, both funding endpoints and
allocated custody/pools. Unvalued pages cannot be omitted, duplicated or reordered;
the cursor follows authenticated index paths, not an uploader's private list.
Value checks every root's role/mode, q/claim/cash bounds and complete conservation.
Advancing to Denominator requires both `SnapshotScan::result()` and terminal
`MembershipCursor::request() == Request::Done`; consuming the last row alone does not skip the
remaining ancestor-count checks. Persist a valued row, both cursors and relevant
page revisions atomically.

Proposal bytes are bounded by the proved count-derived width, tagged by epoch and
attempt, and never written into arbitrary program-owned accounts. A new attempt
can replace incomplete/unverified proposal work; it cannot reset frozen input,
spend reserves or undo any applied root. Verification recomputes rates/flows and
checks greatestness, integral insurance usage and complete sorted membership.
After verification locks a plan, permissionless helpers resume the same deterministic
work. No timeout awards a keeper's proposed cash or permits a creditor subset.

Every continuation commits an opcode-specific progress cursor and authenticated
page revisions; repeated/out-of-order/stale calls reject or resume the same prefix.
Only verified Apply writes margin roots, exactly once. Partial application uses the
existing mixed original/applied reconciliation rule; no payout/withdrawal before
complete finalization. Reconcile checks cash, q, claims, pools, insurance, retained
fees and actual vault, then clears obligations/orders/delegates and advances
generations without resetting replay history. Recovery remains separate.

Storage must be provisioned before financial activation, including enough shared
scratch for the admitted numeric envelope. A forged/stalled proposer can consume
only a bounded attempt allocation; it cannot force unlimited account creation.
Specify and test reclaim/refund ownership, unavailable keeper recovery and retry
funding before activation. Ordinary collateral/insurance cannot pay these SOL costs.

### Operating envelope and release gates (G1–G3)

These are engineering acceptance targets, **not new account registration ceilings**:

| Dimension | Initial target and rationale |
|---|---|
| Native diagnostics | 64, 128, 1,024 and 10,000 registered rows; report the actual financial/empty/exposed counts separately |
| First compiled cohort | 128 financial roots including mixed isolated/cross debt, six current makers and funded receivers; exceeds the old cap without conflating account and maker expansion |
| Extended compiled diagnostic | 1,024 financial roots with adversarial fractions and connected cycles; 10,000 stays native until compiled storage/work budgets pass |
| Active markets, collateral, OI | BTC/ETH, one mint; retain existing 100m position/200m gross lots, cash and claim bounds; no OI expansion inferred from account count |
| Orders / makers | Four orders/two protections per root; three maker instances per market, two selected per route; P57/P60 own subsequent changes |
| Per-transaction resources | Measured <=1m CU target, no unsafe stack frame, v0/v1 within their measured wire limits; no whole-cohort instruction; exceptional over-target step must be split and remeasured |
| Recovery target | At 128 roots, <=2,000 signed continuation transactions, <=15 minutes at an explicitly measured local submission rate, <=16 MiB temporary state; report p50/p95 and failure/restart paths |
| Network/storage budget | At most 10m lamports base-fee budget for the 2,000 one-signature target, plus separately measured rent; no priority bids assumed; these are test ceilings, not observed fees or live-network guarantees |
| Larger-cohort decision | Publish total calls, CU, peak account bytes, actual rent/fees and recovery time for 1,024 before enabling that workload; no extrapolated production claim or silent capacity cap |
| Ordinary profit payments | Make progress while relevant economic mutations and in-region fresh observations continue; retained current financial/oracle checks; no mandatory coordinated pause |

The CU/time/storage targets are deliberately conservative review triggers for the
first doubled cohort, not profitability calibration. Native counts/time do not
establish these compiled targets. An enabled domain must have worst-case checked
storage and finite continuation bounds; measured convenient cases alone cannot
justify admitting an unresolvable state. P54/P55 must derive and measure those
bounds before P56B removes the local financial gate. If the candidate cannot meet
them, revise its schedule or return a concrete G2 economics/trust decision; do not
silently weaken rounding, membership or insurance.

G2 recommends the exact compact candidate without an economic departure. G3
recommends [maintained backing proofs](accounting.md#incremental-backing-candidate-p51b),
subject to its explicit mutation/validity proof and resource gate. The finite native
diagnostics are feasibility evidence only; unproved SBF work or ordinary-payment
liveness remains open, not acceptance supplied by old P16A/P49 results.

## Versioned price policy (P53A)

[`financial-core::price_policy`](../../crates/financial-core/src/price_policy.rs)
is the canonical literal definition. P53A preserved price policy 1; P53B source
implements qualified local **price policy 2**. Price policy version, account schema 8 and venue
profile 4 are distinct identifiers; this refactor changes no account bytes, PDA,
event, signed domain, epoch, error number or instruction interface. `MAX_PRICE`
(1–1,000,000 quote atoms per lot) is the proved arithmetic domain, not permission
to accept every source or persistent-order price in that range.

The module names asset USD micro-prices, collateral USD micro-prices, reference/
order/trigger atoms per market lot, confidence/divergence and execution-band units.
BTC has 1,000,000 lots per unit, ETH 100,000; normalize asset **value and confidence**
by 1 and 10 respectively before ratio rounding. Unsupported lot sizes reject. Maker
curve arithmetic and liquidation retain the full numeric domain; actual admission
also checks independent current bounds and the 90–110% execution band. Persistent
orders use the explicit limit/trigger policy and preserve original signed terms.

Policy selection is immutable for this bounded deployment. An updater, publisher,
keeper or venue authority has no instruction to replace these parameters. Existing
terms/config epochs still fence their actual supported mutations; no fictitious
price-policy epoch is inferred. A future approved calibration increments the policy
version and uses a fresh deployment domain/artifact binding with fresh orders.
Old orders/originals remain with their old deployment/executor; never rewrite their
signed limit, revive authority or copy claims. Live parameter changes would require
a separate concrete transition/epoch contract, not an edit to constants.

P53B owns G5's approved risk range and actual widened-boundary acceptance.
No new policy was enabled by P53A. Numeric admission
proofs, source age/confidence/depeg/recovery, deposit/cancel/eligible exit rules and
default/devnet gates remain unchanged. Validation separates current source checks
from qualification of rebuilt binaries.

### Approved P53B calibration

User-approved on 11 November 2026 for the test prototype: remove the old raw BTC/ETH USD fixture
bands and accept authenticated positive source values only when checked unit
normalization and the complete risk interval fit the existing numeric envelope.
Keep collateral $0.5–1.5 / Normal $0.95–1.05, confidence, disagreement, ages,
recovery, fees, margin and cash/claim bounds unchanged.

| Approved policy-2 term | Literal value / rationale |
|---|---|
| Converted reference / trigger | 2–909,090 collateral atoms per lot. At 2, the worst confidence-adjusted lower interval is still at least 1; the upper ceiling is floor(1,000,000 × 10/11), keeping the whole execution band in numeric range. |
| Persistent order limit | 1–1,000,000 collateral atoms per lot, with unchanged full reservation/financial admission and signed-price preservation |
| Raw asset USD range | Positive checked source values, then converted-reference and full interval validation; no separate BTC/ETH fixture price bands |
| Existing numeric domain | Unchanged: risk/marginal prices 1–1,000,000, cash <=10^15, q <=10^8 and scaled-claim bounds |
| Deployment | New policy version and fresh local genesis/domain/artifact binding; no in-place position/order/original migration, default/devnet remain closed |

At collateral parity, the approved reference range corresponds to BTC 2–909,090
and ETH 0.2–90,909 collateral tokens per whole asset. Those are representation-
derived limits, **not forecasts, calibrated leverage recommendations or a promise
that prices near them are economically desirable**. This materially widens accepted
risk sources; G5 approval and fresh signed local acceptance are recorded in
[validation](../operations/validation.md#numeric-bound-price-policy-p53b).

Exact conservative bound: at the largest reference r=909,090, an accepted guard
has floor ratio at most r+floor(r/100)=918,180. Its actual ratio is <918,181.
The worst confidence/model upper is therefore at most
ceil(918,181 × 10,050/9,975 × 101/100)=934,336; the missing-guard 103% envelope is
936,363. Both stay below 1,000,000 without clipping. At r=2, the lower interval is
at least floor(2 × 9,950/10,025 × 99/100)=1. These are arithmetic derivations, not
implementation-test evidence. Independent exact cases must check floors, ceilings,
confidences, invalid guard handling, depegs and both market unit conversions.

Funding coupling: unchanged six-token impact notional gives Q=7–3,000,000 lots,
so P53B replaces the old 600-quantity enumeration with the exact canonical
published-depth search portion brought forward from P58A, retaining
complete maker coverage, two-leg limits and all existing ties. Measure actual
worst-case work; do not discard financially unavailable quotes or invent maker
margin admission for funding. The ceil means realized reference notional is at
least six and less than 6.909090 collateral tokens. Higher maximum premium also
can exhaust the unchanged finite funding index sooner; P58D remains required for
lifetime maintenance, without erasing earned funding.

Acceptance requires independently derived extreme and old-edge values in
native/client code and real signed deployed paths, plus source-failure cancellation,
deposit, eligible reduction/exit/default and whole-account reservations. P53B passes this scoped acceptance with fresh local artifacts; prior P53A files
and original bindings remain retained. P54A can
continue independently because its admitted arithmetic envelope does not change.

## Risk sources and account admission

Risk uses independent index bounds, never maker execution prices or attested impact
prices. Each root accrues both positions and refreshes all remaining reservations.
Equity is funded cash plus negative adverse claims only; IM/MM are additive 10%/5%
with conservative per-position ceilings. These are provisional test parameters,
not production leverage calibration. Isolated mode rejects any other-market state.

The six local source PDAs bind distinct primary/guard signer identities: BTC feeds
1/3, shared collateral 2/4, ETH 5/6. Authenticate owner, PDA, exact schema/length,
verifier identity, verification level 2, exponent -6 and monotone source sequence.
Wrong supplied accounts reject; invalid values from the actual bound sources cause
policy failure. Sources are signed test fixtures, not independent upstream oracles.

| Policy | Current local bound |
|---|---|
| Asset USD values | Positive checked i64 micro-USD values; ETH value/confidence multiplied by ten before reference and complete interval admission |
| Asset / collateral confidence | At most 50 / 25 bps |
| Collateral USD range / Normal | 0.5–1.5 / both sources 0.95–1.05 |
| Source age / future skew | At most 20 / 2 seconds at on-chain Clock |
| Primary/guard divergence | At most 1% of primary converted reference |
| Reference / risk price | 2–909,090 / finite 1–1,000,000 atoms per lot; reject rather than clip the full interval |
| Risk envelope | Confidence interval plus 1% model envelope, union with guard; valid primary with missing/invalid guard gives at least ±3% and Degraded |
| Recovery / hold | Six seconds sustained qualified samples; gaps at most six seconds |
| Funding outage / catch-up | Risk increase blocked after 12 seconds; unverified catch-up at most 30 seconds |

Normal also requires qualified funding/recovery. Credible Degraded bounds permit
only admissible reductions/liquidation; no credible bounds blocks exposed ordinary
execution. Flat fixed claims do not invent price exposure. Derive required markets
from actual positions, claims, live orders/protections and the operation. Never let
a caller omit a losing market; empty unrelated slots need no fresh price. Shared
collateral sources remain relevant to exposed collateral-denominated positions.
Cancellation outside frozen ownership needs no source or maker quote.

## Orders and protection

Four records and two protective pairs are embedded in each root. Inclusive start,
exclusive expiry; order lifetime and placement horizon at most 216,000 slots;
quantity 1–100,000,000 lots; per-lot all-in limit 1–1,000,000 atoms; lifetime fee budget
at most 1,000,000,000,000,000 atoms (the existing cash domain); index triggers 2–909,090 atoms. Every submitted
subfill is exact-base atomic with at most two distinct maker capitals.

For each remaining risk-increasing buy lot reserve `ceil(upper/10) + max(limit-lower,0)`;
for sell use `ceil(upper/10) + max(upper-limit,0)`, plus unspent fee budget. Reduce-only
orders add no directional IM but retain execution-loss and fee reservation. Sum
remaining orders conservatively; missing credible bounds use the finite full risk
range. Recompute before admission/withdrawal/payment and after fills. A reservation
is not a fill guarantee. Actual funding publication has no hypothetical reservation
or maker-margin check; the [publisher contract](../liquidity/funding.md) owns that boundary.

Partial fills retain version; replace increments it while retaining cumulative
filled quantity, gross and fee prefix. Checked order IDs prevent reused slots from
reviving old authority. States are Empty/Open/PartiallyFilled/Filled/Cancelled/
Expired/Invalidated. On-chain order decides cancel/replace/fill races.

TP/SL needs an existing nonzero position. Its two orders share a generation-bound
allowance no larger than current exposure. Creation thresholds straddle current
index; partial TP reduces SL allowance, manual reductions clip it, and flat/flip
invalidates the generation. Reopen cannot revive it. Cancelling one child leaves
the sibling; replacing a child advances group version so old group cancel rejects.
Replacement cannot grow shared allowance or change generation/trigger direction.
No entry-linked growth, trailing stop, trigger latch or keeper-created user authority.

## Liquidation

A receiver signs consent and supplies funded capital; verify its canonical root,
current version, full funding/reservations and final IM. Target must have a positive
whole-account MM deficit. Transfer 1–100,000,000 lots within held quantity, without flipping,
at a price inside 90–110% of independent reference. Cancel target risk orders
atomically; their cancelled authority cannot create a false extra source dependency.
Receiver surviving orders still count. Fee is `min(ceil(notional/2000), 10,000,
target cash)` atoms, transferred to receiver, with no additional insurance tax.
After fees, selected absolute exposure and whole-account MM deficit must both
strictly decrease. Mere exposure reduction is insufficient. Failure rolls back
funding, orders, positions and fee. No forced unfunded receiver or hidden subsidy.

## Complete frozen input and economic priority

There are exactly two markets, one collateral mint and at most 64 complete account
rows, including isolated makers and liquidation receivers. Every row contains its
own funded cash and both fully valued/accrued claims at the frozen endpoints. An
absent position contributes zero; a caller cannot omit a losing claim. Per-market
claim sums must equal the corresponding settlement pools. The program must
also authenticate the registry, prices/funding, source bounds and frozen state;
the model's array length and identities are not substitutes for those proofs.

For account `i` and market `m`, write positive claim `w_i,m = max(U_i,m,0)` and
debt `d_i,m = max(-U_i,m,0)`. The clearing contract uses these priorities:

1. Collect available **own** cash against total negative claims, apportioned by
   those market debts. Other accounts' healthy cash is never a reserve.
2. Apply recovered positive claims to that same account's remaining opposite-market
   debt before granting any cash entitlement. The transfer is capped at the debt;
   failure to recover the source claim does not erase the destination obligation.
3. Each market supplies at most its own insurance against the resulting debt.
   Existing settlement cash and collected losses are used first. Retained fees and
   foreign insurance are excluded.
4. Every unpaid creditor in a market receives the same exact recovery fraction
   before terminal atom rounding. Complete residual debtor writeoffs equal that
   market's creditor impairment. This includes claims pledged by cross accounts.

These are terminal simultaneous-clearing obligations. They do not grant positive
unpaid margin credit, authorize a live claim transfer or allow an ordinary account
to spend an uncollected receivable. The owner-authorized normal flat-netting
instruction still needs its separate admissibility and ledger transition contract.

## Exact equations and cycles

Let `W_m` be all original positive claims in a market, and `B_m` its initial P plus
own-cash collections. A mixed-sign account creates one link from its positive-claim
market to its remaining-debt market. For a link with face `w` and debt cap `d`, its
transfer at source recovery rate `r_source` is `min(d, w * r_source)`.

For each market, solve simultaneously:

```text
r_m = min(1, (B_m + I_m + incoming_link_recoveries) / W_m)
```

If `W_m = 0`, define its rate as one; reconciliation then gives no debt or pool to
pay. Of multiple fixed points, choose the **greatest** componentwise solution.
The insurance budget participates in the capacity equation, but actual consumption
is only `max(0, r_m*W_m - B_m - incoming_link_recoveries)`. Unneeded insurance stays
in its original reserve. Funding a cycle is not an extra entitlement.

Two cashless accounts with `(100,-100)` and `(-100,100)` illustrate why the greatest
solution matters. Rates `(1,1)` discharge the reciprocal claims with transfers
100/100 and **zero cash payout and zero insurance use**. The rates describe claim
discharge, not 200 atoms of new money. Starting from zero and waiting for a positive
cash inflow would miss this valid closed setoff. Conversely, when a cycle includes
external creditors, the complete equations retain those creditors; a keeper may
not cancel only a convenient pair and ignore the rest of the market.


## Exact bounded exceptional arithmetic

Normal state uses fixed-scale i128; terminal work uses **96 u64 limbs (6,144 bits)**
in unsigned little-endian encoding. No Fraction, float, unchecked cast, convergence
tolerance or unbounded allocation is part of the executable schedule. The integer
reference is [bounded_clearing_reference.py](../../tests/financial/bounded_clearing_reference.py);
its independent oracle remains the separately implemented Fraction/branch model.

Let each frozen scaled claim have magnitude at most
`K = 10^26 + 3*10^23 < 2^87`, derived from retained normal v/q/price/funding bounds.
Own whole collection is `k_i=min(C_i, floor(sum debt_scaled/S))`. A single-negative
account has integral scaled collection `k_i*S` and a scaled-integer residual link
cap. Only a double-negative account with nonzero collection needs a denominator.
Let **L** be the product of those accounts' total scaled debts (use 1 if none).
Do not use an LCM requiring an unbounded gcd routine. At most 64 factors are each
below 2^88, hence `L < 2^5632`. Collections in scaled units share denominator L.

All positive totals, incoming unsaturated slopes and fixed link caps are sums of
at most 64 values below 2^87, hence below 2^93. For each branch the two equations are:

```text
W_0*r_0 - slope_0*r_1 = N_0/L
W_1*r_1 - slope_1*r_0 = N_1/L
```

`N_m/L` is P*S + collected scaled cash + I*S + capped incoming links, below 2^94.
A capped response replaces its equation by `r_m=1`. Non-singular determinants are
positive and below 2^186; numerators `N_0*W_1+slope_0*N_1` and its partner are below
`L*2^188`. A singular branch's greatest endpoint is a cap or link threshold, also
representable with a denominator factor below 2^186. Therefore rates can always
be represented `r_m = rate_numerator_m / (L*factor)` with `0<factor<2^186`.
Both rates share this denominator; canonical reduction is unnecessary.

All cash flows share `D=S*L*factor`. Original scaled claims multiply one rate
numerator; collection numerators multiply factor. Rate comparisons cancel common L
before cross multiplication. The largest scheduled intermediate is below 2^6016
(including comparison of two candidate sums); 6,144 bits supplies checked headroom.
Never cross-multiply two unreduced wide fractions. Remainder ordering compares
numerators over common D. Whole flow quotients are below 2^58, so division can use
at most 58 checked shift/subtract steps. Wide multiplication is only by bounded
small factors (at most three u64 limbs), not an unconstrained wide-by-wide product.

Debtor insurance attribution/writeoff is retained as a **factored exact record**:
residual numerator times `(total residual numerator - I_spent*D)` divided by
`D*total residual numerator`. Store the original row, final rates/flows, D and
market insurance totals, rather than expanding a roughly 12,000-bit diagnostic
product into normal state. Reconstruct exact writeoffs/impairments and signed
terminal adjustments from those committed factors. Their per-market identities
must reconcile; factoring does not discard a fraction or create a spendable asset.

### Untrusted rate proposal, complete on-chain verification

Keepers compute rates off chain; their proposal is not authority. The program
recomputes L, complete positive totals, exact collections and every capped incoming
flow from frozen authenticated rows. Check the two original min equations exactly,
rate bounds and factor bound. Then verify **greatest**, not merely fixed, rates:

- If either rate equals one, the other is uniquely fixed by its original response,
  so no componentwise greater solution exists.
- Otherwise compute each right-hand incoming slope from links **strictly below**
  their cap at the proposed rate. Require `slope_0*slope_1 < W_0*W_1`.

Each slope is bounded by the other market's complete positive population. Concavity
means increments above this point cannot exceed the right slopes; a product below
one rules out a greater fixed point. If the product equals one and both rates are
below one, a positive interval can advance both along the linear cycle, so this
is not the greatest solution. At an exact cap breakpoint the link is excluded
from the right slope. This rejects zero/partial cashless-cycle solutions while
accepting full setoff, and retains every external creditor. Empty W has rate one.
No trusted worker, timeout, administrator-selected rate or caller subset is needed.

Start insurance capacities at snapshotted I. Verify actual use from full flows;
if fractional, clip that capacity to its floor and repeat the complete verified
solution. Each market clips at most once; at most three evaluations. Persist the
clipped mask/evaluation. Never let a proposer begin with a smaller reserve budget.
Then perform D59's deterministic conserving circulation with integer remainders,
<=192 original edges, <=67 auxiliary edges, <=69 nodes and <=192 augmentations.
Record every whole flow and its signed exact adjustment; each market adjustment
sums to zero and final cash error is less than one atom against the final clipped
benchmark. Retained own cash is protected. No global cross-market dust award.

## Frozen transitions, continuation and recovery

Freeze the complete venue liability cohort because shared debtors/cycles can connect
markets. Loss attribution remains market-specific even though this bounded safety
freeze is venue-wide. No claim of operational isolation is made.

Permissionless freeze requires a credible common-value net-bankrupt account, or a
fully flat account whose gross closed obligations exceed its funded cash. The
latter is an unpaid closed-debt trigger, not permission to seize other accounts'
healthy cash; complete clearing can discharge a cashless cycle with zero loss.
An exposed merely under-IM account is not bankruptcy. Retain the separately
specified authority source-emergency trigger after 30 seconds without credible
bounds; liquidity shortage alone is not a default proof.

Pin complete registry hash/count, safety epoch, source/config terms, both consumed
funding endpoints and credible common closeout prices. Missing required valuation
enters AwaitValuation, never a caller-chosen stale mark. No new funding while frozen.

| Persisted stage | Mandatory completion before advancing |
|---|---|
| AwaitValuation | Authenticate both required common prices and frozen F; freeze all membership/ordinary mutations |
| Value | Canonical pages, exact two claims, C, q/generations; verify total q=0, both claim sums=P*S and allocated custody |
| Denominator | Canonical pages build L and collection/positive totals, with checked wide arithmetic |
| RateProposal / Verify | Bounded chunks upload one untrusted rate pair/factor; complete rows verify equations/right slopes and insurance use. Stale epoch/proposal replay rejects |
| Clip / repeat | Exactly prescribed floor-capacity update, mask/evaluation progress; clear prior derived work and reverify complete rows |
| FlowPlan | Whole base flows and common remainders; canonical complete edge order, stable-ID ties, balances and bounded residual graph |
| Round | Deterministic remainder-priority DFS with repair arcs; persisted node/edge cursor/parents/capacities; caller cannot select a different augmenting path |
| Apply | Complete final plan first; apply each root exactly once, set cash, zero q/v/claim, advance generations, clear orders/delegates. Preserve market ownership of reserve/fee balances |
| Reconcile | Complete scan, zero exposure/claims/P, exact final C+I+T/allocated vault, all rows applied and each market adjustment zero |
| Resolved | Owner funded cash exits and fee withdrawal permitted; no ordinary trading until explicit recovery |

Pages have two stable rows. D64 resource measurement limits Verify and FlowPlan
to one row per instruction and separates complete rate/insurance verification from
the last row; Value/Denominator/Apply/Reconcile allow one or two rows without
skipping/reordering. Every continuation binds epoch/stage/cursor and required
canonical account keys. Partial proposal bytes cannot drive financial application.
Work arithmetic may continue after a bounded limb/edge budget without changing its
result. Storage accounts are precreated in the fresh profile; a restarted worker
needs only chain state. A proposer that disappears cannot lock authority: anyone
can replace an incomplete proposal before verification begins; after verification
starts only deterministic rejection/reset or exact continuation is allowed.
A complete wrong proposal resets rate-verification work, never frozen inputs or
collected funds; proposals cannot strand an epoch by consuming insurance early.

Compute insurance as a plan until Apply. Stage accounting uses the frozen ledger
plus applied-row bitmap/cursor: never add live and frozen representations twice.
No intermediate fractional flow becomes spendable C/P/I. Reserve use and final
P=0 occur once under the frozen plan; external direct donations stay unclassified.
Recovery requires venue authority, complete reconciliation and the unchanged
sustained valid source/recovery policy. Return to Custody, bump safety/terms epochs,
retain earned F and fee carry, then separately activate the qualified local profile.
No automatically revived orders, delegates, old quotes or insurance reset.

No active reserve redemption exists. Authority may irreversibly **Retire** only
a completely reconciled liability-free venue (after resolution or a complete
flat/no-orders/no-claims scan). Retired identities cannot reopen. Then reserve
authority may withdraw attributed I to the immutable reserve-destination owner's
canonical token account; owner C and T remain separately backed. A resume path
cannot sweep I first. This is terminal reserve custody, not LP shares or yield.


## Frozen preparation and proposal contract

The qualified profile precreates one header/work pair and all 32 canonical two-row pages.
Creation is permissionless rent payment in Custody/Active; it grants no price,
reserve or payout authority. Freeze requires the completed storage set, the current
safety/resolution epochs and an authenticated registry member. It accepts common
net bankruptcy or strictly underfunded gross flat debt; an exposed risk deficit
alone rejects. The authority-only missing-source emergency retains its full
30-second grace. A missing price anywhere with exposure enters AwaitValuation;
a wholly unexposed market uses the fixed irrelevant price sentinel 1.

One/two-row Value pages cannot cross a two-row storage boundary, omit a root,
change its canonical identity or supply writable participant accounts. The complete
scan checks cash, both zero signed exposures, gross quantities and both pool/claim
identities before Denominator. Frozen participant accounts and live cash ledgers
remain unchanged. L is then derived from all frozen rows with exact whole own-cash
collections. Epochs, stages and cursors prevent reuse of earlier pages.

Rate proposals are exactly 1,560 bytes: two 96-limb little-endian numerators,
followed by the three-limb factor. Chunks are nonempty, eight-byte aligned and at
most 512 bytes; offsets are contiguous and bound to epoch/evaluation/SHA-256.
Anyone may restart an incomplete upload at offset zero. Verification cannot be
replaced mid-pass. Wrong complete encoding/equations reset proposal work without
changing frozen inputs, spending reserves or consuming an insurance evaluation.
Every frozen row contributes exact flows and right slopes. Only complete fixed
and greatest-rate verification permits the prescribed floor clipping or FlowPlan.
Clipping preserves original reserves and requires a complete new verified scan.

Verify work registers 0/1 hold incoming flow numerators; register 2 contains the
two checked u128 slopes in limbs 0–3; register 3 contains L*factor; registers 4–7
are scratch. This names the existing layout's usage; no account bytes or old
profile semantics change. Events retain frozen valuation inputs, proposal chunks,
verification decisions and exact insurance budgets; preparation does not emit a
fabricated payout. Deterministic rounding/application/reconciliation are mandatory
stages, not implicit effects of reaching FlowPlan.

## Deterministic atom planning and circulation

After complete rate verification, FlowPlan derives whole claim-flow/cash floors,
exact common-denominator remainders, per-root outgoing order and node residuals.
No root balance is applied by planning. Fixed original edge IDs are market-zero
rows, market-one rows, then cash rows; zero-claim placeholders have no adjacency.
Auxiliary IDs follow those edges in stable node order. The work account keeps four
positive/negative claim masks in register 0 limbs 0–3, required/sent flow in limbs
4/5, root outgoing permutations in register 1, signed i64 residual balances in
register 2 and the previous checked remainder in register 3. Registers 4–7 are
scratch. Roots/markets/cash sink/source/sink retain the contract's <=69 nodes.

A proposed pair of complete market permutations grants no path authority. Every
entry is authenticated against the canonical frozen page and exact remainder,
with stable root-ID ties. A proposal can be replaced before checking begins;
a wrong committed order resets deterministically so an absent proposer cannot
strand resolution. After checking begins, an unrelated caller cannot replace a
partially verified order. Only complete verification enables Round.

Round examines at most 128 deterministic adjacency slots per call, persisting
DFS parents, cursors, path and residual capacities. It prioritizes auxiliary
forward arcs, descending-remainder original forward arcs, then repair arcs by
stable destination/edge. Every augmentation is bounded and total augmentations
remain <=192. A complete result audits each node's required increment, including
both market nodes; reaching an aggregate sent count alone is insufficient.
Whole row cash and flows are not committed to participant accounts until Apply.

## Exactly-once application and terminal cash

Only a complete audited circulation enables Apply. Canonical writable roots must
still match their frozen cash, q, generations and fully accrued claims. Each row
applies once, checks its own cash equation and retained own cash, stores the final
whole flows/cash, zeroes allowed positions/claims and advances their generations.
An isolated account's forbidden market slot remains entirely empty. Orders and
protection are removed while the last order ID remains monotonic; delegate expiry/
identity are cleared and root nonce/version/delegate epoch advance.

During partial Apply, participant bytes contain a mixture of old/new rows. The
allocated vault and P/I/T remain the original frozen ledger; `scanned_cash` is
remaining original C and `cash_applied` is final C of applied rows. These are the
stage-accounting representations, never two spendable balances. Remaining q/gross/
claims track the unapplied cohort. In this stage `claim_sums` accumulates signed
whole market flows at scale S. No ordinary deposit/trade/exit can consume a partial
plan. The complete application proves both market whole-flow totals equal P plus
that market's planned insurance use, and final C equals original C+P+spent I.
Only then does complete resolution record final C, set both P to zero and debit
each I exactly once; fee amounts/carries and allocated vault remain unchanged.

Reconcile scans every applied root again, checking final cash, zero claims/q,
funding checkpoints, generations and absence of revived order/delegate authority.
Only its completed cash check enters Resolved and advances safety authority. Events
retain every applied root, final whole flows, staged aggregates, exact reserve/fee
state and versions. Freeze events also retain both resulting market snapshots,
including source sequence and coverage changes, for indexer reconstruction.

Resolved/Retired owner withdrawals use the existing signed root guard and actual
SPL transfer, require flat/no-claim/no-live-order cash and no pause, and consume no
new funding or artificial source freshness. The explicit local safety feature is
required; default/devnet remain disabled. The active P25 withdrawal path retains
its full current risk/held-funding checks. The evidence report records the complete
maximum-cohort/resource/RPC acceptance.


## Recovery and terminal reserve custody

Permissionless authenticated observations must establish six seconds of sustained
normal sources, with the unchanged two-second sample interval and six-second hold.
Bad sources reset recovery credit; a gap longer than the hold starts a new window.
Only venue authority can resume a completely reconciled Resolved venue, and this
returns to Custody. Safety/venue/market terms advance, earned funding and fee carry
remain, and old observations are cleared. Fresh independent maker/source sampling
and a separate authority action are required for separate reactivation. No old
order, delegate or quote authority is revived. Default/devnet builds stay gated.

Recovered custody roots retain historical generations and nonces. Liability-free
cash deposit/transfer/withdrawal therefore tests zero q/v, reserves and live orders
rather than requiring virgin account bytes. Funded owner exits in recovered
Custody, Resolved and Retired consume no new funding or fresh source observation.
The fresh P23 custody profile and active P25 risk checks remain distinct.

Retirement is irreversible and requires either complete current-epoch resolution
reconciliation or a canonical complete flat/no-orders/no-claims scan. The latter
uses `RetirementCertificate`, schema 8, 80 bytes including discriminator,
at `retirement-v3, venue`. Ordered fields are schema u16, revision u64, venue,
safety epoch/membership version/scanned cash (three u64s), count/next (two u16s),
complete/bump (two bytes). One/two read-only canonical roots are checked per
call; an empty venue has an explicit zero-row completion. The venue authority must pause
before scanning; every page and retirement bind the same paused safety epoch and
membership version. Cash mutations reject during the window; unpause invalidates
the proof. A valid completed or in-progress
scan cannot be gratuitously replaced; a stale scan restarts from zero. Complete
cash must match allocated custody minus both markets’ insurance/fees, and both
market gross exposures/settlement pools must be zero.
This global proof is exclusively for irreversible retirement; normal owner exits
never depend on it. The pause window is required for the flat-scan branch of this administrative action.

Only venue authority may retire. Retired identities cannot resume, activate,
register or accept deposits. Then only the distinct stored reserve authority may
withdraw selected-market I to the immutable reserve-destination owner's canonical
classic SPL ATA. Actual I/V decrease equally; C/T and fee carry remain separately
backed. No active/resolved pre-retirement insurance sweep is introduced. New
progress, recovery, retirement and reserve events retain exact state/amounts for
indexer reconstruction. The additive certificate is a D64 implementation detail of
D60's existing authority contract, not a new loss policy.



## Terminal rounding obligations

Own cash collection is whole `min(C, floor(total scaled debt / S))`; apportion it
exactly by market debt. Use the greatest rates, starting with full snapshotted I.
Fractional insurance consumption clips that market's effective capacity to its
floor; each market clips at most once, at most three complete evaluations.

Round the complete claim/cash flow graph within each edge's floor/ceiling while
conserving every account and market node. Never give a global cross-market dust
award. Record each signed adjustment; each market's sum is zero, each adjustment
has magnitude below one atom, and final account cash differs by less than one atom
from the final whole-collection, clipped-capacity benchmark. Retained own cash
cannot be seized by rounding. This error bound does not describe the earlier
unclipped rational benchmark; uncollected sub-atom debt and clipped insurance
remain separately reported. Factored exact writeoffs and creditor impairments
reconcile without expanding unbounded diagnostic fractions on-chain.

Verify and FlowPlan process exactly one row per call. Finalize complete rate and
insurance verification separately after Verify cursor reaches count. Other row
stages allow one/two rows without crossing a two-row storage page. Default heap is
32 KiB; bounded wide scratch must not be copied onto the 4,096-byte SBF stack.
See [validation](../operations/validation.md) for measured full-context limits and
the distinction between actual financial lifecycles and resource-only scratch cases.
