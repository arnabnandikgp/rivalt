# Working on Rivalt

Rivalt is common clearing with competing margined maker programs. The current
bounded local implementation supports BTC/ETH, one collateral mint and isolated/
cross accounts. Start with the current contracts, not historical phase proposals.

## Orient and choose the relevant contract

1. Read [README](README.md), [the documentation map](docs/README.md) and [STATUS](docs/STATUS.md).
2. Inspect Git state and existing code; preserve unrelated user work and secrets.
3. Read the component overview and exact reference for the area being changed:

| Code / task | Required references |
|---|---|
| `programs/clearing`, `crates/financial-core`, account/risk SDK | [Clearing](docs/clearing/README.md), [accounts](docs/clearing/accounts.md), [accounting](docs/clearing/accounting.md), [risk/default](docs/clearing/risk-and-resolution.md) |
| Maker programs, `crates/maker-interface`, pricing/router/publisher | [Liquidity](docs/liquidity/README.md), [quoting](docs/liquidity/quoting.md), [routing](docs/liquidity/routing.md), [funding](docs/liquidity/funding.md) |
| SDK/API, services, indexer, maker kit, trader UI | [Application](docs/application/README.md), [interfaces](docs/application/interfaces.md), [durability](docs/application/durability.md) |
| Build/test/runtime/config/deployment | [Operations](docs/operations/README.md), [local setup](docs/operations/local-development.md), [deployment](docs/operations/deployment.md), [validation](docs/operations/validation.md) |

Cross-component changes read each affected contract. Financial/authority changes
always read clearing, even when the edit is in a client or worker. Use [DECISIONS](docs/DECISIONS.md)
for rationale and [HISTORY](docs/HISTORY.md) for targeted provenance. Do not read
all old phases or fetch research archives as routine preparation.

Later explicit user instructions take precedence. Resolve a material contradiction
between current specifications and implementation explicitly; never choose a
convenient historical rule or silently change economics. Describe existing code,
intended changes and actual verified results separately.

## Protected boundaries

- One collateral mint, BTC/ETH, isolated maker capital; no implicit sibling backing,
  positive unpaid-profit margin credit, correlation discounts or live mode conversion.
- Funded cash and unpaid/fractional claims stay separate. Preserve whole-account
  funding, reservations and held-window checks for transfers/withdrawals.
- 2 bps aggregate taker/zero provider fee; 25% of collected fees to the originating
  market's insurance with exact carry. No token, tiers or automatic rebates.
- At most two distinct maker capitals per atomic route; actual execution retains
  full financial admission, signed user limits and exact authority/epoch checks.
- Maker CPI gets only its bounded approved dependencies, never the vault signer or
  arbitrary writable clearing accounts. Updater authority only reprices.
- Independent index-derived risk. Funding uses restricted attested published depth;
  no hypothetical maker-margin admission there and no claim of guaranteed liquidity.
- Existing-position reduce-only TP/SL; complete-cohort market-attributed default,
  consenting funded liquidation receiver and strict progress after fees.
- Preserve numeric schema/domain/replay checks and explicit default/devnet gates.
  Unsupported/unfinished paths reject; no success-returning financial stubs.

## Make changes reviewable

Use checked integer/fixed-point arithmetic and decimal-string JSON. Do not infer
wire compatibility from a type rename: discriminators, layouts, PDA seeds, account
metas, error numbers and signed domains need explicit verification. Generate IDL/SDK
outputs from source; keep legacy Anchor conformance dependencies isolated.

Update the affected current spec in the same PR when behavior, interfaces, commands
or supported limits change. Add a dated decision for a material authority/economic/
architectural choice, preserving its previous rationale through Git provenance.
Keep one normative document per topic; do not add a phase document for each task.

Use one cohesive ready PR per approved deliverable. Use `gh stack` for dependent
branches and `gh stack submit --auto --open`; never draft PRs. A verified exact
parent in Review is a development dependency; do not wait for its merge to continue
routine authorized work. Keep dependent PRs open until instructed to merge.
If publication is unavailable, leave reviewable local commits and record it honestly.
The completed [consolidation plan](docs/REPOSITORY-CONSOLIDATION.md) records the
retirement boundaries; [STATUS](docs/STATUS.md) owns any newly authorized work.

## Verify and hand off

Choose checks using [validation](docs/operations/validation.md). Run affected tests
and acceptance requirements, not every inherited suite before every PR. Broad
regression belongs in appropriate CI; never claim unobserved CI results. Financial
expected vectors must be independently derived, not the implementation called twice.
Use actual signed deployed programs, Surfpool RPC/WS and PostgreSQL for integration.
Fixtures may provision state, never fabricate successful financial effects.

Keep raw logs/transactions/evidence at existing ignored local paths. Track only
concise validation claims and bounded regression fixtures. No required archive,
upload or per-run evidence document. Runtime configuration is explicit, never an
acceptance dump. Do not delete active DBs, keys, evidence or user research for space.

Before ending substantive work, commit the coherent change and update STATUS with
current progress, tested revision, actual results/omissions, blockers and one exact
next action. Put detailed checks in the PR. Update validation when its claims
change and HISTORY for meaningful integration; do not append a permanent run diary.
Review means accepted work awaiting integration; Closed requires acceptance plus
integration. Never invent a test, deployment, soak, PR, merge or external review.

P15B/P16B remain independent external gates; 24-hour endurance remains Deferred.
Production/funded deployment, paid services, outreach/recruitment and external
hedging require separate authorization. Do not create scheduled automation merely
because a plan mentions recurring qualification. Continue routine authorized work;
escalate genuine access/credential/participant blockers or material economic changes.
