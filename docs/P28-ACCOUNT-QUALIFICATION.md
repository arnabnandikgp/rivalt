# P28 — account UI and bounded concurrent qualification

P28 follows verified P27 PR #39 (`9498d2e`). Keep the phase stack open. The
qualified P26 programs remain unchanged; this phase adds no financial authority.

The UI selects portfolio 0–3 and immutable cross/isolated subaccounts 0–8. It
shows funded cash separately from per-market unpaid claims, pending funding,
reservations and indicative risk headroom. Market insurance is venue reserve,
never user cash or guaranteed profit. Owner discovery reads only that portfolio;
ordinary preparation reads one selected root or the explicit transfer pair.
Cancellation, admissible withdrawal and original-signature recovery use RPC even
when venue HTTP services are unavailable. No technical group selector is exposed.

## Pinned acceptance workload

Before execution, pin the source commit and exact qualified program hashes.
The new workload is **300 seconds, 150 scheduled offers at two-second intervals**,
alternating BTC/ETH and buy/sell on a funded cross account. An offer whose entire
two-second slot passes while the driver waits for the previous original or exit
checks is recorded as `driver-unavailable`, not submitted in a later burst. Report
all 150 scheduled intents separately from actual HTTP quote attempts; this driver
backpressure is not a claim about venue capacity. Allow at most five seconds for
the final outstanding original after the 300-second offer window; post-window
position drain has separate bounded 30-second retry populations for real maker
renewal/source recovery. A separate funded
isolated account provides six scheduled one-atom withdrawals at 30, 60, 90, 180,
210 and 270 seconds. Sign each withdrawal, allow an unrelated sampler and trade
to advance, then submit the unchanged original; no quiescent exit workaround.
Record every scheduled offer, refusal, submission, on-chain outcome, latency,
packet/accounts/CU and fee. Distinguish source/maker unavailability, simulation
refusal, stale consumed prefix, transport/acknowledgement and scheduling delay.

Fault windows are explicit: source publication pause at seconds 105–130;
one maker process interruption at 150–160; indexer pause/reopen at 225–235.
Capture restrictive source behavior and genuine recovery without relaxing risk
rules. Actual lost-RPC-acknowledgement/executor recovery and complete default
continuation/restarts/recovery run in the same fresh qualification environment.
Any accepted schedule amendment must be recorded before a rerun; failed populations
are retained, not silently rewritten. Ordinary samplers and unrelated trading
must be active for the six admissible exits.

The browser separately exercises real Wallet Standard originals: portfolio/account
registration, deposits, explicit transfers, both-market orders/trades, existing-
position protection, delegate/revocation, wallet/scope-change review invalidation,
API-independent cancel/withdraw and saved original recovery. Independently fetch
signed transactions, audit raw economic state and rebuild fresh PostgreSQL.

No inherited P16/P21 results qualify A33. No new SBF/full-suite rerun is required
without program changes. P15B/P16B remain external; 24-hour endurance remains
Deferred. Measured local limits and provisional risk assumptions must accompany
A33/G21/M8 acceptance. WORKLOG records actual results, not this prospective plan.

The local supervisor holds a process-scoped macOS idle-sleep assertion only for
its finite run. Explicit lid closure still suspends the host and invalidates the
continuous offered window; preserve that attempt rather than removing elapsed
time or claiming a complete run. Keep the test host awake for qualification.

The ordinary loss/certified-gain worker check runs on the initial seven-root
cohort before the workload. After it, the workload adds two real owner accounts.
Closing a trader does not guarantee maker inventories flatten: preserve residual
internal-maker exposure and all unpaid claims through the following nine-root
liquidation/default/recovery audit. A closed-slot settlement assertion must not
force maker inventory to zero or manufacture an external hedge. Browser evidence
can use its separate pinned run; `--workload` provisions the same account boundaries
through actual signed SDK actions and runs only the affected workload/recovery gate.

R072 acceptance is recorded in [P28 evidence](evidence/P28.md): the browser pin and
fresh workload/recovery pin are distinct and explicit. The final workload passes
115 submissions, six busy exits and complete nine-root recovery/replay. Refer to
[operations](P28-OPERATIONS.md) for explicit deployment configuration and measured
limitations. Unpaid profit payment remains a separate selected-market certificate
operation; this qualification does not promise continuous payout under load.
