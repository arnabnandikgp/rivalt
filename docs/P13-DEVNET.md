# P13 devnet dependency and deployment contract

P13 starts above ready P12 PR #14 at `e0c18260a09a4cb40432a6bcc3ce6875a949b52a`. A18 requires a separate Rivalt test-cluster deployment and an actual signed primary oracle update through its deployed verifier. The current local oracle fixture cannot meet that requirement. P13 is incomplete; WORKLOG owns live status.

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

The current primary candidate is the documented Pyth Core verified-update interface. [Official contract addresses](https://docs.pyth.network/price-feeds/pro/contract-addresses#solana) identify receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` and Wormhole receiver `HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ` on devnet. These are dependency inventory targets, not evidence of completed Rivalt integration. [Current Solana integration documentation](https://docs.pyth.network/price-feeds/pro/use-prices-on-blockchain/solana) requires a Pyth API key for the documented Hermes update endpoint. The unauthenticated endpoint check returned HTTP 403 on 23 October; the user reports no access configured. No paid service or signup is authorized.

Remaining G11 work includes:

- Pin and verify the selected provider/verifier implementation and exact compatible SDK or wire adapters without importing legacy transport objects into the production client graph.
- Generate separate private devnet program/authority keys and record their public identities, budgets, binary/IDL hashes, actual deployed code and mint authorities. Public deterministic local fixture keys must not be used on a cluster.
- Fetch real signed BTC/USD and collateral/USD updates, execute their verifier path and independently decode finalized transactions. Bind feed identities, ownership, verification level, publish time, exponent conversion, confidence and anti-regression behavior in clearing. Exercise rejected updates with atomic state checks.
- Declare the operator-controlled guard's actual provenance and preserve G12's independent-source limitation. A second key is not independent economics.
- Measure real-cluster sampling/finality and source-age behavior before selecting any changed engineering timing configuration. Keep G08's existing economic/action rules and distinguish source validity from transaction commitment.
- Demonstrate accepted and rejected protocol actions under the deployed profile; record all costs and trust limits. Read-only dependency discovery alone cannot close A18.

No devnet financial entry point is enabled by this preparatory change. P14's wallet/lifecycle/provider recovery remains dependent on verified P13 acceptance.
