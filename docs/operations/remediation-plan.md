# Audit remediation delivery plan

Planning baseline: `e9eb320f65ca62f4bffefe9f1cd73a6f9feb4f1a`, 10 November 2026.
P48–P50 are integrated. The [audit](constraints.md) records inspected behavior and
provenance; this document owns the proposed delivery sequence and acceptance gates.
[STATUS](../STATUS.md) owns progress and actual PR links. Component contracts remain
normative until an implementation PR deliberately updates them.

The user requested this complete roadmap after discussing the audit. P51A delivers
planning only: no financial limit, parameter, authority, deployment or qualification
claim changes here. P51B is the next executable design/prototype deliverable. Later
PR scopes are planned, with the economic and architectural decisions below still
explicit. A plan, native model or passing sample is not acceptance of deployed code.

Read the [wave overview](#outcome-and-order), [decision gates](#boundaries-and-decision-gates)
and [PR sequence](#pr-sequence-and-dependencies) first. The detailed scopes and
[audit coverage matrix](#complete-audit-coverage) are the implementation handoff.

## Outcome and order

The target is a practical local engineering successor: account creation is no longer
limited to 64 lifetime venue slots; every admitted obligation remains resolvable;
indexing makes durable progress; pricing policy follows supported market units;
maker membership can evolve; economic parameters and operator costs have explicit
justifications; user capacity is governed by supported resources rather than old
fixture numbers. This does not promise infinite economic capacity or production TPS.

Start the account/settlement design first. Ship indexer progress and price-policy
separation before qualifying larger financial populations. Preserve today's exact
economics as the first settlement candidate; measure feasibility before committing
to its implementation. Paging storage alone does not solve the growing common
denominator or deterministic rounding graph.

| Wave | Planned phases | Result |
|---|---|---|
| Contract | P51A–P51B | Complete roadmap, operating envelope, executable settlement feasibility and exact successor contract |
| Foundations | P52–P53 | Restartable finalized indexing and coherent price/order policy |
| Account scale | P54A–P56B | Complete default, membership/lifecycle, ordinary payment progress, clients and larger-cohort acceptance |
| Maker scale | P57A–P57B | Controlled admission beyond the sealed three-maker/two-program profile; complete authenticated discovery and funding membership |
| Economic/lifetime policy | P58A–P58D | Impact notional, liquidation compensation, margin/OI policy and funding-index maintenance |
| Operations | P59A–P59C | Bounded fee bids, economical refresh and fair durable scheduling |
| User capacity | P60A–P60C | Account namespaces, order/protection capacity and explicit lifetime semantics |
| Closeout | P61–P62 | Retired vestiges and consolidated financial/resource/operations qualification |

## Boundaries and decision gates

Keep BTC/ETH, one collateral mint, separate portfolio/margin/venue responsibilities,
isolated maker capital, no positive unpaid-profit margin credit, no correlation
discounts and no implicit sibling backing. Preserve whole-account funding,
reservations, held-window cash-exit checks, explicit flat-only funded netting,
existing-position reduce-only TP/SL, 2 bps taker/zero provider fees and 25% insurance
with exact carry. Trading still selects at most two distinct maker capitals and
performs full landed financial admission. Maker CPI never receives vault authority
or arbitrary writable clearing accounts. Updaters only reprice. Published-depth
funding stays separate from hypothetical maker-margin admission and risk valuation.

| Gate | Owning phase | Required decision / evidence |
|---|---|---|
| G1: operating envelope | P51B | Distinguish registered, economically participating, simultaneously exposed and default-connected accounts; maker population, OI, orders, latency and recovery budgets. Publish benchmark targets and resource/fee ceilings with rationale before implementation. Targets are not new protocol ceilings. |
| G2: settlement semantics | P51B, P54 | Preserve complete membership, market attribution, greatest clearing solution, insurance priority, fractional ownership and deterministic conserving rounding. Any alternative precision, loss allocation, insurance treatment or trust assumption requires a concrete comparison and explicit user approval. |
| G3: ordinary profit-payment progress | P51B, P55B | Select a sound progress mechanism under relevant concurrent changes. If it needs a new user-visible coordinated pause/window, describe its scope, duration and exit effects and obtain approval before adopting that departure. |
| G4: maker coverage | P57B | Specify the eligible funding population and its epoch changes before looking at current quotes. Any change from complete configured coverage needs an explicit decision; no publisher-selected convenient subset. |
| G5: economic calibration | P53, P58A–P58C | Separate representation limits from versioned economic policy. Propose literal parameter values and scenarios first. Material changes to risk acceptance, liquidation compensation or funding inputs need recorded approval; this plan does not choose them. |
| G6: time and authority | P58D, P59B, P60C | Index maintenance cannot erase accrued funding; refresh optimization cannot renew stale data; extending order lifetime is distinct from extending delegated signing authority. Oracle/hold/recovery relaxation is not a performance fix. |

Ordinary implementation choices continue within accepted contracts. Decision gates
are attached to specific unresolved choices, not repeated permission requests per
PR. If a candidate fails its proof or resource gate, record the failure and revise
that candidate. Do not enable a weaker financial path to complete a phase.

P15B independent makers and P16B independent review/funded readiness remain separate
external gates. Continuous 24-hour endurance remains Deferred. No scheduled soak,
funded/production deployment, outreach, paid service or external hedging is part of
this work. Internal makers and synthetic inputs remain labelled.

## PR sequence and dependencies

Each row is one intended ready PR with a cohesive acceptance boundary. P51A is this
planning PR. Phase IDs are not GitHub PR numbers. Do not precreate empty PRs for
later rows. Refine a scope into numbered
subphases before implementation if the chosen design cannot be reviewed coherently;
update this table and STATUS rather than silently combining unrelated work.

| PR phase | Deliverable | Technical prerequisites |
|---|---|---|
| P51A | Complete audit-remediation roadmap | Integrated P50 |
| P51B | Account/settlement contract and executable feasibility | P51A |
| P52 | Bounded-progress finalized indexer | P51B interface/envelope contract |
| P53 | Numeric versus market price/order policy | P51B numeric contract |
| P54A | Scalable exact settlement kernel | P51B/G2, P53 bounds |
| P54B | On-chain frozen input and rate verification | P54A |
| P54C | On-chain rounding, application and recovery | P54B |
| P55A | Paged membership and safe account lifecycle | P51B identity contract, P54C safety path |
| P55B | Scalable ordinary backing/payment progress | P55A, G3 |
| P56A | Account-scale services, SDK and UI | P52, P55A–P55B |
| P56B | Larger-cohort acceptance and local activation | P53–P56A |
| P57A | General maker admission/lifecycle | P56B |
| P57B | Larger maker discovery/routing/funding coverage | P57A, G4 |
| P58A | Impact notional and scalable funding search | P53, P57B, G5 |
| P58B | Funded liquidation incentive policy | P56B, P57B, G5 |
| P58C | Margin, concentration and OI policy | P53, P58B, G5 |
| P58D | Exact funding-index lifetime maintenance | P51B index contract, P58A–P58C |
| P59A | Reviewed fee bidding and resource budgets | P56B; current per-action measurements |
| P59B | Due-driven maker/publisher scheduling | P57B, P58A, P59A, G6 |
| P59C | Fair worker discovery and durable concurrency | P52, P55B, P59A–P59B |
| P60A | Portfolio/subaccount namespace capacity | P55A, P56A |
| P60B | Order/protection capacity and reservations | P54C, P58C, P60A |
| P60C | Order and delegate lifetime semantics | P58D, P60B, G6 |
| P61 | Reference-code/configuration retirement | P52, P58A; final call-site audit |
| P62 | Consolidated successor qualification | All preceding enabled changes |

Publication order follows the table as a linear stack; technical prerequisites
show which contracts are actually required. Use `gh stack` and
`gh stack submit --auto --open`. Verified parents in Review are valid development
dependencies; do not wait for merge to continue authorized work. Keep PRs open
until instructed to merge. A blocked economic decision can leave its feature
disabled while an independent approved deliverable proceeds with explicit ancestry.

## Account and settlement deliverables

### P51A — delivery plan

Map every audit finding to an owning phase, retained invariant or explicit decision.
Record PR boundaries, deployment policy, acceptance and evidence rules. Validate
paths, links, phase dependencies and finding coverage. No runtime acceptance here.

### P51B — contract and feasibility

**Deliver:** a code-to-design matrix covering registry/count/ID widths, portfolio
children, member hashes, source and liability fences, root/market aggregates,
resolution pages, wide integers, graphs/bitmaps, certificates, events and clients.
Specify versioned layouts, authority, state transitions, page allocation/rent,
identity retirement, freeze membership and malicious/incomplete proposal recovery.
Write the selected contract into the owning clearing/application documents, clearly
separating proposed successor behavior from the still-supported implementation.

Build an executable exact reference candidate and independently derived oracle.
Compare costs for multiple populations, claim shapes and denominator widths. Include
populated indebted accounts, mixed isolated/cross roots, reciprocal cycles with
external creditors, fractional claims, no/partial insurance and numeric extrema.
Evaluate dynamic exact arithmetic and verification strategies without assuming that
an off-chain solver removes the verifier's work. Explain any added trust assumption.

**Acceptance:** G1–G3 have concrete recommendations, bounds and implementation gates;
normal/adversarial operation counts, storage and completion cost are reported.
Preserve exact current outcomes on the existing population domain. Suggested initial
model sizes are 64, 128, 1,024 and 10,000 roots: diagnostic sweep points, not supported
capacity claims or future registration limits. Model, compiled-probe and RPC results
are labelled separately. Freeze the accepted financial/resource test matrix before
P54; an uneconomic/unproved candidate is a design result, not phase completion.

**Important coupling:** account growth changes aggregate cash/claims and graph/index
bounds even when per-account quantities stay fixed. Plan P58D's index representation
and P60's namespace/order extensibility here; later numeric changes must rerun the
affected default proof. Preserve finite checked arithmetic and counter exhaustion.

### P52 — indexer progress

**Deliver:** bounded, restartable finalized block coverage, ordered application and
durable checkpoint progress. Specify staged coverage versus reconciled/read-ready
projection so a partial prefix cannot masquerade as current state. Bound memory and
RPC work per chunk; reconcile against an authenticated attainable fence while head
continues advancing. Implement or retire the unused `pageSize` option explicitly.

**Acceptance:** actual Surfpool/RPC/WS and PostgreSQL backlog exceeds both the old
10,000 total-transaction default and 4,096 Rivalt-invocation ceiling, with unrelated
traffic, disconnects and process death before/after chunk commits. Each restart
makes measured progress; fresh replay equals the complete projection. Missing blocks,
revision gaps, duplicate-conflicting bytes and false completeness still reject.
Read readiness cannot be obtained by suppressing reconciliation errors. Keep the
initialization/genesis/artifact binding and historical signed originals intact.

### P53 — price and order policy

**Deliver:** one unit-aware, versioned price policy shared by oracle normalization,
orders/triggers, maker bands, funding, liquidation, SDK and UI. Separate hard proved
arithmetic limits from market policy. Replace the inherited BTC/ETH fixture bands
only within an approved numeric envelope. Define authority, activation epochs and
existing-order behavior for parameter changes; no retroactive signed-limit rewrite.

**Acceptance:** independent reference and real signed paths immediately inside/outside
old bands, at new numeric boundaries, under collateral depeg, source disagreement,
staleness and extreme confidence. Deposits/cancels and eligible reductions/exits or
default remain reachable under their correct source rules. Preserve freshness,
confidence, independent risk and recovery safeguards. G5 records any materially
different accepted risk range before enabling it.

### P54A — settlement kernel

**Deliver:** the G2-selected scalable arithmetic/flow model without fixed 64-root
graphs or assumed 96-limb sufficiency. Specify finite per-step work, total progress,
wide storage bounds, greatest-rate verification, insurance clipping, deterministic
rounding and exact attribution. Maintain an independent oracle rather than testing
the same kernel through two wrappers.

**Acceptance:** literal financial vectors and adversarial populations reproduce
claims, collections, insurance, final cash, writeoffs and rounding adjustments.
Check every account and market conservation equation, stable ties and cashless
cycles. Larger state must have a demonstrated completion path; bounded transaction
work alone is insufficient if total work/storage is impractical.

### P54B — frozen input and rate verification

**Deliver:** compiled paged storage, complete authenticated snapshot/value passes,
resumable denominator/rate work and invalid-proposal reset. Use P51B's successor
identity interfaces; provisioning helpers do not grant trading or payout authority.

**Acceptance:** actual signed freeze/valuation/proposal/verification against deployed
programs; omission, duplicate, reordered/foreign pages, stale epochs, malformed or
oversized proposals and stalled proposer recovery. Every observed prefix matches
the reference. Measure full instruction contexts, packet size, CU, heap/stack and
rent; no partial proposal or incomplete verification permits Apply. Successor
financial activation remains disabled.

### P54C — rounding, application and recovery

**Deliver:** complete scalable flow planning, conserving deterministic rounding,
exactly-once Apply/Reconcile, terminal cash/reserve ownership and explicit recovery.
State partial-application accounting without double-counting frozen/live balances.

**Acceptance:** independently audited full default payouts and market writeoffs,
including isolated/cross debtors and creditors, insurance clipping and receiver
accounts. Interrupt/restart every stage; prove rejected/replayed pages have no
financial effects and cannot strand the frozen epoch. Actual token exits and fresh
PostgreSQL replay match. Unrelated healthy cash, retained fees and foreign insurance
cannot become a default subsidy. New-population activation remains disabled.

### P55A — membership and account lifecycle

**Deliver:** paged, authenticated registration and economic-participation tracking
with stable identities, rent ownership, safe retirement and anti-replay generations.
Separate empty identity creation from financial membership where the proof permits;
do not let a new empty account invalidate every financial scan unnecessarily.
Define each lifecycle transition's exact treatment of cash, positions, claims,
fractions, funding checkpoints, orders, protections and delegates. Deregistration
cannot hide an obligation; retired identities cannot revive signed authority.

**Acceptance:** registration beyond 64 without a new small fixed venue-wide ceiling;
empty-account churn cannot exhaust permanent membership slots. Participation entry/
exit is atomic with the financial transition. Complete scans cannot skip a liability
or count it twice. Include concurrent registration, trade, transfer, retirement and
freeze races, and measure page/allocator write contention. Avoid a new shared
registry write on every ordinary trade. Whole-venue retirement remains distinct.
Generated codecs/minimum consumers change in this PR so the branch stays executable.

### P55B — ordinary backing and payment progress

**Deliver:** G3's scalable backing/progress mechanism for collected losses, gain
payment and explicit flat netting. State exactly what remains valid across price,
funding, liability and membership changes. A cached aggregate is not safe solely
because its count/hash matches. Own funded withdrawal remains account-local.

**Acceptance:** mixed-market debtors and concurrent activity cannot cause unsafe
payment, stale-certificate reuse or starvation beyond the accepted liveness policy.
Demonstrate progress under the declared workload and report invalidation/retry
denominators. Verify transfers, withdrawals, fractional unpaid claims and TP/SL
reservations independently. Any coordinated window required by the design must
meet G3; a more permissive stamp check is not an acceptable shortcut.

### P56A — account-scale clients and services

**Deliver:** SDK discovery/builders, API, indexer schemas/projections, restartable
resolution/backing workers and UI for paged accounts and retirement. Use bounded
reads with completeness/revision fences. Keep user-facing portfolio/margin identity
clear; pages are infrastructure, not new user-selected loss-sharing groups.

**Acceptance:** coherent multi-page discovery; wallet-signed create/fund/trade/order/
TP-SL/transfer/withdraw/retire flows; missing/mixed pages fail closed. Actual workers
resume after crash/lost acknowledgement using the same persisted original. Fresh
PostgreSQL replay and reload match account-level ownership. No pending original is
silently migrated to a new deployment or decoder.

### P56B — larger-cohort qualification and activation

**Deliver:** one pinned successor deployment and reproducible populated-cohort matrix
covering normal activity, stressed liquidation, complete default, restart and exits.
Enable only its explicit local qualification profile after all account-scale gates
pass; default/devnet remain disabled. Account registration and financial admission
must not outrun the implemented resolution capability.

**Acceptance:** materially exceed 64 financially participating roots at the G1 target,
with debts/credits/cycles rather than a capacity claim based on empty roots. Verify
whole-account funding/reservations, cash and claim conservation, consenting receiver
health and strict liquidation progress after fees. Record per-transaction and total
resolution costs, rent, completion time, contention and independent exact payouts.
Fresh SQL replay and wallet exit must pass. Report tested capacity and resource
limits separately from logical account scalability. No activation on a partial pass.

## Maker and economic deliverables

### P57A — maker admission and lifecycle

**Deliver:** authenticated, versioned maker membership with controlled add/disable/
quarantine/reapprove/retire transitions; remove the hard requirement for exactly
three instances including named A/B deployments. Admit reviewed implementations
through explicit program/code/capability bindings, preserving unique isolated
capital and bounded read-only quote dependencies. No arbitrary spot-pool routing.

**Acceptance:** more than three makers and an additional locally deployed admitted
program can participate through the same interface. Duplicate capital, unsupported
capability, bad loader/hash, stale epochs and unauthorized updater/control reject.
Disabled/removed quoting does not remove debts, claims or default membership.
Old routes/reports cannot survive an incompatible membership transition.

### P57B — discovery, routing and funding membership

**Deliver:** coherent multi-batch candidate discovery and deterministic best-single/
pair search across the admitted population. Preserve explicit search exhaustion;
sampling candidates cannot be labelled globally optimal. Replace the fixed 48-key
snapshot assumption where necessary without widening every execution transaction.
Version G4's complete funding cohort and retain ordered input provenance.

**Acceptance:** independent route/impact comparison at several maker counts, full
code authentication, snapshot races, missing/stale/quarantined coverage and dishonest
omission. Two selected capitals remain the transaction maximum. Measure quadratic
pair-search growth, RPC bytes, publisher cost and selected-route CU/locks. Keep eight
curve regions initially unless a separately proved capability expansion is needed;
document measured reasons for retained per-call/event bounds, including 32 entities.
Changing coverage rules needs G4; disabling a required maker cannot silently improve
the funding statistic by removing its inconvenient quote.

### P58A — funding impact notional

**Deliver:** justified per-market impact notional in explicit collateral units and
an exact scalable published-depth allocator beyond the current Q<=600 enumeration.
Version report/config/SDK checks together. Preserve the funding objective, one/two-
maker limit and omission of hypothetical financial admission; do not reuse trader
fees, self-trade rules or margin pruning as funding policy.

**Acceptance:** independent small exhaustive and large exact vectors; unit/rounding,
insufficient-depth, thin-quote/manipulation and coverage scenarios; real signed
causal accrual and report replay. Record selected notional rationale under G5 and
measured build/submit work. A larger Q alone does not demonstrate robust funding.

### P58B — liquidation incentives

**Deliver:** a funded receiver compensation proposal covering transaction cost,
inventory/capital commitment and liquidation size, followed by the approved bounded
policy and matching previews. Separate observed fees from assumed hedge/slippage/
capital costs. Specify payer, cap, fee rounding and insufficient-cash behavior.

**Acceptance:** literal small/large/partial liquidation cases with target cash caps,
receiver IM/consent, full funding and reservations. Strict exposure and whole-account
MM-deficit progress must survive the reward; otherwise reject atomically. Include
cases where a larger reward prevents a useful liquidation. No automatic insurance
subsidy, fee-share change or claim of independent liquidator profitability. G5 owns
the actual incentive change.

### P58C — margin, concentration and OI

**Deliver:** separate proved numeric maxima from market-level position/OI and margin
policy, calibrated against liquidation capacity and concentration. Explain whether
the existing 100m position/200m gross domain remains adequate; do not equate more
users with more economic capacity. Define policy-update authority, epochs, existing
positions/orders, reduction and emergency behavior.

**Acceptance:** independent boundary and portfolio scenarios, multiple simultaneous
large roots, insolvency/default and cross-market effects. Preserve additive negative-
claim risk, no correlation discounts and no positive unpaid credit. Any wider numeric
domain needs a new whole-path overflow and terminal-arithmetic proof, fresh compiled
checks and exact client parity. G5 owns margin/OI values; test data alone is not
production risk calibration.

### P58D — funding-index lifetime

**Deliver:** an exact, versioned representation/maintenance strategy that removes the
inherited cumulative-index lifetime cliff without forgiving or repeating accrual.
Cover every root checkpoint, inactive account, held interval, report, certificate,
frozen valuation and indexer projection. A larger constant alone needs a complete
remaining-lifetime proof; an administrative reset is not a solution.

**Acceptance:** equivalent balances before/after maintenance with positive/negative
funding, fractional units, untouched accounts and interrupted processing. Cross
old numeric boundaries using deterministic elapsed-time inputs and real signed
maintenance/recovery; label accelerated time as such. Recheck P54's proof if claim
bounds change. No need to wait months or revive the deferred 24-hour test.

## Operational and user-capacity deliverables

### P59A — bounded fee bids and compute budgets

**Deliver:** owner-reviewed transaction fee ceilings and per-role operator budgets,
with explicit bounded priority bidding and simulation-informed compute headroom.
Update SDK, wallet review, ingress, signing, executor and accounting coherently.
Record requested/consumed CU, fee bids and independently fetched actual fees.

**Acceptance:** tampered financial instructions, resource prefixes and over-budget
fees reject; insufficient lamports, expired/lost-ack originals and restarts retain
correct reservations. Never change already signed bytes or issue a new bid for an
ambiguous original. Local bidding tests establish accounting, not public-network
landing probability. No real-money deployment or paid RPC is needed.

### P59B — due-driven publication

**Deliver:** schedule reference-maker reads/reprices from price/control/expiry needs,
with early enough renewal for unchanged prices; coalesce work without losing depth/
authority changes. Keep the supported publisher cadence and risk timing unless G6
explicitly changes the contract. Expose due, skipped, late and unavailable reasons.

**Acceptance:** unchanged/moving prices, expiry boundaries, missed notifications,
updater rotation, process restart and delayed RPC. Compare reads, originals, fees
and qualified quote coverage against the same workload. A heartbeat, cached read or
reused timestamp cannot make a stale quote/report fresh. Preserve owner/updater
separation and explicit depth replenishment.

### P59C — worker fairness and concurrency

**Deliver:** persistent fair cursors/deadlines for order, risk and settlement work;
bounded configurable concurrency and correctly partitioned budgets/leases. Retain
full signed resource conflict admission and single-original ownership across workers.
One unresolved action may block its actual resource/budget, not unrelated work by
accident; never release its reservations just to increase throughput.

**Acceptance:** multiple workers, hot/cold roots, reordered RPC replies, repeated
restarts, expiry and missing receipts. Prove no starvation within the declared load,
double send/admission or overspent budget. Measure queue age, attempted/submitted/
landed/finalized populations and contention with actual RPC/WS/PostgreSQL. Increasing
lane count is not itself a throughput result.

### P60A — account namespace capacity

**Deliver:** remove inherited four-portfolio/eight-child organizational restrictions
where supported by the P51/P55 identity design. Replace bitmap-dependent discovery
and arbitrary cross-child-zero coupling with an explicit versioned identity contract
if chosen; preserve immutable mode/market and authorization. No live mode conversion.

**Acceptance:** create/discover/fund/retire beyond old namespace limits, sparse IDs,
same-owner isolation, delegate epochs and replay-resistant reuse policy. Test SDK/UI
pagination and every ownership/custody path. Portfolio metadata still owns no funds;
moving collateral remains an explicit checked margin-account transfer.

### P60B — order and protection capacity

**Deliver:** a measured order-storage/reservation design beyond four orders/two pairs.
Any reservation summary must remain sound under prices, funding, partial fills,
expiry, cancellation, generation invalidation and configuration changes. Define
bounded mutation/read work and liquidation/default cleanup before enabling it.

**Acceptance:** independent worst-case full books with multiple TP/SL pairs and entry
orders; no under-reserved withdrawals/transfers/routes. TP and SL share allowance;
manual reductions/flat/flip cannot revive protection. Measure full-context routing,
liquidation and default costs against the accepted budget. Do not move an unbounded
order scan into every trade to remove an embedded-array limit.

### P60C — lifetime semantics

**Deliver:** explicit configurable order duration and delegated-session semantics,
including a decision on GTC support. Distinguish wall-clock versus slot policy,
order validity versus execution-quote freshness, and owner versus delegate authority.
Keep nonce/version/epoch replay fences and observable expiry in API/UI.

**Acceptance:** variable slot timing, exact start/expiry boundaries, long-lived
orders, revoked/expired delegates, replace/cancel races and restart. Any indefinite
order must still refresh reservations and obey current risk/funding/generation
rules. Do not grant indefinite delegated authority implicitly with GTC orders.

### P61 — confirmed vestiges

**Deliver:** complete the call-site audit of reference-only `best_sample_pair` and
the obsolete on-chain sampling resource description. Move/label retained independent
reference tools or remove unused code with provenance. `PreparedMakerRisk` remains
live and must be preserved. P52 already owns the unused `pageSize` disposition.

**Acceptance:** actual call-site/build/dependency checks, affected reference parity
and no change to live quote/risk/funding behavior. Preserve old artifacts, research,
keys, databases and raw evidence. Avoid unrelated naming or formatting churn.

### P62 — consolidated qualification

**Deliver:** a pinned final revision and reproducible operator recipe combining only
the accepted successor paths. Refresh the instruction inventory and matched CU,
wire, account-lock, storage/rent and fee tables; preserve the pre-change baselines.

**Acceptance:** signed normal/fault/recovery/default/exit scenarios with independent
financial expectations and identical fresh PostgreSQL replay; browser signing where
changed. Repeat affected full-context/hostile-CPI cases, larger population and maker
cases, measured operator load and resource contention. Report offered/admitted/
submitted/landed/finalized/filled denominators separately, classified unavailability,
unresolved originals, duration and hardware. Compare costs by venue, maker and trader.
State measured technical limits and provisional economics; no profitable-operation,
sustained-production-TPS or independent validation claim follows from local tests.
Complete bounded acceptance rather than scheduling a 24-hour endurance run.

## Complete audit coverage

These IDs label findings for this plan; they do not replace historical decision IDs.

| Finding | Owning phase(s) | Required disposition |
|---|---|---|
| F01 — 64 lifetime margin roots / fixed default arithmetic | P51B, P54A–P56B | Scalable membership plus complete resolvability; no constant-only removal |
| F02 — fixture asset/reference/order/trigger bands | P53 | Unit-aware versioned policy within proved arithmetic |
| F03 — six-token funding impact / Q<=600 enumeration | P58A | Justified impact notional and scalable exact published search |
| F04 — one-cent liquidation reward cap | P58B | Approved funded incentive with strict progress after fees |
| F05 — indexer backlog/readiness cliff | P52 | Durable bounded progress and authenticated reconciliation |
| F06 — three sealed makers / two named programs / complete coverage | P57A–P57B | Controlled extensible admission; explicit coverage decision |
| F07 — 100m position / 200m gross envelope | P51B, P58C | Separate capacity policy and numeric proof; widen only with proof |
| F08 — uniform 10%/5% margin | P58B–P58C | Calibrate against liquidation/concentration; no automatic relaxation |
| F09 — cumulative funding-index lifetime | P51B, P58D | Exact long-lived representation/maintenance |
| F10 — four portfolios / eight isolated children / cross child 0 | P55A, P60A | Stable scalable identity and explicit namespace policy |
| F11 — four orders / two protective pairs | P60B | Bounded storage and complete conservative reservations |
| F12 — 216,000-slot order/delegate horizons | P60C | Explicit duration/GTC/session contract |
| F13 — maker/source/report/hold/recovery timing | P53, P59B, P62 | Measure coupled timing; retain safeguards absent an approved change |
| F14 — zero priority fees / rigid client CU budgets | P59A | Signed bounded bids and durable worst-case fee reservations |
| F15 — unconditional one-second internal repricing | P59B | Due-driven renewal with measured cost/coverage |
| F16 — role-wide blocking / two lanes / small scans | P59C | Fair bounded scheduling and resource-aware concurrency |
| F17 — invalidatable complete profit-backing scans | P51B, P55B | Sound progress policy; no weakening of cash/claim ownership |
| F18 — eight regions / 48 snapshot keys / 32 event entities | P54–P57, P60B, P62 | Remove coupled population bottlenecks; justify and measure retained per-call bounds |
| F19 — accepted but unused pageSize option | P52, P61 verification | Implement documented pagination or explicitly retire the option |
| F20 — reference-only Rust sampling code | P58A, P61 | Explicit reference placement/removal; preserve live maker-risk code |

## Deployment, verification and maintenance

- Keep every phase executable: include minimum IDL/generated SDK/decoder/config
  changes with its ABI change. Human-readable names remain canonical; numeric wire
  schemas, domains, epochs and deployment identities stay explicit. Verify layout,
  discriminator, PDA, account privileges, error numbering and signed-domain deltas.
- Use fresh local successor deployments and databases for incompatible schemas.
  Preserve historical artifacts/clients, keys and unresolved originals in place.
  Never relabel old positions/claims or migrate funds by editing a projection.
  Compatible service SQL upgrades need explicit restart/rollback handling.
- Unfinished successor paths reject. Before P56B, expanded-population financial
  activation stays disabled even if storage or model tests pass. Later maker/order/
  policy extensions have their own activation gates; P56B does not qualify them.
- Select checks from [validation](validation.md). Independent financial expected
  values must come from literal arithmetic or a separate reference. Integrated
  claims require deployed signed programs, independently fetched RPC/WS outcomes
  and PostgreSQL. Native, simulated, injected-input and submitted results stay
  distinct. Reuse immutable artifacts only when their exact source/binding applies.
- Measure both local per-transaction cost and total lifecycle work; include program
  binaries, heap/stack, serialized wire, read/write sets, priority bids, rent, RPC
  load and recovery time where changed. New global writable summaries need explicit
  contention analysis. Existing matched baselines are not new evidence.
- Run affected checks per PR; broader supported regression belongs in CI. P62 is
  the deliberate combined qualification, not a reason to rerun every suite at each
  intermediate step. No raw evidence, per-run document or required archive enters
  Git; retain existing ignored local paths and track concise claims.
- Each PR updates its owning current component contract, STATUS, and relevant
  validation claims. Add a dated decision for actual authority/economic/architecture
  choices, naming deliberately superseded decisions. HISTORY records integration,
  not pending work. Review means acceptance pending integration; Closed includes
  verified integration. Record exact tested revisions, failures, omissions, blockers
  and one next action without accumulating a run diary.

The first implementation action is P51B's dependency inventory and executable
settlement feasibility. Its evidence determines the detailed P54/P55 mechanism;
this roadmap does not pre-approve an unproved solver or silently select rounding,
coverage, fee, margin or oracle policy.
