# R030 — reviewed maker hardening on devnet

25 October 2026 · test assets only · WORKLOG owns integration/phase status.

The reviewed A/B initialization hardening is deployed and jointly approved. Corrected signed ownership checks, independent raw-account reconciliation and fresh PostgreSQL/HTTP verification pass. Original P13 A18 and P14 A19 remain attributed to their original revisions; this is their narrow post-review follow-up.

## Deployed identity

All programs retain upgrade authority `4oudHrUzAnRhd5BivAu4cympwyevfo4PTr2Cg87cV8Hi`. Finalized RPC verifies each maker's exact reviewed ELF followed only by zero allocation padding. Clearing and the operator-controlled guard retain their previous full ProgramData hashes.

| Program | Built source | Live slot | ELF SHA-256 |
|---|---|---|---|
| Clearing | `b3a2fc12c7d1744f647133460a03b6dc3394c592` | 514275649 | `66eab4e6fa35348d5e171e85ea331a6f8a650a25f043e60e53aa38eb1c7d1d86` |
| Maker A | `a9d9f26c8f862258378bd7a85195b5bbd47ba3d1` | 514709495 | `5e1113453f87075babdf1a2d0380ce420ec97c1e312317aeaca9c2386f95abbc` |
| Maker B | `a9d9f26c8f862258378bd7a85195b5bbd47ba3d1` | 514709597 | `8c65c85d9113e3e79ca7257f343543baa4e90868a594095d8b9ace8a87ab80b0` |
| Guard fixture | `b25a8573ea23991da7c1e327bcb8d4f13a80abc6` | 514229863 | `278d51b1cacda2a74a727fe710b052242c83fbffbe39b4723ad942dbc75f722b` |

D40's refactored clearing binary is **not deployed**. R029 verifies its unchanged wire ABI and affected semantics; the existing clearing binary performs this run's real upgrade approval/account operations. No clearing migration or new financial behavior is introduced.

- A upgrade: `32BVvMVneticStoFeZ8dqzUe5PEDsX73D9szUy4nayWzZaChsCHYZcudRGz9dTgdxiyE1zqLrxTxirUKvXCGYncV`.
- B upgrade: `5YNoijwfn4NVBQVHM6cAcaGbcBxukWKDE1XEizY8Vwq6uRXS9vaHxRnuXcJqz4aJXe8SDhW9siu1VfSDoarQw2AR`.
- A joint approval: `24dsuw7pJ13MWoxLoq6ZbtHSddiBt8QnqA5zfdyeUjiwU6FdCp4zyJ65WR91HTGVGHwG7m6TCZvncDdBVouD6PLY`; approved **whole ProgramData** SHA-256 `eaa4b987f80d41a80bf19808cd259426bcda90d46a5f9401059f1e42d5666b6c`.
- B joint approval: `pJp8AiKTNkHCLoSQnTr47Ku73dJcLLYuGD7p9C3L72nyWd14k3NR5t2FjRS7vndcUX94aMLvBvkKQa18DLQBDqP`; approved whole ProgramData SHA-256 `6b5abbed842f6f2c593924007384ffac18da8f9de1a196ed2e3ea96bb932bb56`.

Upload execution on clean `df336c0` uses the pinned deployer and explicit resumable buffers. Its balance decreases by 105,938,400 test lamports, including program extension rent and upload fees. No faucet, wallet transfer, paid provider or external signature is required.

## Acceptance and preserved failure

Clean `b95b970` finalizes 12 signed checks, including six intended rejections. Both makers reject missing clearing-owned capital (6001), an unrelated initializer (6000), and clearing rejects an unapproved deployed hash (6114). Both market/maker authorities then approve the new hashes without resetting quote consumption.

The independent auditor **rejects the initial test configurations' domain**: the harness derived it from the new profile label rather than reading the existing market's stored domain. These zero-cash test configurations were never registered for quoting. Preserve their original captures and the failed initialization audit. Their separate actual upgrade rejection, joint approvals and unchanged-account reconciliation remain valid; they are not relabeled as a complete initialization pass.

Clean `a1c793c` corrects the domain and finalizes eight ownership-only transactions with four intended rejections. The new owner `EhMKgGJMVJ1poAtJAc4M8JHvdhVBJ6g4uC1eZYgCeqAC` initializes A/B configurations against participant `4Q2fXHJsTz6ij8CjUgjJwfpbJx32fm6nE1UQvLKfV5A5` and the actual stored domain. No upgrade or approval is repeated. Durable journals retain original signed bytes, fetched finalized transactions, fees and failed logs.

The independent Python auditor imports no generated SDK or financial implementation. It verifies literal byte layouts, unchanged existing participant/config/vault data, exact permitted market/registry/registration changes and byte-identical continuation between runs. Final vault = allocated collateral = **1,000,000,470 atoms**; six participants, zero net lots, unchanged existing balances/positions/consumption. Acceptance network fees are 95,000 + 65,000 lamports. All five adverse cash/domain/owner/approved-hash/vault mutations reject.

Actual configured RPC/WS → fresh PostgreSQL 18.6 → HTTP passes on clean `a1c793c`: **75 transactions, 62 events, zero unresolved jobs**. Both failed clearing upgrade checks are retained without projected events; each approval has exactly one matching maker event. HTTP exposes the actual approved hashes, the corrected participant is indexed at zero cash, and vault/account reconciliation passes. WS subscription succeeds with zero notifications during this idle backfill; no new provider-outage fault is claimed.

## Local evidence and reproduction

Raw files remain ignored at these existing local paths:

- `.local/devnet/maker-rollout-r030/`: original pre-upgrade baseline, `upgrade-2026-10-24T19-11-13.111Z.json`, `acceptance-2026-10-24T19-13-05.503Z.json`, failed domain audit, immutable journals/checkpoints.
- `.local/devnet/maker-ownership-r030/`: continuation baseline, no-op upgrade inspection, `acceptance-2026-10-24T19-16-35.109Z.json`, independent `audit.json`, five-case `audit-adverse.json`, journals/checkpoints.
- `.local/devnet/p14-indexer-20261024T191359Z-54579/indexer-report.json`: original approvals, 74 transactions/61 events.
- `.local/devnet/p14-indexer-20261024T191720Z-55579/indexer-report.json`: corrected continuation, 75 transactions/62 events, retained PostgreSQL data.

Use `source ops/env.sh` for pinned tools. The upload command is `node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-maker-upgrade.ts`; its explicit manifest is `ops/devnet-maker-rollout.json`, not an acceptance dump. It validates the pinned source/artifact hashes, devnet genesis, original-or-target deployed bytes and authority before upload. Matching deployed makers skip uploads. Retain its existing buffers/journal through any interruption.

The corrected check command is `RIVALT_MAKER_ROLLOUT_DIR=.local/devnet/maker-ownership-r030 RIVALT_MAKER_TEST_OWNER_ROLE=r030-owner-v2 node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-maker-closeout.ts`. Completed checks retain their original wires; final current state is checked again on resume. A new check directory needs its own upgrade-command baseline first.

Run `python3 tests/e2e/audit_devnet_maker_rollout.py <corrected-acceptance.json> <original-acceptance.json>` for the composed audit. Run `RIVALT_MAKER_ROLLOUT_REPORT=<original-acceptance.json> RIVALT_MAKER_OWNERSHIP_REPORT=<corrected-acceptance.json> bash ops/devnet-indexer.sh` for fresh read-only reconstruction.

Scoped typecheck and whitespace checks pass. Unchanged financial suites, SBF rebuilds, full lifecycle, browser signing, load/history qualification and soak are not repeated. Existing P13/P14 oracle/freshness, lifecycle and Phantom evidence is preserved. M6's independent maker/source/review, funded authorization and deferred 24-hour endurance remain separate.

Final read-only resume on clean `8a4ba7b` passes with zero new steps/signatures. It retains the signed checks' original `a1c793c` attribution while independently re-reading current config/domain/registration state. Local `maker-ownership-r030/acceptance-2026-10-24T19-21-46.765Z.json` and `audit-resume.json` record the result; `sha256.json` hashes the retained R030 files. Evidence policy and configured-credential scan pass. Hosted CI/publication/integration are recorded separately in WORKLOG.
