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
exact-size order must fit a single maker or a pair. For example, if each of
the three makers offers three lots, a nine-lot order cannot fill. The program
already receives writable capital and registration for all three candidates.
Adding a third fill leg would require three-way allocation and corresponding
atomic admission, fee and state updates. Adding a fourth candidate would also
change the account list and signed registry epochs. [Qualification](../STATUS.md)

## Quote and settlement

The SDK reads a coherent snapshot and previews maker prices and account admission. The owner or scoped delegate signs exact size, side, all-in limits, maximum fee, expiry and structural epochs. Standing maker prices can change until execution. Each selected maker receives only its bounded read-only pricing dependencies. Clearing authenticates the response, checks all participants, applies position, fee and depth changes, and commits the whole route atomically.

Signed-leg instructions bind explicit maker identities and quantities and use expiring publications. Stored-order subfills and permissionless maker liquidation have additional authority and position guards. [Maker quoting](quoting.md) · [Liquidation](../clearing/risk-and-resolution.md#liquidation)

## Transport and measurements

Construct and measure the complete signed transaction, including checkpoints, signers and account locks. The qualified local stack uses v0 when it fits and supports v1 for larger messages. Simulator acceptance, wallet signing, landed execution and economically complete fills are separate outcomes. [SDK](../../packages/sdk/src/liquidity-route.ts) · [Signed workload measurements](../operations/performance.md)
