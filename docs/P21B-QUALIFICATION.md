# P21B — group wallet UI and bounded qualification

This is implementation preparation on P21A's verified stacked head. WORKLOG owns
actual status. Browser/build preparation does not close A26B or M7.

## Wallet and account contract

The existing trader shell selects its explicit deployment configuration version.
Version 1 retains its UI; version 2 uses P21A's qualified local group/artifact
binding, one test mint, portfolio zero and immutable isolated/cross accounts.
The initial creation choices are cross child zero, isolated BTC child one and
isolated ETH child two. Other existing trader children in portfolio zero remain
selectable. Maker capital and other owners/portfolios are not selectable collateral.
Mode conversion is unavailable. An empty owner portfolio is read directly through
its canonical PDA before any child exists, rather than inferred from registry roots.

SDK builders reconstruct signed actions from authenticated RPC state. Display cash
once per selected account, both market claims/funding and current reservations.
Positive unpaid claims/correlation credit stay zero. Unknown required prices hide
risk/headroom values, and complete-group certification/simulation remain required
for exits and allocation. Every verification-only page says that no cash moves yet.
Owner-authorized flat claim netting is a separate explicit action.

The UI supports direct deposit, certification, allocation, cancellation, withdrawal,
owner delegate management, persistent limits/stop-limits and existing-position
TP/SL. Trades are rebuilt by the direct SDK with explicit user fee/all-in limits,
then sent as immutable originals through service ingress. No HTTP-supplied message
is signed. The owner-portfolio UI displays and manages delegate permissions; the
SDK/service retain delegated execution, without presenting an owner’s sibling
cash as delegated authority.

Unsigned reviews bind wallet, selected account and selected market. Any change
invalidates them, including a change during a wallet prompt. Exact signed bytes
are saved before broadcast under the schema/genesis/anchor/group/owner identity;
receipts survive reload and unknown outcomes cannot silently become new signatures.
Direct cancellation/exit remain available when read/execution APIs are unavailable.
All balances and input conversions use integers; BTC/ETH lot scales differ.

`/v2/events` and `/v2/trades` add optional `latest=true`, with at most 100 rows,
a repeatable-read snapshot and ascending returned display order. Cursor reads
retain their existing ascending semantics; latest plus an explicit cursor is
rejected. This supports recent actual venue fills, not synthetic candles or fills.

## Acceptance sequence

1. Run affected UI/unit/type/build checks. Verify actual Wallet Standard browser
   creation/deposit, wallet/account review invalidation, both-market cross and
   isolated trades, TP/SL, explicit allocation, stale refusal/cancel, API-stopped
   funded exits and saved original receipts through real RPC/WS/PostgreSQL.
   `bash ops/group-indexer-smoke.sh --browser` is the prepared scoped driver;
   it requires the current `pnpm build:trader` output and installed Chrome.
2. Run the declared 300-second mixed-market workload at 0.5 offered attempts/sec
   on a clean pinned revision. Record the complete offer population and explicit
   eligibility/refusal/submission/finalization denominators, p95/p99 latency,
   account/group/maker contention, source/maker/RPC faults, process/indexer restart,
   actual final exits and fresh PostgreSQL replay. Compare isolated/cross funded
   capital at identical risk settings. Do not infer this acceptance from the
   sequential browser or P21A worker runs.
3. Reconcile raw accounts/tokens/claims/fees independently; investigate every
   unexplained difference and unresolved original. Record measured technical
   limits and provisional assumptions without weakening risk/source policy.

The browser fixture uses internal wallets and signed synthetic source updates.
Its fixture source qualification is explicit and sequential around test actions;
continuous funding/trading contention belongs to the workload, not an implied
property of this browser check. Existing maker epochs/budgets remain unchanged.
A build warning about bundle size is a measurement, not acceptance of UI latency.
No new continuous 24-hour, devnet/funded, paid-service, hedge or external-review
work is authorized. P15B/P16B remain Open and D42 remains Deferred.
