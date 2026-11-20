# Verifying a joint default plan

The successor must establish three facts before anyone can collect a changed
payout. Each forced close must be admissible at the freeze. The plan must win
under the approved recovery, sharing and tie rules. Clearing must commit the
same result across both markets. The existing program provides part of the
last guarantee for ordinary terminal settlement. The small-cohort reference runs offline.
The verified BTC candidate also connects one restricted selection proof to actual
clearing balances and withdrawals. The nine-account fixture farther below measures
a different selection proof in isolation.

## Single BTC pair in financial clearing

The candidate requires complete frozen membership, whole-atom claims, one
BTC debtor, one opposite winning BTC lot and zero ETH obligations and exposure.
Other flat BTC creditors and funded cash remain part of the same settlement.
The valuation pass checks all members. Clearing reauthenticates both original
roots and derives the winner’s unpaid gain from its surviving position history.
The keeper supplies the two member locations.

Let the debtor owe `D` whole atoms and hold `C` funded atoms. With BTC insurance
`I`, the shortfall is `max(0, D − C − I)`. Existing settlement cash backs the
corresponding extra positive claims and cancels out of this difference. With
one opposite lot, an adverse move of one price atom transfers one collateral
atom. Clearing admits the full charge only when the winner’s unpaid open gain,
positive claim and valid price range all cover it. A zero shortfall needs no
forced close. Partial coverage, fractional claims and linked books require
additional verification.

After traversal the prepared header records the epoch, both stable member IDs,
charge, execution price and unpaid-gain cap. Frozen financial rows retain their
original values. The denominator, rate totals, individual flows and final
application all use the same adjusted claims. The existing custody check
continues to authenticate the original roots. The finalized receipt explains
the transfer to the indexer. Spendable cash becomes available after the entire
cohort reconciles. [Rust selection](../../crates/financial-core/src/clearing/scalable/snapshot/single_pair.rs)
and [program adapter](../../programs/clearing/src/instructions/account_safety/settlement/single_pair.rs).

### A sole BTC debtor with residual losses

The BTC residual candidate accepts multiple opposite lots held by one account.
It verifies that these two roots own all BTC exposure, the debtor owns all
negative BTC claims, and every ETH position and claim is zero. Other flat BTC
creditors participate in ordinary proportional recovery. Claims and previously
paid profit retain their fractional parts.

Let `g` be the gross price gain per winning lot, `p` its previously funded
price gain and `b` the ticks available before the allowed price boundary. In
collateral atoms the usable gain per lot is
`a = max(0, min(floor(g), b, g − p))`. Each actual fill price stays within
the entry and frozen mark. Across the matched lots the total charge also stays
within their exact share of unpaid gain. For `Q` opposing lots, total capacity
is the lesser of `floor(Q × a)` and the positive whole BTC claim. Charge the
lesser of this capacity and the whole shortfall after debtor cash and BTC insurance.
These bounds are attainable with one opposite account, so the result maximizes
recovery. For positive charge `T`, `K = ceil(T / a)` is the smallest feasible
number of whole lots. All `K` lots concede `floor(T / K)` ticks and
`T mod K` of them concede one further tick. Zero charge leaves the forced
schedule empty. The existing terminal settlement still clears the frozen positions.
[Per-lot arithmetic](../../crates/clearing-accounting/src/attribution/forced_close.rs).

Same-market residual claims use D112’s ordinary conserving rounding. For
example, three available atoms initially pay an open winner and two flat
creditors `(1, 1, 1)` on claims of `(2, 1, 3)`. A one-atom charge to the
winner changes the claims to `(1, 1, 3)`. The exact payouts become
`(3/5, 3/5, 9/5)` and ordinary rounding pays `(1, 0, 2)`. The smaller flat
claim’s exact entitlement increased from 1/2 to 3/5 while its rounded payout
fell by one atom. D118’s floor applies to foreign-market effects. The
[native and reference comparison](../../tests/financial/test_creditor_payout_floors.py)
also checks what an additional same-market floor would pay.

## What clearing can reuse

| Boundary | Existing implementation | Successor verification needed |
|---|---|---|
| Freeze | [Resolution header](../../programs/clearing/src/state/accounts/resolution.rs) records venue, epoch, membership, both prices and funding, original pools, insurance, fees and vault allocation. | Bind these to a single rule set, the ordinary terminal outcome and original exact cash shares. |
| Complete inputs | [Frozen member rows](../../programs/clearing/src/state/accounts/prepared_settlement.rs) bind member ID, address, activation and position generations, original revision, lots, cash and accrued claims. | Authenticate D113 entry basis and closed-first unpaid gain on surviving lots. The current frozen row has aggregate claims. |
| Verify | [Plan controller](../../programs/clearing/src/instructions/account_safety/settlement/plan.rs) verifies the ordinary circulation and its paged inputs. | Reconstruct paired fills, charges, lot usage, D117 insurance and individual payout checks, D118 rounding and D120/D121 selection from the frozen inputs. A hash binds a submitted answer but cannot prove it wins. |
| Adopt and apply | [Lifecycle](../../programs/clearing/src/instructions/account_safety/settlement/plan/lifecycle.rs) binds the verified plan and source revisions, then applies one canonical row at a time. [Root application](../../programs/clearing/src/instructions/account_safety/settlement/plan/application.rs) checks original revisions, generations, cash and valued claims. | Add the approved two-market plan, both original and resulting obligations and authenticated per-row deltas to that exclusive adoption. Application must use exactly those deltas on retry. |
| Release | The existing lifecycle checks final custody, reconciliation and complete membership before releasing the venue. | Keep exits and ordinary financial operations gated throughout partial application. Test interruption before adoption, during each market’s application and before release through signed RPC, WS and PostgreSQL. |

## Final ties can determine a whole payout

Two equally profitable makers each have a one-lot long and ten unpaid atoms.
A debtor with one short lot can absorb ten atoms of verified shortfall. The
second short position has no unpaid debt. The original outcome pays the makers
five each. Charging either maker recovers ten with identical D116 deviations
and lot usage. The resulting payouts are 10/0 and 0/10.

D121 orders exact ties by the frozen venue and episode. The [selector](../../tests/financial/frozen_plan_selection.py)
reads stable member IDs from the canonical frozen cohort. It hashes the following
research byte encoding with SHA-256 and sorts members by ascending digest, then
numeric ID in the event of a digest collision.

```text
ASCII("Rivalt/frozen-member-order/v1") || 0x00 || venue[32] || LE64(episode) || LE64(member_id)
```

Compare the total charge of each member in that order, BTC then ETH, giving
priority to the larger charge at the first difference. If winner charges also
tie, compare the charges on individual pairs in winner-rank, market and
debtor-rank order. Absent pairs have zero charge. The ordinary terminal
circulation retains its existing stable rounding order. This rule affects
only financially tied forced reductions. It has no external randomness
dependency. Membership and the episode are predictable, and splitting capital
can change the set of eligible members.

## Verifying the score without replaying the optimizer

A small single-market family demonstrates the difference between feasible and
optimal. Each BTC debtor has three short lots, C funded cash and B+C debt.
The flat creditor is owed all debtor cash. Each profitable long has one lot
and a whole eligible gain between B/4 and B/2. The total gain equals the sum
of the debtor shortfalls. There are no foreign claims or insurance in this
experiment. Actual cash is present and the flat creditor’s payout can change.

To recover the entire deficit, each debtor’s three winners must have gains
that sum to B. Any smaller forced charge would leave some deficit. Conversely
any partition into triples of sum B supplies a valid full-recovery assignment.
This is a reduction from 3-PARTITION to optimal recovery for this abstract
family. It explains why a general instruction that searches all matchings
has no demonstrated practical budget. This inference concerns families of
inputs, independent of a particular Solana workload. [Garey and Johnson, section 4.2 and problem SP15](https://perso.limos.fr/~palafour/PAPERS/PDF/Garey-Johnson79.pdf)

The [certificate experiment](../../tests/financial/default_plan_certificate.py)
checks a submitted charge per original winning lot, per-debtor quantity and
shortfall limits and conservation. Filling unused slots with uncharged lots
gives groups of exactly three without reducing any possible recovery.
Differences between gains have a common divisor. The allowed group totals
therefore lie on an integer grid. Distributing those totals at the grid points
nearest B gives a recovery upper bound. A feasible witness attaining it proves
the maximum for this family. At a fixed total, moving one atom between winners
changes the proportionality cost by the difference of their marginal costs.
If every paid marginal cost is at most every available marginal cost, the
integer allocation minimizes that cost. This is a sufficient proof, so a missed
bound can require further work.

| Frozen family | Result |
|---|---|
| 30 debtors and 90 one-lot winners, gains 4/5/6, B=15 | A 90-entry witness attains the 450-atom bound at zero deviation. The native ordinary terminal kernel pays the flat creditor 120 before and 300 after the adjusted claims. All 300 cash reconcile. |
| Two debtors, gains 5/5/5/5/5/7, B=16 | The grid proves 31 of 32 is maximal. Holding back one atom from the seven-atom winner also proves optimal sharing. Holding it back from a five-atom winner recovers the same amount and fails the sufficient sharing check. |
| Two debtors, gains 5/5/5/5/6/8, B=17 | The grid permits 34. Checking all ten distinct splits establishes the real maximum of 33. A valid 33-atom witness alone does not prove maximal recovery. |

The exact split count is `(3m)! / (6^m m!)` for m debtors in this family.
It grows from 10 at two debtors to 15,400 at four and 1,401,400 at five.
These are counts of possible partitions, not CU or transaction measurements.
A score certificate does not authenticate the episode, prove the final identity
tie, or cover arbitrary linked BTC/ETH positions. The unqualified successor
has no financial instruction.

## Restarting verification when a bound misses

The [small-cohort reference](../../tests/financial/bounded_default_search.py)
accepts a proposed charge vector and checks every possible challenger. It gives
each frozen debtor/winner pair a digit ranging from zero to the smaller of the
debtor’s verified shortfall budget and the winner’s pairable gain. All admissible
plans are in this space. Many digit combinations fail once shared lots or foreign
payment floors are checked.

A cursor records the first unchecked ordinal. The binding covers the frozen
source digest, venue, episode, canonical member IDs, all cash and claim inputs,
market buckets, exposures, gains, rule version and proposed ordinal. Each call
continues from the expected cursor, reconstructs the economic outcome from
frozen state, and checks a contiguous range. A higher-ranked challenger rejects
the proposal. An incomparable financial profile leaves it uncertified. Only
the full successful scan exposes a verified plan. A worker can replay an
uncommitted range against the same prior checkpoint. The reference assumes
the committed checkpoint is trusted. On chain its owner, address and revision
must be authenticated. The reference digest is a research encoding.

| Fixture | Result |
|---|---|
| Six-account joint BTC/ETH default | Nine ordinals. Three are feasible. The original plan loses to ordinal 4, which loses to ordinal 8. Verifying ordinal 8 in batches of 1, 3, 2 and 3 restores the same 9/9 payout after each checkpoint reload. |
| One debtor lot and two equal winning makers | 121 ordinals. D121 certifies only the winning assignment for the specified venue and episode. The equally feasible alternative is rejected. |
| Two debtors and six winners, B=17 | 6,666,395,904 ordinals in the general digit enumeration. The family-specific solver checks ten distinct splits. These counts concern these two algorithms. The general search was not run to completion on this book. |

Work per call is bounded in candidate count. One candidate still requires
whole-cohort exact settlement and may require protected rounding. The reference
does not bound a Solana instruction’s CU, certify a production deadline or
publish a spendable result.

## Release and liveness

An optimal 33-atom reduction on the B=17 book can pay the flat creditor 19
atoms. Ordinary proportional settlement of its original claims pays seven.
Both settle the same twenty deposited atoms. A timeout that switches rules
would change ownership. A slow proposal, keeper retry or failed budget check
does not authorize such a switch.

[D122](../DECISIONS.md#d122--exact-proof-before-prototype-release) makes exact verification mandatory for the prototype. Production deadline policy is deferred.

## Measured nine-account verifier

At `220c139` the [fixture](../../crates/default-plan-selection/src/lib.rs)
computes the winner directly over ten partitions. Each of two debtors has three
lots. Each of six profitable positions has one. At a fixed partition, total
recovery forces each triple to take the smaller of its available gains and its
debtor's shortfall. Two gains always sum to less than the shortfall, so all six
lots participate. Minimizing the proportional deviation at fixed recovery
reduces to minimizing the sum of squared charges divided by their gains.
The cost of adding atom `q+1` is `(2q+1)/gain`. Counting all marginal costs
strictly below twice the group's target divided by capacity leaves at most one
atom to add or remove. Equal marginal costs use D121 winner order. Each
partition also gets its preferred debtor labeling. The final comparison uses
all winner charges before any debtor-pair preference.

The [program](../../tests/programs/default-proof/src/lib.rs) initializes one
107-byte account per fixture venue signer and episode. Its synthetic budget,
cash and gains are immutable. Only the program advances its cursor. Each worker
supplies the expected cursor and number of partitions. Sealing requires all ten.
The financial scope is one active market, no insurance or foreign claims,
member IDs 0–8 and unsigned 16-bit cash, gains and per-debtor shortfall.
The sealed record has no authority over the clearing program or vault.

| Signed action | CU | Wire bytes |
|---|---:|---:|
| Initialize episode | 5,379–5,454 | 330 |
| Verify 1 / 3 / 6 / 10 partitions | 4,284 / 8,209 / 14,562 / 22,718 | 274 |
| Seal winning plan | 1,329 | 272 |

One uninterrupted episode cost 29,501 CU across three finalized transactions.
In the other episode a replacement process opened PostgreSQL, recovered the
one missing finalized receipt and read the program-owned cursor in 21.8 ms on
loopback, measured after establishing its connections. Both sequences recovered
33 atoms and charged the six winners 5/5/5/5/6/7. The debtor assignments differed
as required by the two frozen episodes. The independent native terminal check
paid the flat creditor 19 of 20 deposited atoms in both. Ordinary settlement
paid seven. The fixture itself moved no collateral.

The [independent exhaustive reference](../../tests/financial/test_metered_default_proof.py)
agreed with the native implementation on all 67 small books and identity
orders tested. A separate maximum-budget case covered score width. On this
host 10,000 repetitions of the B=17 book averaged 2.63 µs per native
selection including priority hashing. The signed run finalized eight successes
and four exact refusals. Refusals preserved the account bytes. All twelve
receipts were independently fetched and observed on WebSocket. PostgreSQL
replay added no duplicates. These costs cover this fixed family only.
General linked BTC/ETH selection, authenticating surviving-position history
and adopting the result in clearing remain open.

From the repository root with the pinned tools and local fixture wallet:

```sh
source ops/env.sh
cargo build --locked -p financial-core --bin scalable-settlement-driver
cargo build --locked -p default-plan-selection --example measure
python3 tests/financial/test_metered_default_proof.py
bash ops/default-proof-smoke.sh
```

## What the freeze must retain about open profit

The signed fixture starts with six known gains. In clearing, the source for
each gain matters. Today's frozen row records lots, cash, generations and
aggregate claims. A maker's aggregate claim can contain both realized gains
and price profit on surviving lots. D113 charges only the eligible, unpaid
part of the latter.

The [input comparison](../../tests/financial/test_frozen_attribution_input.py)
starts a one-lot long at 99 or 101. It then buys a lot at 100 and sells one
lot, 128 times. The first sale makes the two aggregate books coincide. At a
mark of 102 both have debtor cash 4, debtor claim −8, maker claim 4, flat claim
4 and the same inventory. The two surviving average entries are
`100 − 1/2^128` and `100 + 1/2^128`. The permitted whole-lot execution
prices sit on opposite sides of a tick. In the first book the maker can absorb
two atoms. In the second it can absorb one. Native terminal settlement pays
the maker and flat creditor 1/3 and 2/2 respectively. These are synthetic,
zero-fee trade histories and native terminal cash controls.

Two exact records suffice per open market position. Store signed entry cost
(lots times average entry) and cumulative payments assigned to those surviving
lots. An increase adds the new signed fill cost. A partial close retains both
in the same proportion as the lots. A complete close clears both. A flip starts
the new side at the fill price. At a backed payment, the pre-payment aggregate
and mark determine the fixed claim and hence the D113 open portion. Funding
and collection enter through the signed aggregate. At freeze, check the
per-lot execution-price bound, the matched lots' share of unpaid open profit
and the aggregate unpaid claim.

The [research encodings](../../tests/financial/frozen_attribution_input.py)
compare two ways to furnish those records. One stores their current reduced
rational values with a shared denominator. A keeper can read these values and
continue without historical transactions. The other stores a 32-byte hash
and an eight-byte event count bound to the original venue, member, activation,
market and generation. It requires the ordered fill and payment records from
a flat origin. A frozen commitment rejects a missing, added or altered record.
It cannot reconstruct an unavailable record.

| Partial closes in the measured history | Exact current position, bytes | Fixed commitment, bytes | Records needed to replay, bytes |
|---:|---:|---:|---:|
| 1 | 23 | 40 | 51 |
| 32 | 31 | 40 | 1,105 |
| 128 | 55 | 40 | 4,369 |
| 1,024 | 279 | 40 | 34,833 |

Lengths cover the implemented research encodings. The current-position encoding
includes lots and three length fields. The commitment and event columns exclude
account headers, origin metadata, indexing, transactions and backup overhead.
The examples establish that a reduced rational denominator can exceed 128
bits with two lots at peak exposure. They do not establish typical maker
histories, an optimal encoding, a rent estimate or a runtime CU bound.

At `50d8a3a`, five focused checks and nine existing payment-history checks
passed. Across 1,000 independently generated history prefixes and 367 funded
payments the checkpoint reproduced the ledger's basis and previously paid
amount, including shorts, flips, fractional funding and partial reductions.
Both terminal cash vectors above were checked against compiled Rust. Authority
in these tests is supplied by the fixture. A financial integration must attach
the records to clearing's successful transitions and verified freeze.

### Signed storage boundary

The [dyadic-basis fixture](../../tests/programs/default-proof/src/basis.rs)
holds one surviving long. A cycle buys one lot at 100 then sells one at 100.
Starting at 101, the exact remaining entry is `100 + 1/2^n` after `n`
cycles. The fixture stores the numerator and exponent and advances from an
expected cursor. This family isolates the resource cost of a numerator growing
from eight to sixteen bytes. The fixture authenticates a test trader and PDA.
It has no custody or financial trade instruction.

At `100bf32`, the [signed test](../../tests/rpc-contract/attribution-storage-rpc.ts)
finalized seven transactions over Surfpool RPC/WS and reconciled six position
observations in PostgreSQL. The first development run exposed a serialization
borrow held during resize. The tested fix releases the typed account borrow
before resizing and reacquires it before committing the new numerator.

| One update | CU | Wire bytes | Observed result |
|---|---:|---:|---|
| Cycle 57, inside current capacity | 2,031 | 371 | Exact numerator fits in eight bytes |
| Cycle 58, top-up one lamport short | 2,083 | 420 | Both the attempted transfer and the update roll back |
| Cycle 58, explicit sponsor top-up | 2,808 | 420 | Account grows from 21 to 29 bytes and the cycle commits atomically |
| Cycle 59, after growth | 2,032 | 371 | Exact numerator verified independently from finalized state |

The eight-byte increase retained 40,640 additional rent lamports on this
validator. Total rent rose from 756,920 to 797,560 lamports. The separate
test sponsor signed the transfer. The trader's SOL balance stayed constant
after initialization. The local base transaction fee was 10,000 lamports on
the two-signature updates, including the rejected one. The experiment covers
neither an entire route nor refund execution. Reproduce with
`RIVALT_PROOF_SCOPE=attribution bash ops/default-proof-smoke.sh`.

D100 already identifies the actual contributor for pre-funded venue recovery
storage. Variable storage caused by later fills introduces another operating
choice. With per-account capacity, makers and traders can provision ahead of
time and sponsors may contribute voluntarily. Risk-increasing operations wait
if required capacity is missing. With a venue-funded reserve Rivalt assumes
the cost for admitted users and must specify admission when its reserve runs
low. Both approaches need a demonstrated bound for compulsory reductions and
default before admitting risk. An unavailable off-chain archive must not be
silently substituted for a verified input.

[D123](../DECISIONS.md#d123--per-account-growth-capacity-with-optional-sponsorship)
selects self-contained current state, per-account capacity and optional sponsorship. The measurements establish the cost for this fixture and leave the
general arithmetic, on-chain attribution, forced-reduction headroom and
complete-route rent measurements open.

### Clearing-owned per-lot attribution

The local profit-attribution candidate stores the average entry price and the
previously paid part of price profit **per surviving lot**, both expressed in
scaled collateral atoms. Each market has its own two numerators and a common
positive denominator. A flat position has an empty record. The root's existing
signed lot count gives the direction and quantity. The candidate reads the
same oracle reference and accrued funding as ordinary claim payment.

Increasing a position weights its old entry and paid amounts by the surviving
quantity, adds the new fill cost, then divides by the new quantity. A flip
starts at the exact gross divided by the executed lots. The trader sees one
aggregate route price and each maker sees its own leg. A same-side partial
reduction leaves the per-lot values byte-identical. Closing clears the record.
All of these writes occur inside the clearing transaction that changes the
position. The keeper and maker pricing programs receive no additional authority.

For a backed payment, let `q` be the absolute lots, `e` the per-lot entry,
`p` the per-lot amount already paid, `g` the signed per-lot price gain at the
current reference, `C` the aggregate accrued claim and `A` the payment. Use
scaled units throughout. The fixed claim is `F = C − q(g − p)`. Clearing
adds `max(0, A − max(0, F)) / q` to `p` for an open position. The ordinary
certificate, available pool and whole-account checks still authorize the payment.

#### Storage reserved at trade admission

Consider any sequence of reductions and backed payments starting with `N` lots
and common denominator `D`. Let `L = lcm(1, …, N)`. Every future denominator
divides `lcm(D, L)`. A reduction preserves the per-lot amounts. A payment
changes no open amount when the fixed claim covers it. When the fixed claim
is nonpositive, the payment adds `A/q`. In the remaining case the new per-lot
paid amount equals `g + (A − C)/q`. Both `A` and `C` are integers in scaled
units. These cases also cover intervening funding or collection because they
change `C` at the next payment. Positive funded payments never increase `p`
past the larger of its old value and the positive price gain.

The implementation bounds the stored numerators and denominator before a new
risk-increasing fill or flip can commit. For `K` the smallest power of two at
least `N`, use `L ≤ 2^(2K−2)`. Each new prime power in `(m,2m]` contributes
its prime to the central binomial coefficient `choose(2m,m)`, bounded by
`2^(2m)`. Multiplying these bounds for successive doublings from one proves
the stated bound. The denominator is therefore no larger than `D × L`, and
the entry numerator no larger than its original numerator times `L`. For the
paid numerator, multiply `L` by the maximum of the original paid numerator,
entry numerator and `D × MAX_PRICE × SCALE`. This is conservative and cheap
to check even for a large request. It bounds persistent storage. Transaction
compute and temporary heap still need measurement for each admitted workload.

The first candidate uses 128 owner-funded bytes per market and an eight-byte
format marker after the existing margin prefix. The candidate SDK reader
explicitly selects this layout. The original deployment reader keeps its exact
size check. Neither growable sponsorship nor the general default verifier is
active in this build. Separate acceptance must establish contributor refunds,
capacity growth and resource limits before changing normal admission.

### One BTC debtor and several winning accounts

The local allocation candidate handles a complete frozen book when one member
owes every BTC debt and holds its entire side of BTC open interest. Clearing
checks the member against the sum of all negative claims, verifies that twice
its absolute lots equals gross BTC lots, and requires zero ETH lots and claims.
The frozen scan also proves zero net lots. These conditions give each winner
enough opposing debtor lots to execute independently. A flat creditor can
receive a payout but supplies no eligible lots.

Let `Cᵢ` be the whole-atom capacity from member i's frozen entry, previously
paid gain, lots, tick range and accrued claim. Let `R` be the whole-atom
shortfall after debtor cash and BTC insurance. The target is
`T = min(R, Σ Cᵢ)`. A charge of k atoms consumes the minimum matched lots
`mᵢ(k)` permitted by the position's surviving unpaid gain. Each of those lots
executes at one of two adjacent prices inside the entry-to-mark interval.

At fixed total T, minimizing the D116 weighted squared deviation is equivalent
to minimizing `Σ kᵢ²/Cᵢ` over positive capacities. The kth atom on a position
adds `(2k−1)/Cᵢ` to that cost. These marginal costs strictly increase on each
position. The T least costly units therefore attain maximum recovery and
minimum deviation. Only the units tied at the last cost can change the result.
Each position contributes at most one such unit. Selecting the smaller
`mᵢ(k)−mᵢ(k−1)` first minimizes forced lots among those ties. The last tie
uses D121's frozen member order.

The worker proposes **one cutoff** consisting of its unit, capacity, additional
lots and member ID. Clearing hashes that ID against its own venue and episode.
For each original member, clearing independently counts the units at or below
the cutoff and recomputes its actual schedule. A cutoff need not be trusted
or unique. Every qualifying cutoff selects the same prefix of the strict unit
ordering. The proof of maximality is the final equality between that prefix's
charge and T across *all* original members.

- A wrong ordinal, row, revision or margin address rejects the instruction.
  Anyone can continue a valid prefix from the stored cursor.
- A cutoff recovering too much, or too little once all rows have been read,
  returns to the frozen proposal gate. Provisional charges have no payment
  authority. Each new attempt overwrites every row before release.
- Frozen row pages on this fresh deployment grow from 1,156 to 1,220 bytes.
  Each of the eight original records appends a u64 charge. The other frozen
  values remain available for original-account reconciliation. The scan uses
  the existing header checkpoint. Later settlement still checks actual inputs,
  verifies its rate and conserving transfers and reconciles custody before exit.

The [exact cutoff](../../crates/default-plan-selection/src/proportional.rs),
[charge schedule](../../crates/clearing-accounting/src/attribution/forced_close.rs)
and [on-chain scan](../../programs/clearing/src/instructions/account_safety/settlement/btc_allocation.rs)
own the three corresponding rules. This proof does not cover competing debtors,
scarce opposing inventory or linked-market claims.

### Joint recovery and frozen cash ownership

The [native settlement verifier](../../crates/financial-core/src/clearing/scalable/settlement.rs)
can take the original cohort alongside the effective claims of a proposed
reduction. Both cohorts must conserve each market independently. Each member
retains its cash balance and each claim can only move toward zero by whole
atoms. The verifier derives cash ownership once from the original debts and
checks it against the remaining obligation in each market before accepting the
rates. The same original allocation enters rate verification, per-member
attribution, rounding and the retained-cash floor.

For a member owing 80 to BTC and 40 to ETH with 90 cash, the original shares
are 60 and 30. Closing 20 of the BTC debt leaves face debts of 60 and 40.
Recalculating the shares would pay 54 and 36. Keeping the original allocation
pays 60 and 30. The native path also handles fractions that cannot be
represented by depositing whole tokens into intermediate market pools.
For any market affected by a close in the other market, the native
[payout check](../../crates/financial-core/src/clearing/scalable/rounding/protection.rs)
compares the proposal with the fully settled original book. Market impairment
and insurance use cannot rise. A creditor may lose at most the verified direct
charge on its own claim, both in exact fractional entitlement and in whole
atoms received. Clearing first tries the ordinary deterministic payout. If a
creditor would lose a protected atom, it fixes every required receipt as a
lower bound and solves the conserving graph again. A proposal that cannot
fund all floors together fails. The two positive ETH claims in one fixture
receive 1 and 6 before and after a BTC reduction. Ordinary rounding alone
would have given them 2 and 5.

The [two-market freeze comparison](../operations/validation.md#signed-two-market-default-comparison)
now binds each native input to the same original clearing member and checks
its claims independently against the two signed trades. The ordinary program
paid out both makers. The [joint certificate](#joint-certificate-for-a-single-cross-debtor)
defines clearing's separate authority for the fully recoverable one-creditor
case. General linked books still require selection and protected payout proofs.

### When the two markets trade places

An eight-member frozen book illustrates the D127 tie rule. Each market
has a debtor owing 11 with 7 funded, insurance of 1, a winner with a gain of 3,
a cross-account winner with a gain of 4 that owes 4 to the other market, and
a flat creditor owed 8. The two cross-account winners are different members.
Both flat creditors receive 6 before forced closes. Of the 256 possible whole
charge vectors, 70 satisfy the model's constraints. Two remain after the
approved recovery comparisons.

| Outcome | BTC charges on gains 3 and 4 | ETH charges on gains 3 and 4 | BTC / ETH flat-creditor cash | BTC / ETH insurance |
|---|---|---|---|---|
| BTC shares the charge more evenly | 2 and 1 | 3 and 0 | 7 / 8 | 1 / 1 |
| ETH shares the charge more evenly | 3 and 0 | 2 and 1 | 8 / 7 | 1 / 1 |

Each plan recovers 3 atoms per market and closes three lots. D120 ties. D127
permits D121’s frozen-member priority after proving a single market swap
matches the original book and both plans. The permutation must cover each member
once, undo itself on a second swap, and preserve every debtor/winner link,
fill, claim and receipt. The market buckets, original collections, member cash,
basis, lots, paid gains, rates, impairments and whole payouts are checked.
A one-atom difference in retained fees prevents either plan from winning under
this rule. The swap provides evidence of matching economics. The original
stable IDs always determine the winner.

The [complete reference search](../../tests/financial/bounded_default_search.py)
binds D127 into its checkpoint domain. For the all-zero test venue, member 3
decides episode 1 in favour of the 7/8 plan, and member 2 decides episode 2
in favour of 8/7. The [Rust comparator](../../crates/default-plan-selection/src/mirror.rs)
checks an explicit permutation in one member pass, validates charge totals and
matches each original pair with its reflected fill schedule. It breaks any
remaining assignment tie in winner, market and debtor order.

The [signed probe](../operations/validation.md#native-linked-market-recovery)
uses the same Rust comparator on committed synthetic inputs. The full
feasibility search and settlement of those inputs were checked off-chain.
Authenticating the inputs against a real frozen clearing episode, verifying
optimality there, applying both markets and releasing custody are separate gates.

### Joint certificate for a single cross debtor

The original `0e027fc` linked clearing build accepts a bounded proof from the
two-market frozen snapshot. The debtor must own all negative claims and all
lots on its side in each market. Each winner must own all the positive claims
and opposing lots in its market, and have zero claims and lots in the other.
Both debts and each market's original cash allocation must be whole collateral
atoms. The complete cohort totals establish these properties for any two
members proposed by the keeper. Other members may retain funded cash.

For each market, let `D_m` be its face debt and `C_m` its original share of
the debtor’s collectible cash, proportional to `D_m`. The required charge is
`D_m − C_m − market insurance`. Both charges must be positive and fully
recoverable from the winners' eligible gains and available opposing lots.
Every remaining claim can then be paid at face. The unique winner in each
market eliminates a choice of loss bearer or a rounding conflict with another
creditor. Clearing independently derives the minimum lots and their prices
from the winning position's surviving entry and payment history.

The BTC instruction records its terms in the prepared settlement and leaves
the venue frozen. The ETH instruction authenticates the same episode, debtor,
cash allocation and its own winning position. Only then can the denominator,
rates and payout work begin. A single event records both fill schedules.
The denominator uses original debts. Rate and payout work use adjusted claims
for outstanding obligations and original debts for funded cash ownership.
A stored cursor for a changed row carries both original claim numerators.
Previously issued cursors keep their version-one encoding; both formats fit
the existing 960-byte rate and 768-byte payout checkpoints.

The [eligibility calculation](../../crates/financial-core/src/clearing/scalable/snapshot/linked_pair.rs)
and [clearing instructions](../../programs/clearing/src/instructions/account_safety/settlement/linked_pair.rs)
implement this certificate. The eight-member D127 mirror fixture has several
creditors per market and requires a broader proof.

Adding a flat BTC creditor makes the economic boundary visible. In a four-member
native case the debtor has 19,976 cash against 10,002 of debt in each market.
The flat creditor is owed 4,996. The winning BTC and ETH positions are owed
5,006 and 10,002. With insurance of 9 and 1, the ordinary payout credits the
flat account with 4,994. Charging the open winners 5 and 13 pays it all 4,996
and credits the BTC maker with 5,001, down from 5,003. ETH still receives
9,989. These are independently derived payout targets.

The `30434d5` candidate admits the additional flat BTC creditor by checking
the complete positive BTC total against the open winner plus one authenticated
flat claim. The snapshot records the largest whole BTC claim observed on a
fully flat account with zero ETH claim. A second positive remainder, foreign
exposure, fractional creditor, split debtor inventory or incomplete coverage
prevents this certificate. The claim belongs to its original member throughout
ordinary settlement and withdrawal.

The 288-byte valuation checkpoint keeps version one when the scan has no
witness. Version two stores the whole amount at bytes 264–271, little-endian.
A zero version-two witness, a nonzero version-one witness and nonzero reserved
bytes fail decoding. The authenticated frozen pages, original winner accounts
and gross/claim totals still bind each financial decision.

## Linked allocation across competing winners

The local candidate admits a cross debtor with the complete negative claim and its
entire side of open interest in each market. Every other member may have lots or
a whole-atom claim in one market. Flat unpaid claims count as creditors. The
debts, debtor's two original cash shares and creditor claims must all be whole
atoms. In each market the debt left after that cash share and market insurance
must be positive and fully recoverable from eligible opposite positions.

The worker proposes the last selected marginal atom separately for BTC and ETH.
Clearing fixes both proposals in the same prepared header and visits the frozen
members in canonical order. At each open winner, clearing reads the original
position and its exact entry and paid-profit history, derives eligible capacity,
then counts the marginal atoms at or below the proposed boundary. For the kth atom
the marginal cost is (2k−1) / eligible capacity. Equal costs use the additional
lots needed for that atom, then frozen episode priority and stable member ID.
Every admitted charge is consequently a prefix of the same total ordering within
its market. If both sums equal the respective shortfalls, they identify the
unique selected allocation under the approved tie rules. Disjoint creditors and
the fixed cash split let the two markets attain their maxima together.

A scoring transaction writes the prepared header and one frozen page. Each of
its eight rows has two additional little-endian u64 charges in this candidate
layout. Stage 7 records the next ordinal, attempt and recovered amounts. Excess
recovery or a short final sum returns the header to stage 4. The next attempt
overwrites the rows in order. Provisional charges have no effect on any root,
insurance ledger or vault. On a supported book, anyone can finish a pending
scan from its stored cursor. Repeated submissions of losing cutoffs can consume time and fees; this
candidate sets no production completion deadline. For N frozen members a
successful proof takes one begin instruction and N scoring instructions. The
prepared header serializes those instructions within one default episode.
Only a complete scan opens denominator verification.
Settlement keeps original debts for debtor cash attribution and applies the
certified charges to market claims. A later owner-signed withdrawal moves the
funded collateral.

Multiple debtors, creditors exposed to both markets, fractional original cash
shares and insufficient eligible gain require additional proof. The worker
reports these shapes as unsupported in this candidate. The local artifact has
its own page decoder and pinned helper. [Clearing implementation](../../programs/clearing/src/instructions/account_safety/settlement/linked_allocation.rs).

### A winner whose BTC claim backs an ETH obligation

One signed book has an isolated BTC debtor and a cross account holding the
winning BTC short and two losing ETH lots. The flat BTC maker and the ETH
maker are the final creditors. The cross account has 19,976 funded atoms,
14,998 of unpaid BTC gain and an ETH obligation of 35,004. In terminal
settlement, collections on that BTC claim contribute to payment of the ETH
maker. Ordinary BTC has 19,993 funded atoms against 20,002 of face claims.
The cross account therefore receives an exact 14,998 × 19,993 / 20,002 before
whole-atom rounding. A nine-atom BTC charge brings that receipt down to 14,989.
This removes exactly 22,518/10,001 atoms of backing from the ETH creditor.

With the original book, the two makers' gains are 5,002 and 34,970 atoms.
A nine-atom BTC reduction would pay them 5,004 and 34,968. The ETH maker
would lose two atoms despite having no direct reduction. D117 rules out that
proposal. A joint plan charging nine to the BTC winner and 33 to the ETH
winner produces the *same two rounded receipts*. This time the ETH maker
has a verified direct reduction, and its exact and rounded claims satisfy
the foreign-market protections. Together the two direct charges reduce ETH
impairment by exactly 307,515/10,001 atoms. The distinction matters when
implementing a general verifier: checking only final vault and root balances
cannot authenticate who was eligible to bear each charge.

The complete native comparison checks ordinary cash, each member's signed
market movements and insurance; its independent search tries all 340
assignments. The bounded clearing certificate below authenticates the two
winning roots and their direct charges before releasing either market. [Reference comparison](../../tests/financial/foreign_winner_comparison.py).

### Atomic certificate for one cross-market creditor chain

The keeper identifies four frozen rows in role order. Clearing checks the BTC
debtor, the flat BTC creditor, the BTC winner with ETH debt and the ETH winner
against the canonical pages for the completed episode. Their positive and
negative claims must separately exhaust both snapshot totals. The opposing
positions must exhaust gross lots in each market. Other members can hold cash.
Pools must be empty and the four faces must be whole atoms. The program reads
both winning margin roots at their original revisions and verifies that each
winner's attributable unpaid price gain can fund its complete price schedule.
One successful instruction commits both schedules into the prepared header.
The regular settlement worker uses this receipt throughout rates, planning
and application. Each original debtor has debt in exactly one market, which
determines where its cash is collected.

Let **D** be the BTC debt, **F** the flat BTC claim, **G** the cross account's
BTC claim, **A** the BTC debtor's cash plus BTC insurance, **E** the ETH debt
and **C** the cross debtor's cash plus ETH insurance. This certificate requires
D = F + G, 0 < A < D, and G > D − A. The BTC charge is **x = D − A**. The
original ETH receipt before rounding is **B = C + GA/D**. The ETH charge is
**y = E − ceil(B)**. The final exact ETH receipt is **H = C + G − x**.

| What clearing proves | Why it suffices in this family |
|---|---|
| x and y are positive, with H ≤ E − y | Both original debtors use their funded cash, and each market uses its original insurance budget. |
| H + y ≥ ceil(B) | The ETH maker receives at least its original exact entitlement and its greatest possible original rounded receipt, after its own verified charge. |
| The adjusted BTC rate is one | The flat BTC creditor receives F. The cross debtor receives G − x. Both cover their original rounded BTC receipts less their own charges. All resulting market movements are integral. |
| Both charges exhaust their original market limits | At an intermediate BTC charge u the ETH backing loss is AFu/[D(D−u)]. Each additional BTC atom costs strictly less than one ETH atom since F < A and D−u ≥ A. Total exact recovery increases with either charge. The feasible upper corner uniquely maximizes recovery. |

The signed book can use this constant-size proof because there is one eligible
winner on each side and both schedules are executable. Competing debtors for
one lot, circular obligations, fractional original claims and insufficient
winning capacity remain outside its scope. [Program adapter](../../programs/clearing/src/instructions/account_safety/settlement/foreign_creditor.rs) · [Arithmetic](../../crates/default-plan-selection/src/foreign_creditor.rs).

### Shared single-lot inventory

A debtor's verified BTC write-off limits how much it can recover. A winning
position's unpaid gain limits how much it can be charged. Each scheduled
reduction also consumes lots on **both** positions. Two debtors cannot each
assign the same one-lot winner, even when their combined charges fit comfortably
within its unpaid gain.

In the single-market native selector, each participating debtor has one lot,
each eligible winner has one opposite lot, both sets have the same size, and
the budgets and capacities are positive whole atoms. Complete pairing in order
of descending debtor budget and winning capacity achieves the sum of all debtor
budgets whenever that total is feasible. If any sorted budget exceeds its
corresponding capacity, this full-recovery selector returns no plan.

At fixed total charge, proportional allocation minimizes the sum of each
winning charge squared divided by its capacity. Swapping a larger charge onto
a larger capacity improves that objective whenever both differ. For equal
capacities the earlier D121 winner receives the larger charge. Within each
equal-charge band, order winners and debtors by their frozen identities before
pairing them. The sort takes O(n log n) comparisons and O(n) working memory.
The signed two-debtor fixture compares this native result with full enumeration.
The local two-debtor clearing program verifies the full-coverage case from the
finished frozen scan. Gross BTC exposure must be exactly four lots, both markets
must have zero pool balances and ETH must have zero claims and exposure. The
four named roots exhaust positive and negative BTC face, with one lot apiece.
If each debtor's original unfunded loss is L and the sum of those losses is T,
its whole-atom charge budget is floor(L × (T − BTC insurance) / T). Clearing
authenticates both winning roots at their frozen revisions, verifies the per-lot
unpaid gain and re-runs the assignment. The resulting receipt binds debtor,
winner, charge and fill price for each distinct pair. The ordinary denominator,
rates and application steps consume those adjusted claims after verification.
A separate test artifact selects this behavior.
[Allocator](../../crates/default-plan-selection/src/single_lot.rs) · [Independent enumeration](../../tests/financial/check_shared_inventory.py).

### When one of the two winning lots has little eligible gain

The partial-inventory build admits flat BTC creditors alongside the four open
positions. Both original debtor faces must still account for every negative BTC
claim. The gross exposure must still be exactly four BTC lots and zero ETH lots,
and both aggregate ETH claim totals must be zero. A winning lot can have zero
eligible gain. The verifier authenticates its original history even in that case.

For a pairing of debtor D and winner W, its largest admissible charge is
`min(D's original whole-atom budget, W's surviving eligible gain)`. Each pair
uses a different debtor and winner. With no foreign obligations, each additional
admissible atom cancels one atom of original uncovered debt and its matching
unpaid gain. Giving either pair less cannot improve total recovery. Every possible
set of disjoint fills is contained in one of the two complete pairings, so clearing
can compare their maxima without looping over atom amounts.

At equal total recovery, let q₀ and q₁ be the winning charges and c₀ and c₁
the capacities in stable winner order. Minimizing `abs(q₀ × c₁ − q₁ × c₀)`
implements the proportional-deviation objective for two winners. Each product
fits in u128. If one capacity is zero, charges all fall on the eligible winner.
Next prefer fewer positive fills, then compare the winner and pair charges in
frozen-episode order. A zero charge has zero fill price and consumes no lot.
Two empty assignments yield the same economic outcome.

The local program stores the chosen terms under the eight-byte `RVLOTS02`
receipt marker. It preserves original cash and the insurance budget through
the same whole-cohort reconciliation. [Exact two-lot comparison](../../crates/default-plan-selection/src/two_debtors.rs)
and [independent enumeration](../../tests/financial/check_partial_inventory.py).

### Matching a population of single-lot debtors and winners

For one market, sort the original debtor budgets and the surviving winning
capacities in descending order. The target for the winner at rank k is the
smaller of its capacity and the kth debtor budget. Missing entries contribute
zero. This admits unequal numbers of eligible participants and zero amounts.
At every integer threshold t, at most the smaller of the two counts at or
above t can contribute a t-th atom. The sorted pairing reaches that bound at
every threshold simultaneously.

For equal recovery, consider exchanging two inverted pairs. When both budgets
fit within both capacities, sending the larger charge to the larger capacity
reduces the sum of charge squared divided by capacity. When both capacities
fit both budgets the winning charges are already fixed. Otherwise a strict
overlap between the two budget values and the two capacity values improves
recovery on exchange. Equal capacities award the larger charge to the earlier
D121 winner. These exchanges give the optimal winner targets. Each positive
target requires exactly one opposing lot.

The final debtor assignment still matters. In frozen winner order, a small
target may encounter a high-budget debtor that a later winner needs. For each
remaining positive target t, count unassigned debtors with budget ≥ t and
subtract unassigned winners needing ≥ t. Call this the spare count. Assigning
budget b to a target q consumes one spare precisely at thresholds q < t ≤ b.
Choose the earliest eligible debtor whose removal consumes no tight threshold.
The native proposer stores one threshold per pair for checking that choice.

The verifier first checks the complete feasible assignment: each positive
winner target occurs once, each debtor occurs at most once, and each assigned
budget suffices. Next it checks each winner in D121 order against the same
assignment. A supplied tight threshold must have equal remaining counts. Every
earlier debtor must have too little budget or be needed above that threshold.
A feasible suffix is essential. A priority check on a single pair can accept
a choice that leaves a larger charge unfundable. The current native checker
uses linear space and up to one full row scan per positive winner.
[Proposer](../../crates/default-plan-selection/src/inventory_book.rs) · [Feasibility and priority checks](../../crates/default-plan-selection/src/inventory_choice.rs).

### Binding the single-lot assignment to clearing

The local book verifier takes the ascending financial ordinals of every active
BTC position and the writable frozen pages that contain those ordinals. Each
page is supplied once in increasing order. The preceding whole-membership scan
captures each winning lot's eligible gain from clearing-owned entry and payment
history. Each candidate row appends a u64 capacity and a u64 certified charge.
Eight rows occupy a 1,284-byte page including the page header and discriminator.

Clearing checks the frozen gross exposure against the number of distinct
one-lot records, then checks the complete valuation totals against the named
BTC debt. Negative faces must share a side, winners hold the opposite side,
and both ETH claim totals, ETH exposure and both settlement pools must be
zero. Omitted members can hold flat positive BTC claims. For each debtor the
uncovered loss is the positive part of its face debt less its cash. With total
uncovered loss L and original BTC insurance I, the whole budget is
floor(loss × max(0, L − I) / L), or zero when L is zero.

The instruction computes the matching directly, writes each participating
member's charge and commits a digest of the epoch, ordered winning capacities
and ordered pairs. The verifier changes scratch state only. Subsequent rate
calculation adjusts the debtor and winner claims by opposite amounts and uses
the original claims for cash collection. The journal reconstructs the winning
targets and checks prospective debtor choices against the sorted remaining
budgets. Reconciliation compares its digest with the clearing receipt and
compares the per-member charge and capacity with the actual frozen page.

The number of active positions and the number of distinct pages touched affect
the certification transaction. The complete valuation and later distribution
also visit flat members. The local deployment pins the extended layout and
restricts release to its supported shape.

### How many frozen pages fit in one inventory certificate

The original inventory verifier (`d5cc624`) uses ten fixed reads and one fixed
write. Each distinct active frozen page adds one write. Its 32-entry revision
scope leaves room for 21 active pages.
Each page has eight frozen rows. Consequently 168 contiguous active rows is
an upper bound from page addressing alone. As few as 22 positions on 22
different pages already exceed it. Flat members between active ordinals can
increase the page count even when their rows do not enter the matching.

| Active positions | Writable frozen pages | Total scoped accounts | v0 bytes | Selected wire format and bytes |
|---:|---:|---:|---:|---|
| 6 | 2 | 13 | 803 | v0, 803 |
| 32 | 5 | 16 | 1,111 | v0, 1,111 |
| 58 | 8 | 19 | 1,418 | v1, 1,376 |
| 168 | 21 | 32 | 2,727 | v1, 2,685 |
| 22 spread across 22 pages | 22 | 33 | 1,592 | v1, 1,550 |

These are serialized transactions using the generated instruction and the
usual resource headers. Only the rows identified in the signed measurements
have runtime evidence. On the separately selected local verifier (`eb011a5`), the scope allocates one
entry per supplied frozen page in addition to the eleven fixed accounts. The
8,192-byte scoped transition event uses 108 bytes of framing, 41 per read and
49 per write. Its encoding alone permits 155 active pages. Packet size, account
locks, compute and heap can bind earlier. The worker requests a 128 KiB heap for
this certificate. Before proposing it, the worker serializes the actual accounts
and ordinals with the payer and resource headers. A packet exceeding 4,096 bytes
returns the paged-verification status even if its pages fit in the revision event. Ordinary routes
and registration have their own resource limits. The original selection retains
its 21-page gate. [Signed measurements](../operations/validation.md#active-positions-and-frozen-page-placement).

## Several multi-lot debtors and winners in one market

The [native verifier](../../crates/default-plan-selection/src/multi_lot.rs)
accepts a complete BTC book with whole claims, no settlement pool and no ETH
obligation or exposure. All member IDs are distinct and ordered. Signed lots
and claims each sum to zero. Flat creditors and uncovered debts with no
pairable lots still enter the accounting. Each debtor's whole budget is its
uncovered loss less its ceiling-rounded share of the available insurance.
Clearing's existing attribution kernel supplies the affordable charge and
minimum lots for each opposite pair, including previously paid open gain.

One digit records the whole charge from a specific debtor to a specific
winner. The sum of a debtor’s charges cannot exceed its budget. The sums of
charged gains and matched lots must fit each original position. The verifier
orders feasible plans by descending recovery, ascending sum of squared
charges divided by eligible capacity, ascending matched lots, then D121
winner and pair priority. It uses integer comparisons throughout. An exact
search can resume from a trusted prefix bound to the original freeze and
proposal. A candidate with a feasible fill can still lose to a later one.
Only complete verification returns its fill schedules.

The [short proof](../../crates/default-plan-selection/src/multi_lot_bounds.rs)
can establish the same result without iterating over possible charges.

1. The proposed recovery must exhaust all debtor budgets or all eligible gains.
2. Each winner’s last selected marginal cost must be strictly below every
   first unselected cost. For the kth atom at capacity c, the cost is
   `(2k−1)/c`. This proves the winner totals are the unique best distribution.
3. The proposed lots must attain a lower bound from the winner schedules and
   the minimum number of participating debtors. When N fully charged debtors
   face N charged winners, closing just N lots requires their budget and
   charge multisets to match. Different multisets require at least N+1 lots.
4. In D121 order, each pair must take the greatest charge still allowed by
   its edge, debtor budget and winner total after the preceding pairs.

A missed bound leaves the proposal unproved by this method. Complete search
can still certify it off chain. The earlier one-lot deployment kept the
eight-member multi-lot comparison frozen. [Signed example and measurements](../operations/validation.md#exact-multi-lot-btc-comparison).

### How the multi-lot clearing certificate binds the inputs

In the local multi-lot candidate, valuation reads the original position and
its closed-first payment history. For a position of Q lots it stores the
greatest fraction below or equal to its exact eligible gain per lot with a
denominator at most Q. Every threshold for charging an integer atom on k lots
has denominator at most k. The stored rate therefore gives exactly the same
whole-atom capacity for every k from 1 through Q, including the minimum lots
needed for a charge. It occupies two eight-byte words per frozen row.
[Rate conversion](../../crates/clearing-accounting/src/attribution/lot_rate.rs).

The valuation cursor records whether every BTC claim visited was whole, including
flat creditors whose rows the keeper can omit from the matching instruction.
The cursor persists that fact across restarts. A previously unchecked prefix
cannot establish it. Snapshot formats 1 and 2 continue to identify the earlier
valuation paths. Formats 3 and 4 record a checked prefix with all-whole claims
or one containing a fraction. Original BTC/ETH claims retain their exact scaled
values in every format.

Clearing checks the complete valuation, listed gross lots, total face debt,
frozen market and settlement pools. It derives the budgets and capacities,
then reconstructs the compact plan under the four bounds above. A successful
certificate stores the charge against each side. Its receipt binds the original
capacity and rate of each winner, plus debtor ID, winner ID, charged atoms,
matched lots, base fill price and count of lots conceding one additional tick.
The worker can restart at this point. Each subsequent application verifies
against the same basis. An inconclusive bound keeps the episode frozen under
D122. [Clearing adapter](../../programs/clearing/src/instructions/account_safety/settlement/inventory_multi_lot.rs).

## Verifying a proposed linked BTC/ETH schedule

The [native financial entry point](../../crates/default-plan-selection/src/joint.rs)
takes the original rows in stable member order, both frozen marks, both lot
inventories and the clearing-owned entry/paid history for each member. Its other
inputs are paired charges and untrusted settlement rate and remainder-order
witnesses. It verifies the original rates before computing each debtor's
market budget from its share of the original post-insurance loss, rounded
down to whole collateral atoms.

For each distinct debtor/winner pair the verifier consumes opposite signed
lots, checks the winner's remaining positive face and charges only its eligible
open gain on the matched lots. It constructs both adjusted claim columns,
keeps the original cash collection split, verifies the revised greatest rates
and runs protected rounding. The receipt includes the loss removed from each
market capped at the charge, as an exact fraction. Eligibility of a proposed
schedule is one requirement for release. Clearing also needs authenticated
freeze membership and a proof that all competing allocations have been covered
or bounded under D116–D127. General native feasibility alone cannot release
funds. [Independent comparisons](../operations/validation.md#native-linked-market-reduction-admission).

## Selecting across a complete linked book

The native [comparison](../../crates/default-plan-selection/src/joint_search.rs)
derives each possible debtor/winner pair from verified frozen debt budgets,
opposite lots, positive claims and the clearing-owned entry and paid-gain
history. The range for a pair starts at zero. Its upper endpoint is the smaller
of the debtor's budget and the eligible gain on the lots the pair can actually
close. A caller can supply rate, rounding and reflection witnesses. Clearing's
financial kernel verifies their contents. Omitting a potentially winning
schedule's required witness prevents selection.

The exhaustive reference checks each combination against shared lot inventory
and the original cash split. Each eligible settlement must pass the protected
individual receipt and insurance tests. The two exact recovery fractions
determine the maximum total and market-balance score. Among tied recoveries,
the verifier compares proportional charge deviations and closure costs.
Frozen-member priority settles exact ties. If the financial profiles trade off,
the verifier requires the complete D127 market reflection. A modified fee bucket
in an otherwise mirrored book therefore leaves that book without a selection.

The [range verifier](../../crates/default-plan-selection/src/joint_search/ranges.rs)
can begin with a verified proposal. It bisects the widest remaining charge
interval. An interval can be discarded if its minimum charges already exceed
a budget, positive face or available lots. For each market, aggregate maximum
charges by debtor and cap each at its original budget. Also aggregate by winner
and cap each at its eligible gain. The smaller total bounds the entire market's
recovery. If the sum across markets is **strictly less** than the verified
incumbent's recovery, discard that interval. Equality retains every possible
competitor for the later financial comparisons. Checked leaves plus the sizes
of discarded intervals must exhaust the entire space. An exhausted work budget
returns no selection. The on-chain controller still needs authenticated, resumable
coverage before this rule can authorize cash. [Measured cases](../operations/validation.md#native-selection-of-linked-default-plans).


### Restarting a comparison on clearing-owned inputs

The [local diagnostic](../../tests/programs/frozen-plan/src/) reads the canonical prepared header, source resolution, frozen member page and original margin account. A proposal binds its per-member BTC and ETH charges in ordinal order. Anyone can resume from the comparison account. Each step checks the episode, source revision, original member and generation, recomputes eligible open profit from clearing’s entry/payment history and consumes the next committed pair of charges.

One cross debtor holding all the debt and its entire side of both markets admits a short proof when cash shares and creditor claims are whole atoms, pools are empty, each creditor belongs to one market and the proposed charges cover the entire post-insurance shortfall. The complete traversal establishes the highest selected and lowest unselected marginal charge in each market. Their ordering certifies proportional sharing, including the lot-cost and frozen-member tie rules. With the full shortfall covered, remaining claims pay at par. The receipt commits each member’s terminal cash, charges and matched lots. Sealing also reconciles total cash, remaining insurance and fees to the frozen allocation.

The proof program owns only its comparison account. Clearing stays frozen. A creditor with a debt in the other market needs a comparison of the original and adjusted recoveries and protected whole-atom payouts. [Signed measurements](../operations/validation.md#restartable-comparison-on-a-clearing-freeze).

### Verifying all schedules on a cross-creditor freeze

If a BTC winner owes ETH, the program must compare both settlements before it can count a charge as recovered loss. The [recovery verifier](../../programs/clearing/src/instructions/account_safety/settlement/recovery/search.rs) snapshots each of eight clearing-owned members, including their paid-profit history, and binds the checkpoint to the frozen prepared account, episode and revision. It verifies the original greatest settlement rates and derives eligible debtor/winner pairs from fundable shortfalls and opposing lots.

Each pair has an integer charge from zero through its verified ceiling. Together the charges give every schedule an ordinal. The program checks a proposed schedule against the [financial engine](../../crates/default-plan-selection/src/joint.rs), including insurance consumption, fractional payouts and the protected allocation of whole cash atoms. It records the sum of actual market losses removed, capped in each market by the charge. A worker may exclude an interval only when its maximum combined charge is strictly below the verified recovery. The remaining schedules require exact settlement or a verified financial reason for ineligibility. Invalid calculation witnesses cannot advance the cursor.

A new process can resume at the first unchecked ordinal. The first measured verifier at `ec12a834` accepted only a unique maximum total. The current comparison also verifies the [financial priorities on ties](#financial-priorities-on-equal-recovery). Its bounded representation admits one eight-member page, one rate proposal per settlement, a schedule count representable in 128 bits and a reduced score representable as signed/unsigned 128-bit integers. An unsupported book stays frozen. Clearing must authenticate a winning result and bind its exact payouts before this path can release cash. [Signed costs and wallet reconciliation](../operations/validation.md#recovery-verification-when-a-btc-winner-owes-eth).


### Financial priorities on equal recovery

For each admissible plan the on-chain verifier computes the recovery fractions in the two originally impaired markets and sorts them from least to greatest. Among plans tied on total recovery it prefers the larger fraction at the first difference. If both fractions tie, it compares each market’s deviation from proportional charges, weighted by the winning members’ eligible open gains. If those also tie, it compares the pairs of amounts charged and lots closed, separately for BTC and ETH. A strict improvement in one market can decide the result only if the other market does at least as well under that rule. [Shared financial comparison](../../crates/default-plan-selection/src/joint_priority.rs).

When the financial profiles match exactly, D121 orders winners using the venue, frozen episode and stable member IDs. Individual debtor/winner pair charges decide any further tie. A financial trade-off between markets keeps the comparison unsealed. The native selector can verify a D127 reflection, while the one-page on-chain comparison still requires dominance or an exact financial tie. A sealed checkpoint binds all eight cash balances, the signed movements from each market, insurance remaining and retained fees. Payout authorization belongs to clearing. [Signed cases and costs](../operations/validation.md#financial-priorities-on-a-signed-frozen-book).

## Clearing-owned payout binding

The local search uses a payer-sponsored `search` PDA. The [wire layout](../../programs/clearing/src/instructions/account_safety/settlement/recovery/layout.rs)
fixes eight roots, two markets and one greatest-rate witness for each evaluated
state. The payer selects a nonce. All economic terms come from the authenticated
prepared-settlement revision, original roots and frozen profit histories.
Anyone can continue an existing proof. A defeated or stalled proposal cannot
exclude a competing sponsor's proof.

Once every schedule is covered, [binding](../../programs/clearing/src/instructions/account_safety/settlement/recovery/binding.rs)
compares the sealed source with live frozen clearing state. The 496-byte
`RVJOINT1` record replaces completed traversal scratch in the prepared header.
It holds the frozen epoch, immutable search address, aggregate charges and
insurance spent, eight ordered member results, winning rank and schedule count.
Each member result carries its ID, two signed claim changes, two signed cash
movements and terminal funded cash. Binding makes no token transfer. Subsequent
application and reconciliation must use those exact individual results.

The qualified binary uses the ordinary frozen-page layout and its own explicit
local artifact selection. A new proof for another epoch must use an unused
payer/nonce pair. The test keeps the search account for audit and measures
transaction fees separately from rent. Unrepresentable proofs, missing
witnesses or incomparable tied outcomes keep the book frozen.

### Paged recovery receipt in the local candidate

The paged candidate allocates a sponsor-owned-cost proof PDA and authenticates
the original margin history of every frozen member. The prepared revision and
freeze epoch bind every proof step. After complete coverage, a single clearing
instruction checks all canonical frozen pages in order, the exact populated
tail, the original rows and every final balance against the sealed proof.
Each frozen row then holds its forced-close claim deltas, settlement movements
and final cash. The header records `RVPAGED1`, the epoch, search account, number
of members, charges, insurance use and schedule coverage. The transaction
advances to denominator verification only after all rows and both markets
reconcile. The normal rate, plan, Apply and withdrawal checks follow. The
[SBF measurements](../operations/validation.md#recovery-selection-across-two-membership-pages)
record which gates have run end to end.
