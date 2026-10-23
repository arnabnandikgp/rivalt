# P13 devnet dependency and deployment contract

P13 starts above ready P12 PR #14 at `e0c18260a09a4cb40432a6bcc3ce6875a949b52a`. A18 requires a separate Rivalt test-cluster deployment and an actual signed primary oracle update through its deployed verifier. Under D36 the sponsor may submit that upstream transaction; Rivalt must independently fetch/decode its real verification path and consume the authenticated account. The current local oracle fixture cannot meet that requirement. P13 is incomplete; WORKLOG owns live status.

The read-only inventory command is:

```sh
source ops/env.sh
node --import tsx tests/rpc-contract/devnet-preflight.ts
```

It defaults to the official public Solana devnet HTTP/WS endpoints, rejects any genesis other than `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, records the node version/feature-set identifier, fetches the Pyth Core receiver and Wormhole receiver plus their actual ProgramData accounts, and observes a real WS slot notification. It checks loader ownership/layout and records deployment slots, upgrade authorities and hashes of whole allocated account/payload bytes. Payload hashes include allocation padding and are not local ELF hashes. A node's feature-set identifier is not an inventory of every activated feature. This command neither signs nor deploys anything and never marks A18 complete.

For a private provider, configure `RIVALT_DEVNET_RPC_URL` and `RIVALT_DEVNET_WS_URL` together in the ignored `.env.devnet`, with file permissions restricted to its owner, then run:

```sh
node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-preflight.ts
```

HTTPS/WSS are required. Credentials can remain in provider paths/query parameters; URLs and provider error payloads are excluded from reports. The tool emits only a failure stage for network/provider errors. No default Solana wallet is read. Reports are written under `.local/devnet/preflight/` and identify revision/dirty state.

The approved primary path is Pyth Core's sponsored on-chain accounts, with Pro deferred. [Official contract addresses](https://docs.pyth.network/price-feeds/pro/contract-addresses#solana) identify original receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` and compatible receiver `rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp`. [Sponsored feeds](https://docs.pyth.network/price-feeds/pro/sponsored-feeds#solana) permit consumers to read pushed prices without fetching them from Hermes. No Pyth API key is required for these chain reads. The earlier unauthenticated Hermes HTTP 403 remains historical evidence; it does not block this selected path. No paid service or signup is authorized.

The read-only `node --import tsx tests/rpc-contract/devnet-sponsored.ts` observes both documented shard-zero BTC/USD and USDC/USD account variants for three real minutes through confirmed/finalized RPC and confirmed account WS notifications. It includes the Clock sysvar in each batch, retains raw accounts and distinguishes source age from host time/commitment. This is a bounded dependency check, not a new soak. Full verification, exact owner/PDA/write-authority/feed/discriminator bindings and conservative integer exponent normalization are checked against the pinned [upstream SDK](https://github.com/pyth-network/pyth-crosschain/blob/145e9b4a88ef0bf2795357fdce8c0c2fe57b77d2/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs) and [push seeds](https://github.com/pyth-network/pyth-crosschain/blob/145e9b4a88ef0bf2795357fdce8c0c2fe57b77d2/target_chains/solana/programs/pyth-push-oracle/src/lib.rs). This probe is not the on-chain Rivalt adapter. Reading an account or finding a recent referencing transaction alone is not signed-update proof: locate a successful update at its posted slot and inspect actual instructions/receiver CPI and authenticated message.

Keep G08's 20-second source age, two-second future skew, confidence/divergence checks, funding-gap behavior and restricted actions. Sponsored availability can be intermittent; measure it honestly. No custom pusher, Hermes client, duplicate stale-price subsystem or widened source-age policy is introduced. A stale primary remains unusable even if the operator guard is fresh. Test collateral uses the USDC/USD conversion feed as an explicitly declared engineering proxy, not a claim that the minted test token is redeemable USDC.

Remaining G11 work includes:

- Pin and verify the selected provider/verifier implementation and exact compatible SDK or wire adapters without importing legacy transport objects into the production client graph.
- Generate separate private devnet program/authority keys and record their public identities, budgets, binary/IDL hashes, actual deployed code and mint authorities. Public deterministic local fixture keys must not be used on a cluster.
- Retain real sponsored BTC/USD and collateral/USD update-verification transactions and independently decode them, then consume the verified accounts in Rivalt. Bind feed identities, ownership, verification level, publish time, exponent conversion, confidence and anti-regression behavior in clearing. Exercise rejected updates with atomic state checks.
- Declare the operator-controlled guard's actual provenance and preserve G12's independent-source limitation. A second key is not independent economics.
- Measure real-cluster sampling/finality and source-age behavior before selecting any changed engineering timing configuration. Keep G08's existing economic/action rules and distinguish source validity from transaction commitment.
- Demonstrate accepted and rejected protocol actions under the deployed profile; record all costs and trust limits. Read-only dependency discovery alone cannot close A18.

## Separate test profile

Reviewers can build and run the local adapter check without operator secrets: missing private deployment keys are not required for compilation, and the SVM harness uses separate generated keys under `.local/devnet-svm/keys`. Generated build-output keypairs are not deployment keys. Actual RPC submission requires the pinned private deployer and refuses those SVM keys.

`ops/devnet-profile.json` pins separate clearing, A, B and operator-guard fixture identities, and the compatible sponsored receiver/accounts. Private random key files stay owner-readable under ignored `.local/devnet/keys`; none are the published deterministic local fixture keys. `bash ops/build-devnet.sh` builds into `.local/devnet/deploy` and `.local/devnet/idl`, checks key identities and rejects oversized SBF stack diagnostics. It verifies exact existing SDK ABI parity after explicit program-address mapping and documentation exclusion. Generated clients select the deployed program through their existing `programAddress` option; local SDK defaults and artifacts stay local.

The explicit `devnet-test-profile` and `local-test-profile` features are mutually exclusive for clearing. Default financial paths remain disabled. The devnet profile permits `initialize_test_routes` only with zero reference/duration, allocating coordination state with no valid risk interval; it cannot execute a route until `initialize_oracle` binds the pinned compatible receiver and two primary accounts. `publish_test_risk` remains disabled. Existing G08–G10 financial instructions use the same rules once authenticated mode 2 is active; schema and fees are unchanged. Sampling and exceptional-resolution source rereads share exact owner/account/readonly binding checks.

The adapter requires full PriceUpdateV2 verification, exact feed/write-authority/discriminator/size, nonfuture posted slot and nonregressing publish time. Checked integer normalization floors the price to -6 and expands confidence to include the discarded fractional midpoint. G08 then enforces freshness, confidence, bounds and divergence; an authenticated future-dated message remains restrictive and advances the monotonic source identity, while malformed/regressed data does not. The guard is an operator-signed mirror for this limited profile; preserving original primary publish times must not make stale upstream prices appear fresh. This is not an independent source or a fourth product program.

`node --import tsx tests/rpc-contract/devnet-svm.ts` exercises the actual separate SBF binaries with explicitly replayed upstream account snapshots, signed custody/setup, source rejection and an independently calculated one-lot trade. These local fixtures cannot close A18. Real Rivalt source consumption and accepted/rejected cluster actions remain due; deployment is independently verified below. P14's wallet/lifecycle/provider recovery remains dependent on verified P13 acceptance.

`node --import tsx tests/rpc-contract/devnet-deployment-check.ts` independently verifies finalized program/ProgramData ownership, upgrade authorities, exact tested ELF bytes and zero padding. Deployment is now verified in [the manifest](evidence/p13/deployment/deployed.json); live consumption is the remaining A18 step. `node --import tsx tests/rpc-contract/devnet-acceptance.ts` is the bounded live harness, with a 10,000,000-lamport network-fee cap, a 600-second source-window wait and the unchanged on-chain limits. Its journal persists exact signed bytes before broadcast, independently fetches and compares finalized wire/history, binds event-CPI decoding to the deployed clearing ID, and preserves failed logs/fees. Missing or ambiguous history stops the run without signing a replacement. Source preparation can decline a short remaining lifetime; it cannot extend on-chain freshness. The harness is not a PostgreSQL/service or wallet/UI parity claim; those remain P14.

The public RPC can rate-limit confirmation even after WS reports success. The bounded acceptance transport paces requests and backs off only explicit HTTP 429 for at most five delays (1/2/4/8/16 seconds). It retries identical RPC parameters, preserves original signatures and retains interruptions in the report. A transport timeout remains ambiguous; finalized history must reconcile it before another intent. This does not extend the oracle validity window or establish P14 provider-recovery acceptance.
