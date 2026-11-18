# Verifying a joint default plan

The successor must establish three facts before anyone can collect a changed
payout. Each forced close must be admissible at the freeze. The plan must win
under the approved recovery, sharing and tie rules. Clearing must commit the
same result across both markets. The existing program provides part of the
last guarantee for ordinary terminal settlement. The successor checks below
are offline research.

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

The next implementation gate is a native, resource-metered proof with
authenticated stage storage. Benchmark verification and recovery before
activating any successor instruction or setting an operational deadline.
