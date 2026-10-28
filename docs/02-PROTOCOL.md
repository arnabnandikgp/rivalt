# Protocol contract
Rivalt · baseline R1 · 20 October 2026

D70 authorizes implementing [P29–P34](P29-MAKER-LIQUIDITY-ROADMAP.md).
[P29B's contract](P29B-MAKER-CONTRACT.md) fixes canonical cumulative pricing,
independent reprice/shape/replenish transitions, three-maker complete coverage and
strict authority with current-price execution inside signed limits. These changes
are confined to fresh local profile4. P30 qualifies canonical pricing and
custody-only controls. [P31](P31-EXACT-ROUTING.md) qualifies authenticated read-only
quote snapshots and exact financial previews. [P32](P32-LIQUIDITY-EXECUTION.md)
contains a gated sampler/control candidate; its resource gate is not yet met and
financial routing remains disabled. P32 gates financial activation. Existing profiles, source
safeguards and loss/fee/insurance accounting remain authoritative.

D64 implements [P26 whole-account safety](P26-ACCOUNT-SAFETY.md): complete
canonical valuation, verified exact clearing, application, recovery and retirement.
The pinned candidate matrix and explicit storage-ready local activation pass
[A31/G20](evidence/P26.md). Default/devnet remain disabled. WORKLOG owns
acceptance and publication status; P27/P28 remain separate service/UI gates.


D63 records [P25 cash/claim implementation](P25-ACCOUNT-CASH.md): atomic own-account
funded exits and separate complete market payment certificates. Acceptance remains
phase-owned, and the candidate build does not satisfy P26 safety.

D62 records [P24's candidate trading interface](P24-ACCOUNT-TRADING.md): scoped
account/safety/maker authority, current relevant risk and exact per-market fee
allocation. It remains a separate qualification artifact pending P26 safety.


D60 completes the schema-3 [financial/state/authority contract](P22B-EXECUTABLE-CONTRACT.md)
and supersedes the earlier P22B-incomplete wording below. The exact normal
settlement, bounded terminal arithmetic and layouts apply only to the new profile.
[A27B evidence](evidence/P22B.md) and WORKLOG own acceptance; no new runtime
activation or inherited qualification follows from contract completion.


This is the normative economic and execution contract for the engineering MVP. It selects behavior, not final machine layouts or production calibration. G02/G03 in [DECISIONS](DECISIONS.md) must be resolved in P02; G08–G10 close before their owning features are marked complete.

D56 authorizes [P22's account-centric redesign](P22-ACCOUNT-CENTRIC-CLEARING.md).
P22A is a roadmap, not a replacement economic specification. P22B owns the exact
cash/claim, netting, loss-allocation and atomic-exit contract and its explicit
versioned supersessions. Until then, the V1/V2 contracts below remain authoritative
for their existing profiles; no new financial path is enabled.

[P22B's developing contract](P22B-FINANCIAL-CONTRACT.md) separates the account-local
funded-withdrawal proof from profit-payment/default policy and provides independent
counterexamples. D57 records the user's market-attributed loss-policy selection
for the fresh profile. Exact settlement/netting/insurance transitions remain due;
neither the selection nor reference-model success changes V2's common account-net
waterfall or completes G17. D58 selects the new profile's 25% share of collected
taker fees for market-attributed insurance. P22B section 7 pins cumulative rounding,
funded cash transitions and phase obligations; current V1/V2 fee behavior is unchanged.

D59's [complete-cohort rational benchmark](P22B-CLEARING-REFERENCE.md) extends the
reference cases to mixed-sign accounts/cycles and adds a whole-atom output candidate
with explicit per-market rounding. It does not replace the executable contract:
arbitrary-size rational internals, normal payment/netting and staged authority must
be resolved before G17 and the dependent implementation can qualify.

For the authorized fresh schema-2 test group, [P17's successor contract](P17-MARGIN-CONTRACT.md)
is normative for the deliberately superseded account, group, multi-market health,
closed-claim netting and complete-group default boundaries (D45–D48). The contract
below remains V1; it does not silently reinterpret old bytes or balances. Fees,
funded cash/unpaid claims, fixed-point ownership, source safeguards, routing and
the complete-cohort waterfall are preserved as specified in P17. Implementation
and activation evidence is phase-owned; cross trading remains disabled through P19.

P02's concrete precision, bounds, synthetic risk profile and deterministic fractional extension are specified in [ACCOUNTING-AND-CUSTODY](P02-ACCOUNTING-AND-CUSTODY.md). This includes exact scaled-unit insurance/impairment and an explicit zero-sum terminal rounding transfer bounded below one quote atom per participant. Ordinary settlement retains all sub-atom claims. P02 originally permits custody only. [P04 routes](P04-ATOMIC-ROUTES.md) extend the local build through an explicit synthetic observation profile; [P06 ordinary settlement/exits](P06-LIFECYCLE.md) add whole-atom collection, funded settlement and complete-cohort guarded withdrawals. [P07 controlled oracle/funding](P07-ORACLE-AND-FUNDING.md) implements the controlled local profile, with acceptance and integration tracked in WORKLOG. [P08 orders](P08-ORDERS.md) adds bounded persistent authority and existing-position protection in mode 2, with current-bound reservations and exact cumulative fees. P09 local liquidation and staged resolution are being implemented under [RESOLUTION](P09-RESOLUTION.md); their acceptance status is recorded in WORKLOG. Default builds reject these financial paths.

P18B's [normal-path primitives](P18B-ISOLATED-PRIMITIVES.md) implement D49's BTC/ETH
lot/source domains with unchanged fees and conservative margin. Source sampling and
maker setup are executable locally; both financial gates were false at its tested
checkpoint. Their pure candidates alone do not establish liquidation/default readiness.
[P18C safety](P18C-GROUP-SAFETY.md) qualifies complete-group safety and isolated
activation in the explicit local profile on `b43261f`; see [A23C evidence](evidence/P18C.md).
Cross remained hard-disabled at that checkpoint. D50 preserved dormant cross cash
access and complete-group loss ownership without granting cross trading authority.
[P20 safety](P20-CROSS-SAFETY.md) now qualifies explicit local cross activation
under D52 and its own [A25/G15 evidence](evidence/P20.md). Default/devnet and the
older isolated profile retain their gates; no V1 account or funded deployment is
reinterpreted. P21 still owns integrated service/UI qualification.

## 1. State, units and invariants

The equations use exact economic quantities. The implementation must map them to checked integer/fixed-point representations and explicit participant-owned fractional components. Never interpret a display decimal count as a funding precision proof.

| Symbol | Meaning | Units / constraints |
|---|---|---|
| V | Controlled settlement-token balance | Whole quote atoms; actual token amount |
| C_i | Participant funded cash | Whole quote atoms, nonnegative |
| q_i | Participant signed exposure | Integer base lots; positive long, negative short |
| v_i | Virtual quote / unpaid-claim component | Signed quote atoms with exact retained fractional component |
| F, F_i | Common funding index and participant checkpoint | Quote atoms per base lot at a pinned fixed-point scale |
| M | Common accounting/reference price | Quote atoms per base lot |
| P | Cash collected/allocated for P&L settlement | Whole quote atoms, nonnegative |
| I | Dedicated funded insurance | Whole quote atoms, nonnegative |
| T | Collected protocol fees | Whole quote atoms, nonnegative |
| R_i | Required reservation for remaining authorized orders | Quote atoms of risk capacity; not a separate cash asset |
| g_i | Position generation | Checked monotonically advancing integer |
| U_i | Fully accrued unpaid P&L | Derived: q_i M + v_i - q_i(F-F_i) |
| E_i | Conservative risk equity | Derived from C_i and negative risk-valued U_i, less any separately represented due costs |

One quote token is 1,000,000 quote atoms. Base lot, price tick, accumulator scale and bounds are G02 outputs. Any separate fractional register is mathematically included in v_i/U_i; it is never ignored in global reconciliation. Do not store an independent realized-P&L balance and also count the same amount inside v_i.

Cash, exposure and claims are different invariants:
- **I01 Cash:** V = sum(C_i) + P + I + T. If implementation creates a real cash-rounding bucket, name its owner and add it explicitly; default is no unassigned bucket.
- **I02 Exposure:** sum(q_i) = 0, including every maker and liquidator.
- **I03 Claims:** sum(U_i) = P, using one common M and fully accrued exact fractional state.
- **I04 Capacity:** no post-state admission violates participant health, reservations or maker limits.
- **I05 Authority:** executed contract, size, direction, fee, capital, epochs and limits stay within both sides' authorization.
- **I06 Once-only effects:** order/quote consumption and resolution progress cannot replay.
- **I07 Complete loss allocation:** the frozen participant cohort is complete and every eligible claim enters the same resolution rule.

I01 is reconciliation, not proof that future losses are collectible or that every requested exit is admissible. Solvency and timely available settlement cash require their own checks.

Seed I with a real token transfer. If seeding P, also create the corresponding explicit funded seed-owner claim so I03 remains true; simply increasing P/V without the matching claim is invalid. The default fixtures seed insurance and collect losses normally rather than invent a free settlement pool. Cash injection is not protocol revenue.

## 2. Accounts and authority

Participant PDAs own balances, q/v, funding checkpoint/remainder, generation, nonces, reservations and bounded order slots. Separate MakerRegistration binds a pricing program/config/version/epoch to one funded capital account and its limits. Venue/market state owns global terms, mode, funding and cash accounting. Stable registry pages include every live participant.

Clearing alone authorizes the collateral vault PDA. Maker programs cannot debit arbitrary participants, choose risk/funding policy, redirect withdrawals or obtain the vault signer. Wallet authority signs immediate execution or creates persisted order authority. Keepers can submit only a transition already authorized by stored state.

A participant cannot be deregistered while it has cash, exposure, claim/fractional entitlement, pending order, reservation or resolution participation. Maker removal from quoting does not remove it from the liability registry. Four order slots is per participant; a TP/SL pair consumes two slots with one shared group allowance.

P02 freezes seeds/layouts/discriminators and versioning. New Anchor accounts need not preserve old experimental bytes; do not imply an upgrade-in-place migration.

## 3. Cash and position transitions

Accrue before changing q, determining entitlements, risk checks or withdrawing:
v_i' = v_i - q_i(F-F_i), F_i' = F.
Retain all fractional value with that participant.

| Transition | Preconditions | Exact economic changes |
|---|---|---|
| Deposit d | d positive; correct mint/owner/recipient; actual token transfer; market accepts deposits | V += d; C_i += d |
| Buyer b / seller s fill of d at gross notional N | d positive; distinct capital sides; valid signed/stored intent; current maker authority; current prices; capacities and post-fee health | q_b += d; v_b -= N; q_s -= d; v_s += N; fee and consumption in same atomic transition |
| Collect loss x | Eligible negative U_i; x whole atoms, 0 < x <= min(C_i,-U_i); current mode | C_i -= x; v_i += x; P += x |
| Settle gain x | Eligible positive U_i; x whole atoms, 0 < x <= min(U_i,P); current mode | P -= x; v_i -= x; C_i += x |
| Withdraw d | Funded balance; post-withdraw health/reservations; global exit gate; real tokens | C_i -= d; V -= d; atomic token transfer to authorized owner destination |
| Fee f | Successful fill, within authorized fee budget, funded balance | C_taker -= f; T += f |
| Fund insurance z | Actual external token transfer or explicit authorized internal fee allocation | External: V += z; I += z. Internal: T -= z; I += z; no new asset |
| Withdraw distributable fees z | Treasury authority, available T, permitted market state | T -= z; V -= z; actual transfer |

Loss collection and gain settlement preserve equity at the common valuation while moving value between unpaid claims and funded cash. A whole-atom transfer never rounds an unfunded fractional claim up into cash. P02's precision design must specify the retained residual and exact reconciliation; P09 must include it in closeout.

Ordinary gain settlement is first-admissible landed execution against available P. There is no FIFO withdrawal queue or promise of pro-rata settlement outside default. Insufficient P leaves the remaining claim unpaid. Expose the delay. Early payment can change who bears a later default; already paid gains are not clawed back.

Unsolicited token transfers to the vault cannot credit a selected participant. Detect and reconcile surplus through an explicit authorized classification/event; the implementation must not silently use it to conceal a deficit.

## 4. Fees

The rate is 2/10,000 = 1/5,000 of gross executed notional. Maker-side rate is zero. A user resting limit still pays taker fees against maker liquidity. A maker taking another maker's curve pays taker fees.

For an economic order with cumulative gross executed quote atoms N_cum:
fee_total(N_cum) = ceil(N_cum / 5000).
For a new committed subfill, charge fee_total(new N_cum) - fee_total(old N_cum). Compute one aggregate notional across the route; do not independently round each leg. Replacement retains the filled/notional/fee prefix. A new independent order starts a new prefix.

The charge is nonnegative, backed by C and included in final health. Cumulative charge must stay under the user's authorized lifetime fee budget; price/fee configuration epochs cannot bypass that budget. Every charged atom enters T once. There are no rebates, referral splits or automatic insurance allocations in this baseline.

For a buy, the user authorizes maximum gross quote debit plus venue fee; for a sell, minimum gross proceeds less venue fee. Perp notional N updates v, not an N-token collateral transfer. Network fees are separate and may be incurred by a failed transaction; reverted venue trading fees are zero.

Liquidation uses its separately configured capped funded fee policy, with no duplicate ordinary taker fee unless explicitly selected in G10. No unfunded liquidation-fee receivable becomes treasury cash. The liquidation must still meet strict post-fee risk progress.

## 5. Risk admission and reservations

Unpaid positive P&L has margin-credit factor h=0. Use conservative risk values: long exposure at the lower credible bound, short exposure at the upper. These side-dependent bounds are risk checks, not asymmetric accounting fill/closeout prices.

For ordinary admission, final E_i >= IM_i + R_i for every touched account. IM >= MM, with synthetic profile functions and exposure/concentration caps pinned in G03. Do not count fees twice if they were already deducted from C.

Voluntary reduce-only must reduce absolute q without crossing zero, preserve generation compatibility and obey price/fee/health rules. For an unhealthy account, a bounded reduction may use the explicitly defined deficit-improvement path; a better ratio does not permit increased exposure. Define deficit = max(MM-E,0). Liquidation must strictly reduce deficit after fees and reduce absolute exposure; receiver must satisfy IM and capacity. If no safe reduction exists, halt/escalate rather than pretend liquidation succeeded.

Persistent risk-increasing orders reserve conservative capacity for incremental margin, execution loss and fees over their permitted price envelope. Use conservative sums unless exclusivity is enforced on chain. Recalculate required reserve after every fill/cancel/replace or relevant risk change; do not release a blindly proportional fraction. A reservation does not guarantee execution after a market jump.

Reduce-only protection reserves no new directional exposure, but remaining fees/other obligations still affect withdrawals. No reserves may exceed the same underlying funded capacity through alias accounts/modules.

## 6. Route execution and maker commitments

The off-chain router labels its snapshot and finds the best eligible one/two-maker allocation for the requested size and all-in cost. It does not promise global best execution beyond received/eligible liquidity.

An immediate signed transaction binds venue/cluster/domain, market/terms/config epoch, exact base size and side, inclusive start/exclusive expiry, user limit, maximum fee, nonce and optional reduce-only/generation conditions. Immediate FOK executes directly under the wallet signature; no detached signed-intent/delegated-session system is required.

Persistent execution uses a stored order version and allowance. A keeper may select a partial remaining quantity, but each submitted subfill has an exact quantity that must fully execute atomically.

Clearing:
1. Validates owners, PDA/account bindings, role aliases, program IDs, domain, nonce/version, epochs and lifetime.
2. Derives the current action mode, valid risk observations and accrued funding.
3. Validates each maker registration/config/capital binding.
4. Calls each selected maker once with bounded read-only clearing inputs; verifies return-data producer/version/size.
5. Checks aggregate size, gross quote/fee limit, execution band and cumulative curve consumption.
6. Computes all paired deltas and final health, including fees, maker capacity and remaining reserves.
7. Commits positions, fees, nonces/consumption/reservations/generation and events together.

A failed second leg reverts first-leg exposure, fees, orders and curve consumption. Do not catch an arbitrary failing CPI and execute an unauthorized smaller route. Replanning uses a fresh valid transaction within the continuing user authority.

For each maker side/quote epoch, let K(f) be cumulative gross quote cost/proceeds after f lots. Additional d uses K(f+d)-K(f), with one specified integer rounding convention. Fills cannot repeatedly reset f to take the cheapest segment. Read current inventory for skew; epoch resets and validity are bound to the authenticated config. Return-data arithmetic is untrusted until clearing validates it.

P03 pins the bounded curves, expiry/reset policy, unique funded-capital binding and module approval rules in [MAKER-CONTRACT](P03-MAKER-CONTRACT.md). Its previews cannot consume liquidity or mutate financial state; P04 makes consumption atomic with the route, as specified in [ATOMIC-ROUTES](P04-ATOMIC-ROUTES.md).

Registration is standing maker authority for the admitted pricing program and capital scope. No maker co-signature is required per fill on this path. Signed private RFQs are deferred. Distinct addresses alone are not evidence of economically independent ownership.

## 7. Orders and races

Store owner, market/domain, economic order ID, slot/version, side, original/current authorized quantity, cumulative fill/notional/fee, remaining quantity, limit, inclusive start/exclusive expiry, trigger policy, reduce-only, position generation, group allowance and reservation. Checked counters never wrap silently.

States: Open, PartiallyFilled, Filled, Cancelled, Expired, Invalidated. “Submitted/confirmed/finalized” are transport observations. There is no persistent executing lock that grants extra authority.

- A persistent limit can retain a remainder after a successful atomic subfill.
- Cancel names expected order version and releases only remaining required reservation.
- Partial fills do not change the order version that a valid cancel targets.
- Replace increments version, retains the executed prefix, and atomically validates new remaining quantity/fee budget/reserve. Old cancels cannot cancel the replacement.
- Two keepers share consumption state; aggregate fills cannot exceed authority.
- Trigger eligibility is re-evaluated at each execution attempt, not latched forever.
- Trigger source is the valid central index-derived reference; execution has a separate price bound.
- Slot expiry is exclusive. Wall-clock oracle freshness and slot-based order lifetime are not interchangeable.

For a TP/SL pair attached to an existing position, initialize allowance A to the authorized protected size no larger than current absolute exposure. At execution, eligible size <= min(group remaining allowance, current absolute q, child remainder). Both children consume the same group allowance; a partial TP leaves only that allowance for SL. Manual reductions clip current eligibility.

Flat-to-open starts a new generation; becoming flat invalidates old protection; a flip ends the old generation and starts a new one. Old protective orders cannot revive on reopening. Additional same-generation exposure does not grow the group's original allowance. Cancelling one protective leg leaves the other valid within the shared remainder; an explicit cancel-group cancels both. Parent-linked entry protection is deferred.

Landed chain order decides fill/cancel/withdraw/liquidation races. A submitted cancellation has no priority promise. A no-op trigger earns no success reward.

## 8. Prices and source modes

Index = verified BTC/USD reference divided by verified collateral/USD reference, converted to protocol units. A token called USDC does not prove a fixed dollar value.

Central risk-mark display uses the valid index-derived reference. Risk checks apply the disclosed uncertainty bounds. Execution prices come from accepted maker terms. Candle OHLC/volume comes only from committed fills; missing trade intervals remain gaps or explicitly labeled carry-forward no-volume bars. Never present sampled quotes as trades.

Validate source identity/owner/verifier, feed IDs, verification level, timestamps/future skew, confidence, exponents, positive ranges, collateral conversion and divergence. Independent guard provenance is a separate requirement from using a second key. A local fixture is never labeled verified upstream data.

| Action | Normal | Degraded with credible bounds | No credible current bounds | Frozen resolution |
|---|---|---|---|---|
| Cancel | Allowed | Allowed | Allowed | Internal cancellation; idempotent cleanup |
| Deposit/register | Checked and allowed | Checked, no automatic risk permission | Deposits allowed without risky fills; new membership policy checked | Rejected; no new deposit escrow |
| Increase risk | Post-health/cap/reserve checks | Blocked | Blocked | Blocked |
| Voluntary reduce / liquidate | Valid bounds and progress | Only if credible interval and admission pass | No ordinary stale-price execution | Resolution only |
| New funding | Valid observation integration | Only valid covered time; otherwise zero | Zero new accrual; retain existing obligations | Frozen endpoint |
| Profit settlement / withdrawal | Funded and admissible | Conservative solvency/entitlement checks | Exposed/disputed claims blocked; flat cash exits only if whole-market solvency gate permits | Blocked until cohort completes |
| Resume | Already normal | Sustained validity/reconciliation window | Recovery gate | Explicit new epoch after full completion |

Effective mode is derived from current state/time at every sensitive action. A stale cached Normal flag is insufficient. Cancels/deposits must not call failing maker pricing just to discover they remain admissible. Funding outage restrictions and recovery windows are finite profile values pinned in P07.

## 9. Common funding

Use one F for the market. Positive increments charge longs and credit shorts. All position holders, including makers/liquidators, participate. Lazy accrual and fractional entitlements must be included in derived global claims.

For one authenticated sample:
1. Convert configured reference notional to a positive common base quantity Q*, rounding up to lots so the reference size is not understated.
2. Evaluate executable aggregate bid proceeds B(Q*) and ask cost A(Q*) using the same Q*, current registered maker states and capacities. Exclude the uniform venue taker fee from this premium signal.
3. Define impact midpoint J = (B/Q* + A/Q*)/2 and raw premium p = (J-M)/M.
4. Require complete configured maker coverage and sufficient executable depth on both sides. The initial sampler supplies both registered reference makers; a required unavailable/zero-capacity module makes the observation invalid. Quote coverage is aggregate, not Q* required from every maker.
5. Clamp p to the configured bound. Integrate the valid prior observation causally over covered elapsed time: dF = M * k * clamp(p) * dt / T_period. k and T_period have explicit units and pinned values.
6. Store sample sequence, timestamp, source/config/strategy epochs, validity deadline and outcome. No arbitrary administrator-supplied rate bypasses verification.

Use the prior valid sample's value over its bounded valid interval; a newly observed price cannot be retrospectively applied to an earlier gap. G08 fixes hold duration and maximum catch-up. An invalid/expired interval creates zero new funding, never fabricated catch-up. If required state epochs change or a long gap prevents validating the held interval, discard that unverified pending interval and record the reason. Public accounting must expose missing coverage.

Funding validation should not mutate quote consumption. The worker schedules and provides data/accounts; clearing recomputes/validates source and maker bindings. A keeper cannot cherry-pick only the favorable maker. Trading against remaining eligible capacity and funding qualification are distinct; prolonged loss of required inputs triggers the configured restrictive mode.

Participant fractional carry survives q=0 and reopening. No old entitlement moves to a new participant. Funding scale and rounding/error bounds are G02; sampling parameters are G08. Funding is not venue income and does not guarantee convergence or resistance to colluding maker behavior.

## 10. Liquidation and exceptional default

Ordinary liquidation uses a funded receiver, valid current risk bounds, bounded execution price and explicit capped cash-paid fee. Receiver passes IM; target strictly improves deficit and reduces exposure after fees. Cancel/reprice conflicting risk-increasing reservations. An unlimited uncapitalized liquidator is not an assumption.

Default is exceptional market closeout, not continuous ADL:
1. **Freeze / AwaitValuation:** halt trading and participating claim exits; freeze full registry membership, funding endpoint and terms; invalidate order/quote epochs. Reject new deposits/registration. Obtain one credible common closeout price M*. If absent, wait.
2. **Value all:** compute every exact claim at the frozen funding endpoint and common M*, including fractional state, into the frozen resolution ledger. The P09 paginated representation keeps ordinary position fields frozen until Apply; existing authority is already invalidated by the freeze epoch. Full economic valuation precedes every collection/allocation pass. Apply zeroes each position/claim and advances affected generations using the complete payout plan.
3. **Collect all:** for negative claims collect available C into P. Let residual debtor claims total D and positive claims total S. Then S-D=P under the exact claim invariant.
4. **Insurance:** z=min(I,D); I-=z; P+=z; deterministically reduce debtor claims by z. T is excluded unless a prior explicit allocation made it I.
5. **Impair:** cancel residual debtor claims by D and reduce all eligible unpaid positive claims by the same total D, proportionally and deterministically. Never haircut an arbitrary caller-selected subset.
6. **Settle / reconcile:** allocate available whole cash and explicitly resolve any fractional entitlement under the G02/G10 deterministic rule; all accounts and cash/claims totals reconcile before finalization. No missing atom or fraction is silently discarded.
7. **Resume:** only under explicit recovery authority, new epoch, valid source policy and verified reserves.

Where amounts are integral, allocate floors then largest remainders with stable participant-ID tie-break. Fractional claims require an explicit extension that preserves aggregate cash and entitlement error bounds; its design/test is a P02 requirement, its paginated realization P09. Do not claim the integral formula alone solves funding dust.

Registry pages freeze identity/length and track completed stages/cursors/bitmaps. Reject duplicate, omitted, foreign and out-of-order pages as required by the chosen monotonic traversal. Competing keepers cannot apply the same transition twice. Every stage completes the whole cohort before advancing.

Already funded paid gains are not clawed back. The modeled waterfall protects existing funded cash after contractual debtor collection; it does not insure token depeg, theft or malicious upgrades. A missing credible valuation can keep the market paused.

## 11. Golden economic examples for fresh implementation tests

These are exact specification examples, not historical executable test results. Their small prices are illustrative.

### V01: close through another maker, then settle

Use whole token units here; mint precision is six decimals. Trader, A and B each deposit 1,000; V=3,000, P=I=T=0. Trader buys 1 BTC from A at 100: trader (q=1,v=-100), A (-1,100). Fee 0.020 reduces trader C and increases T. Trader sells 1 BTC to B at 110: trader (q=0,v=10), B (1,-110). Second fee 0.022. At M=110:
- C_trader=999.958; C_A=C_B=1,000; T=0.042.
- U_trader=10, U_A=-10, U_B=0; sum U=0=P.
- Collect 10 from A: C_A=990; v_A=110; P=10.
- Settle 10 to trader: C_trader=1,009.958; v_trader=0; P=0.
- A remains short and B long, each with U=0 at M=110. Sum C + T = 3,000.
No profit cash existed merely because the trader became flat.

### V02: split/partial fee rounding

An economic order executes gross notionals of 2,000 + 2,000 + 2,000 quote atoms.
Cumulative charged fees are ceil(2000/5000)=1, ceil(4000/5000)=1, ceil(6000/5000)=2.
Incremental charges are 1, 0, 1; total 2 atoms. A single 6,000-atom execution also costs 2. Charging ceil independently for each slice would incorrectly cost 3.

### V03: insurance then complete-cohort impairment

Already valued q=0 cohort: debtor C=20,v=-100; winner A C=100,v=60; winner B C=100,v=40. Insurance I=30, P=T=0, V=250.
Collect debtor's 20 → debtor C=0,v=-80; P=20.
Insurance covers 30 → I=0,P=50,debtor v=-50.
Residual D=50 is allocated to claims 60:40 → impair A by 30 and B by 20; cancel debtor's -50.
Remaining claims 30 and 20 equal P=50. Settle → final C=(0,130,120), P=I=T=0, all v=0, V=250.
Repeat with different legal page sizes/restarts; final allocation must agree.

### V04: participant-owned funding fractions

Long has +3 lots, short -3. F increases by 1/10 quote atom per lot. Exact virtual quote changes are -3/10 and +3/10 atom; no cash is created. Accruing in several subintervals must equal one accrual. After close/reopen, each participant retains its own fraction; a new entrant receives none of it.

### V05: failed route and order generation

A route's first maker succeeds, second rejects: all venue q/v/C/T/order/curve state is unchanged (network fee may still be paid). For a 10-lot protected position, a 4-lot TP fill leaves at most 6 lots for the SL. A subsequent full manual close and reopening invalidates the old pair regardless of the new size/side.

The worker must implement these as independently calculated assertions and add boundary/property/adversarial cases. Passing only these five examples is insufficient for phase closure.


### P09 frozen-resolution implementation contract

[RESOLUTION](P09-RESOLUTION.md) selects G10's local funded receiver, strict post-fee progress, source emergency grace, complete-cohort traversal and authority recovery rules. Frozen mode locks registration, custody allocation and ordinary financial authority. Collection records its scaled adjustment in the resolution ledger while keeping ordinary virtual fields frozen, preserving derived valuation headroom. Paged Apply uses a fully computed funded payout plan, then a full account reconciliation. The pinned common reference, frozen funding endpoint and deterministic stable-ID allocation preserve D19 economics. Pending payout remains distinct from funded cash. Implementation acceptance and integration are tracked in WORKLOG.


D35 implementation clarification: a route quote is an explicitly confirmed provisional preview. It creates no cash, reservation release or execution guarantee. Finalized event projection and transaction receipts remain separate; clearing rechecks the signed observation, nonce, epochs, bounds and expiry on actual execution.

P23 adds [schema-3 custody](P23-ACCOUNT-CUSTODY.md) under D61: real owner cash
allocation and market-attributed insurance seed/classification, with trading and
all unfinished financial paths disabled. Its own signed/ABI/RPC acceptance is
recorded in WORKLOG and [P23 evidence](evidence/P23.md), not inherited from V2.


P26 adds authority-only `activate_accounts_v3` in the explicit
`account-safety-qualification` local profile. Complete precreated safety pages and
fresh initial qualification are mandatory; the earlier candidate transition cannot
bypass this gate. Default/devnet and earlier profiles remain disabled for this
entrypoint. Recovered identities use the separate recovery/reactivation path.
See P26 and WORKLOG for the exact accepted source pins and remaining phase gates.
