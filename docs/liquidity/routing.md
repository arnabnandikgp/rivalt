# Routing and atomic execution

## Execution-time selection

D145 defines the ordinary market order for the fresh local demo. The SDK
previews an allocation and clearing selects it again from current state when
the order executes. Explicit signed-leg instructions bind the submitted maker IDs and quantities.

Solana locks all declared writable accounts for execution. A writer can land
between two fills in the same slot. A lock alone gives neither FIFO ordering nor
a guarantee that a submitted fill lands in that slot. Qualification must exercise
both transaction orders. The approved [standing quote](quoting.md#standing-execution-quotes)
uses the price at execution and survives its age alone. A reprice, disable or
depth consumption is visible immediately. The existing SDK signed-leg allocator
continues to use expiring publications.

### Clearing instruction and SDK builder

The local `execution-router-qualification` build exposes `execute_best_route`.
Its three maker bundles are mandatory in registry order. Each includes writable
capital and registration and read-only pricing program, ProgramData, shape and
price. The trader signs every structural epoch and their limits. Clearing journals
unused makers as reads and advances only the selected makers' financial state.
`buildBestRoute` prepends the required market and ledger checkpoints to the same
transaction. On the fresh local `bounded-entry` deployment,
the trader UI signs maximum spend or minimum proceeds, maximum fee, size and
expiry. The wallet saves the signed original and submits it directly over RPC.
Applications can opt into the authenticated relay, which queues conflicting
originals. Both transports preserve the signed bytes and trader state guard.
The wallet requests 800,000 CU, 128 KiB heap and zero priority fee.
The host selector visits at most 65,536 intervals and evaluates at most 131,072
gross quotes, counting repeats. Clearing additionally limits an order to 24 pair
intervals, 512 gross evaluations and four full financial admissions. Exceeding
any limit returns `RouteSearchLimit` (6133) and discards the incumbent. These
are work limits, independent of order size. Transaction-wide compute exhaustion
is still possible, including during account authentication or final settlement.

The opt-in `funded-routing` build also bounds each maker's searchable lots
using the funded cash in its isolated account. At the market's upper risk
price, the largest absolute inventory that cash could margin is
`floor(cash × 10,000 / (upper × IM_bps))`, capped at the position limit.
For a trader buy, add the maker's signed inventory to this bound. For a sell,
subtract its signed inventory. Clip the result at zero and at published
capacity. This preserves the opportunity to flatten a maker with little cash.
Negative claims, reserved funds and trader health can still reject quantities
inside the bound. Clearing runs full financial admission on the candidate.

One position can accumulate fills from different makers across orders. Each
legacy exact-size order must fit a single maker or a pair. For example, if each of
the three makers offers three lots, a nine-lot order cannot fill. The opt-in multi-maker instruction below extends this limit.

## Wide maker discovery in local qualification

The `wide-maker-discovery` program admits a sealed directory of 3–32 consecutive
maker IDs for a market. Each registration has its own PDA, pricing accounts and
isolated capital. The first three registration accounts also hold market
accounting totals. A fill assigns gross-lot changes, funding and collected fees
to the lane numbered `first filled maker ID % 3`. A checkpoint still reads
exactly three lanes. Additional makers retain their own consumed depth and
position. Makers sharing a lane still have separately margined capital and depth.

The wallet authenticates all registrations in one confirmed bank, prices
single makers and pairs, and includes three candidate bundles in the signed
transaction. On the legacy two-leg route a completed, financially admitted single or pair keeps its places.
If the preview finds no fill or reaches its search budget, the wallet ranks the
makers by average quoted price over the lots each could supply. It keeps a
higher-ranked maker only if the remaining fill slots can still cover the order.
If the whole directory is too shallow at that leg limit, it keeps the greatest
reachable depth. It fills spare account slots by price and returns the signed
IDs in registration order. A two-leg order can supply three candidate accounts
but its coverage estimate counts only two fills.

For ordinary orders on `funded-multi-maker`, the wallet compares its existing shortlist against a second selection priced across the full directory. When the cheapest combination uses too many makers, it retains the makers contributing the most lots and reprices the entire order on those books. It compares funded, fee-inclusive fills after the snapshot's maker, trader, price and fee checks, then fills spare account slots from the ranking. If the comparison reaches its work budget the wallet keeps its existing shortlist. This procedure can miss an economically feasible alternative when the unrestricted optimum needs more legs than the wallet can sign. Clearing always selects the actual quantities from the signed accounts at execution time.

The wallet bounds each maker by unconsumed depth, inventory, funded cash and
the numeric and average execution-price bounds. It can use the valid prefix
of a sloping book. For a given ranking the coverage calculation takes at most
one pass per permitted leg over the registered makers. It estimates depth at
the snapshot. A particular split can still fail its price collar, whole-account
margin or signed limit. Clearing authenticates the supplied makers and checks
current execution. The ranking does not certify the best all-in price over
every possible shortlist. [Wallet selection](../../packages/sdk/src/maker-shortlist.ts)

A supplied maker can reprice after signing and win the trade. A better offer
at an omitted maker requires a new order to reach it. Full-market price
discovery and the execution-time price guarantee therefore have different
coverage. Funding still observes the full registry. [Funding](funding.md)

## Wider atomic fills

On the opt-in local `multi-maker` deployment the wallet defaults to four signed candidates. A caller can request three through eight, subject to registered supply, or use the existing two-leg instruction. Clearing authenticates each supplied bundle and signed structural epoch. It limits each maker by current curve depth, inventory and its funded cash ceiling. It finds the marginal price that fills the exact order, assigns equally priced lots deterministically, verifies signed limits and runs full financial admission before committing. A failed final admission refuses the whole order. The multi-maker instruction does not search again for a worse-priced allocation that might pass a binding financial check.

The opt-in `funded-multi-maker` deployment also accounts for the adverse mark when sizing an opening leg from zero inventory and zero carried claim. For a maker buying from a trader, the unavoidable loss per lot is the amount by which even its most favorable price exceeds the lower risk bound. For a maker selling, it is the shortfall from the upper risk bound. Clearing caps lots by the funded cash available for both initial margin and this loss. The cap is exact for a constant quote on an otherwise clean isolated account. With sloping prices it is an upper bound. Accounts carrying inventory or an earlier claim retain the cash-and-inventory bound. Full post-fill financial admission decides every allocation.

For a curve with zero inventory skew, clearing counts the lots at or below a price cutoff directly from the maker's linear regions, starting at current consumed depth. Curves with inventory skew retain the monotone marginal search. Both paths apply the same cutoff, stable price ties, wallet limits and maker CPI checks.

Each selected capital takes its own opposite position. The trader receives one aggregate position change and pays the 2 bps fee once. The first filled maker determines the accounting lane. Longer fill receipts are journaled in bounded chunks belonging to the same instruction and trader nonce. The program, SDK and indexer retain the legacy route and receipt formats. [Signed widths and limits](../operations/performance.md#atomic-fills-across-three-to-eight-makers)

## Quote and settlement

The SDK reads a coherent snapshot and previews maker prices and account admission. The owner or scoped delegate signs exact size, side, all-in limits, maximum fee, expiry and structural epochs. Standing maker prices can change until execution. Each selected maker receives only its bounded read-only pricing dependencies. Clearing authenticates the response, checks all participants, applies position, fee and depth changes, and commits the whole route atomically.

Signed-leg instructions bind explicit maker identities and quantities and use expiring publications. Stored-order subfills and permissionless maker liquidation have additional authority and position guards. [Maker quoting](quoting.md) · [Liquidation](../clearing/risk-and-resolution.md#liquidation)

## Transport and measurements

Construct and measure the complete signed transaction, including checkpoints, signers and account locks. The qualified local stack uses v0 when it fits and supports v1 for larger messages. Simulator acceptance, wallet signing, landed execution and economically complete fills are separate outcomes. [SDK](../../packages/sdk/src/liquidity-route.ts) · [Signed workload measurements](../operations/performance.md)
