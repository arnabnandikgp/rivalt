# Clearing roadmap

20 November 2026. This is the active engineering plan for Rivalt. The starting
point is the locally qualified BTC/ETH prototype through P56. Its common clearing,
isolated maker capital, one collateral mint, index-derived risk, whole-account
funding and reservations, two-maker routes and current fees are the baseline for
the design comparison. P57–P62 from the audit plan are retired as future work.
[Status](../STATUS.md) records delivered work and [D111](../DECISIONS.md#d111--clearing-roadmap)
records the change in direction.

## PR tracker

The goal is to put the successor settlement and liquidation rules into Rivalt's
normal local clearing runtime. The ordinary launcher still selects P56. The
successor is already code in the clearing program. Its opt-in build has moved
test collateral all the way to wallets on Surfpool. Review, merge and selection
as the default build are three distinct milestones.

| Agreed deliverable | Where it stands | What remains |
|---|---|---|
| 1. Settlement and liquidation rules | The loss order, eligibility at freeze, cross-market protections, rounding and tie-breaking are decided. [Decision D112](../DECISIONS.md#d112--capped-adl-and-proportional-residual-recovery) and [the binding contract](../DECISIONS.md#d139--bind-joint-recovery-inside-clearing-before-applying-cash) describe who can be charged and when the result becomes spendable. | Implementation and operating coverage below. The one deferred **policy** question is how a future live venue handles a prolonged freeze if nobody can prove a valid payout. |
| 2. Functional code ownership | Whole-account risk and shared position accounting have crate owners. [Risk engine PR](https://github.com/arnabnandikgp/rivalt/pull/91) · [source map](#functional-ownership). | Finish the execution, liquidation and settlement boundaries. |
| 3. Ordinary settlement | A trader who closed against a different maker received 970 net atoms in the wallet. [Ordinary payout](https://github.com/arnabnandikgp/rivalt/pull/99) · [combined run](../operations/validation.md#combined-clearing-lifecycle). | Measure how long a backed claim waits with a continuously running worker and a prepared backing certificate. |
| 4. Forced liquidation | A maker took 10 lots and a consenting funded receiver took five. The trader kept 35 once healthy. [Liquidation PR](https://github.com/arnabnandikgp/rivalt/pull/100) · [combined run](../operations/validation.md#combined-clearing-lifecycle). | Have the keeper find and execute these paths from live inputs, including the case when neither can fill. |
| 5. Default and recovery | Clearing verified 340 possible schedules for eight frozen members, bound the winner, reconciled, and paid two wallets. [Clearing verification](https://github.com/arnabnandikgp/rivalt/pull/137) · [combined qualification](https://github.com/arnabnandikgp/rivalt/pull/138). | The keeper now selects, submits and resumes on two eight-member books through wallet exit. Both nine-member cases paid the wallets and replayed in fresh databases. Sustained mixed traffic remains for deliverable 6. |
| 6. Shared writes and qualification | In 36 paired fills, routes across distinct makers on BTC had no writable account in common. Routes through the same maker still share its capital and registration. [Measurements](../operations/performance.md#paired-routes-on-the-recovery-candidate). | Measure sustained mixed traffic, include recovery and ordinary exits, and make a separate local promotion decision. |

### What a default freeze means

An ordinary profitable close records a claim. Once clearing verifies the
backing and pays it, the trader has funded cash they can withdraw. An
under-maintenance account can instead have part of its position closed by a
maker or transferred to a funded, consenting receiver. Trading exposure changes
hands here. If the account recovers maintenance, liquidation stops.

Default determines who receives the available cash when obligations cannot
be met. In the successor, debtor resources go first, then
the originating market's insurance. Eligible opposite positions can be forcibly
reduced within the approved caps to protect closed claims. Any remaining loss
is allocated explicitly. A *proof* supplies clearing with a proposed set of
reductions and the calculations it can check against the original frozen book.
The submitter has no discretion to choose a cheaper payout.

The combined build verifies exactly eight frozen members and its supported
insurance calculation. This limit applies to the verifier. Account registration has its own capacity rules. A separate verifier reached all 2,548 schedules for nine members over two pages, including a creditor who had already closed. Clearing has bound all nine payouts and refused a premature withdrawal. In a second nine-member freeze, the insurance calculation needed two passes and the flat creditor withdrew 4,996 atoms. The larger 2,548-schedule search also paid all four withdrawals and matched 134 events on fresh replay. Another payer can resume a valid proof or submit a
different proposal for the same frozen inputs. Affected funds can remain frozen
indefinitely if no plan can be verified. Even a verified plan must be applied
and reconciled before withdrawal. No timer changes anyone's entitlement.
[Release policy](../DECISIONS.md#d122--exact-proof-before-prototype-release)
· [signed limits](../operations/validation.md#combined-clearing-lifecycle).

### Upcoming PRs

These are outcome-sized PR scopes. The numbers below are roadmap positions.
Add the GitHub link when a PR opens, and record its tested revision, limits and
next action in [Status](../STATUS.md). Independent rows can advance alongside
each other. A row closes after its acceptance evidence and merge.

| Planned PR | Status / PR | Dependency | What closes it |
|---|---|---|---|
| 1. Recovery keeper for the supported book | [In Review, PR #140](https://github.com/arnabnandikgp/rivalt/pull/140). Automatic selection, proof submission, restart and wallet exits passed on 340- and 2,548-schedule books. [Signed results](../operations/validation.md#automatic-recovery-keeper). | [Combined clearing PR](https://github.com/arnabnandikgp/rivalt/pull/138) | From authenticated frozen accounts alone, find the schedule, generate calculation witnesses, submit and resume after restart. Repeat the signed payout and fresh SQL replay against independently calculated cash, insurance and inventory. Report cost and an explicit blocked reason for unsupported books. |
| 2. Recovery across membership pages and insurance passes | [In Review, PR #141](https://github.com/arnabnandikgp/rivalt/pull/141). Both nine-member cases reached four wallet withdrawals after restart. On each, fresh PostgreSQL replay matched 134 events. One checked all 2,548 schedules. The other verified two insurance passes. Three passes have native coverage. [Evidence](../operations/validation.md#recovery-selection-across-two-membership-pages) | The frozen-book contract is available now. Use the keeper from 1 for end-to-end acceptance. | Settle at least the nine-member case including flat creditors, and a case needing another insurance pass. Check fixed collections, foreign creditor and insurance protection, rounding, complete membership, interruption, wallet exits and cost. Publish the measured envelope. |
| 3. Time from close to spendable cash | Ready | Can start now on the qualified ordinary payout path. | With the worker already running, time close, backing availability, payment and SPL withdrawal separately. Repeat with delayed backing and restart. Decide from these results whether an atomic close-and-pay path for already-backed claims is worth implementing. |
| 4. Automated maker liquidation and funded receiver selection | Ready | Can start now on the signed liquidation path. | The keeper discovers eligible quotes and consenting funded capacity, stops when neither can fill, resumes on fresh capacity and stops at restored health. Reconcile position, fees and cash after each step, and identify who paid transaction costs. |
| 5. Complete financial domain ownership | Ready | Can start now. Coordinate moves with edits to the same handlers in 1, 2 and 4. | A reader can follow a fill, forced reduction and payout to a single rule owner and its on-chain enforcement. Verify affected financial vectors, ABI, signed transactions and CU before and after extraction. |
| 6. Sustained qualification and local runtime selection | Waiting | After the preceding behavior is integrated on one pinned artifact. | Publish landed workload, same-maker and distinct-maker contention, cost by payer, recovery and wallet exits with fresh replay. Document limits and either select the build for the normal local launcher or record the specific unmet gate. |

This scope ends at local engineering qualification. A production freeze
deadline, funded backstop economics, independent maker validation (P15B),
independent review and funded readiness (P16B), and the deferred 24-hour
endurance run remain outside these PRs.

## Original deliverables and acceptance criteria

Each row is a reviewable deliverable. Dependencies follow the financial behavior
being changed. Source extraction can proceed against today's behavior while the
selected loss rule's eligibility and execution terms are being tested.

| Deliverable | Scope | Review evidence |
|---|---|---|
| 1. Settlement and liquidation contract | Specify the actors, admissible transitions, accounting deltas and settlement finality. Build an executable comparison of today's exact settlement and a candidate with forced reductions of opposite positions (ADL) and explicit residual claims. | Independently derived balances, inventory, insurance and loss bearers for ordinary payout, price reversal, cross-market debt/cycles, fees, fractions, bankrupt makers and insufficient ADL capacity. Show the economic differences for decision. |
| 2. Functional code consolidation | Give the risk engine a crate with a small public API and each other financial operation a discoverable owner. Extract the existing behavior through the normal clearing entrypoints. Publish the equation-to-code map with the extraction. | Follow a withdrawal or liquidation from instruction to the exact rule and atomic commit. Check matched financial vectors, authorization, ABI/IDL/SDK and signed domains. Compare affected compiled stack and CU against the pre-extraction pin. |
| 3. Ordinary settlement | Measure collection of open-position losses and time from eligible claim to funded gain. Improve worker and on-chain progress, and evaluate close-and-pay where current cash and backing checks permit it. | Verified close with a different maker, delayed collections, partial payments, price changes and interruption. Report why payment waited. Show funded and pending amounts in the SDK, indexer and UI. |
| 4. Forced liquidation and backstop | Route eligible partial reductions through admitted maker quotes with independent price bounds. Integrate consent, funded capacity, compensation and unwind rules for receivers. | Whole-account deficit improves after all fees. Demonstrate no quote, insufficient receiver capacity, stale oracle, competing attempts, and preservation of the trader's remaining exposure and cash. |
| 5. Default and recovery | Implement the selected rules for debtor recoveries, market insurance, ADL and unpaid claims. Specify when the loss becomes binding, cross-market attribution, rounding, freeze scope and resumption. | Complete conservation across all affected obligations including flat accounts, no eligible opposite position and depleted insurance. Demonstrate bounded, authenticated continuation after restart. Eligibility and execution terms must pass the deliverable 1 gates. |
| 6. Shared writes and qualification | Baseline same-market locks on the existing paths, then change ownership where measurements justify it. Qualify the resulting clearing lifecycle and its effects on makers and users. | Compare matched distinct-maker and shared-maker workloads, signed Surfpool RPC/WS results, PostgreSQL replay, exit, CU, transaction sizes, costs by payer and landed throughput. Verify aggregate exposure caps, fee carry, funding history and complete payment backing. |

### Earlier evidence by deliverable

The tracker above owns current status. The following checkpoints show how
individual cases were verified as the implementation developed.

The
[ordinary payout demonstration](../operations/local-development.md#ordinary-payout-demonstration)
follows one cross-maker close from claim to wallet. Its deliberately delayed
first payment exposes the intermediate state. A separate continuous-worker
measurement with an already prepared certificate would be needed to decide
whether to optimize payout timing or finance earlier access to cash.

The [maker liquidation candidate](../operations/validation.md#maker-liquidation-and-funded-receiver)
now demonstrates a partial maker fill, a blocked interval, a consenting receiver,
and its unwind. The [single-debtor BTC recovery](../operations/validation.md#single-debtor-btc-recovery)
now follows one verified freeze through insurance, funding of the creditors,
withdrawal and return to custody. On the same 8,498 available atoms, the approved
successor model shifts 149 from the open winning maker to the flat trader.

The [attribution candidate](../operations/validation.md#clearing-owned-surviving-profit)
now retains exact per-lot entry and paid gain through fills, backed payment,
compulsory reduction and the freeze. The [sponsored capacity qualification](../operations/validation.md#sponsored-profit-capacity)
also admitted the previously rejected order, repaid a replacement contributor
and preserved the rent credit through a restarted default. The
[verified BTC payout](../operations/validation.md#verified-btc-default-payout)
now gets the 996 atoms into the flat trader’s wallet. [BTC residual recovery](../operations/validation.md#btc-residual-recovery)
also pays the trader when eligible gain covers part or none of the loss and
when the forced reduction needs several lots at two prices. The [multi-winner recovery](../operations/validation.md#multi-winner-btc-recovery)
now covers proportional charges, minimum lots and frozen-episode tie ordering for
a single BTC debtor holding its entire side of open interest. Next verify linked
books where BTC and ETH recovery decisions depend on each other.
Native linked settlement keeps the original debtor cash split and protects individual foreign-market payouts through final whole-atom rounding. [Settlement contract](default-plan-verification.md#joint-recovery-and-frozen-cash-ownership).
The [mirror comparison](default-plan-verification.md#when-the-two-markets-trade-places)
now has an approved final ordering under D127 and a signed diagnostic.
The [two-market freeze comparison](../operations/validation.md#signed-two-market-default-comparison)
binds the model to actual clearing roots. Ordinary recovery paid both maker
accounts, while the BTC-only certificate correctly refused the linked book.
The [linked clearing candidate](../operations/validation.md#clearing-verified-linked-default-and-wallet-exit)
verified both charges against the same membership and preserved the original
cash split through two SPL withdrawals. The [flat BTC creditor](../operations/validation.md#closed-btc-claim-in-a-two-market-default)
withdrew 4,996 under joint clearing and 4,994 under ordinary clearing.
With two eligible BTC makers, D130 uses a full member scan in each linked
episode. Each maker's share follows its frozen eligible gain. Both market
targets must be satisfied before any member can receive money. The
[verification contract](default-plan-verification.md#linked-allocation-across-competing-winners)
specifies the exact scope.

A BTC winner whose gain backs an ETH debt now has a signed path through both
wallet withdrawals. One transaction authenticates both winners' charges and the
original and effective creditor entitlements. [Payment and measured cost](../operations/validation.md#atomic-payment-for-a-btc-winner-with-eth-debt).

Two BTC debtors now compete for the same two single-lot winners in a real
frozen book. Ordinary clearing paid 19,998 and 20,002 atoms. Independent
exhaustive search and the native allocator selected separate one-lot closes
and equal 20,000-atom credits. The local clearing candidate now verifies
both debtor budgets and distinct winning lots, and each maker withdrew 20,000.
With insufficient opposing gain, the
[partial-inventory case](../operations/validation.md#scarce-winning-inventory-and-flat-btc-claims)
also pays the flat maker 19,996 and checks both a zero-capacity winning lot and
a rounded-zero debtor budget. The [general native matcher](default-plan-verification.md#matching-a-population-of-single-lot-debtors-and-winners)
now verifies a three-debtor assignment against real frozen positions. The [local clearing verifier](../operations/validation.md#clearing-verified-single-lot-book) paid all three predicted wallet amounts. The [resource qualification](../operations/validation.md#active-positions-and-frozen-page-placement) measured 22 dispersed positions and 162 dense positions on the revised verifier. The [multi-lot comparison](../operations/validation.md#exact-multi-lot-btc-comparison) now reproduces the independently selected nine-atom allocation on an eight-member freeze. The [signed clearing proof](../operations/validation.md#clearing-verified-multi-lot-recovery) now carries that allocation through both wallet exits. The [paired-route measurement](../operations/performance.md#paired-routes-on-the-recovery-candidate) now identifies the two shared writes across distinct BTC makers. At that checkpoint the parallel route still needed an explicit contract for per-fill insurance carry and market funding. The [native linked-book verifier](default-plan-verification.md#verifying-a-proposed-linked-btceth-schedule) now checks fill eligibility, fixed collections and protected BTC/ETH outcomes. The [native selection comparison](default-plan-verification.md#selecting-across-a-complete-linked-book) now verifies the winning schedule across both markets on bounded books. A [restartable signed comparison](../operations/validation.md#restartable-comparison-on-a-clearing-freeze) now verifies competing allocations for one cross debtor and independent creditors. An [eight-member cross-creditor freeze](../operations/validation.md#recovery-verification-when-a-btc-winner-owes-eth) now has a signed, restartable proof of the unique highest recovery and its protected cash vector. General release remains open. The approved fee prototype must reconcile all of a market’s fees before any insurance spend.
[Measured comparison](../operations/validation.md#two-btc-debtors-sharing-winning-inventory).
The current tracker above records the subsequent joint selection and shared-write results and the remaining scale and cost work.

## Functional ownership

The risk and position-accounting crates implement the first extraction in deliverable 2. The other rows identify the remaining domain boundaries. The clearing program links the pure Rust financial rules into the on-chain
binary. Workers request transactions and the indexer records finalized outcomes.

| Where to look today | Target owner | Question it answers |
|---|---|---|
| [Financial primitives](../../crates/financial-core/src/lib.rs) and [margin state](../../crates/financial-core/src/margin.rs) | Accounting module for typed cash, claims, positions, funding accrual and paired deltas | What balances and obligations changed? |
| [Whole-account risk](../../crates/risk-engine/src/lib.rs), [orders](../../crates/risk-engine/src/orders.rs) and [program risk adapter](../../programs/clearing/src/engine/risk.rs) | `crates/risk-engine`, reading positions from `crates/clearing-accounting` and authenticated price/funding inputs | Can this account trade or withdraw, when is it liquidatable, and does reduction improve health after fees? |
| [Route rules](../../crates/financial-core/src/route.rs), [liquidation rules](../../crates/financial-core/src/liquidation.rs) and [maker route handler](../../programs/clearing/src/instructions/maker_liquidity/routes/) | Execution and liquidation modules calling accounting and risk | Which maker fill or receiver transfer is admissible, and what atomic update follows? |
| [Backing](../../crates/financial-core/src/backing.rs), [default solver](../../crates/financial-core/src/clearing/), [claims](../../programs/clearing/src/instructions/account_cash/) and [resolution controller](../../programs/clearing/src/instructions/account_safety/resolution/) | Settlement and resolution engine with program adapters for authenticated continuation | How does a claim become cash, and who bears a deficit? |
| [Clearing instructions](../../programs/clearing/src/instructions/), [state](../../programs/clearing/src/state/), [settlement worker](../../packages/services/src/account-settlement-worker.ts) and [indexer](../../packages/indexer/) | Thin on-chain authority/custody adapters, off-chain services grouped by domain and finalized projections | Who can call it, who signs or retries, and where can a user verify the outcome? |

Each domain's overview should identify its public functions, callers and independent
test cases. Keep dependency direction from program and workers toward domain APIs,
with accounting types shared beneath the risk and settlement calculations.

## Initial model cases

The [executable comparison](architecture-review.md#executable-settlement-and-liquidation-comparison)
reports the cash, inventory, insurance and unpaid claims under each alternative.
Its starter cases use whole collateral atoms at one frozen valuation.

- **Who bears a remaining loss?** BTC owes 60 to a flat but unpaid trader and 40
  to an eligible open winner. Debtor cash supplies 80 and BTC insurance supplies
  10. Equal recovery of unpaid claims gives them 54 and 36. A policy assigning the
  entire remaining 10 to the open winner gives them 60 and 30, assuming sufficient
  eligible position and profit. Both pay 90. When the winner can absorb only 6,
  proportional allocation of the remaining 4 produces whole payouts of 57 and 33.
- **Which market bears a cross-account loss?** One account owes 80 BTC-market
  units and 40 ETH-market units, all denominated in the same collateral. Its 90
  cash covers 60 and 30 under current proportional own-cash collection in default.
  That leaves 20 and 10 respectively before market insurance. Cross-account cash
  cannot be counted twice. Separate fixtures cover a collectible opposite-market
  claim and a cashless cycle with an external creditor.

[D112](../DECISIONS.md#d112--capped-adl-and-proportional-residual-recovery)
sets finality at funded cash and selects capped ADL with proportional residual
recovery. The [eligibility experiments](architecture-review.md#eligibility-at-the-freeze)
show charges moving across makers after a close/reopen or a subaccount split.
The [payment comparison](architecture-review.md#which-profit-an-ordinary-payment-settles)
replays both conventions through signed funding, partial closes and re-entry.
[D113](../DECISIONS.md#d113--closed-first-payment-attribution) selects payment of
the positive fixed claim first, including signed accrued funding.
[D114](../DECISIONS.md#d114--verified-freeze-cutoff-for-loss-eligibility) binds eligibility at the
first verified freeze that commits for the episode. The [cutoff comparison](architecture-review.md#when-default-eligibility-becomes-binding)
quantifies how proof timing changes payouts. The [signed runtime comparison](../operations/validation.md#signed-source-publication-and-freeze)
supports submitting a named-debtor proof against already-published read-only feeds. [D116](../DECISIONS.md#d116--maximize-recovery-then-share-the-charge-proportionally)
selects maximum recovery followed by proportional charges. [D117](../DECISIONS.md#d117--frozen-cash-attribution-and-protection-of-the-other-market)
fixes debtor cash attribution and protects the other market’s payouts and insurance.
The [linked creditor cases](architecture-review.md#who-bears-the-cross-market-effect)
quantify both choices. The [individual payout comparison](architecture-review.md#protecting-individual-creditor-payouts)
supports [D118](../DECISIONS.md#d118--protected-rounding-for-foreign-creditor-payouts),
which permits a conserving reassignment of fractional remainders when ordinary
rounding would harm a foreign creditor. The [joint default comparison](architecture-review.md#competing-debtors-and-simultaneous-market-defaults)
checks shared maker lots, cross-market payout floors and feasibility when both
markets reduce positions in the same freeze.
[D119](../DECISIONS.md#d119--verified-joint-reductions-in-one-frozen-episode)
selects joint admission with an indivisible financial result across both markets. [D120](../DECISIONS.md#d120--total-recovery-before-market-balance)
selects maximum total recovery followed by balanced market recovery on ties.
[D121](../DECISIONS.md#d121--frozen-episode-ordering-for-exact-plan-ties)
sets the final member tie order. The [verification contract](default-plan-verification.md)
maps proof obligations to the existing freeze and settlement controllers.
The [continuation reference](default-plan-verification.md#restarting-verification-when-a-bound-misses)
checks whole joint candidates in committed ranges. The [metered fixture](default-plan-verification.md#measured-nine-account-verifier) now has signed restart
evidence for a funded nine-account family. The [input comparison](default-plan-verification.md#what-the-freeze-must-retain-about-open-profit) identifies the two
exact survivor amounts and measures checkpoint versus history storage. The [signed growth test](default-plan-verification.md#signed-storage-boundary) measures an atomic
sponsor top-up. D123 selects per-account growth capacity and voluntary sponsors. Prove compulsory-reduction capacity independently. General linked-book verification
and clearing adoption remain open. [D122](../DECISIONS.md#d122--exact-proof-before-prototype-release)
requires an exact proof and defers the production timeout policy.
Keep the active proportional settlement until
the successor eligibility, pricing and continuation rules are qualified. The
[architecture review](architecture-review.md#next-deliverable-and-acceptance)
contains the transition and adversarial-case checklist.

For deliverable 6, [paired signed routes](../operations/performance.md#aggregate-insurance-on-the-same-workload)
now isolate the cost of moving insurance classification to a market checkpoint.
The remaining two shared writes maintain gross lots, funding and complete
payment backing as well as fee escrow. A parallel fill must preserve the
aggregate gross cap when traders switch makers, and the same funded gain must
remain spendable after any valid interleaving. The native capacity and funding
comparison reproduced the existing clearing totals. The [D138 local program](../operations/validation.md#signed-bounded-market-gross) now returns current gross from the market and its maker capacities. Removing the shared market write also requires recovering the last valid funding index when the next action occurs after expiry, including funding materialized for ETH by a BTC cross-account fill. The [read and accounting trade-off](../operations/performance.md#gross-lots-funding-and-payment-backing-on-parallel-fills)
covers all three responsibilities. The [signed checkpoint publisher](../operations/validation.md#clearing-verified-funding-checkpoints)
now preserves both markets through a publication gap. The [read-only route](../operations/validation.md#read-only-market-on-a-signed-fill) removes the shared market write on signed single-market fills. The distinct-maker BTC pair still shares its ledger. The [ledger prototype](../operations/validation.md#profit-payment-and-parallel-ledger-reads) now removes that last shared write on a single-market fill. The eight-member payout and complete freeze reconcile with current fee and backing totals. The native optimality comparison now reproduces the individual balances on three retained freezes. Two [signed equal-recovery comparisons](../operations/validation.md#financial-priorities-on-a-signed-frozen-book) now exercise proportional charges and the final frozen-episode member ordering on authenticated inputs. Two signed eight-member books now use clearing’s own selected result through wallet exit, including a cross-market obligation and a frozen member-order tie. The [contract](default-plan-verification.md#clearing-owned-payout-binding) describes the local eight-member admission boundary. The [combined clearing lifecycle](../operations/validation.md#combined-clearing-lifecycle) now verifies contention, complete fee classification and the eight-member protected wallet exits on one binary. The same binary preserved funding over an outage, paid a backed gain after a later fill changed the book, and restored maintenance through a maker fill followed by a consenting receiver. The local qualification is in Review. Terminal recovery is verified for the admitted eight-member books. The keeper now generates proposals from those frozen histories. Larger recovery cohorts and runtime promotion remain open.

Model ordinary payment from deposited collateral first. A settlement advance
facility requires measured timing demand plus an identified funder, repayment
priority and loss bearer. A separately funded receiver takes inventory risk.
Consider sharing realized receiver surplus with insurance only after costs and
capital needs are measured. Reserve investment, public LP capital and borrowing
are deferred. P15B independent participation and P16B independent review/funded
readiness remain external gates. Continuous 24-hour endurance remains deferred.
