# P13 sponsored-source and adapter checkpoint

This is the historical adapter/deployment checkpoint, when P13/A18 was incomplete. [The later P13 closeout](P13.md) records actual source consumption, accepted/rejected actions and the explicit recovered-WS qualification. M5b still requires P14.

## Actual dependency observation

Clean `ffc20f3f9c75489b5124e8d011b9bdc81932da1a` ran `node --import tsx tests/rpc-contract/devnet-sponsored.ts` from 10:49:13 to 10:52:14 UTC on 23 October 2026. It observed 180,522 monotonic milliseconds, 37 confirmed and 37 finalized RPC batches with the actual Clock sysvar, four acknowledged account subscriptions and seven actual WS notifications. [Report](p13/sponsored/report.json), [raw batches](p13/sponsored/samples.json), [WS observations](p13/sponsored/notifications.json).

| Pair | Eligible confirmed samples | Eligible finalized samples |
|---|---:|---:|
| Original Core BTC/USDC | 1/37 | 1/37 |
| Core Compatible BTC/USDC | 3/37 | 3/37 |

These apply G08 price/freshness checks to sampled source data. They do not establish continuous availability or a completed six-second funding recovery window. The compatible eligible observations had ages 13, 15 and 20 seconds; the exact deadline is not an executable trading window. Some other observations were several minutes stale. No freshness limit was widened. D36 selects the compatible pair as the candidate for actual Rivalt consumption.

An independent Python decoder (`python3 tests/e2e/audit_pyth_sponsored.py`) checks raw message fields, feed/PDA authority, exact instruction discriminators, full verification, posted slots, successful transaction metadata, push/receiver CPI argument equality and the common verified VAA. [Audit output](p13/sponsored/audit.json) links these actual finalized transactions:

- VAA verification at slot 514221956: `QekLPuciRUctMt47AuppzvXZ48LQS9a4jZsSitQswueXm4QKQrGUBgi7no2WRi98ZuJ9G2h8tTXLW3C9R5wFJt5`, invoking `HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL` with `VerifyEncodedVaaV1`. [Raw transaction](p13/sponsored/vaa-verification.json).
- BTC push/receiver at slot 514221993: `3CuJRpZvtswKufeveKbDvLtiqnuYuGW7Y6UVGc1Bq5afpaSXcm8ooFm3Adps5VepgoTTeTKAM6yeFRswLDWSy9qV`. [Raw transaction](p13/sponsored/btc-update.json).
- USDC push/receiver at slot 514221961: `53D5kDpohFCaSBPueEyQG2BFV6ZETJgfybbTZDRkycMQYZpH81wshMi71WZdPm5b6WmeiBWZDXUkzjB1jXVAws5L`. [Raw transaction](p13/sponsored/collateral-update.json).

Both update messages publish at 1792752688 and match the independently captured account bytes. Their VAA was subsequently closed; its actual verification transaction/history remain available. Recent unrelated referencing transactions use version 1 and cannot be mistaken for price updates. Selected upstream update/verification transactions are version 0. ABI references are pinned to upstream `145e9b4a88ef0bf2795357fdce8c0c2fe57b77d2`; this is wire/source attribution, not a reproduced build of the upstream programs or independent security review.

## Adapter and funding preparation

Four targeted TypeScript decoder/conversion/freshness tests pass. Three Rust decoder tests pass, including the actual captured account bytes and independent exact decimal values. Separate devnet SBF/IDL builds pass; IDL generation first encountered ENOSPC, then two incomplete generated dynamic libraries. The build resumed after removing those failed outputs and the stopped disposable P12 diagnostic database clone. Original P12 run data and JSON audit reports remain intact. Only current-run host-test cache files were also reclaimed; unrelated containers and user files were untouched.

`node --import tsx tests/rpc-contract/devnet-svm.ts` passes **41 signed checks, including 20 setup transactions**, with exact binary hashes in [its report](p13/sponsored/adapter-svm.json). It uses explicit captured upstream-account fixtures, never claims a devnet verification execution, and checks an independently calculated one-lot maker-A gross amount, 2 bps fee, cash/position/virtual deltas and unchanged aggregate vault allocation. Wrong account/owner substitutions reject atomically; malformed/full-verification/feed/regression/future/stale cases remain restrictive. The first harness attempt incorrectly expected an authenticated future timestamp not to advance the source identity; the corrected test distinguishes authentication sequence from later policy rejection and tests staleness before that regression boundary. No financial rule was relaxed to pass it.

The initial public faucet request returned JSON-RPC `-32603 Internal error`, and a later balance read still showed zero. The user then explicitly authorized transferring existing test SOL from the local Solana CLI wallet. Exactly **15 devnet SOL** finalized into isolated deployer `4oudHrUzAnRhd5BivAu4cympwyevfo4PTr2Cg87cV8Hi` in `4YV3HSNUyDbUh3gENAA2Dgzax8gkGiBc4fJYQNUUG2Gyo8kXiiG2VMeWxm84reK1r1uu8KPCVvQSqahoBeyMRfZj`, slot 514224240, fee 5,000 lamports. An independent RPC fetch decoded the exact transfer and confirmed the 15,000,000,000-lamport recipient balance. [Finalized transaction](p13/funding/funding-finalized.json). This is test-cluster funding, not real funds or a funded-pilot authorization. No Pyth API key/subscription was acquired.

Typecheck and explicit generated-IDL layout comparison pass. No inherited financial matrix, load, browser, 24-hour endurance or external review was rerun. The final WS probe adds premature-close failure detection after the recorded observation; the observed run is attributed to its exact earlier revision, not relabeled as a second run. [Evidence hashes](p13/sha256.json).

## Actual deployment checkpoint

Clean `b25a8573ea23991da7c1e327bcb8d4f13a80abc6` rebuilds with every ELF hash identical to the signed SVM report. [Build/IDL identity](p13/deployment/build.json) and [six upstream ProgramData/WS checks](p13/deployment/upstream-inventory.json) are retained. Actual deployment completes for clearing, A, B and the signed guard fixture. Independent finalized RPC reads match every tested ELF byte and expected authority; independently fetched deployment transactions match the recorded ProgramData slots. [Deployment manifest](p13/deployment/deployed.json), [actual deployment transactions](p13/deployment/deployment-transactions.json). The isolated payer retains 5,893,094,800 lamports. No Rivalt account state has been fabricated or injected on devnet.

The final local harness isolates its generated SVM keys from the operator's private keys and still passes 41 signed checks with the same binaries. [Separate report](p13/sponsored/adapter-svm-isolated.json). Four focused event-decoder tests cover explicit program binding, and typecheck passes. This does not claim hosted CI, full regression or actual-cluster protocol acceptance.

Next: execute the committed bounded A18 harness against the verified deployments, then retain source-verification provenance for the exact messages consumed. P14 remains dependent on that actual A18 gate.
