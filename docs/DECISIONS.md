# Current design decisions

These are current choices and their rationale. Component specifications own exact
rules. Historical D-numbers remain stable references; the complete supersession
chain and original acceptance claims are preserved in [HISTORY](HISTORY.md).
A source rename or documentation cleanup changes neither economics nor authority.

## D102 — maintained backing inside existing financial ownership (12 November 2026)

P55B2 implements D93/G3's conservative-region proof without a coordinated pause.
The candidate places one selected-market summary/region/epoch inside each existing
MarketLedger and two processed-epoch markers in each MarginAccount. A bounded scan
writes the authenticated root marker and selected ledger as well as its cursor;
ordinary root mutations maintain their already-required market ledgers. This
supersedes the tentative extra per-page financial summaries in the P51B proposal:
the complete live index proves coverage, while a per-root epoch proves whether a
contribution has joined the summary. No new page or global registry write is added
to every route. Actual contention/CU must still be measured before acceptance.

Reserve fresh clearing schema **10 / local profile 6** for these changed layouts.
Selected schema-8 and P55A2 schema-9 artifacts stay separate. Root IDs/seeds and
lifecycle economics are unchanged. The existing 64 Financial qualification gate
remains. Complete SDK/event/indexer and source-derived wire checks are mandatory;
this decision does not authorize reinterpretation of earlier roots or journals.

A proof starts a monotone nonzero market-local epoch, freezes its Financial count/
epoch, safety/terms/config bindings and arithmetic region, and resets coverage.
Each member contributes once. Every subsequent economic mutation of a processed
root replaces its exact before/after contribution atomically, including cash-only
and fee changes; unprocessed roots remain owed by the scan. q=0/z=0 in a selected
market contributes zero regardless of cash or sibling exposures, so omitting that
irrelevant ledger remains sound. Order/delegate-only paths must prove cash/q/z
unchanged. A newly bad contribution blocks payment rather than vetoing an otherwise
admissible financial action. Positive unpaid profit and insurance are never credit.

Financial membership changes invalidate the entire old membership-bound proof;
the next epoch makes every root explicitly unprocessed, including reentered roots.
Empty registration/retirement leaves it valid. This chooses the conservative
restart allowed by the candidate's bounded-membership-churn limit, rather than
adding writable ledgers to the fifteen-node membership transaction. Liveness is
required under ongoing in-region economic activity and a bounded number of actual
membership transitions, not under infinitely fast new entries/exits. Retry reasons
and denominators must expose that distinction. No old count alone can certify a
new membership set.

Region construction is deterministic, not proposer-selected: extend each current
risk price interval by its own width on both sides (at least one atom, clamped to
the existing numeric domain). Extend the current held funding interval by one
hour of the existing maximum per-hour funding premium at that region's upper
price, clamped to the existing cumulative-index domain. These are conservative
proof bounds, not new price admission, funding accrual, oracle-age or recovery
rules. They may withhold a payment whose current-point debtor is solvent. Current
credible required sources and **all** current/held endpoints must still lie inside
the region at payment. Out-of-region changes or incompatible bindings require a
new proof; fresh in-region observations and checkpoint consumption do not.

No permissionless reset may erase a valid complete proof. During a partial scan,
an out-of-region endpoint in either market may permit restart, even if that
market's first debtor has not been encountered yet. For a completed proof, only
its actual dependency mask governs source/region checks. This prevents an unseen
sibling dependency from stranding partial work and prevents unrelated market
sampling from destroying completed scoped payment authority. Safety/default and
terminal transitions invalidate old epochs before reuse; ordinary funded-cash
exits retain their existing local admission and never depend on this proof.

This is the implementation contract; [validation](operations/validation.md#maintained-backing-integration-p55b2)
records P55B2's accepted signed mutation, source, rollback, default/recovery and
durable-worker checks. The stack remains unmerged. These bounded results do not
activate expanded population, the full default worker or the selected runtime.

## D101 — canonical live membership and retirement wire (12 November 2026)

P55A2 uses D93's fresh schema 9 / local profile 5 for the fixed registry header,
u64 member IDs, u32 portfolio/child seeds and explicit Registered/Financial/Retired
roots. The membership epoch changes only on Financial entry/exit. Empty identity
creation/retirement changes discovery revisions and counts but cannot invalidate a
financial commitment. Financial roots stay indexed until an owner explicitly exits
with zero cash, quantities, claims (including fractions), reserves, active orders,
protections and delegate authority. An owned maker binding still blocks exit until
P57 supplies maker retirement. Reentry increments activation generation and replay
counters without resetting order IDs or position history.

A root retires to a permanent 135-byte `MarginTombstone` at the same PDA. The owner
who paid root creation receives only the rent above the retained tombstone minimum.
The journal's sole root-kind transition is MarginAccount (5) to MarginTombstone
(26), preserving the predecessor revision and incrementing it once. Consumers must
accept that change only with the `retire_margin` instruction and matching lifecycle
payload; it is not a general account-kind relabelling rule. Empty exits remain
possible after terminal venue retirement; activation and registration do not.

Terminal recovery-allocation refunds similarly retain a permanent 72-byte
`StorageTombstone` plus the immutable payer receipt. Only PreparedSettlement,
FrozenMarginPage, SettlementLimbPage, SettlementRates and SettlementPlan may
transition to journal kind 27, only through `refund_recovery_allocation` with its
matching refund payload. The program authenticates the original canonical
allocation, completed epoch and recorded payer before returning excess rent.
Member pages/indexes cannot be reclaimed through this instruction. Refunding an
allocation immediately invalidates the workspace capacity proof; no terminal
allocation can be revived or count toward future Financial admission.

This deliberately replaces the P54/D97 frozen **mirror** with the live Financial
index. The complete snapshot binds venue, canonical index root, financial count and
membership epoch; each row records the actual activation generation. D100's funded
workspace is locked at freeze, retagged only from completed older epochs and
unlocked only after complete financial reconciliation. The seven old fixed-cohort
solver instructions, their inline wide work/page accounts and two mirror-creation
instructions are removed from the new dispatch/IDL. Historical journal kinds 11/12
stay reserved. The exact native reference arithmetic remains available for checks;
there is no callable fixed-size fallback for a larger live registry.

The successor's local financial-admission gate remains 64 until P56B's populated
acceptance; registration, stable IDs and traversal have no corresponding 64-root
ceiling. This is an explicit temporary qualification gate, not a newly chosen
permanent protocol cap. Default/devnet remain disabled. P55A2 is unfinished until
minimum client/indexer migration and fresh signed RPC/WS/PostgreSQL acceptance pass;
these source changes do not promote an artifact or relabel P54 evidence.

## D100 — pre-funded reusable recovery workspace (12 November 2026)

P55A2 implements D93's requirement that recovery storage be funded before financial
admission. Use one canonical reusable workspace per venue, with a bounded proof
over every required physical allocation. Capacity depends on the Financial count,
not the highest stable member ID or Registered-only population. The schedule covers
all frozen rows, exact-width arithmetic registers and conserving graph/order work.
The program must authenticate actual program-owned, rent-exempt accounts and their
immutable payer receipts; a keeper's claimed capacity or a lamport balance alone
cannot authorize a funded root.

The venue authority starts/cancels capacity growth. Anyone may fund and verify its
next required allocation. Incomplete growth admits no additional capacity; an
already completed smaller capacity remains usable. Each proof has a monotone
generation and exact cursor. Cancellation retains allocated accounts and payer
records. A freeze locks the workspace to its resolution epoch, preventing growth,
reuse or refund while that work remains active. Completion must be authenticated
by the financial controller before unlocking; no timeout or admin assertion may
release it. P55A2 must connect these fences to the complete default/recovery path
before membership activation can use the capacity.

This deliberately supersedes D97/D99's **epoch-specific scratch allocation** in the
successor profile. Scratch PDA seeds omit epoch; payloads retain epoch/attempt and
monotone scoped revisions. Reinitialization may discard only completed old-epoch
scratch, never current results or applied financial effects. There is no in-place
conversion of the schema-8 deployment or automatic selection of the new artifact.

Rent uses explicitly signed operator/payer SOL, never collateral, insurance or
trading fees. A payer receipt records the actual top-up; pre-existing donations
cannot block canonical account creation. The receipt creator owns the eventual
allocation-rent refund (including voluntarily donated lamports), not a trader
claim. Refund requires terminal venue authority and proof that no active/frozen
work can reference the allocation. The central workspace lock replaces D93's
proposed per-receipt locked epoch, avoiding a write to every receipt on freeze.
The complete cost, lifecycle and signed acceptance gates remain open; storage
provisioning alone does not expand membership or qualify financial trading.

## D99 — conserving plan ownership before financial application (11 November 2026)

P54C extends D97's local frozen-source bridge with a separate, fully verified
settlement plan. It preserves exact rates, insurance clipping, market attribution,
canonical fractional atom owners and complete membership. D97's verification
entrypoints remain read-only; their completion alone still cannot authorize Apply.
Bounded flow/order/construction/circulation cursors replace native vector schedules.
The program derives graph topology and balances from verified scalar rows and
complete ordered permutations, never from uploaded arcs or alleged final cash.

Market order upload has a separate monotone attempt and per-root seen markers.
It must prove each frozen ordinal once in each market permutation, then exact
positive-claim remainder ordering with stable-ID ties. A bad or stalled order may
be restarted under D98's explicit 64-slot liveness policy without changing the
frozen cohort, verified rates, insurance history or flow floors. Once both orders
are complete, graph construction and all later work are permissionless and
monotone; no proposer timeout can select payouts or undo applied accounts.

Before the first root mutation, adopt the complete audited plan atomically and
move the schema-8 source resolution into reserved **PagedApply stage 14**. The old
resolution's existing stage range excludes it, preventing competing legacy Apply.
The child plan binds the exact adoption revision. Before adoption, advancing the
legacy source invalidates the child; after adoption, resume this plan through
complete application/reconciliation rather than falling back to another solver.
Storage and continuation must be proven usable before adoption can succeed.

Partial Apply owns an explicit remaining-original/applied cash split, remaining
exposure/claims and market movements. Mixed live roots are never added to frozen
aggregate balances again. Clear positions/orders/reservations/delegates exactly
once while preserving monotone IDs/nonces, isolated forbidden slots and funding
checkpoints. Only complete verified application changes settlement/insurance
buckets; retained fees and unspent market insurance remain with their owners.
Reconcile every applied root and the actual vault before terminal completion.

The existing-size bridge may then populate the canonical legacy complete header
and use its unchanged source-recovery/owner-resume rules. This is a fresh local
test deployment, not in-place migration or expanded membership. P55 replaces the
live identity bridge; P56B alone activates a larger cohort. New account/event/SDK
layouts require literal ABI and signed RPC/WS/PostgreSQL acceptance before P54C
can be called complete. The controller now implements this handover and complete
financial lifecycle; [validation](operations/validation.md#conserving-settlement-p54c)
records its ten-root signed acceptance. It does not activate a larger population
or promote the candidate to the ordinary runtime.

## D98 — bounded untrusted rate attempts and recoverable verification (11 November 2026)

P54B stores proposal state separately from frozen valuation and financial balances.
Only the chosen proposer uploads the two canonical numerators; the program owns
all arithmetic schedules and scratch. Complete-rate equations, greatestness,
market loss identities and insurance atom division are recomputed from the entire
frozen cohort. Insurance starts at original reserves, each market may clip once,
and a final integral evaluation is mandatory within three evaluations. Rejection
and retry cannot consume reserves or a successful evaluation.

A monotonically increasing attempt tag reuses the same 25 logical registers and
count-derived page allocation. Registers 0/1 remain the immutable completed common
denominator; 2 belongs to its old scratch; 3/4 are sequential proposal upload;
5–24 are bounded evaluation scratch. Retagging an older scratch page grants no
ability to change a current-attempt word. Normalized metadata excludes dirty tails.
Only scoped history increments page revisions. New append-only kind 22 identifies
SettlementRates; all previous discriminators, layouts, domains and errors remain.

Upload ownership prevents different callers from interleaving numerator chunks.
The proposer can cancel its own incomplete upload; once verification starts,
permissionless helpers progress the same deterministic plan. Anyone can reset a
rejected attempt, or an Upload/Verify attempt after **64 slots without actual
progress**. Upload/row/word operations are finite and no heartbeat endpoint renews
this window. The 64-slot value is an explicit local liveness policy, not a risk or
oracle parameter or a guarantee against transaction censorship. Reset retains
frozen input and successful clipping rounds; verified work cannot reset. No
timeout accepts an answer, transfers funds or selects a creditor subset.

An authenticated mathematical failure commits a Rejected work status, not a
financial success. Invalid accounts, missing pages, wrong epoch/attempt/revision
or malformed upload fail atomically. Financial accounts remain read-only and
Apply is absent from this controller. Signed/resource qualification is required
before P54B acceptance; P54C still owns conserving cash/rounding/application,
P55 live membership, and P56 expanded activation and operational cost gates.

## D97 — verification-only frozen-source bridge (11 November 2026)

P54B initially authenticates the existing schema-8/profile-4 frozen cohort while
writing separate schema-9 verification records. This resolves the phase dependency:
P55 owns the live paged membership lifecycle and P56 owns expanded activation, so
P54B cannot claim a larger live cohort merely by constructing index fixtures.
The bridge binds the real frozen resolution epoch/revision, complete registry hash,
safety/terms/configuration, prices/funding, gross OI and custody/market buckets.
It accepts only the source's Value stage at cursor zero. Advancing the existing
resolution invalidates successor progress; the existing recovery path remains usable.

Program-created index records mirror every registered source root, including flat
roots, in stable ID order. Immutable non-reused schema-8 IDs map to activation
generation 1. This is one mirror per fresh local qualification venue; it is not a
new live membership authority or general migration. P55 replaces the bridge with
its frozen live index and explicit lifecycle. No margin, vault, ledger, fee or
insurance balance is writable through these verification contexts. No new method
permits payout/Apply, trading expansion, devnet or default-profile activation.

Prepared work and row/limb pages use append-only scoped event kinds 17–21 with
schema 9; existing kinds retain schema 8. A bounded limb continuation derives its
exact read/write plan from the program-owned checkpoint and retains that plan for
both scope visits. Supplied page revisions are optimistic replay guards, never
proof of completed arithmetic. The scope advances each declared writer once;
standalone native dirty-page commit is not called by these public handlers.
The literal extension is checked separately before comparing the entire retained
ABI with the immutable D90 baseline. Rate arithmetic uses program-owned normalized
lengths, with explicit virtual-zero tails and bounded output normalization; reuse
of scratch pages cannot turn stale high words into value or missing live words
into zero. Signed and resource acceptance remains a
required P54B gate, alongside rate proposal/reset verification.

## D96 — bounded scratch steps for scalable exact settlement (11 November 2026)

P54A implements the selected P51B G2 arithmetic as operations over caller-owned
logical limb registers. Population determines the required width; no fixed
96-limb array or new small cohort ceiling is introduced. Each cursor step touches
at most three words and contains no width-sized stack/heap value. Addition,
subtraction and division take width steps; multiplication takes width times one
plus its at-most-five factor limbs. Half-word division keeps an exact remainder
below 2^88 inside u128 without a 152-bit intermediate.

The complete native kernel recomputes cohort conservation, original rate equations,
greatestness and at most three insurance evaluations before constructing a compact
canonical rounding graph. Exact normalized atom division replaces a 58-pass search;
hierarchical active arcs and generation marks remove inactive scans and whole-graph
resets. Market permutation/order checks preserve the original deterministic atom
owners. Row attribution stays factored, with separate cash, unpaid impairment,
market insurance and retained fees. The risk contract owns finite work/storage bounds.

This is native execution, not custody or account authentication. Vector-backed
orchestration is excluded from SBF; P54B/P54C must map every operation and graph
step to authenticated epoch/attempt pages and persist progress atomically. A failed
scratch operation is not committable; completed cursors reject replay. Native
cursor copying is not a crash-durability test. Per-row collection reduction and
used-width LCM avoid population-maximum scans for small values, but adversarial
exact denominators still grow with N. Measured native completion does not establish
transaction/rent affordability. Expanded financial activation remains at P56B;
the current 64-member runtime and selected artifacts are unchanged.

P54B adds fixed internal byte checkpoints and exact next-word access descriptors
for the arithmetic, LCM and comparison cursors. Checkpoint format 1 is separate
from account schema 9; zero reserved fields and strict scalar bounds reject malformed
encodings. Only program-owned authenticated work may restore them. Structural
validity is not proof of execution, and no caller-supplied cursor can authorize
payout or skipping work. D97/D98 now bind frozen-cohort authentication and atomic
persistence to the signed verification acceptance recorded in validation.
The subsequent inactive foundation uses 256-word pages with direct validated word
access, a complete-row denominator schedule and constant-space valuation totals.
Its 2,129-byte scratch layout and 320-/288-byte controller checkpoints are recorded
in the current account/risk contracts. Three-word unsigned claim totals preserve
the <2^151 aggregate bound; no u128 population sum or early positive/negative
cancellation replaces it. Native prefix/loader checks do not authenticate frozen
membership or authorize a payout; D97/D98 public handlers supply that authentication
and their own signed acceptance. Full payout/application remains P54C work.
P54B now implements the read side of P51B's reserved financial-index interfaces.
Its 15 radix levels derive from u64 IDs and 64 entries/page; the fixed 544-byte
cursor verifies complete count-conserving traversal in stable ID order. Node/page
loaders authenticate their requested canonical account, while the owning frozen
epoch must separately prohibit mutation and bind each actual margin root. P55
still owns membership mutation/provisioning; no account capacity is enabled here.

## D95 — separate price-policy consolidation from calibration (11 November 2026)

P53A centralizes the existing price policy in financial-core and generates SDK
literals; oracle normalization, stored orders, maker bands, funding, liquidation
and UI use the same unit-labelled definitions. Numeric capacity remains distinct
from economic admission. It deliberately supersedes scattered literal ownership,
not the retained source safeguards, D37's devnet age selection or accepted ranges.

Policy version 1 describes unchanged profile-4 behavior; account schema, epochs,
signed domains and wire layouts do not change. No live configuration instruction
or additional writable account is introduced. Parameter changes require explicit
G5 calibration, a new policy version and fresh deployment/artifact binding, leaving
old orders and originals under their old executor. Live calibration/migration
would need its own authority and epoch contract. See the current risk specification.

Split the approved P53 scope into P53A consolidation and P53B calibrated ranges.
The second remains disabled until literal values, source/order boundary scenarios
and funding-search cost are accepted: lower reference increases sample Q, and the
current per-quantity publisher search is not automatically scalable. P54A can
proceed on the unchanged numeric proof independently of price calibration.

The user explicitly approved G5's numeric-bound local prototype policy on
11 November 2026: reference/trigger 2–909,090, stored limits 1–1,000,000 collateral
atoms per lot, positive checked raw asset sources with complete interval admission.
This supersedes the fixture-derived asset USD and converted-price bands, not the
numeric arithmetic envelope or any confidence, freshness, depeg, margin, fee or
recovery safeguard. Policy version 2 requires a fresh domain and artifact binding;
it is not an in-place migration. P53B brings forward P58A's exact canonical funding
search, retaining the six-token notional, complete coverage, two legs and ties.
Activation remains conditional on signed boundary/lifecycle and reconciliation
acceptance. G5's other economic topics are not approved by this specific decision.


## D94 — bounded covered history and independently reconciled publication (11 November 2026)

P52 implements the authorized remediation roadmap without changing on-chain
schemas or financial rules. Replace the whole-backlog limits and all-or-nothing
catch-up with one complete authenticated block per PostgreSQL commit. A bounded
per-cycle work budget defers further recovery; it does not invalidate old history.
SQL format 3 separates durable coverage from a reconciled published snapshot and
requires a fresh journal, preserving old databases and pending originals.

Account observations must match one genuine complete-block revision vector and
its full financial fields before publication. Capturing later values and replaying
forward from an earlier candidate cannot prove overwritten earlier values; the
initial P52 design proposal's original-prefix publication is deliberately replaced
with a common historical checkpoint. Custody/vault share one read batch. No common
checkpoint means saved coverage with closed readiness, not relaxed reconciliation.
The signed local diagnostic exposed current account values ahead of their
reported finalized context. Retain one captured witness and, only if the reported
interval has no common match, extend once to a processed-slot ceiling observed
after all reads. That ceiling must finalize before complete canonical history is
read; every account field must match one covered finalized state before publishing.
No nonfinalized projection is served. Freshness starts before capturing the target,
never after waiting or lengthy replay. API
history is capped at the published cursor. Pending signed-original recovery keeps
immutable deployment checks independent of financial discovery readiness.

This removes backlog-size cliffs, not every throughput limit. Account batching can
still lack a common fence under continuous writes across multiple RPC batches;
RPC response/transaction resource budgets are explicit and oversized inputs are
retryable after operator sizing. Actual runtime measurements belong in validation;
none imply expanded-account activation, independent review or production capacity.

## D93 — exact account-scale feasibility direction (10 November 2026)

The user accepted D92's roadmap and authorized implementation. P51B explores a
successor with paged immutable identity, a separately authenticated complete
financial index and owner-authorized empty retirement. Empty registration does
not consume a fixed lifetime economic slot. Every admitted obligation remains in
complete two-market default; no additional loss-sharing groups are introduced.

Select exact reduced LCM, compact scalar frozen rows/shared paged arithmetic,
verified remainder ordering and the same canonical conserving DFS with inactive
arc skipping for implementation feasibility. The rate proposer remains untrusted.
Native comparisons preserve the current kernel's exact atom owners, insurance
clipping and greatest solution, including reciprocal cycles and outside creditors.
Dynamic allocation alone failed the larger dense-storage diagnostic; compact
representation avoids storing a full wide numerator per account. It does not
prove production-scale resources or replace the later signed SBF acceptance.

Recommend maintaining ordinary backing contributions inside a conservative
price/funding region, while independently checking current source validity and
whole-account payment health. Financial mutations update scanned contributions
atomically; they cannot preserve a green proof by hiding a new shortfall. No new
mandatory pause, unpaid-profit credit or relaxed oracle rule is authorized.
Actual write contention, full mutation coverage and bounded progress remain gates.

This deliberately proposes to supersede D59's fixed 64-row/96-limb storage schedule
and product-denominator implementation, and D60's lifetime registry representation,
**not their financial priorities**. D63/P42 source-stamp invalidation is replaced
only if P55B proves the maintained-region contract. Component docs label these as
successor candidates; schema 8 and all deployed rules remain normative until the
owning implementation/qualification. Reserve schema 9/profile 5 for a fresh local
domain/journal, with no in-place migration or implicit artifact promotion.

G1 resource targets and G2/G3 recommendations are recorded in
[resolution](clearing/risk-and-resolution.md#scalable-exact-resolution-candidate-p51b),
[accounts](clearing/accounts.md#account-scale-successor-contract-p51b) and
[accounting](clearing/accounting.md#incremental-backing-candidate-p51b).
Any required payout/trust change or compulsory coordination window returns for
explicit approval. P15B/P16B and deferred endurance remain separate.

## D92 — audit remediation sequence and explicit policy gates (10 November 2026)

After P48–P50 integration, the user requested a complete PR-scoped roadmap for the
audit findings, beginning with the 64-account restriction. The
[remediation plan](operations/remediation-plan.md) owns P51A–P62 delivery scopes.
P51A is documentation only; P51B must first establish the operating envelope and
an executable scalable-settlement candidate. Indexer progress and unit-aware price
policy precede larger-cohort qualification. Membership, ordinary profit backing
and complete default are one coordinated architectural workstream.

The objective is to remove inherited small population restrictions while retaining
bounded per-transaction work and complete resolvability of every admitted obligation.
No new loss-sharing groups, trusted payout proposer, weaker financial checks or
silent rounding change is selected. Exact current economics is the first candidate;
infeasibility requires an explicit alternative and approval of material departures.
Later maker, funding, liquidation, margin, lifetime and operations changes have
their own stated acceptance and authority/economic decision gates.

This supersedes only the audit's initial delivery prioritization, not D57/D59/D60/
D64 settlement rules or the existing numeric, maker, risk and funding contracts.
Each implementation names its actual supersessions when justified. Planning does
not activate expanded accounts or choose economic parameters. P15B/P16B and
deferred endurance remain separate, and no funded deployment or outreach is added.

## D91 — quantity bounds and exact scalable allocation (10 November 2026)

The user authorized retiring both inherited 4,608-lot action and 4,096-lot maker
depth ceilings, including the router, program, SDK and application changes needed
to support larger quantities. P48 first replaces per-lot exhaustive allocation
with exact, conservatively pruned interval search while retaining existing on-chain
limits. P49 expands quantities within the existing checked financial numeric
domain and qualifies actual larger financial transitions. The original task called
for open stacked PRs; later merge authorization is recorded below. Funded deployment
is outside both scopes.

This deliberately supersedes D23's inherited quantity envelope and D69–D72's
exhaustive-enumeration implementation requirement, not the best-admissible-route
objective or deterministic ties. Never assume maker health is a monotone prefix.
Search may explicitly report an exhausted computational budget, but cannot return
an unproven best allocation or label unfinished search as absent liquidity.
The proof and resource contract belong to [routing](liquidity/routing.md).

Keep two selected makers, eight curve regions, whole-account risk/reservations,
2 bps/zero provider fees and 25% insurance, independent risk valuation, signed
authority, causal funding and complete default. Order totals, single executions,
maker depth and liquidation quantities are distinct constraints. Retain finite
integer/exposure/cash limits; large quantities never imply guaranteed available
liquidity or automatic depth replenishment. P15B/P16B remain external and
continuous 24-hour endurance stays Deferred.

D91 implementation (10 November 2026): P49 uses the existing `MAX_LOTS =
100,000,000` for maker published depth, immediate/stored action quantity, order
quantity and liquidation quantity. Retain signed position ±100m, aggregate gross
200m, price 1m atoms/lot, cash 10^15 atoms and scaled-value bounds. The stored-order
fee input expands from 1m atoms to the existing cash bound so a large order can
reserve its actual signed fee budget. No fee rate, liquidation fee cap, insurance
share, risk band, account width, discriminator, seed or instruction layout changes.
Operational workers start at remaining exposure and halve in at most 27 probes;
this removes the small fixed starting batch without claiming exhaustive feasibility.

New program bytes require a distinct pinned artifact identity and fresh local
qualification. Existing journal bindings/artifacts remain historical; no in-place
funded migration or implicit acceptance of old binaries with expanded clients.
Source implementation and qualification status are separate in STATUS/validation.

D91 qualification (10 November 2026): clean SBF `49c343e` and verifier `125a2b3`
pass the larger signed financial lifecycle, independent default/fee/funding audits,
188-event PostgreSQL replay and matched full-book resource check. Generated IDLs
remain identical. Promote the new exact artifact identity for fresh local use;
retain C0 files and journal bindings. Acceptance is engineering-local and does not
close external or deferred gates. Subsequent user authorization integrated both
implementation PRs and the P50 audit at `28db412`, including review fix `d63e3b1`;
[STATUS](STATUS.md) and [HISTORY](HISTORY.md) record the exact merge verification.

| Original decision(s) | Current choice and reason | Contract owner |
|---|---|---|
| D01–D05, D56–D60 | Rivalt is common clearing with separate maker programs; BTC/ETH, one mint, portfolios and isolated/cross roots; market-attributed accounting replaces the old common-loss group for the current profile | [Accounts](clearing/accounts.md) |
| D06, D29, D62, D77 | Atomic exact-base one/two-maker routes, persistent partial subfills and existing-position TP/SL; current landed financial checks stay authoritative | [Risk/orders](clearing/risk-and-resolution.md), [routing](liquidity/routing.md) |
| D07, D19, D60 | Funded cash versus exact unpaid/fractional claims; zero positive unpaid margin credit, checked fixed-point arithmetic | [Accounting](clearing/accounting.md) |
| D08, D27, D49 | Independent index-derived adverse risk and separate actual-fill prices; no maker quote as risk oracle | [Risk sources](clearing/risk-and-resolution.md) |
| D11, D58 | 2 bps taker/zero provider; 25% of collected fees to originating-market insurance, 75% retained fees with per-market carry | [Accounting](clearing/accounting.md) |
| D57, D59, D60, D64 | Market-attributed losses, explicit funded flat netting, complete shared-debtor/default clearing, greatest rates and conserving terminal rounding; no keeper-selected subset or cross-market reserve sweep | [Resolution](clearing/risk-and-resolution.md) |
| D60, D63 | Own funded exits are atomic account-local health checks; profit payment has a separate complete selected-market certificate | [Accounting](clearing/accounting.md) |
| D69–D72 | Configurable canonical curves, separate reprice/shape/replenish authority, sealed three-maker set and exact bounded best single/pair | [Quoting](liquidity/quoting.md), [routing](liquidity/routing.md) |
| D73–D76 | Old-interval-first causal funding; published depth without hypothetical maker margin; restricted off-chain publisher with bounded signed on-chain checks | [Funding](liquidity/funding.md) |
| D71, D77 | Measure complete wire, v0 <=1,232 / v1 <=4,096, explicit resources and zero priority price, no required lookup table | [Routing](liquidity/routing.md), [interfaces](application/interfaces.md) |
| D39, D77/R094 | Immutable original-signature recovery, authenticated finalized-expiry nonapplication proofs, unknown fees retained, explicit budget handover | [Durability](application/durability.md) |
| D70/D77/R095 | Anchor argument decoding accepts an unused instruction suffix; maker account/quote response lengths remain exact and replay authority remains explicit | [Quoting](liquidity/quoting.md) |
| D13/D16–D18 | Exact installed/locked stack, isolated legacy Anchor conformance, real Surfpool/RPC/WS/PostgreSQL integration; ready stacked PRs | [Operations](operations/README.md) |
| D35/D37/D42/D44 | Change-scoped bounded engineering qualification, earlier focused devnet checks, deferred 24-hour endurance, separate independent-maker/review/funded gates | [Validation](operations/validation.md) |
| D38 | Raw evidence remains local/ignored at its existing paths; concise claims and bounded fixtures in source, no required bundle/upload | [Operations](operations/README.md) |
| D78 | All seven canonical-liquidity PRs integrated at b80bb38; closes bounded M10, no production/external gate | [Status](STATUS.md), [history](HISTORY.md) |

## D79/D80 — approved repository consolidation and maintenance handoff

On 30 October 2026 the user approved the [inspected consolidation plan](REPOSITORY-CONSOLIDATION.md),
then requested a separate final professional README PR after the other work.
P35–P37 cover component documentation, canonical naming and audited legacy
retirement; P38 owns the root README rewrite. P35 repairs root links only.

P35 supersedes the old mandatory phase-by-phase reading list, duplicated milestone/
phase live tables and append-every-run WORKLOG policy. STATUS owns active handoff;
component contracts own current rules; this file records material choices; HISTORY
links the exact old reports and retirement dispositions. PRs carry actual change/
verification details. Raw local evidence remains untouched. A short human README
and detailed reference pages share one normative contract, not divergent agent prose.

P36 preserves current wire discriminators, field order, metas, PDA seeds, error
numbers, signed domains and numeric schema checks while giving current definitions
clear names. Rebuilds change hashes and require fresh scoped evidence. P37 removes
only dependencies proven obsolete and ports applicable independent cases. Do not
reinterpret old financial bytes, unresolved signed originals or deployed accounts
as renamed current state. Compatibility exceptions need a reason and removal condition.

There is no changed fee, risk, loss ownership, insurance, publisher trust or activation
policy. Earlier keep-every-prototype source rules are superseded only for justified
retirement under this plan. Existing remote deployments stay untouched. P15B/P16B
remain Open and endurance Deferred; no external/funded activity is authorized.

P36 implements this with explicit original discriminator attributes and a small
name-independent wire manifest, not aliases over old current definitions. Shared
records have one definition. At the P36 checkpoint, older colliding runtimes remained
explicitly named and the current adapter still used the group engine. P37 extracts
that live engine and retires its obsolete consumers under D81 below.
Stored journal/API event tags remain versioned schema identities, so a source
rename does not rewrite historical rows or weaken profile checks.

## D81 — current-runtime retirement boundary

P37's inspected [disposition table](REPOSITORY-CONSOLIDATION.md#p37-disposition-and-compatibility-boundary)
implements D79/D80's authorized retirement. The supported fresh local runtime is
the account-centric financial engine with canonical maker liquidity and the
restricted funding publisher. Earlier isolated/common-loss group and fixed-maker
execution profiles, and the disabled on-chain liquidity sampler, leave the current
program/API/app after their live primitives and applicable independent tests move.

Retained wire expectations come from pre-retirement `b89768b`; intentional removed
entrypoints/accounts/events are recorded separately. Current layouts, discriminators,
metas, seeds, errors, replay domains and numeric schema identities remain pinned.
This removes obsolete APIs; it is not a compatible binary upgrade for an old venue.
Default/devnet financial gates remain, and no existing deployment is upgraded.

Current journal tags and original signed bytes retain their exact decoding and
recovery semantics. Historical deployments use their original pinned client and
configuration, recoverable at the pre-consolidation revision. Local databases,
keys and evidence remain in place. No state relabeling, automatic fund migration,
changed loss bearer, fee, risk credit or publisher authority is authorized.

The consolidated active-profile guard also restores the already-authorized venue
pause/unpause path for profile 4; the preceding helper admitted only profile 3.
Venue authority, reconciled custody and safety-epoch invalidation remain required.
Fresh regression coverage must prove foreign-authority rejection, paused trading
rejection and invalidation of pre-pause signed routes before runtime acceptance.

## D82 — authorized contention redesign and pre-migration performance baseline

On 30 October 2026 the user authorized P39–P44 in the
[performance contract](operations/performance.md): complete dependency audit,
account/transaction redesign, targeted CU optimization and fresh full profiling
before considering Anchor v2. This supersedes treating current shared coordination
as a fixed implementation boundary, not the financial safety/economic rules.

P39 records targets and transitions; no runtime layout or wire identity changes
merely because the plan is approved. Financial successor changes use a fresh local
domain with explicit schemas and frozen migration dispositions. Every implementation
updates its owning component contract. Keep exact fees/carry, loss ownership,
funded-cash rights, causal funding, risk/source checks and complete default.
Selected-market fee/exposure ordering remains a measured residual unless a safe
exact replacement is proved; no asynchronous risk or reserve approximation.

Keep concise bounded metric fixtures and reproducible harnesses in source, raw
receipts/traces local and ignored. P44 freezes the pre-v2 comparison revision;
framework migration is separate. Ready PRs are stacked and remain open. P15B/P16B,
deferred endurance and authorization requirements for external/funded work persist.

## D83 — durable service conflict admission before scoped history

On 30 October 2026, P40A implements D82's independent execution with two bounded RPC lanes and durable
signed-message account reservations. Acknowledgements and process death cannot
release an ambiguous original's resource or fee rights. Finalized receipts release
both as applicable; authenticated expired nonexecution releases resources only.
The PostgreSQL admission contract is version 1 and old pending originals must be
drained by their previous executor before enabling it. No financial/on-chain ABI,
fee, custody entitlement or maker authority changes.

P40 is split into A (service transport) and B (scoped on-chain events and journal)
because the latter spans 27 event decoders and all 53 clearing entrypoints. A's
acceptance cannot close B, and P41 depends on B. This is an implementation split
within the authorized sequence, not new product scope. Both PRs remain stacked and
open; current global on-chain coordination persists until its dependent changes.

## D84 — scoped revisions and a fresh journal domain

On 30 October 2026, P40B freezes the D82 successor's exact
[account](clearing/accounts.md#scoped-history-contract-p40b)
and [event/journal](application/durability.md#scoped-history-successor-contract-p40b)
contracts before layout edits. Clearing-owned accounts move to schema 5 with local
revisions and canonical discriminators; old state is not reinterpreted. The existing
bounded profile/quote economics remain. Maker-owned quote accounts retain schema 4.
Fresh local domain/genesis, explicit schema-bound clients and a fresh journal are
required. Historical binaries, databases, signed originals and source remain intact.

This supersedes custody-global event sequencing and its reconciliation fence, not
cash/fee/liability/source/funding authority. Transaction-atomic read/write revision
dependencies and complete finalized block fences replace it. No new globally
writable discovery account is permitted. Pure sequence writers can become readonly;
economic custody/market writers remain until their later accepted redesign.

The terminal retirement scan currently depends on that global sequence. Replace
this incidental dependency with an explicit existing-authority pause window bound
to safety epoch and complete membership, preserving every liability/cash/reserve
check. Permissionless scan calls cannot pause the venue. Ordinary own-cash exits
acquire no new certificate. Audit all allowed paused mutations before acceptance.
The complete resolved-header retirement branch remains separate.

The P40B contract and isolated ordering tests do not activate new accounts/events.
Require rebuilt ABI/SDK/SBF and actual RPC/WS/PostgreSQL acceptance; P40A, P16A and
historical results cannot qualify the changed journal. External gates and deferred
endurance are unchanged.

P40B implementation detail: full account-body payloads retain the predecessor
revision so the borrowed route/liquidation serializers remain byte-identical to
owned IDL payloads without duplicating large account objects. A separate final
footer advances the revision. The explicit ABI delta fixes 20 sequence-only custody
meta reductions and the three zero-payload footer additions; imported financial
types in maker IDLs advance with clearing, while maker-owned layouts stay unchanged.
The successor remains restricted to its explicit local qualification artifact;
[validation](operations/validation.md) records SDK/journal and compiled acceptance.
Default/devnet financial gates remain unchanged.


## D85 — qualify scoped history on Surfpool 1.7.0

On 31 October 2026, the first P40B signed run reached a fill but correctly rejected
its finalized block fence. A minimal independent RPC reproduction and the pinned
1.6.1 source identify a runtime defect: stored blocks use relative synthetic hash
indices, while reconstructed empty blocks use absolute slots. Adjacent finalized
blocks therefore disagree on the previous hash. This is not a Rivalt revision gap.

Use the official checksum-pinned **Surfpool 1.7.0** release for the remaining M12
qualification. Its corrected reconstruction passes the mixed-block RPC probe;
keep strict parent/hash checks and compare the separately requested signature
manifest with each full block body so an omitted transaction cannot disappear
silently. Preserve the 1.6.1 tool and historical evidence. No source-price, financial,
fee, execution-authority or journal-completeness safeguard is relaxed. Framework,
SBF compiler, dependency and database pins otherwise remain unchanged. P39's old
runtime measurements remain historical inputs, not same-runtime performance proof.

Primary source: [1.7.0 block reconstruction](https://github.com/solana-foundation/surfpool/blob/v1.7.0/crates/core/src/surfnet/svm.rs).
The local reproduction is `.local/p40b-block-probe-170/blocks.json`; full P40B
RPC/WS/PostgreSQL acceptance on this runtime is still required.

## D86 — complete relevant-market dependencies

On 31 October 2026, P41 freezes D82's
[relevant-market contract](clearing/accounts.md#relevant-market-contract-p41).
Ordinary actions may omit unrelated market accounts, but clearing derives the
required union from all touched roots, requested effects and applicable certificate
bounds. There is no caller-selected risk universe. Persist every consumed relevant
funding prefix; omitted empty slots retain their existing bytes. Canonical optional
market contexts replace unconditional two-market writes, using schema 6 and fresh
local deployment/journal binding for the changed event shapes.

This deliberately supersedes P40B's mandatory ordinary-action market contexts and
four complete-market payload shapes. It does not change source admission, funding
rates/causality, fees, loss ownership, oracle/publisher trust, account guards or
complete-cohort default. Custody/ledger and certificate liveness work remains P42.
Default/devnet gates and P15B/P16B remain unchanged; no activation or performance
pass follows from this contract. Implement and qualify the full phase before its
ready PR; keep the stack open.

## D87 — isolate token custody from internal financial accounting

On 31 October 2026, P42 freezes the [custody isolation contract](clearing/accounts.md#custody-isolation-contract-p42)
under the user's authorized P39–P44 roadmap. Remove the redundant globally updated
cash sum and two-market liability stamps from Custody; canonical roots and market
ledgers maintain exact local conserving transitions. Each ledger owns its liability
stamp. Actual token gateways retain allocated-vault backing and signed entitlement
checks; complete frozen valuation/retirement independently checks all root cash.
No projection or stale aggregate gains withdrawal authority.

This supersedes P41's broad custody/vault/ledger ordinary-action contexts, not its
whole-account funding/risk union. Pure internal operations omit token custody;
selected-market fee carry/exposure ordering remains. Certificate changes preserve
complete-debtor/observation rules and enable atomic final-page/payment without
mistaking transaction-wide writable promotion for a scan mutation. Measure progress
under ongoing activity and report any coordinated windows honestly.

Schema 7 uses a fresh local domain/genesis/client/journal. Financial rates, funded
cash versus unpaid claims, reserve ownership, strict liquidation progress, complete
market-attributed default and default/devnet gates stay unchanged. P15B/P16B and
deferred endurance remain separate. No activation/resource result follows from the
contract. Scoped rebuilt acceptance now verifies these changes as documented in
[validation](operations/validation.md#custody-isolation-acceptance-p42); P43/P44 own
further optimization/full qualification. Earlier backing pages still need a stable
required-observation window. Keep the ready stack open above #59.

## D88 — distinguish not-yet-finalized blockhashes from expired originals

On 1 November 2026, P44's fresh service fault run exposed a false expiry inference.
The wallet original had not broadcast: its confirmed blockhash was absent from the
finalized bank. A four-sample independent Surfpool RPC probe reproduces this state
at `.local/p44-blockhash-probe/result.json`; retained failed-run database diagnosis
is `.local/p44-service-fault-diagnostic.txt`. No successful recovery is inferred.

Persist a finalized-valid slot for each immutable original before using later
finalized-invalid plus confirmed-invalid as expiry evidence. Reject older finality
contexts; retain ambiguity if the hash was never witnessed finalized-valid. The
existing unchanged-authority proof still controls economic nonexecution, and only
actual receipts release unknown fees. Confirmed-valid originals may transmit their
unchanged bytes. This corrects D83's expiry premise without changing dispatch locks,
on-chain authority or economics. The additive SQL field does not retroactively
validate prior expiry classifications. Fresh restart/expiry acceptance is required.

P44 follow-up: `cbc132b`'s live eight-worker run shows that recording the witness
only after resource admission can miss a hash's entire validity window behind a
shared payer. Sample finalized validity before conflict admission and persist that
observation on a deferral without consuming an RPC-send attempt, releasing locks
or granting financial authority. The retained queue diagnosis is
`.local/p44-services-fenced-diagnostic.txt`; the complete service follow-up passes at `a5afbc9`, as recorded in
[validation](operations/validation.md#frozen-pre-migration-qualification-p44).

Review follow-up on 1 November 2026: successful admission also commits the observed
witness atomically with its access reservation, before the next status RPC. The
previous implementation persisted that branch's witness only with the later
outcome, leaving a crash window. This corrects persistence timing without granting
new expiry authority or releasing unknown fees. Acceptance must kill the actual
executor immediately after admission and restart only after real hash expiry.

That acceptance passes at clean `da99664`: a real SIGKILL preserves witness slot
1522 with zero attempts; restart after expiry proves nonexecution, releases access
and retains the 20,000-lamport unknown-fee reserve. Post-send original recovery and
identical 61-event fresh PostgreSQL replay also pass. The reviewed stack is
integrated at `6b14e8a`; [validation](operations/validation.md) retains the exact
revision, local evidence and scoped omissions.

## D89 — prevent newer conflicting originals from starving a committed waiter

On 1 November 2026, P44's current UI successfully signs a trade, but continuous
maker/publisher updates repeatedly overtake it. Retained PostgreSQL evidence shows
the wallet original still pending with zero send attempts after thirty seconds,
while each operator completes seventeen or more updates. The finalized blockhash
witness exists; this is dispatch starvation, not lost acknowledgement or a source
policy failure. Evidence: `.local/p44-http-schema-queue-diagnostic.txt` and
`p44-services-http-schema/` under the existing local run directory.

Dispatcher version 2 persists complete static access declarations with each signed
original, then orders conflicting new admissions by immutable creation time and
request ID. An older committed pending/unresolved request blocks younger conflicting
admissions even between due-work polls. Already-held reservations still reconcile,
unrelated/read-only-sharing work progresses, and terminal originals cease blocking.
Conflict deferral is 250 ms; send retry policy, exact-byte originals, fee accounting,
expiry proof and durable locks through definitive outcome remain unchanged.

This supersedes D83's opportunistic reservation admission, not on-chain locks or
economic authority. Existing version-1 runs must stop producers/executors and drain
pending/unknown originals with the pinned previous executor before upgrading;
unknown fees remain reserved. No live schema/account migration or risk safeguard
relaxation is authorized. New SQL ordering and actual browser/service/expiry/fault
acceptance are required before claiming this resolves the observed starvation.

D89 acceptance: clean `f4490e9` passes actual SQL ordering, drain gating, duplicate
executors, expiry and exact-original crash recovery; all ten browser actions
finalize. Clean `a5afbc9` completes the full service lifecycle with separate role
payers, three real SIGKILL recoveries and identical 137-event fresh PG replay.
Its additional bounded parallel block retrieval preserves canonical order and all
reconciliation checks. The current offered-load probe still records 33 revision-
ahead retries versus two coherent live cycles; no sustained availability or
validator throughput claim follows from these correctness/recovery passes.

## D90 — plan a pinned Anchor RC2 migration against frozen B

On 1 November 2026 the user requests architecture/documentation research and a
detailed plan using Anchor **2.0.0-rc.2**, with implementation in the next PR and
post-migration measurements afterward. P45 owns the
[migration plan](operations/anchor-v2-migration.md); P46 port and P47 qualification
are proposed dependent phases. This decision records planning authorization,
not acceptance of migrated code or a new deployment.

Published RC2 source lacks the current executable eight-byte custom discriminator
override. All 61 Rivalt public instructions, plus maker-owned accounts/events,
therefore require an explicit compatibility choice. Recommend stock RC2 in a fresh
bounded local domain: canonical eight-byte hashes, clearing schema 8/maker account
schema 5, explicit client/journal binding, unchanged financial rules, field encoding,
PDA seeds, privileges and protocol errors. This is a proposed supersession of the
retained instruction/maker identifiers and schema selection, not an incidental
rename or permission to migrate old funds/accounts in place. Keep the existing
implementation normative until the plan is accepted and P46 records its exact delta.

Start with serialized accounts to capture a correct C0 port; isolate any justified
small zero-copy conversions and their C0/C1 measurements. Preserve bounded cohort
decoding, heap-backed wide arithmetic, authenticated events, CPI authority and
post-CPI freshness. Retain guardrails and default/devnet gates. Keep B immutable,
separate candidate artifacts and compiler/runtime effects, and qualify actual
RPC/WS/PostgreSQL financial/service flows before promoting new local artifacts.
P15B/P16B remain external and continuous 24-hour endurance remains Deferred.


D90 implementation authorization (1 November 2026): the user accepted the plan and
instructed continuation. P46 now deliberately supersedes the retained instruction
and maker discriminators and schema selection only for the fresh bounded candidate:
canonical eight-byte identifiers, clearing/journal binding 8, maker account schema 5,
quote/report protocol versions unchanged. Existing account field order, seeds,
privileges and protocol error numbers are preserved by the explicit ABI comparison.
The serialized port, foreign-loader adapter, state-only dependency feature and IDL
metadata normalization are detailed in the migration contract. This records authority
to implement P46/P47, not financial acceptance or artifact promotion; P47 still owns
complete fresh qualification and matched B/C measurements. Both implementation PRs
remain open until separately authorized to merge.

D90 qualification (1 November 2026): P47 passes its fresh serialized-C0 local matrix
and selects the exact admitted artifacts under `.local/anchor-rc2/current` for
normal local use. Immutable B and C0 remain retained; no zero-copy C1 or changed
economics is introduced. Actual field-level comparison, observed CU/size/fee/load
limits and distinct verifier pins are in validation/performance. Demo workers use
separate restricted maker/publisher fee payers and wait for a finalized provisioning
fence; the full demo uses the supported four-second publisher cadence and one-
second synthetic feed delay. Separate service/load measurements retain two-second
publication. Journal readonly comparison ignores only object-key order. Risk/source checks,
default/devnet activation gates and external/deferred gates are unchanged. This
records local qualification, not stack integration, independent review or funded
deployment authority.


## D103 — Bounded native descriptors and durable paged default services

12 November 2026. P56A1 packages a production native page-descriptor helper using
the same checked public checkpoint parsers as clearing. The service passes only
three fixed-size authenticated RPC headers and an operation/optional ordinal,
with a 32 KiB input ceiling, five-second process timeout and at most three canonical
page descriptors returned. It invokes a fixed local binary verified against its
build manifest; no shell command, test executable or Python financial oracle enters
the production path. The helper supplies account metas, never signed authority,
rates, graph edges or final balances. Clearing independently derives the required
pages and verifies all arithmetic, membership and revision guards.

This avoids a second hand-maintained decoder for nested arithmetic/graph cursors.
Exact rate and complete-order proposals remain untrusted TypeScript calculations;
independent financial expected values remain in tests. The controller reads bounded
workspaces/pages, resumes actual committed stage/cursors, and uses the existing
immutable-original queue. Unknown originals retain reservations and block new wire.
Foreign incomplete proposals respect the existing 64-slot recovery rules; no new
expiry proof or liveness timeout awards money. Frozen continuation does not require
fresh live prices after valuation, but recovery retains the existing source hold.

API/budget version 4 is explicitly distinct from on-chain schema 10/profile 6.
Only the fixed candidate artifact binding opts into this controller; the selected
runtime is unchanged until P56B qualification. P56A2 owns full wallet/discovery
acceptance. No economics, on-chain ABI, larger-population admission or deployment
promotion changes here. Acceptance is established only when STATUS/validation record
actual signed default, upload/Apply crash recovery and exact PostgreSQL replay.
