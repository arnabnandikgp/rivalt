# Current design decisions

These are current choices and their rationale. Component specifications own exact
rules. Historical D-numbers remain stable references; the complete supersession
chain and original acceptance claims are preserved in [HISTORY](HISTORY.md).
A source rename or documentation cleanup changes neither economics nor authority.

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
records have one definition. Older colliding runtimes remain explicitly named until
P37 audits their live consumers; the current adapter still uses the group engine.
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
