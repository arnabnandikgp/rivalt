# P01/P02 review verification — 21 October 2026

All four actionable review findings are addressed. P01 acceptance passes on `081d614c927046408ec0eb6777cf8ae21e8bfda8`; combined P01/P02 acceptance passes on `16e51e4937890db7fbc53ab09705deec4eb2aacd`. Both runs record `sourceDirty: false`. Integration status is maintained in [WORKLOG](../WORKLOG.md).

| Review finding | Change / verification |
|---|---|
| [Stale draft status](https://github.com/arnabnandikgp/rivalt/pull/1#discussion_r4328833676) | Corrected the P01 report to ready for review; original acceptance identity retained |
| [Generated SDK check](https://github.com/arnabnandikgp/rivalt/pull/1#discussion_r4328833728) | Compare post-build SDK/IDL with Git HEAD and reject staged, unstaged and untracked changes, retaining the IDL snapshot and determinism checks |
| [Readiness failure](https://github.com/arnabnandikgp/rivalt/pull/1#discussion_r4328833746) | Use system grep, bound each curl request, and fail with the log path on exhausted retries or early process exit |
| [SBF guard dependency](https://github.com/arnabnandikgp/rivalt/pull/2#discussion_r4333067675) | Use system grep with the original diagnostic patterns; checker errors and unreadable logs also reject |

All four threads received replies identifying the fix and actual verification, then were resolved. No economic, account, instruction or dependency changes were required. The automated review's generic docstring-coverage suggestion is not a repository acceptance gate; no unrelated documentation churn was added.

## Actual runs

Command on each clean fix commit: `source ops/env.sh && pnpm smoke`.

- P01: `.local/runs/20261021T063225Z-56957`; log (local: `docs/evidence/r004/p01/acceptance.txt`), summary (local: `docs/evidence/r004/p01/summary.json`), toolchain (local: `docs/evidence/r004/p01/toolchain.json`). Frozen installs, locked build, IDL/SDK checks, typecheck, 7 ABI tests, signed deployment, independently fetched/verified/decoded probe, five WS subscriptions, paginated history and rollback pass.
- P02: `.local/runs/20261021T063416Z-59770`; log (local: `docs/evidence/r004/p02/acceptance.txt`), summary (local: `docs/evidence/r004/p02/summary.json`), toolchain (local: `docs/evidence/r004/p02/toolchain.json`). Fresh combined acceptance: 8 Vitest tests, 11 Rust tests, 1,200 allocation + 1,200 funding + 600 complete-default reference cases and one compiled-profile comparison. Financial result (local: `docs/evidence/r004/p02/financial.json`).
- LiteSVM (local: `docs/evidence/r004/p02/svm.json`): 99 signed scenario transactions, 81 accepted / 18 expected rejections. Surfpool custody (local: `docs/evidence/r004/p02/custody.json`): 33 signed scenario transactions, 18 accepted / 15 expected rejections. Fixture provisioning is included in these counts. Ten committed events decode through both clients; failed-transaction events are excluded. Final C/P/T are zero and vault/insurance both equal 10,007 atoms.
- Targeted guard checks: `python3 .local/reviews/check-guards.py` executes the actual shell guard blocks against disposable Git histories and controlled shell responses. P01 (local: `docs/evidence/r004/p01/guards.json`): 9 cases. P02 (local: `docs/evidence/r004/p02/guards.json`): 15 cases with PATH restricted to `/usr/bin:/bin`. Stale regenerated, staged and untracked SDK output plus changed IDL reject; healthy readiness passes, unhealthy/HTTP-error/process-death cases cannot reach deployment. Safe SBF output passes; all three stack diagnostic patterns, a missing log and an unavailable checker reject. These are harness checks, separate from the actual RPC runs.
- `bash -n ops/build.sh ops/smoke.sh`, `cargo fmt -- --check` and `git diff --check` pass.

P01 SBF/IDL hashes remain `560c7c6bb499cbf406be7e8e4edbae43cca27bdf13f227b17e6480073bc24002` / `195ec9a1ce4f30117fef4e4774b26232f9f60a70166c812293bd169da1f1235f`. P02 SBF/IDL hashes remain `c8e363a5ab84caa9b928ffa12d1cf907099255ad274ff2325cbdb40d0f07abaa` / `5b40a99e003bf51c75744ded87fe308527559ffeb32a3da0b25cf204ca77b522`. The fixes change acceptance orchestration, not the deployed program bytes.

Not run: maker/routes, PostgreSQL/services, oracle/funding/orders/operational default, browser, load/soak, devnet, independent external review or funded deployment. Those belong to later unimplemented phases. These runs establish A01/A02 and the M1 engineering exit check only.

## Integration

`gh stack merge --yes --merge` merged both PRs atomically into `3c1aae1d85b86829d0f921612c1b7e834d4fcf76`. GitHub reports #1 merged at 2026-10-21T06:41:52Z and #2 at 2026-10-21T06:41:53Z. The user explicitly requested proceeding without waiting for P01's automated re-review; its last observed check was pending. All four original findings were already fixed and resolved.

Fetched main is byte-for-byte tree-identical to reviewed head `a19c79c6499ce6391141b78dbdbc9c3c01edf55e` (`git diff --exit-code` passed); that head changes only documentation from tested `16e51e4`. No semantic integration changes require another acceptance run. M1/P01/P02 are Closed. The next branch is `phase/p03-makers`, initialized by gh stack from this merged baseline.
