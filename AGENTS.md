# Rivalt implementation instructions

## Read and orient

1. Read README.md and docs/WORKLOG.md at the start of every session.
2. Read docs/01-PRODUCT.md, docs/DECISIONS.md and the current phase in docs/05-DELIVERY-PLAN.md.
3. Read docs/02-PROTOCOL.md before any economic/account/order/risk change; docs/03-COMPONENTS.md for interfaces; docs/04-STACK-AND-VALIDATION.md for stack and verification.
4. Inspect the repository and existing work before editing. The supplied kit is documentation, not proof that its described code exists.

Later explicit user instructions take precedence. The documents divide authority by topic; they should agree. If a genuine contradiction changes economics or authority, record and resolve it rather than selecting a convenient sentence. Historical research does not override this baseline. SOURCE-AUDIT is provenance, not a requirement to fetch its links.

## Preserve the selected design

- New common-clearing perp venue; not Cinder and not external-venue routing.
- One BTC market, classic SPL six-decimal test collateral, isolated accounts.
- Three first-party programs: clearing, maker A and maker B. Route execution is inside clearing.
- Off-chain allocation, at most two distinct makers, all-or-nothing submitted route.
- Funded cash is distinct from unpaid P&L; zero positive unpaid-P&L margin credit.
- 2 bps taker fee, 0 bps provider-side maker fee, no quote/cancel protocol tariff, token, airdrop, volume tiers or automatic rebates.
- Existing-position reduce-only TP/SL; no entry-linked brackets, trailing stops or general IOC in MVP.
- Independent index-derived risk valuation; actual-fill candles; authenticated common funding.
- Complete-cohort exceptional resolution. No keeper-selected haircut.
- Participant PDAs, durable on-chain order authority and explicit shared market coordination.
- Never give maker CPI the vault signer or arbitrary writable clearing accounts.

## Work phase by phase

Use P01–P16 as the delivery units. Each normally produces one cohesive PR or equivalent reviewable local branch/commit set, with its own runnable acceptance evidence. A phase may span several runs. Do not split it into dozens of task PRs or combine several phases into an unreviewable change. If implementation evidence requires splitting a phase, preserve its original ID, add a justified suffix and update plan/worklog.

Proceed through authorized routine implementation without asking to start each run. Finish and verify each deliverable before moving on, then continue its dependent phase without waiting for the previous PR to merge. A verified predecessor in Review satisfies the implementation dependency when its exact commits are included in the new branch. Use `gh stack` to manage these branches and their parent/base relationships. Submit ready-to-review PRs with `gh stack submit --auto --open`; never create draft PRs. If remote access is unavailable, leave reviewable local commits and mark publication pending. Keep unmerged phases in Review, not Closed; do not claim a PR exists or is merged when it does not.

Production/funded deployments, paid services, outreach, recruiting and external hedging require their own authorization. Request a devnet RPC credential through secure configuration only when P13 needs it. An independent review or user pilot is an external gate, not something to fabricate.

## Implementation discipline

- Establish exact lockfiles and verify actual installed package versions in P01; do not assume Anchor's TS client uses the modern web3.js transport.
- Keep legacy conformance dependencies isolated. No workspace override that makes them appear compatible.
- Use integer/fixed-point checked arithmetic; explicit units and decimal strings in JSON. No floating-point settlement.
- Write an independent economic reference/expected vectors; tests cannot merely call the implementation twice.
- Source restoration is optional targeted reuse. Do not download all research or block P01 on missing archives. Never claim old test counts validate new code.
- Use real deployed local programs, PostgreSQL and standard RPC/WS for service E2E. Fixtures may provision the environment, not fabricate successful deposits/fills/settlements.
- Critical events, database checkpoints, failed transaction logs and ambiguous retries must follow the indexing contract.
- Keep unfinished financial instructions disabled; no success-returning stubs. Early phases operate only within their implemented test profile.
- Do not replace the user's container setup or install Docker Desktop as an assumption. A reproducible native/Apple Containers path is acceptable; verify its actual capabilities.
- Secrets and production credentials stay out of source, logs and evidence.


- Keep raw run evidence at its existing local paths, untracked and ignored. Track concise Markdown summaries and bounded regression fixtures; no archive or upload is required. Runtime launchers must use explicit deployment configuration, not retained acceptance dumps.

## Required run closeout

Before ending every substantive run:
1. Update milestone and phase status in docs/WORKLOG.md.
2. Append a run entry: phase, delivered changes, actual commands/checks, outcomes, evidence paths/commit/PR, blockers and exact next action.
3. Update current specs/DECISIONS in the same change when behavior changes. Append supersession records; do not silently erase rationale.
4. Record tests not run and why. Mark Closed only after the phase acceptance criteria are met on recorded code and the changes are integrated into the intended baseline. A PR awaiting integration is Review.
5. Commit the coherent change when operating in a Git repository. Never invent hashes, benchmark results or review approvals.

A milestone closes only when all its phases close and its cross-phase exit check passes. Documentation preparation does not close P01. Do not create a scheduled automation merely because the plan includes soak tests or recurring CI.

