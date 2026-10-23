# P14 bounded devnet lifecycle

This phase uses the explicitly pinned devnet clearing/A/B deployments, classic six-decimal test collateral and sponsored Pyth Core accounts. The operator-controlled guard is a disclosed fixture. It is not independent price assurance or funded-pilot readiness. See D36/D37 and WORKLOG for authority and actual status.

The approved devnet source-age ceiling is 30 seconds. Its actual clearing upgrade and age-29 success/age-30 exclusive-deadline rollback are recorded in `evidence/p14/`. Default/local policy remains 20 seconds. Six-second recovery, confidence, funding gaps and all other risk rules are unchanged. P13's immutable successful trade used its original 20-second build.

Run only the acceptance command needed for the changed behavior:

| Command | Scope |
|---|---|
| `bash ops/devnet-indexer.sh` | Actual finalized history → fresh PostgreSQL → HTTP reconstruction; no transaction signing |
| `bash ops/devnet-recovery.sh` | One 1,000-atom actual deposit, deliberately disconnected WS, discarded actual broadcast acknowledgement, restarted service/indexer instances, original-signature/backfill recovery |
| `python3 tests/e2e/audit_devnet_recovery.py <report.json>` | Independent raw-account integer audit of that recovery |
| `bash ops/devnet-lifecycle.sh` | Existing-position reduce-only order/cancel, quoted A close, source expiry, flat-cohort loss collection/gain settlement and funded withdrawal |
| `python3 tests/e2e/audit_devnet_lifecycle.py <report.json>` | Independent raw-account integer lifecycle, funding and cash/claim audit |
| `bash ops/devnet-demo.sh` | Interactive UI, real indexer/read API and durable wallet-signed executor; no automated trade/source/maker worker |
| `node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-wallet.ts <public-owner>` | Read-only verification of the external wallet's actual registration signature, exact canonical message, finalized account state and indexed balance |

The acceptance supervisors own only their run's PostgreSQL container and retain its data and exact transaction journals under `.local/devnet/`. They use existing ignored `.env.devnet` server RPC/WS configuration; no key enters public UI configuration or evidence. A failed or unresolved financial intent must be recovered from its retained original wire/SQL state before any new intent. Do not rerun setup or recreate the P13 opening trade. The lifecycle entry requires the retained +1/−1/0 positions and stops if they differ.

The lifecycle has one aggregate 600-second source-preparation budget. Reduce-only actions can use the existing Degraded mode; they do not require artificial continuous Normal availability. Actual program admission still decides at landing. Source expiry after all participants are flat permits the existing P07 on-chain collection/complete-cohort settlement/withdrawal path. The service worker follows that path; exposed, paused and frozen cohorts remain restricted. Fractional claims remain owned by their participants, including any atom retained to cover a negative fractional liability. This demonstration closes against A; the separately recorded local cross-maker close is not relabeled as devnet evidence.

The recovery fault deliberately discards a real provider acknowledgement and closes an actual WS. It is controlled fault evidence, not a spontaneous provider-outage claim. Every new service instance resolves the original signed bytes; SQL uniqueness, full account reconciliation and independent integer checks establish one economic effect.

For the interactive check, run `bash ops/devnet-demo.sh`, then open `http://127.0.0.1:18088`. The launcher runs for at most 60 minutes, loads no private signer and cleans up its owned processes/container on exit. Connect an external wallet that supports devnet and v0 transactions. A wallet without a participant uses **Register account** through direct RPC. The browser previews the exact generated instruction, asks the wallet to sign, saves the signed bytes before broadcast and independently fetches finality. Record the public wallet address, actual signature, fetched wire and chain/account delta. CLI/instrumented-wallet signatures do not satisfy this external-provider check.

Public browser RPC uses the credential-free official devnet endpoint; server indexing uses the configured provider. Rate limiting/unavailability must remain visible. Maker/source automation is deliberately absent from the manual launcher: it does not promise continuously available trading. Deposits, registration and admissible flat-cohort direct exits remain available under the program's actual state.

The engineering MVP report must distinguish verified local behavior, bounded actual devnet behavior, unmerged Review phases and M6's independent-maker/review/funded-pilot gates. An uncompleted wallet/lifecycle check keeps A19 and M5b open.

The first successful order/cancel arrived at the end of the initial 600-second preparation budget. A narrowly checked continuation accepts that exact failed report through `RIVALT_LIFECYCLE_RESUME_REPORT`: it requires both completed original wires and unchanged financial accounts, skips those actions and bounds only the remaining unsigned close preparation at 300 seconds. Retain both original reports and their source revisions; composed lifecycle evidence does not change a failed original run to pass.
