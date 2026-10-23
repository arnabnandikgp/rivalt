# Open-stack evidence cleanup — 23 October 2026

The user directed keeping raw evidence locally at its existing paths, with no bundles, moves or uploads. All **526** previously tracked raw files remain byte-identical and ignored. Their current Git trees contain only Markdown evidence reports. Small protocol messages, auditor field projections and explicit devnet configuration are tracked separately because executable tests/launchers require them. See [D38 storage policy](EVIDENCE.md).

The original tested phase commits remain ancestors. Each phase has an additional cleanup commit that includes the cleaned preceding phase; publication uses `gh stack push` with per-branch leases. No historical purge, baseline rewrite, phase merge or new financial acceptance is claimed.

The following are actual GitHub diff counts immediately after the cleanup push, before this documentation closeout. Counts include implementation, fixtures and documentation—not just executable code.

| PR | Added lines before | Added lines after | Cleanup commit |
|---|---:|---:|---|
| [#4](https://github.com/arnabnandikgp/rivalt/pull/4) | 14,468 | 11,170 | `83e78b648041` |
| [#5](https://github.com/arnabnandikgp/rivalt/pull/5) | 11,022 | 5,384 | `7f34e032c4dd` |
| [#7](https://github.com/arnabnandikgp/rivalt/pull/7) | 12,719 | 1,593 | `d8396374af17` |
| [#8](https://github.com/arnabnandikgp/rivalt/pull/8) | 19,863 | 6,407 | `28e73bf68a87` |
| [#9](https://github.com/arnabnandikgp/rivalt/pull/9) | 21,945 | 4,322 | `2769b3f8bbc6` |
| [#10](https://github.com/arnabnandikgp/rivalt/pull/10) | 32,974 | 8,144 | `acd7fd8f7ab0` |
| [#11](https://github.com/arnabnandikgp/rivalt/pull/11) | 87,656 | 9,264 | `488e34fb6ad6` |
| [#12](https://github.com/arnabnandikgp/rivalt/pull/12) | 31,843 | 5,008 | `20cf7e43f14e` |
| [#13](https://github.com/arnabnandikgp/rivalt/pull/13) | 117,305 | 980 | `445ab6f8ca9c` |
| [#14](https://github.com/arnabnandikgp/rivalt/pull/14) | 2,093 | 1,534 | `59210efa1004` |
| [#15](https://github.com/arnabnandikgp/rivalt/pull/15) | 22,533 | 3,673 | `211f907f90c3` |
| [#16](https://github.com/arnabnandikgp/rivalt/pull/16) | 3,353 | 3,751 | `7fd3b5b04529` |

Total added lines fall from **377,774 to 61,230** (83.8% reduction). PR #4 also removes 48 raw files inherited from the already-integrated main baseline, so its deletion count increases. PR #16 gains deliberate auditor fixtures; a smaller byte footprint does not always mean fewer formatted JSON lines. The full curated fixture set is **176,102 bytes**, versus 18,635,484 raw evidence bytes removed from the current tracked tree. Git history still retains its existing objects.

## Verification

- All 526 local raw files match their pre-cleanup SHA-256 values, are ignored and are absent from the Git index. No configured credential matches occur in the tracked tree.
- All 12 phase trees retain their original tips and cleaned parent ancestry. `crates/`, `packages/` and `apps/` are byte-identical to each phase's original tip. The only Rust source edit redirects two test-only `include_str!` paths to identical captured bytes.
- Three targeted SDK observation tests, 19 focused Python auditor/policy tests from a fresh checkout without raw evidence, typecheck, and the single captured-account Rust test pass. The first reduced P14 fixture omitted participant identities; it was corrected and its eight affected audit cases rerun successfully. No auditor assertion was waived.
- The scoped CI workflow enforces the no-raw-evidence rule and fixture size budget. Hosted scoped CI passes for [P11](https://github.com/arnabnandikgp/rivalt/actions/runs/39992103745), [P12](https://github.com/arnabnandikgp/rivalt/actions/runs/39992147824) and [P13](https://github.com/arnabnandikgp/rivalt/actions/runs/39992142336) on the cleanup commits above. P14 is queued at this checkpoint; its result is not claimed. Earlier phases do not have that later workflow at their own tips.
- No full financial matrix, Surfpool/PostgreSQL lifecycle, live devnet transaction, load or soak is rerun: financial behavior and recorded runtime captures are unchanged. Original test results remain attributed to their actual commits.

All 12 existing PRs remain ready to review with their original base branch names. Their descriptions disclose local-only evidence. WORKLOG retains the milestone/phase statuses; this maintenance run does not close unmerged phases or advance M6.
