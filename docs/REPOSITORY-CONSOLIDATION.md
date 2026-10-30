# Repository consolidation plan

Planning baseline: `1f1a5aac4c47844517c1cc190e2bdcd578bc346b` (30 October 2026).
The user requests one readable current implementation, component documentation,
and a maintenance-oriented agent handoff. The user approved execution after this planning checkpoint. P35 consolidates the
docs/handoff; source renaming and retirement remain P36/P37. A separate final P38
PR rewrites the root README at the user’s subsequent request.

## What the inventory establishes

- `docs/` has 110 tracked files / 19,778 lines; 52 files / 3,853 lines are evidence
  summaries. WORKLOG alone has 5,587 lines, DECISIONS 1,526. These are source
  readability problems; their combined 1.88 MB is not the cause of disk exhaustion.
- The current financial accounts are schema 3, with profile-4 maker/funding
  machinery. This is one current system assembled across historical names, not
  two interchangeable complete implementations.
- `state/v3/accounts.rs` still uses `PositionV2`, `OrderBookV2` and the bounded
  cohort decoder. Those are live dependencies, not safe deletion candidates.
- `MakerRegistrationV3` and `MakerRegistrationV4` have different fields and
  behavior. Earlier standalone `Market` and successor `MarketV3` also coexist.
  Stripping suffixes globally would create collisions and can select wrong types.
- A declaration scan finds 157 version-suffixed Rust declarations in clearing,
  eight in maker-interface, eight in the shared canonical maker source, four
  handwritten SDK declarations, and 1,468 generated declarations. Counts are
  declarations, not distinct account types; generated names must come from IDLs.
- Cargo features, entrypoints, SDK barrels, test wrappers, database projections
  and the earlier interactive demo still reference earlier implementations.
  The obsolete on-chain liquidity sampler also retains an explicitly disabled
  instruction. Dependency and deployment inventory must precede removal.

## Intended code structure and naming

Make the account-centric engine plus canonical maker liquidity the current path.
Use domain modules and a single authoritative definition for each current concept.
Do not merely add suffix-free aliases over all the old definitions.

| Current symbol | Intended current name / owner |
|---|---|
| `VenueV3`, `CustodyV3`, `SafetyV3` | `Venue`, `Custody`, `VenueSafety` in clearing state |
| `PortfolioV3`, `MarginAccountV3` | `Portfolio`, `MarginAccount` in clearing state |
| `MarketV3`, `MarketLedgerV3` | `Market`, `MarketLedger` in clearing state |
| Live `PositionV2`, `StoredOrderV2`, `ProtectionV2`, `OrderBookV2` | Shared `Position`, `StoredOrder`, `Protection`, `OrderBook` records |
| `MakerRegistrationV4`, `LiquidityRegistryV4` | `MakerRegistration`, `LiquidityRegistry` in clearing state |
| `FundingPublisherV4`, `FundingReportV4` | `FundingPublisher`, `FundingReport` |
| `MakerCurveV4`, `MakerPriceV4` | `MakerCurve`, `MakerPrice` in maker state |
| `ShapeV4`, `RegionV4`, `QuoteRequestV4`, `QuoteResponseV4` | `LiquidityShape`, `PriceRegion`, `MakerQuoteRequest`, `MakerQuoteResponse` |

Use action names for events, e.g. `MakerPriceUpdated`, so an event and an account
do not acquire ambiguous names. Contexts, handlers, SDK functions and PDA helpers
follow the same vocabulary. Instruction handlers/contexts stay under
`instructions/`; accounts/records under `state/`; constants/errors remain explicit.
Historical profile directories do not become the permanent public architecture.

Version *identifiers* remain where they protect decoding and replay: numeric schema
and report versions, network transaction versions, signed domains, database
migrations, and versioned HTTP contracts. A type called `MarginAccount` can still
contain `schema_version: 3`. API `/v4` is an explicit protocol boundary, not a Rust
type naming defect. Do not replace version checks with permissive decoding.

### Preserve the current wire contract during renaming

Anchor normally derives account/instruction/event discriminators from names. Its
installed 1.2.1 macros support explicit discriminator overrides; this was verified
in the local account/program/event macro sources and the
[Anchor reference](https://www.anchor-lang.com/docs/references/account-constraints).
Support in the macro is preparation, not proof that our refactor preserves bytes.

Before edits, capture a bounded compatibility manifest from the pinned current
IDLs and independently computed discriminators. Freeze current discriminator bytes,
field order, enum tags, sizes, account-meta order/privileges, error numbers, PDA
seeds, instruction payloads and signed hashing domains. Rename the source symbols
while explicitly retaining their original discriminators. Keep seed literals such
as `margin-v3` in a small wire-compatibility definition; changing a seed would
change addresses, so it is outside a cosmetic refactor. Check generator support
and independent legacy Anchor parity; never hand-edit generated files.

The source/IDL names and SDK imports will change, and consumers must be updated
together. Binary hashes will also change: new builds must be measured, their
explicit local artifact approvals updated, and their runtime evidence recorded.
Preserved bytes do not mean identical binaries or qualification of an upgrade.
No deployed program upgrade, account reset, fund movement or database truncation
is part of this cleanup. If preserving a contract requires a different approach,
record the concrete incompatibility before changing it.

### Retire earlier implementations deliberately

Inventory each old family as current, shared primitive, compatibility consumer or
retired. Trace instruction dispatch, feature builds, crate imports, IDL generation,
SDK/services/UI, SQL history, queues, tests, scripts and deployment manifests.
Extract the shared records first; move genuinely obsolete runtimes and their
historical reproduction instructions out of the active tree, recoverable at the
immutable baseline commit. Keep current financial/security regression cases by
porting their independent expected values; deleting an old harness must not erase
coverage for an invariant that still applies.

Old live deployments and unresolved signed originals are not vestiges. Where an
actual consumer needs old decoding, retain a narrow, named compatibility boundary
with a reason and removal condition. Do not merge incompatible account layouts,
reinterpret database rows, rewrite stored signed bytes, or present source removal
as migration of an old deployment. Existing remote deployments remain untouched.
Whether remaining consumers permit complete retirement is an inventory result,
not something inferred from a `V2` suffix.

### P37 disposition and compatibility boundary

The audit at `b89768b` separates these families. This table defines the removal
scope; STATUS, rather than this inventory, records which changes are implemented.

| Family | Disposition / replacement | Coverage or compatibility obligation |
|---|---|---|
| Current financial accounts and canonical maker/publisher accounts | Keep their exact current wire layouts, seeds and numeric identities | Freeze the retained interface from the pre-retirement IDL; compare rebuilt output, never recapture changed layouts as expectations |
| Root/book/route/source/funding/liquidation candidates inside group modules | Move to the shared engine; use current account records directly | Port applicable independent expected cases; preserve whole-account dependencies, fractions, authority and post-fee progress |
| V1 isolated and V2 common-loss group entrypoints, contexts and account families | Retire from the current program/client/runtime | Existing deployments are untouched; historical clients and reproduction remain at the immutable pre-consolidation baseline |
| Profile-3 fixed-maker execution and maker configurations | Retire; canonical maker configuration and execution are the supported local path | Keep shared account/cash/order/default machinery and its journal tags; do not reinterpret fixed-maker bytes as canonical maker state |
| Disabled on-chain liquidity sampler | Retire its instruction/context and unused sampling implementation | Restricted publisher authorization, source bounds and causal accounting remain; retain applicable financial admission regressions for actual execution |
| Current `Account*` and liquidity/funding journal events | Keep required historical tags and exact decoders | Fresh replay/recovery must reproduce original current-profile bytes, including saved signed originals and unknown-fee reservations |
| Earlier group/indexer/UI/demo/build harnesses | Retire obsolete launch paths after extracting live helpers; launch one current profile | Port still-applicable independent checks; current signed RPC/WS/PostgreSQL/browser and full-book qualification must pass |
| Old devnet deployments, databases, signed transactions, keys and raw evidence | Preserve in place; no migration, upgrade, rewrite or deletion | Use the old deployment's exact historical client/configuration for old accounts or unresolved originals, not the new local profile |

The planned retained public program interface contains 53 clearing instructions,
17 clearing accounts and 27 clearing events; each maker retains four instructions,
two accounts and two events. These are dependency-derived targets, not acceptance
results. Their expanded ABI hashes were derived from `b89768b` before retirement.
The small wire fixture must record deliberate removals and its previous baseline;
an old account discriminator or an unsupported profile must still reject.

The retained maker IDL includes 21 types: its own quote/control records plus ten
current clearing account types required by its contexts. The retained clearing IDL
has 72 types. The fixture also lists retired APIs and byte-string domain literals.

Current coverage replaces retired harnesses by invariant:

| Retired checks | Current independent/implementation coverage |
|---|---|
| V1/V2 custody and scalar account clients | Actual current custody RPC plus independent raw-byte/token-conservation audit; direct portfolio/subaccount SDK identity negatives |
| Group route, book, funding and liquidation candidates | Applicable literal cases ported to `engine/tests`; current native whole-account and maker admission cases |
| Unfunded common-group netting/global exit stamp | Current funded netting, market backing certificates, own-cash exits and exact fractional/default cases |
| Fixed-maker routing and on-chain impact sampler | Canonical pricing reference, exact allocator, execution/full-book RPC; restricted publisher input/report checks |
| Old event streams, databases and signed retries | Current journal tags, immutable originals and unknown-fee reserves; actual fresh PostgreSQL rebuild/recovery |
| Earlier wallet/demo and operator bot | Current canonical wallet envelope and demo; restricted updater/publisher kit, per-market economics and browser signing |
| Retired activation/profile gates | Default and devnet reject current financial activation; old instruction discriminators reject; current profile identity and complete-storage acceptance |

Six obsolete V2-only tests are intentionally not ported: two release-gate cases,
the old PDA-dependency helper, unfunded group netting, global-certificate activation
and global-certificate invalidation. Their current replacements are listed above;
no old test count is claimed as current evidence. Historical auditors and launchers
are reproducible only with their original code/configuration. Pure financial
references and current report readers remain in the active tree.

Historical reproduction uses `1f1a5aac4c47844517c1cc190e2bdcd578bc346b` and its exact
recorded artifact/configuration pins. There is no maintained second trading runtime
in the current app. Current journal compatibility remains because it has a live
consumer; removed legacy runtimes do not receive automatic schema conversion.
Old user funds and unresolved originals are resolved in their original deployment
context. Removing local source does not discharge their obligations.

## Documentation organized around responsibilities

Target roughly twenty maintained documents, not another directory per phase.
Each component README is a short human overview; the referenced specifications
hold exact details needed by either humans or agents. There is only one normative
contract per topic, not separate potentially conflicting agent-only prose.

```text
docs/
  README.md                     Reading map, current product and system diagram
  STATUS.md                     Current baseline, active work, limits/external gates
  DECISIONS.md                  Current material choices, rationale and old IDs
  HISTORY.md                    Compact milestones and immutable provenance links
  clearing/
    README.md                   Accounts, custody and financial lifecycle overview
    accounts.md                 Ownership, layouts, authority and compatibility
    accounting.md               Units, cash/claims, funding application and exits
    risk-and-resolution.md      Reservations, liquidation, default and recovery
  liquidity/
    README.md                   Maker/clearing/router responsibilities
    quoting.md                  Curves, depth, controls, admission and quote ABI
    routing.md                  Snapshots, allocation, atomic execution and limits
    funding.md                  Publisher, impact calculation, trust and coverage
  application/
    README.md                   Wallet → API/services → chain → indexer flow
    interfaces.md               SDK/API/UI contracts, signing and direct recovery
    durability.md               Journal, indexing, retries, budgets and reconciliation
  operations/
    README.md                   Supported tools, profiles and runnable entrypoints
    local-development.md        Setup, demo, tests, storage and shutdown
    deployment.md               Artifact identities, keys, activation and recovery
    validation.md               Scoped check map, verified pins and measured limits
```

P38 makes the root README a short professional product/repository entrypoint.
P35 repairs its links and reading directions only.
Program/package READMEs remain useful code maps, linking to their owning contract.
The consolidation plan itself is temporary active work; fold its lasting rules
into these documents when it completes.

### What moves where, and what leaves the active tree

| Existing material | Consolidated owner |
|---|---|
| Product/components plus current implementation and source maps | Root/docs README and component overviews |
| P22B executable financial contract, P23–P26, live oracle/order primitives | Clearing accounts/accounting/risk contracts |
| P29B, P30–P32 execution/routing and publisher contract, D74–D77 | Liquidity quoting/routing/funding |
| P27, P33, SDK, indexer, durable executor and UI recovery | Application interfaces/durability |
| Exact stack, local launchers, maker kit, demo, P34 operations | Operations guides; maker permissions link to liquidity |
| Current acceptance pins and unresolved limits from P26–P34/R094/R095 | Operations validation; historical applicability explicit |
| Historical phase plans, superseded designs, intermediate failed attempts | Git at the immutable baseline; concise HISTORY pointers |
| All 52 evidence summaries and cumulative WORKLOG/old decision chronology | Extract still-relevant facts, then remove old files from current tree |

Do not create a tracked `archive/` that simply relocates the same clutter. Do not
create/upload bundles or relocate/delete ignored raw evidence. Before removing
each old document, map every still-binding invariant, authority rule, layout,
numeric bound, risk assumption, known limitation and reproducible command to its
new owner; record deliberate supersessions separately. A concise overview is not
permission to omit exact rounding or default arithmetic.

HISTORY records the baseline full hash and links to original documents/PRs at that
commit, so an old claim remains inspectable even after paths disappear from HEAD.
For example, `git show 1f1a5aac4c47844517c1cc190e2bdcd578bc346b:docs/evidence/P34.md`
recovers the original report. Keep actual tested pins distinct from subsequent
documentation/refactor commits. Historical passes never qualify changed code.
DECISIONS keeps current rationale and stable D-number provenance without copying
every superseded paragraph; use the historical link for the complete chain.

## Maintenance-oriented AGENTS.md

Aim for about 100 lines. Replace the completed-phase campaign with:

1. Read root README, docs reading map and current STATUS; inspect Git state.
2. Select component docs from a code-path-to-document table. Financial changes
   also read the exact clearing contract; quote/publisher changes read liquidity;
   consumer changes read application; deployment/test changes read operations.
3. State a compact set of protected invariants and link to their detailed owner.
4. Preserve unrelated work/secrets, explicit deployment gates and independent
   expected financial checks. Keep actual RPC/WS/PostgreSQL for integration.
5. Update the affected current spec in the same PR when behavior/interfaces change.
   Add a decision only for a material design/authority/economic choice.
6. Run affected checks, record tested commit/results/omissions in the PR, and keep
   raw evidence ignored at its existing location. CI owns appropriate broad checks.
7. Maintain concise STATUS for active handoff; update validation only when its
   claims change and HISTORY for meaningful integrations. Do not append every run
   or reproduce all checks in two tables forever.
8. Keep ready PRs, stacked dependencies when needed, and existing external-action
   authorization boundaries. No phase advance, deployment or automated schedule
   follows merely from reading the repository.

Current rules stay in force until the documentation/handoff PR replaces them
together. The new guide must describe present BTC/ETH, one-mint, isolated/cross,
market-attributed claims and canonical maker behavior directly, without requiring
an agent to reconstruct the old one-market scope through a chain of amendments.

## Practical PR sequence

Use P35–P38 only as work tracking IDs; lasting docs use component names. Each PR
must compile/run on its own, include required consumer changes, and stay reviewable.

| PR | Cohesive deliverable | Required verification |
|---|---|---|
| P35 — documentation and handoff | This inventory/plan, source-to-doc mapping, consolidated current guides, concise status/history/decisions, new AGENTS; remove superseded phase/evidence prose after mapping | Every original tracked doc has a destination/history disposition; current invariants/limits mapped; relative links/anchors and code paths valid; referenced commands exist; no executable changes or runtime reruns |
| P36 — canonical names and ABI | Extract shared primitives; rename current Rust accounts/records/contexts/events/entrypoints and generated clients, update affected consumers; temporarily isolate colliding old implementations | Pinned old/new wire manifest equality for current paths; raw encoding/decoding/PDA negatives; IDL/generated and isolated legacy Anchor parity; affected builds/typechecks; fresh compiled route/publisher probes and resource checks |
| P37 — legacy retirement and consolidated runtime | Remove consumers/build paths/harnesses proven obsolete; make launchers, SDK exports and current app use one implementation; preserve required history decoding and port invariant coverage | Fresh current-profile custody/trading/orders/TP-SL/funding/exits and liquidation/default checks, independent financial cases, actual RPC/WS/PostgreSQL rebuild/recovery, targeted browser signing and full-book resource limits on rebuilt artifacts |
| P38 — professional README | Concise project purpose, architecture, truthful implementation status and validated quick start after the preceding work | Link/command/status checks; no unrelated runtime reruns |

Generated changes are reviewed separately from handwritten changes, but land with
the source that generates them. If the dependency audit requires dividing a large
code PR, split by an independently compiling component with a justified suffix,
not by arbitrary file count. Do not run retired-profile matrices before every PR.
Reuse current harnesses and test only affected requirements; this is no new load
campaign or 24-hour qualification. Do not promise unchanged CU after rebuilding.

Done means one clear current API/type vocabulary, no unexplained current dependency
on a historical namespace, one authority per documentation topic, a short agent
reading path, preserved compatibility/economics and fresh evidence for changed code.
P15B/P16B remain Open; 24-hour endurance remains Deferred. No new market, fee,
insurance, risk, publisher trust, paid service or funded deployment is introduced.

Check actual disk headroom before builds and integrations. Do not delete user
research, keys, evidence or active databases to make a run fit.
