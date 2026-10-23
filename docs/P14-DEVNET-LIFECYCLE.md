# P14 — bounded devnet lifecycle

P14 builds above ready P13 PR #15, exact parent `93c1ef4`. It is in progress; no A19 or M5b completion is claimed.

Under D37 the target is one actual test-asset lifecycle, one wallet-provider signing check and one provider/backfill recovery into PostgreSQL. Reuse P13 deployment/source provenance and the retained +1-lot trader position where appropriate. Do not repeat the local financial matrix, load, endurance or seek continuous sponsored-feed availability. Missing sources produce an explicit unavailable result; accounting, signature/finality and authority checks remain mandatory.

## Explicit deployment binding

`testDeployment` selects the existing local IDs by default or the pinned P13 devnet clearing/A/B IDs for `solana:devnet`. Indexer/services opt in with `RIVALT_CHAIN=solana:devnet` and verify the fixed devnet genesis and immutable database initialization/program binding. SDK PDA derivation, event decoding, account ownership and generated instruction construction all use that explicit deployment. Mainnet and arbitrary deployment activation are unsupported. Existing local tests keep their original IDs.

The browser's public configuration selects `solana:devnet`, the pinned genesis and actual market/mint/initialization/domain. It must contain credential-free RPC/WS URLs. Private provider configuration remains server-side in ignored files. Wallet Standard must advertise devnet and v0 signing; the browser never receives a private key. Existing signed-byte persistence, independent RPC reconciliation and no automatic replacement-signature rules continue.

## Approved source-age setting

Profile `p14-sponsored-core-test-assets-v2` selects the user-approved **30-second** maximum source age only in the clearing devnet feature. Both ordinary sampling and resolution source rereads use the same selection. Local/default source policy remains **20 seconds**. Bounds may be computed at the age ceiling, but sensitive actions still require execution strictly before the source deadline. Six-second recovery/hold, funding outage/catch-up, confidence/future/divergence limits and fees are unchanged.

The separate SBF/IDL build on clean `b3a2fc1` passes. The focused compiled check verifies age-29 acceptance and exclusive age-30 rollback (28 checks including 20 necessary setup). The clearing upgrade finalizes at slot 514275649; independent RPC reads verify exact tested ELF bytes and zero padding, with the same isolated authority. The other three artifacts are unchanged. [Build, boundary and upgrade evidence](evidence/p14/sha256.json) records the actual activation. The original P13 evidence remains attributed to its original 20-second binary and 18-second source age.

## Evidence still due

- Actual devnet read/projection with PostgreSQL, exact sequence/account/vault reconciliation and HTTP views: **verified** on clean `df77351`, [52 transactions / 43 events / zero unresolved jobs](evidence/p14/indexer.json). This read-only run has no new live notification or provider-interruption proof.
- Bounded actual close/settlement/withdrawal plus selected order/funding behavior, with independent expected values and preserved rejected/unknown outcomes.
- Actual external wallet-provider signing/landing; a local signing fixture cannot replace this check.
- One provider interruption/reconnection and original-signature/history backfill, with no duplicate economic effect.

WORKLOG records actual commands, outcome populations, deployment/source identities and the next action. Unperformed checks remain pending; funded deployment, independent guard/maker assurance and external review remain M6.
