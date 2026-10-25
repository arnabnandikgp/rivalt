# P18C — isolated group safety and activation

[A23C/G14](evidence/P18C.md) passes on clean `b43261f` above P18B PR #26.
The verified isolated implementation is executable only in the explicit local
test profile. Cross remains hard-disabled; default/devnet builds reject V2 trading.
The contract remains [P17](P17-MARGIN-CONTRACT.md); D50 resolves ordinary lifecycle
choices without changing fees, loss ownership or source safeguards.

## Implemented transition boundaries

`instructions/group_safety` separates complete-cohort certificates/ordinary
settlement, consenting receiver liquidation and frozen default dispatch/ledger.
`financial-core::margin` supplies one root-cash/two-position arithmetic engine.
The existing isolated route now checks strict whole-root MM-deficit improvement
for a non-flipping reduction below IM; fully IM-admissible outcomes still pass.

- Initialize the canonical `exit-v2` and `resolution-v2` PDAs while in custody.
  Isolated activation requires both source states qualified, no positions/funding,
  empty default state and the compiled release gate. Reset source qualification
  at activation: custody observations cannot charge a pre-activation interval.
- Certificate pages contain 1–8 exact registry members in stable order, read-only.
  Bind group sequence/count, both observations, funding endpoint intervals and
  source deadlines. Check all four endpoint combinations and complete cash,
  per-market net/gross exposure and scaled-claim reconciliation. A source-stale
  exit requires the entire group flat. Same-stamp rewinds and no-op restarts reject.
- Collection is permissionless, selected-market and whole-atom, limited by negative
  entitlement and funded cash. Payment requires the complete group certificate
  and post-payment admission. Fractions stay in that position. No cash is invented.
- Owner deposits work without healthy prices. Withdrawals and same-owner/group
  transfers require the certificate, exact current funding and recomputed remaining
  order reservations. Explicit transfers can cross portfolios; claims never move.
- Dormant cross identities remain included in the registry and can hold/transfer/
  withdraw cash. Until their own gate, they cannot hold positions, nonzero claims,
  active orders/protections or delegated authority. They do not acquire trading
  rights when the group's isolated mode activates.
- Receiver-signed liquidation requires a funded non-maker root in the selected
  market, real selected exposure reduction, no flip, and a strict decrease in
  whole-root MM deficit **after** the funded 5 bps fee (10,000-atom cap). Receiver
  capacity includes its whole root and refreshed orders. No separate taker fee.
  Conflicting target risk orders invalidate only with an admissible atomic result.
- Freeze pins both funding indices, registry count/hash and, if credible together,
  both independently sourced prices. Missing either price enters AwaitValuation.
  An authority emergency freeze requires actual exposure in an unpriced market
  beyond its existing 30-second grace. Administrative pause cannot block default.
- Default visits the entire registry with 1–4-member monotonic epoch/stage/cursor
  pages. Value all roots first, net terminal claims only inside each root, collect
  funded losses, allocate insurance, impair the complete net-positive unpaid cohort,
  allocate final whole atoms by stable-ID largest remainders, then apply/reconcile.
  Ordinary positions remain frozen until Apply. No sibling cash, fees or earlier
  funded gains enter the loss waterfall. Derived terminal claims are kept outside
  ordinary stored-v limits; denominator bounds remain explicitly checked.
- Recovery needs the complete plan applied and reconciled, both sources Normal
  over the existing six-second hold/recovery checks and group-authority resume.
  Both markets requalify funding; no held prefix spans frozen time.

Membership registration and pause/surplus controls extend to unfrozen isolated
mode. Insurance can receive an actual SPL donation followed by authority surplus
classification. `allocate_group_fees_v2` explicitly transfers existing T to I;
no automatic fee insurance. Frozen mode rejects these operations. Permissionless
order cleanup may remove stale authority or refresh changed reserves; identical
no-op cleanup rejects. Owner authority remains required for other order changes.

## Acceptance and remaining scope

[A23C evidence](evidence/P18C.md) records the actual candidate/host tests, 1,132
signed SVM scenarios, complete insured/emergency default and independent ledgers,
legacy parity and 148 finalized fresh Surfpool RPC outcomes with all expected WS
notifications. Cross remains rejected. P21 owns PostgreSQL/service/UI qualification
and contention measurement. No old P16A result qualifies this code, and no endurance
run is implied. Integration status remains in WORKLOG.

## Development findings (not A23C closure)

The full 64-member signed default exposed two real heap problems: Borsh's generic
Vec reader grows buffers that SBF cannot reclaim, and per-page boxed roots retain
one allocation per row. Bound cohort decoding to 64 with one allocation, and reuse
stack storage for page roots. Layout/discriminator and event bytes are preserved.
Two-maker routing also exhausted the heap through temporary candidates/event Vecs;
use bounded allocation and unchanged Anchor-compatible event CPI. The default
32 KiB heap and all identity/oracle/risk checks remain intact.

Development run `20261025T073809721Z-69865` passes 1,131 signed SVM scenarios,
including partial order fees, pending funding, TP/SL, reserved cash rejection,
funded liquidation, all 64 real members, insured default and repeat emergency
resolution after AwaitValuation. Both independent raw-byte waterfall audits and
six mutations pass. Three live account codecs and 692 events across eight types
match isolated legacy Anchor; 15 safety ABI cases cover the nested cash context.
This remains dirty-development evidence. Fresh RPC/WS and clean committed
acceptance are still required. Prior failed paths remain in `.local/group-safety/`
and are recorded in WORKLOG. No raw report is tracked.

The RPC harness observes confirmed results while sources are being sampled and
then independently fetches **every original signature finalized** before passing.
This avoids spending an entire funding hold on sequential finality waits while
preserving the source deadlines and final outcome checks. PostgreSQL and new
service consumers remain P21 acceptance, not a claim of this program-level run.
