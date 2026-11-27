# Profit attribution and default verification

Clearing keeps two bounds on the average entry of each open position. Exceptional resolution can charge only eligible unpaid open gains. A second market can have a claim on the same debtor's funded cash.

## Entry, payment and partial close

Increasing exposure weights old and new inventory at their execution prices. A partial reduction retains average entry for the surviving lots. A close clears entry, and a flip starts the residual position at the execution basis. The trader receives the aggregate route price and each maker receives its own leg price. Any unpaid fixed claim stays with the account.

Ordinary payments draw only on the fixed component and are capped by the total positive market claim. An ordinary payment leaves the surviving lots' entry intact. All fresh margin slots are 40 bytes per market, including after repeated mixed-price increases. For frozen selection, clearing uses the highest possible entry for a long or the lowest for a short. It converts that endpoint to a canonical per-lot fraction on chain. The keeper proposes against the same fraction. This bounds the winner charge even when qualified exact histories would give different whole-atom outcomes. [Ordinary payout arithmetic](accounting.md#ordinary-payouts-on-closed-quantity) · [On-chain storage admission](../../programs/clearing/src/profit_attribution.rs)

The earlier RVPROF01 deployment permitted open-price payments after fixed claims. It reserved space to distribute those payments across the surviving lots. Its historical frozen records retain that interpretation. [Earlier attribution and storage bound](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md#storage-reserved-at-trade-admission)

## What clearing verifies

1. **Freeze.** Bind the venue, episode, complete Financial membership, original cash, accrued claims and position histories, market prices, pools, insurance and retained fees. Preserve the original division of each cross debtor's funded cash between markets.
2. **Establish baseline payouts.** Value the full book and derive the original creditor receipts and insurance use. During forced reduction, a winner’s eligible charge is bounded by its unpaid open price gain, whole-account market claim, matched lots and the attributable shortfall.
3. **Compare allowed reductions.** BTC and ETH can form a joint plan when the complete result protects other-market receipts and insurance. Maximize permitted recovery, apply the market-balance and proportional charge rules, then the lot and frozen-episode ordering rules. A proposed feasible schedule alone is insufficient.
4. **Apply and reconcile.** Clearing authenticates the selected schedule and market movements, checks conserving whole-atom payouts, applies each original member once, and verifies final custody before allowing resolved withdrawals. A keeper can submit or resume work. Its signature, database, simulation or proposed plan cannot authorize a different payout.

The local runtime selects an exhaustive or paged verifier from frozen inputs. A book that cannot be verified stays frozen. Tested recovery size, resources and restarts apply to the specific books in [validation](../operations/validation.md).

## One proposed reduction on a three-market frozen book

The native comparison starts with all frozen claims, cash, reserves and fees. It also requires one selected-market position record per financial member, including flat members, the frozen mark, and the 40-byte entry bounds. It recomputes the unadjusted settlement before testing the proposed debtor, winner and whole-atom charge.

- The charge must fit the named debtor’s own uninsured writeoff, the winner’s positive net claim, and the gain on the opposite lots that can actually close. The fixed-entry implementation computes the fewest lots and the integer price concessions. Closing the pair reduces the winner’s claim and the debtor’s debt by the same amount at the frozen mark.
- Each debtor retains its original exact division of funded cash. Recovered proceeds continue to follow the original destination shares until a debt is discharged. In three markets, a debtor owed proceeds in one market can owe at most two others. Once the first debt is fully paid, the other takes the remaining proceeds up to its own debt. Only the surplus goes to the debtor.
- In **each** other market, compare the complete result against the no-action baseline. Total creditor impairment and insurance use cannot increase. Each creditor must retain its exact recovery and its prior whole-atom receipt from that market, including amounts it must forward to its own creditors. First try ordinary terminal rounding. If a creditor loses an atom, solve the conserving rounding again with every protected receipt as a lower bound. An infeasible set of minimums rules out the close.

The result measures the target market’s actual impairment reduction, capped by the charge. It evaluates the feasibility of one proposed pair. Wider trading requires selection among competing and joint plans and authentication before withdrawal. The signed scope below qualifies the single-pair case. [Native comparison](../../crates/financial-core/src/clearing/three_market/reduction.rs) · [Qualification](../operations/qualification-scorecard.md#protected-three-market-forced-reduction)

## Signed three-market default with one eligible pair

The dedicated local build fixes five margin roots and three market addresses when the operator configures custody, before the first deposit. Only these roots can trade or deposit. One cross trader and four separately funded isolated makers build the book through ordinary signed fills. A separate fee payer can submit the freeze and resolution. Each wallet owner authorizes its own withdrawal.

At freeze the program authenticates the entire roster, requires every order to have finished, values the positions at the frozen indices and funding checkpoints, and checks that each market’s claims and lots balance. The commitment binds the venue, mint, slot, account addresses and serialized contents. The SPL vault must cover the allocated cash, fees and insurance. Unsolicited tokens confer no claim. Trading, deposits, repricing and withdrawals stop at freeze. The verifier first establishes that the supported book has a terminal solution.

The local verifier covers one BTC debtor, one flat BTC creditor and one cross trader who can concede BTC gain but owes both foreign markets. Let `D` be the BTC debt, `G` the trader's BTC gain, `C` the BTC debtor’s cash plus BTC insurance, and `H` the trader’s ETH and SOL debt left after its own cash. A concession of `x` removes that many atoms from both the BTC debtor's debt and the trader's gain. The trader's share of the remaining BTC payment is `C × (G − x) / (D − x)`. Both foreign creditors can still receive their full claims without foreign insurance precisely when that share covers `H`. For the admitted books `0 < H < C < D`, so the maximum protected whole charge is the floor of `(C × G − H × D) / (C − H)`, capped by the BTC shortfall and the frozen entry’s eligible lots and gain. Each additional feasible atom removes one atom of BTC impairment.

Resolution rechecks the commitment, verifies the exact maximum, and in one transaction settles every position, credits all five cash balances and debits the BTC insurance used. Only then can owners withdraw. The fixture admits integral terminal transfers for this specific pattern of debts. Competing winners, joint reductions, fractional terminal transfers and larger rosters require additional qualification. Venue clearing continues to support BTC/ETH. [Signed verifier](../../tests/programs/default-proof/src/three_market_default/) · [Reproduction](../operations/validation.md#checks-by-change)

[Selection and ordering](../../crates/default-plan-selection/src/) · [Settlement verifier](../../crates/financial-core/src/clearing/) · [On-chain controller](../../programs/clearing/src/instructions/account_safety/settlement/) · [Detailed equations, ranking and proof families](https://github.com/arnabnandikgp/rivalt/blob/9c4825830842b6cd316ebd6c8458ecc9d34e28a9/docs/clearing/default-plan-verification.md)
