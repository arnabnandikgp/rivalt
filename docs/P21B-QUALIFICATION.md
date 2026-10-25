# P21B — group wallet UI and bounded qualification

The [qualification report](evidence/P21B.md) records incremental browser/workload
checks and measured limits on P21A's exact parent. WORKLOG owns actual status;
Review remains distinct from integration or funded readiness.

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

Unsigned preparation reads provisional confirmed state; displayed balances remain
finalized. Execution rechecks the signed dependencies. Unsigned reviews bind wallet,
selected account and selected market. Any change
invalidates them, including a change during a wallet prompt. Exact signed bytes
are saved before broadcast under the schema/genesis/anchor/group/owner identity;
receipts survive reload and unknown outcomes cannot silently become new signatures.
Direct cancellation/exit remain available when read/execution APIs are unavailable.
All balances and input conversions use integers; BTC/ETH lot scales differ.
Persistent order limits are checked against 9,000–110,000 atoms/lot and triggers
against 10,000–100,000 before review. Ordinary orders use generation zero even
after closing/reopening; reductions bind the live position. Replacement loads
existing terms and rejects changes to immutable side/mode/generation or a fee
budget below already charged fees. The program remains the final authority.

`/v2/events` and `/v2/trades` add optional `latest=true`, with at most 100 rows,
a repeatable-read snapshot and ascending returned display order. Cursor reads
retain their existing ascending semantics on the underlying numeric sequence; latest plus an explicit cursor is
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

## Bounded workload profile

`bash ops/group-indexer-smoke.sh --workload` creates a fresh local deployment and
PostgreSQL database, uses the qualified P20 binaries and requires a clean revision.
It declares 150 attempts at absolute two-second intervals over 300 seconds. Late
scheduler offers and pending-account refusals stay in the offered denominator;
rejected unsigned previews, failed signed transactions and finalized fills remain
separate. Finality latency uses finalized originals only, with its count; p95/p99
are nearest-rank samples. Closing inventory after the offered window is a separate
drain population, never added to offered availability or throughput.

Cross capital is 1,000,000 atoms and isolated BTC/ETH each 500,000. Real unsigned
100-lot probes compare the same source/risk settings and equal combined capital;
these are not additional fills or a correlation discount. Synthetic source updates
run continuously, except ETH publication at seconds 50–85. The first signed workload
original after second 100 receives a real accepted-send acknowledgement loss and
executor SIGKILL/restart. BTC maker A stops at 125 and restarts at 205; ETH funding
stops/restarts at 220/226 and indexer at 232/238. Recovery windows remain in their
explicit fault populations; actual times and process identities are retained.

The workload closes trader and internal maker inventory with real routes. It
attempts direct-RPC one-atom exits while samplers still run, records every certification and
refusal, then explicitly stops samplers/makers/publication for final drain if needed.
A quiescent exit does not establish busy-group availability. Final originals and
operator fees must reconcile with no unresolved signed effect, all inventory flat,
retained account claims, actual token exits and fresh PostgreSQL reconstruction.
The independent auditor recalculates per-fill maker notional, whole-account funding
realization from observed endpoints, generations and fee/cash/token conservation.
It does not reuse the SDK allocator or claim independent oracle-policy calibration.

The browser checkpoint passed on `a0ed6de`: 25 finalized wallet originals, twelve
checks, 101 WS observations, fresh 22-account replay and independent raw audit with
six adverse mutations. WORKLOG records exact local paths and limitations; this
checkpoint does not qualify the concurrent workload.

## Operate the bounded local UI

Use a fresh qualified group and the explicit deployment/operator configuration in
[P21A interfaces](P21A-INTERFACES.md). Start the group indexer, executor and four
market/maker identities plus two funding workers with their own budget identities.
Keep each private signer in a mode-0600 file. The UI's public JSON contains version
2, `solana:localnet`, the qualified profile, public RPC/WS URLs, genesis, group,
mint, domain and exact initialization signature/hash. It contains no private key,
provider credential or acceptance-dump dependency.

Build with `source ops/env.sh` then `pnpm build:trader`. Set `RIVALT_TRADER_CONFIG`
to that explicit public JSON, `RIVALT_INDEXER_ORIGIN` to the running group read API
and `RIVALT_SERVICE_ORIGIN` to the execution API when starting the trader Vite
server (`pnpm trader`). Browser configuration selects schema 2 automatically.
The instrumented local Wallet Standard fixture is exercised by `--browser`;
a wallet provider must independently support the configured chain and v0 signing.
No successor Phantom/devnet support is inferred from the older V1 check.

Select portfolio-zero cross/isolated child and market before review. Fund each
account explicitly; sibling balances are never pooled. Inspect cash, negative
claims, reserved margin and fee/all-in limits. A saved signature is authoritative
for retry: reconcile it over RPC and resend only its original bytes. A source or
maker loss can reject unsigned or signed work; a failed signed transaction may still
pay a network fee. API loss does not disable direct cancellation/certification/exit.

**Exit coordination is a measured limit.** In the 300-second qualification, all
three busy exits were invalidated by intervening samples despite twelve successful
proof transactions. For the bounded operator-controlled test group, stop new trade
submission, reconcile originals, close inventory, then explicitly coordinate a
maintenance window by stopping funding/maker/publication workers. Rebuild the full
certificate and execute admissible withdrawals through direct RPC. Report the pause;
do not present it as continuous availability or extend oracle/proof lifetimes to
hide it. Preserve unpaid claims/fractions, restart workers and requalify sources
before returning to trading. Do not apply this procedure as funded-pilot approval.
