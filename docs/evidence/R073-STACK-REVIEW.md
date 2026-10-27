# R073 — P22–P28 review disposition

The user authorizes remediation and atomic integration of ready PRs
#32/#33/#35/#36/#37/#38/#39/#40. Review began at stack tip
`3b974c2748e77c307bf3b58f9d1e9cb933259505`. Remediation commit
`e6ba2cfdbdb41dbfe037453ed75444f3baf94aa3` passes all five refreshed hosted jobs.
All eight PRs merge atomically at `0916b9dc7896f9cdfc68081ad56daa93dabf3d94`,
whose tree exactly equals that reviewed tip. All 11 inline threads are resolved;
CodeRabbit skipped an incremental review, so no new review approval is claimed.
This report adds review/scoped regression evidence, not a fresh financial run.

| PR / finding | Disposition in the coherent stack tree |
|---|---|
| [#33 reference status](https://github.com/arnabnandikgp/rivalt/pull/33#discussion_r4381634205) | Correct D59 historical limitations to distinguish completed D60 executable contract from later implementation acceptance. |
| [#33 current roadmap](https://github.com/arnabnandikgp/rivalt/pull/33#discussion_r4381634216) | Already superseded by downstream WORKLOG checkpoints; R073 now explicitly covers all P22–P28 acceptance and authorized integration. |
| [#35 P23 status](https://github.com/arnabnandikgp/rivalt/pull/35#discussion_r4393427026) | Already corrected to Review downstream; no premature Closed status. |
| [#36 ACTIVE deposit](https://github.com/arnabnandikgp/rivalt/pull/36#discussion_r4382405877) | Implemented in P25 `12a23e6`: active deposits use the financial profile/model and invalidate affected certificates; legacy custody withdrawal remains gated. P25/P27/P28 reports retain actual deposit acceptance. |
| [#36 serialization fixture suggestion](https://github.com/arnabnandikgp/rivalt/pull/36#pullrequestreview-5658910983) | Populate every scalar, nested book/oracle and separate market with nonzero markers. Borrowed bytes equal owned IDL bytes; swapping markets fails parity. Test-only program edit. |
| [#37 next action](https://github.com/arnabnandikgp/rivalt/pull/37#discussion_r4386038989) | Already superseded by later checkpoints; historical run entries remain intact. |
| [#39 worker specification](https://github.com/arnabnandikgp/rivalt/pull/39#discussion_r4391568165) | P28 `ac894f1` already records completed worker acceptance in P27 specification/report. |
| [#39 roadmap/publication](https://github.com/arnabnandikgp/rivalt/pull/39#discussion_r4391568188) | P28 publication already records #39/#40 and current next action; R073 replaces keep-open with the newly authorized merge. |
| [#39 liquidation expiry](https://github.com/arnabnandikgp/rivalt/pull/39#discussion_r4391568242) | Persist signed receiver `accountStateVersion` authority. Finalized expiry plus unchanged canonical receiver proves no economic effect; changed/missing authority stays unresolved, unseen fees remain reserved. Permissionless freeze/resolution retain null proof. |
| [#40 operator slots](https://github.com/arnabnandikgp/rivalt/pull/40#discussion_r4392875692) | Keep all discovered owner children, label maker/receiver roles, show cash and suppress trader-ticket admission for non-traders. Occupied slots no longer offer registration. |
| [#40 environment loading](https://github.com/arnabnandikgp/rivalt/pull/40#discussion_r4392875720) | Explicitly source/export the trusted private mode-0600 deployment file in each process terminal; tool PATH setup alone is insufficient. |
| [#40 history exclusivity](https://github.com/arnabnandikgp/rivalt/pull/40#discussion_r4392875728) | Both `/v3/events` and `/v3/trades` reject `latest=true` with any `after`, before opening a history transaction. Cursor/latest ordering is preserved. Associated SQL interpolation warnings are non-issues: endpoint/sort fragments are fixed literals; all user values use SQL parameters. |

PRs #32 and #38 have no actionable inline findings. Submitted reviews were comments,
not requested changes, at the initial sweep. No review approval or independent
protocol review is inferred from automated review completion.

## Scoped checks

After `source ops/env.sh`:

- `pnpm exec vitest run packages/indexer/src/account-api.test.ts packages/services/src/account-risk-worker.test.ts packages/services/src/account-queue.test.ts apps/trader/src/account/AccountApp.test.tsx`: seven cases pass. Uses actual worker/queue/API/UI consumers with encoded SDK fixtures, not a new RPC/WS/PostgreSQL deployment.
- `CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 cargo test --locked -p clearing --lib instructions::account_trading::routes::event_tests::borrowed_route_event_matches_owned_idl_wire_exactly --features account-safety-qualification`: one passes, 102 unrelated cases filtered.
- `pnpm typecheck` and `pnpm build:trader`: pass. Existing Anchor macro cfg/Vite large-chunk warnings remain.
- Diff whitespace, changed-document local links/fences and tracked-evidence policy: pass.

Initial fixture setup errors are recorded in WORKLOG and corrected; they were not
financial runtime failures. Raw review captures and focused logs stay at ignored
`.local/reviews/R073/`. No program binary, IDL or production authority changes.
P26 artifact qualification and P27/P28 actual runtime evidence retain their original
pins. Full local suites, fresh runtime qualification and endurance were intentionally
not repeated for these consumer/documentation/test-only changes; hosted regression
results are recorded only after actual completion. P15B/P16B remain Open and
continuous 24-hour endurance remains Deferred.


## Integration verification

`gh stack submit --auto --open` publishes the fix on existing PR #40. Authenticated
`gh api graphql` resolves/verifies all 11 threads after the connector reports
missing write access. The final eight-head sweep has zero unresolved findings,
no requested changes and CLEAN merge states. Selected inherited checks are green
or scope-skipped; [run 40576656720](https://github.com/arnabnandikgp/rivalt/actions/runs/40576656720)
passes scope/client/report/financial/shell on exact remediation head `e6ba2cf`.
`gh stack merge --yes --merge` succeeds, and independent PR metadata confirms all
eight MERGED at the common commit above. The fetched merge and reviewed tip share
tree `08b7c1f65ae0ea6d6d20ecc5c426975700ce2efd`. Local `main` is fast-forwarded.
Only documentation closeout follows; no further runtime acceptance is claimed.
