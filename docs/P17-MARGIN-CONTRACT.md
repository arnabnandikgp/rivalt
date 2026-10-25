# P17 — versioned margin-account and clearing-group contract

25 October 2026 · bounded local test successor · schema/profile 2

This is the selected implementation contract under D45–D48, not an audit or a
statement that its financial instructions already exist. The audit baseline is
`b005478` (P15A/P16A integrated). The user-supplied
`rivalt-isolated-cross-margin-design.md`, dated 24 October, authorizes the direction;
its uninspected `366b09d` assumption and twelve arithmetic checks do not validate
this repository. The supplied file remains local and unchanged. This document
records the accepted contract in Git without importing external research.

P17 supplies inert Rust layouts and layout/identity tests. P18–P21 own executable
financial transitions and fresh independent economic/runtime evidence. V1 remains
unchanged. Neither V2 registration nor V2 trading is enabled by these layouts.

## 1. Implementation-to-design gap matrix

| Actual implementation at audit baseline | Gap and selected change | Owner / acceptance |
|---|---|---|
| [custody.rs](../programs/clearing/src/instructions/custody.rs) hardcodes `[market,BTC]`; registration derives `[participant,market,owner]` | One participant per wallet/market; no portfolio or explicit mode. Fresh group/portfolio/margin seeds, immutable mode and child index | P18A / A23A |
| [Participant](../programs/clearing/src/state/participant.rs) stores one cash, q/v/checkpoint/generation and four orders | Cash belongs to a root with two canonical position slots; each slot retains its own claim, funding and generation. Four orders total, not four per market | P17/P19 / A22/A24 |
| [MarketState](../programs/clearing/src/state/market.rs) owns mint/vault/C/P/I/T, funding and modes | Move cash/reserves/registry/freeze to group; keep independent market sources/funding/exposure. No duplicate market cash balances | P18A–C / A23 |
| [financial-core](../crates/financial-core/src/lib.rs) `Participant::risk_equity`, `admissible`, `withdraw` take one market | Shared engine counts C once and adds negative claims and requirements across all relevant slots. V1 adapter retains one-slot economics | P19 / A24 |
| [routes.rs](../programs/clearing/src/instructions/routes.rs) authenticates one market and bounded one/two maker CPI; `participant_model` projects one q/v | Keep allocation, exact FOK and read-only config CPI. Authenticate canonical dependencies for trader/donor/receiver, then check final whole-account state | P18B/P19 / A23B/A24 |
| Route alias checks compare capital PDAs; one-wallet-one-participant previously limited aliases | Reject known common owner between taker and each maker, as well as shared capital/duplicate maker IDs. Different-wallet beneficial ownership is not detectable | P18B / A23B |
| [maker-common.rs](../programs/maker-common.rs) derives V1 participant from owner/market; registration approves exact module hash | Add explicitly versioned V2 config initialization authenticating V2 root identity/role/mode/market, without weakening V1. Four distinct capital/config registrations across A/B and BTC/ETH | P18B / A23B |
| [oracle instructions](../programs/clearing/src/instructions/oracle/mod.rs) and [OracleState](../programs/clearing/src/state/oracle.rs) describe BTC and collateral sources, one held observation | Independent BTC and ETH source pairs and common collateral pair; independent qualified two-maker coverage, causal funding and recovery. No copied BTC price for ETH | P18B / A23B |
| [orders.rs](../programs/clearing/src/instructions/orders.rs) `required_at`/`refresh` use one price/generation; embedded four-slot book | Each order/protection identifies market and delegated-authority epoch. Sum current per-order reserves across markets; TP/SL retains one market generation and allowance | P18B/P19 / A23B/A24 |
| [settlement.rs](../programs/clearing/src/instructions/settlement.rs) authenticates a full market registry and sequence-bound ExitGuard | Full group certificate with both source/observation/funding dependencies; one account's cash counted once. Add owner-signed same-group transfer and explicit flat-claim netting | P18C/P19 / A23C/A24 |
| [risk.rs](../programs/clearing/src/instructions/risk.rs), [liquidation math](../crates/financial-core/src/liquidation.rs) use single-position deficit; funded consenting non-maker receiver | Whole-account eligibility and strictly lower deficit after funded fees at one frozen snapshot; selected market must reduce, receiver checks every slot | P18C/P20 / A23C/A25 |
| [resolution](../programs/clearing/src/instructions/resolution/mod.rs) freezes complete 64-member registry and one common price/F; bankruptcy tests C + common U, not risk equity | Freeze whole group and both funding endpoints; wait for both credible common prices; terminal net within each account before waterfall. Keep every isolated/maker member and stable-ID rounding | P18C/P20 / A23C/A25 |
| [ledger](../programs/clearing/src/instructions/resolution/ledger.rs) and [ResolutionState](../programs/clearing/src/state/resolution.rs) already track staged collected/applied adjustments | Extend frozen per-market exposure reconciliation and two generations; one net claim and cash per account. Reuse exact apportionment only after checking two-market bounds | P18C/P20 / A25 |
| [SDK balance view](../packages/sdk/src/balance-view.ts), [UserClient](../packages/sdk/src/user-client.ts) derive one owner/market account and health | Versioned identity/dependency builders, per-account cash/health, explicit transfers/netting and conditional cross-risk display | P21A–B / A26 |
| [Runtime](../packages/services/src/runtime.ts) snapshot/quote and workers assume one market/two makers | Group snapshot, four registrations, market-scoped workers, unchanged immutable signed queue and fee budgets with explicit identities | P21A–B / A26 |
| [projection](../packages/indexer/src/projection.ts) and [SQL](../packages/indexer/src/schema.sql) bind one run/market/sequence | Separate V2 group run binding and group sequence; group/account/market event keys, frozen net-claim projection and all-market derived funding; no mixing V1 history | P21A / A26A |
| [trader app](../apps/trader/src) exposes one account/market | Portfolio zero initially; explicit isolated/cross account selector, transfers, two positions, unpaid/funded amounts and blocked-action reasons | P21B / A26B |

## 2. Bounds and identities

One six-decimal classic SPL test mint, exactly two group markets: BTC index 0 and
ETH index 1. BTC retains 1,000,000 lots per BTC; ETH uses 100,000 lots per ETH.
One price tick is one quote atom per lot. Both retain scale 10^9, checked i128
claims/funding, V1 cash/price/quantity bounds, 10% IM/5% MM and no tier/correlation
discount. All values are synthetic; production calibration remains external.

Limits: 64 stable group members including makers and receivers; four portfolios
per owner (indexes 0–3); nine child identities per portfolio (0–8); two position
slots, four total orders and two protective pairs per margin root. Global registry
capacity applies even when owner indexes permit more addresses. No account deletion,
registry ID recycling or dynamic market replacement. Limits may shrink before
activation if resource tests fail; increases require new measured acceptance.

| Account | PDA seeds (all integer seeds little-endian) | Ownership / immutable binding |
|---|---|---|
| ClearingGroupV2 | `group-v2`, 32-byte domain | Clearing; domain, mint, vault and authority; local upgrade authority creates |
| GroupMarketV2 | `market-v2`, group, u8 index | Clearing; group/index/symbol/lot size; two immutable market keys |
| GroupRegistryV2 | `registry-v2`, group | Clearing; append-only stable member ID and key |
| PortfolioV2 | `portfolio-v2`, group, owner, u16 index | Clearing; namespace only; children bitmap; no financial balance |
| MarginAccountV2 | `margin-v2`, portfolio, u16 subaccount index | Clearing; owner/group/portfolio/id/mode/role and fixed isolated market |
| Group vault | `vault-v2`, group | Classic SPL Token; clearing group PDA token authority |
| MakerRegistrationV2 | `maker-v2`, market, u8 maker ID | Clearing; market, isolated capital, owner, approved program/config/hash |
| CapitalBindingV2 | `capital-v2`, capital | Clearing; one registration per capital root, across all markets |
| GroupExitGuardV2 | `exit-v2`, group | Clearing; current complete-group solvency certificate |
| GroupResolutionV2 | `resolution-v2`, group | Clearing; complete frozen group and stage/cursor |

Subaccount zero MUST be Cross with isolated-market sentinel 255; positive indexes
MUST be Isolated with market index 0 or 1. Immutable roles are Trader (0), Maker
(1), Receiver (2). Makers MUST be isolated. A receiver may use either mode only
after that mode's liquidation qualification; it cannot also be maker capital.
Duplicate registration, wrong program ownership/discriminator/version, foreign
portfolio/group, mismatched index/derived PDA or market aliases reject.

## 3. Versioned wire layouts

The ordered fields in [state/v2](../programs/clearing/src/state/v2) are the concrete
Borsh schema; no native Rust padding is serialized. Each account has Anchor's
eight-byte discriminator and a u16 schema version of 2. Unsupported schema/profile
rejects. This is an additive namespace, not byte compatibility with V1.

| Account | Allocated bytes, including discriminator | Financial ownership |
|---|---:|---|
| ClearingGroupV2 | 273 | C aggregate, P/I/T, allocated vault, mode/epochs/sequence, two markets |
| GroupRegistryV2 | 2,097 at 64 members | Stable account enumeration only |
| PortfolioV2 | 79 | Group/owner/index and child bitmap only |
| MarginAccountV2 | 970 | C once, two 48-byte position entries, nonce/version, delegate, four-slot book |
| GroupMarketV2 | 446 | One F, source observation/coverage, bounds, market gross exposure |
| MakerRegistrationV2 | 326 | Standing pricing authority and consumption; no cash copy |
| CapitalBindingV2 | 106 | Unique capital-registration relationship |
| GroupExitGuardV2 | 223 | Two observations, four funding endpoints, deadlines and cohort progress |
| GroupResolutionV2 | 9,127 at 64 rows | 376-byte header plus 136-byte rows, full payout plan |

`PositionV2` stores lots i64, virtual claim i128, funding checkpoint i128 and
generation u64 in that order. Array index is market identity; no caller list can
omit a losing slot. An isolated root's other slot must remain canonical zero
(including checkpoint/generation) and must have no order/protection bound to it.
Cross slots are never reassigned. Flat nonzero claims/fractions remain owned.

`StoredOrderV2` prefixes the existing 132-byte order with market u8 and delegate
epoch u64 (141 bytes). `ProtectionV2` prefixes the existing 41-byte protection
with market u8 (42 bytes). `OrderBookV2` is 680 bytes: last IDs, two reserve
observation IDs, four orders and two protections. Original fee prefixes and order
state semantics remain; a diagnostic reserved field is never authoritative health.

Group resolution rows retain both pre-freeze lots/generations, account-net scaled
claim, collected cash, insured/impaired scaled units, payment and terminal rounding.
Header stores both common prices, funding endpoints, scanned/remaining net and
gross exposure, registry hash, totals, stage and cursor. Maximum account size is
not a runtime/CU guarantee. Box large Anchor accounts; bound heap/page decoding.

## 4. Normal accounting and exact transitions

For each root a and market m, let `U[a,m] = q[a,m]*M[m]*S + v[a,m]
- q[a,m]*(F[m]-checkpoint[a,m])`, with S=10^9. Pending funding is included even
without an account write. Funding accrual stores that exact adjustment before q
changes. For health, replace M by the adverse credible bound for each position.

Group invariants, excluding explicitly staged frozen work:

- `allocated_vault = sum(account.cash) + P + I + T`; actual SPL vault must be
  at least allocated vault. Surplus is separately observed and authority-classified
  to insurance, never credited to a chosen trader or used to hide a deficit.
- For each market, `sum(q[a,m]) = 0`, including maker/receiver positions.
- `sum(U[a,m]) = P*S`, using common market prices and exact accrued fractions.
- `equity_scaled = C*S + sum(min(U_risk[a,m],0))`; positive claims never offset
  another open loss. `IM/MM = sum(ceil(abs(q)*upper*bps/10000))` in whole atoms.
- Admission requires `equity_scaled >= (IM + current_remaining_reservations)*S`.
  Check all final candidates atomically, after fees, funding and order consumption.
  No duplicated cash, funding cost or fee deduction and no correlation discount.

| Transition | Required checks | Exact effect |
|---|---|---|
| Create portfolio/root | Owner signature, canonical immutable identity, registry capacity, unfrozen group | Zero financial state, stable member ID; no parent guarantee |
| Deposit d | Owner signature and owner token account, correct mint/vault, d>0, unfrozen group | Actual SPL transfer; allocated vault and root C each +d |
| Transfer d | Same owner AND group, distinct roots, owner signature, donor full funding/health/reserves and group exit gate | Donor C−d, recipient C+d; V/P/I/T unchanged; no claim/fraction transfer |
| Transfer-and-open | Same checks plus both final candidate states and signed route constraints; same Solana transaction | Transfer and fill both commit or both revert; no unsafe intermediate withdrawal |
| Fill | Complete dependency set, current intent/epoch/nonce, one/two distinct makers, final all-account capacity | Opposite lot and virtual-notional deltas; no notional cash movement |
| Taker fee | Aggregate economic-order prefix; within signed fee budget and funded C | `ceil(new_notional/5000)-ceil(old_notional/5000)` C→T; provider fee zero |
| Accrue | Exact market F; before q mutation; whole-account funding included in health | v−q*(F−checkpoint); checkpoint←F; no cash movement |
| Collect loss x | Authenticated negative market claim, x whole atoms ≤floor(−U/S) and C, unfrozen | C−x, selected v+x*S, P+x |
| Pay gain x | Current complete group exit certificate, x≤floor(U/S) and P, recipient constraints | P−x, selected v−x*S, C+x; landed-admissible settlement, no clawback |
| Net closed claims | Owner signature; cross root only; both slots flat and fully accrued; no active orders/protections; unfrozen | Cancel min(positive,abs(negative)) in exact scaled units; C/P/I/T and total claim unchanged |
| Withdraw d | Owner signature/destination, complete group certificate, current whole-account post-withdraw health/reserves | C−d, V−d, actual SPL transfer; no unpaid amount withdrawn |
| Insurance/fees | Actual authorized deposit or explicit allocation; fees are never automatic insurance | External V/I +z or explicit T−z/I+z; invariant retained |

Transfers across portfolios are allowed only between the same owner's roots in
the same group. They are explicit allocations, not netting/guarantees. Cross-group
movement uses separate admissible owner withdrawal and deposit; no migration or
cross-group borrowing instruction. A standalone transfer checks donor after the
transfer, so transfer-and-open requires no bypass of temporary unhealthy donors.
Receiver health is checked after the intended final fill; deposits may improve an
unhealthy account without falsely granting permission to trade.

## 5. Snapshot, funding, orders and authority

The root and group are writable serialization points for every cash/exposure
change. Portfolio metadata is read-only during trading. Required market inputs
derive from both slots, active orders/protection and the market being changed;
authenticate canonical group keys, owner, schema, group binding and index. Missing,
duplicate, foreign or reordered required dependencies reject. Extra unrecognized
accounts reject. On-chain evaluation uses one Clock snapshot and derived current
funding for every relevant position; no cached worker equity is authority.

Risk increase requires Normal for every relevant market. Credible degraded bounds
permit only checked reductions; NoCredibleBounds blocks price-dependent execution,
liquidation and unsafe outflows. Empty unrelated isolated slots require no price.
A cross account with no ETH exposure/orders need not be blocked by an irrelevant
ETH price, but group settlement/exit certification must still cover all members.
Collateral-source failure restricts both dependent markets. Deposit/cancel do not
call maker pricing or require healthy sources outside frozen resolution.

Keep existing causal sampling, hold deadlines, six-second recovery, invalid-gap
zero new funding and complete two-maker coverage PER MARKET. Fixed source bindings
use six controlled local fixture accounts: BTC/ETH primary+guard and common
collateral primary+guard. Independent guardians or real ETH devnet sources are not
claimed or required for this local prototype. Keep the legacy local freshness
policy; the devnet-only 30-second exception does not apply.

All remaining order reserves are recomputed with each order's current market
bounds and remaining fee budget, using conservative sums. No bid/ask maximum or
implicit cross-market OCO. TP/SL children share only their stored protection's
market, generation and original allowance. Partial fills/cancel/replace keep the
V1 cumulative fee rule; old protection cannot revive on another market/child or
after flat/reopen. Risk/config changes invalidate stale intent and re-evaluate
resting reserves; no grandfathered health.

| Authority | Permitted actions / revocation |
|---|---|
| Root owner | Create child, deposit, transfer, withdraw, net closed claims, set/revoke delegate, trade and cancel |
| Account delegate | Immediate trade and create/replace/cancel orders on that named root only; no transfers/withdrawals/netting/delegation; can lose all that root's trading cash |
| Stored order keeper | Execute within live order/version/fee/generation/group terms and current delegate epoch, where applicable |
| Funded receiver owner | Sign a bounded liquidation into its own root; all receiver health/cap checks apply |
| Permissionless maintenance | Accrue/collect/pay with exact gates, safe terminal cleanup, distressed risk-order cancellation, ordered resolution pages; never arbitrary payout selection |
| Group authority | Initialize market/source/module configuration, pause, genuine source-emergency freeze, explicit fee allocation and post-reconciliation recovery |

Delegate is per account, with exclusive expiry slot and checked epoch starting at
1. Owner changes/revokes it and increments the epoch immediately. Owner-created
orders carry delegate epoch 0; delegated orders carry current epoch and stop being
executable after expiry/revocation. Cancellation/cleanup can release their reserves;
no copied portfolio delegate or invisible global propagation. No off-chain signed
session, owner rotation or live mode conversion. Frozen resolution disallows
ordinary root mutations; its bumped group epoch already revokes trading authority.

Maker CPI retains exactly its bounded read-only config input: no margin/group
writable account, arbitrary forwarding or vault signer. Reject taker/maker common
owner, not only equal PDAs. Distinct A/B program IDs do not establish independence.

## 6. Exits, liquidation and default

The paginated exit certificate authenticates all 64-or-fewer members and binds group
sequence, registry count, BOTH market observations, effective funding bounds and
deadlines. Each account must have nonnegative conservative equity at every relevant
held-funding endpoint combination (at most four). Reconcile both net exposures,
all claims and cash. Stale source permits only a wholly flat cohort's independently
computable claim check. Any relevant group mutation invalidates the certificate;
certification is a separate transaction from a cash mutation, preserving V1's
read-only page contract. No permissionless rewind at the same certificate stamp.

Below IM: deny increased risk/unsafe outflows; allow deposits, cancellations and
checked non-flipping reductions. Below MM: permit risk-order cancellation and
bounded liquidation. A reduction below IM must reduce selected absolute exposure
and strictly improve whole-account MM deficit after fees, or result in full IM
admissibility; an improved ratio alone is insufficient. Pending obligations from
untouched markets remain included.

Liquidation uses one common authenticated snapshot for pre/post states. Keep V1's
price band, maximum 4,608 lots, fee `min(ceil(notional/2000),10000,target.cash)`
paid to the consenting funded non-maker receiver and no duplicate taker fee.
Require selected exposure strictly lower without flip, receiver full IM/caps and
`max(MM_after-E_after,0) < max(MM_before-E_before,0)` after fees. Target conflicting
risk orders invalidate atomically only after an admissible candidate exists.
Insufficient executable liquidity is a restriction, not proof of bankruptcy.

Default entry with credible prices separately checks
`C*S + sum(common_closeout_claims) < 0` for a member, never gross-loss risk equity.
Alternatively group authority may freeze after a relevant exposure lacks credible
sources beyond the retained 30-second emergency grace. Pin BOTH materialized
funding endpoints and full registry hash/count; invalidate group terms/quotes/orders
and block deposits/new membership/transfers/ordinary exits. Missing either credible
closeout price enters AwaitValuation. An atomic subsequent all-market source read
pins both common prices; no substituted/stale/discretionary price.

Stages remain Idle → AwaitValuation (if needed) → Value → Collect → insurance
floors/awards → impairment floors/awards → payment floors/awards → Apply → Reconcile
→ Complete → authorized Resumed. Monotonic 1–4-member pages require exact epoch,
stage, cursor, ordered registry identities and no duplication. Value every account
before collecting any. For each root, net its two fully valued terminal claims
once; do not net across sibling/parent/portfolio accounts. Collect whole atoms up
to cash; insurance then covers whole-atom debt, with exact scaled allocation.
Impair the complete positive account-NET claim cohort for remaining debt; cancel
matching debts. T is excluded. Stable-ID largest remainders allocate final whole
cash; terminal entitlement adjustments sum to zero and each is below one atom.

Ordinary q/v stay frozen until Apply, as in V1. Frozen reconciliation includes
unapplied per-market lots/claims and explicit collected/paid work totals. Apply
clears both positions/claims and order authority, advances affected generations,
and pays only the complete computed plan. Finish all members and reconcile vault,
cash, both exposures and all scaled claims before recovery. No earlier funded
payment is clawed back; healthy cash is not a mutual guarantee. Isolated unpaid
gains share group default risk while other accounts' allocated cash remains separate.

Two-market valued claim bounds are at most twice the one-market derived bound;
64-member totals remain checked i128. Revalidate the apportionment denominator
limit (`2^96/3`) explicitly before reuse. Overflow is a rejection, never truncation.

## 7. Activation and deployment

V2 is a fresh local deployment/domain/vault/registry. Keep V1 account discriminators,
seeds, instructions, devnet IDs and data intact. Local run initialization records
exact program/IDL hashes, genesis and group creation transaction; public fixture
keys are test-only and no retained acceptance dump provisions the new group.
Do not upgrade the existing devnet deployment in this authorization.

Group starts CustodyOnly. P18A permits only verified account/cash operations;
P18B builds isolated financial paths but cannot activate them before P18C isolated
liquidation/group-default acceptance. P19 implements bounded cross candidates with
cross activation hard-disabled. `CROSS_TRADING_IMPLEMENTED=false` is a compile-time
release gate that no administrator instruction may bypass. P20 may change it only
with complete cross liquidation/default checks; runtime activation additionally
requires the explicit local successor profile and a ready two-market group.
Default and devnet builds must reject successor financial activation. No success
stub, synthetic admin balance setter or worker shortcut qualifies an unimplemented path.

V1 funds migrate only via an actually admissible old withdrawal to the owner's
token account and a new explicit deposit. Existing open positions/orders/claims,
fractions, fee cash or insurance are never relabelled. There is no live conversion,
cross-program migration, automatic reserve consolidation or paid/funded rollout.

## 8. Independent cases and acceptance ownership

These are new expected values to recreate against the actual engine/handlers and
signed deployed programs; this table and the proposal's arithmetic are not results.
Amounts below use whole illustrative quote units except explicitly scaled dust.

| Case | Independent expectation / adverse variant | Phase |
|---|---|---|
| G01 shared cash / no positive credit | C=1000; open claims +300/−200 → equity 800, not 1000 or 1100; IM/MM add per market | P19 |
| G02 whole-account funding | BTC action/withdraw must include an ETH funding debit even with no ETH account write; divided accrual equals one interval | P19 |
| G03 reserved donor | C=1000, IM=500, remaining reserves=300, transfer 250 → reject; 200 at same snapshot may pass; actual token/vault unchanged | P19 |
| G04 closed claims | Flat +300/−200 → +100/0 with no cash; open either slot, active protection/order or foreign root → reject | P19 |
| G05 fee-sensitive progress | E=80/MM=100; reduction leaves E=45/MM=70 → deficit worsens 20→25: reject; receiver independently checked | P20 |
| G06 solvency ≠ risk | C=100, open +300/−200 → risk equity −100 but economic value +200: may liquidate, cannot claim bankruptcy | P20 |
| G07 complete group | C=(100,200,100), claims=(+150−300,−150,+300), I=20: collect=(100,150,0), impairment=(0,0,30), pay=(0,0,270), final C=(0,50,370), I=P=0, V=420 | P20 |
| G08 no family seizure | Insolvent isolated child cannot use healthy parent's cash; its unpaid winners remain in complete group default | P18C/P20 |
| G09 exact ownership | ±3 lots × funding 0.1 atom/lot leaves ∓0.3 atom, survives flat/reopen and delegation; no slot reuse transfers it | P18B/P19/P20 |
| G10 fees/reserves/protection | 2000+2000+2000 atoms: cumulative fees 1,1,2; 4-of-10 TP leaves ≤6 SL; other market generation cannot revive protection | P18B/P19 |
| G11 adversarial identities | Omitted/foreign/duplicate markets, group/capital aliases, common-owner self-trade, revoked delegate, expired/old nonce all reject without financial effects | P18–P20 |
| G12 allocation and restart | All legal page sizes/orderings, interruption after collection/apply, mixed-mode cohort, max 64 members, fractional ties; exact independent payout agreement | P18C/P20/P21 |

Use independent Python Fraction/integer expected vectors without importing the
Rust/SDK implementation; feed real implementation inputs and compare all outputs,
including rejected and unchanged states. Signed SVM tests then establish account
authentication and atomic rollback, and real Surfpool/RPC/WS/PostgreSQL flows prove
service effects/rebuilds. Neither host structs nor fixture injection proves custody.

P17/A22: audit matrix, exact contract, layout sizes/offsets, identity isolation,
authority/migration/supersession and complete phase-owned gates; no financial pass.
P18–P21 acceptance is detailed in [the delivery plan](05-DELIVERY-PLAN.md).
Every enabling phase records code/artifact hashes, packet/account/CU measurements
and negative activation tests. Target ≤1,232 message bytes, ≤32 message accounts
and ≥20% CU headroom under an explicitly declared ≤1,400,000-CU limit; use bounded
pages or authenticated dependencies before increasing limits. Measure hot group/
root/maker locks with separate versus shared accounts and report offered/eligible/
submitted/finalized populations and p95/p99. Do not infer scale from PDA count.

P21 performs fresh bounded lifecycle/fault/load qualification on the successor
revision, including final admissible direct exit and a new PostgreSQL replay.
No inherited P16A result or 24-hour claim. P15B/P16B remain external Open gates;
continuous 24-hour endurance stays Deferred under D42.
