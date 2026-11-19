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

The `linked-pair-qualification` clearing build accepts a bounded proof from the
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
9,989. That case provides an independent target for the next signed test.
