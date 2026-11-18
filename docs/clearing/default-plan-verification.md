# Verifying a joint default plan

The successor must establish three facts before anyone can collect a changed
payout. Each forced close must be admissible at the freeze. The plan must win
under the approved recovery, sharing and tie rules. Clearing must commit the
same result across both markets. The existing program provides part of the
last guarantee for ordinary terminal settlement. The small-cohort reference runs offline. The signed fixture below meters one
restricted plan family on a local validator.

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

The [program](../../tests/fixtures/default-proof/src/lib.rs) initializes one
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

A self-contained current position preserves permissionless recovery if the
venue's historical database becomes unavailable. A commitment makes the
ordinary footprint fixed but introduces a data-availability dependency that can
keep the cohort frozen under D122. The working recommendation is to meter the
self-contained representation on the common trade path, including the cost
of crossing a storage boundary. Choosing an operating policy for missing
storage or missing history affects trade and exit availability.
