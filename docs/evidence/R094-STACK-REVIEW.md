# R094 — open maker-liquidity stack review

Scope: ready PRs #42/#43/#45/#46/#47/#48/#49. The user requested a review sweep;
no merge was authorized. All phases remain Review, with raw review/runtime evidence
local and ignored. P15B/P16B remain Open and 24-hour endurance remains Deferred.

## Findings and dispositions

The initial complete GraphQL snapshot (`.local/r094-reviews.json`) contains nine
unresolved inline threads and six additional outside-diff/optional findings.
All review and comment pages were checked for pagination. The following changes
address the fifteen findings; thread resolution/publication is recorded separately.

| PR | Finding | Disposition |
|---|---|---|
| #42 | Incomplete source anchors | Correct strategy/maker binding/quote-response locations and state the clearing path prefix. |
| #42 | Ambiguous account terminology | Name isolated and two-position cross margin accounts explicitly. |
| #43 | Stale next action | Correct the P29B branch checkpoint to authorized P30 implementation; later phases retain their own subsequent checkpoints. |
| #43 | Cartesian oracle misses inventory skew | Randomize positive skew tick/step as well as inventory; 26 independent contract tests pass on the owning branch. |
| #43 | Joined words/numbers in the contract | Restore spacing without changing golden values or bounds. |
| #48 | Missing maker-owned expiry proof | New originals retain program, registration, price and expected sequence. Authenticated finalized unchanged state after blockhash expiry permits a separately reserved retry; unknown fees stay reserved. |
| #48 | Hardcoded browser executable | Move the existing P34 fix into P33: explicit environment override or installed Playwright browser resolution. |
| #48 | Aggregate-only trader audit | Move P34's independent per-trader fill/funding/cash/claim replay and offsetting-error regressions into P33. |
| #48 | Profile 4 only checks v0 support | Require both v0/v1 capability before signing; keep profile 3 v0-only and explain the requirement in the error. |
| #48 | Fixed browser settling sleeps | Wait for accessible refresh state, market quantity, isolated-account selection and enabled action controls. |
| #48 | Index assertion matches the impact substring | Require the exact index and impact table cells. |
| #49 | Profile/schema prose typos | Correct the missing spaces. |
| #49 | Joined comparison wording | Separate “three-profile” and “600-offer.” |
| #49 | Reversed compute-budget comparison | State measured 31,813 CU versus the 160,000-CU headroom ceiling and 200,000-CU submitted budget. |
| #49 | Browser prerequisite absent from fresh setup | Explicitly require installed Chromium/system Chrome; locked `playwright-core` dependencies install no browser. |

#45 and #47 had no inline findings and explicitly skipped automated review. #46
reported no actionable comment. This is not independent review approval.

## Safety boundary and scoped verification

The expiry reader checks a single finalized RPC batch at or after finalized
blockhash expiry, exact owners/discriminators/sizes/schema, canonical registration/
config/price PDAs and registered venue/program identity. The actual maker instruction
increments its sequence with checked arithmetic. Advanced/missing/forged state fails
closed. Runtime verification still enforces the qualified executable pins.

The original signed bytes remain immutable. A replacement consumes a new reservation
and the existing retry limit; neither proof nor missing history releases an unknown
fee. Budget handover remains blocked until every original's fee is accounted for.
Old null-authority originals are not migrated in place. The bounded budget may still
exhaust after repeated missing-history outcomes; this is stated in the operator guide.

Typecheck and trader build pass. Twelve focused service/UI checks and two independent
trader-audit cases pass, including both maker programs and eleven adversarial proof
variants. Typecheck initially caught nullable wallet capabilities and a branded bump
fixture assignment; both were corrected before passing validation.

Fresh expiry/retry run on clean `791fb8d5109bff0ae4131239f27e547fd8a19c7f`:
`.local/liquidity-execution/qualification/20261029T214547Z-r094-36761/expiry`.
A persisted but unbroadcast original reaches actual finalized blockhash expiry.
The queue proves nonapplication, preserves it through a runtime restart and signs
one new retry. That retry finalizes with an independently fetched identical wire
and finalized signature WS notification; actual fee is 5,000 lamports. The original's
20,000-lamport reservation remains. Budget handover rejects. All eight roots and
30 financial accounts reconcile: vault/allocated cash 8,000,000 atoms, surplus zero,
with an unchanged financial projection.

The affected service/browser run on the same clean `791fb8d` passes:
`.local/liquidity-execution/qualification/20261029T214547Z-r094-36761/services`.
It resolves 370 actual service originals (369 successful, one classified failed),
ten browser originals and two additional SDK originals; three actual SIGKILL/lost
acknowledgement recoveries preserve their signed originals. All 90 retained publisher
reports pass the independent literal flat-curve check (86 available). Fresh PostgreSQL
reconstruction matches all 174 events/outbox rows with no unresolved financial jobs.
The separate `p33_services_reference.py` passes each trader root, exact cash/claims/
funding/fees and six internal-maker reports: vault 7,999,993 atoms, root cash 7,999,665,
taker fees BTC/ETH 267/61 and insurance 66/15, with zero unexplained difference.
Owned RPC/WS/PostgreSQL/browser servers are stopped. Only the scoped runtime checks
were repeated; these counts are new R094 evidence, not inherited P33 counts. No unchanged SBF rebuild, unrelated
full matrix, 600-offer comparison or endurance repeat is required. Hosted CI and
final publication/thread counts are recorded below after publication.


## Stack and reproduction

Review fixes are in their owning phase PRs. `gh stack rebase --no-trunk` cascades
#42 → #43 → #45 → #46 → #47 → #48 → #49. The only content conflicts were the old
P29B next-action line versus P33's later checkpoint and adjacent decision additions;
the later checkpoint and both decision records are preserved. All program artifacts
remain unchanged. The P34 source at `791fb8d` includes P33 correction `5941cd9`.

The scoped entrypoints are `tests/rpc-contract/liquidity-expiry-rpc.ts` and
`tests/rpc-contract/liquidity-services-rpc.ts`, selected through
`RIVALT_CONTINUATION_ENTRY` with `RIVALT_CONTINUATION_PROFILE=treatment` in
`bash ops/liquidity-continuation-smoke.sh`. Each uses a separate fresh database in
the stopped owned cluster selected by `RIVALT_PG_REUSE_DIR`, via the existing
`ops/liquidity-qualification-postgres.sh`. The actual supervisor and private run
paths are retained at `.local/r094-review-runtime.sh`; no credentials are recorded
here. Browser validation uses the installed system Chrome through
`RIVALT_CHROME_PATH`. Frozen dependencies, exact artifact manifests and the explicit
local deployment profile remain prerequisites.

| PR | Restacked source head before review-report closeout |
|---|---|
| #42 | `d124215` |
| #43 | `48abd8b` |
| #45 | `fe91497` |
| #46 | `693e5f9` |
| #47 | `46be8d4` |
| #48 | `5941cd9` |
| #49 | `791fb8d` (fresh scoped runtime pin) |
