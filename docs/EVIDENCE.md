# Local evidence and tracked regression inputs

Raw run output stays at its existing `docs/evidence/` paths on the operator's machine, untracked and ignored. No archive, upload or external download is configured. A fresh clone contains the concise Markdown reports, tested commit identities, limitations, reproduction commands and the independent auditors; it does not contain the retained raw runs. Raw-file references in reports are explicitly local paths.

This is the user's 23 October storage decision. Original commits remain in the repository's existing history; removing files from current trees and PR diffs is not historical object purging. Cleanup commits retain the original phase tips and the cleaned preceding phase as ancestors, preserving attribution without replacing test evidence or asserting a fresh execution.

Keep implementation, executable tests, independent audit code, deployment configuration and small deliberate regression fixtures tracked. Do not commit transaction dumps, screenshots, full run JSON, database exports, binaries or compressed run output beneath `docs/evidence/`. Existing local files must not be deleted, moved or rewritten merely to clean a PR.

`tests/fixtures/` contains bounded inputs needed for ordinary tests. Its README distinguishes projected decoder/auditor inputs from complete acceptance evidence. Those tests run in a fresh clone without any local raw runs. Live launchers use explicit configuration in `ops/`, not historical acceptance reports.

To repeat a retained-run audit on this prepared machine, use the exact local paths and audit command in its phase report. Missing local evidence is an unavailable input, not a passing check; do not fabricate it or silently skip an acceptance assertion. New genuine runtime checks still write their own unique run directories under the existing supervisors. No full financial matrix, load or soak is needed solely for this storage cleanup.

`python3 ops/check-evidence-policy.py` rejects tracked raw evidence and bounds curated fixtures to 96 KiB each / 200 KiB total. Hosted PR scope checks enforce the same rule. The local cleanup verifies every retained file's SHA-256 before and after changing Git tracking.
